import asyncio
import json
import sys
import threading
import time
import types
import unittest
from types import SimpleNamespace


class MetaTrader5Stub(types.ModuleType):
    TIMEFRAME_M1 = 1
    TIMEFRAME_M3 = 3
    TIMEFRAME_M5 = 5
    TIMEFRAME_M15 = 15
    TIMEFRAME_M30 = 30
    TIMEFRAME_H1 = 60
    TIMEFRAME_H2 = 120
    TIMEFRAME_H4 = 240
    TIMEFRAME_D1 = 1440
    TIMEFRAME_W1 = 10080
    TIMEFRAME_MN1 = 43200

    def __init__(self) -> None:
        super().__init__("MetaTrader5")
        self.symbol_info_tick = lambda _symbol: None
        self.symbol_select = lambda _symbol, _visible: True
        self.last_error = lambda: (0, "ok")


# The bridge module imports MetaTrader5 at import time. Stub it before import so
# these unit tests run on CI/dev machines without a local MT5 terminal.
sys.modules["MetaTrader5"] = MetaTrader5Stub()

from bridge.mt5_stream import mt5_server  # noqa: E402


class Mt5ServerTickTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_symbol_info_tick = mt5_server.mt5.symbol_info_tick
        self.original_symbol_select = mt5_server.mt5.symbol_select
        self.original_catalog = list(mt5_server.SYMBOL_CATALOG)
        self.original_stream_symbols = tuple(mt5_server.STREAM_SYMBOLS)
        self.original_tick_offset = mt5_server.MT5_TICK_TIME_OFFSET_SECONDS

    def tearDown(self) -> None:
        mt5_server.mt5.symbol_info_tick = self.original_symbol_info_tick
        mt5_server.mt5.symbol_select = self.original_symbol_select
        mt5_server.SYMBOL_CATALOG = self.original_catalog
        mt5_server.STREAM_SYMBOLS = self.original_stream_symbols
        mt5_server.MT5_TICK_TIME_OFFSET_SECONDS = self.original_tick_offset

    def test_changed_tick_messages_dedupes_and_normalizes_tick_time(self) -> None:
        ticks = {
            "EURUSD": SimpleNamespace(
                bid=1.10001,
                ask=1.10013,
                time=7200,
                time_msc=7_200_250,
            ),
            "GBPUSD": SimpleNamespace(
                bid=1.27001,
                ask=1.27014,
                time=7300,
                time_msc=7_300_250,
            ),
        }
        mt5_server.mt5.symbol_info_tick = lambda symbol: ticks.get(symbol)
        mt5_server.MT5_TICK_TIME_OFFSET_SECONDS = 3600

        messages, seen = mt5_server.changed_tick_messages(
            ("EURUSD", "GBPUSD"),
            {"GBPUSD": 7_300_250},
        )

        self.assertEqual(len(messages), 1)
        payload = json.loads(messages[0])
        self.assertEqual(payload["type"], "tick")
        self.assertEqual(payload["source"], "mt5")
        self.assertEqual(payload["symbol"], "EURUSD")
        self.assertEqual(payload["timestamp"], 3600)
        self.assertEqual(payload["time_msc"], 3_600_250)
        self.assertEqual(seen["EURUSD"], 7_200_250)
        self.assertEqual(seen["GBPUSD"], 7_300_250)

    def test_add_stream_symbols_selects_only_catalog_symbols_not_already_streamed(self) -> None:
        mt5_server.SYMBOL_CATALOG = [
            {"name": "EURUSD"},
            {"name": "XAUUSD"},
        ]
        mt5_server.STREAM_SYMBOLS = ("EURUSD",)
        selected: list[tuple[str, bool]] = []
        mt5_server.mt5.symbol_select = (
            lambda symbol, visible: selected.append((symbol, visible)) or True
        )

        added = mt5_server.add_stream_symbols(["xauusd", "missing", "EURUSD"])

        self.assertEqual(added, ("XAUUSD",))
        self.assertEqual(mt5_server.STREAM_SYMBOLS, ("EURUSD", "XAUUSD"))
        self.assertEqual(selected, [("XAUUSD", True)])


class Mt5ServerWorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_tick_snapshot_worker_does_not_block_asyncio_loop(self) -> None:
        original_current_tick_messages = mt5_server.current_tick_messages
        worker_threads: list[int] = []

        def blocking_snapshot(_symbols: tuple[str, ...]) -> list[str]:
            worker_threads.append(threading.get_ident())
            time.sleep(0.08)
            return ["snapshot"]

        mt5_server.current_tick_messages = blocking_snapshot
        try:
            started = time.perf_counter()
            task = asyncio.create_task(
                mt5_server.current_tick_messages_worker(("EURUSD",)),
            )
            await asyncio.sleep(0.01)

            self.assertLess(time.perf_counter() - started, 0.05)
            self.assertFalse(task.done())
            self.assertEqual(await task, ["snapshot"])
            self.assertTrue(worker_threads)
            self.assertNotEqual(worker_threads[0], threading.get_ident())
        finally:
            mt5_server.current_tick_messages = original_current_tick_messages


if __name__ == "__main__":
    unittest.main()
