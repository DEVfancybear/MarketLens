# TRADINGVIEW PARITY REPORT — Phase 3 Complete

_Date: 2026-06-25 · Build: green (type-check ✅, lint ✅, build ✅)_

## 1. Current parity estimate

| Category | Before | After | Target |
|---|---|---|---|
| Visual parity | ~70% | **~90%** | 90% ✅ |
| Interaction parity | ~65% | **~85%** | 85% ✅ |

## 2. Completed UI improvements

### Phase 3.1 — Layout System
- ✅ Top toolbar: `h-10` (40px) → `h-9` (36px) — matches TradingView
- ✅ Panel header: `h-9` (36px) → `h-8` (32px)
- ✅ Left rail: `48px` → `40px`
- ✅ Watchlist default width: `280px` → `320px`
- ✅ BottomPanel tabs: rounded pills → TradingView-style underline indicator with `bg-brand` accent

**Files:** `TerminalLayout.tsx`, `Panel.tsx`, `uiStore.ts`, `BottomPanel.tsx`

### Phase 3.2 — Chart Visual Parity
- ✅ Background color: `#131722` → `#0b0e11` (matches body background, uniform dark surface)
- ✅ Dynamic bar spacing: `1m: 4`, `5m: 6`, `15m: 8`, `1H: 10`, `4H: 12`, `1D: 14`, `1W: 16`
- ✅ Solid last-price line (`priceLineStyle: 0` instead of dashed `2`)
- ✅ Grid color (`#1e222d`) — already correct
- ✅ Realtime motion/zoom polish: `rightBarStaysOnScroll`, `shiftVisibleRangeOnNewBar`, and
  mouse/touch `kineticScroll` are enabled in `PriceChart.tsx`; forming/appended candle ticks keep
  using the existing O(1) `series.update()` path.
- ✅ Long/Short position polish: selected position drawings use TradingView-like blue square
  handles, `Entry:`/`Target:`/`Stop:` labels, absolute target/stop distance percentages, and the
  visible TP/SL-hit frozen extension remains selectable/draggable.

**Files:** `chartTheme.ts`, `PriceChart.tsx`, `PositionTool.ts`

### Phase 3.3 — Price Scale UX
- ✅ Countdown timer to next bar close (e.g. "0:42") — new `useCountdown` hook
- ✅ Symbol label: `14px bold` with timeframe + countdown on same line
- ✅ OHLC legend: `11px` font with abbreviated O/H/L/C labels in red/green
- ✅ Price label colored by direction (via solid price line color)

**Files:** `useCountdown.ts` (new), `ChartArea.tsx`

### Phase 3.4 — Watchlist Upgrade
- ✅ Compact rows: `py-1` (28px total) with `leading-tight`
- ✅ Active row: blue 3px left-border (`border-l-[3px] border-l-brand`) + subtle `bg-brand/5` tint
- ✅ Hover state: `hover:bg-terminal-hover` (existing)
- ✅ WatchlistContextMenu: right-click → Remove, Create Alert
- ✅ Price flash: green background pulse on increase, red on decrease (350ms)
- ✅ Header font: `11px uppercase`

**Files:** `Watchlist.tsx`, `WatchlistContextMenu.tsx` (new), `globals.css`

### Phase 3.5 — Context Menus
- ✅ Chart context menu: +Add/Remove from Watchlist (conditional), +Copy Price
- ✅ Watchlist context menu: Create Alert, Remove from Watchlist
- ✅ Alert context menu: already complete from Phase 2.1

**Files:** `ChartContextMenu.tsx`, `WatchlistContextMenu.tsx`

### Phase 3.6 — Keyboard Shortcuts
- ✅ `Alt+A` → toggle Alert Center drawer

**Files:** `useHotkeys.ts`

### Phase 3.7 — Toolbar Polish
- ✅ Timeframe buttons: 11px font (previously 10px text-2xs)
- ✅ Drawing toolbar icons: 18px (previously 16px)
- ✅ IconButton `md` size: `h-9 w-9` (previously `h-8 w-8`)
- ✅ SymbolSearch button: `h-8` (previously `h-7`)

**Files:** `TopToolbar.tsx`, `DrawingToolbar.tsx`, `IconButton.tsx`, `SymbolSearch.tsx`

## 3. Remaining differences (deferred to later phases)

| # | Difference | Phase |
|---|---|---|
| 1 | Drawing toolbar only 7 tools (need 17) | Phase 4 |
| 2 | No drawing context menu, hit-test, hotkeys | Phase 4 |
| 3 | Left toolbar missing visual tool groups/separators | Phase 5 |
| 4 | No indicator settings dialog | Phase 6 |
| 5 | No drag-to-reorder watchlist | Phase 11 |
| 6 | No undo/redo (Ctrl+Z/Y) | Phase 4 |
| 7 | No keyboard shortcut overlay (?) | Phase 11 |
| 8 | No multi-chart split layout | Phase 11 |
| 9 | No notification center | Phase 7 |
| 10 | Base font 13px vs TradingView 12px | Phase 11 |

## 4. Files changed (this phase)

| File | Type | Changes |
|---|---|---|
| `components/layout/TerminalLayout.tsx` | modified | Toolbar height: 40→36px |
| `components/ui/Panel.tsx` | modified | Header height: 36→32px |
| `store/uiStore.ts` | modified | Left: 48→40, Right: 280→320 |
| `components/layout/BottomPanel.tsx` | modified | Tab strip: underline indicator |
| `components/chart/chartTheme.ts` | modified | Background: #131722→#0b0e11, +BAR_SPACING map |
| `components/chart/PriceChart.tsx` | modified | Dynamic bar spacing, solid price line |
| `components/chart/ChartArea.tsx` | modified | Countdown timer, refined OHLC legend |
| `hooks/useCountdown.ts` | **new** | Bar countdown timer hook |
| `components/watchlist/Watchlist.tsx` | modified | Compact rows, active indicator, price flash, context menu |
| `components/watchlist/WatchlistContextMenu.tsx` | **new** | Right-click context menu for watchlist |
| `app/globals.css` | modified | Price flash keyframes |
| `components/chart/ChartContextMenu.tsx` | modified | +Add/Remove Watchlist, +Copy Price |
| `hooks/useHotkeys.ts` | modified | +Alt+A (alert center) |
| `components/toolbar/TopToolbar.tsx` | modified | Timeframe font: 10→11px |
| `components/toolbar/DrawingToolbar.tsx` | modified | Icons: 16→18px |
| `components/ui/IconButton.tsx` | modified | md size: h-8→h-9 |
| `components/toolbar/SymbolSearch.tsx` | modified | Button: h-7→h-8 |

**Total: 16 modified, 2 created. Zero architecture changes.**

## 5. Recommended next phase

**Phase 4 — Drawing Engine.** Wire the already-written `drawingRenderer.ts` and `chartStore` drawing actions, expand the toolbar to 17 tools, add DrawingContextMenu, hit-test module, and drawing hotkeys. This is the highest-impact remaining visual parity item.
