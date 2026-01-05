#!/usr/bin/env python3

"""
This script finds all the 'natures of control' in the database, and displays them
it also allocates an icon to each and exports all this to a json that the webapp can efficiently parse

"""
import sqlite3
import ast
import json
import yaml
from pathlib import Path
from tempfile import NamedTemporaryFile

from companies_house_settings import current_db_file

# yml is from:
# https://github.com/companieshouse/api-enumerations/blob/master/psc_descriptions.yml
DESCRIPTION_YML = "data_creator/psc_descriptions.yml"
OUTPUT_JSON = "webapp/overseas_entities_map_control_types.json"


ICON_MAP = {
    # Ownership of shares (>25%)
    "ownership-of-shares-more-than-25-percent-registered-overseas-entity": "finance_mode",
    "ownership-of-shares-more-than-25-percent-as-firm-registered-overseas-entity": "finance_mode",
    "ownership-of-shares-more-than-25-percent-as-control-over-trust-registered-overseas-entity": "finance_mode",
    "ownership-of-shares-more-than-25-percent-as-control-over-firm-registered-overseas-entity": "finance_mode",
    "ownership-of-shares-25-to-50-percent": "clock_loader_40",
    "ownership-of-shares-25-to-50-percent-as-firm": "clock_loader_40",
    "ownership-of-shares-50-to-75-percent": "clock_loader_80",
    "ownership-of-shares-75-to-100-percent": "clock_loader_90",
    "ownership-of-shares-75-to-100-percent-as-firm": "clock_loader_90",
    "ownership-of-shares-25-to-50-percent-as-trust": "clock_loader_40",
    "ownership-of-shares-75-to-100-percent-as-trust": "clock_loader_90",
    
    # Voting rights (>25%)
    "voting-rights-more-than-25-percent-registered-overseas-entity": "how_to_vote",
    "voting-rights-75-to-100-percent-as-trust": "how_to_vote",
    "voting-rights-more-than-25-percent-as-firm-registered-overseas-entity": "how_to_vote",
    "voting-rights-more-than-25-percent-as-control-over-trust-registered-overseas-entity": "how_to_vote",
    "voting-rights-more-than-25-percent-as-control-over-firm-registered-overseas-entity": "how_to_vote",
    "voting-rights-25-to-50-percent": "how_to_vote",
    "voting-rights-25-to-50-percent-as-firm": "how_to_vote",
    "voting-rights-25-to-50-percent-as-trust": "how_to_vote",
    "voting-rights-25-to-50-percent-limited-liability-partnership": "how_to_vote",
    "voting-rights-50-to-75-percent": "how_to_vote",
    "voting-rights-75-to-100-percent": "how_to_vote",
    "voting-rights-75-to-100-percent-as-firm": "how_to_vote",

    # Right to appoint/remove directors
    "right-to-appoint-and-remove-directors-registered-overseas-entity": "accessibility_new",
    "right-to-appoint-and-remove-directors": "accessibility_new",
    "right-to-appoint-and-remove-directors-as-firm": "accessibility_new",
    "right-to-appoint-and-remove-directors-as-trust": "accessibility_new",
    "right-to-appoint-and-remove-directors-as-firm-registered-overseas-entity": "accessibility_new",
    "right-to-appoint-and-remove-directors-as-control-over-trust-registered-overseas-entity": "accessibility_new",
    "right-to-appoint-and-remove-directors-as-control-over-firm-registered-overseas-entity": "accessibility_new",

    # Significant influence or control
    "significant-influence-or-control-registered-overseas-entity": "joystick",
    "significant-influence-or-control-as-firm-registered-overseas-entity": "joystick",
    "significant-influence-or-control-as-control-over-trust-registered-overseas-entity": "joystick",
    "significant-influence-or-control-as-control-over-firm-registered-overseas-entity": "joystick",
    "significant-influence-or-control": "joystick",
    "significant-influence-or-control-as-firm": "joystick",
    
    # Registered owner as NOMINEE (property context)
    "registered-owner-as-nominee-person-england-wales-registered-overseas-entity": "person_pin_circle",
    "registered-owner-as-nominee-person-scotland-registered-overseas-entity": "person_pin_circle",
    "registered-owner-as-nominee-another-entity-england-wales-registered-overseas-entity": "person_pin_circle",
    "registered-owner-as-nominee-another-entity-scotland-registered-overseas-entity": "person_pin_circle",
    
    # as trust
    "right-to-appoint-and-remove-directors-as-trust-registered-overseas-entity": "approval",
    "voting-rights-more-than-25-percent-as-trust-registered-overseas-entity": "approval",
    "ownership-of-shares-more-than-25-percent-as-trust-registered-overseas-entity": "approval",
    "significant-influence-or-control-as-trust-registered-overseas-entity": "approval",
    
    # LLP surplus assets
    "right-to-share-surplus-assets-25-to-50-percent-limited-liability-partnership": "diversity_3",
    "right-to-share-surplus-assets-75-to-100-percent-limited-liability-partnership": "diversity_3",
    
}

def load_psc_description_yml(yml_path: str = DESCRIPTION_YML) -> dict:
    """
    Loads the short_description section from the YAML into a dict {code: text}.
    """
    try:
        with open(yml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if not (data and isinstance(data.get("short_description"), dict)):
            raise ValueError("'short_description' section missing or not a dict")
        return data["short_description"]
    except FileNotFoundError:
        print(f"Error: YAML not found at {yml_path}")
        raise
    except yaml.YAMLError as e:
        print(f"Error parsing YAML: {e}")
        raise


def find_unique_natures_of_control(db_path: str) -> list[str]:
    """
    Scans entities.*_natures_of_control columns and returns a sorted list of unique codes.
    """
    # Column names: proprietor{1..4}_BO{1..4}_natures_of_control
    column_names = [
        f"proprietor{p}_BO{b}_natures_of_control"
        for p in range(1, 5)
        for b in range(1, 5)
    ]

    unique: set[str] = set()
    try:
        with sqlite3.connect(db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(f"SELECT {', '.join(column_names)} FROM entities")
            for row in cursor.fetchall():
                for value in row:
                    if not value:
                        continue
                    # Try Python literal first, fall back to JSON
                    parsed = None
                    try:
                        parsed = ast.literal_eval(value)
                    except (ValueError, SyntaxError):
                        try:
                            import json as _json
                            parsed = _json.loads(value)
                        except Exception:
                            print(f"⚠️  Warning: Could not parse value: {value!r}")
                            continue
                    if isinstance(parsed, list):
                        for item in parsed:
                            if isinstance(item, str):
                                unique.add(item)
                            elif item is not None:
                                print(f"⚠️  Non-string item ignored: {item!r}")
                    else:
                        print(f"⚠️  Expected list, got {type(parsed).__name__}: {parsed!r}")
    except sqlite3.OperationalError as e:
        print(f"❌ DB error on '{db_path}': {e}")
        return []

    return sorted(unique)


def write_json_atomic(path: Path, obj: dict) -> None:
    """
    Write JSON atomically to avoid truncated files.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=str(path.parent)) as tmp:
        json.dump(obj, tmp, ensure_ascii=False, indent=2, sort_keys=True)
        tmp.flush()
        # On POSIX this is atomic
        Path(tmp.name).replace(path)


def main():
    # 1) Load YAML mapping
    psc_short_descriptions = load_psc_description_yml()

    # 2) Get the set of codes actually used in the DB
    print(f"🔍 Searching for unique 'natures_of_control' in '{current_db_file}'...")
    used_codes = set(find_unique_natures_of_control(current_db_file))

    # 3) Intersect with YAML keys (only export what is present)
    yaml_codes = set(psc_short_descriptions.keys())
    export_codes = used_codes & yaml_codes

    # 4a) Log any mismatches to help you keep data tidy
    missing_in_yaml = used_codes - yaml_codes

    if missing_in_yaml:
        print("\n⚠️  Codes present in DB but NOT in YAML:")
        for c in sorted(missing_in_yaml):
            print(f"  - {c}")
        exit(1)


    # 4b) Ensure every exported code has an icon; if not, fail with a clear list
    missing_icon = sorted(code for code in export_codes if code not in ICON_MAP)
    if missing_icon:
        print("\n❌ Missing icons for these codes (add to ICON_MAP):")
        for c in missing_icon:
            print(f"  - {c}")
        exit(2)

    # 5) Assign stable numeric IDs (by sorted order) and build export mapping
    sorted_codes = sorted(export_codes)
    id_to_code = {str(i): code for i, code in enumerate(sorted_codes)}
    export_map = {
        code: {
            "icon": ICON_MAP[code],
            "description": psc_short_descriptions[code],
            "id": i
        }
        for i, code in enumerate(sorted_codes)
    }

    # Include reverse lookup for compact JSON encoding/decoding in the webapp
    export_map_wrapped = {
        "_ids": id_to_code,
        **export_map
    }

    # 6) Write JSON atomically
    out_path = Path(OUTPUT_JSON)
    write_json_atomic(out_path, export_map_wrapped)
    print(f"\n✅ Wrote {len(export_map)} items with icons to {out_path}")

    # 7) Optional: print a summary with safe lookup
    if export_map:
        print("\n--- Exported 'Natures of Control' (code → description) ---")
        for code in sorted(export_map):
            info = export_map[code]
            print(f"• [{info['id']:02d}] {code} — {info['description']}")

    if missing_in_yaml:
        # Exit non-zero if you want CI to catch missing keys
        # import sys; sys.exit(2)
        pass
    
    print("\nSuccess!")


if __name__ == "__main__":
    main()
