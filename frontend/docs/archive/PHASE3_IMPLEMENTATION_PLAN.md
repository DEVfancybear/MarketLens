# PHASE 3 IMPLEMENTATION PLAN — TradingView UI Parity

_Date: 2026-06-25. Based on `docs/UI_GAP_ANALYSIS.md`._

This plan covers only Phase 3 (UI/UX parity). Phase 4 (Drawing Engine) is a
separate milestone. Target: **90% TradingView visual parity in ~3.5 hours.**

All changes are cosmetic — no data flow, no engine logic, no trading features.

---

## Step 3.1 — Layout System (~10 min)

### 3.1a: Tighten toolbar + panel dimensions

**Files:**
- `src/components/layout/TerminalLayout.tsx` — top toolbar: `h-10` → `h-9` (36px)
- `src/components/ui/Panel.tsx` — header: `h-9` → `h-8` (32px)
- `src/store/uiStore.ts` — left rail: `DEFAULT_PANELS.left`: `48` → `40`

**Justification:** TradingView uses 36px toolbar, 32px panel headers, 40px left rail. These exact sizes.

**Risk:** None — grid CSS handles the height change automatically. The left rail width change only affects the toolbar container; the icons inside already fit at 40px.

### 3.1b: Upgrade BottomPanel tabs to TradingView style

**File:** `src/components/layout/BottomPanel.tsx`

**Changes:**
- Replace rounded button tabs with flat tabs
- Active tab gets a 2px accent underline (`border-b-2 border-brand`) instead of `bg-terminal-hover`
- Inactive tabs: simple `text-ink-muted` text with no background
- Tab strip: `h-8` (32px) container, tabs are `px-3` with `text-2xs` font (11px)
- Add `relative` positioning on tab strip for underline positioning

**Before (current):**
```html
<button class="h-7 rounded px-3 text-xs font-medium
  active: bg-terminal-hover text-ink
  inactive: text-ink-muted hover:bg-terminal-hover/50">
```

**After (TradingView-style):**
```html
<button class="relative px-3 py-1 text-2xs font-medium
  active: text-ink border-b-2 border-brand
  inactive: text-ink-muted hover:text-ink">
```

**Risk:** None — pure CSS change. Animation on tab switch is handled by Tailwind's `transition-colors`.

---

## Step 3.2 — Chart Styling (~15 min)

### 3.2a: Fix background color mismatch

**File:** `src/components/chart/chartTheme.ts`

**Change:** Dark mode `background`: `'#131722'` → `'#0b0e11'`

**Justification:** The current `#131722` (panel background) differs from the chart background `#0b0e11` (body background). TradingView uses a uniform dark surface across the entire terminal. The chart background should match the CSS `--bg` token, not `--panel`.

**Risk:** Low. The chart was designed with `#131722` as its surface; switching to `#0b0e11` will make it slightly darker. Grid lines, candles, and crosshair remain visible since they use contrasting colors. Verify with the light theme too.

### 3.2b: Dynamic bar spacing per timeframe

**File:** `src/components/chart/PriceChart.tsx`

**Change:** Replace hardcoded `barSpacing: 8` with a dynamic lookup:

```ts
const BAR_SPACING: Record<Timeframe, number> = {
  '1m': 4, '3m': 5, '5m': 6, '15m': 8, '30m': 10,
  '1H': 10, '4H': 12, '1D': 14, '1W': 16,
};
```

Apply on chart creation and on timeframe change via `chart.timeScale().applyOptions({ barSpacing })`.

**Justification:** TradingView shows tighter bars on lower timeframes (more bars visible) and wider bars on higher timeframes. Hardcoded 8 gives too few bars on 1m and too many gaps on 1D.

**Risk:** Low — the chart re-fits on timeframe change so there's no visual jarring.

### 3.2c: Solid last-price line

**File:** `src/components/chart/PriceChart.tsx`

**Change:** `priceLineStyle: 2` → `priceLineStyle: 0` (solid line). Also set `priceLineColor` dynamically based on last candle direction (green/red).

```ts
// After candle series is created, set the price line color
const lastCandle = candles[candles.length - 1];
const priceLineColor = lastCandle?.close >= lastCandle?.open 
  ? c.bull : c.bear;
candleSeries.applyOptions({ priceLineColor });
```

**Justification:** TradingView uses a solid horizontal price line on the right scale, colored green/red by candle direction. Our dashed line is fine but doesn't match.

### 3.2d: Grid line opacity

**File:** `src/components/chart/chartTheme.ts` + `PriceChart.tsx`

**Change:** No file change needed — LWC `grid` color is already `#1e222d` which is sufficiently faint. The `style: 0` (solid) at `#1e222d` is visually equivalent to TradingView's `#1e222d` at partial opacity.

**Verdict:** OK as-is. No change.

---

## Step 3.3 — Price Scale UX (~20 min)

### 3.3a: Bar countdown timer

**File:** `src/components/chart/ChartArea.tsx`

**Changes:**
- Add a `useCountdown(timeframe)` hook (new file: `src/hooks/useCountdown.ts`)
- Display countdown next to the timeframe label in the top-left overlay
- Format: `"0:42"` (MM:SS) for the remaining time in the current bar

```ts
// useCountdown.ts
import { TF_SECONDS, type Timeframe } from '@/types';
import { useEffect, useState } from 'react';

export function useCountdown(tf: Timeframe): string {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const sec = TF_SECONDS[tf];
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      setRemaining(sec - (now % sec));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tf]);
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
```

Display in `ChartArea.tsx`:
```html
<span className="text-xs font-medium text-ink-faint tabular">
  {useCountdown(timeframe)}
</span>
```

**Risk:** Low. A 1-second interval is negligible for performance. The hook re-renders only the ChartArea (not the chart itself).

### 3.3b: Refine symbol+TF header

**File:** `src/components/chart/ChartArea.tsx`

**Changes:**
- Symbol: `text-sm` (14px) → keep
- Timeframe: `text-ink-muted` → keep
- Countdown: add next to timeframe on same line
- OHLC legend: keep as-is (it's functional but secondary)

### 3.3c: Price label color direction

**File:** `src/components/chart/PriceChart.tsx`

Already handled in 3.2c (last-price line color). The `lastValueVisible: true` setting shows the numeric price label on the right scale — LWC colors this automatically based on `priceLineColor`.

---

## Step 3.4 — Watchlist Upgrade (~1h 20min)

### 3.4a: Compact row height + active indicator

**File:** `src/components/watchlist/Watchlist.tsx` — the `WatchRow` component

**Changes:**
- Row: `py-1.5` → `py-1` (28px total row height with text)
- Active row: replace `bg-brand/10` with:
  ```html
  className={cn(
    'group grid cursor-pointer grid-cols-[1fr_auto_auto] items-center gap-x-2 px-3 py-1 hover:bg-terminal-hover',
    // Active: left border accent + subtle background
    active && 'border-l-[3px] border-l-brand bg-brand/5 pl-[9px]',
  )}
  ```

**Justification:** TradingView uses a 3px blue left-border on the active watchlist row with a very subtle blue-tinted background. The `pl-[9px]` compensates for the extra border width so text doesn't shift.

### 3.4b: Watchlist context menu

**New file:** `src/components/watchlist/WatchlistContextMenu.tsx`

**Pattern:** Copy `AlertContextMenu.tsx` structure:
- Portal-rendered, positioned at right-click coordinates
- Items: Remove from Watchlist, Create Alert, Hide Symbol
- Closes on outside click + Esc
- CSS animation (same `context-menu-pop` keyframe)

**Integration into `WatchRow`:**
```html
<div onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, ticker }); }}>
```

Add `WatchlistContextMenu` to `Watchlist` component (similar pattern to `ChartContextMenu` in `PriceChart`).

### 3.4c: Price flash on update

**File:** `src/components/watchlist/Watchlist.tsx` — `WatchRow`

**Change:** Track previous price in a `useRef`. When `quote.last` changes, briefly apply a green/red flash class.

```ts
const prevPriceRef = useRef<number | undefined>(quote?.last);
const [flash, setFlash] = useState<'up' | 'down' | null>(null);

useEffect(() => {
  if (quote && prevPriceRef.current !== undefined && quote.last !== prevPriceRef.current) {
    setFlash(quote.last > prevPriceRef.current ? 'up' : 'down');
    const t = setTimeout(() => setFlash(null), 300);
    prevPriceRef.current = quote.last;
    return () => clearTimeout(t);
  }
  prevPriceRef.current = quote?.last;
}, [quote?.last]);
```

Apply flash classes:
```html
className={cn(
  flash === 'up' && 'animate-flash-up',
  flash === 'down' && 'animate-flash-down',
)}
```

Add CSS keyframes to `globals.css`:
```css
@keyframes flashUp { from { background: rgba(38,166,154,0.25); } }
@keyframes flashDown { from { background: rgba(239,83,80,0.25); } }
.animate-flash-up { animation: flashUp 300ms ease-out; }
.animate-flash-down { animation: flashDown 300ms ease-out; }
```

**Risk:** Low. Ref comparison is cheap. Flash animation doesn't affect layout.

---

## Step 3.5 — Context Menus (~30 min)

### 3.5a: Chart context menu additional items

**File:** `src/components/chart/ChartContextMenu.tsx`

**Add items (after "Create Alert" section):**
```
+ "Add to Watchlist" (if not already in watchlist)
+ "Remove from Watchlist" (if already in watchlist)
+ "Copy Price" (copy priceStr to clipboard)
```

Implementation: read `useWatchlistStore` to check if symbol is in watchlist, call `add/remove` accordingly.

### 3.5b: Watchlist context menu

Already covered in 3.4b — `WatchlistContextMenu.tsx`.

---

## Step 3.6 — Keyboard Shortcuts (~15 min)

**File:** `src/hooks/useHotkeys.ts`

**Add:**
- `Alt + A` → toggle alert center (`useUIStore.getState().toggleAlertCenter()`)
- Keep existing: Space (replay), Arrow keys (replay step), B/S/X (trade)
- Delete/Esc: already handled in `AlertOverlay`

---

## Step 3.7 — Typography + Polish (~15 min)

### 3.7a: Font sizes

**File:** `src/components/toolbar/TopToolbar.tsx`

- Timeframe buttons: `text-2xs` (10px) → `text-xs` (11px, via `text-[11px]`)

**File:** `src/components/toolbar/DrawingToolbar.tsx`

- Icons: `size={16}` → `size={18}` (TradingView left toolbar icons)

### 3.7b: Toolbar button refinements

**File:** `src/components/toolbar/SymbolSearch.tsx`

- Widen symbol button: `h-7` → `h-8` for better click target
- Keep existing icon + symbol name + exchange badge pattern

---

## Implementation order (by dependency)

| Order | Step | Dependencies | Files |
|---|---|---|---|
| 1 | 3.1a — Toolbar/panel dimensions | None | TerminalLayout, Panel, uiStore |
| 2 | 3.1b — BottomPanel tabs | None | BottomPanel |
| 3 | 3.2a — Background color fix | None | chartTheme |
| 4 | 3.2b — Dynamic bar spacing | None (3.2a optional) | PriceChart |
| 5 | 3.2c — Solid price line | None | PriceChart |
| 6 | 3.3a — Countdown timer | None (needs new hook) | ChartArea + new useCountdown |
| 7 | 3.3b — Symbol+TF header | None | ChartArea |
| 8 | 3.4a — Compact rows + active indicator | None | Watchlist |
| 9 | 3.4b — Watchlist context menu | None (new component) | New: WatchlistContextMenu + Watchlist |
| 10 | 3.4c — Price flash | None (3.4a optional) | Watchlist + globals.css |
| 11 | 3.5a — Chart context menu items | None | ChartContextMenu |
| 12 | 3.6 — Keyboard shortcuts | None | useHotkeys |
| 13 | 3.7a — Font sizes | None | TopToolbar, DrawingToolbar |
| 14 | 3.7b — SymbolSearch width | None | SymbolSearch |

## Combined file change list

| File | Steps | Type |
|---|---|---|
| `components/layout/TerminalLayout.tsx` | 3.1a | modify |
| `components/ui/Panel.tsx` | 3.1a | modify |
| `store/uiStore.ts` | 3.1a | modify |
| `components/layout/BottomPanel.tsx` | 3.1b | modify |
| `components/chart/chartTheme.ts` | 3.2a | modify |
| `components/chart/PriceChart.tsx` | 3.2b, 3.2c | modify |
| `components/chart/ChartArea.tsx` | 3.3a, 3.3b | modify |
| `hooks/useCountdown.ts` | 3.3a | **new** |
| `components/watchlist/Watchlist.tsx` | 3.4a, 3.4c | modify |
| `components/watchlist/WatchlistContextMenu.tsx` | 3.4b | **new** |
| `app/globals.css` | 3.4c | modify |
| `components/chart/ChartContextMenu.tsx` | 3.5a | modify |
| `hooks/useHotkeys.ts` | 3.6 | modify |
| `components/toolbar/TopToolbar.tsx` | 3.7a | modify |
| `components/toolbar/DrawingToolbar.tsx` | 3.7a | modify |
| `components/toolbar/SymbolSearch.tsx` | 3.7b | modify |

**Total: 14 files modified, 2 files created.**

---

## Validation checklist

After implementation, verify:

- [ ] Top toolbar height is 36px (not 40px)
- [ ] Panel headers are 32px (not 36px)
- [ ] Left rail is 40px wide
- [ ] Bottom tabs have underline indicator, not pill shapes
- [ ] Chart background matches panel background (`#0b0e11`)
- [ ] Bar spacing changes per timeframe (1m tight, 1D loose)
- [ ] Last-price line is solid, colored green/red
- [ ] Countdown timer shows "0:42" format in chart header
- [ ] Active watchlist row has blue left-border accent
- [ ] Right-click on watchlist row opens context menu
- [ ] Price cells flash green on increase, red on decrease
- [ ] Chart context menu has Add/Remove Watchlist + Copy Price
- [ ] Alt+A toggles Alert Center
- [ ] Timeframe buttons use 11px font
- [ ] Left toolbar icons are 18px
- [ ] Build passes with zero type/lint errors
