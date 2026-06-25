# PRICE MARKER SPACING AUDIT — TradingView Parity

_Date: 2026-06-25. Spacing of the chart price-marker label and OHLC readout._

## Container layout

```
┌──────────────────────┐
│ BTCUSDT              │  ← 14px bold, leading-tight
│ 67,234.50            │  ← 26px bold green/red, leading-none
│ 0:42                 │  ← 12px medium grey, leading-tight
└──────────────────────┘
     ← OHLC readout →   (11px, on a separate row below)
```

| Property | Value | TradingView |
|---|---|---|
| Container background | `bg-terminal-panel/90` + `backdrop-blur-sm` | Semi-transparent panel |
| Container padding | `px-3` (12px horizontal), `py-1.5` (6px vertical) | ~12px × 6px |
| Container border radius | `rounded-md` (6px) | 6px |
| Container left offset | `left-3` (12px from chart edge) | ~12px |
| Container top offset | `top-2` (8px from chart edge) | ~8px |
| Vertical gap (label → OHLC) | `gap-1.5` (6px via `flex-col gap-1.5`) | ~6px |
| Symbol → Price gap | implicit (flex-col, no explicit gap) | implicit |
| Price → Countdown gap | implicit (flex-col, no explicit gap) | implicit |
| OHLC element gap | `gap-1.5` (6px) | ~6px |

## Internal spacing

| Element | Horizontal padding | Vertical padding |
|---|---|---|
| Symbol | 0 | Auto from container |
| Price | 0 | Auto from container |
| Countdown | 0 | Auto from container |

All internal spacing is driven by the container padding + flex-col stacking. No extra padding on individual text elements — this matches TradingView's compact design.

## Position relative to chart

| Property | Value | TradingView |
|---|---|---|
| Anchor | `absolute left-0 top-0` | Top-left |
| Parent | `relative` container | Chart region |
| z-index | `z-10` | Above chart |
| Pointer events | `pointer-events-none` | Non-interactive |

## OHLC readout position

| Property | Value |
|---|---|
| Relation | Below price marker, same left offset |
| Font | 11px tabular |
| Line height | `leading-none` |
| Gap between values | `gap-1.5` |
| Color | `var(--bull)` (green) or `var(--bear)` (red) |

## Countdown detail

| Property | Value |
|---|---|
| Font | `text-xs font-medium tabular` (12px) |
| Color | `text-ink-muted` |
| Line height | `leading-tight` |
| Update rate | 4× per second (250ms interval) |
| Format | MM:SS for sub-hour, HH:MM:SS for 1H+ |

## Responsive behavior

| Breakpoint | Behavior |
|---|---|
| ≥ 640px | Full size (26px price, 14px symbol, 12px countdown) |
| < 640px | Same — the marker is compact enough for mobile |
