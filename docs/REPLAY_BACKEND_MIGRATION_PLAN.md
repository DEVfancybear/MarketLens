# Backend-Owned Replay: Architecture, Database, and Migration Plan

_Status: Phase 1 implemented in the repository; migration deployment and Phases 2-6 remain environment-dependent._
_Date: 2026-07-10._

## 1. Executive decision

Replay becomes a backend-owned market simulation, not a frontend cursor over a
live candle array.

- Go owns replay sessions, the simulated clock, cursor advancement, history
  availability, multi-timeframe aggregation, no-look-ahead enforcement, replay
  trading, command ordering, and reconnect recovery.
- Replay is auth-only. A valid existing backend session is required before
  dataset preparation or session creation; no guest/anonymous replay path is planned.
- PostgreSQL owns durable session metadata, immutable replay datasets, commands,
  events, checkpoints, and replay-trading ledgers.
- The frontend owns presentation only: controls, chart rendering, drawings,
  indicator display, and an in-memory projection of the last server snapshot.
- A replay step is measured in `replayInterval`, independent of a chart's visual
  timeframe. A 1-minute replay interval can progressively build a 15-minute,
  4-hour, or daily candle.
- Rewinding a trading-enabled session never mutates a ledger backwards. It
  requires a new generation/fork or a confirmed reset of replay trades.

This is a cross-package target architecture. Until the migration reaches the
cutover phase, `frontend/docs/REPLAY_ARCHITECTURE.md` remains the maintenance
contract for the legacy frontend-owned engine.

## 2. Why the current engine must move

The current client engine is useful but cannot be the final source of truth.

| Current behavior | Risk | Backend target |
| --- | --- | --- |
| `useReplayPlayback()` advances from browser `requestAnimationFrame` elapsed time | Background throttling can stall or catch up many bars after focus returns | Server actor advances deterministic simulated time; disconnect policy is explicit |
| `useTradeRuntime()` feeds only the latest visible candle | `+10`, seek, lag, and reconnect can skip intermediate fills/stops | Engine processes every replay interval in order |
| The same trade store serves live and replay data | Rewind/symbol changes can process positions against the wrong time or symbol | Replay account/order/fill ledger is session-scoped |
| MTF snapshots accept a higher-TF bar once its open time starts | Final high/low/close can leak before that higher-TF bar completes | Higher-TF candles are progressively aggregated from revealed base intervals |
| Timeframe remap falls back to an old array index when data is unavailable | Cursor silently jumps to an unrelated market time | Backend returns `data_point_unavailable`; client keeps the old interval |
| Replay-active chart history cannot paginate left | Deep replay is limited to the initial browser window | Backend prepares datasets around requested time and exposes first-available bounds |
| Live master candle updates recreate the visible replay slice | Past replay repeatedly recomputes chart/SMC/trade work | Session dataset is immutable; live quote streams remain separate |
| Frontend static checks assert source-code strings | Important temporal behavior is not executed in tests | Go unit/property/integration tests exercise state and event sequences |

## 3. Product parity baseline

The backend design intentionally supports these documented behaviors:

- select a bar/date, play/pause, forward one interval, speed changes, go to
  realtime, and select a new starting point;
- synchronized replay across one chart or every chart in a layout;
- a replay interval separate from chart timeframe;
- deep-history discovery and an explicit first available replay time;
- a replay-only trading account with market/limit/stop/stop-limit orders,
  bracket exits, executions, P/L, statistics, and export;
- live watchlist quotes and live server alerts remain live while chart replay is
  historical; creating a new server alert from a replay chart is disabled;
- drawings and indicators remain usable and persist after replay exits.

Research references:

- TradingView Bar Replay: <https://vn.tradingview.com/support/solutions/43000474024/>
- TradingView replay interval: <https://www.tradingview.com/support/solutions/43000739158-how-to-select-replay-interval-for-the-bar-replay/>
- TradingView historical replay trading: <https://www.tradingview.com/support/solutions/43000691889-learn-to-trade-on-historical-data/>
- TradingView replay history depth: <https://www.tradingview.com/support/solutions/43000692816-how-much-data-is-available-for-bar-replay/>
- TradingView synchronized replay: <https://www.tradingview.com/blog/en/synchronized-bar-replay-45933/>
- cTrader Market Replay: <https://help.ctrader.com/ctrader/trading/market-replay/>
- NinjaTrader Playback setup: <https://ninjatrader.com/support/helpGuides/nt8/set_up12.htm>

## 4. Scope and non-goals

### In scope

- authenticated, resumable bar replay for MT5 symbols;
- one or many replay tracks per session;
- `1m` base data for intraday aggregation where available;
- calendar-aware daily/weekly/monthly aggregation;
- deterministic bar-level replay trading;
- REST command API plus WebSocket event stream;
- durable reports and explicit retention;
- compatibility adapter during frontend migration.

### Deferred

- tick replay and Level II/order-book replay;
- provider-independent corporate-action correction;
- non-time-based charts such as Renko, Range, Kagi, PnF, and footprint;
- distributed replay actors across multiple regions;
- sharing a live replay session with another user.

Anonymous replay is intentionally out of scope. The frontend must show sign-in
before entering selection mode instead of falling back to the legacy local engine.

Tick replay is a later data-plane extension. The control/session APIs below do
not need to change when `dataKind=ticks` is added.

## 5. Ownership boundary

| Concern | Backend | Frontend |
| --- | --- | --- |
| Session state and version | Authoritative | Read-only projection |
| Clock, play/pause, speed | Authoritative | Sends commands |
| Cursor/current simulated time | Authoritative | Renders value |
| History bounds/data availability | Authoritative | Shows errors and loading |
| Replay interval and aggregation | Authoritative | Selects requested option |
| Visible/revealed bars | Authoritative | Applies snapshots/upserts to chart |
| MTF synchronization | Authoritative | Renders each track |
| Replay account/orders/fills/P&L | Authoritative | Order ticket and report UI |
| Live quotes/watchlist | Existing live backend stream | Continues rendering live values |
| Server alerts | Existing alert backend | Existing alerts stay live; create disabled in replay |
| Drawings/layout UI | Existing workspace APIs | Authoritative interaction/rendering |
| Indicator calculation | Existing path initially | Must consume only server-revealed bars |

No frontend component may derive a future candle by slicing the provider's full
history after cutover. It receives only dataset metadata and revealed bars.

## 6. Runtime architecture

```text
Browser
  Replay controls ──command──> Fiber replay handlers
  Chart/MTF panes <──snapshot/events── WebSocket /replay/sessions/:id/stream
                                  │
                                  ▼
                        Session actor (one writer)
                     command queue + simulated clock
                    /          |             \
        dataset reader    bar aggregator    replay trading
              │                 │                 │
              └─────────────────┴─────────────────┘
                                  │
                            PostgreSQL
           sessions, tracks, immutable datasets, commands,
              events, checkpoints, orders, fills, reports
                                  │
                         MT5 history bridge
                   (dataset preparation only; never UI-owned)
```

### 6.1 Session actor

Each active session has exactly one logical writer. The first implementation is
an in-process Go actor keyed by `session_id`:

1. load the latest checkpoint and unprocessed commands;
2. validate `expectedVersion` and idempotency key;
3. apply one command atomically;
4. advance all tracks through the same simulated-time barrier;
5. process aggregation and trading for every base interval in order;
6. persist state/events/checkpoint in one database transaction;
7. broadcast committed events only after the transaction succeeds.

Multi-instance deployment must acquire a PostgreSQL advisory lock derived from
`session_id`. A node that cannot acquire the lock forwards or returns a
retryable `session_busy` response; two actors must never advance one session.

### 6.2 Disconnect policy

The backend does not infer elapsed replay time while no client is observing it.

- When the last WebSocket subscriber disconnects, start a 5-second grace timer.
- If no subscriber reconnects, commit `paused` with reason `no_subscribers`.
- Reconnect returns a complete snapshot and continues only after an explicit
  `play` command.
- Server restarts restore active sessions as paused, never auto-catch-up.

### 6.3 State machine

```text
preparing -> paused <-> playing -> completed
    |          |          |            |
    +--------> failed     +----------> paused (seek/fork rules apply)
               |
closed <-------+----------------------------------------- any non-preparing state
```

`selecting` and `reSelecting` remain transient frontend UI states. The backend
does not create a session until the requested bar/date is confirmed.

## 7. Time and aggregation contract

### 7.1 Three distinct times

- `wall_time`: server scheduling/observability only;
- `simulated_time`: authoritative market time revealed by the session;
- `bar_open_time`: identity of a base or chart bar.

Never calculate market state from wall-clock elapsed time.

### 7.2 Replay interval

`replayIntervalSeconds` is the amount of market time revealed by one step. It
is independent of `chartTimeframe`.

- intraday/daily charts default to the largest available interval that evenly
  divides every selected chart timeframe, with a floor of 1 minute;
- weekly/monthly charts default to 1 day;
- `auto` is resolved by the backend and returned as an explicit integer;
- an unsupported requested interval returns `unsupported_replay_interval`.

### 7.3 Progressive chart bars

For every revealed base bar:

1. determine the target chart bucket using the provider's trading calendar;
2. create the target candle with base open/high/low/close/volume, or update it;
3. update high/low/close/volume only from revealed base bars;
4. mark the target candle complete only when its bucket closes;
5. emit `track.bar.upsert` with `complete=false|true`.

This same aggregator feeds all MTF panes. It is forbidden to expose the final
OHLC of a higher-timeframe source bar while only part of that bar has elapsed.

### 7.4 Multi-track barrier

All tracks advance to one target `simulated_time`. A larger timeframe waits
until enough base intervals have been revealed. Missing/closed-market intervals
do not fabricate candles. The barrier completes when every track is either:

- advanced through the target time;
- in a known market-closed gap; or
- failed with an explicit data availability error.

## 8. Determinism and no-look-ahead

The following are hard invariants:

1. Dataset rows are immutable after a dataset becomes `ready`.
2. A session pins dataset IDs and checksums; provider refreshes create a new
   dataset rather than changing an active session.
3. Commands are applied exactly once per `(session_id, idempotency_key)`.
4. Event sequence and session version increase monotonically.
5. Every order fill is derived from a revealed base bar/tick with sequence not
   greater than the track cursor.
6. Indicators, SMC, and trading receive only revealed aggregates.
7. A seek to an unavailable time fails; it never reuses an array index from a
   different timeframe.
8. Replaying the same dataset plus command log produces the same checkpoint
   checksum and trade ledger.

For bar-level fills, the MVP uses a declared conservative path model. If both
high and low are relevant in one base bar, resolve the intrabar path as:

- bullish bar: `open -> low -> high -> close`;
- bearish bar: `open -> high -> low -> close`;
- do not apply price movement that occurred before an order's submission event;
- gaps fill at the first executable market price, not automatically at the
  requested price.

The path model is stored in session configuration so reports remain auditable.
Later lower-timeframe or tick detail can replace it without changing the ledger
contract.

## 9. Database design

Migration `0012_replay_backend` implements the Phase 1 subset: immutable bar
datasets, paused sessions, and tracks. The SQL below remains the target schema;
commands, events, checkpoints, and replay-trading tables are added by the phase
that first owns their behavior rather than being deployed as unused Phase 1
tables. Every follow-up migration must preserve the ownership, determinism, and
retention constraints in this section.

### 9.1 Control and immutable market datasets

```sql
CREATE TYPE replay_session_status AS ENUM
  ('preparing', 'paused', 'playing', 'completed', 'failed', 'closed');
CREATE TYPE replay_session_mode AS ENUM ('single_chart', 'all_charts');
CREATE TYPE replay_dataset_status AS ENUM ('loading', 'ready', 'failed');
CREATE TYPE replay_data_kind AS ENUM ('bars', 'ticks');

CREATE TABLE replay_datasets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider              text NOT NULL,
  symbol                text NOT NULL,
  data_kind             replay_data_kind NOT NULL DEFAULT 'bars',
  base_interval_seconds integer NOT NULL CHECK (base_interval_seconds > 0),
  first_time            timestamptz NOT NULL,
  last_time             timestamptz NOT NULL,
  snapshot_at           timestamptz NOT NULL,
  row_count             bigint NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  checksum_sha256       text,
  status                replay_dataset_status NOT NULL DEFAULT 'loading',
  source_meta           jsonb NOT NULL DEFAULT '{}',
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  ready_at              timestamptz,
  CHECK (last_time >= first_time)
);
CREATE INDEX idx_replay_datasets_lookup
  ON replay_datasets(provider, symbol, base_interval_seconds, first_time, last_time)
  WHERE status = 'ready';
CREATE UNIQUE INDEX idx_replay_datasets_checksum
  ON replay_datasets(checksum_sha256)
  WHERE checksum_sha256 IS NOT NULL AND status = 'ready';

CREATE TABLE replay_dataset_bars (
  dataset_id       uuid NOT NULL REFERENCES replay_datasets(id) ON DELETE CASCADE,
  seq              bigint NOT NULL CHECK (seq >= 0),
  open_time        timestamptz NOT NULL,
  interval_seconds integer NOT NULL CHECK (interval_seconds > 0),
  open             numeric(24,10) NOT NULL,
  high             numeric(24,10) NOT NULL,
  low              numeric(24,10) NOT NULL,
  close            numeric(24,10) NOT NULL,
  volume           numeric(28,10) NOT NULL DEFAULT 0,
  complete         boolean NOT NULL DEFAULT true,
  PRIMARY KEY (dataset_id, seq),
  UNIQUE (dataset_id, open_time),
  CHECK (high >= GREATEST(open, close, low)),
  CHECK (low <= LEAST(open, close, high))
);
CREATE INDEX idx_replay_dataset_bars_time
  ON replay_dataset_bars(dataset_id, open_time);

CREATE TABLE replay_sessions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                  replay_session_status NOT NULL DEFAULT 'preparing',
  mode                    replay_session_mode NOT NULL DEFAULT 'single_chart',
  generation              integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  version                 bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  next_event_seq          bigint NOT NULL DEFAULT 1 CHECK (next_event_seq > 0),
  speed                   numeric(8,3) NOT NULL DEFAULT 1 CHECK (speed > 0),
  replay_interval_seconds integer NOT NULL CHECK (replay_interval_seconds > 0),
  start_time              timestamptz NOT NULL,
  simulated_time          timestamptz NOT NULL,
  end_time                timestamptz,
  pause_reason            text,
  config                  jsonb NOT NULL DEFAULT '{}',
  last_error              text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  closed_at               timestamptz,
  CHECK (simulated_time >= start_time),
  CHECK (end_time IS NULL OR end_time >= start_time)
);
CREATE INDEX idx_replay_sessions_user_updated
  ON replay_sessions(user_id, updated_at DESC);
CREATE INDEX idx_replay_sessions_active
  ON replay_sessions(status, updated_at)
  WHERE status IN ('preparing', 'paused', 'playing');

CREATE TABLE replay_tracks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES replay_sessions(id) ON DELETE CASCADE,
  dataset_id        uuid NOT NULL REFERENCES replay_datasets(id),
  slot              integer NOT NULL CHECK (slot >= 0),
  symbol            text NOT NULL,
  provider          text NOT NULL,
  chart_timeframe   text NOT NULL,
  cursor_seq        bigint NOT NULL DEFAULT -1 CHECK (cursor_seq >= -1),
  visible_through   timestamptz,
  aggregate_state   jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, slot)
);
CREATE INDEX idx_replay_tracks_session ON replay_tracks(session_id, slot);
```

Datasets are shared and immutable. Sessions and every table below are
user-owned indirectly through `replay_sessions`; repository queries must join
and scope by `user_id`.

The actual migration must attach the repository-standard `set_updated_at()`
trigger to `replay_sessions`, `replay_tracks`, `replay_accounts`,
`replay_orders`, and `replay_positions`.

### 9.2 Commands, events, and checkpoints

```sql
CREATE TYPE replay_command_status AS ENUM
  ('accepted', 'applied', 'rejected', 'failed');

CREATE TABLE replay_commands (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES replay_sessions(id) ON DELETE CASCADE,
  command_seq       bigint NOT NULL,
  idempotency_key   text NOT NULL,
  expected_version  bigint,
  command_type      text NOT NULL,
  payload           jsonb NOT NULL DEFAULT '{}',
  status            replay_command_status NOT NULL DEFAULT 'accepted',
  result            jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  UNIQUE (session_id, command_seq),
  UNIQUE (session_id, idempotency_key)
);

CREATE TABLE replay_events (
  session_id   uuid NOT NULL REFERENCES replay_sessions(id) ON DELETE CASCADE,
  event_seq    bigint NOT NULL,
  event_type   text NOT NULL,
  simulated_at timestamptz NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, event_seq)
);
CREATE INDEX idx_replay_events_resume
  ON replay_events(session_id, event_seq);

CREATE TABLE replay_checkpoints (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid NOT NULL REFERENCES replay_sessions(id) ON DELETE CASCADE,
  generation     integer NOT NULL,
  event_seq      bigint NOT NULL,
  simulated_time timestamptz NOT NULL,
  snapshot       jsonb NOT NULL,
  checksum_sha256 text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, generation, event_seq)
);
CREATE INDEX idx_replay_checkpoints_latest
  ON replay_checkpoints(session_id, generation, event_seq DESC);
```

Persist control/trading events, not every redundant UI repaint. Bar data is in
the dataset and current cursors are in checkpoints. Compact old control events
only after a checkpoint is durable and its checksum has been verified.

### 9.3 Replay trading ledger

```sql
CREATE TYPE replay_order_side AS ENUM ('buy', 'sell');
CREATE TYPE replay_order_type AS ENUM ('market', 'limit', 'stop', 'stop_limit');
CREATE TYPE replay_order_status AS ENUM
  ('pending', 'partially_filled', 'filled', 'cancelled', 'rejected');

CREATE TABLE replay_accounts (
  session_id       uuid PRIMARY KEY REFERENCES replay_sessions(id) ON DELETE CASCADE,
  base_currency    text NOT NULL DEFAULT 'USD',
  starting_equity  numeric(24,8) NOT NULL CHECK (starting_equity > 0),
  balance          numeric(24,8) NOT NULL,
  equity           numeric(24,8) NOT NULL,
  commission_model jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE replay_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES replay_sessions(id) ON DELETE CASCADE,
  track_id         uuid NOT NULL REFERENCES replay_tracks(id),
  client_order_id  text NOT NULL,
  side             replay_order_side NOT NULL,
  order_type       replay_order_type NOT NULL,
  status           replay_order_status NOT NULL DEFAULT 'pending',
  quantity         numeric(28,10) NOT NULL CHECK (quantity > 0),
  filled_quantity  numeric(28,10) NOT NULL DEFAULT 0 CHECK (filled_quantity >= 0),
  limit_price      numeric(24,10),
  stop_price       numeric(24,10),
  take_profit      numeric(24,10),
  stop_loss        numeric(24,10),
  submitted_at     timestamptz NOT NULL,
  updated_at_sim   timestamptz NOT NULL,
  reject_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, client_order_id),
  CHECK (filled_quantity <= quantity)
);
CREATE INDEX idx_replay_orders_session_status
  ON replay_orders(session_id, status, submitted_at);

CREATE TABLE replay_fills (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid NOT NULL REFERENCES replay_sessions(id) ON DELETE CASCADE,
  order_id       uuid NOT NULL REFERENCES replay_orders(id) ON DELETE CASCADE,
  track_id       uuid NOT NULL REFERENCES replay_tracks(id),
  dataset_seq    bigint NOT NULL,
  simulated_at   timestamptz NOT NULL,
  price          numeric(24,10) NOT NULL,
  quantity       numeric(28,10) NOT NULL CHECK (quantity > 0),
  commission     numeric(24,8) NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_replay_fills_session_time
  ON replay_fills(session_id, simulated_at, id);

CREATE TABLE replay_positions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES replay_sessions(id) ON DELETE CASCADE,
  track_id         uuid NOT NULL REFERENCES replay_tracks(id),
  symbol           text NOT NULL,
  net_quantity     numeric(28,10) NOT NULL DEFAULT 0,
  average_price    numeric(24,10) NOT NULL DEFAULT 0,
  realized_pnl     numeric(24,8) NOT NULL DEFAULT 0,
  unrealized_pnl   numeric(24,8) NOT NULL DEFAULT 0,
  updated_at_sim   timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, track_id, symbol)
);

CREATE TABLE replay_equity_points (
  session_id    uuid NOT NULL REFERENCES replay_sessions(id) ON DELETE CASCADE,
  event_seq     bigint NOT NULL,
  simulated_at  timestamptz NOT NULL,
  balance       numeric(24,8) NOT NULL,
  equity        numeric(24,8) NOT NULL,
  drawdown      numeric(24,8) NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, event_seq)
);
```

Trade reports are derived from this ledger. Do not copy replay fills into the
normal journal automatically; export/import to the journal is an explicit user
action with a source reference to the replay session.

### 9.4 Retention and size controls

- Active/failed session metadata: 30 days by default.
- Closed sessions with trades: 90 days; reports may be exported before purge.
- Command/event rows: compact after checkpoint, keep all trading events.
- Dataset reuse: reference-count by active/non-expired sessions; purge unused
  datasets after 7 days.
- Initial quotas: 4 tracks/session, 40,000 bars/track, 3 concurrent sessions/user.
- Large tick datasets later move to object storage; PostgreSQL retains manifest,
  checksum, index ranges, and session control state.

## 10. API contract

All endpoints are protected by the existing httpOnly cookie auth and follow the
existing error envelope. Cross-user session IDs return `404`.

### 10.1 Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/replay/sessions` | Prepare a session and datasets |
| `GET` | `/api/v1/replay/sessions/:id` | Full reconnect snapshot |
| `DELETE` | `/api/v1/replay/sessions/:id` | Close session, pause actor |
| `POST` | `/api/v1/replay/sessions/:id/commands` | Idempotent transport/seek/config/order command |
| `GET` | `/api/v1/replay/sessions/:id/events?afterSeq=` | HTTP gap recovery |
| `GET` | `/api/v1/replay/sessions/:id/stream?afterSeq=` | WebSocket snapshots/events |
| `GET` | `/api/v1/replay/sessions/:id/tracks/:trackId/bars` | Initial/recovery revealed bars |
| `POST` | `/api/v1/replay/sessions/:id/fork` | Create a new generation/session at an earlier time |
| `GET` | `/api/v1/replay/sessions/:id/report` | Replay trading report |

### 10.2 Create request

```json
{
  "mode": "single_chart",
  "start": { "kind": "time", "time": "2026-05-01T09:30:00Z" },
  "endTime": null,
  "replayInterval": "auto",
  "speed": 1,
  "tracks": [
    { "slot": 0, "symbol": "EURUSD", "chartTimeframe": "15m" }
  ],
  "trading": {
    "enabled": true,
    "startingEquity": "10000.00",
    "baseCurrency": "USD",
    "commission": { "kind": "per_unit", "value": "0" },
    "barPathModel": "conservative_ohlc"
  }
}
```

Creation returns `202 Accepted` while datasets are preparing. A later snapshot
is `paused` and includes `firstAvailableTime`, `lastAvailableTime`, resolved
replay interval, dataset checksums, tracks, and trading account.

### 10.3 Command envelope

```json
{
  "idempotencyKey": "01J...",
  "expectedVersion": 17,
  "type": "step",
  "payload": { "count": 1 }
}
```

Command types:

- `play`, `pause`, `step`, `seek`, `restart`, `close`;
- `set_speed`, `set_replay_interval`;
- `place_order`, `cancel_order`, `close_position`, `reverse_position`;
- `reset_trading`.

`step.count` is bounded. The engine still processes every intervening base row.
`seek` backward on a trading-enabled generation returns
`rewind_requires_fork` unless `resetTrading=true` is explicitly confirmed.

Conflict response:

```json
{
  "error": {
    "code": "version_conflict",
    "message": "Replay session changed; refresh the snapshot",
    "details": { "currentVersion": 18 }
  }
}
```

### 10.4 Event envelope

```json
{
  "sessionId": "uuid",
  "eventSeq": 42,
  "version": 18,
  "simulatedTime": "2026-05-01T10:15:00Z",
  "type": "track.bar.upsert",
  "payload": {
    "trackId": "uuid",
    "bar": {
      "time": "2026-05-01T10:15:00Z",
      "open": "1.13310",
      "high": "1.13340",
      "low": "1.13290",
      "close": "1.13325",
      "volume": "120",
      "complete": false
    }
  }
}
```

Event types include `snapshot`, `session.ready`, `state.changed`,
`cursor.advanced`, `track.bar.upsert`, `track.reset`, `order.*`, `fill.created`,
`position.updated`, `account.updated`, `session.completed`, and `error`.

The client detects an event-sequence gap, stops applying events, and calls the
HTTP recovery endpoint or fetches a full snapshot. It never guesses missing
bars locally.

### 10.5 Replay-specific errors

- `data_point_unavailable`
- `unsupported_symbol`
- `unsupported_chart_type`
- `unsupported_replay_interval`
- `dataset_preparation_failed`
- `version_conflict`
- `rewind_requires_fork`
- `session_busy`
- `session_closed`
- `replay_quota_exceeded`

## 11. Frontend migration map

| Current frontend ownership | Transitional replacement | Final state |
| --- | --- | --- |
| `replayStore` state atoms | `replayClientStore` hydrates server snapshot/events | Projection only; no business actions |
| `useReplayPlayback` | Feature-flagged off when backend session exists | Deleted |
| `stepAtom`, `setCursorAtom`, `reconcileReplayToCandlesAtom` | API commands and server version | Deleted |
| `useVisibleCandles` slicing full history | Compatibility selector over server revealed bars | No access to future history |
| `replayEngine.mtfSnapshot` | Server track aggregation | Keep UI formatting only |
| `useMtfSnapshotSeries` | Tracks included in session | Deleted |
| `useTradeRuntime` | Order/fill/position WebSocket events | Deleted |
| replay use of global `tradeStore` | Replay account projection | Live/sim store remains separate |
| `ReplaySelectionLayer` | Still selects a candidate time | Calls create/seek command after confirmation |
| controls/timing menu/dashboard | Same components with command client | Presentation only |

The frontend must preserve drawings, indicator configuration, chart viewport,
and selection UX. Only market-simulation ownership moves.

### 11.1 Mandatory frontend deletion contract

The migration is not complete if the old engine is merely disabled behind a
feature flag. After backend parity gates pass, delete the frontend business
logic below so there cannot be two replay authorities.

| Current source | Required action | Backend/client replacement | Delete gate |
| --- | --- | --- | --- |
| `src/hooks/useReplayPlayback.ts` | Delete file and all imports | Go session actor clock plus `state.changed`/`cursor.advanced` events | Phase 2 shadow state has zero cursor divergence for one release |
| `src/store/replayStore.ts` | Delete atoms, reducers, clock actions, index/time reconciliation, and `getReplayState()` | `replayClientStore.ts` stores only the latest validated server DTO and connection status | Every control uses API commands; no component mutates cursor locally |
| `src/services/replayEngine.ts` | Delete selection/index/MTF/speed simulation helpers | Go selection, history bounds, aggregation, and capability response | Phase 3 aggregation/selection contract tests pass |
| `src/hooks/useMtfSnapshotSeries.ts` | Delete file | Session tracks and backend aggregate events | MTF UI renders only server track snapshots |
| `src/hooks/useVisibleCandles.ts` | Delete replay slicing path; replace consumers with a chart-series projection that receives live bars or server-revealed replay bars | `replayClientStore.tracks[trackId].bars` | Browser no longer downloads future session bars |
| replay branches in `src/hooks/useMarketData.ts` | Remove replay imports, centered-history logic, disarm/reconcile calls, and replay total writes | Backend dataset preparation and explicit availability errors | Symbol/timeframe replay commands are server-owned |
| replay processing in `src/hooks/useTradeRuntime.ts` | Remove replay candle feeding; keep normal simulator feed in a clearly live-only module if still needed | Replay order/fill/account events | Phase 4 ledger parity and rewind/fill tests pass |
| replay coupling in `src/store/tradeStore.ts` | Remove any replay position/account projection from the normal simulator store | Dedicated read-only `replayTradingClientStore` | Live/sim and replay ledgers cannot process each other's symbols or times |
| `scripts/check-replay-logic.mjs` | Delete source-regex assertions | Go behavioral/property tests plus frontend API/socket contract tests | Replacement suites run in CI |
| replay clock mount in `src/components/layout/GlobalRuntime.tsx` | Delete hook mount | Backend WebSocket lifecycle | `useReplayPlayback` no longer exists |

`src/components/chart/replayViewport.ts` may remain because viewport placement
is presentation geometry, not market simulation. It must accept server-revealed
bar counts and must never change session time or request provider history.

### 11.2 Frontend modules allowed after cutover

The final frontend replay surface is intentionally small:

```text
src/services/api/replayApi.ts          # typed REST commands/snapshots
src/services/replay/replaySocket.ts    # ordered event transport + gap recovery
src/store/replayClientStore.ts         # read-only server projection
src/store/replayTradingClientStore.ts  # read-only account/order/fill projection
src/components/replay/*                # controls, selection UX, dashboard/report
src/components/chart/replayViewport.ts # visual range recovery only
```

Allowed client behavior:

- validate basic form shape before sending a command;
- show optimistic button/loading state, but never optimistic cursor or fills;
- apply a complete server snapshot;
- apply an event only when `eventSeq` is exactly the expected next value;
- stop and recover on an event gap, version conflict, or checksum mismatch;
- project already-revealed bars into Lightweight Charts and indicators.

Forbidden client behavior:

- scheduling replay steps with rAF, timers, workers, or wall-clock deltas;
- maintaining `anchor`, `cursor`, `total`, or simulated time independently;
- loading provider history for an active replay session;
- slicing a full candle array to simulate visibility;
- aggregating replay intervals or higher-timeframe OHLC;
- evaluating pending orders, SL/TP, P/L, commissions, or intrabar paths;
- remapping a replay timestamp to a local candle index;
- falling back to the legacy local engine on API failure or logout.

Because Replay is auth-only, logout or `401` closes the client projection and
returns the UI to a sign-in gate. It must not resume the deleted local engine.

### 11.3 Boundary enforcement in CI

Add `npm run check:replay-client-boundary` before deleting the legacy engine.
The check should combine ESLint `no-restricted-imports` with a small structural
script and fail when:

- a replay component imports `candlesAtom`, `HistoricalDataService`,
  `getReplayState`, `checkPendingTrigger`, or `checkExit`;
- a replay module calls `requestAnimationFrame`, `setInterval`, or `setTimeout`
  to advance market state;
- removed identifiers such as `stepAtom`, `cursorAtom`, `anchorAtom`,
  `reconcileReplayToCandlesAtom`, or `mtfSnapshot` reappear;
- an active replay path calls a provider history endpoint directly;
- any file outside the allowed client modules writes replay snapshot state.

Frontend tests retained after deletion cover only client responsibilities:

- command DTO mapping and auth errors;
- snapshot validation and replacement;
- ordered event application, duplicate rejection, and gap recovery;
- reconnect snapshot replacing stale local projection;
- control disabled/loading/error states;
- selection coordinate converted to a requested UTC time, with the backend
  deciding whether the time is valid;
- chart viewport behavior for server reset/upsert events.

### 11.4 Deletion sequence and rollback after deletion

1. Phase 2 keeps the legacy clock only for shadow comparison; it cannot drive
   the chart when `REPLAY_BACKEND_V1` owns the session.
2. Phase 3 deletes frontend MTF/history/reconciliation logic after server
   aggregation becomes authoritative.
3. Phase 4 deletes replay trade processing immediately after the backend ledger
   owns order entry and reports; do not dual-write fills.
4. Phase 6 deletes the remaining clock/store/engine files, removes their test
   compiler entries and package scripts, then enables the boundary guard.
5. After deletion, rollback means disabling Replay UI or switching to a
   compatible backend API version. Rollback must never restore a local replay
   engine from a stale bundle.

The deletion PR must include an import/reference scan proving every mandatory
file and identifier is gone, plus a production build and complete replay E2E
suite. A commented file, dead branch, or permanently-false feature flag does
not satisfy deletion.

## 12. Implementation phases

### Phase 0 — executable contracts (completed 2026-07-10)

- [x] Replaced `scripts/check-replay-logic.mjs` source-regex assertions with
  `npm run test:replay` executable TypeScript behavior tests.
- [x] Added reproductions for MTF partial-bar look-ahead, skipped +10 trade
  fills, rewind with open positions, cross-symbol fills, hidden-tab catch-up,
  and unavailable timeframe mapping. These are known-gap reproductions, not
  claims that the production bugs are fixed.
- [x] Added `testdata/replay/contracts.v1.json`, loaded by frontend tests and
  `backend/internal/replaycontract/fixtures_test.go`.
- [x] Extracted and behaviorally tested `clampReplayBounds()` while keeping the
  legacy store's production behavior unchanged.

Phase 0 verification baseline:

```text
frontend: npm run test:replay
backend:  go test ./internal/replaycontract
shared:   testdata/replay/contracts.v1.json (schemaVersion=1)
```

### Phase 1 — persistence and dataset preparation (completed 2026-07-10)

- [x] Added migration `0012_replay_backend`, generated sqlc queries, transactional
  repository, checksum reuse lock, and bounded retention cleanup job.
- [x] Built the MT5 chart-timeframe dataset loader with deterministic SHA-256,
  validation/deduplication, and explicit first/last available bounds.
- [x] Added auth-only session create/get/close endpoints; every created session
  remains paused and has no backend playback clock or commands yet.
- [x] Added a typed frontend snapshot client behind
  `NEXT_PUBLIC_REPLAY_BACKEND_V1`; the active legacy UI is intentionally not
  connected to backend playback during Phase 1.

Phase 1 supports one `single_chart` track, a `time` start selector, and
`replayInterval=auto`. It pins up to the MT5 history service's 5,000-row request
limit at the selected chart timeframe. Base-interval loading, progressive
aggregation, asynchronous preparation events, and synchronized tracks remain
Phase 3/5 work. See `docs/REPLAY_BACKEND_PHASE1.md` for the deployed contract.

### Phase 2 — single-chart backend clock

- Implement session actor, commands, events, checkpoint recovery, and WebSocket.
- Move play/pause/step/speed/cursor authority to Go.
- Shadow-run frontend and backend cursors in development; report divergence.
- Keep old engine as instant rollback.

### Phase 3 — replay interval and aggregation

- Load base interval data and progressively aggregate chart bars.
- Move MTF panel to server tracks.
- Add deep-history/first-available flow and correct timeframe-switch errors.
- Disable frontend access to full replay history after session creation.

### Phase 4 — isolated replay trading

- Implement account/order/fill/position/equity ledger.
- Process every revealed base row in order.
- Add bracket drag/update commands, execution markers, report/export.
- Require fork/reset for backward seek.

### Phase 5 — synchronized layouts

- Add up to four tracks, one simulated-time barrier, auto replay interval, and
  per-track market calendars.
- Add single-chart/all-charts mode to layout UI.

### Phase 6 — cutover and cleanup

- Enable backend replay by default for authenticated users.
- Execute the mandatory deletion contract in section 11.1: remove the frontend
  clock, cursor/state machine, provider-history replay paths, MTF aggregation,
  and replay trade processing after one stable backend-owned release.
- Keep a kill switch that disables the Replay UI or selects a compatible backend
  API version. It must not reactivate deleted local replay logic.
- Enable `check:replay-client-boundary` in CI and reject reintroduction of
  frontend replay business logic.

## 13. Test strategy and acceptance gates

### Unit/property tests

- state-machine transition table;
- command idempotency and optimistic version conflicts;
- speed changes do not change deterministic final state;
- calendar aggregation for intraday/day/week/month;
- MTF partial bar never contains unrevealed high/low/close;
- sequential order fill/path/gap rules;
- same dataset + command log => same checkpoint checksum;
- unrelated symbols never share order processing.

### Integration tests

- create -> prepare -> connect -> play -> disconnect -> reconnect paused;
- step 10 processes ten base intervals and every possible trade trigger;
- restart/rewind requires fork when trades exist;
- timeframe switch unavailable returns error without moving the cursor;
- WebSocket gap recovery produces the same snapshot as uninterrupted delivery;
- actor restart from checkpoint does not duplicate events or fills;
- two concurrent commands with one expected version yield one success/one 409;
- cross-user session access returns 404.

### End-to-end parity tests

- select bar/date/random/first available;
- play/pause/forward/speed/go-live/reselect;
- 1m replay progressively builds 15m and 4H charts;
- synchronized tracks wait correctly across different timeframes;
- drawings/indicators remain usable and persist after exit;
- existing server alerts/watchlist remain live; alert creation is disabled;
- replay trading settings, orders, bracket drag, execution labels, P/L, and report.

### Performance gates

- p95 command acknowledgement under 100 ms excluding dataset preparation;
- p95 event broadcast under 50 ms after commit;
- 10x playback with four tracks uses less than one CPU core per active session;
- checkpoint restore under 500 ms for 40,000 bars/track;
- zero frontend full-history fetch after backend cutover.

## 14. Observability and operations

Metrics:

- `replay_active_sessions`, `replay_actor_count`;
- command latency/count by type and result;
- dataset preparation latency, cache hit rate, rows, failures;
- actor lag between scheduled and committed simulated steps;
- WebSocket subscribers, disconnect pauses, event-gap recoveries;
- checkpoint duration/size/checksum failures;
- order/fill counts and deterministic replay mismatches;
- frontend/backend shadow cursor divergence during rollout.

Structured logs always include `request_id`, `user_id`, `session_id`,
`generation`, `version`, `event_seq`, and `simulated_time`. Never log auth
cookies, order notes, or entire dataset payloads.

Configuration:

```text
REPLAY_ENGINE_ENABLED=false
REPLAY_MAX_CONCURRENT_SESSIONS_PER_USER=3
REPLAY_MAX_TRACKS_PER_SESSION=4
REPLAY_MAX_BARS_PER_TRACK=40000
REPLAY_DISCONNECT_GRACE=5s
REPLAY_CHECKPOINT_EVERY_EVENTS=250
REPLAY_SESSION_RETENTION=720h
REPLAY_DATASET_RETENTION=168h
```

Readiness must report replay disabled/degraded separately from core API health.
Dataset cleanup uses bounded batches and never deletes a dataset referenced by
an unexpired session.

## 15. Security and abuse controls

- Authenticate before dataset preparation to prevent free history scraping.
- Validate symbols/timeframes against the backend MT5 catalog.
- Rate-limit session create, seek, and event recovery separately.
- Bound date range, tracks, bars, command payload, and WebSocket message size.
- Use repository ownership joins for every session child resource.
- Treat `expectedVersion` as concurrency control, not authorization.
- Revalidate order values server-side with exact decimal arithmetic.
- Do not let replay commands create or mutate real broker/FTMO orders.

## 16. Rollout, rollback, and data migration

There is no browser replay state worth bulk migrating. Existing frontend replay
sessions are runtime-only. Cutover behavior:

1. let an active legacy replay finish or ask the user to restart in backend mode;
2. create new sessions only through backend when the flag is enabled;
3. keep drawings/settings/watchlists on their existing APIs;
4. keep normal simulated/live positions separate from replay accounts;
5. rollback by disabling the frontend/backend flags before schema rollback;
6. database down migration is allowed only after all replay actors are stopped
   and session export/retention requirements are accepted.

Do not dual-write trade fills to both frontend and backend. During shadow mode,
backend trading is read-only comparison until Phase 4 owns the UI.

## 17. Definition of done

Backend replay is complete only when:

- every production cursor mutation originates from a committed backend command;
- reconnect/restart cannot skip, duplicate, or reveal a future interval;
- MTF candles are built only from revealed base data;
- replay trading is isolated, symbol-correct, chronological, and deterministic;
- deep-history and unavailable-time errors are explicit;
- multi-chart sessions share one simulated-time barrier;
- frontend legacy clock/trade/MTF logic is deleted;
- every file/identifier in the section 11.1 deletion contract is absent and the
  client-boundary guard passes;
- docs, migrations, sqlc, API examples, tests, metrics, and rollback runbook agree.
