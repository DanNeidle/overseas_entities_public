#!/usr/bin/env python3
import sqlite3
import re
import json
import time
import ast
from typing import Any, Dict, List, Tuple
from urllib.parse import unquote, urlparse
from rapidfuzz import fuzz, process
import requests
from bs4 import BeautifulSoup

from roe_common_functions import normalise_text, is_within_uk

from companies_house_settings import current_db_file

# ------------------------------------------------------------
# Configuration (fast defaults)
# 
# Fast defaults for production runs:
# - WORKERS: 8 (set to 1 for sequential debug)
# - CHUNK_SIZE: 500 (smaller = finer granularity, more overhead)
# - USE_WAL: True (enables concurrent read/write and batched flushes)
# - FAST_WRITES: True (aggressive PRAGMAs; durability trade-off, fine locally)
# - FLUSH_BATCH: 10000 (rows per buffered write during parallel read)
# - LIMIT: None (set an int like 5000 to debug quickly)
# - SKIP_WIKI: False (set True in debug to skip network fetch)
# - SKIP_GEO: False (set True in debug to skip geospatial fallback)
# - VERBOSE: False (set True to log per-row reclassifications)
# ------------------------------------------------------------
WORKERS = 8
CHUNK_SIZE = 500
USE_WAL = True
FAST_WRITES = True
FLUSH_BATCH = 10000
LIMIT = None  # e.g., 5000 for quick debug
SKIP_WIKI = False
SKIP_GEO = False
VERBOSE = False

 
# Global US listing files
nasdaq_file = "data/pscs_nasdaqlisted.txt"
nyse_file = "data/pscs_nyse-listed.csv"
other_file = "data/pscs_other-listed.csv"

# UK listing file
listed_company_file = "data/pscs_uk_listed_companies.txt"

# global listing file
global_listed_csv = "data/Global_stock_listings_by_exchange_174.csv"

# list of government owned companies
government_owned_companies_wiki_url = "https://en.m.wikipedia.org/wiki/List_of_government-owned_companies"

manual_exclusion_file = "data/manual_exclusions.txt"

# this is the part of "natures of control" which shows someone is registered as a BO because they are a trustee
# see https://github.com/companieshouse/api-enumerations/blob/master/psc_descriptions.yml
controls_as_trust_string = "-as-trust-"

# Geospatial helpers now provided by roe_common_functions.is_within_uk

def load_listing_names(filename, delimiter, company_name_col, skip_header=True):
    """Load and normalise company names from a file."""
    listing_names = []
    try:
        with open(filename, "r", encoding="utf-8") as f:
            for i, line in enumerate(f):
                if skip_header and i == 0:
                    continue
                parts = line.strip().split(delimiter)
                if len(parts) > company_name_col:
                    listing_names.append(normalise_text(parts[company_name_col]))
    except FileNotFoundError:
        print(f"Warning: File not found: {filename}")
    return listing_names

def load_and_normalise_text_file(filepath):
    """Load and normalise text from a file, one entry per line."""
    try:
        with open(filepath, 'r', encoding='utf-8') as file:
            # Use the main normalise_text function for consistency
            return [normalise_text(line) for line in file if line.strip()]
    except FileNotFoundError:
        print(f"Warning: File not found: {filepath}")
        return []


def get_government_owned_companies(url):
    """
    Fetches a Wikipedia page and extracts a list of government-owned companies.

    Args:
        url (str): The URL of the Wikipedia page to scrape.

    Returns:
        list: A list of company names, or an empty list if an error occurs.
    """
    company_names = []
    # Define prefixes and exact titles for links that should be ignored
    ignore_prefixes = ('Portal:', 'Category:', 'List of', 'Help:', 'Wikipedia:', 'Template:', 'File:', 'Talk:')
    ignore_exact = ('National oil company', 'State ownership', 'Public ownership', 'Privatization')

    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/123.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-GB,en;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Connection": "keep-alive",
        }

        session = requests.Session()
        session.headers.update(headers)

        def extract_page_title(page_url: str) -> str:
            parsed = urlparse(page_url)
            if parsed.path.startswith("/wiki/"):
                return unquote(parsed.path.split("/wiki/", 1)[1])
            return ""

        def fetch_from_api(page_title: str) -> List[str]:
            names: List[str] = []
            seen = set()
            
            # Best practice: Identify your bot/script
            session.headers.update({
                "User-Agent": "CompanyDataBot/1.0 (your-email@example.com)" 
            })

            params = {
                "action": "query",
                "format": "json",
                "titles": page_title,
                "prop": "links",
                "pllimit": "max",
            }

            while True:
                response = session.get("https://en.wikipedia.org/w/api.php", params=params, timeout=30)
                response.raise_for_status()
                payload = response.json()

                if "error" in payload:
                    raise requests.exceptions.RequestException(payload["error"].get("info", "API error"))

                # action=query returns data nested under "pages"
                pages = payload.get("query", {}).get("pages", {})
                for page_id in pages:
                    links = pages[page_id].get("links", [])
                    for link in links:
                        # In action=query, the key IS "title"
                        title = link.get("title", "")
                        
                        # Filter namespaces (ns: 0 is main articles)
                        if link.get("ns") != 0:
                            continue
                        if title.startswith(ignore_prefixes) or title in ignore_exact:
                            continue
                        
                        cleaned_title = re.sub(r'\s*\([^)]*\)$', '', title).strip()
                        if cleaned_title and cleaned_title not in seen:
                            seen.add(cleaned_title)
                            names.append(cleaned_title)

                # Handle pagination
                if "continue" in payload and "plcontinue" in payload["continue"]:
                    params["plcontinue"] = payload["continue"]["plcontinue"]
                else:
                    break
                    
            return names

        def fetch_from_html(page_url: str) -> List[str]:
            response = session.get(page_url, timeout=30)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, 'html.parser')
            content_div = soup.find(id='content')
            if not content_div:
                print("Error: Could not find the main content div.")
                return []
            list_items = content_div.find_all('li') # type: ignore
            names: List[str] = []
            for item in list_items:
                link = item.find('a') # type: ignore
                if link and link.get('title'): # type: ignore
                    title = link.get('title') # type: ignore
                    if link.get('href').startswith('#') or title.startswith(ignore_prefixes) or title in ignore_exact: # type: ignore
                        continue
                    cleaned_title = re.sub(r'\s*\([^)]*\)$', '', title).strip() # type: ignore
                    if cleaned_title and cleaned_title not in names:
                        names.append(cleaned_title)
            return names

        page_title = extract_page_title(url)
        if page_title:
            try:
                company_names = fetch_from_api(page_title)
                if company_names:
                    return company_names
            except requests.exceptions.RequestException as e:
                print(f"API fetch failed, falling back to HTML: {e}")

        company_names = fetch_from_html(url)

    except requests.exceptions.RequestException as e:
        if hasattr(e, "response") and e.response is not None:
            print(f"Error fetching the URL: {e} (status {e.response.status_code})")
            if VERBOSE:
                print(f"Wikipedia response preview: {e.response.text[:500]}")
        else:
            print(f"Error fetching the URL: {e}")
        exit()
    except Exception as e:
        print(f"An error occurred: {e}")
        exit()

    return company_names


"""
Multiprocessing notes
---------------------
- Avoid heavy work at import time so child processes (spawn on macOS) do not
  redo network/file loading. We instead initialize reference data explicitly.
- Workers perform compute-only classification; the parent performs all DB writes.
"""

# Globals populated by init_reference_data() or worker initializer
all_listed_companies: List[str] = []
normalised_government_companies: List[str] = []
manual_exclusions: List[str] = []


def init_reference_data(skip_wiki: bool = False) -> Tuple[List[str], List[str], List[str]]:
    """Load and normalize reference datasets once in the parent process.

    Returns:
        (all_listed_companies, normalised_government_companies, manual_exclusions)
    """
    print("Loading and normalizing listed company data...")
    us_listings = (
        load_listing_names(nasdaq_file, "|", 1)
        + load_listing_names(nyse_file, ",", 1)
        + load_listing_names(other_file, ",", 1)
    )
    uk_listings = load_and_normalise_text_file(listed_company_file)
    global_listings = load_listing_names(global_listed_csv, ",", 2)

    listed = list(set(us_listings + uk_listings + global_listings))
    print(f"Loaded {len(listed)} unique listed company names.")

    if skip_wiki:
        print("Skipping government-owned company fetch (debug mode).")
        government_owned_companies = []
        norm_gov = []
    else:
        print("Fetching government-owned company list (Wikipedia)...")
        government_owned_companies = get_government_owned_companies(
            government_owned_companies_wiki_url
        )
        norm_gov = [normalise_text(name) for name in government_owned_companies]
        print(f"Successfully extracted {len(government_owned_companies)} government owned companies.")

    manual = load_and_normalise_text_file(manual_exclusion_file)
    print(f"Loaded {len(manual)} manual exclusions")

    return listed, norm_gov, manual


def _worker_init(listed: List[str], gov: List[str], manual: List[str], skip_geo: bool) -> None:
    """Initializer for multiprocessing workers to set module globals."""
    global all_listed_companies, normalised_government_companies, manual_exclusions, SKIP_GEO
    all_listed_companies = listed
    normalised_government_companies = gov
    manual_exclusions = manual
    SKIP_GEO = skip_geo


def is_listed_company(company_name, threshold=95):
    """
    Check if a company name fuzzy matches any known listed companies using an
    optimized search.
    """
    if not company_name:
        return False
    normalised_name = normalise_text(company_name)
    match = process.extractOne(
        normalised_name,
        all_listed_companies,
        scorer=fuzz.ratio,
        score_cutoff=threshold
    )
    return match is not None

def is_it_excluded(company_name):
    normalised_name = normalise_text(company_name)
    return normalised_name in manual_exclusions

def is_government_owned(company_name, threshold=95):
    """
    Check if a company name fuzzy matches any known government-owned companies.
    """
    if not company_name:
        return False
    
    # start with dumb check
    if ("government".lower() in company_name.lower()) or ("central bank".lower() in company_name.lower()) or ("investment authority".lower() in company_name.lower()):
        return True
     
    normalised_name = normalise_text(company_name)
    match = process.extractOne(
        normalised_name,
        normalised_government_companies,
        scorer=fuzz.ratio,
        score_cutoff=threshold
    )
    return match is not None


def is_uk_a_fuzzy_match(country, threshold=85):
    """Determine if a country string is considered UK by fuzzy matching."""
    normalised = country.lower().replace("registered in", "").strip()
    uk_terms = [
        "uk", "england", "english", "scotland", "wales", "northern ireland", "united kingdom",
        "england and wales", "england & wales", "united kingdom (england and wales)",
        "uk and wales", "united kingdom england", "u.k", "england, uk",
        "scotland united kingdom", "gbeng", "gbsct", "great britain", "united kingdom (scotland)", "london",
        "gbr", "cardiff", "e&w", "england, united kingdom", "britain", "uk/england", "cardiff, wales", "uk/scotland",
        "gb", "companies house", "n. ireland", "edinburgh", "uk, yorkshire", "companies house - registrar of companies",
        "northern ireland, united kingdom", "london, england", "belfast", "eng", "u k", "england and wales, england",
        "west yorkshire", "english law"
    ]
    for term in uk_terms:
        if fuzz.ratio(normalised, term) >= threshold:
            return True
    return False

# is_within_uk imported from roe_common_functions

# --- Database Helper Functions ---
def update_record_with_retry(conn, rowid, update_dict, max_retries=5):
    """
    Update a record. Does NOT commit; transaction is handled by main().
    Uses exponential backoff if the database is locked.
    """
    columns = list(update_dict.keys())
    placeholders = ", ".join([f"{col} = ?" for col in columns])
    values = list(update_dict.values())
    sql = f"UPDATE entities SET {placeholders} WHERE rowid = ?"

    retries = 0
    while retries < max_retries:
        try:
            conn.execute(sql, values + [rowid])
            return True # Success
        except sqlite3.OperationalError as e:
            if "locked" in str(e).lower():
                wait_time = 2 ** retries
                print(f"Database locked, retrying rowid {rowid} in {wait_time}s...")
                time.sleep(wait_time)
                retries += 1
            else:
                print(f"Error updating rowid {rowid}: {e}")
                return False # Unrecoverable error
    print(f"Failed to update rowid {rowid} after {max_retries} retries.")
    return False


# --- BO Registration Status Processing Function ---
def process_bo_status(row: sqlite3.Row | Dict[str, Any]):
    """
    For each beneficial owner in a row, determine the registration status.
    Returns a dictionary of columns to update and counts of exclusions.
    """
    update_dict = {}
    excluded_terms = ["jersey", "isle of man", "guernsey", "netherlands"]
    
    listed_exclusions = 0
    government_exclusions = 0
    manual_exclusions = 0
    trustees = 0
    
    title = row["property_title_number"]
    
    for i in range(1, 5):
        
        # Check if a proprietor thought to have "No BO" is actually a listed or government-owned company
        if row[f"proprietor{i}_BO_failure"] == "No BO":
            prop_name = row[f"proprietor{i}_name"]
            
            if is_listed_company(prop_name):
                if VERBOSE:
                    print(f"Proprietor {prop_name} is listed. Reclassifying.")
                update_dict[f"proprietor{i}_BO_failure"] = None
            elif is_government_owned(prop_name):
                if VERBOSE:
                    print(f"Proprietor {prop_name} is government-owned. Reclassifying.")
                update_dict[f"proprietor{i}_BO_failure"] = None
            elif is_it_excluded(prop_name):
                if VERBOSE:
                    print(f"Proprietor {prop_name} is manually excluded. Reclassifying.")
                update_dict[f"proprietor{i}_BO_failure"] = None
            
        
        for j in range(1, 5):
            bo_kind = row[f"proprietor{i}_BO{j}_kind"] 
            if not bo_kind:
                continue

            reg_status_col = f"proprietor{i}_BO{j}_reg_status"
            status = "suspect"  # Default status

            bo_kind = bo_kind.strip()

            if bo_kind == "individual-beneficial-owner":
                status = "individual"
            elif bo_kind == "super-secure-beneficial-owner":
                status = "super-secure"
            elif bo_kind in [
                "corporate-entity-person-with-significant-control",
                "corporate-entity-beneficial-owner",
                "legal-person-beneficial-owner"
            ]:
                in_uk = False
                bo_address = row[f"proprietor{i}_BO{j}_address"] or ""
                # Exclude based on address first
                if not any(bo_address.lower().strip().endswith(term) for term in excluded_terms):

                    # 1. First, check legal registration information
                    legal_form_str = row[f"proprietor{i}_BO{j}_legal_form"]
                    if legal_form_str:
                        try:
                            legal_form = json.loads(legal_form_str)
                            authority = legal_form.get("legal_authority", "")
                            country_registered = legal_form.get("country_registered", "")
                            place_registered = legal_form.get("place_registered", "")
                            if (authority and is_uk_a_fuzzy_match(authority)) or \
                               (country_registered and is_uk_a_fuzzy_match(country_registered)) or \
                               (place_registered and is_uk_a_fuzzy_match(place_registered)):
                                in_uk = True
                        except json.JSONDecodeError:
                            pass

                    # 2. Fallback: If not found in legal info, check lat/lon coordinates
                    if not in_uk and not SKIP_GEO:
                        latlon_str = row[f"proprietor{i}_BO{j}_latlon"]
                        if latlon_str:
                            try:
                                # Clean string: remove brackets and spaces
                                cleaned_str = latlon_str.strip().strip('()')
                                parts = cleaned_str.split(',')
                                if len(parts) == 2:
                                    lat = float(parts[0])
                                    lon = float(parts[1])

                                    # Perform the geographic check
                                    is_in_uk_geo = is_within_uk(lat, lon)

                                    if is_in_uk_geo:
                                        # print(f"geopandas: Address '{bo_address.strip()}' ({latlon_str}) IS in the UK.")
                                        in_uk = True
                                    else:
                                        pass
                                        # print(f"geopandas: Address '{bo_address.strip()}' ({latlon_str}) is NOT in the UK.")

                            except (ValueError, IndexError):
                                # This will catch errors if lat/lon is malformed
                                pass
                
                               
                natures_of_control_string = row[f"proprietor{i}_BO{j}_natures_of_control"]
                if natures_of_control_string:
                    try:
                        natures_of_control = ast.literal_eval(natures_of_control_string)
                    except (ValueError, SyntaxError) as e:
                        raise RuntimeError(
                            f"Invalid natures_of_control for title {title} "
                            f"(proprietor{i} BO{j}): {natures_of_control_string!r}"
                        ) from e
                    natures_of_control = [item for item in natures_of_control if item is not None]  # remove any Nones!
                else:
                    natures_of_control = [] 
                    
                trustee_control = any(controls_as_trust_string in s for s in natures_of_control)
                    
                    
                
                
                # Tiered checking: UK -> listed -> government-owned -> suspect
                bo_name = row[f"proprietor{i}_BO{j}_name"]
                if in_uk:
                    status = "UK"
                elif is_listed_company(bo_name):
                    status = "listed"
                    listed_exclusions += 1
                elif is_government_owned(bo_name):
                    status = "government-owned"
                    government_exclusions += 1
                elif is_it_excluded(bo_name):
                    status = "manually checked"
                    manual_exclusions += 1
                elif trustee_control:
                    status = "trustee"  # if it's a trustee then permitted to be a corporate!
                    trustees += 1
                else:
                    status = "suspect"
                

            update_dict[reg_status_col] = status

    
    return update_dict, listed_exclusions, government_exclusions, manual_exclusions, trustees
    
def _row_to_minimal_dict(row: sqlite3.Row) -> Dict[str, Any]:
    """Extract only needed fields from a sqlite3.Row for inter-process transfer."""
    fields: Dict[str, Any] = {"rowid": row["rowid"], "property_title_number": row["property_title_number"]}
    for i in range(1, 5):
        fields[f"proprietor{i}_BO_failure"] = row[f"proprietor{i}_BO_failure"]
        fields[f"proprietor{i}_name"] = row[f"proprietor{i}_name"]
        for j in range(1, 5):
            prefix = f"proprietor{i}_BO{j}_"
            for col in ("kind", "address", "legal_form", "latlon", "natures_of_control", "name"):
                key = prefix + col
                fields[key] = row[key]
    return fields


def worker_process_rows(rows: List[Dict[str, Any]]) -> Tuple[List[Tuple[int, Dict[str, Any]]], Tuple[int, int, int, int]]:
    """Worker: compute updates for a batch of rows.

    Returns:
        - list of (rowid, update_dict)
        - counters tuple: (listed_exclusions, government_exclusions, manual_exclusions, trustees)
    """
    updates: List[Tuple[int, Dict[str, Any]]] = []
    cnt_listed = cnt_gov = cnt_manual = cnt_trustees = 0
    for row in rows:
        update_dict, listed_count, gov_count, manual_count, trustees = process_bo_status(row)
        cnt_listed += listed_count
        cnt_gov += gov_count
        cnt_manual += manual_count
        cnt_trustees += trustees
        if update_dict:
            updates.append((row["rowid"], update_dict))
    return updates, (cnt_listed, cnt_gov, cnt_manual, cnt_trustees)


# --- DB performance tuning ---
def configure_db(conn: sqlite3.Connection, use_wal: bool, fast_writes: bool) -> None:
    """Apply PRAGMA settings for performance. `fast_writes` implies aggressive trade-offs."""
    cur = conn.cursor()
    if use_wal:
        try:
            cur.execute("PRAGMA journal_mode=WAL;")
            # NORMAL is safer; OFF is handled below if fast_writes
            cur.execute("PRAGMA synchronous=NORMAL;")
        except sqlite3.OperationalError:
            pass
    if fast_writes:
        try:
            cur.execute("PRAGMA synchronous=OFF;")
            cur.execute("PRAGMA temp_store=MEMORY;")
            # 64MB cache size (negative value in KB)
            cur.execute("PRAGMA cache_size=-65536;")
            # 256MB mmap if supported
            try:
                cur.execute("PRAGMA mmap_size=268435456;")
            except sqlite3.OperationalError:
                pass
        except sqlite3.OperationalError:
            pass

# --- Main Function ---
# Batch process: classify BO registration statuses and write updates to the DB
def main():
    # Always initialise reference data in parent
    global all_listed_companies, normalised_government_companies, manual_exclusions
    all_listed_companies, normalised_government_companies, manual_exclusions = init_reference_data(skip_wiki=SKIP_WIKI)
    conn = None
    try:
        conn = sqlite3.connect(current_db_file)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        if LIMIT:
            total_rows = LIMIT
        else:
            total_rows = cursor.execute("SELECT COUNT(rowid) FROM entities").fetchone()[0]
        print(f"Found {total_rows} records to process.")

        
        # Initialize counters for exclusions
        total_listed_exclusions = 0
        total_government_exclusions = 0
        total_manual_exclusions = 0
        total_trustees = 0

        # Configure DB for performance
        configure_db(conn, use_wal=USE_WAL, fast_writes=FAST_WRITES)
        
        if WORKERS <= 1:
            # Sequential path (original behavior)
            cursor.execute("BEGIN TRANSACTION;")
            seq_query = "SELECT rowid, * FROM entities"
            if LIMIT:
                seq_query += f" LIMIT {int(LIMIT)}"
            for index, row in enumerate(cursor.execute(seq_query)):
                if (index + 1) % 1000 == 0:
                    print(f"Processing row {index + 1} of {total_rows} ({(index + 1)/total_rows:.1%})")
                update_dict, listed_count, gov_count, manual_count, trustees = process_bo_status(row)
                total_listed_exclusions += listed_count
                total_government_exclusions += gov_count
                total_manual_exclusions += manual_count
                total_trustees += trustees
                if update_dict:
                    update_record_with_retry(conn, row["rowid"], update_dict)
            print("Committing all database changes...")
            conn.commit()
            print("Done.")
        else:
            # Parallel compute, single-writer pattern
            import multiprocessing as mp

            # Prepare chunks of minimal dicts to keep IPC light
            # Use a separate read-only connection for dispatch to avoid read/write contention
            # Use read-only URI and allow access from pool feeder thread
            read_conn = sqlite3.connect(
                f"file:{current_db_file}?mode=ro", uri=True, check_same_thread=False
            )
            read_conn.row_factory = sqlite3.Row
            read_cursor = read_conn.cursor()

            def _chunk_generator(cur: sqlite3.Cursor, chunk_size: int, limit: int | None):
                batch: List[Dict[str, Any]] = []
                base_query = "SELECT rowid, * FROM entities"
                if limit:
                    base_query += f" LIMIT {int(limit)}"
                for idx, row in enumerate(cur.execute(base_query)):
                    if (idx + 1) % 5000 == 0:
                        print(f"Scanned {idx + 1} rows for dispatch...")
                    batch.append(_row_to_minimal_dict(row))
                    if len(batch) >= chunk_size:
                        yield batch
                        batch = []
                if batch:
                    yield batch

            print(f"Dispatching work across {WORKERS} workers...")
            with mp.Pool(
                processes=WORKERS,
                initializer=_worker_init,
                initargs=(all_listed_companies, normalised_government_companies, manual_exclusions, SKIP_GEO),
            ) as pool:
                processed = 0
                pending_updates: List[Tuple[int, Dict[str, Any]]] = []
                applied = 0

                def flush_pending():
                    nonlocal pending_updates, applied
                    if not pending_updates:
                        return
                    cursor.execute("BEGIN TRANSACTION;")
                    for rowid, update_dict in pending_updates:
                        update_record_with_retry(conn, rowid, update_dict)
                    conn.commit()
                    applied += len(pending_updates)
                    pending_updates = []
                    print(f"Applied updates for {applied} rows...")
                for updates, counters in pool.imap_unordered(
                    worker_process_rows, _chunk_generator(read_cursor, CHUNK_SIZE, LIMIT)
                ):
                    # Buffer updates; optionally flush in WAL mode during reads
                    pending_updates.extend(updates)
                    if USE_WAL and FLUSH_BATCH and len(pending_updates) >= FLUSH_BATCH:
                        flush_pending()
                    # Aggregate counters
                    l, g, m, t = counters
                    total_listed_exclusions += l
                    total_government_exclusions += g
                    total_manual_exclusions += m
                    total_trustees += t
                    processed += len(updates)
                    if processed and processed % 5000 == 0:
                        print(f"Computed updates for {processed} rows...")
            read_conn.close()

            # Apply any remaining updates
            flush_pending()
            print("Done.")

        # Print final totals
        print("-" * 30)
        print("Exclusion Summary:")
        print(f"Total listed company exclusions: {total_listed_exclusions}")
        print(f"Total government-owned exclusions: {total_government_exclusions}")
        print(f"Total manual exclusions: {total_manual_exclusions}")
        print(f"Total trustees: {total_trustees}")
        print("-" * 30)

    except sqlite3.Error as e:
        print(f"Database error: {e}")
        if conn:
            conn.rollback()
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    main()
