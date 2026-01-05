#!/usr/bin/env python3
import re
import sqlite3
import sys
from difflib import SequenceMatcher
from typing import Iterable, Optional

from companies_house_settings import current_db_file
from roe_common_functions import is_within_uk

TABLE_NAME = "entities"
LIMIT = None  # Set to an int for quick testing
FUZZY_THRESHOLD = 85
PROGRESS_EVERY = 200
BATCH_COMMIT_SIZE = 200

UK_TERMS = [
    "uk", "england", "scotland", "wales", "northern ireland", "united kingdom",
    "england and wales", "england & wales", "united kingdom (england and wales)",
    "uk and wales", "united kingdom england", "u.k", "england, uk",
    "scotland united kingdom", "gbeng", "gbsct", "great britain", "united kingdom (scotland)", "london",
    "gbr", "cardiff", "e&w", "england, united kingdom", "britain", "uk/england", "cardiff, wales", "uk/scotland",
    "gb", "companies house", "n. ireland", "edinburgh", "uk, yorkshire", "companies house - registrar of companies",
    "northern ireland, united kingdom", "london, england", "belfast", "eng", "u k", "england and wales, england",
    "west yorkshire", "english law",
]


try:
    from rapidfuzz import fuzz

    def fuzzy_ratio(a: str, b: str) -> int:
        return int(fuzz.ratio(a, b))
except Exception:
    def fuzzy_ratio(a: str, b: str) -> int:
        return int(SequenceMatcher(None, a, b).ratio() * 100)


def normalize_country(raw: Optional[str]) -> str:
    if not raw:
        return ""
    s = str(raw).lower().replace("registered in", "").strip()
    return re.sub(r"\s+", " ", s)


def is_uk_country(raw: Optional[str]) -> bool:
    country = normalize_country(raw)
    if not country:
        return False
    for term in UK_TERMS:
        if fuzzy_ratio(country, term) >= FUZZY_THRESHOLD:
            return True
    return False


def normalize_address_text(raw: Optional[str]) -> str:
    if not raw:
        return ""
    lowered = str(raw).lower()
    cleaned = re.sub(r"[^a-z0-9]+", " ", lowered)
    return re.sub(r"\s+", " ", cleaned).strip()


def address_mentions_country(address: Optional[str], country: Optional[str]) -> bool:
    if not address or not country:
        return False
    addr_norm = normalize_address_text(address)
    country_norm = normalize_address_text(country)
    if not addr_norm or not country_norm:
        return False
    if country_norm in addr_norm:
        return True

    alt_terms = []
    if country_norm in {"united states", "united states of america"}:
        alt_terms = ["usa", "u s a", "us", "u s", "america", "u s a"]
    elif country_norm in {"british virgin islands"}:
        alt_terms = ["bvi", "british virgin island"]
    elif country_norm in {"united arab emirates"}:
        alt_terms = ["uae"]
    elif country_norm in {"isle of man"}:
        alt_terms = ["iom", "isleofman"]
    elif country_norm in {"channel islands"}:
        alt_terms = ["jersey", "guernsey"]

    for term in alt_terms:
        if term in addr_norm:
            return True
    return False


def address_matches_country(address: Optional[str], country: Optional[str]) -> bool:
    if not address or not country:
        return False

    if address_mentions_country(address, country):
        return True

    addr_upper = str(address).upper()
    country_upper = str(country).upper().strip()
    postcode_prefixes = {
        "JERSEY": ["JE"],
        "GUERNSEY": ["GY"],
        "ISLE OF MAN": ["IM"],
    }
    for prefix in postcode_prefixes.get(country_upper, []):
        if re.search(rf"\b{re.escape(prefix)}\d", addr_upper):
            return True

    return False


def parse_float(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def iter_rows(conn: sqlite3.Connection) -> Iterable[sqlite3.Row]:
    cols = ["rowid", "property_title_number"]
    for i in range(1, 5):
        cols.extend([
            f"proprietor{i}_name",
            f"proprietor{i}_address",
            f"proprietor{i}_country_incorporated",
            f"proprietor{i}_lat",
            f"proprietor{i}_lon",
        ])
    sql = f"SELECT {', '.join(cols)} FROM {TABLE_NAME}"
    if LIMIT:
        sql += f" LIMIT {int(LIMIT)}"
    cursor = conn.cursor()
    cursor.execute(sql)
    for row in cursor:
        yield row


def get_total_rows(conn: sqlite3.Connection) -> int:
    cursor = conn.cursor()
    cursor.execute(f"SELECT COUNT(*) FROM {TABLE_NAME}")
    total = int(cursor.fetchone()[0])
    if LIMIT:
        return min(total, int(LIMIT))
    return total


def render_progress(current: int, total: int) -> None:
    if total <= 0:
        return
    width = 32
    filled = int(width * current / total)
    bar = "#" * filled + "-" * (width - filled)
    pct = (current / total) * 100
    sys.stdout.write(f"\r[{bar}] {pct:5.1f}% ({current}/{total})")
    sys.stdout.flush()
    if current >= total:
        sys.stdout.write("\n")


def main() -> None:
    conn = sqlite3.connect(current_db_file)
    conn.row_factory = sqlite3.Row

    total_rows = get_total_rows(conn)
    checked = 0
    real_wrong = 0
    bad_geoencode = 0
    scanned = 0
    updated = 0

    for row in iter_rows(conn):
        scanned += 1
        if scanned % PROGRESS_EVERY == 0 or scanned == total_rows:
            render_progress(scanned, total_rows)

        for i in range(1, 5):
            name = row[f"proprietor{i}_name"]
            if not name:
                continue

            country = row[f"proprietor{i}_country_incorporated"]
            if not country or is_uk_country(country):
                continue
            address = row[f"proprietor{i}_address"] or ""

            lat = parse_float(row[f"proprietor{i}_lat"])
            lon = parse_float(row[f"proprietor{i}_lon"])
            if lat is None or lon is None:
                continue

            if not address:
                continue

            checked += 1

            if is_within_uk(lat, lon):
                if address_matches_country(address, country):
                    bad_geoencode += 1
                    rowid = row["rowid"]
                    update_sql = (
                        f"UPDATE {TABLE_NAME} "
                        f"SET proprietor{i}_lat = NULL, proprietor{i}_lon = NULL "
                        "WHERE rowid = ?"
                    )
                    conn.execute(update_sql, (rowid,))
                    updated += 1
                    if updated % BATCH_COMMIT_SIZE == 0:
                        conn.commit()
                else:
                    real_wrong += 1

    if updated:
        conn.commit()
    conn.close()
    print("\nResults")
    print(f"Proprietors checked (non-UK country + address + coords): {checked}")
    print(f'Real wrong addresses (UK coords, address not in stated country): {real_wrong}')
    print(f"Bad geocode (UK coords, address matches stated country): {bad_geoencode}")
    print(f"Lat/lon cleared: {updated}")


if __name__ == "__main__":
    main()
