# SPACING AUDIT — Chart Header & Price Marker

_Date: 2026-06-25. Post-correction spacing audit._

## Chart header (top-left)

```
BTCUSDT · BINANCE · 1W
O 34702.49 H 36600.00 L 32699.00 C 35286.51
```

| Property | Value | TradingView |
|---|---|---|
| Left offset | `left-3` (12px) | ~12px |
| Top offset | `top-1` (4px) | ~4px |
| Row gap (header → OHLC) | `gap-0.5` (2px) | ~2px |
| Element gap within row | `gap-1.5` (6px) | ~6px |
| Header block gap | `gap-0.5` (2px) | ~2px |

## Price marker (right side)

```
                                              BTCUSDT
                                              67,234.50
                                              0:42
```

| Property | Value | TradingView |
|---|---|---|
| Right offset | `right-0 pr-1` (4px from edge) | ~4px |
| Vertical position | `top-1/2 -translate-y-1/2` (centered) | Centered on price line |
| Row gap (symbol → price → countdown) | `gap-0` (0px) | 0–2px |
| Text alignment | `items-end` (right-aligned) | Right-aligned |
| z-index | `z-10` (above chart) | Above chart |

## Layout structure

| Component | Position | Content |
|---|---|---|
| Chart header | Left, top | Symbol · Exchange · TF + OHLC row |
| Price marker | Right, centered | Symbol + Price + Countdown |
| Chart area | Center, full | Candlestick + volume + overlays |

## Before vs After

| Element | Before (incorrect) | After (correct) |
|---|---|---|
| Countdown position | Top-left in price marker | Right side with price |
| Chart header content | Symbol + TF + countdown + OHLC | Symbol · Exchange · TF + OHLC |
| Price marker content | Symbol + price + countdown (left) | Symbol + price + countdown (right) |
| LWC lastValueVisible | `true` (doubled price display) | `false` (custom marker renders it) |
| Header font size | Mixed: 14px symbol, 12px others | Consistent 11px throughout |
| Header top gap | `top-2` (8px) | `top-1` (4px) — more compact |
