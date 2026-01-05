#!/usr/bin/env python3
"""
This script uses an AI model to find missing latitude and longitude data
in a database for entries that a standard geocoder could not resolve.
It specifically targets rows with missing coordinates and uses Gemini
to infer the location from the address string.

In our run, only 286 items were left for this string to geolocate, out of the approx 350k we started with. So could do this by hand.
"""

import sqlite3
import json
from bs4 import ResultSet
from google import genai

from companies_house_settings import (
    gemini_api_key,
    gemini_model_to_use_for_ai,
    current_db_file
)

TABLE_NAME = 'entities'

cache = {}

# --- AI Client Setup ---

def launch_gemini_client(api_key: str):
    """
    Instantiates and configures the Gemini (GenAI) LLM client.
    """
    client = genai.Client(api_key=api_key)
    return client

def ai_geolocate(genai_client, address: str):
    
    if address in cache:
        result = cache[address]
        print(f"Using cached result {result}")
        return result
    
    """
    Uses the Gemini AI model to geolocate an address.

    Args:
        genai_model: The initialized Gemini model client.
        address: The address string to geolocate.

    Returns:
        A tuple of (latitude, longitude) or None if unsuccessful.
    """
    # Don't try to geolocate invalid placeholder addresses
    if not address or "not on companies house" in address.lower():
        cache[address] = None
        return None

    # Construct the prompt for the AI
    prompt = (
        "Please provide your best guess for the latitude and longitude of this address: "
        f"'{address}'. Your only response !must! be a JSON object with the following keys: "
        "'lat' (latitude), 'lon' (longitude), and 'explanation' (a brief justification for "
        "your choice). If the address is ambiguous, provide the most likely coordinates (e.g., "
        "the city center). Only if it is completely impossible to derive a location (e.g., "
        "the address is 'The Moon') should you return null for lat and lon."
    )

    print(f"\n-> Querying AI for address: '{address}'")

    try:
        response = genai_client.models.generate_content(model=gemini_model_to_use_for_ai,contents=[prompt])
        
        # Print the full, raw AI response for user visibility
        print("--- AI Response ---")
        print(response.text)
        print("-------------------")

        # Clean the response to extract the JSON part
        # AI responses can sometimes include markdown formatting (`json\n{...}\n`)
        cleaned_text = response.text.strip().replace('```json', '').replace('```', '').strip()
        
        # Parse the JSON response
        data = json.loads(cleaned_text)
        lat = data.get('lat')
        lon = data.get('lon')

        # Ensure both lat and lon are present and are numbers
        if lat is not None and lon is not None:
            result = (float(lat), float(lon))
        else:
            print("   -> AI returned null coordinates. Failed.")
            result = None
            
        cache[address] = result
        return result

    except json.JSONDecodeError:
        print(f"   -> FAILED: AI did not return valid JSON.")
        return None
    except Exception as e:
        print(f"   -> FAILED: An unexpected error occurred: {e}")
        return None


def geocode_remaining_with_ai():
    """
    Finds all records with missing geolocations in the database and
    uses the AI to attempt to fill them in.
    """
    conn = sqlite3.connect(current_db_file)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Initialize the AI client
    try:
        ai_client = launch_gemini_client(api_key=gemini_api_key)
    except Exception as e:
        print(f"Failed to initialize Gemini client: {e}")
        conn.close()
        return

    # Create a query to find rows where ANY of the relevant lat/lon fields are null or empty
    # This is more efficient than loading all 90,000 records.
    # Note: SQLite treats NULL and empty strings differently, so we check for both.
    fetch_sql = f"SELECT * FROM {TABLE_NAME}"

    print("Fetching all records from the database to check for missing geolocations...")
    cursor.execute(fetch_sql)
    rows_to_process = cursor.fetchall()
    
    
    total_to_process = len(rows_to_process)


    print(f"Starting to process {total_to_process} records needing AI geolocation...\n")
    
    geolocated_count = 0
    failed_count = 0

    for index, row in enumerate(rows_to_process):
        title_number = row['property_title_number']
        updates_to_make = {}
        
        

        # --- Check Property Address ---
        if not row['property_lat'] and row['property_uk_address']:
            print(f" Processing {title_number} proprietor {index + 1}/{total_to_process}")
            result = ai_geolocate(ai_client, row['property_uk_address'])
            if result:
                updates_to_make['property_lat'], updates_to_make['property_lon'] = result
                geolocated_count += 1
            else:
                failed_count += 1
        
        # --- Check Proprietor and BO Addresses ---
        for i in range(1, 5):
            # Proprietor
            if (row[f'proprietor{i}_name'] and 
                not row[f'proprietor{i}_lat'] and 
                row[f'proprietor{i}_address']):
                
                print(f" Processing {title_number} beneficial owner {i} - {index + 1}/{total_to_process}")
                result = ai_geolocate(ai_client, row[f'proprietor{i}_address'])
                if result:
                    updates_to_make[f'proprietor{i}_lat'], updates_to_make[f'proprietor{i}_lon'] = result
                    geolocated_count += 1
                else:
                    failed_count += 1
            
            # Beneficial Owners
            for j in range(1, 5):
                if (row[f'proprietor{i}_BO{j}_name'] and 
                    not row[f'proprietor{i}_BO{j}_latlon'] and 
                    row[f'proprietor{i}_BO{j}_address']):
                    
                    result = ai_geolocate(ai_client, row[f'proprietor{i}_BO{j}_address'])
                    if result:
                        updates_to_make[f'proprietor{i}_BO{j}_latlon'] = f"{result[0]},{result[1]}"
                        geolocated_count += 1
                    else:
                        failed_count += 1
                

        # --- Perform Update ---
        if updates_to_make:
            set_clause = ", ".join([f'"{key}" = ?' for key in updates_to_make.keys()])
            update_sql = f'UPDATE {TABLE_NAME} SET {set_clause} WHERE property_title_number = ?'
            values = list(updates_to_make.values()) + [title_number]
            
            try:
                cursor.execute(update_sql, values)
                conn.commit()
                print(f"\nSUCCESS: Database updated for title {title_number}.")
            except sqlite3.Error as e:
                print(f"\nERROR: Could not update database for title {title_number}: {e}")
                conn.rollback()
        

    print("\n--- Processing Complete ---")
    print(f"Successfully geolocated: {geolocated_count} addresses.")
    print(f"Failed to geolocate: {failed_count} addresses.")
    conn.close()

if __name__ == '__main__':
    geocode_remaining_with_ai()