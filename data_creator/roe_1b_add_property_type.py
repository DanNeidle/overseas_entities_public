#!/usr/bin/env python3
import csv
import os
import re
import sqlite3
import sys
from collections import Counter
from difflib import SequenceMatcher
from typing import Dict, List, Optional, Tuple

from companies_house_settings import current_db_file

# suggest deleting this file after the script runs; it's very large!
PRICE_PAID_CSV = "data/pp-complete.csv"

print("\n\n*******STARTING\n")

TABLE_NAME = "entities"

OVERWRITE_FOUND_PROPERTY_TYPES = False
TARGET_PROPERTY_TITLE_NUMBER: Optional[str] = None
MAX_PROPERTIES_WITH_CANDIDATES: Optional[int] = None
STOP_AFTER_MISSES_WITH_CANDIDATES: Optional[int] = None


def die(message: str) -> None:
    print(f"ERROR: {message}")
    sys.exit(1)


def normalize(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    return trimmed.casefold()


ABBREVIATIONS = {
    "road": "rd",
    "street": "st",
    "avenue": "ave",
    "place": "pl",
    "lane": "ln",
    "drive": "dr",
    "court": "ct",
    "square": "sq",
    "flat": "flat",
    "apartment": "flat",
    "apt": "flat",
}

STOPWORDS = {"the", "at", "of"}


def normalise_address(addr: str) -> str:
    if not addr:
        return ""
    addr = addr.lower()
    for long, short in ABBREVIATIONS.items():
        addr = re.sub(rf"\b{long}\b", short, addr)
    addr = re.sub(r"[^\w\s]", " ", addr)
    addr = re.sub(r"\s+", " ", addr).strip()
    return addr


def extract_core_tokens(addr: str) -> Tuple[set[str], set[str]]:
    tokens = normalise_address(addr).split()
    numbers = {t for t in tokens if re.match(r"^\d{1,4}[a-z]?$", t)}
    words = {t for t in tokens if t.isalpha() and t not in STOPWORDS}
    return numbers, words


def token_jaccard_similarity(a: str, b: str) -> float:
    tokens_a = set(a.split())
    tokens_b = set(b.split())
    if not tokens_a or not tokens_b:
        return 0.0
    return len(tokens_a & tokens_b) / len(tokens_a | tokens_b)


def compare_addresses(roe_address: str, ppd_address: str) -> Tuple[bool, float, float]:
    if not roe_address or not ppd_address:
        return False, 0.0, 0.0
    roe_norm = normalise_address(roe_address)
    ppd_norm = normalise_address(ppd_address)
    jaccard = token_jaccard_similarity(roe_norm, ppd_norm)
    similarity = SequenceMatcher(None, roe_norm, ppd_norm).ratio()
    if roe_norm == ppd_norm:
        return True, jaccard, similarity
    roe_nums, roe_words = extract_core_tokens(roe_norm)
    ppd_nums, ppd_words = extract_core_tokens(ppd_norm)
    if roe_nums and ppd_nums and roe_nums.isdisjoint(ppd_nums):
        return False, jaccard, similarity
    shared_words = roe_words & ppd_words
    if roe_words and ppd_words and not shared_words:
        return False, jaccard, similarity
    min_words = min(len(roe_words), len(ppd_words))
    containment = (len(shared_words) / min_words) if min_words else 0.0
    if containment >= 0.6:
        return True, jaccard, similarity
    if jaccard >= 0.7:
        return True, jaccard, similarity
    return similarity >= 0.7, jaccard, similarity


def ensure_property_type_column(conn: sqlite3.Connection) -> None:
    cursor = conn.execute(f"PRAGMA table_info({TABLE_NAME})")
    columns = {row[1] for row in cursor.fetchall()}
    if "property_type" not in columns:
        conn.execute('ALTER TABLE entities ADD COLUMN "property_type" TEXT')
        conn.commit()
        print("Added missing property_type column.")
        columns.add("property_type")
    required = {
        "property_uk_address",
        "property_uk_postcode",
        "property_price_paid",
    }
    missing = required - columns
    if missing:
        die(f"Missing required DB columns: {', '.join(sorted(missing))}")


def build_pp_address(
    paon: Optional[str],
    saon: Optional[str],
    street: Optional[str],
    postcode: Optional[str],
) -> Optional[str]:
    parts = []
    for value in (paon, saon, street, postcode):
        if value is None:
            continue
        cleaned = value.strip()
        if cleaned:
            parts.append(cleaned)
    if not parts:
        return None
    return " ".join(parts)


def load_price_paid_types(
    path: str,
) -> Dict[Tuple[str, str], List[Tuple[str, Optional[str]]]]:
    property_types: Dict[Tuple[str, str], List[Tuple[str, Optional[str]]]] = {}

    with open(path, "r", newline="", encoding="utf-8") as csvfile:
        reader = csv.reader(csvfile)
        for row in reader:
            if len(row) < 10:
                continue
            price_paid = normalize(row[1])
            postcode = normalize(row[3])
            if not postcode or not price_paid:
                continue
            property_type = row[4].strip() if row[4].strip() else None
            address = build_pp_address(row[7], row[8], row[9], row[3])
            if not address:
                continue

            key = (postcode, price_paid)
            property_types.setdefault(key, []).append((address, property_type))

    return property_types


def update_property_types(
    conn: sqlite3.Connection,
    property_types: Dict[Tuple[str, str], List[Tuple[str, Optional[str]]]],
    overwrite_found_property_types: bool,
) -> None:
    cursor = conn.cursor()
    update_cursor = conn.cursor()
    type_counts: Counter[str] = Counter()
    matched = 0
    unmatched = 0
    missed_with_candidates = 0
    rows_without_candidates = 0
    processed_with_candidates = 0
    title_filter = ""
    title_params: Tuple[str, ...] = ()
    if TARGET_PROPERTY_TITLE_NUMBER:
        title_filter = " AND property_title_number = ?"
        title_params = (TARGET_PROPERTY_TITLE_NUMBER,)

    if TARGET_PROPERTY_TITLE_NUMBER:
        total_rows = conn.execute(
            f"SELECT COUNT(*) FROM {TABLE_NAME} WHERE property_title_number = ?",
            title_params,
        ).fetchone()[0]
    else:
        total_rows = conn.execute(f"SELECT COUNT(*) FROM {TABLE_NAME}").fetchone()[0]

    if overwrite_found_property_types:
        target_rows = total_rows
    else:
        if TARGET_PROPERTY_TITLE_NUMBER:
            target_rows = conn.execute(
                f"SELECT COUNT(*) FROM {TABLE_NAME} "
                f"WHERE property_type IS NULL{title_filter}",
                title_params,
            ).fetchone()[0]
        else:
            target_rows = conn.execute(
                f"SELECT COUNT(*) FROM {TABLE_NAME} WHERE property_type IS NULL"
            ).fetchone()[0]

    if overwrite_found_property_types:
        cursor.execute(
            f"SELECT rowid, property_title_number, property_uk_address, "
            f"property_uk_postcode, property_price_paid "
            f"FROM {TABLE_NAME} WHERE 1=1{title_filter}",
            title_params,
        )
    else:
        cursor.execute(
            f"SELECT rowid, property_title_number, property_uk_address, "
            f"property_uk_postcode, property_price_paid "
            f"FROM {TABLE_NAME} WHERE property_type IS NULL{title_filter}",
            title_params,
        )

    for rowid, title_number, address, postcode, price_paid in cursor:
        norm_postcode = normalize(postcode)
        norm_price_paid = normalize(price_paid)
        candidates = []
        if norm_postcode and norm_price_paid:
            candidates = property_types.get(
                (norm_postcode, norm_price_paid), []
            )
        if not candidates:
            rows_without_candidates += 1
            continue
        if (
            MAX_PROPERTIES_WITH_CANDIDATES is not None
            and processed_with_candidates >= MAX_PROPERTIES_WITH_CANDIDATES
        ):
            break
        processed_with_candidates += 1

        print("")
        print(f"Title: {title_number}")
        print(f"Address: {address}")
        print(f"Postcode: {postcode}")
        print(f"Price paid: {price_paid}")

        match_found = False
        match_type: Optional[str] = None
        if address and candidates:
            for candidate_address, candidate_type in candidates:
                is_match, jaccard, similarity = compare_addresses(
                    address, candidate_address
                )
                print(
                    f"Candidate: {candidate_address} | "
                    f"type: {candidate_type} | "
                    f"match: {is_match} | "
                    f"jaccard: {jaccard:.3f} | "
                    f"sequence: {similarity:.3f}"
                )
                if is_match and not match_found:
                    match_found = True
                    match_type = candidate_type

        if match_found:
            update_cursor.execute(
                f"UPDATE {TABLE_NAME} SET property_type = ? WHERE rowid = ?",
                (match_type, rowid),
            )
            matched += 1
            if match_type:
                type_counts[match_type] += 1
            if match_type:
                print(f"Result: MATCH -> {match_type}")
            else:
                print("Result: MATCH -> no property type")
        else:
            update_cursor.execute(
                f"UPDATE {TABLE_NAME} SET property_type = NULL WHERE rowid = ?",
                (rowid,),
            )
            unmatched += 1
            print("Result: NO MATCH")
            missed_with_candidates += 1
            if (
                STOP_AFTER_MISSES_WITH_CANDIDATES is not None
                and missed_with_candidates >= STOP_AFTER_MISSES_WITH_CANDIDATES
            ):
                conn.commit()
                print(
                    "Stopping after "
                    f"{STOP_AFTER_MISSES_WITH_CANDIDATES} "
                    "postcode/price hits with address misses."
                )
                sys.exit(0)

    conn.commit()

    print(f"Total matched: {matched}")
    print(f"Total not matched: {unmatched}")
    print(f"Total processed (with candidates): {processed_with_candidates}")
    print(f"Total skipped (property_type set): {total_rows - target_rows}")
    print(f"Total skipped (no candidates): {rows_without_candidates}")
    print("Property type counts:")
    for property_type, count in type_counts.most_common():
        print(f"{property_type}: {count}")


def main() -> None:
    if not os.path.exists(PRICE_PAID_CSV):
        die(f"{PRICE_PAID_CSV} not found")
    if not os.path.exists(current_db_file):
        die(f"Database not found: {current_db_file}")

    conn = sqlite3.connect(current_db_file)
    try:
        ensure_property_type_column(conn)
        print(f"Loading price paid data from {PRICE_PAID_CSV}...")
        property_types = load_price_paid_types(PRICE_PAID_CSV)
        print(f"Loaded {len(property_types):,} postcode/price pairs.")
        update_property_types(conn, property_types, OVERWRITE_FOUND_PROPERTY_TYPES)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
