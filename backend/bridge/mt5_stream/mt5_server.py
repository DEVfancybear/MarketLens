#!/usr/bin/env python3
"""Local MT5 tick streaming bridge.

The MetaTrader5 Python package can only run on a host where the MT5 terminal is
installed and logged in. This sidecar process keeps MT5 integration outside the
Go API process and exposes a small localhost WebSocket stream that Go can
consume with a normal WebSocket client.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
from dataclasses import dataclass
from typing import Any, Set

import MetaTrader5 as mt5
import websockets
from websockets.server import WebSocketServerProtocol


LOG = logging.getLogger("mt5-stream")


@dataclass(frozen=True)
class Config:
    symbols: tuple[str, ...]
    stream_all_visible: bool
    host: str
    port: int
    poll_interval_ms: int
    terminal_path: str | None
    login: int | None
    password: str | None
    server: str | None

    @classmethod
    def from_env(cls) -> "Config":
        login_raw = os.getenv("MT5_LOGIN", "").strip()
        symbols_raw = os.getenv("MT5_SYMBOLS", os.getenv("MT5_SYMBOL", ""))
        return cls(
            symbols=parse_symbols(symbols_raw),
            stream_all_visible=env_bool("MT5_STREAM_ALL_VISIBLE", False),
            host=os.getenv("MT5_STREAM_HOST", "localhost").strip(),
            port=int(os.getenv("MT5_STREAM_PORT", "8765")),
            poll_interval_ms=int(os.getenv("MT5_POLL_INTERVAL_MS", "100")),
            terminal_path=os.getenv("MT5_TERMINAL_PATH") or None,
            login=int(login_raw) if login_raw else None,
            password=os.getenv("MT5_PASSWORD") or None,
            server=os.getenv("MT5_SERVER") or None,
        )


CLIENTS: Set[WebSocketServerProtocol] = set()
SYMBOL_CATALOG: list[dict[str, Any]] = []
STREAM_SYMBOLS: tuple[str, ...] = ()


def parse_symbols(raw: str) -> tuple[str, ...]:
    symbols: list[str] = []
    seen: set[str] = set()
    for item in raw.split(","):
        symbol = item.strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        symbols.append(symbol)
    return tuple(symbols)


def env_bool(key: str, fallback: bool) -> bool:
    raw = os.getenv(key)
    if raw is None:
        return fallback
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def setup_logging() -> None:
    logging.basicConfig(
        level=os.getenv("MT5_STREAM_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def last_mt5_error() -> str:
    code, message = mt5.last_error()
    return f"{code}: {message}"


def initialize_mt5(cfg: Config) -> tuple[list[dict[str, Any]], tuple[str, ...]]:
    init_args = {}
    if cfg.terminal_path:
        init_args["path"] = cfg.terminal_path

    if not mt5.initialize(**init_args):
        raise RuntimeError(f"MT5 initialize failed ({last_mt5_error()})")

    # Credentials are optional because many demo/dev terminals are already
    # logged in. When one credential is provided, require the full set so a
    # partial configuration cannot silently attach to the wrong account.
    provided_login = cfg.login is not None
    provided_password = bool(cfg.password)
    provided_server = bool(cfg.server)
    if provided_login or provided_password or provided_server:
        if not (provided_login and provided_password and provided_server):
            raise RuntimeError(
                "MT5_LOGIN, MT5_PASSWORD, and MT5_SERVER must be set together"
            )
        if not mt5.login(cfg.login, password=cfg.password, server=cfg.server):
            raise RuntimeError(f"MT5 login failed ({last_mt5_error()})")

    account = mt5.account_info()
    if account is None:
        raise RuntimeError(f"MT5 account is unavailable ({last_mt5_error()})")

    catalog = load_symbol_catalog()
    stream_symbols = resolve_stream_symbols(cfg, catalog)
    select_symbols(stream_symbols)

    LOG.info(
        "MT5 initialized account=%s server=%s symbols=%d stream_symbols=%s",
        account.login,
        account.server,
        len(catalog),
        ",".join(stream_symbols) if stream_symbols else "(none)",
    )
    return catalog, stream_symbols


def load_symbol_catalog() -> list[dict[str, Any]]:
    symbols = mt5.symbols_get()
    if symbols is None:
        raise RuntimeError(f"MT5 symbols_get failed ({last_mt5_error()})")

    catalog: list[dict[str, Any]] = []
    for info in symbols:
        catalog.append(
            {
                "name": info.name,
                "path": info.path,
                "description": info.description,
                "visible": bool(info.visible),
                "digits": int(info.digits),
                "spread": int(info.spread),
                "trade_mode": int(info.trade_mode),
                "currency_base": info.currency_base,
                "currency_profit": info.currency_profit,
                "currency_margin": info.currency_margin,
            }
        )
    catalog.sort(key=lambda item: item["name"])
    return catalog


def resolve_stream_symbols(
    cfg: Config,
    catalog: list[dict[str, Any]],
) -> tuple[str, ...]:
    available = {item["name"].upper(): item["name"] for item in catalog}

    if cfg.symbols:
        missing = [symbol for symbol in cfg.symbols if symbol.upper() not in available]
        if missing:
            raise RuntimeError(f"MT5 symbols not found: {', '.join(missing)}")
        return tuple(available[symbol.upper()] for symbol in cfg.symbols)

    if cfg.stream_all_visible:
        return tuple(item["name"] for item in catalog if item["visible"])

    LOG.warning(
        "No MT5_SYMBOLS configured and MT5_STREAM_ALL_VISIBLE=false; "
        "bridge will publish the symbol catalog only"
    )
    return ()


def select_symbols(symbols: tuple[str, ...]) -> None:
    for symbol in symbols:
        if not mt5.symbol_select(symbol, True):
            raise RuntimeError(
                f"MT5 symbol_select({symbol}) failed ({last_mt5_error()})"
            )


async def register_client(websocket: WebSocketServerProtocol) -> None:
    CLIENTS.add(websocket)
    peer = websocket.remote_address
    LOG.info("client connected peer=%s clients=%d", peer, len(CLIENTS))
    try:
        await websocket.send(symbol_catalog_message())
        await websocket.wait_closed()
    finally:
        CLIENTS.discard(websocket)
        LOG.info("client disconnected peer=%s clients=%d", peer, len(CLIENTS))


def symbol_catalog_message() -> str:
    return json.dumps(
        {
            "type": "symbols",
            "source": "mt5",
            "count": len(SYMBOL_CATALOG),
            "stream_symbols": list(STREAM_SYMBOLS),
            "symbols": SYMBOL_CATALOG,
        },
        separators=(",", ":"),
    )


async def broadcast(message: str) -> None:
    if not CLIENTS:
        return

    stale: list[WebSocketServerProtocol] = []
    for client in tuple(CLIENTS):
        try:
            await client.send(message)
        except Exception as exc:  # noqa: BLE001 - keep sidecar resilient.
            LOG.warning("dropping failed websocket client: %s", exc)
            stale.append(client)

    for client in stale:
        CLIENTS.discard(client)
        try:
            await client.close()
        except Exception:
            pass


async def stream_ticks(cfg: Config, stop_event: asyncio.Event) -> None:
    last_time_msc_by_symbol: dict[str, int] = {}
    sleep_seconds = max(cfg.poll_interval_ms, 10) / 1000

    while not stop_event.is_set():
        try:
            for symbol in STREAM_SYMBOLS:
                tick = mt5.symbol_info_tick(symbol)
                if tick is None:
                    LOG.warning(
                        "symbol_info_tick(%s) returned none (%s)",
                        symbol,
                        last_mt5_error(),
                    )
                    continue

                # time_msc gives stable de-duplication for high-frequency ticks.
                time_msc = int(getattr(tick, "time_msc", 0) or tick.time * 1000)
                if time_msc == last_time_msc_by_symbol.get(symbol):
                    continue

                payload = {
                    "type": "tick",
                    "source": "mt5",
                    "symbol": symbol,
                    "bid": float(tick.bid),
                    "ask": float(tick.ask),
                    "timestamp": int(tick.time),
                    "time_msc": time_msc,
                }
                await broadcast(json.dumps(payload, separators=(",", ":")))
                last_time_msc_by_symbol[symbol] = time_msc
        except Exception:
            LOG.exception("tick streaming loop failed")

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=sleep_seconds)
        except asyncio.TimeoutError:
            pass


async def main() -> None:
    setup_logging()
    cfg = Config.from_env()
    stop_event = asyncio.Event()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:
            # Windows event loops do not support add_signal_handler; Ctrl+C is
            # still handled by KeyboardInterrupt around asyncio.run().
            pass

    global SYMBOL_CATALOG, STREAM_SYMBOLS
    SYMBOL_CATALOG, STREAM_SYMBOLS = initialize_mt5(cfg)
    tick_task: asyncio.Task[None] | None = None
    try:
        async with websockets.serve(
            register_client,
            cfg.host,
            cfg.port,
            ping_interval=20,
            ping_timeout=10,
            max_queue=32,
        ):
            LOG.info("MT5 tick WebSocket listening on ws://%s:%d", cfg.host, cfg.port)
            tick_task = asyncio.create_task(stream_ticks(cfg, stop_event))
            await stop_event.wait()
    finally:
        if tick_task:
            tick_task.cancel()
            try:
                await tick_task
            except asyncio.CancelledError:
                pass
        mt5.shutdown()
        LOG.info("MT5 bridge stopped")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        LOG.info("MT5 bridge interrupted")
