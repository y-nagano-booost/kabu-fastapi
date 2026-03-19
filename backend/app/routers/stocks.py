from fastapi import APIRouter, HTTPException
from app.models import StockCreate, StockUpdate, TradeHistoryCreate
from app.services.stock_service import (
    get_all_stocks,
    create_stock,
    delete_stock,
    update_stock,
)
from app.services.stock_service import *

router = APIRouter(prefix="/api/stocks", tags=["stocks"])


def _model_dump_exclude_unset(model):
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_unset=True)
    return model.dict(exclude_unset=True)


@router.get("")
def get_stocks():
    return get_all_stocks()


@router.post("")
def add_stock(stock: StockCreate):
    create_stock(
        stock.code,
        stock.name,
        stock.industry,
        stock.favorite,
        stock.buy_price,
        stock.sell_price,
    )
    return {"message": "created"}


@router.put("/{stock_id}")
def edit_stock(stock_id: int, stock: StockUpdate):
    try:
        update_stock(stock_id, _model_dump_exclude_unset(stock))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"message": "updated"}


@router.delete("/{stock_id}")
def remove_stock(stock_id: int):
    delete_stock(stock_id)
    return {"message": "deleted"}

@router.post("/{stock_id}/trades")
def add_trade(stock_id: int, trade: TradeHistoryCreate):
    try:
        add_trade_history(
            stock_id=stock_id,
            trade_date=trade.trade_date,
            side=trade.side,
            quantity=trade.quantity,
            price=trade.price,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": "trade history added"}

@router.get("/{stock_id}/trades")
def list_trades(stock_id: int):
    return get_trade_history(stock_id)

@router.delete("/{stock_id}/trades")
def remove_trade(stock_id: int, created_at: str):
    try:
        delete_trade_history(stock_id, created_at)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": "trade history deleted"}

@router.post("/{stock_ref}/update-daily")
def update_daily(stock_ref: str):

    stocks = get_all_stocks()
    stock = next(
        (
            s
            for s in stocks
            if str(s["id"]) == stock_ref or s["code"] == stock_ref
        ),
        None,
    )

    if not stock:
        raise HTTPException(status_code=404, detail="Stock not found")

    result = update_daily_data(stock["id"], stock["code"])
    if result.get("message") == "No data":
        raise HTTPException(status_code=404, detail=result)
    return result

@router.post("/update-daily-all")
def update_daily_all(days: int = 7, batch_size: int = 50):
    if days < 1:
        raise HTTPException(status_code=400, detail="days must be >= 1")
    if batch_size < 1:
        raise HTTPException(status_code=400, detail="batch_size must be >= 1")

    return update_all_daily_data(days=days, batch_size=batch_size)

@router.post("/update-minkabu-forecast-all")
def update_minkabu_forecast_all():
    return update_minkabu_forecasts_all()

@router.post("/update-kabutan-yields-all")
def update_kabutan_yields_all_endpoint():
    return update_kabutan_yields_all()

@router.post("/{stock_id}/update-earnings")
def update_earnings(stock_id: int):

    stocks = get_all_stocks()
    stock = next((s for s in stocks if s["id"] == stock_id), None)

    if not stock:
        return {"error": "Stock not found"}

    return update_quarterly_earnings(stock_id, stock["code"])

@router.post("/{stock_id}/update-info")
def update_info(stock_id: int):

    stocks = get_all_stocks()
    stock = next((s for s in stocks if s["id"] == stock_id), None)

    if not stock:
        raise HTTPException(status_code=404, detail="Stock not found")

    return update_stock_info(stock_id, stock["code"])

@router.get("/{stock_id}/info")
def info(stock_id: int):
    stock_info = get_stock_info(stock_id)
    if stock_info is None:
        raise HTTPException(status_code=404, detail="Stock info not found")
    return stock_info

@router.get("/{stock_id}/earnings")
def earnings(stock_id: int):
    return get_earnings_data(stock_id)

@router.get("/{stock_id}/chart")
def chart(stock_id: int, start: str, end: str):
    return get_chart_data(stock_id, start, end)

