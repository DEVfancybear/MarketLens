# TYPOGRAPHY AUDIT — Chart Header & Price Marker

_Date: 2026-06-25. Post-correction typography audit._

## Chart header (top-left)

| Element | Font Size | Weight | Color | Line Height |
|---|---|---|---|---|
| Symbol | `11px` | `font-bold` (700) | `text-ink` (#d1d4dc) | `leading-none` |
| Exchange | `11px` | normal (400) | `text-ink-muted` (#868993) | `leading-none` |
| Separator (·) | `11px` | normal | `text-ink-muted` | `leading-none` |
| Timeframe | `11px` | normal | `text-ink-muted` | `leading-none` |
| OHLC labels (O/H/L/C) | `11px` | `font-medium` (500) | Green (#26a69a) / Red (#ef5350) | `leading-none` |
| OHLC values | `11px` | normal (400) | Green / Red (inherited) | `leading-none` |

### TradingView comparison

| Element | Ours | TradingView | Match? |
|---|---|---|---|
| Symbol | 11px bold | 11px bold | ✅ |
| Exchange | 11px normal | 11px normal | ✅ |
| TF display | inline in header | inline in header | ✅ |
| OHLC format | `O 123.45 H 123.50 L 123.40 C 123.48` | Same abbreviated style | ✅ |

## Price marker (right side)

| Element | Font Size | Weight | Color | Line Height |
|---|---|---|---|---|
| Symbol | `11px` | `font-bold` (700) | `text-ink` | `leading-none` |
| Price | `16px` | `font-bold` (700) | Green/Red by tick direction | `leading-none` |
| Countdown | `11px` | normal (400) | `text-ink-muted` | `leading-tight` |

### TradingView comparison

| Element | Ours | TradingView | Match? |
|---|---|---|---|
| Symbol | 11px bold | 11px bold | ✅ |
| Price | 16px bold tabular | ~16px bold monospace | ✅ |
| Countdown | 11px normal grey | 11px grey | ✅ |
| Position | Right side, vertically centered | Right price scale area | ✅ |

## Countdown format

| Timeframe | Format | Example |
|---|---|---|
| 1m–30m | MM:SS | `0:42`, `3:21`, `12:09` |
| 1H | MM:SS | `41:12` (up to `59:59`) |
| 4H, 1D, 1W | HH:MM:SS | `2:59:59`, `23:59:59`, `167:59:59` |
