Overseas Entities data pipeline (steps 1-7)

Overview
- This folder contains the end-to-end pipeline for building the Register of Overseas Entities dataset, 
linking to Companies House data and other datasets, and exporting assets for the webapp and charts.
- Configuration lives in data_creator/companies_house_settings.py (current DB path, current CSV, old DB for reuse, API keys loaded from environment).
- Most scripts read/write the SQLite DB pointed to by current_db_file and expect the ROE CSV at current_overseas_entity_list_file.

Prereqs
- Ensure .env is present with the required keys used in companies_house_settings.py (Companies House, Google geocoding, Gemini, etc.).
- Ensure the CSV file referenced by current_overseas_entity_list_file exists in data/.
- If reusing geocodes from a prior run, set old_db_file in companies_house_settings.py and ensure it exists. Avoids re-geocoding addresses present in the last db.

Step 1: Create a fresh database from the ROE CSV
- Script: roe_1_create_database.py
- Purpose: create a new SQLite DB, build schema, and load the ROE CSV into the entities table.
- Inputs: data/OCOD_FULL_YYYY_MM.csv (current_overseas_entity_list_file)
- Output: data/overseas_entities_*.db (current_db_file)
- Notes: this must start from scratch because BO data can change without CH notifying updates.

Step 1b (Add property type from price paid data
- Script: roe_1b_add_property_type.py
- Purpose: backfill property_type using price-paid data matched by address + postcode + price.
- Input: data/pp-complete.csv (PRICE_PAID_CSV)
- Output: property_type column populated in current_db_file.
- note pp-complete.csv is ENORMOUS so you will probably want to delete it when this step is finished

Step 2: Find beneficial owners (Companies House)
- Script: roe_2_find_BOs.py
- Purpose: look up each proprietor via Companies House, attach proprietor address and BO list, and populate:
  - proprietor{i}_address, proprietor{i}_number
  - proprietor{i}_BO{j}_address, is_sanctioned, natures_of_control
  - proprietor{i}_BO_failure and status fields
- Inputs: Companies House API (rate-limited via companies_house_settings.py)
- Output: enriched BO and proprietor data in current_db_file
- Notes: supports targeted runs (TITLES_TO_CHECK, COMPANIES_TO_CHECK) and a DRY_RUN flag.
- This is exceptionally slow - expect 24 hours or more given Companies House rate limits

Step 2a : Add missing proprietor addresses from the ROE CSV
- Script: roe_2a_add_missing_addresses.py
- Purpose: for proprietors not found on Companies House, use ROE CSV addresses as a fallback.

Step 2b (required for export): Build "natures of control" map for the webapp
- Script: roe_2b_find_all_natures_of_control.py
- Purpose: collect all control codes found in the DB, map them to descriptions/icons, and output a compact JSON map.
- Inputs: data_creator/psc_descriptions.yml
- Output: webapp/overseas_entities_map_control_types.json

Step 3: Reuse and clean geocodes
- Script: roe_3a_geolocate_from_old_db.py
  - Purpose: copy lat/lon from old_db_file where addresses match, to avoid re-geocoding.
- Script: roe_3b_identify_wrong_geocodes.py
  - Purpose: detect non-UK proprietors geocoded inside the UK and clear bad lat/lon where appropriate.

Step 4: Geolocate missing addresses (increasingly expensive fallbacks)
- Script: roe_4a_google_geolocate.py
  - Purpose: fill missing lat/lon using Google Maps API. Can be costly; includes safe flags to avoid overwrites.
- Script: roe_4b_ai_geolocate.py
  - Purpose: fill remaining unknowns using Gemini for a best-guess lat/lon.
- Script: roe_4d_manual_corrections_for_geolocate_errors.py
  - Purpose: apply hand-curated fixes and remove untraceable titles.

Step 5: Categorise beneficial owners
- Script: roe_5_categorise_BOs.py
- Purpose: classify BOs into statuses such as individual, listed, government-owned, trustee, suspect, etc.
- Inputs: listing files in data/ (NYSE, NASDAQ, UK, global listings), manual exclusions, and Wikipedia scrape.
- Output: BO registration status fields written into current_db_file.

Step 6: Export for webapp
- Script: roe_6_export_for_webapp.py
- Purpose: build compact property/proprietor datasets and stats for the UI.
- Outputs:
  - webapp/overseas_entities_properties.<hash>.msgpack
  - webapp/overseas_entities_proprietors.<hash>.msgpack
  - webapp/overseas_entities_data_info.txt (size + hash + dataset period)
  - webapp/overseas_entities_stats.csv
  - webapp/overseas_entities_top_BOs.csv
  - webapp/unregistered_proprietors.csv
  - webapp/top_trustees.csv
- Notes: uses webapp/overseas_entities_map_control_types.json from step 2b.

Step 7: Generate charts
- Script: roe_7_stats_charting.py
- Purpose: read the stats CSV and build JSON charts/treemaps for the site.
- Outputs: charts/*.json (and any other chart assets configured in the script)

Utilities (not part of steps 1-7)
- utils_show_db_status.py, utils_check_db_entry.py: quick DB inspection tools.
- d1_auth_stats.py: Cloudflare D1-related stats tooling. Part of our login security to comply with HM Land Registry licence.
If you are using this repo for private use then you won't need to worry about that
- suspect_entities.txt, psc_descriptions.yml, words_to_ignore_in_names.txt: data inputs used by the pipeline.

Typical run order (high level)
1) roe_1_create_database.py
2) roe_1b_add_property_type.py
3) roe_2_find_BOs.py
4) roe_2a_add_missing_addresses.py (if needed)
5) roe_2b_find_all_natures_of_control.py
6) roe_3a_geolocate_from_old_db.py (if old DB exists)
7) roe_3b_identify_wrong_geocodes.py
8) roe_4a_google_geolocate.py
9) roe_4b_ai_geolocate.py
10) roe_4d_manual_corrections_for_geolocate_errors.py
11) roe_5_categorise_BOs.py
12) roe_6_export_for_webapp.py
13) roe_7_stats_charting.py

Then use utils_show_db_status.py as you go to see how the database is going

And utils_check_db_entry.py if you want to check out a particular title
