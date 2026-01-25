import sqlite3
import json
import msgpack
from datetime import datetime
import re
import csv
import ast
import yaml
import collections
from pathlib import Path
import hashlib
import glob
from calendar import month_name
from typing import Any, cast

from companies_house_settings import current_db_file, current_overseas_entity_list_file
from roe_common_functions import is_within_uk, upload_all_files, normalise_text


# --- Configuration ---
# grey: can't find proprietor on Companies House
# purple: sanctioned - has priority!
# red: suspect BO OR address geolocation failed
# orange: no beneficial owner identified
# blue: beneficiary suspected to be trust/fiduciary/nominee 
# green: ok
# blue: proprietor suspected to be trust/fiduciary/nominee

output_json_path = "webapp/overseas_entities.json"  # legacy path (unused by webapp after split)
PROPERTIES_JSON_BASENAME = "overseas_entities_properties"
PROPRIETORS_JSON_BASENAME = "overseas_entities_proprietors"
WEBAPP_DIR = Path("webapp")
DATA_CREATOR_DIR = Path("data_creator")
CSV_BO_OUTPUT_FILE = "webapp/overseas_entities_top_BOs.csv"
NUMBER_BOs_TO_EXPORT = 500
stats_csv_path = "webapp/overseas_entities_stats.csv"
SUSPECT_ENTITY_FILE = 'data_creator/suspect_entities.txt'
UNREGISTERED_PROPRIETORS_CSV = "webapp/unregistered_proprietors.csv"
TOP_TRUSTEES_CSV = "webapp/top_trustees.csv"

DESCRIPTION_YML = "data_creator/psc_descriptions.yml"
MANUAL_EXCLUSIONS_FILE = "data/manual_exclusions.txt"

TRUST_KEYWORDS = ("trust", "fiduciary", "fiduciaries", "nominee", "trustees", "nominees", "ptc", "corporate services", "foundation", "stiftung", "anstalt")



# this is the part of "natures of control" which shows someone is registered as a BO because they are a trustee
# see https://github.com/companieshouse/api-enumerations/blob/master/psc_descriptions.yml

# --- Helper Functions ---

# Short-key schema for the webapp JSON (Phase 2 size reduction)
# These mappings are applied only at export time; internal logic uses long keys.
# !!DO NOT CHANGE WITHOUT ALSO CHANGING THE WEBAPP!!
LONG2SHORT_PROP = {
    "property_title_number": "t",    # Title number
    # tenure is encoded as a compact boolean 'fh' (1=Freehold, 0=Leasehold)
    "property_uk_address": "ad",     # Address
    "price_paid": "pr",              # Price paid
    "date_added": "dt",              # Date added
    "property_type": "pt",           # Property type
    "lat": "lat",
    "lon": "lon",
    "status": "st",                  # Property colour/status
}

LONG2SHORT_PROP_LISTS = {
    "props": "ps",                    # Proprietors list
}

LONG2SHORT_PROPRIETOR = {
    "name": "n",
    "address": "a",
    "lat": "lat",
    "lon": "lon",
    "country_incorporated": "ci",
    "ch_number": "ch",
    "count": "c",
    "wrong_address": "wa",
    "BO_failure": "bf",
    "trustee": "tr",
    "excluded": "ex",
    "status": "st",
    "has_individual_non_trustee": "hin",
    "has_suspect_bo": "hsb",
    "has_sanctioned_bo": "hsan",
}

LONG2SHORT_PROPRIETOR_LISTS = {
    "BOs": "bs",
}

LONG2SHORT_BO = {
    "name": "n",
    "address": "a",
    "lat": "lat",
    "lon": "lon",
    "reg_status": "rs",
    "kind": "k",
    "count": "c",
    "control": "ctrl",
    "sanctioned": "san",
}

# Property type analysis uses a fixed set of columns; unknowns are not allowed.
PROPERTY_TYPE_COLUMNS = ["D", "S", "T", "F", "O", "null"]

STATUS_TO_PROPERTY_CATEGORY = {
    "grey": "proprietor_not_found",
    "orange": "no_bo",
    "red": "suspect_bo",
    "blue": "only_trustee",
    "green": "fine",
}

# Shorten certain reg_status values
REG_STATUS_TO_SHORT = {
    "suspect": "sus",
    "individual": "ind",
}


def determine_dataset_period(source_path: str) -> str | None:
    """Extract a human-readable month/year label from the current data file name."""
    try:
        filename = Path(source_path).name
    except Exception:
        filename = str(source_path)

    match = re.search(r"_(20\d{2})_(\d{2})", filename)
    if not match:
        return None

    year = int(match.group(1))
    month_index = int(match.group(2))
    if 1 <= month_index <= 12:
        return f"{month_name[month_index]} {year}"
    return None


def _load_and_normalise_text_file(filepath: str) -> list[str]:
    """Load one item per line and normalise using shared normalise_text() helper."""
    items: list[str] = []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                items.append(normalise_text(line))
    except FileNotFoundError:
        print(f"Warning: File not found: {filepath}")
    return items

# Beneficial owner kind → compact numeric ID mapping (strict)
# If a new kind appears in the database, the exporter will raise with details.
BO_KIND_TO_ID: dict[str, int] = {
    "individual-beneficial-owner": 1,
    "corporate-entity-beneficial-owner": 2,
    "legal-person-beneficial-owner": 3,
    "super-secure-beneficial-owner": 4,
    "super-secure-person-with-significant-control": 5,
    "corporate-entity-person-with-significant-control": 6,
}

NON_CEASED_STRINGS = {"", "0", "false", "no", "none", "null"}


def parse_price_to_int(value: Any) -> int:
    """Best-effort conversion of a price string/number into an integer amount of pounds."""
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)

    s = str(value).strip()
    if not s:
        return 0

    # Remove common currency adornments then parse via float to tolerate decimals
    cleaned = (s.replace("GBP", "").replace("gbp", "")).strip()
    cleaned = re.sub(r"[^0-9.\-]", "", cleaned)

    try:
        return int(float(cleaned))
    except (ValueError, TypeError):
        return 0

def normalize_property_type(value: Any) -> str:
    if value is None:
        return "null"
    s = str(value).strip().upper()
    if not s:
        return "null"
    if s in {"D", "S", "T", "F", "O"}:
        return s
    raise ValueError(f"Unexpected property_type '{value}' encountered during export")

def is_ceased_value(value: Any) -> bool:
    """
    Return True if the value indicates a ceased BO (dates, non-zero, or truthy).
    """
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    s = str(value).strip().lower()
    if s in NON_CEASED_STRINGS:
        return False
    return s != ""

def _compress_property_record(p: dict, control_long_to_id: dict[str, int] | None = None) -> dict:
    """Return a compressed, short-key version of a single property record."""
    out: dict = {}
    # Scalar fields (coerce lat/lon and price to numeric where possible)
    for long_k, short_k in LONG2SHORT_PROP.items():
        if long_k in p:
            val = p[long_k]
            if long_k == "property_type" and (val is None or str(val).strip() == ""):
                # Skip null/empty property type to keep JSON compact.
                continue
            if long_k in ("lat", "lon"):
                try:
                    if val is not None and val != "":
                        val = float(val)
                except (ValueError, TypeError):
                    val = None
            elif long_k == "price_paid":
                try:
                    if val is not None and val != "":
                        # remove commas/whitespace, then parse
                        sval = str(val).replace(",", "").strip()
                        val = int(float(sval))
                except (ValueError, TypeError):
                    # keep original if unparsable; UI can still render
                    pass
            out[short_k] = val

    # Encode tenure as a compact boolean flag: fh (1=Freehold, 0=Leasehold)
    tenure = p.get("property_tenure")
    if tenure is not None:
        norm = str(tenure).strip().upper()
        if norm not in {"FREEHOLD", "LEASEHOLD"}:
            raise ValueError(f"Unexpected property_tenure '{tenure}' when compressing JSON")
        out["fh"] = 1 if norm == "FREEHOLD" else 0

    # In split mode, we do not embed proprietors here. The caller will attach 'ps' to pids.
    return out

def _load_control_long_to_id_map(control_json_path: str = "webapp/overseas_entities_map_control_types.json") -> dict[str, int] | None:
    try:
        with open(control_json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        ids = data.get("_ids")
        if not isinstance(ids, dict):
            return None
        # Build reverse mapping: long -> int(id)
        return {long_code: int(id_str) for id_str, long_code in ids.items()}
    except Exception:
        return None

def compress_properties(properties: list[dict]) -> list[dict]:
    """Convert the full property list to a short-key schema for export."""
    control_map = _load_control_long_to_id_map()
    return [_compress_property_record(p, control_map) for p in properties]


def _compress_proprietor(prop: dict, control_map: dict[str, int] | None) -> dict:
    sp: dict = {}
    for long_k, short_k in LONG2SHORT_PROPRIETOR.items():
        if long_k in prop:
            val = prop[long_k]
            if long_k in ("lat", "lon"):
                try:
                    if val is not None and val != "":
                        val = float(val)
                except (ValueError, TypeError):
                    val = None
            sp[short_k] = val

    short_bos: list[dict] = []
    for bo in prop.get("BOs", []) or []:
        sb: dict = {}
        for long_k, short_k in LONG2SHORT_BO.items():
            if long_k in bo:
                val = bo[long_k]
                if long_k in ("lat", "lon"):
                    try:
                        if val is not None and val != "":
                            val = float(val)
                    except (ValueError, TypeError):
                        val = None
                if long_k == "reg_status":
                    val = REG_STATUS_TO_SHORT.get(str(val), val)
                elif long_k == "kind":
                    # Map to compact numeric ID; enforce strict known set
                    if val is None or str(val).strip() == "":
                        # Omit empty kind to save space
                        continue
                    sval = str(val).strip()
                    if sval not in BO_KIND_TO_ID:
                        allowed = ", ".join(sorted(BO_KIND_TO_ID.keys()))
                        raise ValueError(
                            f"Unknown BO kind encountered during export: '{sval}'. Allowed kinds: {allowed}"
                        )
                    val = BO_KIND_TO_ID[sval]
                elif long_k == "control" and isinstance(val, list) and control_map:
                    mapped = []
                    for item in val:
                        if isinstance(item, str) and item in control_map:
                            mapped.append(control_map[item])
                        elif item is not None:
                            mapped.append(item)
                    val = mapped
                sb[short_k] = val
        short_bos.append(sb)
    if short_bos:
        sp[LONG2SHORT_PROPRIETOR_LISTS["BOs"]] = short_bos
    return sp


def split_and_compress(properties: list[dict]) -> tuple[list[dict], dict[int, dict]]:
    """
    Produce two datasets:
      - properties_short: list of short-key properties with 'ps' = list of proprietor IDs
      - proprietors_short: dict of {pid: short-key proprietor}
    """
    control_map = _load_control_long_to_id_map()
    proprietors_dict: dict[int, dict] = {}
    propkey_to_pid: dict[str, int] = {}
    next_pid = 0

    properties_out: list[dict] = []

    for p in properties:
        # Compress scalar fields of the property
        cp = _compress_property_record(p, control_map)

        # Build ps as list of proprietor IDs corresponding to this property
        pids: list[int] = []
        for prop in p.get("props", []) or []:
            name = (prop.get("name") or "").strip().lower()
            ch = (prop.get("ch_number") or "").strip().lower()
            key = f"{name}||{ch}"
            pid = propkey_to_pid.get(key)
            if pid is None:
                pid = next_pid
                next_pid += 1
                propkey_to_pid[key] = pid
                proprietors_dict[pid] = _compress_proprietor(prop, control_map)
            pids.append(pid)

        cp[LONG2SHORT_PROP_LISTS["props"]] = pids
        properties_out.append(cp)

    return properties_out, proprietors_dict


# returns a list of the natures of control that indicate someone is a mere trustee
def return_trustee_natures_of_control():
    
    def _load_natures_control_long_descriptions_yml(yml_path: str = DESCRIPTION_YML) -> dict:
        """
        Loads the short_description section from the YAML into a dict {code: text}.
        """
        try:
            with open(yml_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            if not (data and isinstance(data.get("description"), dict)):
                raise ValueError("'description' section missing or not a dict")
            return data["description"]
        except FileNotFoundError:
            print(f"Error: YAML not found at {yml_path}")
            raise
        except yaml.YAMLError as e:
            print(f"Error parsing YAML: {e}")
            raise
    
    natures = _load_natures_control_long_descriptions_yml()
    
    trustee_natures = []
    
    for key, value in natures.items():
        if "is a trustee" in value:
            trustee_natures.append(key)
            
    return trustee_natures

# Geospatial helpers handled by roe_common_functions.is_within_uk


def contains_trust_keyword(name: str) -> bool:
    """Checks if a name contains any of the globally defined trust keywords."""
    if not name:
        return False
    return any(keyword in name.lower() for keyword in TRUST_KEYWORDS)

def parse_latlon(latlon_str):
    """Convert a comma-separated latlon string into a (lat, lon) tuple of floats."""
    if latlon_str:
        try:
            # This handles potential parentheses from the previous script's output
            lat_str, lon_str = latlon_str.strip("()").split(',')
            return float(lat_str.strip()), float(lon_str.strip())
        except (ValueError, IndexError):
            return None, None
    return None, None

import sqlite3

def normalize_country(raw_country: str | None) -> str | None:
    """
    Normalise a 'country of incorporation' string from Companies House data.

    Note: This corrects known data quality issues in the official data. We make
    a best‑effort mapping to improve analytics, while preserving distinct
    jurisdictions (e.g. Jersey, Guernsey, Isle of Man, Dutch Antilles).

    Returns a canonical uppercase country name, or None to exclude from
    country‑level statistics.
    """
    if not raw_country:
        return None
    s = str(raw_country).strip().upper()
    if not s:
        return None

    # Normalise whitespace
    s = re.sub(r"\s+", " ", s)

    # Drop supranational/misc non-countries
    if s in {
        "PART VII OF THE CHARITIES ACT 1993",
    }:
        return None
    if s.startswith("THE EUROPEAN UNION") or s == "EUROPEAN UNION":
        return None
    if s == "THE WEST INDIES":
        return None

    # Direct corrections and variants
    direct_map = {
        "THE ISLAND OF NIUE": "NIUE",
        "NUIE": "NIUE",
        "MACAO": "MACAU",
        "SAMAO": "SAMOA",
        "WESTERN SAMOA": "SAMOA",
        "THE GAMBIA": "GAMBIA",
        "UNITED REPUBLIC OF TANZANIA": "TANZANIA",
        "THE REPUBLIC OF LIBE RIA": "LIBERIA",
        "CHANNEL ISLANDS": "JERSEY",
        "THE VIRGIN ISLANDS": "BRITISH VIRGIN ISLANDS",
        # Cities/regions commonly appearing as countries
        "BREDA": "NETHERLANDS",
        "HAMBURG": "GERMANY",
        "CHONBURI": "THAILAND",
        "TENERIFE": "SPAIN",
        "ROVEREDO GR": "SWITZERLAND",
        # UAE emirates and free zones
        "ABU DHABI": "UNITED ARAB EMIRATES",
        "AJMAN": "UNITED ARAB EMIRATES",
        "DUBAI": "UNITED ARAB EMIRATES",
        "FUJAIRAH": "UNITED ARAB EMIRATES",
        "RAS AL KHAIMAH": "UNITED ARAB EMIRATES",
        "SHARJAH": "UNITED ARAB EMIRATES",
        "AJMAN FREE ZONE": "UNITED ARAB EMIRATES",
        "JEBEL ALI FREE ZONE": "UNITED ARAB EMIRATES",
        "RAS AL KHAIMAH FREE TRADE ZONE": "UNITED ARAB EMIRATES",
        # Malaysia regions
        "LABUAN, MALAYSIA": "MALAYSIA",
        "PENANG": "MALAYSIA",
    }
    if s in direct_map:
        return direct_map[s]

    # Korea variants: assume ambiguous "KOREA" is South; keep NORTH KOREA as-is
    if s in {"REPUBLIC OF KOREA", "THE REPUBLIC OF KOREA", "SOUTH KOREA", "KOREA"}:
        return "SOUTH KOREA"

    # Fold subnational regions to country: USA and Canada patterns
    if re.search(r",\s*U\.S\.A\.$", s) or re.search(r",\s*USA$", s):
        return "U.S.A."
    if re.search(r",\s*CANADA$", s):
        return "CANADA"

    # Keep Dutch Antilles separate per requirement
    # Keep North Cyprus separate

    return s

def precompute_entity_counts(cursor: sqlite3.Cursor) -> tuple[dict, dict]:
    """
    Pre-computes the appearance counts for all proprietors and beneficial owners
    in a case-insensitive manner.

    This function queries the database directly to count occurrences, which is
    significantly faster than iterating through the dataset in Python.

    Args:
        cursor: An active sqlite3.Cursor object connected to the database.

    Returns:
        A tuple containing two dictionaries:
        - proprietor_counts: {proprietor_name: count}
        - bo_counts: {bo_name: count}
    """
    print("Pre-computing proprietor and BO counts (case-insensitive) from the database...")

    # --- Proprietor Counts (Case-Insensitive) ---
    proprietor_sql = """
        -- CORRECTED: LOWER() is now in the outer query for both SELECT and GROUP BY
        SELECT LOWER(name) AS name, COUNT(*) as count FROM (
            SELECT proprietor1_name AS name FROM entities WHERE proprietor1_name IS NOT NULL UNION ALL
            SELECT proprietor2_name AS name FROM entities WHERE proprietor2_name IS NOT NULL UNION ALL
            SELECT proprietor3_name AS name FROM entities WHERE proprietor3_name IS NOT NULL UNION ALL
            SELECT proprietor4_name AS name FROM entities WHERE proprietor4_name IS NOT NULL
        ) GROUP BY LOWER(name)
    """
    cursor.execute(proprietor_sql)
    proprietor_counts = {row['name']: row['count'] for row in cursor.fetchall()}
    print(f"Found {len(proprietor_counts):,} unique proprietors.")

    # --- Beneficial Owner Counts (Case-Insensitive) ---
    bo_pairs = [
        (f'"proprietor{p}_BO{bo}_name"', f'"proprietor{p}_BO{bo}_ceased"')
        for p in range(1, 5) for bo in range(1, 5)
    ]
    not_ceased_values_sql = ", ".join(f"'{val}'" for val in sorted(NON_CEASED_STRINGS))

    def not_ceased_condition(col: str) -> str:
        return f"({col} IS NULL OR TRIM(LOWER({col})) IN ({not_ceased_values_sql}))"

    # The subquery now just collects active (non-ceased) BO names
    union_all_bo_query = " UNION ALL ".join(
        f"SELECT {name_col} AS name FROM entities "
        f"WHERE {name_col} IS NOT NULL AND {not_ceased_condition(ceased_col)}"
        for name_col, ceased_col in bo_pairs
    )

    # CORRECTED: The main query now handles the case conversion and grouping
    bo_sql = f"""
        SELECT LOWER(name) AS name, COUNT(*) as count 
        FROM ({union_all_bo_query}) 
        GROUP BY LOWER(name)
    """
    
    cursor.execute(bo_sql)
    bo_counts = {row['name']: row['count'] for row in cursor.fetchall()}
    print(f"Found {len(bo_counts):,} unique beneficial owners.")
    print("Counts pre-computed.")

    return proprietor_counts, bo_counts


# --- Main Data Extraction Logic ---

# Extracts rows from the DB, builds the webapp JSON payload, and writes summary CSV stats
def extract_data(current_db_file, output_json_path):
    conn = sqlite3.connect(current_db_file)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    
    # Ensure the date_added column exists before proceeding
    cur.execute("PRAGMA table_info(entities)")
    columns = [row['name'] for row in cur.fetchall()]
    if 'date_added' not in columns:
        print("Error: 'date_added' column not found in the database. Cannot perform yearly analysis.")
        # As a fallback, we can add it for demonstration purposes.
        # In a real scenario, you'd want to investigate why it's missing.
        print("Adding a dummy 'date_added' column for this run.")
        cur.execute("ALTER TABLE entities ADD COLUMN date_added TEXT")
        cur.execute("UPDATE entities SET date_added = '01-01-2023'") # Default to 2023
        conn.commit()


    cur.execute("SELECT * FROM entities")
    rows = cur.fetchall()
    
    col_names = [desc[0] for desc in cur.description]
    total_rows = len(rows)
    print(f"Found {total_rows} records to process.")
    
    trustee_natures_of_control = return_trustee_natures_of_control()

    # Load manual exclusions (normalised) to avoid flagging exempt proprietors as grey
    manual_exclusions_set = set(_load_and_normalise_text_file(MANUAL_EXCLUSIONS_FILE))

    properties = []
    
    # now pre-compute counts of beneficiaries and proprietors
    proprietor_counts, bo_counts = precompute_entity_counts(cur)
        
    
    color_totals = {
        "green": 0,
        "grey": 0,
        "red": 0,
        "blue": 0,
        "orange": 0,
        "purple": 0
        
    }

    # Use a single dictionary to hold all overall counts (now proprietor-based for CSV)
    overall_counts = collections.defaultdict(int)
    total_proprietors = 0
    
    country_stats = collections.defaultdict(lambda: collections.defaultdict(int))
    country_value_stats = collections.defaultdict(lambda: collections.defaultdict(int))
    category_value_entry_counts = collections.defaultdict(int)

    property_type_stats = {
        "total": collections.defaultdict(int),
        "proprietor_not_found": collections.defaultdict(int),
        "no_bo": collections.defaultdict(int),
        "suspect_bo": collections.defaultdict(int),
        "only_trustee": collections.defaultdict(int),
        "fine": collections.defaultdict(int),
    }
    

    # --- Initialize data structure for yearly analysis ---
    years = ["up_to_2022", "2023", "2024", "2025", "unknown"]
    yearly_stats = {
        year: {
            "total": 0, 
            "proprietor_not_found": 0, 
            "no_bo": 0, 
            "only_trustee": 0, 
            "suspect_bo": 0, 
            "suspect_trust_proprietor": 0, 
            "fine": 0
        } for year in years
    }

    suspect_entities = []
    beneficial_owner_counts = {}
    # Track proprietors with BO_failure == "No company found"
    unregistered_proprietors = {}
    trustee_hidden_property_titles = collections.defaultdict(set)
    trustee_with_bo_property_titles = collections.defaultdict(set)
    trustee_display_names: dict[str, str] = {}
    skipped_ceased_bos = 0
    
    print("Now processing database")
    for index, database_row in enumerate(rows):
        
        row = dict(zip(col_names, database_row))
        
        status = "green"
        address_geolocate_failed = False
        proprietor_is_suspect_trust = False 
        bo_is_suspect = False
        proprietor_not_found_for_this_property = False
        no_bo = False
        
        # let's tidy the property address and postcode
        property_uk_address = row.get('property_uk_address')
        property_uk_postcode = row.get('property_uk_postcode')
        
        if property_uk_address:
            property_uk_address = property_uk_address.removesuffix(" None")
        
            if property_uk_postcode:
                if property_uk_postcode.lower() not in property_uk_address.lower():
                    property_uk_address += f", {property_uk_postcode.upper()}"
                else:
                    pc = property_uk_postcode.upper()
                    pattern = re.escape(property_uk_postcode)
                    # this will match:
                    #  • optional “,” + whitespace before
                    #  • then either “(postcode)” or postcode alone
                    # and replace with “, POSTCODE”
                    property_uk_address = re.sub(
                        fr"(?:,\s*)?\(\s*{pattern}\s*\)|(?:,\s*)?{pattern}",
                        f", {pc}",
                        property_uk_address,
                        flags=re.IGNORECASE
                    )
                    
                    property_uk_address = property_uk_address.replace(" ,", ",")
                    
                    
        elif property_uk_postcode:
            property_uk_address = property_uk_postcode.upper()
            
        else:
            property_uk_address = "UNKNOWN"
        
        # Validate tenure strictly: only Freehold or Leasehold allowed
        tenure_raw = row.get("property_tenure")
        tenure_norm = str(tenure_raw).strip().upper() if tenure_raw is not None else ""
        if tenure_norm not in {"FREEHOLD", "LEASEHOLD"}:
            raise ValueError(
                f"Unexpected property_tenure '{tenure_raw}' for title {row.get('property_title_number')}"
            )

        price_paid_value = parse_price_to_int(row.get("property_price_paid"))

        property_dict = {
            "property_title_number": row["property_title_number"],
            "property_tenure": row["property_tenure"],
            "property_uk_address": property_uk_address,
            "price_paid": row["property_price_paid"],
            "date_added": row["date_added"],
            "property_type": row.get("property_type"),
            "lat": row["property_lat"],
            "lon": row["property_lon"],
            "props": []
        }
        
        # Determine year category early (used for proprietor-based CSV stats)
        year_key = "unknown"
        date_str = row.get("date_added")
        if date_str:
            try:
                year = datetime.strptime(date_str, "%d-%m-%Y").year
                if year <= 2022: year_key = "up_to_2022"
                elif year == 2023: year_key = "2023"
                elif year == 2024: year_key = "2024"
                elif year == 2025: year_key = "2025"
            except (ValueError, TypeError):
                pass # Stays as 'unknown'
        
        at_least_one_trustee_controller = False
        at_least_one_non_trustee_controller = False
        property_all_props_have_individual_non_trustee = True
        for p in range(1, 5):
            pname = row.get(f"proprietor{p}_name")
            if pname:
                p_address = row.get(f"proprietor{p}_address")
                p_lat = row.get(f"proprietor{p}_lat")
                p_lon = row.get(f"proprietor{p}_lon")
                
                proprietor = {
                    "name": pname,
                    "address": p_address or "Proprietor not on Companies House",
                    "lat": p_lat, "lon": p_lon, "BOs": [],
                    "country_incorporated": row.get(f"proprietor{p}_country_incorporated"),
                    # company number exported only when known (added below)
                    "count": proprietor_counts.get(pname.lower(), 0),
                }

                # Mark proprietor as excluded if present in manual exclusions (used to suppress UI badges)
                is_excluded_name = normalise_text(pname) in manual_exclusions_set
                if is_excluded_name:
                    proprietor["excluded"] = True

                # Attach Companies House company number if present (from roe_2_find_BOs.py)
                num = row.get(f"proprietor{p}_number")
                if num is not None and str(num).strip() != "":
                    proprietor["ch_number"] = str(num).strip()

                # Initialise per-proprietor classification flags
                p_at_least_one_trustee_controller = False
                p_at_least_one_non_trustee_controller = False
                p_has_individual_non_trustee = False
                p_has_suspect_bo = False
                p_has_sanctioned_bo = False
                p_no_bo = False
                p_not_found = False
                trustee_bos_for_proprietor: set[str] = set()
                active_bos_count = 0

                if p_address and (p_lat is None or p_lon is None):
                    address_geolocate_failed = True
                    
                else:
                    # check if proprietor's address is in UK.
                    if is_within_uk(p_lat, p_lon): # type: ignore
                        proprietor["wrong_address"] = True

                
                
                bo_failure_val = row.get(f"proprietor{p}_BO_failure")
                if bo_failure_val is not None:
                    proprietor["BO_failure"] = bo_failure_val
                    # If the proprietor wasn't found on Companies House, only
                    # treat as 'grey' if NOT in our manual exclusions list.
                    if bo_failure_val == "No company found":
                        if is_excluded_name:
                            # Exempt from grey classification; keep BO_failure for transparency
                            proprietor["excluded"] = True
                        else:
                            proprietor_not_found_for_this_property = True
                            status = "grey"
                            # record proprietor for unregistered export (case-insensitive, keep first seen canonical)
                            lower_name = pname.lower()
                            if lower_name not in unregistered_proprietors:
                                unregistered_proprietors[lower_name] = pname
                            p_not_found = True
                    elif bo_failure_val == "No BO":
                        p_no_bo = True

                name_is_trust = contains_trust_keyword(pname)
                if name_is_trust:
                    proprietor_is_suspect_trust = True
                    proprietor["trustee"] = True
                    
                elif bo_failure_val == "No BO":
                    status = "orange"
                    no_bo = True
                    if pname not in suspect_entities:
                        suspect_entities.append(pname)
                    
                
                for bo in range(1, 5):
                    
                    bo_name = row.get(f"proprietor{p}_BO{bo}_name")
                    if bo_name:
                        bo_ceased = row.get(f"proprietor{p}_BO{bo}_ceased")
                        if is_ceased_value(bo_ceased):
                            skipped_ceased_bos += 1
                            continue
                        active_bos_count += 1
                        
                        bo_address = row.get(f"proprietor{p}_BO{bo}_address")
                        bo_lat, bo_lon = parse_latlon(row.get(f"proprietor{p}_BO{bo}_latlon"))

                        if bo_address and (bo_lat is None or bo_lon is None):
                            address_geolocate_failed = True
                        
                        reg_status = row.get(f"proprietor{p}_BO{bo}_reg_status")
                            
                        if reg_status == "suspect":
                            beneficial_owner_counts[bo_name] = beneficial_owner_counts.get(bo_name, 0) + 1
                            if bo_name not in suspect_entities:
                                suspect_entities.append(bo_name)
                            p_has_suspect_bo = True
                            
                        
                        beneficial_owner = {
                            "name": bo_name, "address": bo_address,
                            "lat": bo_lat, "lon": bo_lon, "reg_status": reg_status,
                            "kind": row.get(f"proprietor{p}_BO{bo}_kind"),
                            "count": bo_counts.get(bo_name.lower(), 0),
                        }
                        
                        trustee_control = False
                        non_trustee_control = False
                        natures_of_control_string = row.get(f"proprietor{p}_BO{bo}_natures_of_control")
                        if natures_of_control_string:
                            try:
                                natures_of_control = ast.literal_eval(natures_of_control_string)
                            except (ValueError, SyntaxError) as e:
                                raise RuntimeError(
                                    "Invalid natures_of_control for title "
                                    f"{row.get('property_title_number')} "
                                    f"(proprietor{p} BO{bo}): {natures_of_control_string!r}"
                                ) from e
                            
                            natures_of_control = [item for item in natures_of_control if item is not None]  # remove any Nones!
                            
                            beneficial_owner["control"] = natures_of_control
                            
                            trustee_control = any(s in trustee_natures_of_control for s in natures_of_control)
                            non_trustee_control = bool(natures_of_control) and all(
                                s not in trustee_natures_of_control for s in natures_of_control
                            )
                            
                            # if there is at least one specified nature of control then check what it is
                            if non_trustee_control:
                                at_least_one_non_trustee_controller = True
                                p_at_least_one_non_trustee_controller = True
                                proprietor_is_suspect_trust = False
                            elif trustee_control:
                                at_least_one_trustee_controller = True
                                p_at_least_one_trustee_controller = True

                            # Check for an individual non-trustee controller for this proprietor
                            bo_kind = row.get(f"proprietor{p}_BO{bo}_kind")
                            if non_trustee_control and bo_kind == "individual-beneficial-owner":
                                p_has_individual_non_trustee = True

                        if trustee_control:
                            name_clean = bo_name.strip()
                            if name_clean:
                                trustee_bos_for_proprietor.add(name_clean)
                        
                        if row.get(f"proprietor{p}_BO{bo}_is_sanctioned") == "1":
                            beneficial_owner["sanctioned"] = True
                            status = "purple"
                            p_has_sanctioned_bo = True
                
                        proprietor["BOs"].append(beneficial_owner)

                if active_bos_count == 0 and not p_not_found:
                    p_no_bo = True
                    if not name_is_trust:
                        status = "orange"
                        no_bo = True
                        if pname not in suspect_entities:
                            suspect_entities.append(pname)

                if trustee_bos_for_proprietor:
                    title_number = row.get("property_title_number")
                    if title_number:
                        for trustee_name in trustee_bos_for_proprietor:
                            key = trustee_name.lower()
                            if key not in trustee_display_names:
                                trustee_display_names[key] = trustee_name
                            if p_at_least_one_non_trustee_controller:
                                trustee_with_bo_property_titles[key].add(title_number)
                            else:
                                trustee_hidden_property_titles[key].add(title_number)
                property_dict["props"].append(proprietor)

                # Property-wide green condition requires every proprietor to have
                # an individual non-trustee controller
                if not p_has_individual_non_trustee:
                    property_all_props_have_individual_non_trustee = False

                # Proprietor-based CSV stats: classify and increment
                total_proprietors += 1
                if p_not_found:
                    prop_category_key = "proprietor_not_found"
                elif p_no_bo:
                    prop_category_key = "no_bo"
                elif (p_at_least_one_trustee_controller and not p_at_least_one_non_trustee_controller) or (name_is_trust and not p_at_least_one_non_trustee_controller):
                    prop_category_key = "only_trustee"
                elif p_has_individual_non_trustee:
                    prop_category_key = "fine"
                elif p_has_suspect_bo:
                    prop_category_key = "suspect_bo"
                else:
                    prop_category_key = "fine"

                # Attach per-proprietor summary fields to JSON
                proprietor["status"] = prop_category_key
                proprietor["has_individual_non_trustee"] = p_has_individual_non_trustee
                proprietor["has_suspect_bo"] = p_has_suspect_bo
                if p_has_sanctioned_bo:
                    proprietor["has_sanctioned_bo"] = True

                overall_counts[prop_category_key] += 1
                yearly_stats[year_key][prop_category_key] += 1
                yearly_stats[year_key]["total"] += 1
                p_country_raw = row.get(f"proprietor{p}_country_incorporated")
                p_country = normalize_country(p_country_raw)
                if p_country:
                    country_stats[p_country][prop_category_key] += 1
                    if price_paid_value:
                        country_value_stats[p_country][prop_category_key] += price_paid_value
                        category_value_entry_counts[prop_category_key] += 1
        
        # done doing through proprietors and beneficial owners. Now apply a colour status to the property
        
        # we prioritise cases where we've identified as grey, red or purple
        if status not in ("grey", "red", "purple"):
            if address_geolocate_failed:
                status = "red"
            else:
                for prop in property_dict["props"]: 
                    for bo in prop["BOs"]:
                        if bo.get("reg_status") == "suspect":
                            bo_is_suspect = True
                
                # New green rule: EVERY proprietor must have an individual non-trustee controller
                if property_all_props_have_individual_non_trustee:
                    status = "green"
                # Otherwise prioritise trustee-only blue before suspect red
                elif at_least_one_trustee_controller and (not at_least_one_non_trustee_controller):
                    status = "blue" 
                elif proprietor_is_suspect_trust and (not at_least_one_non_trustee_controller):
                    status = "blue"
                elif bo_is_suspect:
                    status = "red" 
              
        
        property_dict["status"] = status
        properties.append(property_dict)
        color_totals[status] += 1

        if status != "purple":
            property_type_key = normalize_property_type(row.get("property_type"))
            if status not in STATUS_TO_PROPERTY_CATEGORY:
                raise ValueError(
                    f"Unexpected property status '{status}' for title {row.get('property_title_number')}"
                )
            property_type_stats["total"][property_type_key] += 1
            property_type_stats[STATUS_TO_PROPERTY_CATEGORY[status]][property_type_key] += 1
        
        if (index + 1) % 1000 == 0:
            print(f"Processing row {index + 1} of {total_rows} ({(index + 1)/total_rows:.1%})")
        
    # Write split datasets: properties index + proprietors dictionary with cache-busting hash
    properties_short, proprietors_short = split_and_compress(properties)

    # Serialize to msgpack bytes for hashing (webapp data payload)
    props_msgpack = cast(bytes, msgpack.packb(properties_short, use_bin_type=True))
    owners_msgpack = cast(bytes, msgpack.packb(proprietors_short, use_bin_type=True))
    combined_bytes = props_msgpack + b"\n" + owners_msgpack
    sha = hashlib.sha256(combined_bytes).hexdigest()[:8]

    # Clean up old hashed data exports and manifests
    for pattern in (
        str(WEBAPP_DIR / f"{PROPERTIES_JSON_BASENAME}.*.msgpack"),
        str(WEBAPP_DIR / f"{PROPRIETORS_JSON_BASENAME}.*.msgpack"),
    ):
        for path in glob.glob(pattern):
            try:
                Path(path).unlink()
            except Exception:
                pass
    try:
        (WEBAPP_DIR / "overseas_entities_data_info.txt").unlink()
    except Exception:
        pass

    # Write msgpack data for the webapp
    props_data_path = WEBAPP_DIR / f"{PROPERTIES_JSON_BASENAME}.{sha}.msgpack"
    owners_data_path = WEBAPP_DIR / f"{PROPRIETORS_JSON_BASENAME}.{sha}.msgpack"
    props_data_path.write_bytes(props_msgpack)
    owners_data_path.write_bytes(owners_msgpack)

    # Report combined uncompressed size and write manifests (size on line1, hash on line2)
    props_data_size = props_data_path.stat().st_size if props_data_path.exists() else 0
    owners_data_size = owners_data_path.stat().st_size if owners_data_path.exists() else 0
    combined_data_size = props_data_size + owners_data_size
    data_info_path = WEBAPP_DIR / "overseas_entities_data_info.txt"
    data_info_lines = [str(combined_data_size), sha]
    dataset_period = determine_dataset_period(current_overseas_entity_list_file)
    if dataset_period:
        data_info_lines.append(dataset_period)
    data_info_path.write_text("\n".join(data_info_lines) + "\n", encoding="utf-8")

    print(f"\nData exported to {props_data_path} and {owners_data_path}")
    print(f"Combined msgpack size: {combined_data_size:,} bytes (properties: {props_data_size:,}, proprietors: {owners_data_size:,}); hash: {sha}")

    conn.close()
    
    
    
    # Export statistics to CSV in a structured table format
    with open(stats_csv_path, "w", newline="", encoding="utf-8") as csvfile:
        writer = csv.writer(csvfile)

        # 1. Write simple key-value stats like color totals
        writer.writerow(["Statistic", "Value"])
        writer.writerow(["--- Color Totals ---", "---"])
        for color, count in color_totals.items():
            writer.writerow([f"Total '{color.capitalize()}' Properties", count])
        writer.writerow(["Color Total Sum", sum(color_totals.values())])
        writer.writerow([]) # Add a blank row for spacing

        # 2. Prepare and Write the main yearly analysis table
        writer.writerow(["--- Yearly Analysis ---", ""])
        table_headers = ["Category", "Up to 2022", "2023", "2024", "2025", "Overall Total", "Overall %"]
        writer.writerow(table_headers)
        
        # Define the categories to report (proprietor-based now), mapping display names to internal data keys and overall totals
        categories_to_report = {
            "Total proprietors": {"key": "total", "total_var": total_proprietors},
            "Proprietor not registered": {"key": "proprietor_not_found", "total_var": overall_counts["proprietor_not_found"]},
            "No beneficial owner declared": {"key": "no_bo", "total_var": overall_counts["no_bo"]},
            "True beneficial owner hidden": {"key": "suspect_bo", "total_var": overall_counts["suspect_bo"]},
            "Only trustees listed as beneficial owners": {"key": "only_trustee", "total_var": overall_counts["only_trustee"]},
            "Ownership properly disclosed": {"key": "fine", "total_var": overall_counts["fine"]}
        }
        
        
        report_years = ["up_to_2022", "2023", "2024", "2025"]

        # Write each category row
        for display_name, data in categories_to_report.items():
            internal_key = data["key"]
            overall_total = data["total_var"]
            row = [display_name]
            
            # Append counts for each year
            for year in report_years:
                row.append(yearly_stats[year][internal_key]) # type: ignore
            
            # Append overall total
            row.append(overall_total)

            # Append overall percentage
            if total_proprietors > 0 and display_name != "Total proprietors":
                percentage = (overall_total / total_proprietors) * 100
                row.append(f"{percentage:.1f}%")
            else:
                row.append("-") # No percentage for the main total row
            
            writer.writerow(row)

        # Add a final row to check if the sum of categories matches the total
        category_total_check = sum(data["total_var"] for name, data in categories_to_report.items() if name != "Total proprietors")
        check_row = ["Category Sum Check"]
        for year in report_years:
            # Sum only the categories we display
            year_sum = sum(yearly_stats[year][data["key"]] for name, data in categories_to_report.items() if name != "Total proprietors")
            check_row.append(year_sum) # type: ignore
        check_row.append(category_total_check) # type: ignore
        check_row.append("-")
        writer.writerow(check_row)

        # 3. Add a final note for entries with unknown dates
        if yearly_stats["unknown"]["total"] > 0:
            writer.writerow([]) # Blank row
            writer.writerow(["Note:", f"{yearly_stats['unknown']['total']} properties had an unknown or invalid date and are not included in the yearly table."])

        # 4. Property type analysis (property-based, keyed by status color)
        writer.writerow([]) # Blank row
        writer.writerow(["--- Property Type Analysis ---", ""])
        writer.writerow(["Category"] + PROPERTY_TYPE_COLUMNS)

        property_type_categories = [
            ("Total properties", "total"),
            ("Proprietor not registered", "proprietor_not_found"),
            ("No beneficial owner declared", "no_bo"),
            ("True beneficial owner hidden", "suspect_bo"),
            ("Only trustees listed as beneficial owners", "only_trustee"),
            ("Ownership properly disclosed", "fine"),
        ]

        for display_name, key in property_type_categories:
            row = [display_name]
            for col in PROPERTY_TYPE_COLUMNS:
                row.append(str(property_type_stats[key].get(col, 0)))
            writer.writerow(row)

        check_row = ["Category Sum Check"]
        for col in PROPERTY_TYPE_COLUMNS:
            col_sum = sum(
                property_type_stats[key].get(col, 0)
                for display_name, key in property_type_categories
                if display_name != "Total properties"
            )
            check_row.append(str(col_sum))
        writer.writerow(check_row)
            
        if country_stats:
            writer.writerow([]) # Blank row
            writer.writerow(["--- Category Breakdown by Proprietor Country ---", ""])
            writer.writerow(["Note:", "Proprietors are counted by their country; properties with multiple proprietors appear multiple times."])

            # Define the headers and internal keys for the table columns
            country_table_categories = {
                "Proprietor not registered": "proprietor_not_found",
                "No beneficial owner declared": "no_bo",
                "True beneficial owner hidden": "suspect_bo",
                "Only trustees listed as beneficial owners": "only_trustee",
                "Ownership properly disclosed": "fine"
            }
            
            country_headers = ["Country"] + list(country_table_categories.keys()) + ["Total"]
            writer.writerow(country_headers)
            
            # Sort countries alphabetically for consistent output
            sorted_countries = sorted(country_stats.keys())
            
            column_totals = collections.defaultdict(int)

            # Write data row for each country
            for country in sorted_countries:
                row_total = 0
                row_to_write = [country]
                for key in country_table_categories.values():
                    count = country_stats[country].get(key, 0)
                    row_to_write.append(str(count))
                    row_total += count
                    column_totals[key] += count
                row_to_write.append(str(row_total))
                writer.writerow(row_to_write)
            
            # Add a final totals row at the bottom
            totals_row = ["TOTAL"]
            grand_total = 0
            for key in country_table_categories.values():
                total = column_totals[key]
                totals_row.append(str(total)) # type: ignore
                grand_total += total
            totals_row.append(str(grand_total)) # type: ignore
            writer.writerow(totals_row)

            if country_value_stats:
                writer.writerow([]) # Blank row between count and value tables
                writer.writerow(["--- Category Breakdown by Proprietor Country (Property Value) ---", ""])
                writer.writerow([
                    "Note:",
                    "Property values (GBP) are summed per proprietor country; properties with multiple proprietors contribute once per proprietor.",
                ])

                value_headers = ["Country"] + list(country_table_categories.keys()) + ["Total"]
                writer.writerow(value_headers)

                sorted_value_countries = sorted(set(sorted_countries) | set(country_value_stats.keys()))
                value_column_totals = collections.defaultdict(int)

                for country in sorted_value_countries:
                    row_total_value = 0
                    row_to_write = [country]
                    for key in country_table_categories.values():
                        value_sum = country_value_stats[country].get(key, 0)
                        row_to_write.append(str(value_sum))
                        row_total_value += value_sum
                        value_column_totals[key] += value_sum
                    row_to_write.append(str(row_total_value))
                    writer.writerow(row_to_write)

                totals_value_row = ["TOTAL"]
                grand_value_total = 0
                for key in country_table_categories.values():
                    total_value = value_column_totals[key]
                    totals_value_row.append(str(total_value))
                    grand_value_total += total_value
                totals_value_row.append(str(grand_value_total))
                writer.writerow(totals_value_row)

                writer.writerow([])
                totals_in_billions_row = ["Total (GBP bn)"]
                for key in country_table_categories.values():
                    total_value = value_column_totals[key]
                    totals_in_billions_row.append(f"{total_value / 1_000_000_000:.1f}")
                totals_in_billions_row.append(f"{grand_value_total / 1_000_000_000:.1f}")
                writer.writerow(totals_in_billions_row)

                coverage_row = ["Price data coverage"]
                priced_total_entries = 0
                for key in country_table_categories.values():
                    numerator = category_value_entry_counts.get(key, 0)
                    denominator = overall_counts[key]
                    coverage = (numerator / denominator) if denominator else 0.0
                    priced_total_entries += numerator
                    coverage_row.append(f"{coverage:.2f}")
                total_coverage = (priced_total_entries / total_proprietors) if total_proprietors else 0.0
                coverage_row.append(f"{total_coverage:.2f}")
                writer.writerow(coverage_row)

    print(f"✅ Summary statistics exported to {stats_csv_path}")
    
    # Sort BOs by frequency (highest first)
    sorted_bos = sorted(
        beneficial_owner_counts.items(),
        key=lambda item: item[1],
        reverse=True
    )


    # Export top NUMBER_BOs_TO_EXPORT to CSV
    with open(CSV_BO_OUTPUT_FILE, "w", newline="", encoding="utf-8") as csvfile:
        writer = csv.writer(csvfile)
        writer.writerow(["name", "appearances"])
        for name, count in sorted_bos[:NUMBER_BOs_TO_EXPORT]:
            writer.writerow([name, count])

    trustee_counts = []
    for key, hidden_titles in trustee_hidden_property_titles.items():
        hidden_count = len(hidden_titles)
        with_bo_count = len(trustee_with_bo_property_titles.get(key, set()))
        if hidden_count == 0 and with_bo_count == 0:
            continue
        display_name = trustee_display_names.get(key, key)
        trustee_counts.append((display_name, with_bo_count, hidden_count))

    trustee_counts.sort(key=lambda item: (-item[2], -item[1], item[0].lower()))

    with open(TOP_TRUSTEES_CSV, "w", newline="", encoding="utf-8") as csvfile:
        writer = csv.writer(csvfile)
        writer.writerow(["trustee_name", "properties_with_BO", "properties_without_BO", "disclosing_ratio"])
        for name, with_bo, hidden in trustee_counts[:200]:
            total = with_bo + hidden
            ratio = (with_bo / total) if total else 0.0
            writer.writerow([name, with_bo, hidden, f"{ratio:.4f}"])
    if trustee_counts:
        print(f"Exported top trustees to {TOP_TRUSTEES_CSV}")
    else:
        print("No trustee-only beneficial owners identified for export")
    

    # Write out to a text file, one entity per line
    suspect_entities.sort(key=str.lower)
    with open(SUSPECT_ENTITY_FILE, 'w', encoding='utf-8') as f:
        for entity in suspect_entities:
            f.write(f"{entity}\n")
    
    print(f"list of suspect entities exported to {SUSPECT_ENTITY_FILE}")

    # Export top 500 proprietors with BO_failure == "No company found"
    if unregistered_proprietors:
        # Pair canonical name with precomputed count, sort by count desc
        unregistered_with_counts = [
            (canonical, proprietor_counts.get(lower, 0))
            for lower, canonical in unregistered_proprietors.items()
        ]
        unregistered_with_counts.sort(key=lambda x: x[1], reverse=True)
        with open(UNREGISTERED_PROPRIETORS_CSV, "w", newline="", encoding="utf-8") as csvfile:
            writer = csv.writer(csvfile)
            writer.writerow(["name", "count"])
            for name, count in unregistered_with_counts[:500]:
                writer.writerow([name, count])
        print(f"Exported unregistered proprietors to {UNREGISTERED_PROPRIETORS_CSV}")

    if skipped_ceased_bos > 0:
        print(f"Skipped ceased beneficial owners during export: {skipped_ceased_bos}")


if __name__ == "__main__":
    extract_data(current_db_file, output_json_path)
    upload_all_files()
