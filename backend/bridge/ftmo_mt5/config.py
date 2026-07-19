from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path


def _load_env_files() -> None:
    for name in (".env", ".env.local"):
        path = Path(name)
        if not path.exists():
            continue
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


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
    account_size_configured: bool
    max_daily_loss_pct: float
    max_total_loss_pct: float
    daily_loss_safety_buffer_pct: float
    max_risk_per_trade_pct: float
    max_order_volume: float
    max_daily_orders: int
    max_messages_per_minute: int
    snapshot_interval_ms: int
    close_all_enabled: bool
    require_stop_loss: bool
    audit_path: Path
    magic: int
    deviation_points: int
    comment_prefix: str
    symbols: dict[str, str]
    # Companion mode attaches to an account already authenticated in MT5.  It
    # never reads broker credentials or a terminal path from environment
    # variables and never calls mt5.login().
    attached_account: bool = False


def load_config() -> BridgeConfig:
    _load_env_files()
    account_size_configured = "FTMO_ACCOUNT_SIZE" in os.environ
    config = BridgeConfig(
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
        account_size_configured=account_size_configured,
        # Three percent is the fail-safe default across current FTMO account
        # variants. Operators may lower it; a larger value must be deliberate.
        max_daily_loss_pct=_float_env("FTMO_MAX_DAILY_LOSS_PCT", 3),
        max_total_loss_pct=_float_env("FTMO_MAX_TOTAL_LOSS_PCT", 10),
        daily_loss_safety_buffer_pct=_float_env("FTMO_DAILY_LOSS_SAFETY_BUFFER_PCT", 0.2),
        max_risk_per_trade_pct=_float_env("FTMO_MAX_RISK_PER_TRADE_PCT", 0.5),
        max_order_volume=_float_env("FTMO_BRIDGE_MAX_ORDER_VOLUME", 1),
        max_daily_orders=_int_env("FTMO_BRIDGE_MAX_DAILY_ORDERS", 100),
        max_messages_per_minute=_int_env("FTMO_BRIDGE_MAX_MESSAGES_PER_MINUTE", 60),
        snapshot_interval_ms=_int_env("FTMO_BRIDGE_SNAPSHOT_INTERVAL_MS", 1000),
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
        attached_account=False,
    )
    loopback_hosts = {"127.0.0.1", "::1", "localhost"}
    if (not config.dry_run or config.host.lower() not in loopback_hosts) and len(config.token) < 32:
        raise ValueError(
            "FTMO_BRIDGE_TOKEN must contain at least 32 characters for live or non-loopback bridges"
        )
    return config


def companion_config(*, port: int = 8787, data_dir: Path | None = None) -> BridgeConfig:
    """Return safe, zero-configuration defaults for the desktop connector.

    Unlike :func:`load_config`, this function deliberately does not load a
    repository ``.env`` file or broker credentials.  The packaged connector
    binds to loopback and attaches to the FTMO account already logged in to the
    user's desktop terminal.
    """

    if port < 1 or port > 65_535:
        raise ValueError("connector port must be between 1 and 65535")
    if data_dir is None:
        local_app_data = os.getenv("LOCALAPPDATA")
        base = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
        data_dir = base / "TradingTerminal" / "MT5Connector"
    return BridgeConfig(
        enabled=True,
        dry_run=False,
        allow_live=True,
        host="127.0.0.1",
        port=port,
        token="",
        login="",
        password="",
        server="",
        terminal_path="",
        account_label="FTMO",
        account_size=100_000,
        account_size_configured=False,
        max_daily_loss_pct=3,
        max_total_loss_pct=10,
        daily_loss_safety_buffer_pct=0.2,
        max_risk_per_trade_pct=0.5,
        max_order_volume=1,
        max_daily_orders=100,
        max_messages_per_minute=60,
        snapshot_interval_ms=1_000,
        close_all_enabled=True,
        require_stop_loss=True,
        audit_path=data_dir / "audit.jsonl",
        magic=6602,
        deviation_points=20,
        comment_prefix="smc-ftmo",
        symbols={
            "EURUSD": "EURUSD",
            "GBPUSD": "GBPUSD",
            "USDJPY": "USDJPY",
            "XAUUSD": "XAUUSD",
            "BTCUSDT": "BTCUSD",
            "ETHUSDT": "ETHUSD",
        },
        attached_account=True,
    )
