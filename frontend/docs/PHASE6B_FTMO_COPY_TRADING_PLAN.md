# PHASE 6B FTMO COPY TRADING PLAN

_Created 2026-07-02. Updated 2026-07-02 with the first FTMO dry-run bridge implementation. Scope:
copy orders from this web terminal to an FTMO MT5 account through the Phase 6B bridge._

## 1. Goal

When the user places a live order on the web terminal, the same intent should be executed on the
configured FTMO MT5 account.

This is not browser-to-MT5 direct trading. The browser sends a typed command to the local or
server-side MT5 Bridge. The bridge owns FTMO credentials, connects to the FTMO MT5 terminal/session,
translates the web order into broker-correct MT5 parameters, submits it, then streams the confirmed
account/position/execution state back to the browser.

```text
Web Order Ticket
  -> Phase 6B WebSocket protocol
  -> FTMO MT5 Bridge Service
  -> MT5 terminal/session logged into FTMO account
  -> FTMO server
```

## 1.1 Current Implementation Status

Implemented in this repository:

- `frontend/scripts/ftmo-mt5-bridge.mjs`: standalone Node dry-run FTMO bridge process that speaks the Phase 6B
  WebSocket protocol used by the web app.
- `backend/bridge/ftmo_mt5/`: standalone Python FTMO bridge service intended for real MT5 terminal
  integration through the official `MetaTrader5` Python package.
- `npm run ftmo-mt5-bridge`: starts the bridge.
- `npm run ftmo-mt5-python`: starts the Python bridge service when Python is installed.
- Dry-run execution only by default. The bridge accepts web order intents, validates FTMO-style
  readiness/risk rules, writes append-only audit JSONL, and emits `order.ack`, `execution.report`,
  `positions.update`, `account.snapshot`, `ftmo.readiness`, and `risk.snapshot` events back to the
  browser.
- The Node bridge still deliberately blocks live FTMO order execution with
  `LIVE_ADAPTER_NOT_CONFIGURED`.
- The Python bridge contains the real MT5 adapter path (`initialize`, `login`, `account_info`,
  `positions_get`, `orders_get`, `symbol_info`, `symbol_info_tick`, `order_check`, `order_send`),
  but live mode must be enabled explicitly and must be demo-validated before any funded use.
- FTMO credentials stay bridge-only; no FTMO login, password, or terminal path is exposed through
  `NEXT_PUBLIC_*`.

Not implemented yet:

- Automated validation on this development machine, because Python/MT5 is not installed here.
- Production hardening for long-running VPS operation.
- Funded/live execution.

## 2. Compliance And Safety Baseline

This plan is implementation guidance, not financial advice. Before using a funded or evaluation
account, verify the current FTMO Client Area, account specification, and rules for the exact account
type.

Current FTMO source checks used while writing this plan:

- FTMO states that trading style can be discretionary, algorithmic, or EA-based if legitimate,
  aligned with risk management, consistent with real market conditions, and not a forbidden
  practice.
- FTMO notes platform limits around simultaneous orders, daily position count, and message/order
  modification activity; the bridge must rate-limit and avoid hyperactive order updates.
- FTMO MT5 login uses credentials from the Client Area/Account MetriX Credentials section. Trading
  requires the master password; read-only password cannot place trades. Server must match the
  Credentials section exactly.
- FTMO describes its service as simulated trading and educational tools, and says it does not act
  as a broker or accept deposits.

Sources:

- https://ftmo.com/en/faq/which-instruments-can-i-trade-and-what-strategies-am-i-allowed-to-use/
- https://ftmo.com/en/faq/how-do-i-log-in-to-mt5/
- https://ftmo.com/en/trading-objectives/

## 3. Non-Goals

- Do not store FTMO login, master password, or investor/read-only password in browser code,
  `NEXT_PUBLIC_*`, localStorage, or committed files.
- Do not bypass FTMO rules, account limits, or forbidden-practice checks.
- Do not send automated live orders from alerts/drawings/replay without a separate explicit
  approval workflow.
- Do not assume chart symbols equal FTMO broker symbols.
- Do not optimistically create live positions in the UI before MT5 confirms execution.
- Do not support funded/live validation before FTMO demo/evaluation dry-run validation passes.

## 4. Required Bridge Deployment Shape

Recommended first implementation:

```text
Windows VPS or local Windows host
  - MT5 desktop terminal installed
  - FTMO account logged in with master password
  - FTMO MT5 Bridge Service running next to terminal
  - WebSocket endpoint exposed only to the web app/user network
```

Bridge process responsibilities:

- Load FTMO credentials from local secret storage or environment variables.
- Connect to the FTMO MT5 terminal/session.
- Verify account login, server, account mode, trade permission, balance/equity, margin, and broker
  symbol metadata before accepting live commands.
- Execute `order.place`, `order.modify`, `order.close`, `order.closeAll`, and `order.cancel`.
- Enforce FTMO-aware risk guards before sending orders to MT5.
- Stream `account.snapshot`, `symbol.info`, `positions.snapshot`, `positions.update`,
  `orders.snapshot`, `orders.update`, `order.ack`, `order.reject`, and `execution.report`.

Browser responsibilities:

- Let the user explicitly choose MT5 mode.
- Require live confirmation by default.
- Send only typed order intents to the bridge.
- Display bridge-confirmed account, positions, pending commands, rejects, and execution reports.

## 5. FTMO Bridge Environment Variables

Browser-safe variables already exist:

```env
NEXT_PUBLIC_MT5_BRIDGE_ENABLED=false
NEXT_PUBLIC_MT5_BRIDGE_URL=ws://localhost:8787
NEXT_PUBLIC_MT5_REQUIRE_CONFIRMATION=true
NEXT_PUBLIC_MT5_MAX_ORDER_VOLUME=1
NEXT_PUBLIC_MT5_BRIDGE_TOKEN=
```

Bridge-only variables must live outside the Next browser app:

```env
FTMO_MT5_ENABLED=false
FTMO_MT5_LOGIN=
FTMO_MT5_PASSWORD=
FTMO_MT5_SERVER=
FTMO_MT5_TERMINAL_PATH=
FTMO_MT5_ACCOUNT_LABEL=FTMO
FTMO_MT5_MAGIC=6602
FTMO_MT5_DEVIATION_POINTS=20
FTMO_MT5_COMMENT_PREFIX=smc-ftmo
FTMO_BRIDGE_BIND_HOST=127.0.0.1
FTMO_BRIDGE_BIND_PORT=8787
FTMO_BRIDGE_TOKEN=
FTMO_BRIDGE_REQUIRE_DEMO_FIRST=true
FTMO_BRIDGE_MAX_ORDER_VOLUME=1
FTMO_BRIDGE_MAX_DAILY_ORDERS=100
FTMO_BRIDGE_MAX_MESSAGES_PER_MINUTE=60
FTMO_BRIDGE_SNAPSHOT_INTERVAL_MS=1000
FTMO_BRIDGE_CLOSE_ALL_ENABLED=true
FTMO_BRIDGE_DRY_RUN=true
FTMO_BRIDGE_ALLOW_LIVE=false
FTMO_BRIDGE_AUDIT_PATH=.data/ftmo-mt5-audit.jsonl
FTMO_ACCOUNT_SIZE=100000
FTMO_MAX_DAILY_LOSS_PCT=5
FTMO_MAX_TOTAL_LOSS_PCT=10
FTMO_DAILY_LOSS_SAFETY_BUFFER_PCT=0.2
FTMO_MAX_RISK_PER_TRADE_PCT=0.5
FTMO_REQUIRE_STOP_LOSS=true
```

Rules:

- `FTMO_MT5_PASSWORD` must be the master password only if the bridge is intended to trade.
- Never use the read-only password for a trading bridge; it should fail readiness checks.
- `FTMO_BRIDGE_DRY_RUN=true` is the default until all demo checks pass.
- `FTMO_BRIDGE_TOKEN` should be required if the bridge is reachable beyond localhost.
- `.data/ftmo-mt5-audit.jsonl` is ignored by git and should remain local runtime evidence.
- The Python bridge reads process env plus `.env` / `.env.local` from the repository root at
  startup. Existing process env wins. Restart the Python bridge after changing account size,
  symbols, login, or risk settings.
- If `FTMO_ACCOUNT_SIZE` is unset, the Python bridge uses live MT5 equity as the risk base. If it
  is set, that fixed value is used. Startup logs print `riskBase`, `source`, and
  `maxRiskPerTrade` for verification.
- `FTMO_BRIDGE_SNAPSHOT_INTERVAL_MS` controls how often the Python bridge pushes live MT5
  account/position/order snapshots to the web UI. Default is `1000`.
- The web ticket sizes MT5 lots from account equity, risk %, stop distance, and symbol
  `tickSize`/`tickValue` streamed by the bridge. `FTMO_BRIDGE_MAX_ORDER_VOLUME` remains a hard cap;
  set it above `0.01` if you expect risk-based BTC sizing to exceed `0.01` lots.
- The MT5 order ticket also supports a manual `Lot` input. When `Lot` is empty, the ticket uses
  risk-based auto sizing. When `Lot` is filled, the browser sends that requested lot directly and
  still applies bridge symbol min/max/step validation plus bridge-side risk guards.
- The bridge streams `brokerMaxLot`, `bridgeMaxLot`, and `maxLotReason` in `symbol.info`, and logs
  one symbol cap diagnostic per chart symbol at startup/auth. If the web ticket still shows `0.01`
  after setting `FTMO_BRIDGE_MAX_ORDER_VOLUME=1`, check the bridge console:
  `cap=bridge` means an env/process restart issue; `cap=broker` means MT5 reported a broker
  `volume_max` of `0.01` for that Exness/FTMO symbol or account type.
- The bridge also streams `stopLevel`, `freezeLevel`, and `minStopDistance`. The frontend blocks
  obvious invalid stops before send; the bridge rechecks against the broker tick before MT5
  `order_check`.

## 5.1 Dry-Run Quickstart

Use this for local validation without sending any order to FTMO:

```powershell
$env:FTMO_MT5_ENABLED="true"
$env:FTMO_BRIDGE_DRY_RUN="true"
$env:FTMO_BRIDGE_AUDIT_PATH="$env:TEMP\ftmo-mt5-audit.jsonl"
npm run ftmo-mt5-bridge
```

The Python service has the same dry-run mode:

```powershell
python -m pip install -r bridge\ftmo_mt5\requirements.txt
$env:FTMO_MT5_ENABLED="true"
$env:FTMO_BRIDGE_DRY_RUN="true"
python -m bridge.ftmo_mt5.service
```

In another terminal, run the web app with MT5 mode enabled:

```env
NEXT_PUBLIC_MT5_BRIDGE_ENABLED=true
NEXT_PUBLIC_MT5_BRIDGE_URL=ws://localhost:8787
NEXT_PUBLIC_MT5_REQUIRE_CONFIRMATION=true
NEXT_PUBLIC_MT5_MAX_ORDER_VOLUME=1
```

Expected result:

1. Web app connects to `ftmo-mt5-bridge`.
2. Bridge sends `ftmo.readiness`, `risk.snapshot`, account, position, order, and symbol snapshots.
3. A web order with SL is accepted in dry-run mode and emits a simulated fill/position update.
4. Orders without SL, above configured max volume, above per-trade risk, or beyond loss guard are
   rejected before any execution path.
5. Audit records are appended to `FTMO_BRIDGE_AUDIT_PATH`.

## 5.2 Python MT5 Service Live Demo Setup

Use this only on a Windows machine or VPS where the MT5 desktop terminal is installed and the FTMO
demo/evaluation account is available.

```powershell
python -m venv .venv-ftmo
.\.venv-ftmo\Scripts\Activate.ps1
python -m pip install -r bridge\ftmo_mt5\requirements.txt
```

Then start the bridge in live-demo mode:

```powershell
$env:FTMO_MT5_ENABLED="true"
$env:FTMO_BRIDGE_DRY_RUN="false"
$env:FTMO_BRIDGE_ALLOW_LIVE="true"
$env:FTMO_MT5_LOGIN="12345678"
$env:FTMO_MT5_PASSWORD="master-password-from-client-area"
$env:FTMO_MT5_SERVER="exact-ftmo-server-name"
$env:FTMO_MT5_TERMINAL_PATH="C:\Program Files\MetaTrader 5\terminal64.exe"
python -m bridge.ftmo_mt5.service
```

Hard gates:

- Live mode will not connect unless `FTMO_BRIDGE_ALLOW_LIVE=true`.
- `FTMO_MT5_PASSWORD` must be the master password, not investor/read-only password.
- The service still applies bridge-side SL, volume, per-trade risk, daily/max loss, and audit
  checks before `order_send`.
- First demo validation must use tiny volume and direct MT5 monitoring.

## 6. Order Copy Semantics

The web order is the source of intent. MT5 is the source of truth.

Order flow:

1. User selects MT5 mode in the web Trade Panel.
2. User clicks Buy/Sell or close command.
3. Browser validates feature flag, connected bridge, account snapshot, symbol info, volume, and
   confirmation.
4. Browser sends `order.place` with `clientOrderId`.
5. For market orders, browser includes `marketPrice` for pre-trade stop-risk estimation; MT5 still
   executes with broker bid/ask.
6. Bridge validates FTMO account readiness and risk gates.
7. Bridge returns `order.ack` only after accepting the command for processing.
8. Bridge submits the order to MT5.
9. Bridge emits `execution.report` with broker outcome.
10. Bridge emits position/order/account snapshots or updates.
11. Browser updates UI only from bridge events.

Important semantics:

- `order.ack` is not a fill.
- `execution.report.status=filled` is the first fill signal.
- `positions.update` / `positions.snapshot` are the canonical position state.
- Duplicate `clientOrderId` must be idempotent.
- Reconnect must request fresh snapshots before accepting further live commands.

## 7. Symbol Mapping

The bridge must map chart symbols to FTMO/MT5 broker symbols.

Initial mapping file shape:

```json
{
  "EURUSD": { "brokerSymbol": "EURUSD", "digits": 5, "lotStep": 0.01, "minLot": 0.01 },
  "GBPUSD": { "brokerSymbol": "GBPUSD", "digits": 5, "lotStep": 0.01, "minLot": 0.01 },
  "XAUUSD": { "brokerSymbol": "XAUUSD", "digits": 2, "lotStep": 0.01, "minLot": 0.01 },
  "BTCUSDT": { "brokerSymbol": "BTCUSD", "digits": 2, "lotStep": 0.01, "minLot": 0.01 }
}
```

Bridge startup must verify each configured symbol against MT5 symbol metadata:

- Symbol exists.
- Trading is enabled.
- Digits/point match MT5.
- `volume_min`, `volume_max`, `volume_step` are loaded.
- Effective browser `maxLot` equals `min(volume_max, FTMO_BRIDGE_MAX_ORDER_VOLUME)` and exposes
  whether the active cap came from MT5 broker metadata or bridge config.
- `trade_stops_level` and `trade_freeze_level` are loaded so Buy/Sell stop direction and minimum
  broker stop distance can be validated before sending orders.
- Contract size and tick value are available for risk calculation.

If the symbol is missing or disabled, browser trading for that chart symbol must be blocked.

## 8. Volume And Risk Model

The current web ticket computes a generic position size from account equity and stop distance. That
is not enough for FTMO execution because MT5 lot sizing depends on broker contract size, tick size,
tick value, account currency, and symbol-specific lot steps.

Required bridge-side risk calculation:

```text
risk_money = min(user_risk_money, remaining_daily_loss_buffer * safety_factor)
stop_distance = abs(entry - stop_loss)
money_per_lot_at_stop = stop_distance / tick_size * tick_value
lots_raw = risk_money / money_per_lot_at_stop
lots = floor_to_step(lots_raw, volume_step)
lots = min(lots, volume_max, FTMO_BRIDGE_MAX_ORDER_VOLUME)
```

Risk gates:

- Require SL for FTMO live mode unless `FTMO_ALLOW_NO_SL=true` is deliberately set.
- Block if `lots < volume_min`.
- Block if `lots > min(volume_max, FTMO_BRIDGE_MAX_ORDER_VOLUME)`.
- Block if projected loss at SL exceeds configured per-trade risk.
- Block if projected loss could breach the daily loss guard.
- Block if free margin is insufficient.
- Block if spread/slippage exceeds configured limit.
- Block if symbol trading mode is disabled or close-only.

The browser can send a requested volume, but the bridge must revalidate or replace it with
FTMO-safe lots before placing the order.

## 9. FTMO Loss Guard

Add bridge-side account guards before any order reaches MT5.

Inputs:

- FTMO account size.
- Account balance.
- Current equity.
- Start-of-day equity/balance baseline according to the bridge's configured FTMO rule model.
- Open position floating P/L.
- Existing pending orders and their worst-case stop exposure.
- New order projected stop loss.

Recommended bridge config:

```env
FTMO_ACCOUNT_SIZE=100000
FTMO_MAX_DAILY_LOSS_PCT=5
FTMO_MAX_TOTAL_LOSS_PCT=10
FTMO_DAILY_LOSS_SAFETY_BUFFER_PCT=0.2
FTMO_MAX_RISK_PER_TRADE_PCT=0.5
FTMO_REQUIRE_STOP_LOSS=true
```

The bridge should expose:

```ts
interface FtmoRiskSnapshot {
  accountSize: number;
  dailyLossLimit: number;
  maxLossLimit: number;
  dailyLossUsed: number;
  dailyLossRemaining: number;
  maxLossRemaining: number;
  openRiskAtStops: number;
  canTrade: boolean;
  reason?: string;
  updatedAt: number;
}
```

Add a protocol extension:

| Type | Direction | Payload |
|---|---|---|
| `risk.snapshot` | bridge -> client | `FtmoRiskSnapshot` |
| `risk.reject` | bridge -> client | `{ requestId, clientOrderId?, code, message, snapshot }` |

Initial implementation can map `risk.reject` to existing `order.reject` until the UI has a
dedicated FTMO risk panel.

## 10. FTMO Trading Session Guard

The bridge should block or warn on:

- Trading outside configured user session.
- News windows if the account type/rules require news restrictions.
- Weekend holding if the account type/rules require closing before weekend.
- Server maintenance or market closed.
- High spread relative to configured threshold.
- Excessive order modification rate.

Do not hard-code these as universal FTMO constants in browser code. Keep them bridge-side config
because account type and FTMO rules can differ.

## 11. Bridge Implementation Options

### Option A - Python `MetaTrader5` Package

Best first bridge implementation if running on Windows with the MT5 terminal installed.

Pros:

- Direct account/positions/orders API.
- Easier to implement with Python service.
- Good for local/VPS bridge.

Cons:

- Windows + MT5 desktop dependency.
- Needs careful lifecycle management around terminal startup/login.

Core components:

```text
backend/bridge/ftmo_mt5/
  service.py              WebSocket server
  config.py               env + secret loading
  mt5_adapter.py          initialize/login/account snapshots/order_check/order_send/modify/close
  symbols.py              symbol metadata mapping
  risk_guard.py           FTMO loss/session/rate guards
  audit_log.py            append-only JSONL command log
```

### Option B - MT5 Expert Advisor Socket Bridge

An EA runs inside MT5 and receives commands from a local bridge.

Pros:

- All trade execution happens inside MT5 runtime.
- Can use MQL5 event model and broker-native context.

Cons:

- More moving parts.
- Harder typed protocol and testing.
- Requires EA install/config in FTMO terminal.

Recommendation: start with Option A for demo validation; keep protocol generic enough to replace
the adapter later.

## 12. Bridge Readiness Checks

Bridge must reject live mode until all pass:

- MT5 terminal initialized.
- Account logged in.
- Account login equals configured `FTMO_MT5_LOGIN`.
- Server equals configured `FTMO_MT5_SERVER`.
- Trade mode allows trading.
- Account is marked demo/evaluation unless funded mode is explicitly enabled.
- Symbol metadata loaded.
- Risk config loaded.
- Dry-run mode status is visible to browser.
- Clock skew below threshold.
- Audit log writable.

Expose readiness:

```ts
interface FtmoReadiness {
  ready: boolean;
  dryRun: boolean;
  login?: string;
  server?: string;
  accountMode: 'demo' | 'live' | 'unknown';
  checks: { name: string; ok: boolean; detail?: string }[];
  updatedAt: number;
}
```

Protocol extension:

| Type | Direction | Payload |
|---|---|---|
| `ftmo.readiness` | bridge -> client | `FtmoReadiness` |

## 13. Audit Logging

Every live-intent event must be durable before execution:

- Browser request id.
- `clientOrderId`.
- User action source (`ticket`, `contextMenu`, later `alert`, etc.).
- Raw requested order.
- Normalized MT5 order.
- Risk snapshot at decision time.
- MT5 `order_check` result.
- MT5 `order_send` result.
- Broker ticket/deal ids.
- Reject reason if blocked.
- Timestamps in UTC.

Use append-only JSONL or SQLite. Never log plaintext FTMO password.

## 14. Failure Handling

| Failure | Required behavior |
|---|---|
| Bridge disconnected | Browser blocks live commands. |
| MT5 terminal disconnected | Bridge sends `error`/readiness false; browser blocks commands. |
| Read-only login | Bridge readiness false: `MASTER_PASSWORD_REQUIRED`. |
| Symbol missing | Bridge sends no tradable `symbol.info`; browser blocks. |
| Lot invalid | Bridge returns `order.reject INVALID_VOLUME`. |
| Daily loss guard breach risk | Bridge returns `order.reject FTMO_DAILY_LOSS_GUARD`. |
| MT5 reject | Bridge sends `order.reject` or `execution.report rejected` with broker code. |
| Unknown command outcome | Bridge marks command `unknown`, refreshes snapshots, and requires manual review. |
| Reconnect | Bridge sends fresh account/positions/orders/risk snapshots before accepting commands. |

## 15. Implementation Milestones

### Milestone F0 - FTMO Docs And Rule Config

- Add this document.
- Add bridge-only env template for FTMO secrets.
- Define FTMO risk config shape and default disabled/dry-run behavior.

Exit criteria:

- No browser code stores FTMO credentials.
- Risk config and references are documented.

### Milestone F1 - Real Bridge Skeleton

- [x] Create bridge service in `frontend/scripts/ftmo-mt5-bridge.mjs`.
- [x] Add WebSocket server matching `MT5_BRIDGE_PROTOCOL.md`.
- [x] Add `ftmo.readiness` and `risk.snapshot` extensions.
- [x] Add durable append-only JSONL audit log.

Exit criteria:

- Browser can connect to bridge and see readiness/risk snapshots.
- No MT5 order execution yet.

### Milestone F2 - MT5 Session And Snapshots

- [x] Add Python MT5 adapter code path for local FTMO MT5 terminal.
- [x] Verify login/server/trade permission through readiness checks.
- [x] Stream account, positions, orders, and symbol metadata from adapter when live mode is enabled.
- Keep dry-run enabled.

Exit criteria:

- Browser reflects the actual FTMO MT5 account state.
- Wrong account/server/read-only login is rejected.
- Pending: run on a Windows machine with Python, MetaTrader5 package, and MT5 terminal installed.

### Milestone F3 - Dry-Run Order Check

- [x] Translate web orders to normalized dry-run FTMO order requests.
- [ ] Run real MT5 `order_check` or equivalent validation.
- [x] Apply FTMO risk guards from configured account size/loss/risk limits.
- [x] Return would-send execution reports without placing trades.

Exit criteria:

- User can place web orders in dry-run mode and see exact normalized FTMO lots, SL/TP, and reject
  reasons.

### Milestone F4 - Demo Execution

- [x] Add explicit `FTMO_BRIDGE_DRY_RUN=false` + `FTMO_BRIDGE_ALLOW_LIVE=true` gate.
- [x] Implement MT5 market/pending order request path with `order_check` before `order_send`.
- [x] Implement SL/TP modify, single-position close, close-all loop, and pending cancel paths.
- [ ] Place tiny demo market orders.
- [ ] Modify SL/TP in demo.
- [ ] Close single position in demo.
- [ ] Close all in demo.
- Validate reconnect/snapshot recovery.

Exit criteria:

- Demo workflow stable for at least one full test session.
- All commands have audit records.
- No duplicate orders on reconnect/retry.

### Milestone F5 - Funded/Production Hardening

- Require explicit funded-mode env flag.
- Add hardware/VPS uptime checks.
- Add bridge auth token rotation.
- Add operator kill switch.
- Add daily loss/session/news/weekend policy checks for the specific FTMO account.

Exit criteria:

- User has reviewed FTMO rules for that account.
- Bridge blocks all commands unless readiness, risk, and policy checks pass.

## 16. Manual QA Checklist

Use this order:

1. `NEXT_PUBLIC_MT5_BRIDGE_ENABLED=false`: simulator still works.
2. `npm run mock-mt5`: web connects to mock, no FTMO involved.
3. FTMO bridge dry-run: account snapshot and positions visible; no orders sent.
4. Wrong password: readiness false.
5. Read-only password: readiness false and trading blocked.
6. Wrong server: readiness false.
7. Missing symbol mapping: order blocked.
8. Invalid lot step: order rejected.
9. No SL with `FTMO_REQUIRE_STOP_LOSS=true`: order rejected.
10. Projected daily loss breach: order rejected.
11. Demo market order: fill report and position update received.
12. Demo SL/TP modify: bridge event updates chart levels.
13. Demo close: position removed only after bridge event.
14. Bridge restart: browser reconnects and receives fresh snapshots.
15. Duplicate `clientOrderId`: no duplicate MT5 order.

## 17. Rollback

Immediate rollback:

```env
NEXT_PUBLIC_MT5_BRIDGE_ENABLED=false
FTMO_MT5_ENABLED=false
FTMO_BRIDGE_DRY_RUN=true
```

Operational rollback:

- Stop the bridge service.
- Disable MT5 AutoTrading/Algo Trading if an EA adapter is used.
- Confirm open positions directly in MT5.
- Use the web terminal simulator mode only.

## 18. Acceptance Criteria

- Browser never stores or displays FTMO password.
- Simulator path remains unchanged.
- FTMO mode is opt-in and visibly live/demo/dry-run.
- Bridge refuses wrong account/server/read-only login.
- Bridge validates symbol metadata and lot sizing from MT5.
- Bridge blocks orders that could violate configured FTMO loss/risk guards.
- Every live command is confirmed, audited, idempotent, and traceable to MT5 ticket/deal ids.
- UI updates live positions only from bridge/MT5 snapshots or execution events.
- Real funded use remains blocked until demo validation and explicit funded-mode config are complete.
