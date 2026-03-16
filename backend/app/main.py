from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import stocks
from app.database import get_connection

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ViteのURL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# DB初期化
con = get_connection()
con.execute("""
CREATE TABLE IF NOT EXISTS stocks (
    id INTEGER PRIMARY KEY,
    code VARCHAR,
    name VARCHAR,
    industry VARCHAR,
    favorite BOOLEAN DEFAULT FALSE,
    buy_price DOUBLE,
    sell_price DOUBLE
)
""")
con.execute("ALTER TABLE stocks ADD COLUMN IF NOT EXISTS industry VARCHAR")
con.execute("ALTER TABLE stocks ADD COLUMN IF NOT EXISTS favorite BOOLEAN DEFAULT FALSE")
con.execute("ALTER TABLE stocks ADD COLUMN IF NOT EXISTS buy_price DOUBLE")
con.execute("ALTER TABLE stocks ADD COLUMN IF NOT EXISTS sell_price DOUBLE")
con.execute("""
CREATE TABLE IF NOT EXISTS stock_info (
    stock_id INTEGER PRIMARY KEY,
    long_name VARCHAR,
    short_name VARCHAR,
    sector VARCHAR,
    industry VARCHAR,
    market_cap DOUBLE,
    trailing_pe DOUBLE,
    forward_pe DOUBLE,
    dividend_yield DOUBLE,
    beta DOUBLE,
    website VARCHAR,
    business_summary VARCHAR,
    currency VARCHAR,
    country VARCHAR,
    updated_at TIMESTAMP
)
""")
con.execute("""
CREATE TABLE IF NOT EXISTS trade_history (
    stock_id INTEGER,
    trade_date DATE,
    side VARCHAR,
    quantity INTEGER,
    price DOUBLE,
    created_at TIMESTAMP
)
""")
con.close()

app.include_router(stocks.router)
