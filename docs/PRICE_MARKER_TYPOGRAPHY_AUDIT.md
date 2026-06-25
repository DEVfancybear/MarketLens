# PRICE MARKER TYPOGRAPHY AUDIT — TradingView Parity

_Date: 2026-06-25. Typography of the chart price-marker label._

## Component: `PriceMarkerLabel`

### Hierarchy

| Element | Font Size | Weight | Color | Font |
|---|---|---|---|---|
| Symbol | `14px` (`text-sm`) | `font-bold` (700) | `text-ink` (#d1d4dc) | Inter |
| Price | `26px` (`text-[26px]`) | `font-bold` (700) | Green (#26a69a) / Red (#ef5350) | Inter |
| Countdown | `12px` (`text-xs`) | `font-medium` (500) | `text-ink-muted` (#868993) | Inter |
| OHLC labels | `11px` | `font-medium` (500) | Green/Red by direction | Inter |
| OHLC values | `11px` | normal (400) | Green/Red by direction | Monospace (tabular) |

### Line heights

| Element | Line Height | Reason |
|---|---|---|
| Symbol | `leading-tight` (1.25) | Single line, tight vertical stack |
| Price | `leading-none` (1.0) | Large number, no descender whitespace |
| Countdown | `leading-tight` (1.25) | Single digit row |
| OHLC row | `leading-none` (1.0) | Tight readout strip |

### TradingView comparison

| Element | Ours | TradingView | Match? |
|---|---|---|---|
| Symbol font | 14px bold Inter | 14px bold system-ui | ✅ Close enough |
| Price font | 26px bold tabular | ~28px bold monospace | 🟡 26 vs 28 (2px) |
| Countdown | 12px medium grey | ~12px regular grey | ✅ Match |
| OHLC labels | 11px medium | 11px regular | ✅ Match |
| OHLC values | 11px tabular | 11px tabular | ✅ Match |

### Countdown format comparison

| Timeframe | Ours (old) | Ours (new) | TradingView |
|---|---|---|---|
| 1m | `0:42` | `0:42` | `0:42` |
| 5m | `3:21` | `3:21` | `3:21` |
| 15m | `12:09` | `12:09` | `12:09` |
| 1H | `41:12` | `41:12` | `41:12` |
| 4H | `179:59` | `2:59:59` | `2:59:59` |
| 1D | `1439:59` | `23:59:59` | `23:59:59` |
| 1W | `604799:59` | `167:59:59` | `167:59:59` |

The old countdown incorrectly showed total minutes above 59 (`179:59` for 4H). The new format correctly switches to `HH:MM:SS` when hours are non-zero, matching TradingView exactly.

## Price marker container

| Property | Value | TradingView |
|---|---|---|
| Background | `bg-terminal-panel/90` (90% opaque #131722) | Dark semi-transparent panel |
| Backdrop | `backdrop-blur-sm` | Yes |
| Border radius | `rounded-md` (6px) | `6px` |
| Padding | `px-3 py-1.5` (12px × 6px) | ~12px × 6px |
| Vertical gap | Symbol→Price: implicit via `flex-col`, Price→Countdown: implicit | Exact same stack |
| Position | `absolute left-0 top-0` | Top-left corner of chart |
