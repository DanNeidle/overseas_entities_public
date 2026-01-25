# we create the database using the new CSV. We pull everything afresh from companies house becauase otherwise we'd miss changed BO data
# (i.e. because companies house gives us new overseas-owned properties, and changed proprietors, but won't tell us when a proprietor changes beneficial owner
# so we have to do the whole cmompanies house read again
# but we can use the old database for address geolocation, which is the really slow/difficult bit!


#!/usr/bin/env python3
import csv
import sqlite3
import os
from datetime import datetime
from typing import Dict, Optional
from companies_house_settings import current_db_file, current_overseas_entity_list_file


# --- Configuration ---
TABLE_NAME = 'entities'

if os.path.exists(current_db_file):
    print(f"ERROR: database {current_db_file} exists. This script is for creating a new database")
    exit()
    
 
# --- Database Schema ---
# Complete list of fields for the database table.
DB_FIELDS = [
    'property_title_number', 'status', 'created_timestamp', 'last_processed_timestamp', 
    'property_lat', 'property_lon', 'property_multiple_address_indicator', 
    'property_price_paid', 'property_type', 'property_tenure', 'property_uk_address', 'date_added',
    'property_uk_postcode', 'proprietor1_BO1_address', 'proprietor1_BO1_ceased', 
    'proprietor1_BO1_is_sanctioned', 'proprietor1_BO1_kind', 'proprietor1_BO1_latlon', 
    'proprietor1_BO1_legal_form', 'proprietor1_BO1_name', 'proprietor1_BO1_reg_status', 
    'proprietor1_BO2_address', 'proprietor1_BO2_ceased', 'proprietor1_BO2_is_sanctioned', 
    'proprietor1_BO2_kind', 'proprietor1_BO2_latlon', 'proprietor1_BO2_legal_form', 
    'proprietor1_BO2_name', 'proprietor1_BO2_reg_status', 'proprietor1_BO3_address', 
    'proprietor1_BO3_ceased', 'proprietor1_BO3_is_sanctioned', 'proprietor1_BO3_kind', 
    'proprietor1_BO3_latlon', 'proprietor1_BO3_legal_form', 'proprietor1_BO3_name', 
    'proprietor1_BO3_reg_status', 'proprietor1_BO4_address', 'proprietor1_BO4_ceased', 
    'proprietor1_BO4_is_sanctioned', 'proprietor1_BO4_kind', 'proprietor1_BO4_latlon', 
    'proprietor1_BO4_legal_form', 'proprietor1_BO4_name', 'proprietor1_BO4_reg_status', 
    'proprietor1_BO_failure', 'proprietor1_CH_number', 'proprietor1_address', 
    'proprietor1_company_registration_no', 'proprietor1_country_incorporated', 
    'proprietor1_lat', 'proprietor1_lon', 'proprietor1_name', 
    'proprietor1_proprietorship_category', 'proprietor2_BO1_address', 
    'proprietor2_BO1_ceased', 'proprietor2_BO1_is_sanctioned', 'proprietor2_BO1_kind', 
    'proprietor2_BO1_latlon', 'proprietor2_BO1_legal_form', 'proprietor2_BO1_name', 
    'proprietor2_BO1_reg_status', 'proprietor2_BO2_address', 'proprietor2_BO2_ceased', 
    'proprietor2_BO2_is_sanctioned', 'proprietor2_BO2_kind', 'proprietor2_BO2_latlon', 
    'proprietor2_BO2_legal_form', 'proprietor2_BO2_name', 'proprietor2_BO2_reg_status', 
    'proprietor2_BO3_address', 'proprietor2_BO3_ceased', 'proprietor2_BO3_is_sanctioned', 
    'proprietor2_BO3_kind', 'proprietor2_BO3_latlon', 'proprietor2_BO3_legal_form', 
    'proprietor2_BO3_name', 'proprietor2_BO3_reg_status', 'proprietor2_BO4_address', 
    'proprietor2_BO4_ceased', 'proprietor2_BO4_is_sanctioned', 'proprietor2_BO4_kind', 
    'proprietor2_BO4_latlon', 'proprietor2_BO4_legal_form', 'proprietor2_BO4_name', 
    'proprietor2_BO4_reg_status', 'proprietor2_BO_failure', 'proprietor2_CH_number', 
    'proprietor2_address', 'proprietor2_company_registration_no', 
    'proprietor2_country_incorporated', 'proprietor2_lat', 'proprietor2_lon', 
    'proprietor2_name', 'proprietor2_proprietorship_category', 'proprietor3_BO1_address', 
    'proprietor3_BO1_ceased', 'proprietor3_BO1_is_sanctioned', 'proprietor3_BO1_kind', 
    'proprietor3_BO1_latlon', 'proprietor3_BO1_legal_form', 'proprietor3_BO1_name', 
    'proprietor3_BO1_reg_status', 'proprietor3_BO2_address', 'proprietor3_BO2_ceased', 
    'proprietor3_BO2_is_sanctioned', 'proprietor3_BO2_kind', 'proprietor3_BO2_latlon', 
    'proprietor3_BO2_legal_form', 'proprietor3_BO2_name', 'proprietor3_BO2_reg_status', 
    'proprietor3_BO3_address', 'proprietor3_BO3_ceased', 'proprietor3_BO3_is_sanctioned', 
    'proprietor3_BO3_kind', 'proprietor3_BO3_latlon', 'proprietor3_BO3_legal_form', 
    'proprietor3_BO3_name', 'proprietor3_BO3_reg_status', 'proprietor3_BO4_address', 
    'proprietor3_BO4_ceased', 'proprietor3_BO4_is_sanctioned', 'proprietor3_BO4_kind', 
    'proprietor3_BO4_latlon', 'proprietor3_BO4_legal_form', 'proprietor3_BO4_name', 
    'proprietor3_BO4_reg_status', 'proprietor3_BO_failure', 'proprietor3_CH_number', 
    'proprietor3_address', 'proprietor3_company_registration_no', 
    'proprietor3_country_incorporated', 'proprietor3_lat', 'proprietor3_lon', 
    'proprietor3_name', 'proprietor3_proprietorship_category', 'proprietor4_BO1_address', 
    'proprietor4_BO1_ceased', 'proprietor4_BO1_is_sanctioned', 'proprietor4_BO1_kind', 
    'proprietor4_BO1_latlon', 'proprietor4_BO1_legal_form', 'proprietor4_BO1_name', 
    'proprietor4_BO1_reg_status', 'proprietor4_BO2_address', 'proprietor4_BO2_ceased', 
    'proprietor4_BO2_is_sanctioned', 'proprietor4_BO2_kind', 'proprietor4_BO2_latlon', 
    'proprietor4_BO2_legal_form', 'proprietor4_BO2_name', 'proprietor4_BO2_reg_status', 
    'proprietor4_BO3_address', 'proprietor4_BO3_ceased', 'proprietor4_BO3_is_sanctioned', 
    'proprietor4_BO3_kind', 'proprietor4_BO3_latlon', 'proprietor4_BO3_legal_form', 
    'proprietor4_BO3_name', 'proprietor4_BO3_reg_status', 'proprietor4_BO4_address', 
    'proprietor4_BO4_ceased', 'proprietor4_BO4_is_sanctioned', 'proprietor4_BO4_kind', 
    'proprietor4_BO4_latlon', 'proprietor4_BO4_legal_form', 'proprietor4_BO4_name', 
    'proprietor4_BO4_reg_status', 'proprietor4_BO_failure', 'proprietor4_CH_number', 
    'proprietor4_address', 'proprietor4_company_registration_no', 
    'proprietor4_country_incorporated', 'proprietor4_lat', 'proprietor4_lon', 
    'proprietor4_name', 'proprietor4_proprietorship_category',
    'proprietor1_BO1_natures_of_control', 'proprietor1_BO2_natures_of_control', 'proprietor1_BO3_natures_of_control', 'proprietor1_BO4_natures_of_control', 
    'proprietor2_BO1_natures_of_control', 'proprietor2_BO2_natures_of_control', 'proprietor2_BO3_natures_of_control', 'proprietor2_BO4_natures_of_control', 
    'proprietor3_BO1_natures_of_control', 'proprietor3_BO2_natures_of_control', 'proprietor3_BO3_natures_of_control', 'proprietor3_BO4_natures_of_control', 
    'proprietor4_BO1_natures_of_control', 'proprietor4_BO2_natures_of_control', 'proprietor4_BO3_natures_of_control', 'proprietor4_BO4_natures_of_control', 
    # Added: proprietor company number (TEXT)
    'proprietor1_number',
    'proprietor2_number',
    'proprietor3_number',
    'proprietor4_number',
]

def setup_database():
    """
    Creates the data directory, the SQLite database file, and the table schema.
    If the table already exists, it will be dropped and recreated.
    """
    # Create the 'data' directory if it doesn't exist
    os.makedirs(os.path.dirname(current_db_file), exist_ok=True)

    conn = sqlite3.connect(current_db_file)
    cursor = conn.cursor()

    # Drop the table if it exists to ensure a fresh start
    cursor.execute(f"DROP TABLE IF EXISTS {TABLE_NAME}")

    # Create the table schema dynamically from the DB_FIELDS list
    # The primary key is the title number. All other fields are TEXT to allow for NULLs.
    fields_with_types = ', '.join([f'"{field}" TEXT' for field in DB_FIELDS if field != 'property_title_number'])
    create_table_sql = f"""
    CREATE TABLE {TABLE_NAME} (
        "property_title_number" TEXT PRIMARY KEY,
        {fields_with_types}
    )
    """
    cursor.execute(create_table_sql)
    
    conn.commit()
    conn.close()
    print(f"Database '{current_db_file}' and table '{TABLE_NAME}' created successfully.")

def process_csv_to_db():
    """
    Reads the CSV file row by row and inserts the data into the SQLite database.
    """
    if not os.path.exists(current_overseas_entity_list_file):
        print(f"Error: CSV file not found at '{current_overseas_entity_list_file}'")
        # Create a dummy CSV for demonstration purposes if it doesn't exist
        print("Creating a dummy CSV file for demonstration...")
        os.makedirs(os.path.dirname(current_overseas_entity_list_file), exist_ok=True)
        with open(current_overseas_entity_list_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow([
                "Title Number", "Tenure", "Property Address", "District", "County", "Region", "Postcode", 
                "Multiple Address Indicator", "Price Paid", "Proprietor Name (1)", "Company Registration No. (1)", 
                "Proprietorship Category (1)", "Country Incorporated (1)", "Proprietor (1) Address (1)", 
                "Proprietor (1) Address (2)", "Proprietor (1) Address (3)", "Proprietor Name (2)", 
                "Company Registration No. (2)", "Proprietorship Category (2)", "Country Incorporated (2)", 
                "Proprietor (2) Address (1)", "Proprietor (2) Address (2)", "Proprietor (2) Address (3)", 
                "Proprietor Name (3)", "Company Registration No. (3)", "Proprietorship Category (3)", 
                "Country Incorporated (3)", "Proprietor (3) Address (1)", "Proprietor (3) Address (2)", 
                "Proprietor (3) Address (3)", "Proprietor Name (4)", "Company Registration No. (4)", 
                "Proprietorship Category (4)", "Country Incorporated (4)", "Proprietor (4) Address (1)", 
                "Proprietor (4) Address (2)", "Proprietor (4) Address (3)", "Date Proprietor Added", 
                "Additional Proprietor Indicator"
            ])
            writer.writerow([
                "LA937288", "Freehold", "Land on the south side of Lancashire Moor Road, Trawden, Colne (BB8 7EH)", 
                "PENDLE", "LANCASHIRE", "NORTH WEST", "BB8 7EH", "N", "100000", "GABLE ENTERPRISES LIMITED", 
                "OE12345", "Limited Company or Public Limited Company", "ISLE OF MAN", "28 Ballafurt Close", 
                "Port Erin", "IM9 6HS", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", 
                "", "", "", "23-03-2005", "N"
            ])

    conn = sqlite3.connect(current_db_file)
    cursor = conn.cursor()

    # Prepare the INSERT statement with placeholders for all fields
    placeholders = ', '.join(['?'] * len(DB_FIELDS))
    insert_sql = f"INSERT OR REPLACE INTO {TABLE_NAME} VALUES ({placeholders})"

    # Get the current timestamp
    now = datetime.now()
    timestamp_str = now.strftime("%H:%M:%S %d/%m/%Y")

    records_processed = 0
    with open(current_overseas_entity_list_file, 'r', encoding='utf-8') as csvfile:
        csv_reader = csv.reader(csvfile)
        header = next(csv_reader)  # Skip header row
        
        num_cols = len(header)

        for row in csv_reader:
            
            if len(row) != num_cols:
                continue
            
            # Initialize a dictionary with all fields set to None
            record: Dict[str, Optional[str]] = { field: None for field in DB_FIELDS }

            # --- Map CSV data to the dictionary ---
            # Timestamps
            record['created_timestamp'] = timestamp_str
            record['last_processed_timestamp'] = timestamp_str

            # Property Details
            record['property_title_number'] = row[0] if row[0] else None
            record['property_tenure'] = row[1] if row[1] else None
            record['property_uk_address'] = row[2] if row[2] else None
            record['property_uk_postcode'] = row[6] if row[6] else None
            record['property_multiple_address_indicator'] = row[7] if row[7] else None
            record['property_price_paid'] = row[8] if row[8] else None
            record['date_added'] = row[37] if row[37] else None

            # Proprietor 1
            record['proprietor1_name'] = row[9] if row[9] else None
            record['proprietor1_company_registration_no'] = row[10] if row[10] else None
            record['proprietor1_proprietorship_category'] = row[11] if row[11] else None
            record['proprietor1_country_incorporated'] = row[12] if row[12] else None
            
            # note we absolutely can't trust the address details here. Got to get from companies house
            record['proprietor1_address'] = None

            # Proprietor 2
            record['proprietor2_name'] = row[16] if row[16] else None
            record['proprietor2_company_registration_no'] = row[17] if row[17] else None
            record['proprietor2_proprietorship_category'] = row[18] if row[18] else None
            record['proprietor2_country_incorporated'] = row[19] if row[19] else None
            record['proprietor2_address'] = None

            # Proprietor 3
            record['proprietor3_name'] = row[23] if row[23] else None
            record['proprietor3_company_registration_no'] = row[24] if row[24] else None
            record['proprietor3_proprietorship_category'] = row[25] if row[25] else None
            record['proprietor3_country_incorporated'] = row[26] if row[26] else None
            record['proprietor3_address'] = None

            # Proprietor 4
            record['proprietor4_name'] = row[30] if row[30] else None
            record['proprietor4_company_registration_no'] = row[31] if row[31] else None
            record['proprietor4_proprietorship_category'] = row[32] if row[32] else None
            record['proprietor4_country_incorporated'] = row[33] if row[33] else None
            record['proprietor4_address'] = None
            
            # Convert the dictionary to a list of values in the correct order for insertion
            values_to_insert = [record[field] for field in DB_FIELDS]
            
            cursor.execute(insert_sql, values_to_insert)
            records_processed += 1

    conn.commit()
    conn.close()
    print(f"Successfully processed and inserted {records_processed} records into the database.")

if __name__ == '__main__':
    print("Starting the CSV to SQLite conversion process...")
    setup_database()
    process_csv_to_db()
    print("Process finished.")
