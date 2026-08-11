# UI GAP ANALYSIS — TradingView Parity

_Audit date: 2026-06-25. Comparing the current MarketLens UI against
TradingView.com's production interface. Scope: visual only (layout, typography,
colors, spacing, interactions). Not data/engine features._

---

## 1. Layout differences

| # | Issue | Current | TradingView | Severity | Effort |
|---|---|---|---|---|---|
| L1 | **Top toolbar height** | `h-10` (40px) | `36px` (compact) | 🟡 Med | 2 min |
| L2 | **Left rail width** | `48px` (default in uiStore) | `40px` (tight) | 🟡 Med | 2 min |
| L3 | **Panel header height** | `h-9` (36px) in Panel.tsx | `32px` (compact) | 🟡 Med | 2 min |
| L4 | **Bottom tab style** | Rounded pill buttons (`rounded`) with `bg-terminal-hover` | Flat tabs with accent-color underline indicator, no background fill | 🟡 Med | 20 min |
| L5 | **Watchlist panel width** | `280px` default | `~320px` (TradingView right dock) | ⚪ Low | 1 min |
| L6 | **Chart OHLC legend** | `text-2xs` (10px), single row wrapping | `11px` font, single row, no wrap, icon-like O/H/L/C abbreviations | ⚪ Low | 10 min |
| L7 | **Bottom panel resizer** | `min: 140, max: 560` | TradingView bottom panel can be collapsed to a thinner strip | ⚪ Low | 1 min |
| L8 | **Loading overlay** | `Loader2` spinner, `bg-terminal-bg/40` | TradingView uses a subtle skeleton/pulsing placeholder, not a spinner | ⚪ Low | 15 min |

---

## 2. Watchlist differences

| # | Issue | Current | TradingView | Severity | Effort |
|---|---|---|---|---|---|
| W1 | **Row height** | `py-1.5` (~36px with text) | `28px` compact rows | 🟡 Med | 2 min |
| W2 | **Active row indicator** | `bg-brand/10` (faint blue background) | Left-border accent (blue `3px` bar) + slightly brighter background | 🔴 High | 15 min |
| W3 | **Row hover state** | `hover:bg-terminal-hover` (works) | Same, plus reveal of action icons (remove already works via group-hover) | 🟢 OK | 0 min |
| W4 | **Row context menu** | None | Right-click: Remove, Create Alert, Hide, Chart settings | 🔴 High | 45 min |
| W5 | **Header row** | `text-[10px] uppercase` Symbol / Last / Chg% | TradingView uses `11px` font, Symbol / Last / Chg% / Chg (absolute), slight padding difference | ⚪ Low | 5 min |
| W6 | **Price formatting** | `fmtPrice(last, prec)` — correct precision from registry | Values should be right-aligned with `font-variant-numeric: tabular-nums` (already has `tabular` class) | 🟢 OK | 0 min |
| W7 | **Sort indicator** | Dropdown menu (Symbol/Price/Change/Volume) | Inline sort toggles on column headers + visual sort direction arrow | ⚪ Low | 30 min |
| W8 | **Symbol search (add)** | Dropdown with text input + filtered list | Popover with asset-class grouping (Forex / Crypto / Indices / Metals) | ⚪ Low | 15 min |
| W9 | **Spread / bid-ask** | Not shown | TradingView shows spread in small text below the last price on hover | ⚪ Low | 20 min |
| W10 | **Color flash on price change** | Not implemented | Brief green/red background flash when price updates | ⚪ Low | 10 min |

---

## 3. Toolbar differences

| # | Issue | Current | TradingView | Severity | Effort |
|---|---|---|---|---|---|
| T1 | **Symbol search styling** | `h-7` button with icon + symbol name + exchange tag | Wider input-like button with symbol name, company name, exchange icon, favorite star | 🔴 High | 30 min |
| T2 | **Timeframe buttons** | `h-7 min-w-[28px] rounded px-1.5 text-2xs` (10px font) | Same compact style, `11px` font, slightly more padding, active uses a subtle background + bold | 🟡 Med | 5 min |
| T3 | **Toolbar button styling** | `h-7` icon buttons with `gap-1 px-2` | Same pattern, TradingView uses slightly larger icons (16px vs 14px) | ⚪ Low | 5 min |
| T4 | **Drawing toolbar icons** | 16px icons, `h-8 w-8` buttons | 18px icons in 40px toolbar, thin active-state left-border accent | 🟡 Med | 15 min |
| T5 | **Drawing toolbar tool count** | 7 tools | 17+ tools with category separators | 🔴 High | 2h (Phase 4) |
| T6 | **Drawing toolbar color picker** | Hover-reveal grid of 6 color circles | Small color swatch button that opens a popover with color grid + opacity slider | 🟡 Med | 20 min |
| T7 | **Right-side icon group** | All icons same size, no grouping | TradingView groups: Alerts bell → snapshot → settings → fullscreen → theme, with separators | ⚪ Low | 10 min |
| T8 | **Connection badge** | 🟢/🟡/🔴 dot + label | TradingView shows a subtle dot in the bottom-right corner of the chart, not in toolbar | ⚪ Low | 15 min |
| T9 | **Missing "Undo/Redo"** | Not implemented | TradingView has undo/redo arrows in the top toolbar | ⚪ Low | 1h (Phase 4 scope) |
| T10 | **Missing "Magnet mode"** | Not implemented | TradingView has magnet/snap toggle for cursor | ⚪ Low | 20 min |

---

## 4. Chart / price scale differences

| # | Issue | Current | TradingView | Severity | Effort |
|---|---|---|---|---|---|
| C1 | **Background color** | `#131722` (chart) vs `#0b0e11` (panel) — mismatch! | Chart background matches the panel background exactly | 🔴 High | 5 min |
| C2 | **Grid lines** | `#1e222d`, style: 0 (solid), very faint | `#1e222d` is correct, but TradingView uses style: 0 (solid) with 0.3–0.4 opacity — ours is opaque | 🟡 Med | 2 min |
| C3 | **Candle spacing** | Hardcoded `barSpacing: 8` for all TFs | Dynamic per-TF: 1m: 4, 5m: 6, 15m: 8, 1H: 10, 4H+: 12 | 🔴 High | 10 min |
| C4 | **Wick thickness** | Default (1px) — `wickVisible: true` but no explicit `wickWidth` | TradingView: wick width = 1 (same), but body border is `borderVisible: false` (ours is also false) | 🟢 OK | 0 min |
| C5 | **Last-price line style** | `priceLineStyle: 2` (dashed) | `priceLineStyle: 0` (solid), with price label colored red/green by direction | 🔴 High | 5 min |
| C6 | **Price scale ticks** | `ticksVisible: false`, `entireTextOnly: true` | Same (TradingView hides ticks on right scale) | 🟢 OK | 0 min |
| C7 | **Time scale** | `timeVisible: true, secondsVisible: false` | Same, but TradingView shows date separators (vertical lines between days) | ⚪ Low | 5 min |
| C8 | **Crosshair mode** | `CrosshairMode.Normal` (full cross lines) | TradingView uses `CrosshairMode.Normal` but with subtle styling: line `width: 1, style: 2` (dashed) — ours already matches | 🟢 OK | 0 min |
| C9 | **Chart watermark** | None (LWC has `attributionLogo: false`) | TradingView has a subtle "TradingView" logo in bottom-left. We should have none (branded app). | 🟢 OK | 0 min |
| C10 | **Countdown timer** | Not shown | TradingView shows e.g. "0:42" countdown to next bar close in the top-left header area | 🔴 High | 15 min |
| C11 | **Symbol+TF header** | Top-left overlay in ChartArea: `text-sm font-semibold` for symbol | TradingView: symbol is `14px bold`, timeframe is `12px` regular, on one line | 🟡 Med | 5 min |
| C12 | **OHLC labels** | `text-2xs flex gap-2` with color by direction | TradingView: same pattern, but uses `11px` font and shows O/H/L/C as abbreviated labels | ⚪ Low | 10 min |
| C13 | **Price scale number format** | LWC auto-formats, precision from registry | TradingView: right price scale shows `1.12345` format, volume scale is hidden or mini | 🟢 OK | 0 min |
| C14 | **Volume histogram** | No default volume histogram in the base candle chart | TradingView treats volume as an explicit study/indicator rather than a required default candle overlay | 🟢 OK | 0 min |
| C15 | **Chart border** | `borderVisible: true` on both price scale and time scale | TradingView has visible borders on price scale + time scale — matches | 🟢 OK | 0 min |

---

## 5. Typography differences

| # | Issue | Current | TradingView | Severity | Effort |
|---|---|---|---|---|---|
| Y1 | **Font family** | `Inter` (variable font via CSS var `--font-sans`) | TradingView uses `-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, ...` — slightly different metrics | ⚪ Low | 5 min |
| Y2 | **Base font size** | `13px` on body | TradingView uses `12px` as base, scaled up for headers | ⚪ Low | 5 min |
| Y3 | **Toolbar font size** | `text-2xs` (10px) on timeframe buttons, `text-xs` (12px) on labels | TradingView: `11px` on timeframe buttons, `12px` on menus | 🟡 Med | 5 min |
| Y4 | **Tabular numbers** | Already uses `tabular` class for prices (font-variant-numeric: tabular-nums) | TradingView uses monospace for all numeric values | 🟢 OK | 0 min |
| Y5 | **Weight usage** | `font-semibold` on active elements, `font-medium` on buttons | TradingView: `600` weight on active, `400` on inactive — similar | 🟢 OK | 0 min |

---

## 6. Context menu differences

| # | Issue | Current | TradingView | Severity | Effort |
|---|---|---|---|---|---|
| M1 | **Chart context menu width** | `min-w-[260px]` | TradingView: `~280px` | ⚪ Low | 1 min |
| M2 | **Chart context menu items** | 5 items + 2 dividers | TradingView: ~12 items with sub-menus (Trade, Set Alert, Add to Watchlist, etc.) | 🟡 Med | 30 min |
| M3 | **Watchlist context menu** | Not implemented | Right-click: Remove, Create Alert, Chart Settings, Hide | 🔴 High | 45 min |
| M4 | **Menu animation** | `contextPop` keyframe (100ms scale+fade) | TradingView: instant appear (no animation) or very subtle fade | ⚪ Low | 2 min |
| M5 | **Menu separators** | Simple `h-px bg-terminal-border` | TradingView uses `1px solid #2a2e39` (same as ours) | 🟢 OK | 0 min |
| M6 | **Menu item hover** | `hover:bg-terminal-hover` + `focus:bg-terminal-hover` | TradingView: `background: #1e222d` on hover (similar) | 🟢 OK | 0 min |
| M7 | **Menu keyboard nav** | Arrow-key navigation already implemented + Esc close | TradingView: same (arrow keys + Esc) | 🟢 OK | 0 min |
| M8 | **Menu font size** | `text-xs` (12px) | TradingView: `13px` | ⚪ Low | 2 min |

---

## 7. Missing TradingView interactions

| # | Issue | Current | TradingView | Severity | Effort |
|---|---|---|---|---|---|
| I1 | **Drag-to-reorder watchlist** | Not implemented — add/remove only | Drag rows up/down to reorder, with smooth animation | ⚪ Low | 1.5h |
| I2 | **Price flash on update** | Not implemented | Brief green (up) / red (down) background flash on price cell when quote changes | ⚪ Low | 10 min |
| I3 | **Pinch-to-zoom** | Already supported via LWC `handleScale.pinch: true` | TradingView: pinch-to-zoom on time scale only, not price | 🟢 OK | 0 min |
| I4 | **Double-click price scale** | `axisDoubleClickReset: true` — resets scale | TradingView: double-click resets to auto-fit | 🟢 OK | 0 min |
| I5 | **Scroll crosshair lock** | Not implemented | When crosshair is active and user scrolls, crosshair stays pinned (TradingView crosshair lock toggle) | ⚪ Low | 30 min |
| I6 | **Undo/Redo (Ctrl+Z / Ctrl+Y)** | Not implemented | TradingView undo/redo for drawings, alerts, trades | ⚪ Low | 2h (Phase 4) |
| I7 | **Keyboard shortcut overlay** | Not implemented | Press `?` to show keyboard shortcut reference | ⚪ Low | 30 min |
| I8 | **Chart snapshot to clipboard** | Downloads as PNG file | TradingView: "Copy image" copies to clipboard; "Save as" downloads file. Ours only downloads. | ⚪ Low | 15 min |
| I9 | **Chart region resizing** | Only the dock panels (left rail, right watchlist, bottom) are resizable. Chart itself is not split. | TradingView supports split chart panes (multi-chart layout). Ours is single-chart. | ⚪ Low | 3h |
| I10 | **Notification center** | Alert Center is a slide-over drawer | TradingView has a Notification panel accessible from bottom-right icon | ⚪ Low | 30 min |

---

## 8. Summary by severity

### 🔴 High (must fix for 90% parity)

| # | Issue | Est. |
|---|---|---|
| W2 | Active row indicator (left-border accent) | 15 min |
| W4 | Watchlist context menu (right-click) | 45 min |
| T1 | Symbol search styling (input-like button) | 30 min |
| T5 | Drawing toolbar full tool set | 2h (Phase 4) |
| C1 | Background color mismatch (chart vs panel) | 5 min |
| C3 | Dynamic bar spacing per timeframe | 10 min |
| C5 | Solid last-price line (not dashed) | 5 min |
| C10 | Countdown timer to next bar close | 15 min |
| M3 | Watchlist context menu (from W4, duplicate) | — |

### 🟡 Medium (improves fidelity noticeably)

| # | Issue | Est. |
|---|---|---|
| L1 | Top toolbar height 40→36px | 2 min |
| L2 | Left rail width 48→40px | 2 min |
| L3 | Panel header height 36→32px | 2 min |
| L4 | Bottom tab style (underline indicator) | 20 min |
| W1 | Watchlist row height (compact) | 2 min |
| T2 | Timeframe button font size | 5 min |
| T4 | Drawing toolbar icon sizing | 15 min |
| T6 | Color picker popover (not hover) | 20 min |
| C2 | Grid line opacity | 2 min |
| C11 | Symbol+TF header sizing | 5 min |
| Y3 | Toolbar font sizes (10→11px) | 5 min |
| M2 | Chart context menu additional items | 30 min |

### ⚪ Low (nice to have, deferrable)

| # | Issue | Est. |
|---|---|---|
| L5 | Watchlist width default | 1 min |
| L6 | Chart legend font size | 10 min |
| L7 | Bottom resizer min | 1 min |
| L8 | Loading overlay style | 15 min |
| W5 | Header row font size | 5 min |
| W7 | Inline column sort toggles | 30 min |
| W8 | Add-symbol grouped popover | 15 min |
| W9 | Spread display on hover | 20 min |
| W10 | Price flash animation | 10 min |
| T3 | Toolbar button icon sizes | 5 min |
| T7 | Right-side icon grouping | 10 min |
| T8 | Connection badge repositioning | 15 min |
| T9 | Undo/Redo buttons | 1h (Phase 4) |
| T10 | Magnet mode toggle | 20 min |
| C4 | Wick thickness (already matches) | 0 min |
| C7 | Date separators on time scale | 5 min |
| C12 | OHLC label size | 10 min |
| Y1 | Font family tweak | 5 min |
| Y2 | Base font size 13→12px | 5 min |
| M1 | Context menu width | 1 min |
| M4 | Menu animation (remove) | 2 min |
| M8 | Menu font size | 2 min |
| I1 | Drag-to-reorder watchlist | 1.5h |
| I2 | Price flash animation | 10 min |
| I5 | Crosshair lock on scroll | 30 min |
| I6 | Undo/Redo | 2h |
| I7 | Shortcut overlay | 30 min |
| I8 | Copy image to clipboard | 15 min |
| I9 | Multi-chart split | 3h |
| I10 | Notification center | 30 min |

---

## 9. Effort estimates

| Priority | Count | Total effort |
|---|---|---|
| 🔴 High (no T5) | 7 items | ~2h |
| 🔴 High — T5 only | 1 item | ~2h (Phase 4) |
| 🟡 Medium | 11 items | ~1.5h |
| ⚪ Low | 26 items | ~11h (most deferrable) |
| **Phase 3 total (realistic)** | 18 items (high+med) | **~3.5h** |

---

_Phase 3 is achievable in ~3.5 hours of focused work. The 7 high-priority items
(plus 11 medium) will achieve ~90% TradingView visual parity. Phase 4 (Drawing
Engine full tool set) handles the remaining high-priority item T5._
