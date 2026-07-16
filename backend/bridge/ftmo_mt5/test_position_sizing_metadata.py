from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace
import unittest

from .config import load_config
from .risk_guard import RiskGuard
from .symbols import (
    SymbolMeta,
    fallback_symbol_meta,
    meta_from_mt5_info,
    public_symbol_info,
)


class PositionSizingMetadataTests(unittest.TestCase):
    def test_mt5_symbol_fields_are_forwarded_to_public_payload(self) -> None:
        info = SimpleNamespace(
            digits=5,
            point=0.00001,
            trade_tick_size=0.0001,
            trade_tick_value=10.0,
            trade_tick_value_loss=9.5,
            trade_tick_value_profit=10.5,
            volume_step=0.01,
            volume_min=0.01,
            volume_max=100.0,
            trade_stops_level=20,
            trade_freeze_level=5,
            trade_mode=4,
            trade_contract_size=100_000,
            trade_calc_mode=0,
            currency_base="EUR",
            currency_profit="USD",
            currency_margin="EUR",
            margin_initial=1_000.0,
            margin_maintenance=900.0,
            margin_hedged=0.0,
            spread=12,
        )

        meta = meta_from_mt5_info("EURUSD", "EURUSD", info)
        payload = public_symbol_info(meta, 2.0)

        self.assertEqual(meta.tick_value_loss, 9.5)
        self.assertEqual(meta.tick_value_profit, 10.5)
        self.assertEqual(payload["tickValueLoss"], 9.5)
        self.assertEqual(payload["tickValueProfit"], 10.5)
        self.assertEqual(payload["contractSize"], 100_000)
        self.assertEqual(payload["calcMode"], 0)
        self.assertEqual(payload["marginMaintenance"], 900.0)
        self.assertEqual(payload["minStopDistance"], 0.0002)

    def test_dry_run_fallback_classifies_metals_as_cfd(self) -> None:
        meta = fallback_symbol_meta("XAUUSD", "XAUUSD")
        self.assertEqual(meta.calc_mode, "cfd")
        self.assertEqual(meta.contract_size, 100)

    def test_risk_guard_prefers_direction_specific_loss_tick_value(self) -> None:
        config = replace(load_config(), max_order_volume=100.0)
        guard = RiskGuard(config)
        meta = SymbolMeta(
            "EURUSD",
            "EURUSD",
            5,
            0.00001,
            0.01,
            0.01,
            100,
            0.0001,
            10,
            0,
            0,
            "full",
            tick_value_loss=8,
            tick_value_profit=12,
        )
        risk = guard.estimate_order_risk(
            {"price": 1.1, "sl": 1.095},
            meta,
            0.25,
        )
        self.assertAlmostEqual(risk, 100.0, places=8)


if __name__ == "__main__":
    unittest.main()
