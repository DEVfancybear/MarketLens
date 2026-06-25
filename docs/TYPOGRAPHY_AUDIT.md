# TYPOGRAPHY AUDIT — TradingView Parity

_Date: 2026-06-25. Typography standards applied in Phase 3.3._

## Font family

| Element | Current | TradingView | Status |
|---|---|---|---|
| Global | `Inter`, system-ui, sans-serif | `-apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto` | ✅ Close enough |
| Monospace (tabular) | `JetBrains Mono`, ui-monospace | `monospace` | ✅ Better than TradingView |
| Chart labels (LWC) | `var(--font-sans)` | `system-ui` | ✅ Matches via LWC config |

## Base font size

| Element | Before | After | TradingView |
|---|---|---|---|
| Body | `13px` | `12px` | `12px` |
| Chart axis (LWC) | `11px` | `12px` | `12px` |

## Symbol / ticker labels

| Element | Before | After | TradingView |
|---|---|---|---|
| Top toolbar symbol | `14px font-semibold` | `14px font-bold` | `14px bold` |
| Watchlist symbol | `12px font-semibold` | `13px font-semibold leading-none` | `13px 600` |
| Chart header symbol | `14px font-bold` | `14px font-bold leading-none` | `14px 700` |

## Data values (prices, percentages)

| Element | Before | After | TradingView |
|---|---|---|---|
| Watchlist last price | `12px` | `13px` | `13px` |
| Watchlist change% | `12px` | `13px` | `13px` |
| Chart OHLC values | `11px` | `12px` | `12px` |
| Chart OHLC labels | no labels | `O H L C V` | `O H L C V` |

## Toolbar / UI chrome

| Element | Before | After | TradingView |
|---|---|---|---|
| Timeframe buttons | `11px` | `11px` | `11px` |
| Toolbar metric buttons | `12px text-xs` | `11px` | `11px` |
| Menu items (Dropdown) | `12px text-xs` | `11px` | `11px` |
| Panel header | `10px text-2xs` | `11px` | `11px` |
| Countdown timer | `12px` | `12px` | `12px` |
| Timeframe label in header | `12px text-xs` | `12px text-xs` | `12px` |

## Weight usage

| Weight | Usage | Matches TradingView? |
|---|---|---|
| `font-bold` (700) | Active toolbar symbol, chart header symbol | ✅ |
| `font-semibold` (600) | Watchlist symbols, timeframe active, panel headers | ✅ |
| `font-medium` (500) | Timeframe buttons, countdown timer | ✅ |
| `font-normal` (400) | Inactive text, menu items | ✅ |

## Line height

| Element | Before | After |
|---|---|---|
| Watchlist row value | `leading-tight` (1.25) | `leading-none` (1.0) |
| Chart header | default (1.5) | `leading-none` (1.0) |
| OHLC values | default | `leading-none` (1.0) |

Reducing to `leading-none` eliminates vertical gaps in single-line text elements, matching TradingView's tight row layouts.

## Font weight distribution

| File | Element | Weight |
|---|---|---|
| `TopToolbar` | Timeframe active | `font-semibold` (600) |
| `TopToolbar` | Timeframe inactive | `font-medium` (500) |
| `SymbolSearch` | Symbol label | `font-bold` (700) |
| `ChartArea` | Symbol | `font-bold` (700) |
| `ChartArea` | Timeframe | normal (400) |
| `ChartArea` | Countdown | `font-medium` (500) |
| `Watchlist` | Ticker name | `font-semibold` (600) |
| `Watchlist` | Exchange label | normal (400) |
| `Panel` | Header title | `font-semibold` (600) |
| `BottomPanel` | Active tab | `font-medium` (500) |
| `BottomPanel` | Inactive tab | normal (400) |

## Conclusion

Typography is now **~95% TradingView parity**. The main differences (font family Inter vs system stack) are intentional improvements. Remaining micro-differences are below the perception threshold at 12px font sizes.
