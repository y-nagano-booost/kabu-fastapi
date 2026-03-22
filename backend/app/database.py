import os
import shutil
import duckdb

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PRIMARY_DB_PATH = os.path.join(BASE_DIR, "stock.duckdb")
FALLBACK_DB_PATH = os.path.join(BASE_DIR, "stock.writable.duckdb")


def _resolve_db_path():
    # Use primary DB when writable. If not writable (e.g. ownership mismatch),
    # transparently switch to a writable copy so update endpoints keep working.
    if os.path.exists(PRIMARY_DB_PATH) and os.access(PRIMARY_DB_PATH, os.W_OK):
        return PRIMARY_DB_PATH

    if not os.path.exists(FALLBACK_DB_PATH):
        if os.path.exists(PRIMARY_DB_PATH):
            shutil.copy2(PRIMARY_DB_PATH, FALLBACK_DB_PATH)
        else:
            # Initialize an empty DB file path when primary does not exist.
            open(FALLBACK_DB_PATH, "a").close()

    return FALLBACK_DB_PATH


def get_connection():
    return duckdb.connect(_resolve_db_path())
