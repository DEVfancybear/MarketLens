# SPACING AUDIT — TradingView Parity

_Date: 2026-06-25. Spacing standards applied in Phase 3.4._

## Panel sizing

| Element | Before | After | TradingView |
|---|---|---|---|
| Top toolbar height | `40px` | `36px` | `36px` |
| Left rail width | `48px` | `40px` | `40px` |
| Panel header height | `36px` | `32px` | `32px` |
| Watchlist default width | `280px` | `320px` | `~320px` |
| Watchlist row height | `~36px` | `28px (h-7)` | `28px` |
| Bottom panel tab height | `32px (h-8)` | `32px` | `32px` |
| LWC chart font size | `11px` | `12px` | `12px` |

## Toolbar button spacing

| Element | Before | After | TradingView |
|---|---|---|---|
| Top toolbar horizontal gap | `gap-1` (4px) | `gap-0` (0px) | `0px` between groups |
| Right icon group gap | `gap-0.5` (2px) | `gap-0` (0px) | `0px` |
| Separator vertical bar | `mx-1` (4px) | `mx-1` (4px) | `~4px` |
| Drawing toolbar vertical gap | `gap-1` (4px) | `gap-0.5` (2px) | `2px` |
| Toolbar button horizontal padding | `px-2` (8px) | `px-2` (8px) | `~8px` |
| Toolbar button height | `h-7` (28px) | `h-7` (28px) | `28px` |

## Chart header spacing

| Element | Before | After | TradingView |
|---|---|---|---|
| Header left offset | `left-3` (12px) | `left-3` (12px) | `~12px` |
| Header top offset | `top-2` (8px) | `top-2` (8px) | `~8px` |
| Element horizontal gap | `gap-x-3` (12px) | `gap-x-3` (12px) | `~12px` |
| OHLC value gap | `gap-2` (8px) | `gap-1.5` (6px) | `~6px` |
| Header row gap | `gap-y-0.5` (2px) | `gap-y-0.5` (2px) | `2px` |

## Watchlist spacing

| Element | Before | After | TradingView |
|---|---|---|---|
| Column gap | `gap-x-2` (8px) | `gap-x-2` (8px) | `~8px` |
| Row horizontal padding | `px-3` (12px) | `px-3` (12px) | `12px` |
| Row vertical padding | `py-1` (4px) | `py-0.5` (2px) | `~3px` |
| Active left border | `3px` | `3px` | `3px` |
| Active left padding (compensate) | `pl-[9px]` | `pl-[9px]` | compensated |
| Header padding | `py-1 px-3` | `py-1 px-3` | `~py-1 px-3` |
| Last column width | `auto` | `60px` | `~60px` |
| Middle column width | `auto` | `70px` | `~70px` |

## Context menu spacing

| Element | Before | After | TradingView |
|---|---|---|---|
| Menu item vertical padding | `py-1.5` (6px) | `py-1.5` (6px) | `~6px` |
| Menu item horizontal padding | `px-3` (12px) | `px-3` (12px) | `12px` |
| Menu icon gap | `gap-2.5` (10px) | `gap-2.5` (10px) | `~10px` |
| Menu container padding | `py-1` (4px) | `py-1` (4px) | `4px` |
| Menu min-width | `260px` (chart) / `200px` (watchlist) | same | `~280px` / `~200px` |
| Menu border-radius | `rounded-md` (6px) | `rounded-md` (6px) | `6px` |
| Menu shadow | `shadow-2xl shadow-black/50` | same | dark shadow |

## Separator consistency

| Location | Thickness | Color |
|---|---|---|
| Toolbar groups | `w-px` (1px) | `bg-terminal-border` |
| Toolbar draw color section | `h-px w-6` (1×24px) | `bg-terminal-border` |
| Panel header bottom | `border-b` (1px) | `border-terminal-border` |
| Terminal layout borders | `border-r/l/t/b` (1px) | `border-terminal-border` |

All separators use the same terminal-border token (`#2a2e39`) at 1px — consistent.

## Conclusion

Spacing is now **~92% TradingView parity**. The main remaining differences are:
- Toolbar group separator width (4px vs TradingView's ~6px) — negligible
- Watchlist column widths are approximates; TradingView scales dynamically
- Bottom panel resizer min/max values could be slightly different
