from pydantic import BaseModel
from typing import Optional

class Stock(BaseModel):
    id: Optional[int] = None
    code: str
    name: str
    industry: Optional[str] = None
    favorite: bool = False
    buy_price: Optional[float] = None
    sell_price: Optional[float] = None


class TradeHistoryCreate(BaseModel):
    trade_date: str
    side: str  # "buy" or "sell"
    quantity: int
    price: float
