import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TRADINGVIEW_COLOR_PALETTE,
  colorOpacity,
  colorWithOpacity,
  hexToHsv,
  hsvToHex,
  normalizeHexColor,
  normalizeOpacity,
} from "../../src/components/ui/colorPickerModel";

test("common color picker exposes the complete TradingView-style swatch grid", () => {
  assert.equal(TRADINGVIEW_COLOR_PALETTE.length, 8);
  assert.ok(TRADINGVIEW_COLOR_PALETTE.every((row) => row.length === 10));
  assert.equal(new Set(TRADINGVIEW_COLOR_PALETTE.flat()).size, 80);
  assert.ok(TRADINGVIEW_COLOR_PALETTE.flat().includes("#2962ff"));
  assert.ok(TRADINGVIEW_COLOR_PALETTE.flat().includes("#f23645"));
});

test("color input normalization supports the formats already stored by tools", () => {
  assert.equal(normalizeHexColor("#ABC"), "#aabbcc");
  assert.equal(normalizeHexColor("rgb(41, 98, 255)"), "#2962ff");
  assert.equal(normalizeHexColor("rgba(242, 54, 69, 0.5)"), "#f23645");
  assert.equal(normalizeHexColor("invalid", "#089981"), "#089981");
});

test("custom picker HSV conversion round-trips representative palette colors", () => {
  for (const color of ["#ffa726", "#2962ff", "#f23645", "#ffffff", "#000000"]) {
    assert.equal(hsvToHex(hexToHsv(color)), color);
  }
});

test("opacity is clamped to the shared picker contract", () => {
  assert.equal(normalizeOpacity(undefined), 1);
  assert.equal(normalizeOpacity(-1), 0);
  assert.equal(normalizeOpacity(0.42), 0.42);
  assert.equal(normalizeOpacity(3), 1);
  assert.equal(colorWithOpacity("#2962ff", 0.5), "#2962ff80");
  assert.equal(colorOpacity("#2962ff80"), 128 / 255);
  assert.equal(colorOpacity("rgba(41, 98, 255, 0.25)"), 0.25);
});
