#!/usr/bin/env python3

# this script copies across geolocation lat lon data from the previous version of the database
# so avoiding unnecessary geolocation lookups on the next stage
# would be much easier to just process updates from companies house, but then we would miss changes in beneficial owners
# so we have to run companies house checks against the entire entire list from scratch
# 
# the purpose of this file is that we don't lose previous gelocations

# of course if you don't have a previous database you have to skip this stage and geolocate everything sad face


import sqlite3
import os
from typing import Optional, Tuple, Dict
from companies_house_settings import current_db_file, old_db_file

# --- Configuration ---

TABLE_NAME = 'entities'
BATCH_COMMIT_SIZE = 20  

# --- Column Lists for Global Search ---
PROPRIETOR_ADDRESS_COLS = [f'proprietor{i}_address' for i in range(1, 5)]
BO_ADDRESS_COLS = [f'proprietor{i}_BO{j}_address' for i in range(1, 5) for j in range(1, 5)]

def check_database_files():
    """Checks if both database files exist before proceeding."""
    if not os.path.exists(current_db_file):
        print(f"Error: The new database '{current_db_file}' does not exist.")
        exit()
    if not os.path.exists(old_db_file):
        print(f"Error: The previous version database '{old_db_file}' does not exist.")
        exit()

def is_first_clause_match(addr1: str, addr2: str) -> bool:
    """Compares two address strings for equivalence based on their first clause."""
    if not addr1 or not addr2:
        return False
    first_clause1 = addr1.split(',')[0].strip().lower()
    first_clause2 = addr2.split(',')[0].strip().lower()
    return bool(first_clause1 and first_clause1 == first_clause2)

def search_globally_for_latlon(cursor: sqlite3.Cursor, address: str, cache: Dict) -> Optional[Tuple[str, str]]:
    """Fallback search for a standard lat/lon pair across all relevant address fields."""
    if address in cache:
        return cache[address]

    search_clause = address.split(',')[0].strip() + '%'
    
    # Check property addresses first
    cursor.execute(f'SELECT property_lat, property_lon FROM {TABLE_NAME} WHERE property_uk_address LIKE ? AND property_lat IS NOT NULL LIMIT 1', (search_clause,))
    result = cursor.fetchone()
    if result:
        cache[address] = result
        return result

    # Check proprietor addresses
    for col in PROPRIETOR_ADDRESS_COLS:
        lat_col, lon_col = col.replace('_address', '_lat'), col.replace('_address', '_lon')
        cursor.execute(f'SELECT {lat_col}, {lon_col} FROM {TABLE_NAME} WHERE {col} LIKE ? AND {lat_col} IS NOT NULL LIMIT 1', (search_clause,))
        result = cursor.fetchone()
        if result:
            cache[address] = result
            return result
    
    cache[address] = None # Cache the failure to avoid re-querying
    return None

def search_globally_for_combined_latlon(cursor: sqlite3.Cursor, address: str, cache: Dict) -> Optional[Tuple[str]]:
    """Fallback search for a combined 'latlon' string across all BO address fields."""
    if address in cache:
        return cache[address]

    search_clause = address.split(',')[0].strip() + '%'
    for col in BO_ADDRESS_COLS:
        latlon_col = col.replace('_address', '_latlon')
        cursor.execute(f'SELECT {latlon_col} FROM {TABLE_NAME} WHERE {col} LIKE ? AND {latlon_col} IS NOT NULL LIMIT 1', (search_clause,))
        result = cursor.fetchone()
        if result:
            cache[address] = result
            return result
            
    cache[address] = None # Cache the failure
    return None


def run_database_update():
    """
    Processes all records, compares addresses, uses a fallback search if needed,
    and writes the updates to the new database.
    """
    new_conn = sqlite3.connect(current_db_file)
    new_conn.row_factory = sqlite3.Row
    new_cursor = new_conn.cursor()

    old_conn = sqlite3.connect(old_db_file)
    old_conn.row_factory = sqlite3.Row
    old_cursor = old_conn.cursor()

    # --- OPTIMIZATION: Fix N+1 query problem by pre-loading old data ---
    print("Fetching all records from the old database into memory to optimize lookups...")
    old_cursor.execute(f"SELECT * FROM {TABLE_NAME}")
    old_rows = old_cursor.fetchall()
    old_rows_map = {row['property_title_number']: row for row in old_rows}
    print(f"Loaded {len(old_rows_map)} records from the old database.")

    # --- OPTIMIZATION: Caches for expensive fallback searches ---
    fallback_latlon_cache = {}
    fallback_combined_cache = {}

    print("Fetching all records from the new database to process...")
    new_cursor.execute(f"SELECT * FROM {TABLE_NAME}")
    new_rows = new_cursor.fetchall()

    if not new_rows:
        print("The new database table is empty. Nothing to process.")
        return

    total_records = len(new_rows)
    records_processed = 0
    records_updated = 0
    
    print(f"Starting update for {total_records} records...")

    for new_row in new_rows:
        title_number = new_row['property_title_number']
        updates_to_make = {}
        
        # --- OPTIMIZATION: Use fast dictionary lookup instead of a new SQL query ---
        old_row = old_rows_map.get(title_number)

        if not old_row:
            # This record is new, so we can't get old geodata for it.
            records_processed += 1
            continue
        
        # --- Property Address ---
        prop_new_addr = new_row['property_uk_address']
        if not new_row['property_lat'] and prop_new_addr:
            prop_old_addr = old_row['property_uk_address']
            if is_first_clause_match(prop_old_addr, prop_new_addr):
                if old_row['property_lat'] and old_row['property_lon']:
                    updates_to_make['property_lat'], updates_to_make['property_lon'] = old_row['property_lat'], old_row['property_lon']
            else:
                print(f"  {title_number} failed Property: new '{prop_new_addr}' doesn't match old '{prop_old_addr}'")
                fallback_result = search_globally_for_latlon(old_cursor, prop_new_addr, fallback_latlon_cache)
                if fallback_result:
                    print(f"    -> property fallback search: FOUND")
                    updates_to_make['property_lat'], updates_to_make['property_lon'] = fallback_result

        # --- Proprietor and BO Addresses ---
        for i in range(1, 5):
            # Proprietor
            p_new_addr = new_row[f'proprietor{i}_address']
            if not new_row[f'proprietor{i}_lat'] and p_new_addr:
                p_old_addr = old_row[f'proprietor{i}_address']
                if is_first_clause_match(p_old_addr, p_new_addr):
                    if old_row[f'proprietor{i}_lat'] and old_row[f'proprietor{i}_lon']:
                        updates_to_make[f'proprietor{i}_lat'], updates_to_make[f'proprietor{i}_lon'] = old_row[f'proprietor{i}_lat'], old_row[f'proprietor{i}_lon']
                else:
                    print(f"  {title_number} failed P{i}: new '{p_new_addr}' doesn't match old '{p_old_addr}'")
                    fallback_result = search_globally_for_latlon(old_cursor, p_new_addr, fallback_latlon_cache)
                    if fallback_result:
                        print(f"    -> proprietor{i} fallback search: FOUND")
                        updates_to_make[f'proprietor{i}_lat'], updates_to_make[f'proprietor{i}_lon'] = fallback_result

            # Beneficial Owners
            for j in range(1, 5):
                bo_new_addr = new_row[f'proprietor{i}_BO{j}_address']
                if not new_row[f'proprietor{i}_BO{j}_latlon'] and bo_new_addr:
                    bo_old_addr = old_row[f'proprietor{i}_BO{j}_address']
                    if is_first_clause_match(bo_old_addr, bo_new_addr):
                        if old_row[f'proprietor{i}_BO{j}_latlon']:
                            updates_to_make[f'proprietor{i}_BO{j}_latlon'] = old_row[f'proprietor{i}_BO{j}_latlon']
                    else:
                        print(f"  {title_number} failed P{i}B{j}: new '{bo_new_addr}' doesn't match old '{bo_old_addr}'")
                        fallback_result = search_globally_for_combined_latlon(old_cursor, bo_new_addr, fallback_combined_cache)
                        if fallback_result:
                            print(f"    -> proprietor{i}BO{j} fallback search: FOUND")
                            updates_to_make[f'proprietor{i}_BO{j}_latlon'] = fallback_result[0]
        
        # --- Perform the update if there's anything to do ---
        if updates_to_make:
            set_clause = ", ".join([f'"{key}" = ?' for key in updates_to_make.keys()])
            update_sql = f'UPDATE {TABLE_NAME} SET {set_clause} WHERE property_title_number = ?'
            values = list(updates_to_make.values()) + [title_number]
            
            
            # Execute the update on the new database
            new_cursor.execute(update_sql, values) 
            records_updated += 1

        records_processed += 1
        
        # --- OPTIMIZATION: Commit in batches to prevent data loss on failure ---
        if records_processed % BATCH_COMMIT_SIZE == 0:
            print(f"\n\nCommitting batch... {round(100 * records_processed/total_records, 2)}% done.\n")
            new_conn.commit()

    # --- Final Commit and Cleanup ---
    print("Committing all remaining changes to the database...")
    new_conn.commit()
    new_conn.close()
    old_conn.close()
    print("-" * 70)
    print(f"Process finished. A total of {records_updated} records were updated with geodata.")

if __name__ == '__main__':
    check_database_files()
    run_database_update()