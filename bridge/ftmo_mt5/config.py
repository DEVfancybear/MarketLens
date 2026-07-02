from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path


def _bool_env(name: str, fallback: bool) -> bool:
    value = os.getenv(name)
    if value is None or value == "":
        return fallback
    return value.lower() in {"1", "true", "yes", "on"}


def _float_env(name: str, fallback: float) -> float:
    value = os.getenv(name)
    if value is None or value == "":
        return fallback
    try:
        return float(value)
    except ValueError:
        return fallback


def _int_env(name: str, fallback: int) -> int:
    value = os.getenv(name)
    if value is None or value == "":
        return fallback
    try:
        return int(value)
    except ValueError:
        return fallback


@dataclass(frozen=True)
class BridgeConfig:
    enabled: bool
    dry_run: bool
    allow_live: bool
    host: str
    port: int
    token: str
    login: str
    password: str
    server: str
    terminal_path: str
    account_label: str
    account_size: float
    max_daily_loss_pct: float
    max_total_loss_pct: float
    daily_loss_safety_buffer_pct: float
    max_risk_per_trade_pct: float
    max_order_volume: float
    max_daily_orders: int
    max_messages_per_minute: int
    close_all_enabled: bool
    require_stop_loss: bool
    audit_path: Path
    magic: int
    deviation_points: int
    comment_prefix: str
    symbols: dict[str, str]


def load_config() -> BridgeConfig:
    return BridgeConfig(
        enabled=_bool_env("FTMO_MT5_ENABLED", False),
        dry_run=_bool_env("FTMO_BRIDGE_DRY_RUN", True),
        allow_live=_bool_env("FTMO_BRIDGE_ALLOW_LIVE", False),
        host=os.getenv("FTMO_BRIDGE_BIND_HOST", "127.0.0.1"),
        port=_int_env("FTMO_BRIDGE_BIND_PORT", 8787),
        token=os.getenv("FTMO_BRIDGE_TOKEN", ""),
        login=os.getenv("FTMO_MT5_LOGIN", ""),
        password=os.getenv("FTMO_MT5_PASSWORD", ""),
        server=os.getenv("FTMO_MT5_SERVER", ""),
        terminal_path=os.getenv("FTMO_MT5_TERMINAL_PATH", ""),
        account_label=os.getenv("FTMO_MT5_ACCOUNT_LABEL", "FTMO"),
        account_size=_float_env("FTMO_ACCOUNT_SIZE", 100000),
        max_daily_loss_pct=_float_env("FTMO_MAX_DAILY_LOSS_PCT", 5),
        max_total_loss_pct=_float_env("FTMO_MAX_TOTAL_LOSS_PCT", 10),
        daily_loss_safety_buffer_pct=_float_env("FTMO_DAILY_LOSS_SAFETY_BUFFER_PCT", 0.2),
        max_risk_per_trade_pct=_float_env("FTMO_MAX_RISK_PER_TRADE_PCT", 0.5),
        max_order_volume=_float_env("FTMO_BRIDGE_MAX_ORDER_VOLUME", 1),
        max_daily_orders=_int_env("FTMO_BRIDGE_MAX_DAILY_ORDERS", 100),
        max_messages_per_minute=_int_env("FTMO_BRIDGE_MAX_MESSAGES_PER_MINUTE", 60),
        close_all_enabled=_bool_env("FTMO_BRIDGE_CLOSE_ALL_ENABLED", True),
        require_stop_loss=_bool_env("FTMO_REQUIRE_STOP_LOSS", True),
        audit_path=Path(os.getenv("FTMO_BRIDGE_AUDIT_PATH", ".data/ftmo-mt5-audit.jsonl")),
        magic=_int_env("FTMO_MT5_MAGIC", 6602),
        deviation_points=_int_env("FTMO_MT5_DEVIATION_POINTS", 20),
        comment_prefix=os.getenv("FTMO_MT5_COMMENT_PREFIX", "smc-ftmo"),
        symbols={
            "EURUSD": os.getenv("FTMO_SYMBOL_EURUSD", "EURUSD"),
            "GBPUSD": os.getenv("FTMO_SYMBOL_GBPUSD", "GBPUSD"),
            "USDJPY": os.getenv("FTMO_SYMBOL_USDJPY", "USDJPY"),
            "XAUUSD": os.getenv("FTMO_SYMBOL_XAUUSD", "XAUUSD"),
            "BTCUSDT": os.getenv("FTMO_SYMBOL_BTCUSDT", "BTCUSD"),
            "ETHUSDT": os.getenv("FTMO_SYMBOL_ETHUSDT", "ETHUSD"),
        },
    )

