#!/usr/bin/env python3
import csv
import json
import msgpack
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple, Any, TypedDict

from shapely.geometry import Point, shape
from shapely.ops import unary_union
from shapely.prepared import prep

from roe_common_functions import upload_all_files


BRAND_COLOR = "#1133AF"  # TPAL brand
# TPAL brand logo URL
TPAL_LOGO = "https://taxpolicy.org.uk/wp-content/assets/logo_full_white_on_blue.jpg"

# -----------------------------------------------------------------------------
# Settings (edit these when running from VS Code)
# -----------------------------------------------------------------------------
# CSV_PATH: Path to the combined stats CSV export produced earlier in the data
# pipeline. If set to None, the script uses the default at
# <repo_root>/webapp/overseas_entities_stats.csv (current default behaviour).
CSV_PATH: str | Path | None = None

# OUTPUT_DIR: Directory where generated charts will be written (JSON).
OUTPUT_DIR: str | Path = "charts"

# TOP_TRUSTEES_CSV: Optional override for the trustee export path. Defaults to
# <repo_root>/webapp/top_trustees.csv when left as None.
TOP_TRUSTEES_CSV: Path | None = None

# TRUSTEES_TO_CHART: Number of trustee organisations to display in the bar
# chart of suspected ownership hiders.
TRUSTEES_TO_CHART: int = 40

# TOP_N_COUNTRIES: For the country comparison charts, show the top N countries
# by combined "bad" percentage/count (excludes the "OK" category).
TOP_N_COUNTRIES: int = 100

# MIN_TOTAL_PER_COUNTRY: Minimum number of proprietors required for a country
# to be included in the rankings. Helps avoid noisy 100% bars for tiny samples.
MIN_TOTAL_PER_COUNTRY: int = 50

# CATEGORY_TOP_N: For per-category country charts, show the top N countries.
CATEGORY_TOP_N: int = 40

# Minimum absolute proprietors per category-country to display in treemap
TREEMAP_CUTOFF: int = 10
# Threshold below which treemap labels shrink to fit smaller tiles
TREEMAP_SIZE_TO_SHRINK_FONT: int = 2000
TREEMAP_SIZE_TO_SHRINK_FONT_SIZE: int = 20

TREEMAP_SIZE_TO_SHRINK_FONT_MORE: int = 400
TREEMAP_SIZE_TO_SHRINK_FONT_MORE_SIZE: int = 8

TREEMAP_SIZE: int = 50

CATEGORY_SIZE: int = 50

# Threshold below which country label is omitted (number only)
TREEMAP_SIZE_TO_SKIP_LABEL: int = 200

# Readable category colors
CATEGORY_COLORS = {
    "Proprietor not registered": "#939699",                 # Grey
    "No beneficial owner declared": "#DD8452",              # Orange
    "True beneficial owner hidden": "#C44E52",             # Red
    "Only trustees listed as beneficial owners": "#4C72B0", # Blue
    "Ownership properly disclosed": "#1B5E20",             # Dark green
}

PROPERTY_TYPE_ORDER = ["D", "S", "T", "F", "O"]
PROPERTY_TYPE_LABELS = {
    "D": "Detached",
    "S": "Semi-detached",
    "T": "Terraced",
    "F": "Flats",
    "O": "Other",
}

PROPERTY_STATUS_ORDER = ["red", "grey", "orange", "blue", "green"]
PROPERTY_STATUS_LABELS = {
    "red": "Hidden BO",
    "grey": "Failed to register",
    "orange": "No BO registered",
    "blue": "Only trustees registered",
    "green": "BOs disclosed",
}
PROPERTY_STATUS_COLORS = {
    "green": "#6ACC64",
    "orange": "#DD8452",
    "red": "#C44E52",
    "grey": "#939699",
    "purple": "#563d7c",
    "blue": "#4C72B0",
}
PROPERTY_STATUS_EXCLUDE = {"purple"}
PROPERTY_VALUE_YEARS = (2023, 2024, 2025)
WEBAPP_DIR = Path("webapp")
PROPERTIES_DATA_BASENAME = "overseas_entities_properties"
PROPRIETORS_DATA_BASENAME = "overseas_entities_proprietors"
PROPERTIES_DATA_INFO = "overseas_entities_data_info.txt"
REGIONS_GEOJSON_PATH = Path("data/uk_nuts1_ew.json")

REGION_ORDER = [
    "London",
    "South East",
    "East",
    "South West",
    "Midlands",
    "North East",
    "North West",
    "Yorkshire",
    "Wales",
]

REGION_NAME_MAP = {
    "london": "London",
    "south east": "South East",
    "south west": "South West",
    "east of england": "East",
    "east midlands": "Midlands",
    "west midlands": "Midlands",
    "north east": "North East",
    "north west": "North West",
    "yorkshire and the humber": "Yorkshire/Humber",
    "wales": "Wales",
}

class PriceStats(TypedDict):
    total: int
    sample_value_sum: int
    sample_title_count: int
    sample_transactions: int


class RegionPriceStats(TypedDict):
    total: int
    sample_value_sum: int
    sample_title_count: int
    estimate: int


def fade_hex(hex_color: str, factor: float) -> str:
    """Return a lighter variant of a hex color by blending towards white."""
    color = hex_color.lstrip("#")
    if len(color) != 6:
        return hex_color
    r = int(color[0:2], 16)
    g = int(color[2:4], 16)
    b = int(color[4:6], 16)
    factor = max(0.0, min(1.0, factor))
    r = int(r + (255 - r) * factor)
    g = int(g + (255 - g) * factor)
    b = int(b + (255 - b) * factor)
    return f"#{r:02X}{g:02X}{b:02X}"


# Shorten or normalise country display names for crowded x-axes
def display_country_label(country: str) -> str:
    name = (country or "").strip()
    if name.upper() == "AVERAGE":
        return "Average"
    if name.isupper() and len(name) <= 4:
        return name
    mapping = {
        "united arab emirates": "UAE",
        "u.s.a": "USA",
        "marshall islands": "Marshall Is",
        "british virgin islands": "BVI",
        "turks and caicos islands": "Turks & Caicos",
        "st vincent and grenadines": "St Vincent",
        "cayman islands": "Cayman",
        "st kitts and nevis": "St Kitts",
        "isle of man": "Isle of Man",
    }
    key = name.lower()
    if key in mapping:
        return mapping[key]
    # Default to simple title case
    return name.title()


def parse_sections(lines: List[str]) -> Dict[str, List[str]]:
    """Split the combined CSV export into logical tables by their section markers.

    Returns a dict keyed by section name, with CSV lines (including header) as values.
    """
    sections: Dict[str, List[str]] = {}

    # Normalize line endings and strip BOM/whitespace
    lines = [l.strip("\n\r").lstrip("\ufeff") for l in lines]

    def collect_from(start_idx: int) -> Tuple[List[str], int]:
        buf: List[str] = []
        i = start_idx
        # Skip optional blank line following the marker
        while i < len(lines) and lines[i] == "":
            i += 1
        # First non-blank is expected to be a header
        if i < len(lines):
            buf.append(lines[i])
            i += 1
        # Collect until blank line or next section marker
        while i < len(lines):
            if lines[i] == "" or lines[i].startswith("--- "):
                break
            buf.append(lines[i])
            i += 1
        return buf, i

    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("--- Yearly Analysis ---"):
            data, i = collect_from(i + 1)
            sections["yearly"] = data
            continue
        if line.startswith("--- Property Type Analysis ---"):
            data, i = collect_from(i + 1)
            sections["property_type"] = data
            continue
        if line.startswith("--- Category Breakdown by Proprietor Country ---"):
            data, i = collect_from(i + 1)
            # Skip optional leading notes rows like "Note:,..."
            if data and data[0].startswith("Note:"):
                # Header will be next line
                data = data[1:]
            sections["country"] = data
            continue
        if line.startswith("--- Category Breakdown by Proprietor Country (Property Value) ---"):
            data, i = collect_from(i + 1)
            if data and data[0].startswith("Note:"):
                data = data[1:]
            sections["country_value"] = data
            continue
        i += 1

    return sections


# Parse an integer-like string (handling commas, percents, blanks, and dashes) into an int.
def parse_int(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    value = str(value).strip()
    if value == "" or value == "-":
        return 0
    # Remove commas and percent signs
    value = value.replace(",", "").replace("%", "").replace("£", "")
    try:
        return int(float(value))
    except ValueError:
        return 0


def fmt_int(value: int) -> str:
    return f"{value:,}"


def fmt_pct(value: float, digits: int = 1) -> str:
    return f"{value:.{digits}f}%"


def fmt_money(value: int) -> str:
    return f"£{value:,}"


def to_billions(value: int) -> int:
    return int(round(value / 1_000_000_000))


def fmt_money_bn(value: int) -> str:
    return f"£{to_billions(value):,}bn"



def parse_float(value: Any) -> float | None:
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


def _read_data_manifest_hash(webapp_dir: Path) -> str | None:
    info_path = webapp_dir / PROPERTIES_DATA_INFO
    if not info_path.exists():
        return None
    lines = info_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    if len(lines) >= 2:
        hash_id = lines[1].strip()
        if hash_id:
            return hash_id
    return None


def _find_msgpack_path(repo_root: Path, basename: str) -> Path:
    webapp_dir = repo_root / WEBAPP_DIR
    hash_id = _read_data_manifest_hash(webapp_dir)
    if hash_id:
        candidate = webapp_dir / f"{basename}.{hash_id}.msgpack"
        if candidate.exists():
            return candidate

    matches = sorted(webapp_dir.glob(f"{basename}.*.msgpack"))
    if matches:
        return max(matches, key=lambda p: p.stat().st_mtime)

    plain = webapp_dir / f"{basename}.msgpack"
    if plain.exists():
        return plain

    raise SystemExit(f"Msgpack data not found in {webapp_dir} for {basename}")


def find_properties_msgpack_path(repo_root: Path) -> Path:
    return _find_msgpack_path(repo_root, PROPERTIES_DATA_BASENAME)


def find_proprietors_msgpack_path(repo_root: Path) -> Path:
    return _find_msgpack_path(repo_root, PROPRIETORS_DATA_BASENAME)


def load_msgpack(path: Path) -> Any:
    try:
        return msgpack.unpackb(path.read_bytes(), raw=False, strict_map_key=False)
    except Exception as exc:
        raise SystemExit(f"Failed to decode msgpack data at {path}: {exc}") from exc


def parse_date_year(value: Any) -> int | None:
    if not value:
        return None
    try:
        return datetime.strptime(str(value).strip(), "%d-%m-%Y").year
    except (ValueError, TypeError):
        return None


def property_proprietor_key(prop: Dict[str, Any], proprietors: Dict[str, Any]) -> str:
    ids = prop.get("ps") or []
    names: List[str] = []
    for pid in ids:
        key = str(pid)
        proprietor = proprietors.get(key)
        if not proprietor:
            continue
        name = proprietor.get("n")
        if not name:
            continue
        cleaned = str(name).strip().upper()
        if cleaned:
            names.append(cleaned)
    if not names:
        return ""
    return "|".join(sorted(set(names)))


def normalize_region_name(raw: str) -> str:
    name = (raw or "").strip()
    name = name.replace("(England)", "").replace("(England", "").strip()
    while "  " in name:
        name = name.replace("  ", " ")
    return name


def map_region_label(raw: str) -> str | None:
    name = normalize_region_name(raw)
    if not name:
        return None
    return REGION_NAME_MAP.get(name.lower())


def load_region_geometries(path: Path) -> Dict[str, Any]:
    if not path.exists():
        raise SystemExit(f"Region boundaries not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
    features = data.get("features", [])
    geoms_by_label: Dict[str, List[Any]] = {}
    for feat in features:
        props = feat.get("properties", {}) or {}
        raw_name = (
            props.get("NUTS112NM")
            or props.get("NUTS_NAME")
            or props.get("name")
            or ""
        )
        label = map_region_label(str(raw_name))
        if not label:
            continue
        geom = shape(feat.get("geometry"))
        if geom.is_empty:
            continue
        geoms_by_label.setdefault(label, []).append(geom)

    prepared: Dict[str, Any] = {}
    for label, geoms in geoms_by_label.items():
        merged = unary_union(geoms) if len(geoms) > 1 else geoms[0]
        prepared[label] = prep(merged)
    return prepared


def region_for_point(lat: float, lon: float, region_geoms: Dict[str, Any]) -> str | None:
    pt = Point(lon, lat)
    for region in REGION_ORDER:
        geom = region_geoms.get(region)
        if geom and geom.intersects(pt):
            return region
    return None


def estimate_property_values(
    properties: List[Dict[str, Any]],
    proprietors: Dict[str, Any],
    years: Tuple[int, ...] = PROPERTY_VALUE_YEARS,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    stats: Dict[str, PriceStats] = {
        status: {
            "total": 0,
            "sample_value_sum": 0,
            "sample_title_count": 0,
            "sample_transactions": 0,
        }
        for status in PROPERTY_STATUS_ORDER
    }
    total_count = 0
    total_sample_sum = 0
    total_sample_titles = 0
    seen_transactions: set[tuple[int, str, str]] = set()
    dropped_duplicates = 0
    dropped_value = 0

    for prop in properties:
        status = str(prop.get("st") or "green").strip().lower()
        if status in PROPERTY_STATUS_EXCLUDE:
            continue
        if status not in stats:
            continue

        stats[status]["total"] += 1
        total_count += 1

        prop_year = parse_date_year(prop.get("dt"))
        if prop_year not in years:
            continue

        price = parse_int(prop.get("pr"))
        if price <= 0:
            continue

        stats[status]["sample_title_count"] += 1
        total_sample_titles += 1

        prop_name = property_proprietor_key(prop, proprietors)
        date_str = str(prop.get("dt") or "").strip()
        if prop_name:
            trans_key = (price, date_str, prop_name)
            if trans_key in seen_transactions:
                dropped_duplicates += 1
                dropped_value += price
                continue
            seen_transactions.add(trans_key)

        stats[status]["sample_value_sum"] += price
        stats[status]["sample_transactions"] += 1
        total_sample_sum += price

    entries: List[Dict[str, Any]] = []
    for status in PROPERTY_STATUS_ORDER:
        data = stats[status]
        label = PROPERTY_STATUS_LABELS.get(status, status.title())
        sample_titles = data["sample_title_count"]
        if sample_titles <= 0:
            raise SystemExit(f"ERROR: No price data for {label} properties in {', '.join(map(str, years))}.")
        average = data["sample_value_sum"] / sample_titles
        estimate = int(round(average * data["total"]))
        entries.append(
            {
                "status": status,
                "label": label,
                "total_count": data["total"],
                "sample_count": sample_titles,
                "sample_sum": data["sample_value_sum"],
                "estimate": estimate,
            }
        )

    if total_sample_titles <= 0:
        raise SystemExit(f"ERROR: No price data for non-sanctioned properties in {', '.join(map(str, years))}.")

    total_average = total_sample_sum / total_sample_titles
    total_estimate = int(round(total_average * total_count))
    total_entry = {
        "label": "Total",
        "total_count": total_count,
        "sample_count": total_sample_titles,
        "sample_sum": total_sample_sum,
        "estimate": total_estimate,
    }

    if dropped_duplicates:
        print(f"Deduplication complete: Ignored {fmt_int(dropped_duplicates)} duplicate price entries.")
        print(f"Deduplication removed {fmt_money(dropped_value)} ({fmt_money_bn(dropped_value)}) of price data.")
    else:
        print("Deduplication complete: No duplicate price entries detected.")

    return entries, total_entry


def print_estimated_property_values(entries: List[Dict[str, Any]], total_entry: Dict[str, Any], years: Tuple[int, ...]) -> None:
    years_label = ", ".join(map(str, years))
    print(f"\nEstimated property values (all years, derived from {years_label} price-paid data)")
    for entry in entries:
        print(
            f"{entry['label']}: {fmt_money_bn(entry['estimate'])} "
            f"(from a sample of {fmt_int(entry['sample_count'])} properties; "
            f"total properties: {fmt_int(entry['total_count'])})"
        )
    print(
        f"{total_entry['label']}: {fmt_money_bn(total_entry['estimate'])} "
        f"(from a sample of {fmt_int(total_entry['sample_count'])} properties; "
        f"total properties: {fmt_int(total_entry['total_count'])})"
    )


def estimate_property_values_by_region(
    properties: List[Dict[str, Any]],
    region_geoms: Dict[str, Any],
    proprietors: Dict[str, Any],
    years: Tuple[int, ...] = PROPERTY_VALUE_YEARS,
) -> Dict[str, Dict[str, RegionPriceStats]]:
    stats: Dict[str, Dict[str, RegionPriceStats]] = {
        region: {
            status: {"total": 0, "sample_value_sum": 0, "sample_title_count": 0, "estimate": 0}
            for status in PROPERTY_STATUS_ORDER
        }
        for region in REGION_ORDER
    }
    seen_transactions: Dict[str, set[tuple[int, str, str]]] = {
        region: set() for region in REGION_ORDER
    }

    for prop in properties:
        status = str(prop.get("st") or "green").strip().lower()
        if status in PROPERTY_STATUS_EXCLUDE or status not in PROPERTY_STATUS_ORDER:
            continue

        lat = parse_float(prop.get("lat"))
        lon = parse_float(prop.get("lon"))
        if lat is None or lon is None:
            continue

        region = region_for_point(lat, lon, region_geoms)
        if not region:
            continue

        stats[region][status]["total"] += 1

        prop_year = parse_date_year(prop.get("dt"))
        if prop_year not in years:
            continue

        price = parse_int(prop.get("pr"))
        if price <= 0:
            continue

        stats[region][status]["sample_title_count"] += 1

        prop_name = property_proprietor_key(prop, proprietors)
        date_str = str(prop.get("dt") or "").strip()
        if prop_name:
            trans_key = (price, date_str, prop_name)
            if trans_key in seen_transactions[region]:
                continue
            seen_transactions[region].add(trans_key)

        stats[region][status]["sample_value_sum"] += price

    for region in REGION_ORDER:
        for status in PROPERTY_STATUS_ORDER:
            data = stats[region][status]
            sample_titles = data["sample_title_count"]
            if data["total"] <= 0 or sample_titles <= 0:
                data["estimate"] = 0
                continue
            average = data["sample_value_sum"] / sample_titles
            data["estimate"] = int(round(average * data["total"]))

    return stats


def make_estimated_property_values_regions_chart(
    region_stats: Dict[str, Dict[str, RegionPriceStats]],
) -> Dict[str, Any]:
    regions = REGION_ORDER
    series: List[Dict[str, Any]] = []

    for status in PROPERTY_STATUS_ORDER:
        label = PROPERTY_STATUS_LABELS.get(status, status.title())
        values: List[float] = []
        tooltip_html: List[str] = []
        for region in regions:
            data = region_stats[region][status]
            estimate = data["estimate"]
            values.append(float(to_billions(estimate)))
            tooltip_html.append(
                f"{region}<br>{label}<br>Estimated value: {fmt_money_bn(estimate)}"
                f"<br>From a sample of {fmt_int(data['sample_title_count'])}"
            ) 

        series.append(
            build_bar_series(
                label,
                values,
                tooltip_html=tooltip_html,
                color=PROPERTY_STATUS_COLORS.get(status, BRAND_COLOR),
                stack="total",
            )
        )

    option = base_option("Overseas entities - estimated property values by region")
    option.update(
        {
            "legend": {"show": True, "top": 55, "left": "center"},
            "grid": {"left": "8%", "right": "5%", "top": 110, "bottom": "12%", "containLabel": True},
            "xAxis": {
                "type": "category",
                "data": regions,
                "axisLabel": {"interval": 0},
                "axisTick": {"alignWithLabel": True},
            },
            "yAxis": {
                "type": "value",
                "name": "",
                "axisLabel": {"formatter": "£{value}bn"},
                "splitLine": {"show": True, "lineStyle": {"color": "#ececec"}},
            },
            "series": series,
        }
    )
    return option


def load_top_trustees(csv_path: Path, limit: int) -> List[Tuple[str, int, int]]:
    if not csv_path.exists():
        return []

    with csv_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = set(reader.fieldnames or [])
        has_split_counts = {"properties_with_BO", "properties_without_BO"}.issubset(fieldnames)
        rows: List[Tuple[str, int, int]] = []
        for row in reader:
            name = (row.get("trustee_name") or "").strip()
            if not name:
                continue
            if has_split_counts:
                with_bo = parse_int(row.get("properties_with_BO", "0"))
                without_bo = parse_int(row.get("properties_without_BO", "0"))
            else:
                without_bo = parse_int(row.get("property_count", "0"))
                with_bo = 0

            if with_bo <= 0 and without_bo <= 0:
                continue
            rows.append((name, with_bo, without_bo))

    rows.sort(key=lambda item: (-item[2], -item[1], item[0].lower()))
    return rows[:limit]


def load_yearly(
    lines: List[str],
) -> Tuple[List[str], Dict[str, Dict[str, int]], Dict[str, int], int | None]:
    """Load the yearly table.

    Returns (years, data_by_category, overall_by_category, overall_total) where:
    - data_by_category[category][year] = count
    - overall_by_category[category] = overall total for that category (includes unknown dates)
    - overall_total = overall total for all proprietors (includes unknown dates)
    """
    reader = csv.DictReader(lines)
    # Identify year-like columns (exclude metadata columns)
    all_fields = [f for f in reader.fieldnames or []]
    overall_field = "Overall Total" if "Overall Total" in all_fields else None
    year_fields = [
        f for f in all_fields if f not in {"Category", "Overall Total", "Overall %"}
    ]

    totals_by_year: Dict[str, int] = {}
    overall_total: int | None = None
    total_row_names = {"Total properties", "Total proprietors"}
    data_by_category: Dict[str, Dict[str, int]] = {}
    overall_by_category: Dict[str, int] = {}

    for row in reader:
        category = row.get("Category", "").strip()
        # Skip checksum/notes
        if not category or category.startswith("Note"):
            continue
        if category == "Category Sum Check":
            continue
        counts = {year: parse_int(row.get(year, "")) for year in year_fields}
        overall_val = parse_int(row.get(overall_field, "")) if overall_field else None
        if category in total_row_names:
            totals_by_year = counts
            if overall_val is not None:
                overall_total = overall_val
        else:
            data_by_category[category] = counts
            if overall_val is not None:
                overall_by_category[category] = overall_val

    years = year_fields
    if not totals_by_year:
        raise ValueError("Could not find 'Total properties' or 'Total proprietors' row in yearly table")

    # Ensure every category has all years filled (default 0)
    for cat in list(data_by_category.keys()):
        for y in years:
            data_by_category[cat].setdefault(y, 0)

    # Attach totals as a pseudo-category if needed
    data_by_category["__TOTALS__"] = totals_by_year
    return years, data_by_category, overall_by_category, overall_total


def load_property_type(
    lines: List[str],
) -> Tuple[List[str], Dict[str, Dict[str, int]], Dict[str, int], int]:
    """Load the property type analysis table.

    Returns (types, data_by_category, overall_by_category, overall_total) where:
    - data_by_category[category][type_code] = count
    - overall_by_category[category] = overall total for that category (includes null)
    - overall_total = overall total for all properties (includes null)
    """
    reader = csv.DictReader(lines)
    type_fields = [f for f in (reader.fieldnames or []) if f != "Category"]

    totals_by_type: Dict[str, int] = {}
    data_by_category: Dict[str, Dict[str, int]] = {}

    for row in reader:
        category = row.get("Category", "").strip()
        if not category or category.startswith("Note"):
            continue
        if category == "Category Sum Check":
            continue
        counts = {t: parse_int(row.get(t, "")) for t in type_fields}
        if category == "Total properties":
            totals_by_type = counts
        else:
            data_by_category[category] = counts

    if not totals_by_type:
        raise ValueError("Could not find 'Total properties' row in property type table")

    for cat in list(data_by_category.keys()):
        for t in type_fields:
            data_by_category[cat].setdefault(t, 0)

    overall_by_category = {
        cat: sum(counts.get(t, 0) for t in type_fields)
        for cat, counts in data_by_category.items()
    }
    overall_total = sum(totals_by_type.get(t, 0) for t in type_fields)

    data_by_category["__TOTALS__"] = totals_by_type
    return type_fields, data_by_category, overall_by_category, overall_total


def load_country(lines: List[str]) -> List[Dict[str, int | str]]:
    """Load the country breakdown table.

    Returns a list of row dicts with keys: Country, Each category, Total
    """
    reader = csv.DictReader(lines)
    rows: List[Dict[str, int | str]] = []
    for row in reader:
        country = row.get("Country", "").strip()
        if not country:
            continue
        # Skip note lines and the aggregate TOTAL row which is not a country
        upper_country = country.upper()
        if upper_country in {"NOTE:", "TOTAL"}:
            continue
        out: Dict[str, int | str] = {"Country": country}
        for k, v in row.items():
            if k == "Country":
                continue
            out[k] = parse_int(v)
        rows.append(out)
    return rows


def brand_graphic() -> List[Dict[str, Any]]:
    return [
        {
            "type": "image",
            "id": "tpa-logo",
            "right": "3%",
            "top": 10,
            "style": {
                "image": TPAL_LOGO,
                "width": 120,
                "height": 36,
                "opacity": 0.95,
            },
        }
    ]


def base_option(title: str, subtitle: str | None = None) -> Dict[str, Any]:
    option: Dict[str, Any] = {
        "title": {
            "text": title,
            "left": "2%",
            "top": 10,
            "textAlign": "left",
            "textStyle": {"fontSize": 20},
        },
        "textStyle": {
            "fontFamily": "Inter, Segoe UI, Roboto, Arial",
            "color": "#111",
        },
        "tooltip": {"trigger": "item"},
        "graphic": brand_graphic(),
    }
    if subtitle:
        option["title"]["subtext"] = subtitle
        option["title"]["subtextStyle"] = {"fontSize": 12, "color": "#555"}
    return option


def build_bar_series(
    name: str,
    values: List[float],
    tooltip_html: List[str] | None = None,
    color: str | None = None,
    stack: str | None = None,
    label_texts: List[str] | None = None,
    item_colors: List[str] | None = None,
    label_color: str = "#FFFFFF",
    label_font_size: int = 11,
) -> Dict[str, Any]:
    data: List[Dict[str, Any]] = []
    for idx, val in enumerate(values):
        item: Dict[str, Any] = {"value": val}
        if tooltip_html is not None:
            item["tooltip"] = {"formatter": tooltip_html[idx]}
        if item_colors is not None:
            item["itemStyle"] = {"color": item_colors[idx]}
        if label_texts is not None:
            text = label_texts[idx]
            if text:
                item["label"] = {
                    "show": True,
                    "formatter": text,
                    "color": label_color,
                    "fontSize": label_font_size,
                }
            else:
                item["label"] = {"show": False}
        data.append(item)

    series: Dict[str, Any] = {
        "name": name,
        "type": "bar",
        "data": data,
    }
    if stack:
        series["stack"] = stack
    if color and item_colors is None:
        series["itemStyle"] = {"color": color}
    if label_texts is not None:
        series["label"] = {
            "position": "inside",
            "align": "center",
            "verticalAlign": "middle",
        }
    return series


def make_estimated_property_values_chart(
    entries: List[Dict[str, Any]],
) -> Dict[str, Any]:
    labels = [entry["label"] for entry in entries]
    values = [float(to_billions(entry["estimate"])) for entry in entries]
    tooltip_html = [
        (
            f"{entry['label']}<br>Estimated value: {fmt_money_bn(entry['estimate'])}"
            f"<br>From a sample of {fmt_int(entry['sample_count'])}"
        )
        for entry in entries
    ]

    item_colors = [PROPERTY_STATUS_COLORS.get(entry["status"], BRAND_COLOR) for entry in entries]

    series = [
        build_bar_series(
            "Estimated property value",
            values,
            tooltip_html=tooltip_html,
            item_colors=item_colors,
        )
    ]

    option = base_option("Overseas entities - estimated property values by category")
    option.update(
        {
            "legend": {"show": False},
            "grid": {"left": "8%", "right": "5%", "top": 70, "bottom": "10%", "containLabel": True},
            "xAxis": {
                "type": "category",
                "data": labels,
                "axisLabel": {"interval": 0},
                "axisTick": {"alignWithLabel": True},
            },
            "yAxis": {
                "type": "value",
                "name": "",
                "axisLabel": {"formatter": "£{value}bn"},
                "splitLine": {"show": True, "lineStyle": {"color": "#ececec"}},
            },
            "series": series,
        }
    )
    return option


# Build a stacked percentage bar chart by year, excluding the "Ownership properly disclosed" category.
def make_yearly_chart(
    years: List[str],
    data_by_category: Dict[str, Dict[str, int]],
    overall_by_category: Dict[str, int] | None = None,
    overall_total: int | None = None,
) -> Dict[str, Any]:
    totals = data_by_category.get("__TOTALS__", {})
    # Exclude OK so the stack reflects only "bad" categories
    categories = [c for c in data_by_category.keys() if c not in {"__TOTALS__", "Ownership properly disclosed"}]

    totals_per_year = {y: max(totals.get(y, 0), 1) for y in years}
    overall_sum = sum(totals.get(y, 0) for y in years)
    overall_total_value = overall_total if overall_total and overall_total > 0 else overall_sum
    overall_total_value = max(overall_total_value, 1)
    overall_by_category = overall_by_category or {}

    # Fixed order: Up to 2022, 2023, 2024, 2025 (case-insensitive match)
    desired = ["up to 2022", "2023", "2024", "2025"]
    norm = {y: y.lower() for y in years}
    order_index = {y: (desired.index(norm[y]) if norm[y] in desired else 999) for y in years}
    sorted_years = sorted(years, key=lambda y: (order_index[y], y))
    total_label = "All years"
    x_labels = sorted_years + [total_label]

    series: List[Dict[str, Any]] = []
    for cat in categories:
        abs_vals = [data_by_category[cat].get(y, 0) for y in years]
        per_label_abs = {y: a for y, a in zip(years, abs_vals)}

        overall_abs_cat = overall_by_category.get(cat, sum(abs_vals))
        overall_pct_cat = (overall_abs_cat / overall_total_value * 100.0) if overall_total_value else 0.0

        values: List[float] = []
        tooltip_html: List[str] = []
        for lbl in x_labels:
            if lbl == total_label:
                abs_n = overall_abs_cat
                total_n = overall_total_value
                pct = overall_pct_cat
            else:
                abs_n = per_label_abs.get(lbl, 0)
                total_n = totals_per_year.get(lbl, 1)
                pct = (abs_n / total_n * 100.0) if total_n else 0.0

            values.append(pct)

            tooltip_html.append(
                f"{lbl}<br>{cat}<br>{fmt_int(abs_n)}/{fmt_int(total_n)} ({fmt_pct(pct)})"
            )

        series.append(
            build_bar_series(
                cat,
                values,
                tooltip_html=tooltip_html,
                color=CATEGORY_COLORS.get(cat, BRAND_COLOR),
                stack="bad",
            )
        )

    option = base_option("Overseas entities — category share by year")
    option.update(
        {
            "legend": {"show": True, "top": 55, "left": "center"},
            "grid": {"left": "2%", "right": "2%", "top": 90, "bottom": "5%", "containLabel": True},
            "xAxis": {
                "type": "category",
                "data": x_labels,
                "axisLabel": {"interval": 0},
                "axisTick": {"alignWithLabel": True},
            },
            "yAxis": {
                "type": "value",
                "axisLabel": {"formatter": "{value}%"},
                "splitLine": {"show": True, "lineStyle": {"color": "#ececec"}},
            },
            "series": series,
        }
    )
    return option


def make_property_type_chart(
    type_fields: List[str],
    data_by_category: Dict[str, Dict[str, int]],
    overall_by_category: Dict[str, int],
    overall_total: int,
) -> Dict[str, Any]:
    totals = data_by_category.get("__TOTALS__", {})
    categories = [c for c in data_by_category.keys() if c not in {"__TOTALS__", "Ownership properly disclosed"}]

    type_order = [t for t in PROPERTY_TYPE_ORDER if t in type_fields]
    totals_per_type = {t: max(totals.get(t, 0), 1) for t in type_order}
    overall_total_value = max(overall_total, 1)

    total_label = "All properties"
    x_labels = [PROPERTY_TYPE_LABELS.get(t, t) for t in type_order] + [total_label]

    series: List[Dict[str, Any]] = []
    for cat in categories:
        per_type_abs = {t: data_by_category[cat].get(t, 0) for t in type_order}
        overall_abs_cat = overall_by_category.get(cat, sum(data_by_category[cat].get(t, 0) for t in type_fields))
        overall_pct_cat = (overall_abs_cat / overall_total_value * 100.0) if overall_total_value else 0.0

        values: List[float] = []
        tooltip_html: List[str] = []
        for t, display in zip(type_order, x_labels):
            abs_n = per_type_abs.get(t, 0)
            total_n = totals_per_type.get(t, 1)
            pct = (abs_n / total_n * 100.0) if total_n else 0.0
            values.append(pct)
            tooltip_html.append(
                f"{display}<br>{cat}<br>{fmt_int(abs_n)}/{fmt_int(total_n)} ({fmt_pct(pct)})"
            )

        values.append(overall_pct_cat)
        tooltip_html.append(
            f"{total_label}<br>{cat}<br>{fmt_int(overall_abs_cat)}/{fmt_int(overall_total_value)} ({fmt_pct(overall_pct_cat)})"
        )

        series.append(
            build_bar_series(
                cat,
                values,
                tooltip_html=tooltip_html,
                color=CATEGORY_COLORS.get(cat, BRAND_COLOR),
                stack="bad",
            )
        )

    option = base_option("Overseas entities — category share by property type")
    option.update(
        {
            "legend": {"show": True, "top": 55, "left": "center"},
            "grid": {"left": "2%", "right": "2%", "top": 90, "bottom": "5%", "containLabel": True},
            "xAxis": {
                "type": "category",
                "data": x_labels,
                "axisLabel": {"interval": 0},
                "axisTick": {"alignWithLabel": True},
            },
            "yAxis": {
                "type": "value",
                "axisLabel": {"formatter": "{value}%"},
                "splitLine": {"show": True, "lineStyle": {"color": "#ececec"}},
            },
            "series": series,
        }
    )
    return option


# Build a stacked percentage chart of risk categories by proprietor country, including an overall Average bar.
def make_country_bad_chart(rows: List[Dict[str, int | str]], top_n: int = 20, min_total: int = 50) -> Dict[str, Any]:
    # Determine category keys (exclude Country and Total and OK)
    if not rows:
        raise ValueError("Country table is empty")

    sample = rows[0]
    cat_keys = [k for k in sample.keys() if k not in {"Country", "Total", "Ownership properly disclosed"}]

    # Compute bad% per country and per-category percentages
    enriched = []
    for r in rows:
        total = max(int(r.get("Total", 0)), 1)
        bad_sum = sum(int(r.get(k, 0)) for k in cat_keys)
        bad_pct = bad_sum / total * 100.0
        per_cat_abs = {k: int(r.get(k, 0)) for k in cat_keys}
        enriched.append({
            "Country": r["Country"],
            "Total": total,
            "BadPct": bad_pct,
            **{f"ABS::{k}": v for k, v in per_cat_abs.items()},
        })

    # Filter out tiny-sample countries to avoid 100% stacks from totals of 1–2
    if min_total > 1:
        enriched = [r for r in enriched if r["Total"] >= min_total]

    # Top N by combined bad percent, then by larger totals
    enriched.sort(key=lambda r: (-r["BadPct"], -r["Total"], r["Country"]))
    top = enriched[:top_n]
    # Compute overall AVERAGE across all proprietors (all countries, unfiltered)
    overall_total = max(sum(int(r.get("Total", 0)) for r in rows), 1)
    overall_by_cat = {k: sum(int(r.get(k, 0)) for r in rows) for k in cat_keys}
    overall_bad_abs = sum(overall_by_cat.values())
    overall_bad_pct = (overall_bad_abs / overall_total) * 100.0 if overall_total else 0.0

    # Build label order including AVERAGE, sorted by combined bad % descending
    labels = [r["Country"] for r in top] + ["AVERAGE"]
    label_to_badpct = {r["Country"]: r["BadPct"] for r in top}
    label_to_badpct["AVERAGE"] = overall_bad_pct
    sorted_labels = sorted(labels, key=lambda c: -label_to_badpct.get(c, 0.0))
    sorted_display = [display_country_label(c) for c in sorted_labels]

    # For quick lookup of per-country enriched rows
    by_country = {r["Country"]: r for r in top}

    series: List[Dict[str, Any]] = []
    for k in cat_keys:
        values: List[float] = []
        tooltip_html: List[str] = []
        for lbl, display in zip(sorted_labels, sorted_display):
            if lbl == "AVERAGE":
                abs_n = overall_by_cat.get(k, 0)
                total_n = overall_total
            else:
                row = by_country.get(lbl, {})
                abs_n = int(row.get(f"ABS::{k}", 0))
                total_n = int(row.get("Total", 0))
            pct = (abs_n / total_n * 100.0) if total_n else 0.0
            values.append(pct)
            tooltip_html.append(
                f"{display}<br>{k}<br>{fmt_int(abs_n)}/{fmt_int(total_n)} ({fmt_pct(pct)})"
            )

        series.append(
            build_bar_series(
                k,
                values,
                tooltip_html=tooltip_html,
                color=CATEGORY_COLORS.get(k, BRAND_COLOR),
                stack="bad",
            )
        )

    option = base_option("Overseas entities — risk by country (% of all proprietors)")
    option.update(
        {
            "legend": {
                "show": True,
                "orient": "horizontal",
                "right": "2%",
                "top": 60,
            },
            "grid": {"left": "5%", "right": "5%", "top": 120, "bottom": "5%", "containLabel": True},
            "xAxis": {
                "type": "category",
                "data": sorted_display,
                "axisLabel": {"rotate": 90, "fontSize": 9, "interval": 0},
                "axisTick": {"alignWithLabel": True},
            },
            "yAxis": {
                "type": "value",
                "axisLabel": {"formatter": "{value}%"},
                "splitLine": {"show": True, "lineStyle": {"color": "#ececec"}},
            },
            "series": series,
        }
    )
    return option


# Build a stacked bar chart of absolute counts by country, ranked by combined "bad" counts.
def make_country_bad_chart_abs(rows: List[Dict[str, int | str]], top_n: int = 20, min_total: int = 50) -> Dict[str, Any]:
    if not rows:
        raise ValueError("Country table is empty")

    sample = rows[0]
    cat_keys = [k for k in sample.keys() if k not in {"Country", "Total", "Ownership properly disclosed"}]

    enriched = []
    for r in rows:
        total = max(int(r.get("Total", 0)), 1)
        bad_sum = sum(int(r.get(k, 0)) for k in cat_keys)
        bad_pct = bad_sum / total * 100.0
        per_cat_abs = {k: int(r.get(k, 0)) for k in cat_keys}
        enriched.append({
            "Country": r["Country"],
            "Total": total,
            "BadPct": bad_pct,
            "BadSum": bad_sum,
            **{f"ABS::{k}": v for k, v in per_cat_abs.items()},
        })

    if min_total > 1:
        enriched = [r for r in enriched if r["Total"] >= min_total]

    # Sort by largest absolute bad count (then by percent and total)
    enriched.sort(key=lambda r: (-r["BadSum"], -r["BadPct"], -r["Total"], r["Country"]))
    top = enriched[:top_n]
    countries = [r["Country"] for r in top]
    countries_display = [display_country_label(c) for c in countries]

    series: List[Dict[str, Any]] = []
    for k in cat_keys:
        values: List[float] = []
        tooltip_html: List[str] = []
        for row, display in zip(top, countries_display):
            abs_n = int(row.get(f"ABS::{k}", 0))
            total_n = int(row.get("Total", 0))
            pct = (abs_n / total_n * 100.0) if total_n else 0.0
            values.append(float(abs_n))
            tooltip_html.append(
                f"{display}<br>{k}<br>{fmt_int(abs_n)}/{fmt_int(total_n)} ({fmt_pct(pct)})"
            )

        series.append(
            build_bar_series(
                k,
                values,
                tooltip_html=tooltip_html,
                color=CATEGORY_COLORS.get(k, BRAND_COLOR),
                stack="bad",
            )
        )

    option = base_option("Overseas entities — risk by country (numbers of proprietors)")
    option.update(
        {
            "legend": {
                "show": True,
                "orient": "vertical",
                "right": "2%",
                "top": 70,
            },
            "grid": {"left": "8%", "right": "24%", "top": 70, "bottom": "20%", "containLabel": True},
            "xAxis": {
                "type": "category",
                "data": countries_display,
                "axisLabel": {"rotate": 90, "fontSize": 9, "interval": 0},
                "axisTick": {"alignWithLabel": True},
            },
            "yAxis": {
                "type": "value",
                "axisLabel": {"formatter": "{value}"},
                "splitLine": {"show": True, "lineStyle": {"color": "#ececec"}},
            },
            "series": series,
        }
    )
    return option


def make_country_value_chart(
    value_rows: List[Dict[str, int | str]],
    counts_lookup: Dict[str, int],
    top_n: int = 20,
    min_total: int = 50,
) -> Dict[str, Any]:
    if not value_rows:
        raise ValueError("Country value table is empty")

    sample = value_rows[0]
    cat_keys = [k for k in sample.keys() if k not in {"Country", "Total", "Ownership properly disclosed"}]

    enriched = []
    for row in value_rows:
        country = row.get("Country", "").strip()  # type: ignore
        if not country:
            continue
        proprietor_count = counts_lookup.get(country, 0)
        if min_total > 1 and proprietor_count < min_total:
            continue
        total_value = max(int(row.get("Total", 0)), 1)
        per_cat_value = {k: int(row.get(k, 0)) for k in cat_keys}
        bad_value_sum = sum(per_cat_value.values())
        enriched.append({
            "Country": country,
            "TotalValue": total_value,
            "BadValueSum": bad_value_sum,
            **{f"VAL::{k}": v for k, v in per_cat_value.items()},
        })

    if not enriched:
        raise ValueError("No countries met the minimum proprietor threshold for the value chart")

    enriched.sort(key=lambda r: (-r["BadValueSum"], -r["TotalValue"], r["Country"]))
    top = enriched[:top_n]
    countries = [r["Country"] for r in top]
    display = [display_country_label(c) for c in countries]

    series: List[Dict[str, Any]] = []
    for k in cat_keys:
        values: List[float] = []
        tooltip_html: List[str] = []
        for row, country_display, country_raw in zip(top, display, countries):
            value = int(row.get(f"VAL::{k}", 0))
            total_val = int(row.get("TotalValue", 0))
            proprietor_count = counts_lookup.get(country_raw, 0)
            values.append(float(value))
            tooltip_html.append(
                f"{country_display}<br>{k}<br>{fmt_money(value)} / {fmt_money(total_val)}"
                f"<br>Proprietors: {fmt_int(proprietor_count)}"
            )

        series.append(
            build_bar_series(
                k,
                values,
                tooltip_html=tooltip_html,
                color=CATEGORY_COLORS.get(k, BRAND_COLOR),
                stack="bad",
            )
        )

    option = base_option("Overseas entities — risk by country (property value)")
    option.update(
        {
            "legend": {
                "show": True,
                "orient": "vertical",
                "right": "2%",
                "top": 70,
            },
            "grid": {"left": "8%", "right": "24%", "top": 70, "bottom": "20%", "containLabel": True},
            "xAxis": {
                "type": "category",
                "data": display,
                "axisLabel": {"rotate": 90, "fontSize": 9, "interval": 0},
                "axisTick": {"alignWithLabel": True},
            },
            "yAxis": {
                "type": "value",
                "axisLabel": {"formatter": "£{value}"},
                "splitLine": {"show": True, "lineStyle": {"color": "#ececec"}},
            },
            "series": series,
        }
    )
    return option


def make_country_treemap(
    rows: List[Dict[str, int | str]],
    cutoff: int = TREEMAP_CUTOFF,
) -> Dict[str, Any]:
    if not rows:
        raise ValueError("Country table is empty")

    sample = rows[0]
    cat_keys = [k for k in sample.keys() if k not in {"Country", "Total"}]
    overall_total = sum(int(r.get("Total", 0)) for r in rows)

    category_totals = {
        cat: sum(int(r.get(cat, 0)) for r in rows) for cat in cat_keys
    }

    category_country_values: Dict[str, List[tuple[str, str, int]]] = {
        cat: [] for cat in cat_keys
    }

    for row in rows:
        country_raw = str(row.get("Country", "")).strip()
        if not country_raw:
            continue
        display_country = display_country_label(country_raw)
        for cat in cat_keys:
            value_raw = row.get(cat, 0)
            value = int(value_raw) if not isinstance(value_raw, str) else parse_int(value_raw)
            if value >= cutoff:
                category_country_values.setdefault(cat, []).append((country_raw, display_country, value))

    treemap_data: List[Dict[str, Any]] = []

    for cat in cat_keys:
        cat_total = category_totals.get(cat, 0)
        if cat_total <= 0:
            continue

        # this is the category label
        if cat == "True beneficial owner hidden":
            display_cat = "Hidden"
        else:
            display_cat = cat

        cat_node: Dict[str, Any] = {
            "name": display_cat,
            "value": cat_total,
            "itemStyle": {"color": CATEGORY_COLORS.get(cat, BRAND_COLOR)},
            "children": [],
        }

        entries = sorted(category_country_values.get(cat, []), key=lambda x: -x[2])
        included_total = 0
        base_color = CATEGORY_COLORS.get(cat, BRAND_COLOR)
        max_index = max(len(entries) - 1, 1)

        for idx, (country_raw, display_country, value) in enumerate(entries):
            included_total += value
            # Accelerate the fade so early entries still show visible contrast
            ratio = (idx / max_index) if entries else 0.0
            fade_factor = (ratio ** 0.65) * 0.75 if entries else 0.0
            node_color = fade_hex(base_color, fade_factor)

            cat_node["children"].append(
                {
                    "name": display_country,
                    "value": value,
                    "itemStyle": {"color": node_color},
                }
            )

        other_value = cat_total - included_total
        if other_value > 0:
            tail_ratio = (len(entries) / (len(entries) + 1)) if entries else 0.5
            other_fade = (tail_ratio ** 0.65) * 0.85
            other_color = fade_hex(base_color, other_fade)

            cat_node["children"].append(
                {
                    "name": "Other",
                    "value": other_value,
                    "itemStyle": {"color": other_color},
                }
            )

        treemap_data.append(cat_node)

    option = {
        "title": {
            "text": "Overseas entities — disclosure status by proprietor country",
            "left": "center",
            "top": 10,
            "textStyle": {"fontSize": 16},
        },
        "_tpaTooltip": {
            "template": "{name}<br>{y:0,0} proprietors",
        },
        "tooltip": {"trigger": "item"},
        "series": [
            {
                "type": "treemap",
                "width": "95%",
                "height": "95%",
                "top": 30,
                "roam": False,
                "nodeClick": False,
                "breadcrumb": {"show": False},
                "label": {
                    "show": True,
                    "formatter": "{b}\n{c}",
                    "fontSize": 11,
                    "textShadowColor": "rgba(0,0,0,0.5)",
                    "textShadowBlur": 2,
                    "color": "#fff",
                },
                "upperLabel": {
                    "show": True,
                    "height": 30,
                    "formatter": "{b}",
                    "fontSize": 13,
                    "fontWeight": "bold",
                    "color": "#0f141e",
                },
                "itemStyle": {
                    "borderColor": "#fff",
                    "borderWidth": 1,
                    "gapWidth": 1,
                },
                "data": treemap_data,
            }
        ],
    }
    return option


def make_top_trustees_chart(entries: List[Tuple[str, int, int]]) -> Dict[str, Any]:
    if not entries:
        raise ValueError("Trustee list is empty")

    names = [name for name, _, _ in entries]
    with_bo_counts = [with_bo for _, with_bo, _ in entries]
    without_bo_counts = [without_bo for _, _, without_bo in entries]
    totals = [with_bo + without_bo for with_bo, without_bo in zip(with_bo_counts, without_bo_counts)]

    tooltip_without: List[str] = []
    tooltip_with: List[str] = []
    for name, with_bo, without_bo, total in zip(names, with_bo_counts, without_bo_counts, totals):
        tooltip = (
            f"{name}<br>Trustee-only properties: {fmt_int(without_bo)}"
            f"<br>True beneficial owner declared: {fmt_int(with_bo)}"
            f"<br>Total properties: {fmt_int(total)}"
        )
        tooltip_without.append(tooltip)
        tooltip_with.append(tooltip)

    good_color = CATEGORY_COLORS.get("Ownership properly disclosed", "#6ACC64")
    hidden_color = CATEGORY_COLORS.get("Only trustees listed as beneficial owners", BRAND_COLOR)

    series = [
        build_bar_series(
            "Only trustee disclosed",
            [float(v) for v in without_bo_counts],
            tooltip_html=tooltip_without,
            color=hidden_color,
            stack="total",
        ),
        build_bar_series(
            "True beneficial owner disclosed",
            [float(v) for v in with_bo_counts],
            tooltip_html=tooltip_with,
            color=good_color,
            stack="total",
        ),
    ]

    option = base_option("Overseas entities — top trustees hiding ownership")
    option.update(
        {
            "legend": {"show": True, "top": 50, "left": "center"},
            "grid": {"left": "8%", "right": "8%", "top": 110, "bottom": "5%", "containLabel": True},
            "xAxis": {
                "type": "category",
                "data": names,
                "axisLabel": {"rotate": 90, "fontSize": 9, "interval": 0},
                "axisTick": {"alignWithLabel": True},
            },
            "yAxis": {
                "type": "value",
                "name": "Number of properties",
                "axisLabel": {"formatter": "{value}"},
                "splitLine": {"show": True, "lineStyle": {"color": "#ececec"}},
            },
            "series": series,
        }
    )
    return option


def make_trustee_disclosure_ratio_chart(entries: List[Tuple[str, int, int]]) -> Dict[str, Any]:
    if not entries:
        raise ValueError("Trustee list is empty")

    enriched = []
    for name, with_bo, without_bo in entries:
        total = with_bo + without_bo
        if total <= 0:
            continue
        ratio = (with_bo / total) if total else 0.0
        if ratio <= 0.0:
            continue
        enriched.append((name, with_bo, without_bo, total, ratio))

    enriched.sort(key=lambda item: (-item[4], -item[1], item[0].lower()))

    names = [item[0] for item in enriched]
    ratios_pct = [item[4] * 100.0 for item in enriched]

    tooltip_html: List[str] = []
    for name, with_bo, without_bo, total, ratio in enriched:
        tooltip_html.append(
            f"{name}<br>Disclosing ratio: {fmt_pct(ratio * 100.0)}"
            f"<br>True BO declared: {fmt_int(with_bo)}"
            f"<br>Trustee-only properties: {fmt_int(without_bo)}"
            f"<br>Total properties: {fmt_int(total)}"
        )

    if not names:
        raise ValueError("No trustees with a disclosure ratio above zero")

    series = [
        build_bar_series(
            "Disclosure ratio",
            ratios_pct,
            tooltip_html=tooltip_html,
            color=BRAND_COLOR,
        )
    ]

    option = base_option("Trustee entities and % of BO disclosure")
    option.update(
        {
            "legend": {"show": False},
            "grid": {"left": "8%", "right": "8%", "top": 70, "bottom": "5%", "containLabel": True},
            "xAxis": {
                "type": "category",
                "data": names,
                "axisLabel": {"rotate": 90, "fontSize": 9, "interval": 0},
                "axisTick": {"alignWithLabel": True},
            },
            "yAxis": {
                "type": "value",
                "name": "Disclosing ratio",
                "axisLabel": {"formatter": "{value}%"},
                "splitLine": {"show": True, "lineStyle": {"color": "#ececec"}},
            },
            "series": series,
        }
    )
    return option


# Convert a category name to a filesystem-friendly slug for output filenames.
def slugify(name: str) -> str:
    import re
    s = name.lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s or "category"


# Build a single-category by-country percentage chart, with an Average bar for reference.
def make_country_single_category_chart(
    rows: List[Dict[str, int | str]],
    category: str,
    top_n: int = 40,
    min_total: int = 50,
) -> Dict[str, Any]:
    if not rows:
        raise ValueError("Country table is empty")

    # Build per-country percent and absolute for the category
    data = []
    for r in rows:
        total = int(r.get("Total", 0))
        if total < min_total:
            continue
        abs_val = int(r.get(category, 0))
        if abs_val <= 0:
            continue
        pct = (abs_val / total * 100.0) if total > 0 else 0.0
        data.append({"Country": r["Country"], "Total": total, "Abs": abs_val, "Pct": pct})

    # Order by percent desc, then by total desc, then by country
    data.sort(key=lambda d: (-d["Pct"], -d["Total"], d["Country"]))
    top = data[:top_n]
    # Compute overall AVERAGE across all proprietors (all countries)
    overall_total = max(sum(int(r.get("Total", 0)) for r in rows), 1)
    overall_abs = sum(int(r.get(category, 0)) for r in rows)
    overall_pct = overall_abs / overall_total * 100.0

    # Include AVERAGE and then resort including it
    with_avg = top + [{"Country": "AVERAGE", "Total": overall_total, "Abs": overall_abs, "Pct": overall_pct}]
    with_avg.sort(key=lambda d: (-d["Pct"], -d["Total"], d["Country"]))

    countries = [d["Country"] for d in with_avg]
    display = [display_country_label(c) for c in countries]
    values = [d["Pct"] for d in with_avg]

    tooltip_html: List[str] = []
    for row, country_display in zip(with_avg, display):
        tooltip_html.append(
            f"{country_display}<br>{category}: {fmt_int(row['Abs'])}/{fmt_int(row['Total'])} ({fmt_pct(row['Pct'])})"
        )

    series = [
        build_bar_series(
            category,
            values,
            tooltip_html=tooltip_html,
            color=CATEGORY_COLORS.get(category, BRAND_COLOR),
        )
    ]

    option = base_option(f"Overseas entities — country share: {category}")
    option.update(
        {
            "legend": {"show": False},
            "grid": {"left": "8%", "right": "8%", "top": 70, "bottom": "24%", "containLabel": True},
            "xAxis": {
                "type": "category",
                "data": display,
                "axisLabel": {"rotate": 90, "fontSize": 10, "interval": 0},
                "axisTick": {"alignWithLabel": True},
            },
            "yAxis": {
                "type": "value",
                "axisLabel": {"formatter": "{value}%"},
                "splitLine": {"show": True, "lineStyle": {"color": "#ececec"}},
            },
            "series": series,
        }
    )
    return option


def make_country_single_category_chart_abs(
    rows: List[Dict[str, int | str]],
    category: str,
    top_n: int = 40,
    min_total: int = 50,
) -> Dict[str, Any]:
    if not rows:
        raise ValueError("Country table is empty")

    data = []
    for r in rows:
        total = int(r.get("Total", 0))
        if total < min_total:
            continue
        abs_val = int(r.get(category, 0))
        if abs_val <= 0:
            continue
        pct = (abs_val / total * 100.0) if total > 0 else 0.0
        data.append({"Country": r["Country"], "Total": total, "Abs": abs_val, "Pct": pct})

    # Sort by absolute count desc (largest on the left)
    data.sort(key=lambda d: (-d["Abs"], -d["Total"], d["Country"]))
    top = data[:top_n]
    countries = [d["Country"] for d in top]
    display = [display_country_label(c) for c in countries]
    values = [float(d["Abs"]) for d in top]

    tooltip_html: List[str] = []
    for row, country_display in zip(top, display):
        tooltip_html.append(
            f"{country_display}<br>{category}: {fmt_int(row['Abs'])}/{fmt_int(row['Total'])} ({fmt_pct(row['Pct'])})"
        )

    series = [
        build_bar_series(
            category,
            values,
            tooltip_html=tooltip_html,
            color=CATEGORY_COLORS.get(category, BRAND_COLOR),
        )
    ]

    option = base_option(f"{category}: by proprietor country")
    option.update(
        {
            "legend": {"show": False},
            "grid": {"left": "8%", "right": "8%", "top": 90, "bottom": "5%", "containLabel": True},
            "xAxis": {
                "type": "category",
                "data": display,
                "axisLabel": {"rotate": 90, "fontSize": 10, "interval": 0},
                "axisTick": {"alignWithLabel": True},
            },
            "yAxis": {
                "type": "value",
                "name": "Number of proprietors",
                "axisLabel": {"formatter": "{value}"},
                "splitLine": {"show": True, "lineStyle": {"color": "#ececec"}},
            },
            "series": series,
        }
    )
    return option


# Save an ECharts option to JSON, creating directories as needed.
def save_option(option: Dict[str, Any], out_json: Path) -> None:
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(option, indent=2), encoding="utf-8")


# Entrypoint: parse CSV export, build charts, and write outputs to the target directory.
def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    csv_path = Path(CSV_PATH) if CSV_PATH else repo_root / "webapp" / "overseas_entities_stats.csv"
    out_dir = Path(OUTPUT_DIR)

    if not csv_path.exists():
        raise SystemExit(f"CSV not found: {csv_path}")

    # Read whole file
    raw = csv_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    sections = parse_sections(raw)

    # Yearly chart
    years, yearly_data, overall_by_category, overall_total = load_yearly(sections.get("yearly", []))
    yearly_option = make_yearly_chart(years, yearly_data, overall_by_category, overall_total)
    save_option(
        yearly_option,
        out_dir / "yearly_categories.json",
    )

    # Property type chart
    type_fields, type_data, type_overall_by_category, type_overall_total = load_property_type(
        sections.get("property_type", [])
    )
    property_type_option = make_property_type_chart(
        type_fields,
        type_data,
        type_overall_by_category,
        type_overall_total,
    )
    save_option(
        property_type_option,
        out_dir / "property_type_categories.json",
    )

    # Country charts
    country_rows = load_country(sections.get("country", []))
    country_value_rows = load_country(sections.get("country_value", []))
    counts_lookup: Dict[str, int] = {}
    for row in country_rows:
        country_key = str(row.get("Country", ""))
        total_val = row.get("Total", 0)
        counts_lookup[country_key] = int(total_val) if not isinstance(total_val, str) else parse_int(total_val)

    country_option = make_country_bad_chart(country_rows, top_n=TOP_N_COUNTRIES, min_total=MIN_TOTAL_PER_COUNTRY)
    save_option(
        country_option,
        out_dir / "country_all_stacked.json",
    )
    # Country (absolute counts)
    country_abs_option = make_country_bad_chart_abs(country_rows, top_n=TOP_N_COUNTRIES, min_total=MIN_TOTAL_PER_COUNTRY)
    save_option(
        country_abs_option,
        out_dir / "country_all_stacked_abs.json",
    )
    if country_value_rows:
        country_value_option = make_country_value_chart(
            country_value_rows,
            counts_lookup,
            top_n=TOP_N_COUNTRIES,
            min_total=MIN_TOTAL_PER_COUNTRY,
        )
        save_option(
            country_value_option,
            out_dir / "country_all_stacked_value.json",
        )

    treemap_option = make_country_treemap(country_rows, cutoff=TREEMAP_CUTOFF)
    save_option(
        treemap_option,
        out_dir / "country_all_stacked_treemap.json",
    )

    trustees_csv_path = Path(TOP_TRUSTEES_CSV) if TOP_TRUSTEES_CSV else (repo_root / "webapp" / "top_trustees.csv")
    top_trustees = load_top_trustees(trustees_csv_path, TRUSTEES_TO_CHART)
    if top_trustees:
        trustees_option = make_top_trustees_chart(top_trustees)
        save_option(
            trustees_option,
            out_dir / "top_trustees.json",
        )
        try:
            ratio_option = make_trustee_disclosure_ratio_chart(top_trustees)
        except ValueError:
            print("No trustees with a disclosure ratio above zero")
        else:
            save_option(
                ratio_option,
                out_dir / "top_trustees_ratio.json",
            )
    else:
        print(f"No trustee data found at {trustees_csv_path}")

    # Per-category charts (including 'OK')
    sample = country_rows[0] if country_rows else {}
    cat_keys = [k for k in (sample.keys() if sample else []) if k not in {"Country", "Total"}]
    for cat in cat_keys:
        option = make_country_single_category_chart(country_rows, cat, top_n=CATEGORY_TOP_N, min_total=MIN_TOTAL_PER_COUNTRY)
        slug = slugify(cat)
        save_option(
            option,
            out_dir / f"country_pct_{slug}.json",
        )
        # Absolute version per category
        option_abs = make_country_single_category_chart_abs(country_rows, cat, top_n=CATEGORY_TOP_N, min_total=MIN_TOTAL_PER_COUNTRY)
        save_option(
            option_abs,
            out_dir / f"country_abs_{slug}.json",
        )

    properties_path = find_properties_msgpack_path(repo_root)
    properties = load_msgpack(properties_path)
    proprietors_path = find_proprietors_msgpack_path(repo_root)
    proprietors = load_msgpack(proprietors_path)
    estimated_entries, estimated_total = estimate_property_values(properties, proprietors, PROPERTY_VALUE_YEARS)
    print_estimated_property_values(estimated_entries, estimated_total, PROPERTY_VALUE_YEARS)
    estimated_option = make_estimated_property_values_chart(estimated_entries)
    save_option(
        estimated_option,
        out_dir / "estimated_property_values.json",
    )

    region_geoms = load_region_geometries(repo_root / REGIONS_GEOJSON_PATH)
    region_stats = estimate_property_values_by_region(properties, region_geoms, proprietors, PROPERTY_VALUE_YEARS)
    region_option = make_estimated_property_values_regions_chart(region_stats)
    save_option(
        region_option,
        out_dir / "estimated_property_values_regions.json",
    )

    print(f"\nSaved charts to {out_dir.resolve()}")
    upload_all_files()


if __name__ == "__main__":
    main()
