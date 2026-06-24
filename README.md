# SMC Trading Terminal

A professional, TradingView-style trading platform for **Smart Money Concept** traders —
combining a candle chart engine, a strict no-look-ahead **Replay Mode**, an automated
**SMC engine** (structure / FVG / order blocks / liquidity / displacement / sessions), a
**trade simulator**, a **journal**, and a **performance analytics** dashboard.

Think *TradingView + FXReplay + TradeZella*, simplified and focused on SMC backtesting.

---

## ✨ Features

- **Chart engine** — candlesticks + volume, crosshair, zoom/pan/auto-scale, multi-timeframe
  (1m → 1W), powered by TradingView Lightweight Charts.
- **Drawing tools** — trend line, horizontal/vertical line, rectangle, text, Fibonacci
  retracement. Create, move, edit, delete (persisted per symbol).
- **Indicators** — SMA, EMA, VWAP, RSI, MACD, ADR levels with configurable length/colour/visibility.
- **Advanced Replay Mode** — candle-by-candle playback with **zero future-data leakage**.
  Play / pause / stop / restart / step, speeds 1× → 100×, jump-to-date, scrubber.
- **Smart Money Concepts engine**
  - Market structure: HH / HL / LH / LL, **BOS / CHOCH / MSS** (confirmed only)
  - **Fair Value Gaps** (active / mitigated, auto-removal)
  - **Order Blocks** (BOS + displacement confirmation; fresh / mitigated / invalidated)
  - **Liquidity** (equal highs/lows, buy/sell-side, sweep detection)
  - **Displacement** (ATR multiple, body expansion, relative volume)
  - **Sessions** (Asian / London / New York; high/low/mid) + **kill zones**
- **Trade simulator** — market / limit / stop orders, SL/TP, risk-based position sizing,
  partial closes, floating risk panel, entry/SL/TP chart lines.
- **Trade journal** — auto-journaling on close, notes, before/after-entry/after-exit
  screenshots (stored in IndexedDB), CSV & Excel export.
- **Performance analytics** — win rate, profit factor, avg R:R, max drawdown, expectancy,
  monthly performance, equity & drawdown curves, win/loss distribution.
- **Multi-timeframe replay** — M5 / M15 / H1 / H4 / D1 snapshot synced to the replay clock.
- **Hotkeys**, resizable panels, dark/light theme, fullscreen, screenshot export.

---

## 🧱 Tech stack

Next.js 15 (App Router) · TypeScript · TailwindCSS · Zustand · React Query ·
TradingView Lightweight Charts · Lucide · IndexedDB / LocalStorage · Web Workers.

---

## 🚀 Installation

```bash
# 1. Install dependencies (Node 18+ recommended)
npm install

# 2. Start the dev server
npm run dev
# open http://localhost:3000

# 3. Production build
npm run build
npm run start
```

Useful scripts:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
```

---

## ⌨️ Hotkeys

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `Space` | Play / Pause replay | `B` | Buy (market, current ticket) |
| `→` / `←` | Next / Prev candle | `S` | Sell (market, current ticket) |
| `Shift+→` / `Shift+←` | ±10 candles | `X` | Close all positions |
| `R` | Restart replay | `Del` | Delete selected drawing |

---

## 🗂️ Project structure

```
src/
  app/                 # Next.js App Router (layout, page, providers, theme)
  components/
    layout/            # Terminal shell, bottom panel, global runtime
    chart/             # Lightweight-charts price chart, indicator panes, drawing layer
    smc/               # SMC overlay renderer
    toolbar/           # Top toolbar, drawing rail, symbol search, menus
    watchlist/         # Watchlist
    replay/            # Replay controls + dashboard
    trade/             # Order ticket, positions, risk panel, chart trade levels
    journal/           # Journal + screenshots + export
    analytics/         # Analytics dashboard + equity chart
    ui/                # Reusable primitives (Dropdown, Panel, IconButton, Resizer)
  hooks/               # Data, replay playback, hotkeys, SMC + trade runtime
  services/
    marketData.ts      # Seeded mock OHLCV + aggregation + quotes
    indicators.ts      # SMA/EMA/VWAP/RSI/MACD/ADR
    replayEngine.ts    # No-look-ahead helpers, sessions, MTF snapshot
    tradeEngine.ts     # Sizing / risk / P&L / order triggers
    analyticsEngine.ts # KPIs, equity/drawdown, monthly, distribution
    exporters.ts       # CSV / Excel
    storage.ts         # IndexedDB + localStorage
    smc/               # structure / fvg / orderBlock / liquidity / displacement / sessions / orchestrator
  store/               # Zustand: chart, replay, smc, trade, journal, analytics, watchlist, ui
  types/               # Shared domain types
  utils/               # format, time, math, cn, id, bus
  workers/             # smc.worker.ts (off-thread SMC compute)
```

---

## 🔒 No look-ahead guarantee

Replay safety is structural, not incidental:

1. The chart store holds the **full** master series.
2. `useVisibleCandles()` is the **only** source the chart, indicators, SMC engine and trade
   simulator read from. When replay is armed it returns `candles[0 … cursor]`.
3. Future candles therefore **do not exist** downstream of that hook — no engine can consult
   them, and swing/structure confirmation honours the same fractal lag a live trader sees.

---

## 📊 Mock data

`services/marketData.ts` generates deterministic, seeded OHLCV (random walk with volatility
clustering, intraday seasonality and displacement impulses) at 1-minute resolution, then
aggregates to any timeframe. Swap `fetchHistory` / `fetchQuote` for a real API to go live —
the rest of the app is data-source agnostic.

---

## 📝 License

MIT — for educational and research use.
