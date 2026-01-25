# the previous search misses all the companies it can't find on companies house
# we can take the addresses for these from the register of overseas entities
# the data is poor quality, but better than nothing!

#!/usr/bin/env python3
import sqlite3
import time
import json
from collections import deque
from companies_house_settings import current_db_file

import pandas as pd

from companies_house_settings import current_db_file, current_overseas_entity_list_file

# --- Configuration ---
TABLE_NAME = 'entities'

class ProprietorFinder:
    """
    A class to load property data from a CSV and find proprietor addresses.
    
    The data is loaded into memory once during initialization for efficient, 
    repeated lookups.
    """
    
    def __init__(self, csv_file_path: str):
        """
        Initializes the finder and loads the property data from the CSV file.
        
        Args:
            csv_file_path (str): The full path to the CSV file.
        """
        self.data_frame = None
        try:
            # Load the entire CSV into a pandas DataFrame.
            # Setting 'Title Number' as the index allows for very fast lookups.
            print(f"Loading data from {csv_file_path}...")
            self.data_frame = pd.read_csv(
                csv_file_path, 
                index_col='Title Number',
                # Use low_memory=False to avoid mixed type inference issues in large files.
                low_memory=False 
            )
            print("Data loaded successfully.")
        except FileNotFoundError:
            print(f"Error: The file at '{csv_file_path}' was not found.")
        except Exception as e:
            print(f"An error occurred while loading the data: {e}")

    def get_proprietor_address(self, title_number: str, prop_number) -> list:
        """
        Finds a given title number and returns a list of its proprietor addresses.

        Args:
            title_number (str): The title number to search for.

        Returns:
            list: A list of strings, where each string is a proprietor address. 
                  Returns an empty list if the title is not found or has no addresses.
        """
        if self.data_frame is None:
            print("Data is not loaded. Cannot perform search.")
            return []

        try:
            # Use .loc[] for a fast lookup by the index (Title Number).
            record = self.data_frame.loc[title_number]
            
            # Define the specific address columns to extract.
            address_columns = [
                'Proprietor (1) Address (1)',
                'Proprietor (2) Address (1)',
                'Proprietor (3) Address (1)',
                'Proprietor (4) Address (1)'
            ]
            
            relevant_col_number = address_columns[prop_number - 1]
            return record[relevant_col_number] # type: ignore
                
        except KeyError:
            # This block executes if the title_number is not found in the index.
            print(f"Title number '{title_number}' not found.")
            return []
        except Exception as e:
            print(f"An unexpected error occurred during lookup: {e}")
            return []


    

# Fill missing proprietor addresses in the DB using the ROE CSV as a fallback source.
def process_all_records():
    
    
    proprietor_finder = ProprietorFinder(current_overseas_entity_list_file)
    conn = sqlite3.connect(current_db_file)
    cursor = conn.cursor()

    # fetch rows with any missing proprietor address (for a named proprietor)
    missing_clauses = [
        "(proprietor1_name IS NOT NULL AND proprietor1_address IS NULL)",
        "(proprietor2_name IS NOT NULL AND proprietor2_address IS NULL)",
        "(proprietor3_name IS NOT NULL AND proprietor3_address IS NULL)",
        "(proprietor4_name IS NOT NULL AND proprietor4_address IS NULL)",
    ]
    cursor.execute(f"SELECT rowid, * FROM {TABLE_NAME} WHERE " + " OR ".join(missing_clauses))
    cols = [desc[0] for desc in cursor.description]
    rows = cursor.fetchall()
    total = len(rows)
    if total == 0:
        print('No records to process.')
        return
    print(f"Total records to process: {total}")
    

    start_time = time.time()
    processed = 0

    for row_tuple in rows:
        rowid = row_tuple[0]
        record = dict(zip(cols, row_tuple))
        
        title = record.get('property_title_number')
        print(f"\nDEBUG: Processing rowid {rowid}, {title}")
        update = {}

        for i in range(1, 5):
            prop = record.get(f'proprietor{i}_name') 
            current_prop_address = record.get(f'proprietor{i}_address') 

            if prop and prop.strip() and not current_prop_address:
                
                address = proprietor_finder.get_proprietor_address(title, i) # type: ignore
                update[f'proprietor{i}_address'] = address
                    
            else:
                print(f"DEBUG: No name for proprietor{i}")

        # filter update for non-null values
        visible = {k: v for k, v in update.items() if v is not None}
        print(f'About to write {title} update:', json.dumps(visible, indent=2))

        # execute update
        cols_assign = ', '.join(f'"{k}" = ?' for k in update)
        sql = f"UPDATE {TABLE_NAME} SET {cols_assign} WHERE rowid = ?"
        params = list(update.values()) + [rowid]
        cursor.execute(sql, params)
        conn.commit() 
        

        processed += 1
        elapsed = time.time() - start_time
        avg = elapsed / processed
        remaining = total - processed
        est = remaining * avg / 3600
        print(f"{processed}/{total} - estimated {est:.2f} hours to go")

    conn.close()
    print('All records processed.')


if __name__ == '__main__':
    
    process_all_records()
