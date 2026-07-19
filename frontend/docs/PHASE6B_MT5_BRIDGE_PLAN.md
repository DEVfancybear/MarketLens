# PHASE 6B MT5 BRIDGE PLAN

_Created 2026-07-01. Updated 2026-07-20. Scope: detailed implementation plan for MT5 bridge
integration. The consumer path uses a packaged Windows Connector with backend pairing tickets;
the Node/Python source bridges remain development tools._

## 1. Goal

Phase 6B adds a live-execution path through the packaged loopback Windows MT5 Connector while
preserving the current simulator as the default and safest mode.

The frontend must be able to:

- Connect to an MT5 bridge without storing broker credentials in the browser.
- Display account, margin, equity, open positions, pending orders, symbol metadata, and connection
  health.
- Route orders through either the simulator or MT5 based on an explicit execution mode.
- Send live commands only when the bridge is connected and the user confirms the action.
- Keep all simulator workflows working when MT5 is disabled, missing, disconnected, or rejected.

## 2. Current Codebase Seams

| Existing area | File | Phase 6B use |
|---|---|---|
| Simulator source of truth | `src/store/tradeStore.ts` | Remains unchanged for simulator mode. |
| Order form | `src/components/trade/OrderTicket.tsx` | Adds execution-mode routing and live confirmation. |
| Trade panel shell | `src/components/trade/TradePanel.tsx` | Hosts MT5 connection/account/diagnostics UI. |
| Position table | `src/components/trade/PositionsTable.tsx` | Can switch between simulator positions and MT5 positions. |
| Trade chart levels | `src/components/trade/TradeLevels.tsx` | Later renders MT5 live positions/SL/TP when mode is MT5. |
| Global runtime | `src/components/layout/GlobalRuntime.tsx` | Hydrates per-user verification and mounts the bridge runtime. |
| Toast/log channels | `src/store/toastStore.ts`, `src/store/uiStore.ts` | Surface rejected orders, disconnects, and command results. |
| Market symbols | `src/services/market-data/symbols.ts` | Provides chart symbols; Phase 6B adds broker-symbol mapping. |

## 3. Non-Goals

- Do not embed MT5 login, broker password, investor password, or bridge private keys in browser code.
- Do not remove the simulator.
- Do not route live orders automatically from existing drawing/position tools in the first pass.
- Do not make live trading the default mode.
- Do not mutate local MT5 positions optimistically as if they were confirmed fills.
- Do not implement a full MT5 terminal or Expert Advisor inside the Next app.

## 4. Topology

```text
Next browser client
  |
  | WebSocket JSON protocol + short-lived backend ticket
  v
Packaged Windows MT5 Connector (127.0.0.1:8787)
  |
  | MetaTrader5 adapter; auto-discovers an open matching terminal
  v
MT5 terminal + broker account
```

The bridge process owns:

- Backend-ticket validation and the verified login/server session boundary.
- Discovery and reconnection of the matching terminal that the user logged into through MT5.
- Broker symbol metadata.
- Order execution, modification, close, and rejection mapping.
- Account and position snapshots.
- It never receives the MT5 password saved by the backend.

The browser owns:

- UI, explicit execution mode, command confirmation, and command logs.
- A WebSocket client and typed protocol handling.
- Requesting a two-minute, one-use Connector ticket from the authenticated backend.
- Rendering the bridge state without pretending unconfirmed commands are fills.

## 5. Environment Variables

Add placeholders to `.env.example` during implementation:

```env
NEXT_PUBLIC_MT5_BRIDGE_URL=ws://127.0.0.1:8787
NEXT_PUBLIC_MT5_REQUIRE_CONFIRMATION=true
NEXT_PUBLIC_MT5_MAX_ORDER_VOLUME=1
```

There is no build-wide MT5 enable flag. `mt5EnabledAtom` is hydrated from the signed-in user's
backend integration only after **Connect & Verify MT5** succeeds.

There is no static browser token. `useMt5Bridge()` requests a two-minute, one-use ticket from
`POST /api/v1/settings/integrations/mt5/connector-ticket`. The packaged Connector validates and
consumes it through `POST /api/v1/settings/integrations/mt5/connector/validate` before exposing
account data or accepting commands.

## 6. Protocol

`MT5_BRIDGE_PROTOCOL.md` now defines the Phase 6B browser-to-bridge contract. Keep it versioned
and stable before the UI starts sending live commands.

### 6.1 Message Envelope

```ts
type Mt5MessageDirection = 'client' | 'bridge';

interface Mt5Message<T = unknown> {
  id?: string;       // required for command request/ack correlation
  type: string;      // e.g. "order.place"
  version: 1;
  ts: number;        // unix ms
  payload: T;
}
```

### 6.2 Connection Messages

| Type | Direction | Payload | Notes |
|---|---|---|---|
| `hello` | bridge -> client | `{ bridgeId, version, serverTime }` | Sent after socket open. |
| `auth.request` | client -> bridge | `{ token, clientName }` | Token is a short-lived, one-use backend Connector ticket. |
| `auth.ok` | bridge -> client | `{ sessionId, expiresAt? }` | Client can subscribe after this. |
| `auth.reject` | bridge -> client | `{ reason }` | Client goes to error state. |
| `heartbeat` | both | `{ ts }` | Every 5-10s; stale after 20s. |
| `error` | bridge -> client | `{ code, message, requestId? }` | Must never be silently ignored. |

### 6.3 Snapshot Messages

| Type | Direction | Payload |
|---|---|---|
| `account.snapshot` | bridge -> client | `Mt5AccountSnapshot` |
| `positions.snapshot` | bridge -> client | `{ positions: Mt5Position[] }` |
| `positions.update` | bridge -> client | `{ position: Mt5Position, action: 'upsert' | 'remove' }` |
| `orders.snapshot` | bridge -> client | `{ orders: Mt5PendingOrder[] }` |
| `orders.update` | bridge -> client | `{ order: Mt5PendingOrder, action: 'upsert' | 'remove' }` |
| `symbol.info` | bridge -> client | `Mt5SymbolInfo` |

### 6.4 Command Messages

| Type | Direction | Payload |
|---|---|---|
| `order.place` | client -> bridge | `Mt5OrderRequest` |
| `order.modify` | client -> bridge | `Mt5ModifyRequest` |
| `order.close` | client -> bridge | `Mt5CloseRequest` |
| `order.closeAll` | client -> bridge | `Mt5CloseAllRequest` |
| `order.cancel` | client -> bridge | `Mt5CancelRequest` |
| `order.ack` | bridge -> client | `{ requestId, clientOrderId, acceptedAt }` |
| `order.reject` | bridge -> client | `{ requestId, clientOrderId?, code, message }` |
| `execution.report` | bridge -> client | `Mt5ExecutionReport` |

Command behavior:

- `order.ack` means the bridge accepted the command for processing, not that the broker filled it.
- `execution.report` is the broker outcome.
- Position state changes only from snapshots/updates/execution reports.
- Every command must include `clientOrderId` for idempotency.

## 7. Types

Add `src/types/mt5.ts`.

```ts
export type ExecutionMode = 'simulator' | 'mt5';

export type Mt5ConnectionStatus =
  | 'disabled'
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'stale'
  | 'error';

export interface Mt5AccountSnapshot {
  accountId: string;
  broker: string;
  server: string;
  currency: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel?: number;
  leverage: number;
  tradeAllowed: boolean;
  updatedAt: number;
}

export interface Mt5SymbolInfo {
  chartSymbol: string;
  brokerSymbol: string;
  digits: number;
  point: number;
  lotStep: number;
  minLot: number;
  maxLot: number;
  brokerMaxLot?: number;
  bridgeMaxLot?: number;
  maxLotReason?: 'broker' | 'bridge';
  tickSize?: number;
  tickValue?: number;
  stopLevel?: number;
  freezeLevel?: number;
  minStopDistance?: number;
  tradeMode: 'disabled' | 'longOnly' | 'shortOnly' | 'full';
  updatedAt: number;
}

export interface Mt5Position {
  ticket: string;
  symbol: string;
  brokerSymbol: string;
  side: 'long' | 'short';
  volume: number;
  openPrice: number;
  currentPrice: number;
  sl?: number;
  tp?: number;
  profit: number;
  swap?: number;
  commission?: number;
  magic?: number;
  comment?: string;
  openedAt: number;
  updatedAt: number;
}

export interface Mt5OrderRequest {
  clientOrderId: string;
  chartSymbol: string;
  brokerSymbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop';
  volume: number;
  price?: number;
  marketPrice?: number;
  sl?: number;
  tp?: number;
  deviationPoints?: number;
  comment?: string;
}
```

## 8. Frontend Modules To Add

| File | Responsibility |
|---|---|
| `src/types/mt5.ts` | Shared MT5 client types. |
| `src/services/mt5/protocol.ts` | Message builders, guards, constants, command ids. |
| `src/services/mt5/Mt5BridgeClient.ts` | WebSocket lifecycle, reconnect, heartbeat, request correlation. |
| `src/store/mt5Store.ts` | Jotai atoms for mode, connection, account, positions, orders, symbol info, logs. |
| `src/hooks/useMt5Bridge.ts` | Mount/unmount bridge client and dispatch incoming messages into atoms. |
| `src/components/trade/ExecutionModeSwitch.tsx` | Simulator/MT5 segmented control with live warning. |
| `src/components/trade/Mt5ConnectionPanel.tsx` | Connect/disconnect, status, account summary, heartbeat/error. |
| `src/components/trade/LiveOrderConfirmDialog.tsx` | Required confirmation before live place/close/closeAll. |
| `src/components/trade/Mt5CommandLog.tsx` | Compact diagnostics for sent/ack/reject/execution messages. |
| `frontend/scripts/mock-mt5-bridge.mjs` | Local WebSocket mock bridge for deterministic frontend testing. |
| `src/services/mt5/connectorDownload.ts` | Stable URL for the packaged Windows Connector download. |

## 9. Existing Modules To Modify

| File | Change |
|---|---|
| `src/components/layout/GlobalRuntime.tsx` | Mount `useMt5Bridge()` after existing runtimes. |
| `src/components/trade/TradePanel.tsx` | Add connection panel and execution mode switch. |
| `src/components/trade/OrderTicket.tsx` | Build simulator `OrderRequest` or MT5 `Mt5OrderRequest`. |
| `src/components/trade/PositionsTable.tsx` | Read simulator positions or MT5 positions based on execution mode. |
| `src/components/trade/TradeLevels.tsx` | Render MT5 live positions when mode is MT5. |
| `src/store/tradeStore.ts` | No behavior change required; keep simulator isolated. |
| `.env.example` | Add loopback bridge URL, max volume, and confirmation defaults. |
| `docs/HANDOFF.md` | Update next action and runtime notes after implementation. |
| `docs/CHANGELOG.md` | Record each milestone. |

## 10. Store Design

Use `mt5Store.ts` instead of extending `tradeStore.ts` too early. The simulator and bridge have
different truth sources and failure modes.

State atoms:

- `executionModeAtom: ExecutionMode`
- `mt5EnabledAtom`
- `mt5StatusAtom`
- `mt5AccountAtom`
- `mt5PositionsAtom`
- `mt5PendingOrdersAtom`
- `mt5SymbolInfoAtom`
- `mt5LastHeartbeatAtom`
- `mt5LastErrorAtom`
- `mt5CommandLogAtom`
- `mt5PendingCommandsAtom`

Write atoms:

- `setExecutionModeAtom`
- `setMt5StatusAtom`
- `applyMt5MessageAtom`
- `placeMt5OrderAtom`
- `modifyMt5OrderAtom`
- `closeMt5PositionAtom`
- `closeAllMt5Atom`
- `cancelMt5OrderAtom`
- `clearMt5LogAtom`

The raw WebSocket client should live in `Mt5BridgeClient`, not inside atoms.

## 11. Bridge Client Behavior

`Mt5BridgeClient` should:

- Connect only after the current signed-in user has a verified MT5 integration.
- Connect to `NEXT_PUBLIC_MT5_BRIDGE_URL`.
- Require every bridge account snapshot to match the verified login and broker server before a
  live command can be sent.
- Send `auth.request` after `hello`.
- Reconnect with exponential backoff: 1s, 2s, 5s, 10s, max 30s.
- Send heartbeat every 5s after auth.
- Mark status `stale` when heartbeat is older than 20s.
- Correlate commands by `id`.
- Timeout commands after 10s if no ack/reject arrives.
- Never throw through React render; all errors go to atoms/logs.

## 12. Order Routing

Simulator mode:

- `OrderTicket` continues to call `placeOrderAtom`.
- Existing risk sizing and journal behavior stay unchanged.

MT5 mode:

1. Validate bridge status is `connected`.
2. Resolve chart symbol to broker symbol.
3. Validate symbol info exists and trade mode allows the side.
4. Validate volume against bridge-provided `minLot`/`maxLot`/`lotStep`, and validate SL/TP direction
   against side before sending.
   - In MT5 mode, an empty Lot field uses risk-based auto sizing.
   - A filled Lot field sends the manual MT5 lot value and must still pass min/max/step and bridge
     risk guards.
5. Show `LiveOrderConfirmDialog`.
6. Send `order.place` with `clientOrderId`.
7. Show pending command in UI.
8. On `order.ack`, keep pending state.
9. On `execution.report` and position snapshot/update, update MT5 state.
10. On `order.reject`, show toast/log and clear pending state.

No local synthetic position should be inserted before bridge confirmation.

## 13. Symbol Mapping

Add a mapping layer that can be replaced by bridge-provided `symbol.info`.

Initial config shape:

```ts
interface Mt5SymbolMapping {
  chartSymbol: string;
  brokerSymbol: string;
  digits?: number;
  lotStep?: number;
  minLot?: number;
  maxLot?: number;
}
```

Default examples:

| Chart symbol | Candidate broker symbols |
|---|---|
| `BTCUSDT` | `BTCUSD`, `BTCUSDm`, `BTCUSD.r` |
| `ETHUSDT` | `ETHUSD`, `ETHUSDm` |
| `EURUSD` | `EURUSD`, `EURUSDm`, `EURUSD.pro` |
| `GBPUSD` | `GBPUSD`, `GBPUSDm` |
| `XAUUSD` | `XAUUSD`, `GOLD`, `XAUUSDm` |

The bridge should eventually be the source of truth for available broker symbols.

## 14. Risk Controls

Required before any real account usage:

- Simulator remains default.
- MT5 mode is visibly labeled as live or demo.
- Live order confirmation is enabled by default.
- Close-all requires a separate destructive confirmation.
- Bridge disconnected/stale states disable live commands.
- Missing symbol info disables live commands.
- Max volume guard is enforced client-side and should also be enforced by bridge.
- Duplicate `clientOrderId` is treated idempotently by bridge.
- Every command, ack, reject, and execution report is logged.
- First validation must use demo account only.

## 15. Implementation Milestones

### Milestone 0 - Protocol And Mock Bridge

- Create `MT5_BRIDGE_PROTOCOL.md`. **Done 2026-07-02.**
- Add `src/types/mt5.ts`. **Done 2026-07-02.**
- Add `scripts/mock-mt5-bridge.mjs`. **Done 2026-07-02.**
- Add env placeholders. **Done 2026-07-02.**

Exit criteria:

- Mock bridge can emit hello/auth/account/positions.
- No frontend behavior changes yet.

### Milestone 1 - Client And Store

- Add `Mt5BridgeClient`. **Done 2026-07-02.**
- Add `mt5Store.ts`. **Done 2026-07-02.**
- Add `useMt5Bridge()`. **Done 2026-07-02.**
- Mount the runtime and replace the original build-wide gate with per-user verification.
  **Done 2026-07-19.**

Exit criteria:

- App builds with MT5 unverified for the current user.
- App connects to the mock bridge after that user is verified.
- Account and positions snapshots update atoms.

### Milestone 2 - Connection UI

- Add `Mt5ConnectionPanel`. **Done 2026-07-02.**
- Add `ExecutionModeSwitch`. **Done 2026-07-02.**
- Add command/diagnostics log. **Done 2026-07-02.**
- Add status and heartbeat display. **Done 2026-07-02.**

Exit criteria:

- User can clearly see simulator vs MT5 mode.
- Disconnect/reconnect/auth reject states are visible.

### Milestone 3 - Order Placement

- Wire `OrderTicket` routing. **Done 2026-07-02.**
- Add `LiveOrderConfirmDialog`. **Done 2026-07-02.**
- Add `order.place` command with ack/reject handling. **Done 2026-07-02.**

Exit criteria:

- Simulator order placement is unchanged.
- MT5 order placement works against mock bridge.
- Disconnected MT5 cannot place orders.

### Milestone 4 - Position Sync And Close

- Render MT5 positions in `PositionsTable`. **Done 2026-07-02.**
- Add `order.close`, `order.closeAll`, and optional partial close. **Partial 2026-07-02: full
  close and close-all commands implemented; partial close UI remains deferred.**
- Add close-all destructive confirmation.

Exit criteria:

- MT5 positions survive reconnect via snapshot.
- Close commands update only after bridge events.

### Milestone 5 - Modify SL/TP And Chart Levels

- Add `order.modify` for SL/TP.
- Render MT5 live SL/TP levels. **Done 2026-07-02.**
- Keep pending modify state visible until ack/report.

Exit criteria:

- SL/TP updates round-trip through mock bridge.
- Chart levels match bridge snapshots.

### Milestone 6 - Real Bridge Validation

- Connect to real MT5 bridge on demo account.
- Validate symbol mapping, lot step, volume limits, price precision.
- Validate market order, SL/TP modify, close, reconnect.

Exit criteria:

- Demo account workflow is stable.
- Failure modes are visible and non-destructive.

## 16. Testing

Automated checks after every milestone:

```bash
npm run typecheck
npm run lint
npm run build
```

Mock bridge manual checks:

- User unverified.
- Bridge URL missing.
- Connect success.
- Auth reject.
- Socket close and reconnect.
- Heartbeat stale.
- Account snapshot.
- Position snapshot.
- Order ack.
- Order reject.
- Execution report fill.
- Close position.
- Close all confirmation.

Real bridge demo checks:

- Demo account only.
- Symbol info loaded.
- Min/max lot validation.
- Market buy/sell with small volume.
- SL/TP modify.
- Full close.
- Bridge restart and reconnect.

## 17. Rollback

- Invalidate the user's verification by changing/clearing the saved MT5 credential; stop the
  execution bridge for a system-wide rollback.
- Keep `executionModeAtom` defaulting to `simulator`.
- Keep MT5 selection disabled for unverified users.
- Do not delete simulator state or journal logic.
- If bridge protocol changes, reject unsupported `version` instead of best-effort parsing.

## 18. Acceptance Criteria

- App builds and runs without MT5 env.
- Simulator mode behaves exactly as before.
- MT5 mode is opt-in and visually obvious.
- Bridge state is the source of truth for account, positions, and execution outcomes.
- Live commands require connected bridge state and confirmation.
- Risk guards block missing symbol info, stale bridge, invalid lot size, and max volume violations.
- All bridge failures are visible in UI/logs.
- Protocol and manual test docs are complete before real-account testing.

## 19. FTMO Copy Trading Extension

For the specific requirement "place an order on the web terminal and copy it into the user's FTMO
MT5 account", continue from:

- `PHASE6B_FTMO_COPY_TRADING_PLAN.md`

That plan adds bridge-only FTMO credentials, FTMO account readiness checks, broker-symbol and lot
mapping, loss/risk guards, dry-run validation, audit logging, and a staged path from mock bridge to
FTMO demo/evaluation execution. FTMO credentials must stay in the bridge process and must never be
stored in browser code or `NEXT_PUBLIC_*` variables.

## 20. Multi-Broker MT5 Copy Trading Extension

For copying web terminal orders to regular MT5 broker accounts such as Exness, IC Markets,
Pepperstone, or other MT5-compatible brokers, continue from:

- `PHASE6B_MULTI_BROKER_MT5_COPY_TRADING_PLAN.md`

That plan generalizes the FTMO bridge into broker/account profiles, symbol discovery, broker-specific
lot sizing, execution policy, dry-run validation, account routing, audit logging, and staged demo
then live hardening. Broker credentials must remain bridge-only and must never be exposed through
browser code or `NEXT_PUBLIC_*` variables.
