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
    # Optional contract metadata.  Older/dry-run brokers do not provide all
    # of these values; the frontend then falls back to tick value math.
    tick_value_loss: float = 0.0
    tick_value_profit: float = 0.0
    contract_size: float = 0.0
    calc_mode: int | str | None = None
    currency_base: str = ""
    currency_profit: str = ""
    currency_margin: str = ""
    margin_initial: float = 0.0
    margin_maintenance: float = 0.0
    margin_hedged: float = 0.0
    spread: float = 0.0


def fallback_symbol_meta(chart_symbol: str, broker_symbol: str) -> SymbolMeta:
    if "JPY" in chart_symbol:
        return SymbolMeta(
            chart_symbol,
            broker_symbol,
            3,
            0.001,
            0.01,
            0.01,
            100,
            0.001,
            1,
            0,
            0,
            "full",
            contract_size=100_000,
            calc_mode="forex",
            currency_base=chart_symbol[:3],
            currency_profit=chart_symbol[3:6],
        )
    if chart_symbol in {"XAUUSD", "BTCUSDT", "ETHUSDT"}:
        contract_size = 100 if chart_symbol == "XAUUSD" else 1
        return SymbolMeta(
            chart_symbol,
            broker_symbol,
            2,
            0.01,
            0.01,
            0.01,
            50,
            0.01,
            1,
            0,
            0,
            "full",
            contract_size=contract_size,
            calc_mode="cfd",
            currency_base=chart_symbol[:3],
            currency_profit="USD",
        )
    return SymbolMeta(
        chart_symbol,
        broker_symbol,
        5,
        0.00001,
        0.01,
        0.01,
        100,
        0.00001,
        1,
        0,
        0,
        "full",
        contract_size=100_000,
        calc_mode="forex",
        currency_base=chart_symbol[:3],
        currency_profit=chart_symbol[3:6],
    )


def meta_from_mt5_info(chart_symbol: str, broker_symbol: str, info: Any) -> SymbolMeta:
    digits = int(getattr(info, "digits", 5) or 5)
    point = float(getattr(info, "point", 10 ** -digits) or 10 ** -digits)
    tick_size = float(getattr(info, "trade_tick_size", point) or point)
    tick_value = float(getattr(info, "trade_tick_value", 0) or 0)
    tick_value_loss = float(
        getattr(info, "trade_tick_value_loss", tick_value) or tick_value
    )
    tick_value_profit = float(
        getattr(info, "trade_tick_value_profit", tick_value) or tick_value
    )
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
        tick_value_loss=tick_value_loss,
        tick_value_profit=tick_value_profit,
        contract_size=float(getattr(info, "trade_contract_size", 0) or 0),
        calc_mode=getattr(info, "trade_calc_mode", None),
        currency_base=str(getattr(info, "currency_base", "") or ""),
        currency_profit=str(getattr(info, "currency_profit", "") or ""),
        currency_margin=str(getattr(info, "currency_margin", "") or ""),
        margin_initial=float(getattr(info, "margin_initial", 0) or 0),
        margin_maintenance=float(getattr(info, "margin_maintenance", 0) or 0),
        margin_hedged=float(getattr(info, "margin_hedged", 0) or 0),
        spread=float(getattr(info, "spread", 0) or 0),
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
        "tickValueLoss": meta.tick_value_loss or meta.tick_value,
        "tickValueProfit": meta.tick_value_profit or meta.tick_value,
        "contractSize": meta.contract_size or None,
        "calcMode": meta.calc_mode,
        "currencyBase": meta.currency_base or None,
        "currencyProfit": meta.currency_profit or None,
        "currencyMargin": meta.currency_margin or None,
        "marginInitial": meta.margin_initial or None,
        "marginMaintenance": meta.margin_maintenance or None,
        "marginHedged": meta.margin_hedged or None,
        "spread": meta.spread or None,
        "stopLevel": meta.stop_level,
        "freezeLevel": meta.freeze_level,
        "minStopDistance": meta.stop_level * meta.point,
        "tradeMode": meta.trade_mode,
        "updatedAt": int(__import__("time").time() * 1000),
    }
