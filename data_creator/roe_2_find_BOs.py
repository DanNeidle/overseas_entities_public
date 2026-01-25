#!/usr/bin/env python3
import sqlite3
import requests
import time
import json
from collections import deque
 
from roe_common_functions import normalise_text

from companies_house_settings import (
    companies_house_api_key,
    companies_house_rate_limit,
    companies_house_rate_period,
    current_db_file
) 
 

# For targeted runs: set to a list of title numbers; otherwise None
# e.g. TITLES_TO_CHECK = ["NGL107005"]
TITLES_TO_CHECK = None

# For targeted runs by proprietor company name substring(s):
# - Set to a string (e.g. "uk branch") or a list of strings
#   (e.g. ["uk branch", "london branch"]).
# - Case-insensitive; matches anywhere in proprietor{1..4}_name.
# or None for normal operation
COMPANIES_TO_CHECK = None

# only finds cases where companies house lookup failed
FIND_MISSING_NAMES_ONLY = False

# When True, perform a dry run: no DB writes (no ALTER/UPDATE/COMMIT),
# but proceed with lookups and processing. Prompt at start to confirm.
DRY_RUN = False 

# --- Configuration ---
TABLE_NAME = 'entities'


# Companies House API endpoints
SEARCH_URL = 'https://api.company-information.service.gov.uk/advanced-search/companies'
BASIC_SEARCH_URL = 'https://api.company-information.service.gov.uk/search/companies'
PSC_URL_TEMPLATE = 'https://api.company-information.service.gov.uk/company/{company_number}/persons-with-significant-control'

# Rate limiter: track timestamps of recent requests
request_times = deque()

# In-memory caches to avoid repeated API calls during a single run
BO_cache = {}
proprietor_cache = {}

# Database retry/backoff settings
MAX_DB_RETRIES = 10
INITIAL_DB_RETRY_SLEEP = 0.5  # seconds

def commit_with_retry(conn: sqlite3.Connection):
    """
    Commit with retries when SQLite reports 'database is locked'.
    Exponential backoff up to MAX_DB_RETRIES attempts.
    """
    delay = INITIAL_DB_RETRY_SLEEP
    attempt = 0
    while True:
        try:
            conn.commit()
            return
        except sqlite3.OperationalError as e:
            msg = str(e).lower()
            if 'database is locked' in msg and attempt < MAX_DB_RETRIES:
                print(f"Database locked on commit. Retry {attempt+1}/{MAX_DB_RETRIES} after {delay:.1f}s...")
                time.sleep(delay)
                attempt += 1
                delay = min(delay * 2, 10.0)
                continue
            raise

def throttle_requests():
    """
    Ensure we stay within rate limits.
    """
    now = time.time()
    window_start = now - companies_house_rate_period
    # remove timestamps outside the window
    while request_times and request_times[0] < window_start:
        request_times.popleft()
    if len(request_times) >= companies_house_rate_limit:
        sleep_time = companies_house_rate_period - (now - request_times[0])
        print(f"Rate limit reached. Sleeping {sleep_time:.1f}s...")
        time.sleep(sleep_time)
    # record our request time
    request_times.append(time.time())

# Fetch a Companies House company profile with rate limiting and retry/backoff
def get_company_profile(company_number: str) -> dict | None:
    url = f"https://api.company-information.service.gov.uk/company/{company_number}"
    while True:
        throttle_requests()
        try:
            r = requests.get(url, auth=(companies_house_api_key, ''), timeout=30)
            if r.status_code == 200:
                return r.json()
            elif r.status_code in (404, 403):
                print(f"Profile unavailable for {company_number} (HTTP {r.status_code}).")
                return None
            elif r.status_code == 502:
                print("Profile 502. Retrying in 30s..."); time.sleep(30); continue
                
            elif r.status_code == 429:
                retry = int(r.headers.get('Retry-After', '10'))
                print(f"Profile 429. Backing off {retry}s...")
                time.sleep(retry)
                continue
                
            print(f"Profile HTTP {r.status_code}. Retrying in 10s...")
            
        except Exception as e:
            print(f"Profile exception: {e}. Retrying in 10s...")
        time.sleep(10)

# Convert a Companies House address object into a single-line, human-readable string.
def format_address(addr: dict | None) -> str | None:
    if not isinstance(addr, dict): return None
    parts = [addr.get(k) for k in (
        'premises','address_line_1','address_line_2','locality','region','postal_code','country'
    ) if isinstance(addr.get(k), str)]
    return ', '.join([p for p in parts if p]) or None

# Choose the best available address for display, preferring principal/registered office for ROEs.
def pick_company_address(profile: dict | None, company_type: str, snippet: str | None) -> str | None:
    if TITLES_TO_CHECK:
        print("----------")
        print(profile)
        print("----------")
        
    if not profile:
        return snippet
    if company_type == 'registered-overseas-entity' or (str(profile.get('type')) == 'registered-overseas-entity'):
        return (format_address(profile.get('principal_office_address'))
                or format_address(profile.get('registered_office_address'))
                or snippet)
    # oversea-company or anything else
    return (format_address(profile.get('registered_office_address'))
            or snippet)


# Ensure the working table has a BO_checked column; add it if missing.
def ensure_bo_checked_column(conn):
    cursor = conn.execute(f"PRAGMA table_info({TABLE_NAME});")
    cols = [row[1] for row in cursor.fetchall()]
    if 'BO_checked' not in cols:
        print('Adding BO_checked column...')
        conn.execute(f"ALTER TABLE {TABLE_NAME} ADD COLUMN BO_checked TEXT;")
        commit_with_retry(conn)
        

def ensure_proprietor_number_columns(conn):
    """
    Ensure columns for proprietor1..4 company number exist.
    - proprietor{i}_number: TEXT (company numbers may start with a letter)
    """
    cursor = conn.execute(f"PRAGMA table_info({TABLE_NAME});")
    cols = {row[1] for row in cursor.fetchall()}
    for i in range(1, 5):
        num_col = f'proprietor{i}_number'
        if num_col not in cols:
            conn.execute(f"ALTER TABLE {TABLE_NAME} ADD COLUMN {num_col} TEXT;")
    commit_with_retry(conn)

# Tokenise and normalise a name for set-equality comparisons
def _token_set(text: str) -> set[str]:
    return set(normalise_text(text).split())

def is_ceased_beneficial_owner(bo: dict) -> bool:
    """
    Return True if this BO record represents someone who has ceased.
    Treat non-empty strings (incl. dates), non-zero numbers, or True as ceased.
    """
    value = bo.get('ceased')
    if value is None:
        value = bo.get('ceased_on') or bo.get('ceased_date')
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        v = value.strip().lower()
        if v in ('', '0', 'false', 'no', 'none', 'null'):
            return False
        return True
    return bool(value)


def get_company_details(company_name: str):
    """
    Hybrid search:
    - Scan the first page for a strong ROE match (exact or token-set equal). If found, return immediately.
    - Otherwise, remember the best oversea-company from the first page as a provisional fallback.
    - Paginate further ONLY if needed to try to find a strong ROE; stop as soon as we do.
    - If none found after pagination, return the best oversea-company (or None).
    """
    
    
    
    norm_query = normalise_text(company_name)
    
    if norm_query in proprietor_cache:
        return proprietor_cache[norm_query]
    
    items_per_page = 100

    def is_strong_oversea(item, norm_query: str) -> tuple[bool, str]:
        """Strong match for oversea-company: exact-normalised name or token-set equality."""
        if item.get('company_type') != 'oversea-company':
            return (False, '')
        title = item.get('title', '') or ''
        norm_title = normalise_text(title)
        if norm_title == norm_query:
            return (True, 'exact name + oversea-company')
        if _token_set(title) == set(norm_query.split()) and bool(norm_query):
            return (True, 'token-set equal + oversea-company')
        return (False, '')


    def is_strong_roe(item, norm_query: str) -> tuple[bool, str]:
        """Strong match is exact-normalised name or token-set equality AND item is ROE."""
        if item.get('company_type') != 'registered-overseas-entity':
            return (False, '')
        title = item.get('title', '') or ''
        norm_title = normalise_text(title)
        if norm_title == norm_query:
            return (True, 'exact name + ROE')
        if _token_set(title) == set(norm_query.split()) and bool(norm_query):
            return (True, 'token-set equal + ROE')
        return (False, '')


    # ---- First page only ----
    start_index = 0
    strong_oversea = None
    strong_oversea_reason = ''
    first_page_items = []

    while True:
        throttle_requests()
        params = {'q': company_name, 'items_per_page': items_per_page, 'start_index': start_index}
        try:
            r = requests.get(BASIC_SEARCH_URL, auth=(companies_house_api_key, ''), params=params, timeout=30)
        except Exception as e:
            print(f"Search exception: {e}. Retrying in 10s...")
            time.sleep(10)
            continue

        if r.status_code == 200:
            data = r.json()
            page_items = data.get('items', []) or []
        
            
            # If this is the first page, save the items for our fallback check later
            if start_index == 0:
                first_page_items = page_items
                
            
            for it in page_items:
                ok, reason = is_strong_roe(it, norm_query)
                if ok:
                    print(f"Matched '{company_name}' → '{it.get('title')}' [{it.get('company_number')}] "
                        f"({it.get('company_type')}); reason: {reason}")
                    
                    result = (it.get('title'), it.get('company_number'), it.get('address_snippet'), it.get('company_status'))
                    proprietor_cache[norm_query] = result
                    return result

            
            for it in page_items:
                ok, reason = is_strong_oversea(it, norm_query)
                if ok:
                    # prefer exact over token-set
                    exact_bonus = 1 if 'exact name' in reason else 0
                    current_bonus = 1 if strong_oversea_reason.startswith('exact') else 0
                    if (strong_oversea is None) or (exact_bonus > current_bonus):
                        strong_oversea = it
                        strong_oversea_reason = reason
                        if exact_bonus == 1 and start_index == 0:
                            # if exact on first page and no ROE found, we can accept this later if no ROE appears
                            pass


            # If this was the first page, decide whether to paginate:
            if start_index == 0:
                # If there were fewer than a full page of results, no more pages → fall back now
                if len(page_items) < items_per_page:
                    break  # leave loop to return provisional
                # Otherwise, we *may* need to paginate to look for a strong ROE
                start_index += items_per_page
                # Continue into pagination loop to hunt only for a strong ROE
                continue

            # Pagination path: if short page, we're done; else next page
            if len(page_items) < items_per_page:
                break
            start_index += items_per_page
            continue

        elif r.status_code == 416:
            break

        elif r.status_code == 404:
            print(f"Can't find {company_name}")
            result = None, None, None, None
            proprietor_cache[norm_query] = result
            return result

        elif r.status_code == 502:
            print('Received 502. Retrying in 30s...')
            time.sleep(30)
            continue
        
        elif r.status_code == 429:
            retry = int(r.headers.get('Retry-After', '10'))
            print(f"HTTP 429. Backing off {retry}s...")
            time.sleep(retry)
            continue

        print(f"Search error HTTP {r.status_code}. Retrying in 10s...")
        time.sleep(10)

    # ---- No strong ROE found; fall back ONLY to strong oversea-company (exact or token-set) ----
    if strong_oversea:
        print(f"Matched '{company_name}' → '{strong_oversea.get('title')}' "
            f"[{strong_oversea.get('company_number')}] (oversea-company); reason: {strong_oversea_reason}")
        
        result = (
            strong_oversea.get('title'),
            strong_oversea.get('company_number'),
            strong_oversea.get('address_snippet'),
            strong_oversea.get('company_status')
        )
        proprietor_cache[norm_query] = result
        return result
    
    # Fallback for changed names: inspect the snippet text for previous names
    # Only consider items that are overseas types (ROE or oversea-company)
    allowed_types = {"registered-overseas-entity", "oversea-company"}
    for item in first_page_items:
        snippet = item.get('snippet', '') or ''
        if not snippet:
            continue
        
        # Snippets can contain multiple previous names, often separated by ' · '
        # We split the snippet and check each part for an exact match.
        previous_names_in_snippet = snippet.split('·')
        for prev_name in previous_names_in_snippet:
            # Normalise each potential previous name and compare for strict equality
            if norm_query == normalise_text(prev_name.strip()):
                # Enforce overseas-only: skip domestic LTD/LLP etc.
                if item.get('company_type') in allowed_types:
                    print(f"Found exact match for '{company_name}' via snippet (previous name): '{item.get('title')}'")
                    result = (item.get('title'), item.get('company_number'), item.get('address_snippet'), item.get('company_status'))
                    proprietor_cache[norm_query] = result
                    return result
                else:
                    print(
                        f"Ignoring snippet match on '{item.get('title')}' — type '{item.get('company_type')}' is not overseas"
                    )

    # Nothing suitable found (no ROE, no strong oversea-company)
    result = None, None, None, None
    proprietor_cache[norm_query] = result
    return result

# Use the normalised name as the cache key for BO lookups
def find_BOs_for_company(raw_company_name: str):
    norm_key = normalise_text(raw_company_name)
    if norm_key in BO_cache:
        return BO_cache[norm_key]

    proper_name, num, snippet, search_company_status = get_company_details(raw_company_name)
    if not num:
        result = ('No company found', [], None, None)
        BO_cache[norm_key] = result
        return result

    # Fetch a company profile and choose a best-effort address
    profile = get_company_profile(num)
    company_type = (profile.get('type') if profile else '') or ''
    chosen_addr = pick_company_address(profile, company_type, snippet)

    bo_json = get_BO_list(num)
    items = bo_json.get('items') or []

    if items:
        result = ('OK', items, chosen_addr, num)
    else:
        result = ('No BO', [], chosen_addr, num)
    BO_cache[norm_key] = result
    return result



# Retrieve PSC/BO data for a company number with retry/backoff on transient errors
def get_BO_list(company_number: str) -> dict:
    url = PSC_URL_TEMPLATE.format(company_number=company_number)
    while True:
        throttle_requests()
        try:
            r = requests.get(url, auth=(companies_house_api_key, ''), timeout=30)
            if r.status_code == 200:
                return r.json()
            elif r.status_code in (404, 403):
                print(f"PSC/BO endpoint unavailable for {company_number} (HTTP {r.status_code}).")
                return {"items": []}
            elif r.status_code == 502:
                print('Received 502. Retrying in 30s...')
                time.sleep(30); continue
            if r.status_code == 429:
                retry = int(r.headers.get('Retry-After', '10'))
                print(f"HTTP 429. Backing off {retry}s...")
                time.sleep(retry)
                continue
            print(f"PSC fetch HTTP {r.status_code}. Retrying in 10s...")
        except Exception as e:
            print(f"PSC fetch exception: {e}. Retrying in 10s...")
        time.sleep(10)


    

def process_all_records():
    # Increase default lock wait; also set busy timeout explicitly.
    conn = sqlite3.connect(current_db_file, timeout=30)
    try:
        conn.execute("PRAGMA busy_timeout = 30000;")  # 30s
    except Exception:
        pass
    
    if DRY_RUN:
        print("=== DRY RUN ENABLED: No database writes will be performed. ===")
        input("Press enter to continue in DRY RUN mode...")
    else:
        # Only ensure schema when not in dry run (avoids writes)
        ensure_bo_checked_column(conn)
        ensure_proprietor_number_columns(conn)
    cursor = conn.cursor()

    # fetch unprocessed rows
    if TITLES_TO_CHECK:
        print(f"--- DEBUG MODE: Processing only titles '{TITLES_TO_CHECK}' ---")
        input("Press enter to confirm")
        
        # Ensure titles_to_check is a list, even if only one was provided
        titles = TITLES_TO_CHECK if isinstance(TITLES_TO_CHECK, list) else [TITLES_TO_CHECK]
        
        # Create a string of placeholders: '?, ?, ?'
        placeholders = ', '.join(['?'] * len(titles))
        
        # Use the IN operator with the generated placeholders
        sql = f"SELECT rowid, * FROM {TABLE_NAME} WHERE property_title_number IN ({placeholders})"
        
        # The parameters are now the list of titles itself
        params = titles
        cursor.execute(sql, params)
    elif COMPANIES_TO_CHECK:
        print("--- TARGETED RUN: Processing rows where any proprietor name contains specified term(s) ---")
        # Normalize to list of non-empty strings
        terms = COMPANIES_TO_CHECK if isinstance(COMPANIES_TO_CHECK, list) else [COMPANIES_TO_CHECK]
        terms = [t.strip() for t in terms if isinstance(t, str) and t.strip()]
        if not terms:
            print("No valid search terms in COMPANIES_TO_CHECK. Nothing to do.")
            return
        print(f"Terms: {terms}")
        input("Press enter to confirm")

        conditions = []
        params = []
        for term in terms:
            pattern = f"%{term.lower()}%"
            for i in range(1, 5):
                conditions.append(f"LOWER(proprietor{i}_name) LIKE ?")
                params.append(pattern)
        where_clause = " OR ".join(conditions)
        sql = f"SELECT rowid, * FROM {TABLE_NAME} WHERE {where_clause}"
        cursor.execute(sql, params)
    elif FIND_MISSING_NAMES_ONLY:
        print("--- TARGETED RUN: Processing records that previously failed with 'No company found' ---")
        input("Press enter to confirm")
        sql = f"""
            SELECT rowid, * FROM {TABLE_NAME} 
            WHERE proprietor1_BO_failure = ? OR 
                  proprietor2_BO_failure = ? OR
                  proprietor3_BO_failure = ? OR
                  proprietor4_BO_failure = ?
        """
        params = ('No company found', 'No company found', 'No company found', 'No company found')
        cursor.execute(sql, params)
    
    else:
        
        sql = f"SELECT rowid, * FROM {TABLE_NAME} WHERE status IS NULL OR status != 'BOs added'"
        cursor.execute(sql)
        
    cols = [desc[0] for desc in cursor.description]
    rows = cursor.fetchall()
    total = len(rows)
    if total == 0:
        print('No records to process.')
        return
    print(f"Total records to process: {total}")
    

    start_time = time.time()
    processed = 0
    ceased_bos_skipped = 0

    for row_tuple in rows:
        rowid = row_tuple[0]
        record = dict(zip(cols, row_tuple))
        update = {}
        
        property_title_number = record.get("property_title_number")
        
        if TITLES_TO_CHECK:
            print(f"Checking {property_title_number}")
        

        for i in range(1, 5):
            prop = record.get(f'proprietor{i}_name') 
            
            if COMPANIES_TO_CHECK and prop:
                print(f"Checking {prop}")

            # clear fields
            for j in range(1, 5):
                base = f'proprietor{i}_BO{j}_'
                update[base + 'name'] = None
                update[base + 'legal_form'] = None
                update[base + 'ceased'] = None
                update[base + 'kind'] = None
                update[base + 'address'] = None
                update[base + 'is_sanctioned'] = None
                update[base + 'natures_of_control'] = None
            update[f'proprietor{i}_BO_failure'] = None
            # also clear new proprietor-level fields
            update[f'proprietor{i}_number'] = None

            if prop and prop.strip():
                status, bos, reg_address, comp_number = find_BOs_for_company(prop)
                
                if reg_address:
                    print(f"address: {reg_address}")
                    update[f'proprietor{i}_address'] = reg_address                    
                else:
                    print(f"CAN'T FIND: {property_title_number}: '{prop}'")
                
                # If we found a company (OK or No BO), record number
                if comp_number:
                    update[f'proprietor{i}_number'] = str(comp_number)

                if status == 'OK':
                    active_bos = []
                    for bo in bos:
                        if is_ceased_beneficial_owner(bo):
                            ceased_bos_skipped += 1
                            continue
                        active_bos.append(bo)

                    for j, bo in enumerate(active_bos[:4], start=1):
                        base = f'proprietor{i}_BO{j}_'
                        update[base + 'name'] = bo.get('name')
                        ident = bo.get('identification')
                        update[base + 'legal_form'] = json.dumps(ident) if ident else None
                        update[base + 'ceased'] = bo.get('ceased')
                        update[base + 'kind'] = bo.get('kind')
                        addr = bo.get('address') or {}
                        parts = [v for v in (addr.get(k) for k in ['premises','address_line_1','address_line_2','address_line_3','locality','postal_code','country']) if isinstance(v, str)]
                                                
                        update[base + 'address'] = ', '.join(parts) if parts else None
                        update[base + 'is_sanctioned'] = bo.get('is_sanctioned')
                        update[base + 'natures_of_control'] = str(bo.get('natures_of_control', ''))
                else:
                    update[f'proprietor{i}_BO_failure'] = status
            else:
                pass

        update['status'] = 'BOs added'

        # execute update (or simulate in dry run)
        if DRY_RUN:
            # Show a concise summary of intended write
            print(f"DRY RUN: would update rowid={rowid} title={property_title_number}")
        else:
            cols_assign = ', '.join(f'"{k}" = ?' for k in update)
            sql = f"UPDATE {TABLE_NAME} SET {cols_assign} WHERE rowid = ?"
            params = list(update.values()) + [rowid]
            # Execute and commit with retry in case the DB is momentarily locked
            cursor.execute(sql, params)
            commit_with_retry(conn)

        processed += 1
        
        if processed % 20 == 0:
            elapsed = time.time() - start_time
            avg = elapsed / processed
            remaining = total - processed
            est = remaining * avg / 3600
            print(f"\n{processed}/{total} - estimated {est:.2f} hours to go")

    conn.close()
    print('All records processed.')
    print(f"Ceased beneficial owners skipped: {ceased_bos_skipped}")


if __name__ == '__main__':
    
    process_all_records()
    
