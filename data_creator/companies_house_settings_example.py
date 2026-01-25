# this file has the settings for the data creation
# it also imports secrets from .env

import os
from dotenv import load_dotenv

def get_required_env(var_name: str) -> str:
    """
    Gets a required environment variable and raises an error if it's not found.
    This also guarantees to the type checker that the return value is a string.
    """
    value = os.getenv(var_name)
    if value is None:
        raise ValueError(f"❌ Missing required secret: {var_name} not found in environment.")
    return value

# --- 1. Define Static Configuration ---

# these are what is currently being used for data creation
current_db_file = "data/overseas_entities_oct_2025.db"

# download this from 
current_overseas_entity_list_file = 'data/OCOD_FULL_2025_10.csv'

# when updating a previous dataset, put the old database here. The scripts use it for address lookups, saving a *lot* of time
old_db_file = 'data/overseas_entities_sept_2025v2.db'

companies_house_rate_limit = 1200
companies_house_rate_period = 5 * 60

gemini_model_to_use_for_ai = 'gemini-2.0-flash-lite'


# --- 2. Load Secrets from Environment ---
load_dotenv()

companies_house_api_key = get_required_env("companies_house_api_key")
google_geo_api_key = get_required_env("google_geo_api_key")
openai_key = get_required_env("openai_key")
radar_geocode_api_secret = get_required_env("radar_geocode_api_secret")
gemini_api_key = get_required_env("gemini_api_key")
cloudflare_tpal_zone = get_required_env("cloudflare_tpal_zone")
cloudflare_purge_cache_api = get_required_env("cloudflare_purge_cache_api")
