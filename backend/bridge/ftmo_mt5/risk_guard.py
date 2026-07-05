from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import math
from typing import Any

from .config import BridgeConfig
from .protocol import now_ms
from .symbols import SymbolMeta


@dataclass
class DailyCounters:
    day: str
    orders: int = 0


class RiskGuard:
    def __init__(self, config: BridgeConfig) -> None:
        self.config = config
        self.daily = DailyCounters(self._day_key())

    def reset_if_needed(self) -> None:
        day = self._day_key()
        if day != self.daily.day:
            self.daily = DailyCounters(day)

    def mark_order(self) -> None:
        self.reset_if_needed()
        self.daily.orders += 1

    def snapshot(
        self,
        equity: float,
        open_risk_at_stops: float = 0,
        extra_risk: float = 0,
        readiness_ok: bool = True,
    ) -> dict[str, Any]:
        self.reset_if_needed()
        account_size = self.effective_account_size(equity)
        daily_loss_limit = account_size * (self.config.max_daily_loss_pct / 100)
        max_loss_limit = account_size * (self.config.max_total_loss_pct / 100)
        safety_buffer = account_size * (self.config.daily_loss_safety_buffer_pct / 100)
        daily_loss_used = max(0, account_size - equity)
        max_loss_used = max(0, account_size - equity)
        daily_loss_remaining = max(
            0,
            daily_loss_limit - safety_buffer - daily_loss_used - open_risk_at_stops,
        )
        max_loss_remaining = max(0, max_loss_limit - max_loss_used - open_risk_at_stops)
        can_trade = (
            readiness_ok
            and daily_loss_remaining > 0
            and max_loss_remaining > 0
            and self.daily.orders < self.config.max_daily_orders
            and extra_risk <= daily_loss_remaining
            and extra_risk <= max_loss_remaining
        )
        return {
            "accountSize": account_size,
            "accountSizeSource": "fixed" if self.config.account_size_configured else "equity",
            "dailyLossLimit": daily_loss_limit,
            "maxLossLimit": max_loss_limit,
            "maxRiskPerTrade": account_size * (self.config.max_risk_per_trade_pct / 100),
            "dailyLossUsed": daily_loss_used,
            "dailyLossRemaining": daily_loss_remaining,
            "maxLossRemaining": max_loss_remaining,
            "openRiskAtStops": open_risk_at_stops,
            "dailyOrderCount": self.daily.orders,
            "maxDailyOrders": self.config.max_daily_orders,
            "canTrade": can_trade,
            "reason": None if can_trade else self._reason(readiness_ok, daily_loss_remaining, max_loss_remaining, extra_risk),
            "updatedAt": now_ms(),
        }

    def validate_order(
        self,
        order: dict[str, Any],
        meta: SymbolMeta | None,
        equity: float,
        open_risk_at_stops: float,
        readiness_ok: bool,
    ) -> tuple[bool, str, str, dict[str, Any] | None, float]:
        self.reset_if_needed()
        client_order_id = order.get("clientOrderId")
        if not client_order_id:
            return False, "CLIENT_ORDER_ID_REQUIRED", "clientOrderId is required", None, 0
        if not self.config.enabled:
            return False, "FTMO_BRIDGE_DISABLED", "FTMO_MT5_ENABLED is false", None, 0
        if not readiness_ok:
            return False, "FTMO_READINESS_FAILED", "FTMO bridge readiness checks failed", None, 0
        if meta is None:
            return False, "UNKNOWN_SYMBOL", f"No MT5 symbol mapping for {order.get('chartSymbol')}", None, 0
        if meta.trade_mode != "full":
            return False, "SYMBOL_NOT_TRADABLE", f"{meta.broker_symbol} is not fully tradable", None, 0
        volume = _as_float(order.get("volume"))
        if volume is None or volume <= 0:
            return False, "INVALID_VOLUME", "Order volume must be a positive number", None, 0
        max_allowed = min(meta.max_lot, self.config.max_order_volume)
        if volume > max_allowed:
            return False, "MAX_VOLUME_EXCEEDED", f"Requested volume {volume} exceeds max allowed {max_allowed}", None, 0
        normalized_volume = floor_to_step(volume, meta.lot_step)
        if normalized_volume < meta.min_lot:
            return False, "MIN_VOLUME_NOT_MET", f"Normalized volume {normalized_volume} is below minimum {meta.min_lot}", None, 0
        if self.config.require_stop_loss and _as_float(order.get("sl")) is None:
            return False, "STOP_LOSS_REQUIRED", "FTMO bridge requires stop loss", None, normalized_volume
        projected_risk = self.estimate_order_risk(order, meta, normalized_volume)
        if not math.isfinite(projected_risk):
            return False, "INVALID_STOP_DISTANCE", "Stop loss must differ from entry price", None, normalized_volume
        account_size = self.effective_account_size(equity)
        max_risk_per_trade = account_size * (self.config.max_risk_per_trade_pct / 100)
        if projected_risk > max_risk_per_trade:
            return (
                False,
                "MAX_RISK_PER_TRADE_EXCEEDED",
                f"Projected stop risk {projected_risk:.2f} exceeds {max_risk_per_trade:.2f}",
                None,
                normalized_volume,
            )
        snapshot = self.snapshot(equity, open_risk_at_stops, projected_risk, readiness_ok)
        if not snapshot["canTrade"]:
            return False, "FTMO_RISK_GUARD", snapshot["reason"] or "FTMO risk guard blocked the order", snapshot, normalized_volume
        return True, "OK", "OK", snapshot, normalized_volume

    def estimate_order_risk(self, order: dict[str, Any], meta: SymbolMeta, volume: float) -> float:
        sl = _as_float(order.get("sl"))
        if sl is None:
            return 0
        entry = _as_float(order.get("price"))
        if entry is None:
            entry = _as_float(order.get("marketPrice"))
        if entry is None or entry <= 0:
            return math.inf
        distance = abs(entry - sl)
        if distance <= 0:
            return math.inf
        return distance / meta.tick_size * meta.tick_value * volume

    def effective_account_size(self, equity: float) -> float:
        if self.config.account_size_configured and self.config.account_size > 0:
            return self.config.account_size
        if math.isfinite(equity) and equity > 0:
            return equity
        return self.config.account_size

    def estimate_position_risk(self, position: dict[str, Any], meta: SymbolMeta | None) -> float:
        if meta is None:
            return 0
        sl = _as_float(position.get("sl"))
        open_price = _as_float(position.get("openPrice"))
        volume = _as_float(position.get("volume"))
        if sl is None or open_price is None or volume is None:
            return 0
        return abs(open_price - sl) / meta.tick_size * meta.tick_value * volume

    def _reason(self, readiness_ok: bool, daily_remaining: float, max_remaining: float, extra_risk: float) -> str:
        if not readiness_ok:
            return "FTMO bridge readiness failed"
        if self.daily.orders >= self.config.max_daily_orders:
            return "Daily order limit reached"
        if daily_remaining <= 0:
            return "Daily loss guard has no remaining buffer"
        if max_remaining <= 0:
            return "Maximum loss guard has no remaining buffer"
        if extra_risk > daily_remaining:
            return "Projected stop loss exceeds daily loss buffer"
        if extra_risk > max_remaining:
            return "Projected stop loss exceeds maximum loss buffer"
        return "Risk guard blocked trading"

    def _day_key(self) -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def floor_to_step(value: float, step: float) -> float:
    if step <= 0:
        return value
    decimals = max(0, len(str(step).split(".")[1]) if "." in str(step) else 0)
    return round(math.floor((value + 1e-12) / step) * step, decimals)


def _as_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None
