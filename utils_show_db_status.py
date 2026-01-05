#!/usr/bin/env python3
import sqlite3

  
from companies_house_settings import current_db_file
 
    
# Summarise DB coverage: counts by BO type/status and geolocation completeness
def main():  
    conn = sqlite3.connect(current_db_file) 
    cursor = conn.cursor()
    
    # Retrieve all rows from the entities table.
    cursor.execute("SELECT * FROM entities")
    rows = cursor.fetchall()
    
    # Get column names to build dictionaries.
    col_names = [desc[0] for desc in cursor.description]
    
    # Dictionary to count each type of beneficial owner.
    bo_type_counts = {}
      
    # Count of properties that have at least one corporate-entity beneficial owner.
    bo_status_counts = {}
    properties_with_suspect = 0
    properties_with_sanctioned = 0
    
    total_properties = 0
    properties_geolocated = 0
    
    total_prop_geolocated = 0
    total_prop_not_geolocated = 0
    
    totol_bo_geolocated = 0
    totol_bo_not_geolocated = 0
    
    geo_status = {}
    
    
    # For each property record (each row in the table)
    for row in rows:
        
        total_properties += 1
        row_dict = dict(zip(col_names, row))
        has_suspect = False
        has_sanctioned = False
        
        check_status = row_dict.get("checks", "None")
        geo_status[check_status] = geo_status.get(check_status, 0) + 1
        
        if row_dict.get(f"property_lat"):
                properties_geolocated += 1
                
        #print(row_dict.get("proprietor1_address"))
        #if total_properties > 1000:
        #    exit()
        
        # Loop over each proprietor (1 to 4) and each BO (1 to 4)
        for i in range(1, 5):
            prop_name = row_dict.get(f"proprietor{i}_name")
            
            if row_dict.get(f"proprietor{i}_lat"):
                total_prop_geolocated += 1
            elif prop_name:   # not always four props!
                total_prop_not_geolocated += 1
             
            for j in range(1, 5):
                bo_name = row_dict.get(f"proprietor{i}_BO{j}_name")
                
                # normally not four BOs:
                if not bo_name:
                    continue
                
                if row_dict.get(f"proprietor{i}_BO{j}_latlon"):
                    totol_bo_geolocated += 1
                else:
                    totol_bo_not_geolocated += 1
                    # print(row_dict.get(f"proprietor{i}_BO{j}_address"))
                
                
                kind_col_name = f"proprietor{i}_BO{j}_kind"
                bo_kind = row_dict.get(kind_col_name)
                if bo_kind:
                    bo_kind = bo_kind.strip()
                    bo_type_counts[bo_kind] = bo_type_counts.get(bo_kind, 0) + 1
                        
                sanctioned_col_name = f"proprietor{i}_BO{j}_is_sanctioned"
                bo_sanctioned = row_dict.get(sanctioned_col_name)
                if bo_sanctioned and bo_sanctioned != "0":
                    has_sanctioned = True
                    
                status_col = f"proprietor{i}_BO{j}_reg_status"
                status = row_dict.get(status_col)
                
                
                if status == "suspect" and "trust" in bo_name.lower():
                    bo_status_counts["trust"] = bo_status_counts.get("trust", 0) + 1

                elif status:
                    bo_status_counts[status] = bo_status_counts.get(status, 0) + 1
                else:
                    pass
                    # bo_status_counts["None"] = bo_status_counts.get("None", 0) + 1
                    
                if status == "suspect" and "trust" not in bo_name.lower():
                    # print(f"{prop_name}: {bo_name}")
                    has_suspect = True
                    
        
        if has_suspect:
            properties_with_suspect += 1
            
        if has_sanctioned:
            properties_with_sanctioned += 1

    conn.close()
    
    print("Columns:") 
    print(", ".join(col_names))
    
    print("")
    
    

    print(f"\nTotal properties: {total_properties:,}\n")
    print("Beneficial Owner type counts:")
    total = 0
    for bo_type, count in bo_type_counts.items():
        print(f"  {bo_type}: {count:,}")
        total += count
        
    print("----------")
    print(f"TOTAL: {total:,}")
    
    # this is only if the status flag is being used. At present it isn't.
    """
    print("\nBeneficial Owner status counts:")
    total = 0
    for status, count in bo_status_counts.items():
        total += count
        print(f"  {status}: {count:,}")
    
    print("----------")
    print(f"TOTAL: {total:,}")
    
    
    
    print("\nGeocoding status:")
    for status, count in geo_status.items(): 
        print(f"  {status}: {count:,}")
    """
    
    
    print(f"\n{total_properties:,} properties, of which {properties_geolocated:,} geolocated")
    print(f"{total_prop_geolocated:,} proprietors geolocated; {total_prop_not_geolocated:,} not.")
    print(f"{totol_bo_geolocated:,} BOs geolocated; {totol_bo_not_geolocated:,} not.")
    print("-" * 10)
    print(f"Remaining geolocations: {total_prop_not_geolocated+totol_bo_not_geolocated+total_properties-properties_geolocated:,}")
    print("-" * 10)
    print(f"\nTotal number of properties with at least one sanctioned beneficial owner: {properties_with_sanctioned}")
    
    print(f"\nTotal number of properties with at least one suspect beneficial owner: {properties_with_suspect}")
    
if __name__ == "__main__":
    main()
