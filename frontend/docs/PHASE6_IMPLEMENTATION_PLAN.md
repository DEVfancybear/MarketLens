# PHASE 6 IMPLEMENTATION PLAN - Push Notifications + MT5 Bridge

_Created 2026-07-01. Scope: code plan for the next production milestone after Phase 5._

Implementation status:

- **Phase 6A - Push notifications:** implemented. See `PHASE6A_PUSH_NOTIFICATIONS.md`.
- **Phase 6A extension - Telegram/Discord alert channels:** implemented. See
  `PHASE6A_TELEGRAM_DISCORD_PLAN.md`.
- **Phase 6B - MT5 bridge:** partially implemented. The frontend MT5 store/client path and Node
  dry-run bridge exist; the Python bridge service lives under `backend/bridge/ftmo_mt5/`. Protocol
  contract remains in `MT5_BRIDGE_PROTOCOL.md`; detailed plan remains in
  `PHASE6B_MT5_BRIDGE_PLAN.md`.

## 1. Objective

Phase 6 turns the terminal from an in-browser simulator into an externally connected trading
workstation while keeping the existing simulator and alert engine stable.

The phase has two parallel workstreams:

1. **Phase 6A - Push notifications and external alert channels:** add Firebase Cloud Messaging
   (FCM) as a fourth alert delivery channel after toast, sound, and browser notifications, then
   extend the same alert delivery pipeline to server-side Telegram and Discord messages.
2. **Phase 6B - MT5 bridge:** add a bridge-client architecture for account sync and real order
   routing through an external MT5 Bridge Service.

Both workstreams must be feature-flagged and disabled by default until configured.

## 2. Current Seams To Reuse

| Existing seam | File | Phase 6 use |
|---|---|---|
| Alert dispatch fan-out | `src/services/notifications/notify.ts` | Add push channel without changing alert evaluation. |
| Alert settings persistence | `src/store/alertStore.ts` | Add global push setting and per-alert push flag. |
| Alert runtime | `src/hooks/useAlertEngine.ts` | Keep trigger semantics unchanged; only dispatch grows. |
| Global runtime mount | `src/components/layout/GlobalRuntime.tsx` | Mount push token hydration and MT5 bridge runtime hooks. |
| Trade simulator store | `src/store/tradeStore.ts` | Keep simulator as fallback execution mode. |
| Order ticket UI | `src/components/trade/OrderTicket.tsx` | Route orders either to simulator or MT5 bridge. |
| Position visualization | `src/components/chart/drawing/tools/plugins/PositionTool.ts` | Later consume bridge positions for live entry/SL/TP overlays. |

## 3. Non-Goals

- Do not store broker passwords, investor passwords, API secrets, service account keys, or private
  Firebase credentials in the browser.
- Do not remove or weaken the existing simulator path.
- Do not send live orders without an explicit user-visible execution mode and confirmation guard.
- Do not make the browser talk directly to an MT5 terminal. The browser only talks to a bridge API.
- Do not change alert trigger semantics while adding push delivery.
- Do not require Firebase or MT5 configuration for local development, build, or simulator mode.

## 4. Architecture Principles

- **Browser app stays secret-free.** Public Firebase config and public VAPID key can be exposed;
  private keys and MT5 credentials must stay in a server or bridge process.
- **Feature flags first.** The app must build and run with Phase 6 disabled.
- **Simulator remains the default.** MT5 mode is opt-in, visually obvious, and reversible.
- **Bridge is the source of truth in MT5 mode.** Local UI may show pending state, but positions,
  fills, and account equity come from bridge snapshots/events.
- **Commands are idempotent.** Every live order/modify/close command gets a `clientOrderId`.
- **Failure is explicit.** Connection loss, stale quotes, rejected orders, and token registration
  errors must be visible in UI and logged to a diagnostics panel.

## 5. Workstream 6A - Firebase Push Notifications

### 5.1 Target Behavior

- User enables push from Alert Center settings.
- App requests notification permission only from a user gesture.
- App registers an FCM token and persists token metadata.
- When an alert triggers, `deliverAlert()` sends existing toast/sound/browser notifications and,
  when enabled, sends a push notification.
- Push failures never block alert history, toast, sound, or browser notifications.

### 5.2 Data Model Changes

Extend alert settings and alert channel flags:

```ts
interface AlertSettings {
  sound: boolean;
  browser: boolean;
  push: boolean;
}

interface Alert {
  sound?: boolean;
  browser?: boolean;
  push?: boolean;
}

interface PushRegistration {
  token: string;
  permission: NotificationPermission;
  createdAt: number;
  updatedAt: number;
  error?: string;
}
```

Recommended storage:

- Keep alert channel preferences inside existing `alertStore`.
- Add push token state in a small dedicated atom module if token lifecycle becomes noisy:
  `src/store/notificationStore.ts`.
- Persist token metadata to local storage only if there is no server-side token registry yet.

### 5.3 New Files

| File | Responsibility |
|---|---|
| `src/services/firebase/client.ts` | Lazy Firebase app/messaging initialization. No private secrets. |
| `src/services/notifications/push.ts` | Register token, unregister token, send push request, capability checks. |
| `src/hooks/usePushNotifications.ts` | Hydrate token state, expose enable/disable/register actions. |
| `public/firebase-messaging-sw.js` | FCM service worker for background notifications. |
| `src/components/alerts/PushSettingsRow.tsx` | Alert Center push toggle/status UI. |

If the deployment supports Next API routes, add:

| File | Responsibility |
|---|---|
| `src/app/api/push/register/route.ts` | Register/update device token server-side. |
| `src/app/api/push/unregister/route.ts` | Remove device token. |
| `src/app/api/push/send/route.ts` | Server-only FCM send endpoint for alert dispatch. |

If this app is deployed as static-only, replace the API route plan with an external notification
service. The browser must not hold the FCM server key.

### 5.4 Environment Variables

Public browser-safe values:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_VAPID_KEY=
```

Server-only values, never exposed through `NEXT_PUBLIC_`:

```env
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
FIREBASE_PROJECT_ID=
```

Update `.env.example` with placeholders only.

### 5.5 Implementation Steps

1. Add types and settings defaults.
   - Update alert settings default to `{ sound: true, browser: false, push: false }`.
   - Add per-alert `push` default that follows global settings unless overridden.
   - Add migration guard for old persisted alert objects.

2. Add Firebase client bootstrap.
   - Lazy import Firebase modules so local builds work without runtime initialization.
   - Return a typed unsupported state when `window`, service workers, Notification API, or FCM is
     unavailable.

3. Add service worker registration.
   - Register `firebase-messaging-sw.js` from a user-triggered enable flow.
   - Avoid registering repeatedly on every render.
   - Surface service worker registration errors in Alert Center.

4. Add token lifecycle.
   - Request permission from Alert Center only.
   - Get token using `NEXT_PUBLIC_FIREBASE_VAPID_KEY`.
   - Register token with server/API when available.
   - Support disable/unregister and stale-token replacement.

5. Wire `deliverAlert()`.
   - Add push channel after browser notification dispatch.
   - Push channel must catch and report errors without throwing through alert trigger handling.
   - Include alert id, symbol, condition, target price, trigger price, and timestamp in payload.

6. Add Alert Center UI.
   - Show permission state: unsupported, default, granted, denied.
   - Show registration state: idle, registering, enabled, error.
   - Disable push toggle if permission is denied and provide a concise status message.

7. Add docs and manual test checklist.
   - Update `ALERT_ARCHITECTURE.md` after implementation.
   - Add setup notes for Firebase web app, VAPID key, and service worker behavior.

### 5.6 Push Acceptance Criteria

- Build works with no Firebase env vars.
- Push toggle is hidden or disabled gracefully when unsupported.
- Permission is requested only after user action.
- Triggered alerts still append history even if push delivery fails.
- Foreground alert dispatch shows toast/sound/browser as before.
- Background push works after token registration in a supported browser.
- Token unregister disables future push delivery for that browser.

## 6. Workstream 6B - MT5 Bridge Integration

The optional Phase 6A Telegram/Discord extension is implemented in
`PHASE6A_TELEGRAM_DISCORD_PLAN.md`.

### 6.1 Target Behavior

- User can connect the terminal to an external MT5 Bridge Service.
- The app shows MT5 account status, balance/equity/margin, open positions, and connection health.
- Order Ticket can route orders to simulator or MT5 mode.
- In MT5 mode, order placement/modification/closing goes through the bridge and waits for bridge
  acknowledgements/events.
- Simulator mode remains unchanged and available without MT5 configuration.

### 6.2 Proposed Topology

```text
Browser / Next client
  |
  | WebSocket or HTTP+SSE JSON protocol
  v
MT5 Bridge Service
  |
  | Local IPC / Python MetaTrader5 package / EA socket protocol
  v
MT5 Terminal + broker account
```

The bridge is a separate service. This repository should implement the browser client, state, UI,
and protocol docs. The bridge implementation can be built in this repo later or kept as a separate
process, but the browser contract must be explicit.

### 6.3 Protocol Contract

`MT5_BRIDGE_PROTOCOL.md` now defines the protocol contract for implementation.

Core message envelope:

```ts
interface Mt5Message<T = unknown> {
  id?: string;
  type: string;
  ts: number;
  payload: T;
}
```

Connection messages:

| Type | Direction | Purpose |
|---|---|---|
| `auth.request` | client -> bridge | Authenticate session token if configured. |
| `auth.ok` | bridge -> client | Auth accepted. |
| `auth.reject` | bridge -> client | Auth failed. |
| `heartbeat` | both | Keep connection alive and detect stale sessions. |
| `error` | bridge -> client | Protocol or bridge error. |

Account/market messages:

| Type | Direction | Purpose |
|---|---|---|
| `account.snapshot` | bridge -> client | Balance, equity, margin, leverage, currency. |
| `positions.snapshot` | bridge -> client | Full open-position snapshot. |
| `positions.update` | bridge -> client | Incremental open/modify/close update. |
| `orders.snapshot` | bridge -> client | Pending orders if supported. |
| `symbol.info` | bridge -> client | Broker symbol metadata, lot step, min/max lot, digits. |

Command messages:

| Type | Direction | Purpose |
|---|---|---|
| `order.place` | client -> bridge | Place market/limit/stop order. |
| `order.modify` | client -> bridge | Modify SL/TP or pending order price. |
| `order.close` | client -> bridge | Close one position partially or fully. |
| `order.closeAll` | client -> bridge | Emergency close by symbol/account filter. |
| `order.ack` | bridge -> client | Command accepted by bridge. |
| `order.reject` | bridge -> client | Command rejected before broker execution. |
| `execution.report` | bridge -> client | Broker fill/reject/cancel result. |

### 6.4 Types To Add

Add `src/types/mt5.ts`:

```ts
type Mt5ConnectionStatus =
  | 'disabled'
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'error';

interface Mt5AccountSnapshot {
  accountId: string;
  server: string;
  currency: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  leverage: number;
  updatedAt: number;
}

interface Mt5Position {
  ticket: string;
  symbol: string;
  side: 'long' | 'short';
  volume: number;
  openPrice: number;
  currentPrice: number;
  sl?: number;
  tp?: number;
  profit: number;
  swap?: number;
  commission?: number;
  openedAt: number;
  updatedAt: number;
}

interface Mt5OrderRequest {
  clientOrderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop';
  volume: number;
  price?: number;
  sl?: number;
  tp?: number;
  comment?: string;
}
```

### 6.5 New Frontend Files

| File | Responsibility |
|---|---|
| `src/services/mt5/Mt5BridgeClient.ts` | WebSocket client, reconnect, heartbeat, request/response matching. |
| `src/services/mt5/protocol.ts` | Message builders, validation helpers, protocol constants. |
| `src/store/mt5Store.ts` | Jotai atoms for connection status, account, positions, orders, logs. |
| `src/hooks/useMt5Bridge.ts` | Mount bridge client lifecycle from `GlobalRuntime`. |
| `src/components/trade/Mt5ConnectionPanel.tsx` | Connect/disconnect, status, account summary, errors. |
| `src/components/trade/ExecutionModeSwitch.tsx` | Simulator vs MT5 mode selector with explicit live warning. |
| `src/components/trade/LiveOrderConfirmDialog.tsx` | Required confirmation for live order placement. |
| `MT5_BRIDGE_PROTOCOL.md` | Protocol contract and bridge responsibilities. |

### 6.6 Existing Files To Modify

| File | Change |
|---|---|
| `src/components/layout/GlobalRuntime.tsx` | Mount `useMt5Bridge()` when bridge URL is configured. |
| `src/components/trade/OrderTicket.tsx` | Route submit through simulator or bridge based on execution mode. |
| `src/store/tradeStore.ts` | Keep simulator logic; optionally add execution-mode state if not split out. |
| `src/components/trade/TradePanel.tsx` | Show simulator positions or MT5 positions depending on mode. |
| `src/components/chart/TradeLevels.tsx` | Read live MT5 positions in MT5 mode. |
| `src/components/chart/drawing/tools/plugins/PositionTool.ts` | Later bind live positions to position visualization if needed. |
| `.env.example` | Add MT5 bridge env placeholders. |

### 6.7 Environment Variables

```env
NEXT_PUBLIC_MT5_BRIDGE_URL=ws://localhost:8787
NEXT_PUBLIC_MT5_BRIDGE_ENABLED=false
NEXT_PUBLIC_MT5_REQUIRE_CONFIRMATION=true
```

Optional browser-visible session token only if the bridge uses a local/dev token:

```env
NEXT_PUBLIC_MT5_BRIDGE_TOKEN=
```

Production authentication should prefer a server-issued short-lived session token, not a static
browser environment variable.

### 6.8 Store Design

Recommended atoms in `mt5Store.ts`:

- `mt5EnabledAtom`
- `mt5StatusAtom`
- `mt5AccountAtom`
- `mt5PositionsAtom`
- `mt5OrdersAtom`
- `mt5LastHeartbeatAtom`
- `mt5LastErrorAtom`
- `mt5CommandLogAtom`
- `executionModeAtom: 'simulator' | 'mt5'`
- Write atoms:
  - `connectMt5Atom`
  - `disconnectMt5Atom`
  - `placeMt5OrderAtom`
  - `modifyMt5OrderAtom`
  - `closeMt5PositionAtom`
  - `closeAllMt5Atom`

The store should not own the raw WebSocket object directly if it creates React lifecycle problems.
Keep the socket in `Mt5BridgeClient`, and let the hook/client update atoms through callbacks.

### 6.9 Order Routing Rules

Simulator mode:

- Existing `placeOrderAtom`, `closePositionAtom`, and `closeAllAtom` remain unchanged.
- UI behavior stays identical to Phase 5.

MT5 mode:

- `OrderTicket` creates `Mt5OrderRequest` with `clientOrderId`.
- User confirms live order in `LiveOrderConfirmDialog`.
- Bridge receives `order.place`.
- UI shows pending command state after `order.ack`.
- Positions update only from `positions.update`, `positions.snapshot`, or `execution.report`.
- Rejected commands show a toast and an MT5 log entry.
- SL/TP drag or edit sends `order.modify`; local chart should show pending state until confirmed.

### 6.10 Risk Controls

Required before enabling live mode:

- Simulator is default execution mode.
- MT5 mode uses a visible connected/live indicator.
- Confirmation dialog is required for place/close/close-all by default.
- `closeAll` requires a second confirmation in MT5 mode.
- Reject orders when bridge status is not `connected`.
- Reject orders when symbol mapping is missing or stale.
- Reject orders when quote age exceeds configured threshold.
- Enforce broker symbol metadata: digits, min lot, max lot, lot step.
- Add a client-side max order volume guard.
- Add command log entries for every live command and result.

### 6.11 Symbol Mapping

Broker symbols often differ from chart symbols:

| Chart symbol | Possible MT5 symbol |
|---|---|
| `BTCUSDT` | `BTCUSD`, `BTCUSDm`, `BTCUSD.r` |
| `EURUSD` | `EURUSD`, `EURUSDm`, `EURUSD.pro` |
| `XAUUSD` | `XAUUSD`, `GOLD`, `XAUUSDm` |

Add a mapping layer:

```ts
interface BrokerSymbolMapping {
  chartSymbol: string;
  brokerSymbol: string;
  digits: number;
  lotStep: number;
  minLot: number;
  maxLot: number;
}
```

Initial version can be configured locally and later hydrated from `symbol.info` bridge messages.

## 7. Implementation Milestones

### Milestone 0 - Audit and Contracts

- Confirm whether deployment supports Next API routes or needs an external push service.
- Create `MT5_BRIDGE_PROTOCOL.md`. **Done 2026-07-02.**
- Add `.env.example` placeholders for Firebase and MT5.
- Decide whether execution mode lives in `tradeStore` or a new `executionStore`.

Exit criteria:

- Protocol and environment docs are committed.
- No runtime behavior changes yet.

### Milestone 1 - Push Scaffold

- Add Firebase client bootstrap and push service.
- Add push settings types/defaults/migration.
- Add Alert Center push UI with unsupported/permission states.
- Add service worker file.

Exit criteria:

- `npm run typecheck`, `npm run lint`, and `npm run build` pass with no Firebase env vars.
- Push UI renders disabled or idle depending on browser capability.

### Milestone 2 - Push Delivery

- Add token registration/unregistration.
- Add push send path through API route or external service.
- Wire `deliverAlert()` push channel.
- Update `ALERT_ARCHITECTURE.md`.

Exit criteria:

- Foreground alert still behaves exactly like Phase 2.
- Push failure does not block alert history.
- Background push works in a supported browser when configured.

### Milestone 3 - MT5 Client + Store

- Add `src/types/mt5.ts`.
- Add `Mt5BridgeClient` with reconnect and heartbeat.
- Add `mt5Store.ts` atoms.
- Add `useMt5Bridge()` runtime hook.
- Add a local mock bridge for development testing if real bridge is not ready.

Exit criteria:

- App can connect/disconnect to a mock bridge.
- Account and position snapshots update atoms.
- Build passes with bridge disabled.

### Milestone 4 - MT5 UI

- Add `Mt5ConnectionPanel`.
- Add `ExecutionModeSwitch`.
- Add account summary and connection diagnostics in the trading panel.
- Add command log view or compact diagnostics section.

Exit criteria:

- User can see simulator vs MT5 mode clearly.
- MT5 unavailable state does not break simulator trading.

### Milestone 5 - Live Order Routing

- Route `OrderTicket` through simulator or MT5 mode.
- Add live confirmation dialog.
- Add `order.place` request and pending command handling.
- Add reject/error toasts and logs.

Exit criteria:

- Simulator orders remain unchanged.
- MT5 mode can place a mock bridge order and receive ack/reject.
- No live command can be sent while disconnected.

### Milestone 6 - Position Sync + Modify/Close

- Render MT5 positions in the trade panel.
- Add close position and close all bridge commands.
- Add SL/TP modify command.
- Add chart overlay support for live positions if required.

Exit criteria:

- Position snapshots survive reconnect.
- Modify/close commands are confirmed by bridge events.
- Close-all has explicit confirmation and logging.

### Milestone 7 - Hardening and Release Docs

- Add manual QA scripts for push and MT5.
- Add bridge protocol examples.
- Add troubleshooting docs.
- Update `docs/HANDOFF.md`, `docs/NEXT_TASKS.md`, `docs/PROJECT_STRUCTURE.md`, and
  `docs/CHANGELOG.md`.

Exit criteria:

- Build/typecheck/lint pass.
- Push and MT5 can be disabled independently.
- Rollback is possible by setting env flags off.

## 8. Testing Plan

Required automated checks after each milestone:

```bash
npm run typecheck
npm run lint
npm run build
```

Push manual checks:

- Browser unsupported path.
- Permission default -> granted.
- Permission denied path.
- Token registration success.
- Token registration failure.
- Foreground alert dispatch.
- Background alert dispatch.
- Disable/unregister token.

MT5 manual checks with mock bridge:

- Bridge disabled.
- Connect success.
- Connect reject.
- Reconnect after socket close.
- Heartbeat timeout.
- Account snapshot update.
- Position snapshot update.
- Order ack.
- Order reject.
- Execution report fill.
- Close position.
- Close all confirmation.

MT5 manual checks with real bridge:

- Demo account only for first validation.
- Symbol metadata and lot step validation.
- Market order with small volume.
- SL/TP modify.
- Partial/full close if broker supports it.
- Bridge restart and frontend reconnect.

## 9. Rollback Plan

- Push rollback: set `settings.push = false`, remove token, and leave toast/sound/browser intact.
- MT5 rollback: set `NEXT_PUBLIC_MT5_BRIDGE_ENABLED=false`; simulator remains default.
- If bridge protocol changes, keep message versioning in protocol constants and reject unsupported
  versions explicitly.
- Do not delete simulator code during Phase 6.

## 10. Final Phase 6 Acceptance Criteria

- App builds and runs without Firebase or MT5 configuration.
- Alert push notifications are opt-in and do not affect existing alert behavior.
- MT5 mode is opt-in and visually distinct from simulator mode.
- Live orders require confirmation and connected bridge state.
- Account/position state in MT5 mode comes from bridge snapshots/events.
- Simulator mode remains unchanged.
- All new runtime errors are surfaced in UI and logs, not silent console-only failures.
- Documentation covers setup, protocol, manual testing, and rollback.
