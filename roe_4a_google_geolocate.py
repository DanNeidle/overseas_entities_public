#!/usr/bin/env python3

# this is very expensive - £5/1000
# run to cleanup difficlt addresses radar misses

#!/usr/bin/env python3
import sqlite3
import time
import googlemaps
from typing import Optional, Tuple

# --- Configuration ---
TABLE_NAME = 'entities'

from companies_house_settings import google_geo_api_key, current_db_file

# Geocoding API settings
MAX_RETRIES = 10
RETRY_DELAY_SECONDS = 5

# these are expensive; for if something has gone wrong and you need to overwrite everything!
GEOLOCATE_ALL_PROPERTIES = False
GEOLOCATE_ALL_PROPRIETORS = False
GEOLOCATE_ALL_BOS = False
SKIP_UNTIL = None

if (GEOLOCATE_ALL_PROPERTIES or GEOLOCATE_ALL_PROPRIETORS or GEOLOCATE_ALL_BOS):
    
    confirmation = input("Warning - I am overwriting prior geolocations. Are you sure you want to proceed? (y/n): ").lower()
    if confirmation not in ['y', 'yes']:
        print("Aborting script. No changes have been made.")
        exit()
    
# --- Globals ---
# Initialize the Google Maps client
gmaps = googlemaps.Client(key=google_geo_api_key)
# Cache to store results for the duration of the script run
geocoding_cache = {}


# Geolocate a single address via Google Maps, with caching and retries.
def google_geolocate(address: str) -> Optional[Tuple[float, float]]:

    # Check cache first to avoid unnecessary API calls
    if address in geocoding_cache:
        # Return cached result, even if it's None (a known failure)
        return geocoding_cache[address]

    # Don't try to geolocate invalid placeholder addresses
    if not address or "not on companies house" in address.lower():
        return None

    retries = 0
    while retries < MAX_RETRIES:
        try:
            # No need for verbose printing in production run
            location = gmaps.geocode(address) # type: ignore
            if location and location[0].get('geometry', {}).get('location'):
                central_coords = location[0]['geometry']['location']
                lat = central_coords['lat']
                lon = central_coords['lng']
                geocoding_cache[address] = (lat, lon)
                return lat, lon
            else:
                geocoding_cache[address] = None # Cache the failure
                return None
        except Exception as e:
            retries += 1
            # Brief error log for retries
            print(f"  -> Geocoding error for '{address}': {e}. Retrying...")
            time.sleep(RETRY_DELAY_SECONDS)
            
    geocoding_cache[address] = None # Cache the permanent failure
    return None

 
# Iterate all records and populate missing lat/lon values using Google Maps
def geocode_entire_database():
    
    conn = sqlite3.connect(current_db_file)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    print("Fetching all records to geocode...")
    cursor.execute(f"SELECT * FROM {TABLE_NAME} ORDER BY property_title_number") # we order by title number so that successive runs are in the same order
    rows = cursor.fetchall()
    total_rows = len(rows)
    
    if total_rows == 0:
        print("Database is empty. Nothing to do.")
        conn.close()
        return
 
    print(f"Starting to process {total_rows} records...")
    if SKIP_UNTIL is None:
        skipping = False
    else:
        confirmation = input(f"I will skip all records until {SKIP_UNTIL}. Are you sure you want to proceed? (y/n): ").lower()
        if confirmation not in ['y', 'yes']:
            print("Aborting script. No changes have been made.")
            exit()
        
        skipping = True
        
    # now go through whole of database:
    total_geolocated = 0
    total_failed = 0

    for index, row in enumerate(rows):
        title_number = row['property_title_number']
        
        # see if we are skipping
        if skipping and title_number == SKIP_UNTIL:
            skipping = False
        elif skipping:
            print(f"skipping {title_number}")
            continue
        
        
        updates_to_make = {}
        skipped, geolocated, failed = 0, 0, 0

        # --- Check Property Address ---
        
        if row['property_lat'] and (not GEOLOCATE_ALL_PROPERTIES):
            skipped += 1 # we won't overwrite existing UNLESS flag GEOLOCATE_ALL_PROPERTIES is set
            
        elif row['property_uk_address']:
            result = google_geolocate(row['property_uk_address'])
            if result:
                updates_to_make['property_lat'], updates_to_make['property_lon'] = result
                geolocated += 1
            else:
                failed += 1
        
        # --- Check Proprietor and BO Addresses ---
        for i in range(1, 5):
            # Proprietor
            if row[f'proprietor{i}_lat'] and (not GEOLOCATE_ALL_PROPRIETORS):
                skipped += 1
            elif row[f'proprietor{i}_address']:
                result = google_geolocate(row[f'proprietor{i}_address'])
                if result:
                    updates_to_make[f'proprietor{i}_lat'], updates_to_make[f'proprietor{i}_lon'] = result
                    geolocated += 1
                else:
                    failed += 1
            
            # Beneficial Owners
            for j in range(1, 5):
                if row[f'proprietor{i}_BO{j}_latlon'] and (not GEOLOCATE_ALL_BOS):
                    skipped += 1
                elif row[f'proprietor{i}_BO{j}_address']:
                    result = google_geolocate(row[f'proprietor{i}_BO{j}_address'])
                    if result:
                        updates_to_make[f'proprietor{i}_BO{j}_latlon'] = f"{result[0]},{result[1]}"
                        geolocated += 1
                    else:
                        failed += 1

        # --- Perform Update and Log Progress ---
        if updates_to_make:
            set_clause = ", ".join([f'"{key}" = ?' for key in updates_to_make.keys()])
            update_sql = f'UPDATE {TABLE_NAME} SET {set_clause} WHERE property_title_number = ?'
            values = list(updates_to_make.values()) + [title_number]
            cursor.execute(update_sql, values)
            conn.commit() # Commit after each record to save progress


        
        percent_complete = ((index + 1) / total_rows) * 100
        if (geolocated + failed) > 0:
            print(f"{percent_complete:.1f}% - {title_number}: skipped {skipped}, newly geolocated {geolocated}, failed {failed}")
        total_geolocated += geolocated
        total_failed += failed

    print("\nProcessing complete.")
    print(f"Total newly geolocated: {total_geolocated}")
    print(f"Total newly failed: {total_failed}")
    conn.close()


if __name__ == '__main__':
    geocode_entire_database()
