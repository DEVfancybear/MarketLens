# PHASE 3–11 IMPLEMENTATION PLAN

_TradingView Clone — Updated Roadmap. 2026-06-25._

This is the **strategic plan** for all remaining phases. Each phase has:
- Goal statement
- Pre-existing assets (what already exists)
- Gap analysis (what's missing)
- Step-by-step implementation list
- Files to create/modify
- Target: 90–95% TradingView visual parity

No code is written yet. This document exists for review and approval.

---

## PHASE 3 — TRADINGVIEW UI PARITY (HIGH PRIORITY)

**Goal:** Make the platform visually feel like TradingView. UI/UX only. No MT5, no new trading features.

### 3.1 Layout System

**Pre-existing assets:**
- `TerminalLayout.tsx` — existing resizable dock shell (top toolbar / left rail / center chart / right watchlist / bottom panel)
- `uiStore.ts` — panel sizes (`right: 280`, `bottom: 240`, `left: 48`), open/close state, theme
- `Resizer.tsx` — drag-to-resize divider component
- Responsive layout: already works at `sm` breakpoint

**Gap analysis:**
- Top toolbar uses manual `h-10` + flex layout, not a TradingView-style unified toolbar
- Left rail is fixed 48px — should be 40px (TradingView exact) with proper icon sizing
- Watchlist panel header is custom (`Panel` component), not TradingView styled
- No dark overlay when charts are loading
- Bottom panel tabs don't match TradingView's tab style

**Steps:**
1. **Tighten toolbar dimensions** — change top toolbar from `h-10` to `h-9` (TradingView: 36px), left rail from `48px` to `40px`
2. **Tighten panel header** — `Panel.tsx` header from `h-9` to `h-8` (32px)
3. **Add bottom panel tab bar** — TradingView-style tabs with active indicator underline, matching font/color
4. **Responsive pass** — ensure all panels collapse correctly on mobile (<640px)
5. **Dark overlay** — add a translucent spinner overlay when `chartStore.loading` is true

**Files to touch:**
- `TerminalLayout.tsx` — height tweaks
- `Panel.tsx` — header height
- `BottomPanel.tsx` — tab bar redesign
- `uiStore.ts` — add `chartLoading` state
- `ChartArea.tsx` — loading overlay

### 3.2 Chart Styling

**Pre-existing assets:**
- `chartTheme.ts` — already has TradingView-matching colors (`#131722` background, `#1e222d` grid, `#26a69a`/`#ef5350` candles)
- `PriceChart.tsx` — uses `chartColors()`, configures crosshair, grid, scales
- Grid toggle — already exists (`gridVisible` in `uiStore`)

**Gap analysis:**
- Candle `barSpacing` is hardcoded at 8 — should be dynamic based on TF (smaller TF = tighter spacing)
- `wickVisible` is true but wick width is default; TradingView uses thinner wicks
- Crosshair `mode: CrosshairMode.Normal` — TradingView uses a more subtle crosshair with only the price axis label, not a full line
- Last price line uses dashed style (style: 2) — TradingView uses a solid line with the price label on the right price scale
- Price scale font size and tick formatting need refinement
- No watermarks

**Steps:**
1. **Dynamic bar spacing** — set `barSpacing` per timeframe (1m: 4, 5m: 6, 15m: 8, 1H: 10, 4H: 12, 1D+: 14)
2. **Thinner wicks** — set `wickWidth` on candlestick series
3. **Solid last-price line** — change `priceLineStyle: 2` → `0` (solid), keep `priceLineColor` as dynamic bull/bear
4. **Price scale precision** — ensure precision from symbol registry is used everywhere
5. **Time scale format** — ensure `timeFormatter` shows seconds for 1m TF

**Files to touch:**
- `PriceChart.tsx` — bar spacing, wick width, price line style
- `chartTheme.ts` — already correct, possibly add spacing map

### 3.3 Price Scale UX

**Pre-existing assets:**
- Lightweight Charts already supports `priceLineVisible`, `lastValueVisible` — both enabled
- Symbol label not shown on the chart itself (it's in the top toolbar `SymbolSearch`)

**Gap analysis:**
- No current-price label on the right price scale (TradingView shows the last price in a colored label on the right axis)
- No symbol label on the chart area (TradingView shows "BTCUSDT, 15m" in the top-left of the chart pane)
- No countdown timer to next bar close (TradingView shows e.g. "0:42" in the top-left)
- Price marker (last price) styling: should be colored red/green by candle direction

**Steps:**
1. **Add symbol+TF overlay** — absolutely positioned div in top-left of chart area showing "SYMBOL, TF"
2. **Add bar countdown timer** — use `useEffect` + `setInterval` to compute time remaining in current bar, shown next to symbol label
3. **Verify last price label** — ensure `lastValueVisible: true` shows the current price on the right scale
4. **Style price label color** — set based on price direction (green if up, red if down from previous close)

**Files to touch:**
- `ChartArea.tsx` — add overlay labels
- `PriceChart.tsx` — price line/scale config

### 3.4 Watchlist Upgrade

**Pre-existing assets:**
- `Watchlist.tsx` — realtime rows, memoized, sort, add/remove, per-row quote subscription
- `watchlistStore.ts` — symbols, sort key, sort dir
- `Panel.tsx` — wrapper component
- Sort menu (dropdown) and Add symbol (search input) already exist

**Gap analysis:**
- No hover background on rows
- Active symbol row is not visually distinct (bold text, colored left-border, background highlight)
- No right-click context menu on rows (create alert, remove, chart settings)
- No drag-to-reorder (current implementation is add/remove only)
- Search symbol uses a basic input; should use the full `SymbolSearch` component or a popover with autocomplete
- No column headers for Last / Chg% (they exist but are very minimal)
- Row height is default; TradingView uses compact rows (~28px)

**Steps:**
1. **Row hover state** — add `hover:bg-terminal-hover` to each `WatchRow`
2. **Active row indicator** — left-border accent color + `bg-terminal-hover` + bold text when `ticker === activeSymbol`
3. **Watchlist context menu** — right-click a row: Remove from Watchlist, Create Alert, Chart Settings, Hide
4. **Compact rows** — set explicit `h-7` on rows (28px, matches TradingView)
5. **Symbol search upgrade** — use a popover/modal with the full symbol registry, grouped by asset class

**Files to touch:**
- `Watchlist.tsx` — hover, active, context menu, row height
- New: `WatchlistContextMenu.tsx` — right-click menu
- `watchlistStore.ts` — add `reorder` action (drag-to-reorder is complex; defer to Phase 11 polish)

### 3.5 Context Menus

**Pre-existing assets:**
- `ChartContextMenu.tsx` — right-click on chart: Create Alert, Sell Limit, Buy Stop, Add Order, Horizontal Line
- `AlertContextMenu.tsx` — right-click on alert line: Edit, Clone, Disable/Enable, Delete
- Both use CSS `pop-in` animation (no framer-motion dependency)

**Gap analysis:**
- No drawing context menu (Phase 4 item, pre-planned)
- Watchlist context menu missing (covered in 3.4)
- Chart context menu could use TradingView-style separators and sub-menus
- Alert context menu is good — no changes needed

**Steps:**
1. **Chart context menu polish** — add separators between action groups, add "Add to Watchlist" and "Remove from Watchlist" items
2. **Watchlist context menu** — implemented in 3.4 above
3. **Ensure consistent styling** — all context menus should use the same border, background, font, and animation

**Files to touch:**
- `ChartContextMenu.tsx` — separator + new items
- New: `WatchlistContextMenu.tsx` (see 3.4)

### 3.6 Keyboard Shortcuts

**Pre-existing assets:**
- `useHotkeys.ts` — already handles Space/←/→/R (replay), B/S/X (trade)
- Alert hotkeys (Delete/Esc) handled inside `AlertOverlay`
- Drawing hotkeys not yet implemented (Phase 4)

**Gap analysis:**
- `Ctrl+A` — select all, not yet implemented (should select all drawings? Or select all alerts?)
- `Ctrl+D` — duplicate selected drawing (Phase 4)
- `Alt+A` — toggle alert center (already available via toolbar bell)
- Delete key should work on any selected item (drawing, alert, position)
- Esc should deselect/cancel consistently across all surfaces

**Steps:**
1. **Extend `useHotkeys.ts`** — add `Ctrl+A` (toggle select all drawings), `Ctrl+D` (duplicate drawing), `Alt+A` (toggle alert center)
2. **Unify Delete/Esc** — when no alert is selected, Delete should fall through to delete the selected drawing
3. **Document all shortcuts** — add a keyboard shortcut overlay (show on `?` key)

**Files to touch:**
- `useHotkeys.ts` — add new shortcuts
- `Terminal.tsx` — add keyboard shortcut overlay component (optional)

---

## PHASE 4 — DRAWING ENGINE

**Goal:** TradingView-style drawing tools with the full set of instruments.

**Pre-existing assets:**
- `types/drawing.ts` — full 17-tool type system with `zIndex/locked/visible/stop/target`
- `chartStore.ts` — drawing state + all drawing actions (`add/update/remove/duplicate/lock/hide/bringToFront/sendToBack/toggleLockAll/toggleHideAll`)
- `components/chart/drawing/drawingRenderer.ts` — pure canvas renderer for all 17 tools (currently DEAD CODE, not wired)
- `DrawingLayer.tsx` — existing inline renderer, canvas overlay with create/move/select/delete for 7 tools
- `DrawingToolbar.tsx` — existing 7-tool toolbar (cursor, trendline, horizontal, vertical, rectangle, text, fib)

**Gap analysis:**
- `drawingRenderer.ts` is dead code — must be wired into `DrawingLayer.tsx`
- New `chartStore` actions are dead code — must be wired
- Toolbar only has 7 tools — needs full 17-tool set
- No drawing context menu — must be created
- No hit-test module — must be created
- No drawing hotkeys — Delete/Esc only, need Ctrl+D, Ctrl+L
- Current inline renderer in `DrawingLayer` handles 7 tools only

**Steps:**
1. **Wire the renderer** — replace `DrawingLayer.tsx`'s inline `renderDrawing()` with `drawingRenderer.ts`'s `renderDrawing()`. Use the existing `toX/toY` to build a `Projector`. Verify all 7 existing tools render identically before proceeding.
2. **Wire drawing actions** — connect `duplicateDrawing`, `lockDrawing`, `hideDrawing`, `bringToFront`, `sendToBack`, `toggleLockAll`, `toggleHideAll` to the DrawingLayer's interaction model and context menu
3. **Expand toolbar** — add icons for channel, brush, measure, emoji, eraser, crosshair, long, short. Group visually (Trends | Channels | Shapes | Annotations | Positions | Modes)
4. **Create hit-test module** — `components/chart/drawing/drawingHitTest.ts`: for each drawing, compute a bounding polygon in pixel space and test click position. Return the highest-zIndex drawing at the click point. Pattern from `AlertOverlay`'s DOM hit strips.
5. **Create DrawingContextMenu** — right-click on a drawing: Edit, Clone, Lock/Unlock, Hide/Show, Bring to Front, Send to Back, Delete. Touch long-press (~500ms) for mobile.
6. **Implement new tools** — channel (two-point parallel lines), brush (freehand path), measure (distance label), emoji (click placement), long/short (entry+SL/TP), eraser (mode tool), crosshair (mode tool)
7. **Drawing hotkeys** — Delete (remove selected), Esc (deselect), Ctrl+D (duplicate), Ctrl+L (lock/unlock)

**Files to touch:**
- `DrawingLayer.tsx` — replace inline renderer with drawingRenderer
- `drawingRenderer.ts` — verify, possibly tweak for parity
- `DrawingToolbar.tsx` — expand to 17 tools
- New: `components/chart/drawing/drawingHitTest.ts`
- New: `components/chart/DrawingContextMenu.tsx`
- `useHotkeys.ts` — add drawing shortcuts
- `chartStore.ts` — wire actions (already defined, just need to integrate)

---

## PHASE 5 — LEFT TOOLBAR

**Goal:** TradingView-style left toolbar controlling the Drawing Engine.

**Pre-existing assets:**
- `DrawingToolbar.tsx` — existing toolbar with icons + color picker
- `TerminalLayout.tsx` — left rail slot already exists at 48px width
- All 17 tool types are already in `types/drawing.ts`

**Gap analysis:**
- Toolbar only shows 7 tools
- No visual grouping (separators between tool categories)
- Color picker is a hover-reveal grid (not TradingView style — TradingView uses a small swatch)
- No tool active-state styling for modes (cursor, crosshair)
- Missing measure tool (which is interactive only, no persisted drawing)

**Steps:**
1. **Full 17-tool icons** — source all icons from lucide-react:
   - Cursor: `MousePointer2`, Crosshair: `Crosshair`, Trendline: `TrendingUp`
   - Horizontal: `Minus`, Vertical: `MoveVertical`, Channel: `GitBranch`
   - Rectangle: `Square`, Text: `Type`, Arrow: `ArrowUp`
   - Measure: `Ruler`, Brush: `PenTool`, Eraser: `Eraser`
   - Long: `ArrowUpToLine`, Short: `ArrowDownToLine`
   - Emoji: `Smile`, Fib: `GitFork`
2. **Visual grouping** — add separators between tool categories (Mode | Lines | Channels | Shapes | Annotations | Positions)
3. **Refine color picker** — replace hover-grid with a small color swatch button that opens a popover with the 6-color grid
4. **Active state polish** — selected tool gets a blue left-border accent + icon color change

**Files to touch:**
- `DrawingToolbar.tsx` — full rewrite with 17 tools, grouping, color picker

---

## PHASE 6 — INDICATOR ENGINE

**Goal:** Add/configure/remove indicators with a TradingView-style dialog.

**Pre-existing assets:**
- `indicators.ts` — SMA, EMA, VWAP, RSI, MACD, ADR computation
- `IndicatorMenu.tsx` — simple toggle on/off for each indicator
- `IndicatorPane.tsx` — renders RSI/MACD in stacked sub-charts
- `chartStore.ts` — `indicators[]`, `addIndicator`, `toggleIndicator`, `removeIndicator`, `updateIndicator`
- Overlay indicators (SMA/EMA/VWAP/ADR) rendered in `PriceChart.tsx`

**Gap analysis:**
- No indicator settings dialog — users can only toggle on/off, cannot set period, color, style
- Indicator parameters are hardcoded defaults (SMA 9/21/50/200, EMA same, RSI 14, MACD 12/26/9, VWAP session, ADR 14)
- No per-indicator color customization
- No indicator deletion UI (technical debt: `removeIndicator` exists but no UI button)
- Panel indicators and overlay indicators use separate rendering paths

**Steps:**
1. **Indicator settings dialog** — modal: select indicator → set period(s), color, line width, panel/overlay placement → Apply
2. **Indicator menu upgrade** — replace simple toggle list with hover-reveal settings gear icon per indicator
3. **Delete indicator** — add × button or settings gear → "Remove" action
4. **Per-indicator persistence** — indicators already persisted to localStorage via `chartStore.hydrate()`

**Files to touch:**
- `IndicatorMenu.tsx` — hover gear icon + delete
- New: `components/chart/IndicatorSettingsDialog.tsx` — full settings modal
- `indicators.ts` — expose default periods as configurable
- `chartStore.ts` — verify `updateIndicator` supports all fields

---

## PHASE 7 — PUSH NOTIFICATIONS

**Goal:** Firebase Cloud Messaging for alert delivery when browser is closed.

**Pre-existing assets:**
- `services/notifications/notify.ts` — `deliverAlert()` dispatcher with a seam for push
- Existing channels: toast (always), sound (Web Audio), browser (Notification API)
- `alertStore.ts` — per-alert notification flags, global settings

**Gap analysis:**
- `deliverAlert()` already has the structure: `if (settings.push) { ... }` — just needs the push implementation
- Need Firebase project setup, `firebase` npm package, service worker for background messages
- Mobile push requires Firebase SDK registration
- Permission flow for push is different from browser Notification API

**Steps:**
1. **Add `firebase` dependency** — `npm install firebase`
2. **Create Firebase config** — `services/firebase.ts`: initialize app, get messaging token
3. **Create service worker** — `public/firebase-messaging-sw.js`: handle background messages
4. **Implement push channel** — `services/notifications/push.ts`: `sendPushNotification()`, token registration, permission request
5. **Wire into `deliverAlert()`** — call `sendPushNotification()` when `settings.push` is enabled
6. **Add push toggle** — to `AlertCenter.tsx` settings section

**Files to touch:**
- New: `services/firebase.ts`
- New: `public/firebase-messaging-sw.js`
- New: `services/notifications/push.ts`
- `services/notifications/notify.ts` — wire push
- `AlertCenter.tsx` — push toggle
- `alertStore.ts` — add `push` to settings

---

## PHASE 8 — MT5 INTEGRATION

**Goal:** MT5 Bridge Service — account connection, position management. No MT5 logic in frontend.

**Pre-existing assets:**
- None. This is entirely new.
- The existing `tradeStore` is a simulator — this phase creates a real broker bridge.

**Architecture:**
```
MT5 Bridge Service (separate service/process)
  ├─ WebSocket server (local or remote)
  │   ├─ Account info (balance, equity, margin)
  │   ├─ Open positions (symbol, volume, open price, SL/TP, PnL)
  │   ├─ Market data (symbol, bid, ask) — optional, we have realtime already
  │   └─ Order commands (open, close, modify SL/TP)
  └─ MT5 Python/EA bridge (MetaTrader terminal plugin)

Frontend (this project)
  └─ services/mt5Bridge.ts
       ├─ WS client → bridge service
       ├─ Account info → mt5Store
       ├─ Position updates → mt5Store
       └─ Order commands → bridge → MT5
```

**Steps:**
1. **Create `services/mt5Bridge.ts`** — WebSocket client to MT5 bridge service. Connect, subscribe to account/positions, send orders.
2. **Create `store/mt5Store.ts`** — account info, positions, connection status
3. **Create `types/mt5.ts`** — `Mt5Account`, `Mt5Position`, `Mt5Order`, `Mt5ConnectionStatus`
4. **Environment config** — `NEXT_PUBLIC_MT5_BRIDGE_URL` in `.env.local`

**Files to touch:**
- New: `services/mt5Bridge.ts`
- New: `store/mt5Store.ts`
- New: `types/mt5.ts`

---

## PHASE 9 — TRADING PANEL

**Goal:** TradingView-style order panel with market/limit/stop, SL/TP, risk calculator.

**Pre-existing assets:**
- `OrderTicket.tsx` — existing order form (simulated trades)
- `tradeStore.ts` — equity, positions (simulator)
- `tradeEngine.ts` — risk sizing, market/limit/stop triggering, SL/TP

**Gap analysis:**
- Current UI is functional but not TradingView-styled
- Order panel should be a slide-over or right-dock panel, not a bottom tab
- No visual risk calculator (show R:R, position size, margin)
- Order confirmation dialog needed for MT5 integration
- No order type tabs (Market | Limit | Stop | OCO)

**Steps:**
1. **Redesign OrderTicket** — TradingView-style with tabs: Market, Limit, Stop. Each tab shows quantity, SL, TP fields with calculated risk.
2. **Risk calculator** — show R:R ratio, position size in lots, margin required, PnL at SL/TP. Compute from `tradeEngine`.
3. **Order confirmation** — modal dialog before submitting (Phase 9 uses simulator; Phase 10 uses MT5)
4. **Position sizing presets** — "25% Risk", "50% Risk", "Max Risk" buttons

**Files to touch:**
- `OrderTicket.tsx` — full redesign
- `tradeEngine.ts` — expose risk calculator methods
- `tradeStore.ts` — no changes needed

---

## PHASE 10 — POSITION VISUALIZATION

**Goal:** Entry/SL/TP lines on chart, draggable to modify (similar to AlertOverlay pattern).

**Pre-existing assets:**
- `TradeLevels.tsx` — renders entry/SL/TP price lines on the chart
- `AlertOverlay.tsx` — interactive canvas overlay pattern (select, drag, right-click, touch) — excellent reference

**Gap analysis:**
- TradeLines are static price lines (Lightweight Charts `createPriceLine`), not draggable
- No drag-to-modify SL/TP (must type numbers)
- No visual fill between entry and SL/TP (TradingView shows shaded risk zones)

**Steps:**
1. **Rewrite TradeLevels as interactive** — use the `AlertOverlay` pattern: canvas lines + DOM hit strips for drag-to-reprice
2. **Visual risk zones** — fill horizontal bands between entry and SL (red) and entry and TP (green) with semi-transparent color
3. **Drag to modify** — drag SL/TP line → update position → MT5 bridge → update MT5. Same local-lag-then-commit pattern as `AlertOverlay`.

**Files to touch:**
- `TradeLevels.tsx` — interactive rewrite
- `tradeStore.ts` — add `updatePositionSL` / `updatePositionTP` actions

---

## PHASE 11 — POLISH & OPTIMIZATION

**Goal:** Performance, memory, mobile UX, accessibility. Final TradingView parity review.

### 11.1 Performance
- Audit React renders: add `React.memo` where missing, verify no per-tick re-renders on hot paths
- Profile with React DevTools profiler
- Candle array cap (`MAX_CANDLES = 5000`) — verify it holds under extended realtime streaming
- `CandleEngine` map cleanup — remove entries for unsubscribed symbols after cooldown

### 11.2 Memory
- Verify no stale subscription references
- `useCandles`/`useQuote` subscriptions — verify they unsubscribe on unmount
- Canvas contexts — check for leaks (orphaned canvas elements)

### 11.3 Mobile UX
- Touch interaction pass: pinch-zoom on chart, long-press on watchlist, swipe to close drawers
- Responsive breakpoints: verify layout at 375px, 768px, 1024px
- Font sizes: ensure minimum 11px for readability
- Bottom panel tabs on mobile — horizontal scroll

### 11.4 Accessibility
- Add `aria-label` to all icon buttons
- Keyboard navigation: Tab between toolbar sections
- Screen reader announcements for alerts
- Focus traps in modals/dialogs

### 11.5 Final parity review
- Side-by-side comparison with TradingView.com
- Match: color palette, font sizes, spacing, border styles, shadow, animation curves
- Score: ≥95% visual parity target

---

## PHASE DEPENDENCY MAP

```
Phase 3 (UI Parity) ─── independent, no dependencies
  ↓
Phase 4 (Drawing Engine) ─── depends on Phase 3 for layout/toolbar context
  ↓
Phase 5 (Left Toolbar) ─── depends on Phase 4 (controls Drawing Engine)
  ↓
Phase 6 (Indicator Engine) ─── independent, can run parallel to 4–5
  ↓
Phase 7 (Push Notifications) ─── independent, can run parallel to 4–6
  ↓
Phase 8 (MT5 Integration) ─── independent (separate service), can run any time
  ↓
Phase 9 (Trading Panel) ─── depends on Phase 3 layout + Phase 8 MT5
  ↓
Phase 10 (Position Viz) ─── depends on Phase 9 (needs order panel context)
  ↓
Phase 11 (Polish) ─── depends on all phases complete
```

## FILES INVENTORY (existing vs. new)

### Existing files (will be modified)
| File | Phase |
|---|---|
| `components/layout/TerminalLayout.tsx` | 3.1 |
| `components/ui/Panel.tsx` | 3.1 |
| `components/layout/BottomPanel.tsx` | 3.1 |
| `components/chart/PriceChart.tsx` | 3.2, 3.3 |
| `components/chart/chartTheme.ts` | 3.2 |
| `components/chart/ChartArea.tsx` | 3.3 |
| `components/watchlist/Watchlist.tsx` | 3.4 |
| `components/chart/ChartContextMenu.tsx` | 3.5 |
| `hooks/useHotkeys.ts` | 3.6 |
| `components/chart/DrawingLayer.tsx` | 4 |
| `components/chart/drawing/drawingRenderer.ts` | 4 |
| `components/toolbar/DrawingToolbar.tsx` | 4, 5 |
| `store/chartStore.ts` | 4 |
| `components/chart/IndicatorPane.tsx` | 6 |
| `components/toolbar/IndicatorMenu.tsx` | 6 |
| `components/trade/OrderTicket.tsx` | 9 |
| `components/trade/TradeLevels.tsx` | 10 |
| `store/uiStore.ts` | 3.1 |
| `store/tradeStore.ts` | 10 |
| `app/globals.css` | 3.1 (tokens) |

### New files (will be created)
| File | Phase |
|---|---|
| `components/watchlist/WatchlistContextMenu.tsx` | 3.4, 3.5 |
| `components/chart/drawing/drawingHitTest.ts` | 4 |
| `components/chart/DrawingContextMenu.tsx` | 4 |
| `components/chart/IndicatorSettingsDialog.tsx` | 6 |
| `services/firebase.ts` | 7 |
| `public/firebase-messaging-sw.js` | 7 |
| `services/notifications/push.ts` | 7 |
| `services/mt5Bridge.ts` | 8 |
| `store/mt5Store.ts` | 8 |
| `types/mt5.ts` | 8 |

---

## ESTIMATED EFFORT

| Phase | Effort | Risk |
|---|---|---|
| 3 (UI Parity) | 2–3 hours | Low — cosmetic only |
| 4 (Drawing Engine) | 3–4 hours | Medium — wiring dead code, regression risk on existing drawings |
| 5 (Left Toolbar) | 1–2 hours | Low — UI only, depends on Phase 4 types being correct |
| 6 (Indicator Engine) | 2–3 hours | Low — dialog + existing logic |
| 7 (Push Notifications) | 2–3 hours | Medium — Firebase setup, service worker |
| 8 (MT5 Integration) | 3–4 hours | High — external service dependency |
| 9 (Trading Panel) | 2–3 hours | Low — UI redesign of existing component |
| 10 (Position Viz) | 2–3 hours | Medium — interactive canvas overlay |
| 11 (Polish) | 1–2 hours | Low — audit and tweaks |
| **Total** | **18–27 hours** | |

---

_This plan is pending approval. No code has been written._
