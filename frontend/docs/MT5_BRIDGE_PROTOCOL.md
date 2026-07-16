# MT5 BRIDGE PROTOCOL

_Created 2026-07-02. Scope: Phase 6B browser-to-bridge contract for MT5 live execution._

## 1. Purpose

This document defines the first stable protocol contract between the Next browser client and an
external MT5 Bridge Service.

The browser never connects directly to MT5 and never stores broker credentials. The bridge owns the
MT5 terminal session, broker login, symbol metadata, order execution, and account snapshots. The
browser owns UI state, explicit execution mode, risk guards, confirmation, and diagnostics.

Phase 6B implementation should treat this document as the contract before wiring live order UI.

## 2. Transport

Initial transport:

```text
Browser client
  -> WebSocket JSON messages
  -> MT5 Bridge Service
  -> MT5 terminal / broker account
```

Default local URL:

```env
NEXT_PUBLIC_MT5_BRIDGE_URL=ws://localhost:8787
```

Rules:

- Messages are UTF-8 JSON objects.
- Unknown message `type` values are ignored and logged.
- Unsupported `version` values are rejected and logged.
- The bridge sends `hello` first after socket open.
- The client sends `auth.request` after `hello`.
- The client subscribes implicitly after `auth.ok`; no live command is allowed before auth succeeds.
- Heartbeats run every 5 seconds after auth; a session is stale after 20 seconds without bridge
  heartbeat.

## 3. Message Envelope

```ts
export interface Mt5Message<T = unknown> {
  id?: string;
  type: string;
  version: 1;
  ts: number;
  payload: T;
}
```

Field rules:

| Field | Required | Notes |
|---|---:|---|
| `id` | Commands only | Correlates requests with `order.ack`, `order.reject`, and timeouts. |
| `type` | Yes | Names the protocol message. |
| `version` | Yes | Must be `1` for Phase 6B. |
| `ts` | Yes | Unix milliseconds from sender clock. |
| `payload` | Yes | Use `{}` when no payload is needed. |

## 4. Connection State Machine

Client status values:

```ts
export type Mt5ConnectionStatus =
  | 'disabled'
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'stale'
  | 'error';
```

Reconnect backoff:

```text
1s -> 2s -> 5s -> 10s -> 30s max, with jitter
```

Transitions:

| From | Event | To |
|---|---|---|
| `disabled` | `NEXT_PUBLIC_MT5_BRIDGE_ENABLED=true` | `disconnected` |
| `disconnected` | connect requested | `connecting` |
| `connecting` | `hello` received | `authenticating` |
| `authenticating` | `auth.ok` received | `connected` |
| `authenticating` | `auth.reject` received | `error` |
| `connected` | no bridge heartbeat for 20s | `stale` |
| `connected`/`stale` | socket close | `reconnecting` |
| any enabled state | manual disconnect | `disconnected` |

## 5. Connection Messages

### `hello`

Bridge to client.

```json
{
  "type": "hello",
  "version": 1,
  "ts": 1783000000000,
  "payload": {
    "bridgeId": "local-mt5-bridge",
    "bridgeVersion": "0.1.0",
    "serverTime": 1783000000000,
    "accountMode": "demo"
  }
}
```

### `auth.request`

Client to bridge.

```json
{
  "id": "req_001",
  "type": "auth.request",
  "version": 1,
  "ts": 1783000000100,
  "payload": {
    "clientName": "smc-trading-terminal",
    "token": "optional-local-dev-token"
  }
}
```

Production should prefer a short-lived server-issued session token. Static
`NEXT_PUBLIC_MT5_BRIDGE_TOKEN` is acceptable only for local development.

### `auth.ok`

Bridge to client.

```json
{
  "id": "req_001",
  "type": "auth.ok",
  "version": 1,
  "ts": 1783000000200,
  "payload": {
    "sessionId": "sess_abc",
    "expiresAt": 1783003600000
  }
}
```

### `auth.reject`

Bridge to client.

```json
{
  "id": "req_001",
  "type": "auth.reject",
  "version": 1,
  "ts": 1783000000200,
  "payload": {
    "reason": "invalid_token"
  }
}
```

### `heartbeat`

Both directions.

```json
{
  "type": "heartbeat",
  "version": 1,
  "ts": 1783000005000,
  "payload": {
    "ts": 1783000005000
  }
}
```

### `error`

Bridge to client.

```json
{
  "type": "error",
  "version": 1,
  "ts": 1783000000500,
  "payload": {
    "code": "UNSUPPORTED_VERSION",
    "message": "Protocol version 2 is not supported",
    "requestId": "req_123"
  }
}
```

## 6. Snapshot Messages

### `account.snapshot`

Bridge to client.

```ts
export interface Mt5AccountSnapshot {
  accountId: string;
  broker: string;
  server: string;
  mode: 'demo' | 'live' | 'unknown';
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
```

### `positions.snapshot`

Bridge to client.

```ts
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

export interface Mt5PositionsSnapshot {
  positions: Mt5Position[];
}
```

### `positions.update`

Bridge to client.

```ts
export interface Mt5PositionUpdate {
  action: 'upsert' | 'remove';
  position: Mt5Position;
}
```

For `remove`, `ticket`, `symbol`, `brokerSymbol`, and `updatedAt` must still be present.

### `orders.snapshot`

Bridge to client.

```ts
export interface Mt5PendingOrder {
  ticket: string;
  symbol: string;
  brokerSymbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'stop';
  volume: number;
  price: number;
  sl?: number;
  tp?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Mt5OrdersSnapshot {
  orders: Mt5PendingOrder[];
}
```

### `orders.update`

Bridge to client.

```ts
export interface Mt5OrderUpdate {
  action: 'upsert' | 'remove';
  order: Mt5PendingOrder;
}
```

### `symbol.info`

Bridge to client.

```ts
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
  tickValueLoss?: number;
  tickValueProfit?: number;
  contractSize?: number;
  calcMode?: string | number;
  currencyBase?: string;
  currencyProfit?: string;
  currencyMargin?: string;
  marginInitial?: number;
  marginMaintenance?: number;
  marginHedged?: number;
  spread?: number;
  stopLevel?: number;
  freezeLevel?: number;
  minStopDistance?: number;
  tradeMode: 'disabled' | 'longOnly' | 'shortOnly' | 'full';
  updatedAt: number;
}
```

The frontend must block MT5 order placement when symbol info is missing, stale, disabled, outside
lot limits, or incompatible with the requested side.

`maxLot` is the effective order cap the browser must obey. It is derived from
`min(brokerMaxLot, bridgeMaxLot)`. If `maxLotReason` is `broker`, MT5 reported a broker/account
symbol limit below the configured bridge cap. If it is `bridge`, `FTMO_BRIDGE_MAX_ORDER_VOLUME` is
the active cap.

`stopLevel` and `minStopDistance` come from MT5 symbol metadata. Clients should reject Buy orders
unless SL is below entry and TP above entry, and reject Sell orders unless SL is above entry and TP
below entry. The bridge revalidates the same rule against broker bid/ask before `order_check`.

`tickValueLoss` and `tickValueProfit` are MT5's direction-specific per-tick values in account
currency. `tickValue` is retained for older bridges. The Position Sizer adapter uses tick-size /
contract-size metadata for non-Forex calculation modes when a reliable tick value is unavailable.
The browser includes round-trip commission in its estimate, but the bridge's server-side risk guard
and broker response remain authoritative.

### `risk.snapshot`

Bridge to client. The snapshot is optional; when present it supplies portfolio-risk context. The
order ticket currently uses `openRiskAtStops` for its `balanceMinusRisk` account basis, while the
bridge enforces the remaining daily, maximum-loss, and per-trade limits.

```ts
export interface Mt5RiskSnapshot {
  accountSize?: number;
  accountSizeSource?: 'fixed' | 'equity';
  dailyLossLimit?: number;
  maxLossLimit?: number;
  maxRiskPerTrade?: number;
  dailyLossUsed?: number;
  dailyLossRemaining?: number;
  maxLossRemaining?: number;
  openRiskAtStops?: number;
  dailyOrderCount?: number;
  maxDailyOrders?: number;
  canTrade?: boolean;
  reason?: string | null;
  updatedAt?: number;
}
```

## 7. Command Messages

Every command must include:

- `id` in the envelope.
- `clientOrderId` in the payload when the command changes broker state.
- Current `chartSymbol` and resolved `brokerSymbol` where applicable.

`order.ack` means the bridge accepted the command for processing. It does not mean the broker filled
the order. Broker outcomes arrive through `execution.report` and position/order snapshots.

The browser may derive `volume` from risk-based sizing or from a manual MT5 Lot input. The bridge
must treat `volume` as the requested lot and revalidate it against broker min/max/step and risk
limits before execution.

### `order.place`

Client to bridge.

```ts
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

For market orders, `price` is omitted because MT5 executes at broker bid/ask, but the browser must
send `marketPrice` from the active chart so the bridge can estimate stop risk before execution. The
bridge should reject market orders that have neither `price` nor `marketPrice` available for risk
calculation.

For all order types, SL/TP direction must match the side: Buy uses SL below entry and TP above
entry; Sell uses SL above entry and TP below entry. Broker stop-distance rules still apply and may
be stricter than the chart-side estimate.

### `order.modify`

Client to bridge.

```ts
export interface Mt5ModifyRequest {
  clientOrderId: string;
  ticket: string;
  target: 'position' | 'pendingOrder';
  sl?: number;
  tp?: number;
  price?: number;
}
```

### `order.close`

Client to bridge.

```ts
export interface Mt5CloseRequest {
  clientOrderId: string;
  ticket: string;
  volume?: number;
  deviationPoints?: number;
}
```

`volume` omitted means full close.

### `order.closeAll`

Client to bridge.

```ts
export interface Mt5CloseAllRequest {
  clientOrderId: string;
  chartSymbol?: string;
  brokerSymbol?: string;
  side?: 'long' | 'short';
  deviationPoints?: number;
}
```

The UI must require a separate destructive confirmation before sending this command.

### `order.cancel`

Client to bridge.

```ts
export interface Mt5CancelRequest {
  clientOrderId: string;
  ticket: string;
}
```

### `order.ack`

Bridge to client.

```ts
export interface Mt5OrderAck {
  requestId: string;
  clientOrderId: string;
  acceptedAt: number;
}
```

### `order.reject`

Bridge to client.

```ts
export interface Mt5OrderReject {
  requestId: string;
  clientOrderId?: string;
  code: string;
  message: string;
}
```

### `execution.report`

Bridge to client.

```ts
export interface Mt5ExecutionReport {
  requestId?: string;
  clientOrderId?: string;
  ticket?: string;
  dealId?: string;
  symbol: string;
  brokerSymbol: string;
  status: 'filled' | 'partiallyFilled' | 'rejected' | 'cancelled' | 'modified' | 'closed';
  side?: 'buy' | 'sell';
  volume?: number;
  price?: number;
  profit?: number;
  code?: string;
  message?: string;
  executedAt: number;
}
```

## 8. Error Codes

Initial bridge error codes:

| Code | Meaning |
|---|---|
| `AUTH_REQUIRED` | Command sent before auth. |
| `AUTH_REJECTED` | Token/session rejected. |
| `UNSUPPORTED_VERSION` | Message version is not supported. |
| `INVALID_MESSAGE` | JSON or payload shape is invalid. |
| `UNKNOWN_SYMBOL` | Broker symbol cannot be resolved. |
| `TRADE_DISABLED` | Symbol/account cannot trade. |
| `INVALID_VOLUME` | Volume violates min/max/lot step. |
| `MAX_VOLUME_EXCEEDED` | Request exceeds bridge or client max volume. |
| `MARKET_CLOSED` | Broker market is closed. |
| `BROKER_REJECTED` | Broker rejected the command. |
| `TIMEOUT` | Bridge or broker did not respond in time. |
| `DUPLICATE_CLIENT_ORDER_ID` | Duplicate idempotency key with incompatible payload. |

## 9. Client Risk Gates

The frontend must block live commands unless all are true:

- `NEXT_PUBLIC_MT5_BRIDGE_ENABLED === 'true'`.
- Execution mode is explicitly `mt5`.
- Connection status is `connected`.
- Account is available and `tradeAllowed === true`.
- Symbol info exists for the active chart symbol.
- Symbol trade mode allows the requested side.
- Volume is within `minLot`, `maxLot`, and `lotStep`. The bridge-provided `maxLot` already
  includes broker `volume_max` and bridge `FTMO_BRIDGE_MAX_ORDER_VOLUME`.
- Confirmation is accepted when `NEXT_PUBLIC_MT5_REQUIRE_CONFIRMATION !== 'false'`.
- `closeAll` confirmation is accepted separately.

The bridge must enforce the same or stricter checks. Browser checks are UX and defense-in-depth,
not the only safety boundary.

## 10. Mock Bridge Requirements

`scripts/mock-mt5-bridge.mjs` should support deterministic frontend testing:

- Send `hello`, accept/reject auth, and heartbeat.
- Emit account, risk, positions, pending orders, and symbol info snapshots.
- Accept `order.place`, `order.modify`, `order.close`, `order.closeAll`, and `order.cancel`.
- Toggle command behavior between ack, reject, delayed execution report, and socket close.
- Preserve positions across reconnect during one mock process lifetime.

Manual scenarios:

- Disabled bridge.
- Missing bridge URL.
- Successful connect/auth.
- Auth reject.
- Heartbeat stale.
- Socket close and reconnect.
- Account snapshot update.
- Risk snapshot update, including `openRiskAtStops`.
- Empty and non-empty position snapshots.
- Market order ack plus fill report.
- Order reject.
- Modify SL/TP.
- Close one position.
- Close all with confirmation.

## 11. Rollback

Rollback is configuration-first:

```env
NEXT_PUBLIC_MT5_BRIDGE_ENABLED=false
```

The simulator remains the default execution mode. MT5 UI should hide or show disabled status when
the flag is off, and simulator order placement must remain unchanged.

## 12. Market Data History Scheduling

The chart data path uses the Go backend as the only browser-facing MT5 market-data API:

```text
Browser useMarketData()
  -> GET /api/v1/mt5/history
  -> Go mt5stream history scheduler/cache
  -> Python MT5 sidecar history.request
  -> MetaTrader5 copy_rates*
```

Rules for frontend maintainers:

- Chart candles must come from MT5 history/rates. Realtime ticks are only for watchlist quotes and
  latest-price labels; do not synthesize chart candles from bid/ask ticks.
- Pass an `AbortSignal` for symbol/timeframe history loads. Cleanup on symbol/timeframe change must
  abort the old request so the Go scheduler can drop queued stale work before it reaches MT5.
- Keep active-chart refresh small (`refresh=true`, latest bars only). The Go service returns cached
  candles immediately when possible and refreshes stale latest windows in the background.
- Left-edge pagination (`before`) is allowed to wait because it is user-driven and must load older
  bars, not reuse the latest-window cache.
- The Go service single-flights identical history requests and serializes bridge access because the
  Python sidecar keeps MT5 calls on one worker for terminal/thread safety.
