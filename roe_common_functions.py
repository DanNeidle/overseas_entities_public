#!/usr/bin/env python3
import re
import unicodedata
import requests
import os
import sys
import subprocess

# Lazy geospatial cache (loaded on first use)
_UK_GEOM = None  # type: ignore


from companies_house_settings import (
    cloudflare_tpal_zone,
    cloudflare_purge_cache_api,
    ssh_server,
    server_destination_directory,
    public_web_directory,
    public_chart_directory,
    chart_destination_directory
)
 

# Load a list of corporate/legal tokens to strip from names during normalisation.
def load_tokens(filepath="data_creator/words_to_ignore_in_names.txt"):
    try:
        with open(filepath, encoding="utf-8") as f:
            tokens = [line.strip().lower() for line in f if line.strip() and not line.lstrip().startswith("#")]
    except FileNotFoundError:
        raise RuntimeError(f"Token file not found: {filepath}")
    tokens.sort(key=len, reverse=True)
    return tokens

TOKENS_TO_REMOVE = load_tokens()

NORMALIZATION_PATTERN = re.compile(r'\b(?:' + '|'.join(re.escape(t) for t in TOKENS_TO_REMOVE) + r')\b')
PUNCTUATION_PATTERN = re.compile(r'[^a-z0-9\s]')
WHITESPACE_PATTERN = re.compile(r'\s+')


# Robust normaliser for company/person names used in matching and caching.
def normalise_text(text: str) -> str:
    
    # zap accents but retain characters
    def _fold(text: str) -> str:
        return ''.join(
            ch for ch in unicodedata.normalize('NFKD', text)
            if not unicodedata.combining(ch)
        )
        
    if not isinstance(text, str):
        return ''
    
    text = _fold(text.lower())

    # Collapse dotted/space-separated acronyms first
    text = re.sub(r'\bs\s*\.?\s*a\s*\.?\s*r\s*\.?\s*l\b', ' sarl', text)
    text = re.sub(r'\bs\s*\.?\s*p\s*\.?\s*a\b', ' spa', text)
    text = re.sub(r'\bb\s*\.?\s*v\b', ' bv', text)
    text = re.sub(r'\bg\s*\.?\s*m\s*\.?\s*b\s*\.?\s*h\b', ' gmbh', text)

    # 1) Remove punctuation WITHOUT turning it into spaces.
    # This correctly joins 's' and 'a' from 's.a.'.
    text = re.sub(r'[^a-z0-9\s]+', '', text)

    # 2) Strip legal/corporate tokens (uses \b boundaries).
    # This will now correctly find 'sa' in both cases.
    text = NORMALIZATION_PATTERN.sub('', text)

    # 3) Collapse all whitespace and strip.
    text = WHITESPACE_PATTERN.sub('', text)
    return text.strip()


# --- Geospatial helpers (lazy loaded) ---
def get_uk_geom():
    """
    Lazily load and cache the UK geometry (Great Britain + Northern Ireland)
    from Natural Earth via GeoPandas. Returns a shapely geometry.
    """
    global _UK_GEOM
    if _UK_GEOM is not None:
        return _UK_GEOM

    # Heavy imports inside to avoid cost unless needed
    import os
    import certifi
    import geopandas as gpd

    # Ensure HTTPS certs for remote zip
    os.environ["SSL_CERT_FILE"] = certifi.where()

    NE_URL = "https://naturalearth.s3.amazonaws.com/50m_cultural/ne_50m_admin_0_countries.zip"
    world = gpd.read_file(NE_URL)
    _UK_GEOM = world.loc[world["ISO_A3"] == "GBR", "geometry"].unary_union
    return _UK_GEOM


def is_within_uk(lat: float | None, lon: float | None) -> bool:
    """
    Return True if (lat, lon) lies within the UK geometry.
    Uses covers() so boundary points count as inside. Returns False for None inputs.
    """
    if lat is None or lon is None:
        return False

    # Import here to keep top-level light if unused
    from shapely.geometry import Point

    geom = get_uk_geom()
    pt = Point(lon, lat)
    return geom.covers(pt)


# now upload functions
def run_command(command):
    """
    Executes a shell command. It is silent on success but prints detailed 
    stdout/stderr and exits the script on failure.
    """
    try:
        # `check=True` raises CalledProcessError on non-zero exit codes.
        # `capture_output=True` prevents output from appearing unless an error occurs.
        subprocess.run(
            command, 
            shell=True, 
            check=True, 
            capture_output=True, 
            text=True
        )
    except subprocess.CalledProcessError as e:
        # If the command fails, print all details for debugging and exit.
        print(f"❌ Error executing command: {command}", file=sys.stderr)
        print(f"Exit Code: {e.returncode}", file=sys.stderr)
        if e.stdout:
            print(f"--- STDOUT ---\n{e.stdout.strip()}", file=sys.stderr)
        if e.stderr:
            print(f"--- STDERR ---\n{e.stderr.strip()}", file=sys.stderr)
        sys.exit(e.returncode)

def purge_cloudflare_cache_by_prefix(zone_id, api_token, prefixes):
    """
    Purges the cache for specific URL prefixes in Cloudflare.
    Returns True on success, False on failure (and prints error details).
    """
    url = f"https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache"
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
    }
    payload = {"prefixes": prefixes}
    
    try:
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()  # Raises HTTPError for bad responses
        
        if response.json().get("success", False):
            return True  # Success
        else:
            print(f"❌ Cache purge failed!", file=sys.stderr)
            print(f"Full response: {response.json()}", file=sys.stderr)
            return False
    
    except requests.exceptions.HTTPError as e:
        print(f"❌ HTTP Error during cache purge: {e.response.status_code}", file=sys.stderr)
        print(f"Response body: {e.response.text}", file=sys.stderr)
        return False
    except requests.exceptions.RequestException as e:
        print(f"❌ An error occurred trying to purge the cache: {e}", file=sys.stderr)
        return False

def upload_all_files():
    """
    Runs the full deployment pipeline: rsync, chmod, and cache purge.
    Is silent on success, exiting with an error message on failure.
    """
    # 1. Upload the files via rsync
    rsync_command = (
        "rsync -avz --delete "
        "--chmod=777 "  # Set permissions during the sync
        "webapp/ "
        f"{ssh_server}:{server_destination_directory}"
    )
    run_command(rsync_command)

    rsync_command = (
        "rsync -avz "
        "--chmod=777 "  # Set permissions during the sync
        "charts/ "
        f"{ssh_server}:{chart_destination_directory}"
    )
    run_command(rsync_command)


    # 3. Purge cloudflare cache
    cache_purged_successfully = purge_cloudflare_cache_by_prefix(
        cloudflare_tpal_zone, 
        cloudflare_purge_cache_api, 
        [public_web_directory, public_chart_directory]
    )
    
    if not cache_purged_successfully:
        sys.exit(1) # Error messages were already printed by the function

    
    # 4. If all steps passed, print the final success message
    print("🚀 Successfully uploaded and cache cleared!")

# If this module is run (rather than imported) then deploy files
if __name__ == "__main__":
    upload_all_files()