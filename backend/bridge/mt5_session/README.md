# MT5 Trading Session Helper

The official Python `MetaTrader5` package does not expose broker trading-session
windows. `TradingSessionBridge.mq5` is a read-only Expert Advisor that calls the
native `SymbolInfoSessionTrade` API and publishes expiring per-symbol status to
the terminal common-files directory:

```text
<MT5 common data>\Files\MarketLens\market_sessions.json
```

It never calls `OrderSend`, does not require live-trading permission, and writes
only symbols selected in Market Watch. The Python tick bridge discovers this
file through `terminal_info().commondata_path`, validates its TTL, and forwards
the status to Go. Missing, malformed, or expired helper data is always reported
as `unknown`, never guessed from an old tick.

## Install

From PowerShell:

```powershell
cd backend\bridge\mt5_session
.\Install-TradingSessionBridge.ps1
```

Then attach `MarketLens\TradingSessionBridge` to any chart. It uses an
`OnTimer` callback, so session updates continue while the selected symbol has no
ticks. Alternatively, close MT5 and run:

```powershell
.\Install-TradingSessionBridge.ps1 -LaunchWithHelper
```

The supplied startup configuration keeps automated trading and DLL imports
disabled. Run MT5 through this configuration whenever the helper is not already
attached to a saved chart/profile.

## Status semantics

- `open`: current broker server time is inside a native trade-session window.
- `closed`: current broker server time is outside all current windows, or the
  symbol trade mode is disabled/not yet active/already expired.
- `unknown`: schedule data or the helper heartbeat is unavailable.

`valid_until` is deliberately short. If MT5, the EA, or local IPC stops, the
backend invalidates an old `open` status instead of keeping the countdown alive.
The helper actively publishes `unknown/terminal_disconnected` when MT5 loses its
trade-server connection; `TimeTradeServer()` is never trusted by itself while
offline. Native cross-day sessions through the following day are preserved.

`server_time` and `observed_at` are UTC heartbeat reference seconds used for
expiry and browser clock progression. Session windows are evaluated against the
broker server clock, then converted to UTC. Future transition timestamps are
recomputed every five seconds and can move when the broker changes its server
UTC/DST offset.

Weekly broker sessions are authoritative for scheduled trading hours. A broker
can still reject orders during unscheduled maintenance, exchange halts, or
date-specific holidays; the application does not send probe orders to discover
those conditions.
