from pydantic import BaseModel
from typing import Optional


class StockBase(BaseModel):
    code: str
    name: str
    industry: Optional[str] = None
    favorite: bool = False
    buy_price: Optional[float] = None
    sell_price: Optional[float] = None


class Stock(StockBase):
    id: Optional[int] = None


class StockCreate(StockBase):
    pass


class StockUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    industry: Optional[str] = None
    favorite: Optional[bool] = None
    buy_price: Optional[float] = None
    sell_price: Optional[float] = None


class TradeHistoryCreate(BaseModel):
    trade_date: str
    side: str  # "buy" or "sell"
    quantity: int
    price: float
