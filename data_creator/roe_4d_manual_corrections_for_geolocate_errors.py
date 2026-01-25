#!/usr/bin/env python3
"""
This script applies manual corrections for specific wrong property and entity geolocations.
It corrects properties by their title number and entities by their address.
"""

import sqlite3
import os
from companies_house_settings import current_db_file

TABLE_NAME = "entities"

UNTRACEABLE_TITLES = ["WM474380", "DY63457", "NGL727253", "NGL36975", "TY236724"]

# 1. A dictionary to fix property geolocations by their exact title number.
# Key: property_title_number, Value: (latitude, longitude)
TITLES_TO_FIX = {
    "NGL517146": (51.49656375155604, -0.26611152457080817),
    "NGL642489": (51.504746352343496, -0.14805777615562732),
    "AA59206": (51.58614050960379, 0.47678226138748764),
    "445940": (51.50738315559671, -0.1479328693128212),
    "GR443996": (51.92028258509934, -2.100085108485864),
    "YY147005": (53.79490274875138, -1.7439577007813019),
    "ST39534": (50.96012084376048, -3.268994790406864),
    "NT364303": (52.957194693151045, -1.180284960479652),
    "NT294111": (52.957194693151045, -1.180284960479652),
    "MAN429693": (53.474739270024735, -2.293911245577427),
    "SY509685": (51.33089080068924, -0.27039302009985877),
    "LN98813": (51.49888946764384, -0.16683606965617578),
    "CH623771": (53.14106652171742, -2.364258655820513),
    "WYK178956": (53.77883205458084, -1.6119988175775555),
    "NGL242876": (51.56831271604776, -0.24138460091712494),
    "DT478072": (50.71269584029682, -1.9845238944461554),
    "DT479184": (50.71269584029682, -1.9845238944461554),
    "DT479281": (50.71269584029682, -1.9845238944461554),
    "DT479279": (50.71269584029682, -1.9845238944461554),
    "WT317733": (51.540828471821, -1.7911537585905866),
    "TGL366544": (51.502662, -0.000032),
    "TGL382423": (51.502662, -0.000032),
    "TGL382423": (51.502662, -0.000032),
    "NGL983759": (51.51396002977669, -0.14447690014291945),
    "SGL90653": (51.41008281594971, -0.1855209816134501),
    "LL432876": (53.2403607792279, -0.4929052932539283),
    "CH457352": (53.35024759714459, -2.540688629737502),
    "AV244629": (51.539255988303175, -2.6186071288352704),
    "WK224942": (52.47634469112699, -1.8594752865058135),
    "K255847": (51.42636527913663, 0.22803580104983814),
    "K233201": (51.43438874235248, 0.22171192514147897),
    "WM474380": (None, None),
    "HD626396": (51.80741791375425, -0.19654512484692124),
    "MS593150": (53.47846532005397, -2.663168057670541),
    "MS680073": (53.394903452853924, -3.0178970292618383),
    "HD402964": (51.82061333646517, -0.040644001850669347),
    "HP586761": (51.06268461375757, -1.3144169441790494),
    "HD611": (51.70982933502508, -0.14129860185066934),
    "HD3096":  (51.70982933502508, -0.14129860185066934),
    "EGL299692": (51.62874075997453, -0.043038055820950466),
    "BM367637": (51.57325084243357, -0.7969659271092576),
    "BM367639": (51.57325084243357, -0.7969659271092576),
    "DU398579": (54.76112553919801, -1.583956134055499),
    "HD71520": (51.63728491148218, -0.4796917738843691),

    
    
}

# 2. A dictionary to fix entity geolocations by their address.
# The script will perform a case-insensitive search across all address fields.
# Key: address string, Value: (latitude, longitude)
ADDRESSES_TO_FIX = {
    "PO Box 4406 Safat, Kuwait, Post Code: 13045": (29.37167177188553, 47.973120183121075),
    "6, Rue De Rive, Ch-1204 Geneva, Switzerland": (46.202320760545625, 6.150451606746071),
    "Level 5 Mill Court, La Charroterie, St Peter Port, GY1 1EJ, Guernsey": (49.45016714600339, -2.5432776746902137)
}

def apply_manual_fixes():
    """
    Connects to the database and updates coordinates based on the
    TITLES_TO_FIX and ADDRESSES_TO_FIX dictionaries.
    """
    if not os.path.exists(current_db_file):
        print(f"Error: Database file not found at '{current_db_file}'. Please ensure the path is correct.")
        return

    conn = None
    try:
        # Establish a connection to the SQLite database
        conn = sqlite3.connect(current_db_file)
        cursor = conn.cursor()
        print(f"Connected to the database '{current_db_file}'.")

        # --- Part 0: Delete untraceable titles ---
        print("\n--- Removing Untraceable Titles ---")
        deleted_count = 0
        if UNTRACEABLE_TITLES:
            placeholders = ", ".join(["?"] * len(UNTRACEABLE_TITLES))
            delete_sql = f"DELETE FROM {TABLE_NAME} WHERE property_title_number IN ({placeholders})"
            cursor.execute(delete_sql, UNTRACEABLE_TITLES)
            deleted_count = cursor.rowcount
            print(f" -> Removed {deleted_count} record(s) for untraceable titles.")

        # --- Part 1: Update based on Property Title Number ---
        print("\n--- Processing Title Number Fixes ---")
        title_updated_count = 0
        update_sql_by_title = f"UPDATE {TABLE_NAME} SET property_lat = ?, property_lon = ? WHERE property_title_number = ?"
        for title, (lat, lon) in TITLES_TO_FIX.items():
            cursor.execute(update_sql_by_title, (lat, lon, title))
            if cursor.rowcount > 0:
                title_updated_count += cursor.rowcount
                print(f" -> Success: Title {title} updated with new coordinates ({cursor.rowcount} row(s) affected).")
            else:
                print(f" -> Warning: Title {title} not found. No update performed.")

        # --- Part 2: Update based on Address ---
        print("\n--- Processing Address Fixes ---")
        address_updated_count = 0
        for address, (lat, lon) in ADDRESSES_TO_FIX.items():
            print(f"\nSearching for address: '{address}'")

            # A) Update property coordinates if address matches
            update_sql = f"UPDATE {TABLE_NAME} SET property_lat = ?, property_lon = ? WHERE LOWER(property_uk_address) = LOWER(?)"
            cursor.execute(update_sql, (lat, lon, address))
            if cursor.rowcount > 0:
                address_updated_count += cursor.rowcount
                print(f" -> Updated 'property_uk_address' coordinates for {cursor.rowcount} record(s).")
            
            # Loop through proprietors 1-4
            for i in range(1, 5):
                # B) Update proprietor coordinates if address matches
                prop_address_col = f'proprietor{i}_address'
                prop_lat_col = f'proprietor{i}_lat'
                prop_lon_col = f'proprietor{i}_lon'
                update_sql = f"UPDATE {TABLE_NAME} SET {prop_lat_col} = ?, {prop_lon_col} = ? WHERE LOWER({prop_address_col}) = LOWER(?)"
                cursor.execute(update_sql, (lat, lon, address))
                if cursor.rowcount > 0:
                    address_updated_count += cursor.rowcount
                    print(f" -> Updated '{prop_address_col}' coordinates for {cursor.rowcount} record(s).")

                # Loop through beneficial owners 1-4 for each proprietor
                for j in range(1, 5):
                    # C) Update BO coordinates if address matches
                    bo_address_col = f'proprietor{i}_BO{j}_address'
                    bo_latlon_col = f'proprietor{i}_BO{j}_latlon'
                    # BO lat/lon is a single field, so we format it as a string
                    latlon_str = f"{lat},{lon}"
                    update_sql = f"UPDATE {TABLE_NAME} SET {bo_latlon_col} = ? WHERE LOWER({bo_address_col}) = LOWER(?)"
                    cursor.execute(update_sql, (latlon_str, address))
                    if cursor.rowcount > 0:
                        address_updated_count += cursor.rowcount
                        print(f" -> Updated '{bo_address_col}' coordinates for {cursor.rowcount} record(s).")

        # Commit all the changes from both parts to the database file
        conn.commit()
        print("\n----------------------------------------------------")
        print("Database transaction committed.")
        print(f"Total records deleted for untraceable titles: {deleted_count}")
        print(f"Total records updated by title number: {title_updated_count}")
        print(f"Total records updated by address match: {address_updated_count}")
        print("----------------------------------------------------")


    except sqlite3.Error as e:
        print(f"\nAn error occurred: {e}")
        # If an error occurs, roll back any changes made during the transaction
        if conn:
            conn.rollback()
            print("Transaction has been rolled back.")
            
    finally:
        # Ensure the database connection is closed, even if errors occurred
        if conn:
            conn.close()
            print("\nDatabase connection closed.")

if __name__ == '__main__':
    print("--- Starting Manual Geolocation Correction Script ---")
    apply_manual_fixes()
    print("--- Script Finished ---")
    print("\n\nNow check to make sure:")
    print("1. no properties outside UK")
    print("2. No proprietors in the UK")
