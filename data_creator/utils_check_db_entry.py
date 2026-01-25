#!/usr/bin/env python3

# use this script for debugging/checking individual database entries

import sqlite3


title_to_find = "LN100920" 
from companies_house_settings import current_db_file
 
# --- Configuration ---

def get_db_entry(conn, title_number): 
    """
    Fetches a single entity from the database by its title number.

    Args:
        conn: The database connection object.
        title_number: The property title number to search for.

    Returns:
        A dictionary representing the database row, or None if not found.
    """
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    query = "SELECT * FROM entities WHERE property_title_number = ?"
    cursor.execute(query, (title_number,))
    row = cursor.fetchone()
    
    if row:
        return dict(row)
    return None

def main():
    """
    Main function to retrieve and print a database entry with aligned output.
    """
    # --- Connect to Database and Fetch Data ---
    try:
        conn = sqlite3.connect(current_db_file)
    except sqlite3.OperationalError as e:
        print(f"Error connecting to database at '{current_db_file}': {e}")
        exit()

    db_entry = get_db_entry(conn, title_to_find)
    conn.close()

    # --- Print the Result with Alignment ---
    if db_entry:
        print(f"--- Database Entry for Title: {title_to_find} ---")

        # 1. Filter out items that have no value (None or empty string)
        printable_items = {k: v for k, v in db_entry.items() if v}

        # 2. Find the length of the longest key among the items we will print
        #    We add a check in case there are no printable items.
        if printable_items:
            max_key_length = max(len(key) for key in printable_items)
        else:
            max_key_length = 0

        # 3. Print, using f-string formatting to right-align the key
        for key, value in printable_items.items():
            # The format specifier >{max_key_length} right-aligns the key
            print(f"{key:>{max_key_length}}: '{value}'")

    else:
        print(f"No entry found for title number: {title_to_find}")

if __name__ == "__main__":
    main()