from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SymbolMeta:
    chart_symbol: str
    broker_symbol: str
    digits: int
    point: float
    lot_step: float
    min_lot: float
    max_lot: float
    tick_size: float
    tick_value: float
    stop_level: int
    freeze_level: int
    trade_mode: str


def fallback_symbol_meta(chart_symbol: str, broker_symbol: str) -> SymbolMeta:
    if "JPY" in chart_symbol:
        return SymbolMeta(chart_symbol, broker_symbol, 3, 0.001, 0.01, 0.01, 100, 0.001, 1, 0, 0, "full")
    if chart_symbol in {"XAUUSD", "BTCUSDT", "ETHUSDT"}:
        return SymbolMeta(chart_symbol, broker_symbol, 2, 0.01, 0.01, 0.01, 50, 0.01, 1, 0, 0, "full")
    return SymbolMeta(chart_symbol, broker_symbol, 5, 0.00001, 0.01, 0.01, 100, 0.00001, 1, 0, 0, "full")


def meta_from_mt5_info(chart_symbol: str, broker_symbol: str, info: Any) -> SymbolMeta:
    digits = int(getattr(info, "digits", 5) or 5)
    point = float(getattr(info, "point", 10 ** -digits) or 10 ** -digits)
    tick_size = float(getattr(info, "trade_tick_size", point) or point)
    tick_value = float(getattr(info, "trade_tick_value", 0) or 0)
    if tick_value <= 0:
        tick_value = 1
    return SymbolMeta(
        chart_symbol=chart_symbol,
        broker_symbol=broker_symbol,
        digits=digits,
        point=point,
        lot_step=float(getattr(info, "volume_step", 0.01) or 0.01),
        min_lot=float(getattr(info, "volume_min", 0.01) or 0.01),
        max_lot=float(getattr(info, "volume_max", 100) or 100),
        tick_size=tick_size,
        tick_value=tick_value,
        stop_level=int(getattr(info, "trade_stops_level", 0) or 0),
        freeze_level=int(getattr(info, "trade_freeze_level", 0) or 0),
        trade_mode="full" if int(getattr(info, "trade_mode", 0) or 0) != 0 else "disabled",
    )


def public_symbol_info(meta: SymbolMeta, max_order_volume: float) -> dict[str, Any]:
    public_max_lot = min(meta.max_lot, max_order_volume)
    max_lot_reason = "broker" if meta.max_lot <= max_order_volume else "bridge"
    return {
        "chartSymbol": meta.chart_symbol,
        "brokerSymbol": meta.broker_symbol,
        "digits": meta.digits,
        "point": meta.point,
        "lotStep": meta.lot_step,
        "minLot": meta.min_lot,
        "maxLot": public_max_lot,
        "brokerMaxLot": meta.max_lot,
        "bridgeMaxLot": max_order_volume,
        "maxLotReason": max_lot_reason,
        "tickSize": meta.tick_size,
        "tickValue": meta.tick_value,
        "stopLevel": meta.stop_level,
        "freezeLevel": meta.freeze_level,
        "minStopDistance": meta.stop_level * meta.point,
        "tradeMode": meta.trade_mode,
        "updatedAt": int(__import__("time").time() * 1000),
    }
