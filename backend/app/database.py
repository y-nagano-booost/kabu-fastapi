import os
import duckdb

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DB_PATH = os.path.join(BASE_DIR, "stock.duckdb")

def get_connection():
    return duckdb.connect(DB_PATH)
