from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
from typing import Any

from .config import BridgeConfig
from .protocol import now_ms
from .symbols import SymbolMeta


@dataclass
class AccountRiskState:
    day: str
    initial_capital: float
    daily_reference_balance: float
    max_reference_balance: float
    orders: int = 0
    initial_source: str = "runtime_balance"


class RiskGuard:
    """Account-scoped runtime loss guard with a persisted balance baseline.

    The first reliable MT5 balance transaction is preferred as the maximum-loss
    reference.  If MT5 history cannot provide it, the highest observed balance
    is persisted and used as a conservative trailing runtime reference.  That
    fallback cannot reconstruct losses that happened before the Connector was
    first installed, so the UI must not describe it as an exact FTMO rule
    engine.  Persisting it still prevents every Connector restart from silently
    resetting measured drawdown to zero.
    """

    def __init__(
        self,
        config: BridgeConfig,
        *,
        state_path: Path | None = None,
    ) -> None:
        self.config = config
        self.state_path = state_path
        self.states: dict[str, AccountRiskState] = {}
        self.persistence_ok = True
        self.persistence_corrupt = False
        self._load_states()

    def mark_order(
        self,
        account_key: str = "default",
        *,
        balance: float | None = None,
        equity: float | None = None,
        initial_balance: float | None = None,
    ) -> None:
        state = self._state_for(
            account_key,
            balance=balance,
            equity=equity,
            initial_balance=initial_balance,
        )
        state.orders += 1
        self._persist_states()

    def snapshot(
        self,
        equity: float,
        open_risk_at_stops: float = 0,
        extra_risk: float = 0,
        readiness_ok: bool = True,
        *,
        account_key: str = "default",
        balance: float | None = None,
        initial_balance: float | None = None,
    ) -> dict[str, Any]:
        state = self._state_for(
            account_key,
            balance=balance,
            equity=equity,
            initial_balance=initial_balance,
        )
        initial_capital = state.initial_capital
        daily_reference = state.daily_reference_balance
        max_reference = state.max_reference_balance
        daily_loss_limit = initial_capital * (
            self.config.max_daily_loss_pct / 100
        )
        max_loss_limit = initial_capital * (
            self.config.max_total_loss_pct / 100
        )
        daily_threshold = daily_reference - daily_loss_limit
        max_threshold = max_reference - max_loss_limit
        safety_buffer = initial_capital * (
            self.config.daily_loss_safety_buffer_pct / 100
        )
        daily_loss_used = max(0.0, daily_reference - equity)
        max_loss_used = max(0.0, max_reference - equity)
        daily_loss_remaining = max(
            0.0,
            equity - daily_threshold - safety_buffer - open_risk_at_stops,
        )
        max_loss_remaining = max(
            0.0, equity - max_threshold - open_risk_at_stops
        )
        persistence_ready = self.persistence_ok or self.state_path is None
        can_trade = (
            readiness_ok
            and persistence_ready
            and daily_loss_remaining > 0
            and max_loss_remaining > 0
            and state.orders < self.config.max_daily_orders
            and extra_risk <= daily_loss_remaining
            and extra_risk <= max_loss_remaining
        )
        return {
            "accountSize": initial_capital,
            "accountSizeSource": state.initial_source,
            "initialCapital": initial_capital,
            "dailyReferenceBalance": daily_reference,
            "maxReferenceBalance": max_reference,
            "dailyLossThreshold": daily_threshold,
            "maxLossThreshold": max_threshold,
            "baselineDay": state.day,
            "baselinePersisted": persistence_ready,
            "dailyLossLimit": daily_loss_limit,
            "maxLossLimit": max_loss_limit,
            "maxRiskPerTrade": initial_capital
            * (self.config.max_risk_per_trade_pct / 100),
            "dailyLossUsed": daily_loss_used,
            "maxLossUsed": max_loss_used,
            "dailyLossRemaining": daily_loss_remaining,
            "maxLossRemaining": max_loss_remaining,
            "openRiskAtStops": open_risk_at_stops,
            "dailyOrderCount": state.orders,
            "maxDailyOrders": self.config.max_daily_orders,
            "canTrade": can_trade,
            "reason": None
            if can_trade
            else self._reason(
                state,
                readiness_ok,
                persistence_ready,
                daily_loss_remaining,
                max_loss_remaining,
                extra_risk,
            ),
            "updatedAt": now_ms(),
        }

    def validate_order(
        self,
        order: dict[str, Any],
        meta: SymbolMeta | None,
        equity: float,
        open_risk_at_stops: float,
        readiness_ok: bool,
        *,
        account_key: str = "default",
        balance: float | None = None,
        initial_balance: float | None = None,
    ) -> tuple[bool, str, str, dict[str, Any] | None, float]:
        state = self._state_for(
            account_key,
            balance=balance,
            equity=equity,
            initial_balance=initial_balance,
        )
        client_order_id = order.get("clientOrderId")
        if not client_order_id:
            return False, "CLIENT_ORDER_ID_REQUIRED", "clientOrderId is required", None, 0
        if not self.config.enabled:
            return False, "FTMO_BRIDGE_DISABLED", "FTMO_MT5_ENABLED is false", None, 0
        if not readiness_ok:
            return False, "FTMO_READINESS_FAILED", "FTMO bridge readiness checks failed", None, 0
        if self.state_path is not None and not self.persistence_ok:
            return False, "RISK_BASELINE_UNAVAILABLE", "The account risk baseline could not be saved", None, 0
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
        max_risk_per_trade = state.initial_capital * (
            self.config.max_risk_per_trade_pct / 100
        )
        if projected_risk > max_risk_per_trade:
            return (
                False,
                "MAX_RISK_PER_TRADE_EXCEEDED",
                f"Projected stop risk {projected_risk:.2f} exceeds {max_risk_per_trade:.2f}",
                None,
                normalized_volume,
            )
        snapshot = self.snapshot(
            equity,
            open_risk_at_stops,
            projected_risk,
            readiness_ok,
            account_key=account_key,
            balance=balance,
            initial_balance=initial_balance,
        )
        if not snapshot["canTrade"]:
            return False, "FTMO_RISK_GUARD", snapshot["reason"] or "FTMO risk guard blocked trading", snapshot, normalized_volume
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
        if distance <= 0 or meta.tick_size <= 0:
            return math.inf
        tick_value = _loss_tick_value(meta)
        if tick_value <= 0:
            return math.inf
        return distance / meta.tick_size * tick_value * volume

    def estimate_position_risk(self, position: dict[str, Any], meta: SymbolMeta | None) -> float:
        if meta is None:
            return 0
        sl = _as_float(position.get("sl"))
        open_price = _as_float(position.get("openPrice"))
        volume = _as_float(position.get("volume"))
        if sl is None or open_price is None or volume is None:
            return 0
        if meta.tick_size <= 0:
            return math.inf
        tick_value = _loss_tick_value(meta)
        if tick_value <= 0:
            return math.inf
        return abs(open_price - sl) / meta.tick_size * tick_value * volume

    def _state_for(
        self,
        account_key: str,
        *,
        balance: float | None,
        equity: float | None,
        initial_balance: float | None,
    ) -> AccountRiskState:
        key = str(account_key or "default").strip().casefold() or "default"
        current_balance = _positive_float(balance)
        current_equity = _positive_float(equity)
        observed = current_balance or current_equity or max(self.config.account_size, 1.0)
        history_initial = _positive_float(initial_balance)
        configured_initial = (
            _positive_float(self.config.account_size)
            if self.config.account_size_configured
            else None
        )
        reliable_initial = configured_initial or history_initial
        source = (
            "configured"
            if configured_initial is not None
            else "mt5_balance_history"
            if history_initial is not None
            else "runtime_balance"
        )
        day = self._day_key()
        state = self.states.get(key)
        changed = False
        if state is None:
            initial_capital = reliable_initial or observed
            state = AccountRiskState(
                day=day,
                initial_capital=initial_capital,
                daily_reference_balance=max(
                    initial_capital, current_balance or observed
                ),
                max_reference_balance=max(initial_capital, current_balance or observed),
                initial_source=source,
            )
            self.states[key] = state
            changed = True
        else:
            if state.day != day:
                state.day = day
                state.daily_reference_balance = max(
                    state.initial_capital, current_balance or observed
                )
                state.orders = 0
                changed = True
            if reliable_initial is not None:
                should_replace_initial = (
                    configured_initial is not None
                    or state.initial_source == "runtime_balance"
                )
                if should_replace_initial and reliable_initial != state.initial_capital:
                    state.initial_capital = reliable_initial
                    changed = True
                if configured_initial is not None and state.initial_source != "configured":
                    state.initial_source = "configured"
                    changed = True
                elif history_initial is not None and state.initial_source == "runtime_balance":
                    state.initial_source = source
                    changed = True
                if state.initial_capital > state.max_reference_balance:
                    state.max_reference_balance = state.initial_capital
                    changed = True
                if state.initial_capital > state.daily_reference_balance:
                    state.daily_reference_balance = state.initial_capital
                    changed = True
            if current_balance is not None and current_balance > state.max_reference_balance:
                # Unified fail-safe policy: trail the highest observed balance.
                # This is exact for trailing variants and stricter than a static
                # maximum-loss reference for non-trailing variants.
                state.max_reference_balance = current_balance
                changed = True
        if changed:
            self._persist_states()
        return state

    def _reason(
        self,
        state: AccountRiskState,
        readiness_ok: bool,
        persistence_ready: bool,
        daily_remaining: float,
        max_remaining: float,
        extra_risk: float,
    ) -> str:
        if not readiness_ok:
            return "FTMO bridge readiness failed"
        if not persistence_ready:
            return "Account risk baseline is not safely persisted"
        if state.orders >= self.config.max_daily_orders:
            return "Daily order limit reached"
        if daily_remaining <= 0:
            return "Daily loss guard has no remaining buffer"
        if max_remaining <= 0:
            return "Maximum loss guard has no remaining buffer"
        if extra_risk > daily_remaining:
            return "Projected stop loss exceeds daily loss buffer"
        if extra_risk > max_remaining:
            return "Projected stop loss exceeds maximum loss buffer"
        return "FTMO risk guard blocked trading"

    def _load_states(self) -> None:
        if self.state_path is None or not self.state_path.exists():
            return
        try:
            raw = json.loads(self.state_path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict) or raw.get("version") != 2:
                raise ValueError("unsupported risk baseline version")
            rows = raw.get("accounts") if isinstance(raw, dict) else None
            if not isinstance(rows, dict):
                raise ValueError("risk baseline accounts are missing")
            for key, value in rows.items():
                if not isinstance(key, str) or not isinstance(value, dict):
                    raise ValueError("risk baseline account row is invalid")
                day = str(value.get("day") or "").strip()
                initial_capital = _positive_float(value.get("initial_capital"))
                daily_reference = _positive_float(
                    value.get("daily_reference_balance")
                )
                max_reference = _positive_float(value.get("max_reference_balance"))
                orders = value.get("orders", 0)
                source = str(value.get("initial_source") or "runtime_balance")
                if (
                    not day
                    or initial_capital is None
                    or daily_reference is None
                    or max_reference is None
                    or not isinstance(orders, int)
                    or isinstance(orders, bool)
                    or orders < 0
                    or daily_reference < initial_capital
                    or max_reference < daily_reference
                    or source
                    not in {"configured", "mt5_balance_history", "runtime_balance"}
                ):
                    raise ValueError("risk baseline account values are invalid")
                try:
                    datetime.strptime(day, "%Y-%m-%d")
                except ValueError as exc:
                    raise ValueError("risk baseline day is invalid") from exc
                self.states[key.casefold()] = AccountRiskState(
                    day=day,
                    initial_capital=initial_capital,
                    daily_reference_balance=daily_reference,
                    max_reference_balance=max_reference,
                    orders=orders,
                    initial_source=source,
                )
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            # A corrupt baseline must fail closed for live trading. Keep the
            # in-memory map empty so diagnostics can still render.
            self.persistence_ok = False
            self.persistence_corrupt = True

    def _persist_states(self) -> None:
        if self.state_path is None:
            return
        if self.persistence_corrupt:
            return
        payload = {
            "version": 2,
            "accounts": {key: asdict(value) for key, value in self.states.items()},
        }
        temporary = self.state_path.with_suffix(self.state_path.suffix + ".tmp")
        try:
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            temporary.write_text(
                json.dumps(payload, sort_keys=True, separators=(",", ":")),
                encoding="utf-8",
            )
            os.replace(temporary, self.state_path)
            self.persistence_ok = True
        except OSError:
            self.persistence_ok = False
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass

    def _day_key(self) -> str:
        return _prague_trading_day(datetime.now(timezone.utc))


def floor_to_step(value: float, step: float) -> float:
    if step <= 0:
        return value
    decimals = max(0, len(str(step).split(".")[1]) if "." in str(step) else 0)
    return round(math.floor((value + 1e-12) / step) * step, decimals)


def _loss_tick_value(meta: SymbolMeta) -> float:
    """Use MT5's direction-specific loss value when it is available."""

    value = meta.tick_value_loss or meta.tick_value
    if value > 0:
        return value
    if meta.tick_size > 0 and meta.contract_size > 0:
        return meta.tick_size * meta.contract_size
    return 0.0


def _positive_float(value: Any) -> float | None:
    number = _as_float(value)
    return number if number is not None and number > 0 else None


def _prague_trading_day(utc_value: datetime) -> str:
    """Return the Europe/Prague calendar day without an external tz database.

    Windows Python doesn't ship IANA zone data. Current Europe/Prague time uses
    the EU rule: CEST begins at 01:00 UTC on the last Sunday in March and CET
    resumes at 01:00 UTC on the last Sunday in October.
    """

    value = utc_value.astimezone(timezone.utc)
    year = value.year
    march_transition = _last_sunday(year, 3).replace(
        hour=1, tzinfo=timezone.utc
    )
    october_transition = _last_sunday(year, 10).replace(
        hour=1, tzinfo=timezone.utc
    )
    offset_hours = 2 if march_transition <= value < october_transition else 1
    return (value + timedelta(hours=offset_hours)).strftime("%Y-%m-%d")


def _last_sunday(year: int, month: int) -> datetime:
    if month == 12:
        next_month = datetime(year + 1, 1, 1)
    else:
        next_month = datetime(year, month + 1, 1)
    last_day = next_month - timedelta(days=1)
    return last_day - timedelta(days=(last_day.weekday() + 1) % 7)


def _as_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None
