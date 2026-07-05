# PHASE 6B MULTI-BROKER MT5 COPY TRADING PLAN

_Created 2026-07-02. Scope: broker-agnostic plan for copying web terminal orders to MT5 accounts
at brokers such as Exness, IC Markets, Pepperstone, OANDA MT5, or other MT5-compatible brokers._

## 1. Goal

When a user places a live order in the web terminal, the same trading intent should be copied to
one or more configured MT5 accounts, regardless of broker, as long as the broker account is reachable
through an MT5 bridge adapter.

This document is the general plan. Broker-specific docs such as
`docs/PHASE6B_FTMO_COPY_TRADING_PLAN.md` can specialize the same architecture with proprietary firm
rules, account restrictions, and risk policies.

```text
Web Order Ticket
  -> Phase 6B WebSocket protocol
  -> Multi-broker MT5 Bridge Service
  -> Broker profile + account profile + risk guard
  -> MT5 terminal/session for Exness / IC Markets / other broker
  -> Broker MT5 server
```

## 2. Design Principles

- Browser never stores broker login, password, investor password, API key, or terminal path.
- Browser sends typed order intent only.
- The bridge owns broker credentials, account sessions, symbol metadata, execution policy, and
  account-specific risk guards.
- MT5 account snapshots and execution reports are the source of truth.
- Simulator mode remains default and must work when every broker bridge is disabled.
- Live broker execution must be opt-in per account.
- Every broker/account profile starts in dry-run mode.
- Broker-specific behavior must be data/config driven, not hard-coded in React components.

## 3. Supported Broker Classes

Initial target brokers:

| Broker class | Examples | Notes |
|---|---|---|
| Retail CFD/FX brokers | Exness, IC Markets, Pepperstone, Vantage, XM | MT5 symbol suffixes, execution/fill modes, contract size, commission, leverage, and trading sessions vary. |
| Prop/evaluation accounts | FTMO, other evaluation firms | Usually need stricter loss guards, session/news/weekend rules, and explicit funded-mode controls. |
| Broker demo accounts | Any MT5 demo | Required first validation target before live/funded use. |

This plan does not assume a broker exposes a REST trading API. It assumes order execution goes
through an MT5 terminal/session or an EA/socket adapter connected to MT5.

## 4. Non-Goals

- Do not build a generic broker-login UI inside the browser.
- Do not commit broker credentials or terminal config.
- Do not implement copy trading between third-party accounts without explicit user authorization.
- Do not bypass broker terms, leverage/margin restrictions, or regional rules.
- Do not use one broker's symbol/lot assumptions for another broker.
- Do not auto-copy alerts/drawings/replay trades to live brokers without a separate permission and
  risk-control workflow.
- Do not infer fills locally; wait for MT5/broker confirmation.

## 5. Topology Options

### Option A - One Bridge, Many MT5 Terminals

```text
Bridge service
  -> MT5 terminal A logged into Exness
  -> MT5 terminal B logged into IC Markets
  -> MT5 terminal C logged into demo broker
```

Pros:

- Centralized WebSocket endpoint for the web terminal.
- One audit log and one risk-policy engine.
- Can route one web order to selected accounts.

Cons:

- Managing multiple terminal processes is operationally harder.
- Windows desktop/VPS resources matter.

### Option B - One Bridge Per Broker Account

```text
Web app
  -> bridge-exness.local:8787
  -> bridge-icmarkets.local:8788
```

Pros:

- Isolated failures and credentials.
- Simpler service lifecycle.
- Safer for funded accounts.

Cons:

- Browser/client needs account selection or aggregator.
- Harder global audit across brokers.

Recommendation:

- Start with Option B for safety and simplicity.
- Add a bridge aggregator only after single-account execution is stable.

## 6. Broker And Account Profiles

All broker/account-specific behavior should come from profile files or bridge-only environment
variables.

Example broker profile:

```json
{
  "brokerId": "exness",
  "displayName": "Exness",
  "platform": "mt5",
  "defaultTerminalPath": "C:/Program Files/MetaTrader 5/terminal64.exe",
  "symbolSuffixCandidates": ["", "m", ".m", "c", ".r", ".raw"],
  "supportsHedging": true,
  "defaultFillPolicy": "broker",
  "maxMessagesPerMinute": 60,
  "maxOrderRetries": 0,
  "defaultSlippagePoints": 30,
  "requiresStopLoss": false
}
```

Example account profile:

```json
{
  "accountId": "exness-main-demo",
  "brokerId": "exness",
  "label": "Exness Demo",
  "login": "12345678",
  "server": "Exness-MT5Trial",
  "terminalPath": "C:/MT5/Exness/terminal64.exe",
  "mode": "demo",
  "enabled": false,
  "dryRun": true,
  "maxOrderVolume": 1,
  "maxRiskPerTradePct": 0.5,
  "requireStopLoss": true,
  "copyRatio": 1,
  "symbols": {
    "EURUSD": { "brokerSymbol": "EURUSDm" },
    "XAUUSD": { "brokerSymbol": "XAUUSDm" },
    "BTCUSDT": { "brokerSymbol": "BTCUSDm" }
  }
}
```

Secrets stay outside the profile or are referenced by secret id:

```env
MT5_ACCOUNT_EXNESS_MAIN_PASSWORD=
MT5_ACCOUNT_ICMARKETS_DEMO_PASSWORD=
```

## 7. Environment Variables

Browser-safe variables stay generic:

```env
NEXT_PUBLIC_MT5_BRIDGE_ENABLED=false
NEXT_PUBLIC_MT5_BRIDGE_URL=ws://localhost:8787
NEXT_PUBLIC_MT5_REQUIRE_CONFIRMATION=true
NEXT_PUBLIC_MT5_MAX_ORDER_VOLUME=1
NEXT_PUBLIC_MT5_BRIDGE_TOKEN=
```

Bridge-only variables:

```env
MT5_BRIDGE_ENABLED=false
MT5_BRIDGE_BIND_HOST=127.0.0.1
MT5_BRIDGE_BIND_PORT=8787
MT5_BRIDGE_TOKEN=
MT5_BRIDGE_DRY_RUN=true
MT5_BRIDGE_PROFILE_DIR=./profiles
MT5_BRIDGE_AUDIT_PATH=./data/mt5-audit.jsonl
MT5_BRIDGE_DEFAULT_ACCOUNT=
MT5_BRIDGE_ALLOW_LIVE=false
MT5_BRIDGE_MAX_MESSAGES_PER_MINUTE=60
MT5_BRIDGE_MAX_DAILY_ORDERS=100
MT5_BRIDGE_CLOSE_ALL_ENABLED=true
```

Per-account secrets:

```env
MT5_ACCOUNT_EXNESS_LOGIN=
MT5_ACCOUNT_EXNESS_PASSWORD=
MT5_ACCOUNT_EXNESS_SERVER=
MT5_ACCOUNT_EXNESS_TERMINAL_PATH=

MT5_ACCOUNT_ICMARKETS_LOGIN=
MT5_ACCOUNT_ICMARKETS_PASSWORD=
MT5_ACCOUNT_ICMARKETS_SERVER=
MT5_ACCOUNT_ICMARKETS_TERMINAL_PATH=
```

Rules:

- Password variables must be bridge-only.
- Do not create `NEXT_PUBLIC_MT5_ACCOUNT_*`.
- Live mode requires both account profile `dryRun=false` and global `MT5_BRIDGE_ALLOW_LIVE=true`.

## 8. Account Selection And Routing

Initial browser behavior should remain single-target:

- One active MT5 bridge URL.
- One bridge-selected default account.
- Browser displays account label from `account.snapshot`.

Later multi-account routing:

```ts
interface CopyTarget {
  accountId: string;
  enabled: boolean;
  copyRatio: number;
  maxOrderVolume: number;
  mode: 'dryRun' | 'demo' | 'live';
}
```

Protocol extension:

| Type | Direction | Payload |
|---|---|---|
| `accounts.snapshot` | bridge -> client | `{ accounts: BrokerAccountSummary[], activeAccountId }` |
| `account.select` | client -> bridge | `{ accountId }` |
| `copy.targets` | bridge -> client | `{ targets: CopyTarget[] }` |
| `copy.route` | client -> bridge | `{ clientOrderId, targets?: CopyTarget[] }` |

Do not implement multi-target copying until single-target execution is stable and audited.

## 9. Symbol Discovery And Mapping

Different brokers use different symbol names:

| Chart symbol | Possible broker symbols |
|---|---|
| `EURUSD` | `EURUSD`, `EURUSDm`, `EURUSD.a`, `EURUSD.raw`, `EURUSD.r` |
| `GBPUSD` | `GBPUSD`, `GBPUSDm`, `GBPUSD.a`, `GBPUSD.raw` |
| `XAUUSD` | `XAUUSD`, `XAUUSDm`, `GOLD`, `XAUUSD.raw` |
| `US30` | `US30`, `US30.cash`, `DJ30`, `DJI30` |
| `BTCUSDT` | `BTCUSD`, `BTCUSDm`, `BTCUSD.raw`, `BTCUSD.r` |

Bridge startup symbol discovery:

1. Load configured `chartSymbol -> brokerSymbol`.
2. Query MT5 symbols.
3. If missing, try suffix candidates.
4. Validate `trade_mode`, `digits`, `point`, `volume_min`, `volume_max`, `volume_step`.
5. Validate `trade_contract_size`, `tick_size`, `tick_value`, margin requirements.
6. Emit `symbol.info` for tradable symbols only.
7. Emit explicit error for missing/disabled symbols.

Never trust static mapping alone. Always verify against MT5 at runtime.

## 10. Order Normalization

Web order input:

```ts
interface WebOrderIntent {
  chartSymbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop';
  requestedVolume?: number;
  riskPct?: number;
  price?: number;
  sl?: number;
  tp?: number;
  clientOrderId: string;
}
```

Normalized broker order:

```ts
interface BrokerOrderRequest {
  accountId: string;
  brokerId: string;
  brokerSymbol: string;
  side: 'buy' | 'sell';
  mt5OrderType: 'BUY' | 'SELL' | 'BUY_LIMIT' | 'SELL_LIMIT' | 'BUY_STOP' | 'SELL_STOP';
  volume: number;
  price?: number;
  sl?: number;
  tp?: number;
  deviationPoints: number;
  fillingMode?: string;
  timeType?: string;
  comment: string;
  magic: number;
  clientOrderId: string;
}
```

Normalization steps:

1. Resolve active account profile.
2. Resolve broker symbol.
3. Round price, SL, and TP to symbol digits/tick size.
4. Compute or clamp volume using account risk rules and symbol lot step.
5. Convert web side/type to MT5 order type.
6. Select fill policy supported by symbol/account.
7. Attach deterministic magic number and comment.
8. Run margin/risk/session checks.
9. Send dry-run or real `order_send`.

## 11. Lot Sizing Across Brokers

Lot sizing must be bridge-side because each broker can have different:

- Contract size.
- Tick size.
- Tick value.
- Account currency.
- Quote currency conversion.
- Min/max/step lot.
- Commission model.
- Margin/leverage.

Generic lot formula:

```text
entry = market_price or pending_order_price
stop_distance = abs(entry - stop_loss)
money_per_lot_at_stop = stop_distance / tick_size * tick_value
raw_lots = risk_money / money_per_lot_at_stop
lots = floor(raw_lots / volume_step) * volume_step
lots = clamp(lots, volume_min, volume_max, account_max_order_volume)
```

If `tick_value` is unreliable for a CFD symbol, bridge must use MT5 profit calculation APIs when
available, or reject the symbol until configured.

No-SL policy:

- Default for real broker mode should be `requireStopLoss=true`.
- Allow no-SL only per account profile and only with a fixed small max volume.

## 12. Broker Execution Differences

Bridge must handle:

| Difference | Required handling |
|---|---|
| Hedging vs netting account | Display account mode; prevent wrong close logic. |
| Market execution vs instant execution | Use correct deviation/slippage handling. |
| Fill modes | Query symbol-supported fill mode; avoid hard-coded FOK/IOC. |
| Min stop distance | Validate SL/TP and pending price distance before send. |
| Freeze level | Block modify/close operations that broker refuses near market. |
| Symbol sessions | Block or warn when market is closed. |
| Commission | Include in risk reporting when available. |
| Swap | Display but do not include in order placement calculation unless configured. |
| Leverage/margin | Run margin check before order. |
| Partial fills | Preserve partial-fill execution reports and update remaining volume. |

## 13. Risk Guard Model

Generic risk guard:

```ts
interface BrokerRiskPolicy {
  maxRiskPerTradePct: number;
  maxDailyLossPct?: number;
  maxTotalLossPct?: number;
  maxOpenRiskPct?: number;
  maxOrderVolume: number;
  maxOpenPositions?: number;
  maxPendingOrders?: number;
  requireStopLoss: boolean;
  maxSpreadPoints?: number;
  maxSlippagePoints?: number;
  allowedSymbols?: string[];
  blockedSymbols?: string[];
  allowedSessions?: { day: number; start: string; end: string; timezone: string }[];
}
```

Risk checks before every order:

- Account is enabled.
- Account is not dry-run unless dry-run command.
- Account has trade permission.
- Broker symbol is tradable.
- Volume is within min/max/step.
- SL/TP and pending price obey stop/freeze levels.
- Projected loss at SL is within account policy.
- Aggregate open risk remains within account policy.
- Spread/slippage is within account policy.
- Free margin remains above threshold.
- Daily order/message limits are not exceeded.

Bridge rejects with clear codes:

| Code | Meaning |
|---|---|
| `BROKER_ACCOUNT_DISABLED` | Account profile disabled. |
| `BROKER_DRY_RUN_ONLY` | Account is dry-run and real execution was requested. |
| `BROKER_SYMBOL_MISSING` | Broker symbol cannot be resolved. |
| `BROKER_SYMBOL_NOT_TRADABLE` | MT5 reports trade disabled/close-only. |
| `BROKER_INVALID_VOLUME` | Volume violates broker step/min/max. |
| `BROKER_STOP_DISTANCE` | SL/TP/pending price too close to market. |
| `BROKER_SPREAD_TOO_HIGH` | Current spread exceeds policy. |
| `BROKER_RISK_LIMIT` | Per-trade/open/daily risk limit would be breached. |
| `BROKER_MARGIN_INSUFFICIENT` | Margin check failed. |
| `BROKER_RATE_LIMIT` | Command/message rate too high. |

## 14. Dry-Run Mode

Dry-run is mandatory for every new broker/account profile.

Dry-run behavior:

- Bridge performs all mapping, price rounding, lot sizing, risk checks, and margin checks.
- Bridge does not send `order_send`.
- Bridge returns a simulated `execution.report` with `status='rejected'` or `status='filled'` plus
  `dryRun: true` in extension metadata.
- Browser logs should label the command as dry-run.

Dry-run exit criteria:

- Symbol mapping verified for every intended symbol.
- Lot size matches broker expectation.
- SL/TP rounded correctly.
- Risk money at SL matches expected value.
- Margin check passes.
- Reject cases are visible in UI.
- Audit log is written.

## 15. Audit Logging

Every broker command must be append-only logged:

- User action source.
- Active account id.
- Broker id.
- `clientOrderId`.
- Web order intent.
- Symbol mapping result.
- Normalized broker order.
- Risk policy and risk snapshot.
- MT5 pre-check result.
- MT5 send result.
- Ticket/deal ids.
- Snapshots before/after command.
- Reject/error details.

Use JSONL or SQLite. Passwords and tokens must never be logged.

## 16. Bridge Readiness

Expose account readiness per broker account:

```ts
interface BrokerAccountReadiness {
  accountId: string;
  brokerId: string;
  label: string;
  ready: boolean;
  enabled: boolean;
  dryRun: boolean;
  mode: 'demo' | 'live' | 'unknown';
  login?: string;
  server?: string;
  terminalConnected: boolean;
  tradeAllowed: boolean;
  symbolsLoaded: boolean;
  auditWritable: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
  updatedAt: number;
}
```

Protocol extension:

| Type | Direction | Payload |
|---|---|---|
| `broker.accounts` | bridge -> client | `{ accounts: BrokerAccountReadiness[] }` |
| `broker.readiness` | bridge -> client | `BrokerAccountReadiness` |

Browser can initially ignore these extensions and keep using `account.snapshot`; future UI should
show them in an account selector.

## 17. Security Model

Required controls:

- Bridge binds to `127.0.0.1` by default.
- Bridge token required when exposed on LAN/VPS/public host.
- Use TLS or a private tunnel when not localhost.
- Browser token must be short-lived if possible.
- One bridge token per browser/client.
- No broker credentials in browser.
- No plaintext credentials in audit logs.
- `.env` and profile secret files are gitignored.
- Operator kill switch can disable all live execution immediately.

Suggested kill switch:

```env
MT5_BRIDGE_ENABLED=false
MT5_BRIDGE_ALLOW_LIVE=false
MT5_BRIDGE_DRY_RUN=true
```

## 18. Implementation Options

### Option A - Python `MetaTrader5` Bridge

Best first implementation for Windows VPS/local terminal.

```text
bridge/
  app.py
  config.py
  profiles/
    brokers/exness.json
    brokers/icmarkets.json
    accounts/exness-demo.json
  mt5_session.py
  account_registry.py
  symbol_discovery.py
  risk_policy.py
  order_normalizer.py
  order_executor.py
  snapshot_stream.py
  audit_log.py
```

### Option B - MQL5 EA Adapter Per Terminal

Best if Python MT5 package becomes unreliable for terminal lifecycle or multi-terminal management.

```text
Web bridge
  -> local socket
  -> EA inside MT5
  -> broker server
```

The EA should still implement the same protocol semantics: idempotent `clientOrderId`, ack/reject,
execution report, snapshots, and audit.

### Option C - Broker Native API

Only if a broker provides an official API for the exact account. This should be an adapter behind
the same bridge protocol, not a separate browser integration.

## 19. Implementation Milestones

### Milestone B0 - Broker-Agnostic Docs And Config Schema

- Add this document.
- Define broker profile schema.
- Define account profile schema.
- Define generic risk policy schema.

Exit criteria:

- New broker onboarding can happen without touching React components.

### Milestone B1 - Bridge Account Registry

- Load broker/account profiles.
- Validate required secrets exist.
- Expose `broker.accounts` readiness without trading.
- Add audit log.

Exit criteria:

- Browser can see which broker account is active/ready.

### Milestone B2 - MT5 Session Adapter

- Connect one MT5 terminal/account.
- Verify login/server.
- Stream account/positions/orders.
- Discover symbols.

Exit criteria:

- Exness demo or IC Markets demo account snapshot appears in browser.

### Milestone B3 - Dry-Run Order Normalization

- Map web order to broker order.
- Compute lots from tick value/contract size.
- Validate stop/freeze/spread/margin/risk.
- Return dry-run execution report.

Exit criteria:

- Same web order produces broker-specific normalized output for at least two brokers.

### Milestone B4 - Demo Execution

- Enable real `order_send` only for demo account.
- Place tiny market order.
- Place pending order.
- Modify SL/TP.
- Close position.
- Close all.
- Validate reconnect and idempotency.

Exit criteria:

- Demo execution stable for Exness or IC Markets.

### Milestone B5 - Multi-Account Routing

- Add account selector.
- Add optional copy targets and ratios.
- Add per-target risk validation.
- Ensure partial target failure does not hide success/failure of other targets.

Exit criteria:

- One web order can dry-run or execute across selected demo accounts with clear per-account reports.

### Milestone B6 - Live Hardening

- Require explicit `MT5_BRIDGE_ALLOW_LIVE=true`.
- Add production token/TLS/tunnel setup.
- Add operator kill switch UI/status.
- Add broker-specific terms checklist.
- Add uptime/restart monitoring.

Exit criteria:

- Live execution remains blocked until account owner explicitly enables it and demo validation is
  documented.

## 20. Broker Onboarding Checklist

For each broker/account:

1. Create broker profile.
2. Create account profile with `enabled=false`, `dryRun=true`.
3. Install separate MT5 terminal instance if needed.
4. Log in manually and verify server.
5. Set bridge-only login/password/server/terminal path.
6. Start bridge and verify readiness.
7. Run symbol discovery.
8. Confirm chart-to-broker symbol mapping.
9. Dry-run market buy/sell.
10. Dry-run pending limit/stop.
11. Dry-run SL/TP modify.
12. Dry-run close/close-all.
13. Demo execute tiny market order.
14. Demo close position.
15. Restart bridge and verify snapshots recover.
16. Review broker terms, leverage, margin, and instrument availability.
17. Only then consider live mode with max order volume set very low.

## 21. Exness Notes

Expected areas to validate:

- Symbol suffixes such as `m`, `.m`, raw/standard variants.
- Crypto and metals contract sizes.
- Account type differences: Standard, Raw Spread, Zero, Pro.
- Commission model for raw/zero accounts.
- High leverage and dynamic margin rules.
- Stop level/freeze level by symbol.

Do not assume `EURUSD` and `XAUUSD` have the same suffix or lot rules across Exness account types.

## 22. IC Markets Notes

Expected areas to validate:

- Raw vs Standard account commission/spread differences.
- Symbol names and suffixes may differ by server/account.
- Metals and indices contract size/tick value.
- Fill policy and slippage behavior.
- Demo vs live server differences.

Do not reuse Exness symbol metadata for IC Markets.

## 23. Manual QA Matrix

Run this matrix for every broker profile:

| Scenario | Expected |
|---|---|
| Bridge disabled | Web simulator still works. |
| Wrong password | Readiness false, no live commands. |
| Wrong server | Readiness false. |
| Read-only login | Readiness false or trade blocked. |
| Missing symbol | Order blocked before MT5 send. |
| Disabled symbol | Order blocked. |
| Invalid lot step | Order rejected. |
| No SL while required | Order rejected. |
| Spread too high | Order rejected. |
| Insufficient margin | Order rejected. |
| Dry-run order | No broker position created. |
| Demo market order | Execution report + position snapshot. |
| Demo pending order | Pending order snapshot. |
| SL/TP modify | Execution report + updated position. |
| Close position | Position removed only after MT5 event. |
| Bridge restart | Fresh snapshots before new commands. |
| Duplicate clientOrderId | No duplicate broker order. |

## 24. Rollback

Immediate rollback:

```env
NEXT_PUBLIC_MT5_BRIDGE_ENABLED=false
MT5_BRIDGE_ENABLED=false
MT5_BRIDGE_ALLOW_LIVE=false
MT5_BRIDGE_DRY_RUN=true
```

Operational rollback:

- Stop bridge process.
- Disable EA/Algo Trading if using an EA adapter.
- Confirm open trades directly inside MT5.
- Set every account profile `enabled=false`.
- Use web terminal simulator mode only.

## 25. Acceptance Criteria

- Adding Exness, IC Markets, or another MT5 broker does not require React changes.
- Broker credentials are bridge-only and never exposed to the browser.
- Every broker account starts disabled and dry-run.
- Symbol mapping is verified against live MT5 metadata at bridge startup.
- Lot sizing uses broker tick value/contract size, not chart assumptions.
- Risk guards run bridge-side before every command.
- MT5/broker snapshots are the source of truth.
- Every command is audited and idempotent.
- Simulator mode remains unaffected.
- Live mode requires explicit account owner action and successful demo validation.
