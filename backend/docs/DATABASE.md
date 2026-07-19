# Database Design

> Status: implemented through migration `0023_mt5_verification`.
> This includes alerts, dynamic technical targets, expiration/re-arming, drawing revisions,
> per-user MT5 verification, integrations, replay, journal/screenshots, simulated trading, and
> layout persistence.
> See `AUTH.md` for auth, `API.md` for endpoints, and
> `BACKEND_IMPLEMENTATION_PLAN.md` for rollout order.
>
> **Audited against the frontend 2026-07-17** — every table below is reconciled with the real
> localStorage/IndexedDB shapes and TypeScript types (`frontend/src/types/*`, `store/*`). The jsonb
> columns intentionally mirror the frontend types so the client model can round-trip untouched.
>
> Backend-owned replay is implemented by migrations `0012_replay_backend` through
> `0014_replay_trading`; the design document in `../../docs/REPLAY_BACKEND_MIGRATION_PLAN.md`
> remains the long-form API and concurrency reference.

---

## 1. Goals & context

The frontend keeps a browser cache for anonymous/offline use and synchronizes implemented
resources to the backend for authenticated users. Exact local keys and durable mappings (audited):

| Frontend store (exact key → shape)                                   | Where          | DB table(s)                                    |
| -------------------------------------------------------------------- | -------------- | ---------------------------------------------- |
| `ui` → theme, panels, panel visibility/tab, grid                    | localStorage   | `user_settings.ui`                             |
| `smc-settings-v2` → 8 boolean toggles (`SmcSettings`)                | localStorage   | `user_settings.smc`                            |
| `tv:favoriteTimeframes` → `string[]`                                 | localStorage   | `user_settings.chart.favoriteTimeframes`       |
| `chartTimeZone`, `drawingSyncMode`, `drawingToolPreferences`         | localStorage   | `user_settings.chart`                          |
| `drawings:<symbol>` → `Drawing[]`                                   | localStorage   | `drawings`                                      |
| `drawingTemplates` → `DrawingTemplate[]` (**global**, style presets) | localStorage   | `drawing_templates`                            |
| `tv:favTools` → `string[]` (**global**, drawing toolbar stars)       | localStorage   | `drawing_tool_favorites`                       |
| `indicators` → `IndicatorConfig[]`                                  | localStorage   | `indicator_presets`                            |
| `pineScripts` → `CustomIndicatorScript[]`                           | localStorage   | `pine_scripts`                                 |
| `watchlist` → `string[]`                                            | localStorage   | `watchlists` + `watchlist_symbols`             |
| `alerts` → `{ alerts, triggeredAlerts, history, settings }`         | localStorage   | `alerts` + `alert_events` + `user_settings.notifications` |
| `pushNotifications` → `{ registration }`                            | localStorage   | `push_tokens`                                   |
| `journal` → `JournalEntry[]` (**trade-centric**)                    | IndexedDB      | `journal_entries`                              |
| `screenshots` → `{ id, blob }`                                      | IndexedDB      | `screenshots` (+ object storage for the blob)  |
| simulated positions (`tradeStore`, `Position[]`)                    | runtime only   | `sim_accounts` + `sim_positions`               |

The backend becomes the **durable source of truth** so a signed-in user gets the same workspace on
any device. The browser stores keep working as a **local cache / offline buffer**; a sync layer
reconciles them against the API (§11). Everything user-owned is scoped by `user_id` and cascades on
user deletion.

---

## 2. Technology choices

| Concern              | Choice                                              |
| -------------------- | --------------------------------------------------- |
| Engine               | **PostgreSQL 16**                                   |
| Driver               | `jackc/pgx` v5 (pool)                               |
| Query layer          | `sqlc` (type-safe generated Go) — no heavy ORM      |
| Migrations           | `golang-migrate` (`backend/migrations/*.sql`)       |
| IDs                  | `uuid` (`gen_random_uuid()`, `pgcrypto`)            |
| Timestamps           | `timestamptz`, always UTC, `default now()`          |
| Case-insensitive text| `citext` (emails)                                   |
| Flexible payloads    | `jsonb` (drawing geometry, indicator config, styles)|
| Large binaries       | Object storage (S3/R2), DB holds only metadata      |

Required extensions:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email
```

> **Client ids are epoch-millis numbers**, not UUIDs (frontend `uid()` + `createdAt`/`entryTime` are
> JS `number`). The DB uses UUID PKs and keeps the client id separately (`client_id text`) for sync
> dedupe. Frontend `number` timestamps convert to `timestamptz` (`to_timestamp(ms/1000.0)`).

---

## 3. Conventions

- Every table has `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` unless it is a pure join table.
- Every table has `created_at timestamptz NOT NULL DEFAULT now()`.
- Mutable tables have `updated_at timestamptz NOT NULL DEFAULT now()` maintained by a trigger.
- User-owned rows have `user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`.
- Enumerable states use a Postgres `ENUM` (documented per table); enum labels match frontend unions
  verbatim (e.g. `crossUp`, `long`, `after-entry`) so no translation layer is needed.
- All money/prices use `numeric(20,8)` (never float) to stay exact for FX/crypto ticks.

Shared `updated_at` trigger:

```sql
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
-- Attach per table:
-- CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON <table>
--   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## 4. Entity relationship overview

```
                         ┌──────────────┐
                         │    users     │
                         └──────┬───────┘
                                │ 1
   ┌───────────────┬───────────┼───────────────┬───────────────┬───────────────┐
   │ N             │ N         │ 1:1           │ N             │ N             │ N
┌───────────────┐ ┌─────────┐ ┌───────────────┐ ┌───────────┐ ┌───────────────┐ ┌───────────────┐
│auth_identities│ │sessions │ │ user_settings │ │push_tokens│ │  watchlists   │ │drawing_templat│
└───────────────┘ └─────────┘ └───────────────┘ └───────────┘ │  └ symbols    │ └───────────────┘
                                                               └───────────────┘
   ┌───────────────┬───────────┬───────────────┬───────────────┬───────────────┐
   │ N             │ N         │ N             │ N             │ N             │ N
┌───────────────┐ ┌─────────┐ ┌───────────────┐ ┌───────────┐ ┌───────────────┐ ┌───────────────┐
│   drawings    │ │indicator│ │  pine_scripts │ │  alerts   │ │   layouts     │ │ sim_accounts  │
│               │ │_presets ├─┤ (scriptId FK) │ │ └ events  │ │               │ │ └ sim_positions│
└───────────────┘ └─────────┘ └───────────────┘ └───────────┘ └───────────────┘ └──────┬────────┘
                                                                                        │
                                                        ┌───────────────┐               │
                                                        │journal_entries│──position_id──┘
                                                        │ └ screenshots  │  (nullable)
                                                        └───────────────┘
```

---

## 5. Schema — Authentication & identity

### 5.1 `users`

```sql
CREATE TYPE user_status AS ENUM ('active', 'disabled', 'deleted');

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext UNIQUE NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  display_name   text,
  photo_url      text,
  status         user_status NOT NULL DEFAULT 'active',
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
```

### 5.2 `auth_identities`

One row per linked provider. Currently only `google` (via Firebase); shape supports adding more.

```sql
CREATE TYPE auth_provider AS ENUM ('google');

CREATE TABLE auth_identities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      auth_provider NOT NULL,
  provider_uid  text NOT NULL,              -- Google 'sub' / stable provider id
  firebase_uid  text,                       -- Firebase Auth uid (verified from ID token)
  raw_profile   jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);
CREATE INDEX idx_auth_identities_user ON auth_identities(user_id);
CREATE UNIQUE INDEX idx_auth_identities_firebase ON auth_identities(firebase_uid)
  WHERE firebase_uid IS NOT NULL;
```

### 5.3 `sessions` (refresh tokens)

```sql
CREATE TABLE sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL,          -- SHA-256 of the opaque refresh token
  user_agent         text,
  ip                 inet,
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,            -- non-null = logged out / rotated
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user ON sessions(user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX idx_sessions_token ON sessions(refresh_token_hash);
```

### 5.4 `push_tokens` (FCM)

Mirrors the frontend `pushNotifications` store: one `PushRegistration { token, permission,
createdAt, updatedAt }` per browser.

```sql
CREATE TYPE push_platform AS ENUM ('web', 'android', 'ios');

CREATE TABLE push_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fcm_token    text NOT NULL,
  platform     push_platform NOT NULL DEFAULT 'web',
  permission   text,                          -- 'granted' | 'denied' | 'default'
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fcm_token)
);
CREATE INDEX idx_push_tokens_user ON push_tokens(user_id);
```

---

## 6. Schema — User workspace / preferences

### 6.1 `user_settings` (1:1)

Collapses several small localStorage blobs into one row per user, one jsonb section each.

```sql
CREATE TABLE user_settings (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ui            jsonb NOT NULL DEFAULT '{}',  -- `ui` store: theme, panels, bottomOpen, shell flags
  smc           jsonb NOT NULL DEFAULT '{}',  -- `smc-settings-v2`: 8 overlay toggles (SmcSettings)
  chart         jsonb NOT NULL DEFAULT '{}',  -- timezone, drawing preferences, `favoriteTimeframes`
  notifications jsonb NOT NULL DEFAULT '{}',  -- global AlertSettings: toast/sound/browser/push/telegram/discord
  updated_at    timestamptz NOT NULL DEFAULT now()
);
```

The database defaults stay compact, but the settings repository normalizes `{}` before returning
API responses. Current normalized defaults include the UI shell, all SMC toggles disabled, chart
timezone `exchange`, global drawing scope, empty drawing-tool preferences, and chart favorite
timeframes `1m`, `5m`, `15m` when that field is absent. An explicit empty favorite array is
preserved. This lets fresh users and old rows receive sensible toolbar defaults without a data
migration.

### 6.2 `layouts` (chart layouts / templates)

```sql
CREATE TABLE layouts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  symbol     text,
  timeframe  text,
  state      jsonb NOT NULL DEFAULT '{}',   -- indicators + drawings + panel snapshot
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_layouts_user ON layouts(user_id);
```

---

## 7. Schema — Charting artifacts

### 7.1 `watchlists` + `watchlist_symbols`

Today's single `watchlist` string array becomes the user's "Default" list.

```sql
CREATE TABLE watchlists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL DEFAULT 'Default',
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_watchlists_user ON watchlists(user_id);

CREATE TABLE watchlist_symbols (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id uuid NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  symbol       text NOT NULL,
  position     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (watchlist_id, symbol)
);
CREATE INDEX idx_watchlist_symbols_list ON watchlist_symbols(watchlist_id);
```

Migration `0005_watchlist_layout` extends this schema for the current
TradingView-style watchlist UI:

```sql
ALTER TABLE watchlists
  ADD COLUMN shared boolean NOT NULL DEFAULT false;

CREATE TABLE watchlist_sections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id uuid NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  title        text NOT NULL,
  symbol_index integer NOT NULL DEFAULT 0,
  position     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE watchlist_preferences (
  user_id             uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_watchlist_id uuid REFERENCES watchlists(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
```

The frontend writes section edits and symbol/section drag-drop through one
full-layout endpoint, so `watchlist_sections.symbol_index` is the section
divider's insertion index in the ordered `watchlist_symbols` array.

Migration `0006_watchlist_sort_preferences` adds the selected TradingView-style
Sort by mode to each list:

```sql
ALTER TABLE watchlists
  ADD COLUMN sort_key text NOT NULL DEFAULT 'symbol',
  ADD COLUMN sort_dir text NOT NULL DEFAULT 'asc';
```

`sort_key` is one of `symbol`, `price`, `change`, `changeAbs`, or `volume`.
`sort_dir` is `asc` or `desc`. The frontend still computes live price/change
ordering from realtime quotes, but the selected sort mode is restored from the
backend on refresh and across devices.

### 7.2 `drawings`

One row per drawing (`Drawing`, ~35 tool types). Geometry/style stay in `payload jsonb` verbatim —
the backend stores & scopes, never interprets. `tool_type` is a copy of `Drawing.tool` for filtering.

```sql
CREATE TABLE drawings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol     text NOT NULL,
  tool_type  text NOT NULL,                 -- Drawing.tool: 'trendline' | 'rectangle' | 'long' | ...
  payload    jsonb NOT NULL,                -- full Drawing (points, style, text, riskValue/riskUnit, ...)
  locked     boolean NOT NULL DEFAULT false,
  hidden     boolean NOT NULL DEFAULT false,
  client_id  text,                          -- frontend Drawing.id (epoch/uid) for sync dedupe
  revision   bigint NOT NULL DEFAULT 1,     -- monotonic server revision for conditional writes
  client_revision bigint NOT NULL DEFAULT 0,-- latest acknowledged local mutation counter
  deleted_at timestamptz,                   -- tombstone; normal list queries exclude deleted rows
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_drawings_user_symbol ON drawings(user_id, symbol);
CREATE UNIQUE INDEX idx_drawings_client ON drawings(user_id, client_id)
  WHERE client_id IS NOT NULL;
CREATE INDEX idx_drawings_tombstones ON drawings(user_id, updated_at)
  WHERE deleted_at IS NOT NULL;
```

### 7.3 `drawing_templates`

**Global** (not per-symbol) style presets — the frontend `drawingTemplates` key, one row per saved
`DrawingTemplate`. Style-only: no points/ids (a bad template can't move or duplicate objects).

```sql
CREATE TABLE drawing_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  family     text NOT NULL,                 -- StyleFamily: 'line' | 'shape' | 'text'
  style      jsonb NOT NULL DEFAULT '{}',   -- DrawingTemplate style fields (color, lineWidth, fib*, text*)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name, family)
);
CREATE INDEX idx_drawing_templates_user ON drawing_templates(user_id);
```

### 7.4 `drawing_tool_favorites`

**Global** ordered list of drawing tool ids starred in the drawing flyouts and shown in the
floating favorites toolbar. The frontend owns the tool registry, so the backend stores ids as an
opaque `jsonb` array and only scopes them by `user_id`.

```sql
CREATE TABLE drawing_tool_favorites (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tools      jsonb NOT NULL DEFAULT '[]',       -- e.g. ["trendline", "long", "fib"]
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_drawing_tool_favorites_array CHECK (jsonb_typeof(tools) = 'array')
);
```

### 7.5 `pine_scripts`

Matches `CustomIndicatorScript` (`pineScripts` key). **Create before `indicator_presets`** — the
latter FKs into this.

```sql
CREATE TABLE pine_scripts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  source_code text NOT NULL,                 -- frontend `sourceCode`
  favorite    boolean NOT NULL DEFAULT false,
  meta        jsonb NOT NULL DEFAULT '{}',   -- parsed Pine version/declaration, inputs/styles, diagnostics
  client_id   text,                          -- frontend script id (for scriptId links + sync)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pine_scripts_user ON pine_scripts(user_id);
CREATE UNIQUE INDEX idx_pine_scripts_client ON pine_scripts(user_id, client_id)
  WHERE client_id IS NOT NULL;
```

`source_code` is the source of truth for execution. `meta` is a rehydratable
cache of Pine metadata (including the `//@version` annotation and declaration
properties such as `shorttitle`, `overlay`, `timeframe`, object limits, and
`calc_bars_count`), input/style schemas, and the latest diagnostic summary. The
backend must re-parse source when the source or runtime version changes; stale
metadata must never change execution semantics. Saved and public scripts use
the same closed-bar compiler and optional replay cutoff as catalog indicators.
The submitted Swing Highs/Lows v5 source is an ordinary saved script/fixture,
not a special database indicator type; preserve its LuxAlgo attribution and
CC BY-NC-SA 4.0 notice when storing or publishing it.

### 7.6 `public_pine_scripts`

Public Store entries for Pine scripts. The Store is readable without auth, but
rows are created/updated only through an authenticated owner publish action.
`source_code` is copied from the private script at publish time so Store reads do
not need to join private script permissions.

```sql
CREATE TABLE public_pine_scripts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id   uuid NOT NULL REFERENCES pine_scripts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  source_code text NOT NULL,
  meta        jsonb NOT NULL DEFAULT '{}',
  boosts      integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (script_id)
);
CREATE INDEX idx_public_pine_scripts_user ON public_pine_scripts(user_id);
CREATE INDEX idx_public_pine_scripts_updated ON public_pine_scripts(updated_at DESC);
```

### 7.7 `indicator_presets`

One row per `IndicatorConfig` (`indicators` key). The whole config lives in `config jsonb`
(length/length2/length3, colors, `inputValues`, `styleValues`); a few fields are promoted to columns
for filtering/ordering. `CUSTOM` indicators link to a saved script.

```sql
CREATE TABLE indicator_presets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  indicator_type text NOT NULL,             -- IndicatorConfig.type: SMA|EMA|VWAP|RSI|MACD|ADR|FVG|CUSTOM
  script_id      uuid REFERENCES pine_scripts(id) ON DELETE SET NULL,  -- for CUSTOM (frontend scriptId)
  config         jsonb NOT NULL DEFAULT '{}',-- full IndicatorConfig
  visible        boolean NOT NULL DEFAULT true, -- IndicatorConfig.visible
  position       integer NOT NULL DEFAULT 0,
  client_id      text,                       -- frontend IndicatorConfig.id for idempotent sync
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_indicator_presets_user ON indicator_presets(user_id);
CREATE UNIQUE INDEX idx_indicator_presets_client ON indicator_presets(user_id, client_id)
  WHERE client_id IS NOT NULL;
```

`indicator_type` is intentionally an opaque compatibility value rather than a
foreign key to the current catalog. Legacy rows containing `SWING_SR` may remain
after that catalog entry is removed; reads must classify them as deprecated or
unavailable (or offer an explicit migration to a saved Pine script), and writes
must not create new `SWING_SR` rows. Deleting a catalog entry must not delete a
user's saved preset or Pine source.

---

## 8. Schema — Alerts

Reconciled with the frontend `Alert` (per-alert delivery channels + `enabled`/`locked`/`note`) and
`AlertHistoryEntry`. The global `AlertSettings` lives in `user_settings.notifications` (§6.1), not
here.

### 8.1 `alerts`

```sql
CREATE TYPE alert_condition AS ENUM ('above', 'below', 'crossUp', 'crossDown');
CREATE TYPE alert_status    AS ENUM ('active', 'triggered', 'expired'); -- paused == enabled=false

CREATE TABLE alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id     text,                         -- frontend Alert.id for idempotent sync
  symbol        text NOT NULL,
  condition     alert_condition NOT NULL,
  price         numeric(20,8) NOT NULL,       -- target price
  note          text,                         -- frontend `note`
  status        alert_status NOT NULL DEFAULT 'active',
  enabled       boolean NOT NULL DEFAULT true, -- paused when false
  locked        boolean NOT NULL DEFAULT false,
  recurring     boolean NOT NULL DEFAULT false,
  -- per-alert delivery channels (frontend Alert flags)
  sound         boolean NOT NULL DEFAULT true,
  browser       boolean NOT NULL DEFAULT false,
  push          boolean NOT NULL DEFAULT false,
  telegram      boolean NOT NULL DEFAULT false,
  discord       boolean NOT NULL DEFAULT false,
  trigger_price numeric(20,8),                -- price at last trigger
  triggered_at  timestamptz,
  technical_target jsonb,                     -- immutable versioned fixed/line/channel geometry
  arming_revision bigint NOT NULL DEFAULT 1 CHECK (arming_revision > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_alerts_user ON alerts(user_id);
CREATE INDEX idx_alerts_active_symbol ON alerts(symbol) WHERE status = 'active' AND enabled;
CREATE UNIQUE INDEX idx_alerts_client ON alerts(user_id, client_id) WHERE client_id IS NOT NULL;
```

`arming_revision` advances only when an arming input changes (`symbol`,
`condition`, `price`, `recurring`, `technical_target`) or an inactive alert is
explicitly re-armed. Note, channel, lock, pause, and delivery-setting edits keep
the revision stable. Trigger evidence must carry the matching revision.

Migration `0021` intentionally retains the `expired` enum label on rollback:
PostgreSQL has no safe `DROP VALUE`. Its down migration converts expired rows to
active and drops `arming_revision`, avoiding a table/type rebuild with dependent
indexes.

### 8.2 `alert_events` (trigger history)

Matches `AlertHistoryEntry { alertId, symbol, condition, targetPrice, triggerPrice, triggerTime }`.
Frontend caps history at 200 rows — enforce a per-user prune on write or via a periodic job.

```sql
CREATE TABLE alert_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id      uuid REFERENCES alerts(id) ON DELETE SET NULL,
  alert_ref     text NOT NULL,                 -- stable client_id/UUID retained after alert deletion
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol        text NOT NULL,
  condition     alert_condition NOT NULL,
  target_price  numeric(20,8) NOT NULL,
  trigger_price numeric(20,8) NOT NULL,
  triggered_at  timestamptz NOT NULL DEFAULT now(),
  delivered     boolean NOT NULL DEFAULT false, -- legacy/reserved; not provider delivery truth
  arming_revision bigint                        -- nullable only for pre-0022 history
);
CREATE INDEX idx_alert_events_alert ON alert_events(alert_id);
CREATE INDEX idx_alert_events_ref ON alert_events(user_id, alert_ref, triggered_at DESC);
CREATE INDEX idx_alert_events_user ON alert_events(user_id, triggered_at DESC);
CREATE UNIQUE INDEX idx_alert_events_trigger_attempt
  ON alert_events(alert_id, arming_revision, triggered_at)
  WHERE alert_id IS NOT NULL AND arming_revision IS NOT NULL;
```

`delivered` is not updated by the current worker and must not be interpreted as
provider acceptance. Retry state is maintained per FCM device/channel in the
worker store; Telegram/Discord are grouped per event/channel within one evaluator
run. There is no transactional provider outbox.

Triggering is transactional: update `alerts`, insert `alert_events`, then prune
older user events beyond 200 before commit. `alert_id` is nullable by design;
deleting or clearing a triggered alert must not erase the History audit trail
shown by the frontend.

Migration `0022` writes `arming_revision` on every new event and uniquely keys a
trigger attempt by `(alert_id, arming_revision, triggered_at)`, where
`triggered_at` is the accepted current-evidence timestamp. The same alert ID,
arming revision, and evidence timestamp represents the same immutable market
observation, so an exact browser/worker retry returns the existing event. A
different price or target under that identity is a collision and is rejected.
The row lock and index provide this idempotency for recurring as well as one-time
alerts, while a later evidence timestamp or re-armed revision is a distinct
attempt.

---

## 9. Schema — Simulated trading (backtest / replay)

The replay/trade simulator is runtime-only today. Reconciled with the frontend `Position` — which is
**self-contained** (embedded `fills[]`, split realized/unrealized PnL, `pending→open→closed/cancelled`
lifecycle), so there is **no separate `orders` table**: a pending order is a `sim_positions` row with
`status='pending'`. The fill engine stays in `services/tradeEngine.ts`; the DB stores snapshots.

> **Create §9 before §10** — `journal_entries.position_id` FKs into `sim_positions`.

```sql
CREATE TYPE trade_side      AS ENUM ('long', 'short');   -- frontend Side (NOT buy/sell)
CREATE TYPE order_type      AS ENUM ('market', 'limit', 'stop');
CREATE TYPE position_status AS ENUM ('pending', 'open', 'closed', 'cancelled');

CREATE TABLE sim_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            text NOT NULL DEFAULT 'Default',
  starting_equity numeric(20,8) NOT NULL DEFAULT 10000,
  currency        text NOT NULL DEFAULT 'USD',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sim_accounts_user ON sim_accounts(user_id);

CREATE TABLE sim_positions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES sim_accounts(id) ON DELETE CASCADE,
  symbol         text NOT NULL,
  side           trade_side NOT NULL,
  type           order_type NOT NULL,           -- entry order type
  status         position_status NOT NULL DEFAULT 'pending',
  entry          numeric(20,8),                 -- average entry (null while pending)
  quantity       numeric(20,8) NOT NULL,
  remaining      numeric(20,8) NOT NULL,        -- open remainder
  stop_loss      numeric(20,8),
  take_profit    numeric(20,8),
  risk_pct       numeric(20,8),
  risk_amount    numeric(20,8) NOT NULL DEFAULT 0,
  realized_pnl   numeric(20,8) NOT NULL DEFAULT 0,
  unrealized_pnl numeric(20,8) NOT NULL DEFAULT 0,
  fills          jsonb NOT NULL DEFAULT '[]',    -- Fill[] { time, price, quantity, kind }
  notes          text,
  client_id      text,                           -- frontend Position.id for sync dedupe
  open_time      timestamptz,
  close_time     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sim_positions_account ON sim_positions(account_id);
CREATE INDEX idx_sim_positions_open ON sim_positions(account_id) WHERE status = 'open';
```

---

## 10. Schema — Journal & screenshots

Reconciled with the frontend `JournalEntry` — **trade-centric** (side, entry/exit time+price,
quantity, pnl, realized R, riskAmount, tags), not a free-text note. Screenshots are `ScreenshotRef`
with a `phase`; the blob lives in object storage (IndexedDB `{ id, blob }` today).

```sql
CREATE TABLE journal_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol       text NOT NULL,
  side         trade_side NOT NULL,           -- 'long' | 'short'
  entry_time   timestamptz NOT NULL,
  exit_time    timestamptz,
  entry_price  numeric(20,8) NOT NULL,
  exit_price   numeric(20,8),
  quantity     numeric(20,8) NOT NULL,
  pnl          numeric(20,8),
  rr           numeric(20,8),                 -- realized R multiple (frontend `rr`)
  risk_amount  numeric(20,8),
  notes        text,
  tags         text[] NOT NULL DEFAULT '{}',
  position_id  uuid REFERENCES sim_positions(id) ON DELETE SET NULL,  -- optional link to a sim trade
  client_id    text,                          -- frontend JournalEntry.id for sync dedupe
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_journal_user ON journal_entries(user_id, entry_time DESC);
CREATE INDEX idx_journal_symbol ON journal_entries(user_id, symbol);
CREATE INDEX idx_journal_tags ON journal_entries USING gin (tags);

CREATE TYPE screenshot_phase AS ENUM ('before', 'after-entry', 'after-exit');

CREATE TABLE screenshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journal_entry_id  uuid REFERENCES journal_entries(id) ON DELETE CASCADE,
  phase             screenshot_phase,           -- ScreenshotRef.phase
  storage_key       text NOT NULL,              -- object storage path (blob lives there, not in DB)
  thumbnail_key     text,
  width             integer,
  height            integer,
  size_bytes        bigint,
  content_type      text NOT NULL DEFAULT 'image/png',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_screenshots_user ON screenshots(user_id);
CREATE INDEX idx_screenshots_entry ON screenshots(journal_entry_id);
```

---

## 11. Sync strategy (client cache ↔ server)

The frontend already persists to localStorage/IndexedDB. Treat it as a write-through cache:

1. **On sign-in** — pull the server snapshot (`GET /api/v1/sync/bootstrap`) and merge into the local
   stores; server wins on conflict by `updated_at`.
2. **On mutation** — write locally first (optimistic, current behavior), then `POST/PUT/DELETE`.
   `client_id` (on `drawings`, `pine_scripts`, `sim_positions`, `journal_entries`) dedupes retries and
   converges multi-device edits.
3. **Offline** — queue mutations; flush on reconnect. `updated_at` last-write-wins (no CRDT at this
   scale).
4. **Anonymous users** — everything stays local exactly as today; the local workspace uploads once on
   first sign-in.

Server authoritative, client cache — so auth can ship before every feature is migrated.

---

## 12. Migration plan (order matters)

```
0001_extensions.sql   pgcrypto, citext
0002_auth.sql         users, auth_identities, sessions, push_tokens (+ enums)
0003_settings.sql     user_settings (ui/smc/chart/notifications), layouts
0004_watchlists.sql              watchlists + symbols
0005_watchlist_layout.sql        sections + shared metadata
0006_watchlist_sort_preferences  watchlist sort preference
0007_drawings.sql                drawings + templates
0008_drawing_tool_favorites.sql  favorite drawing tools
0009_indicator_presets.sql       pine scripts + indicator presets
0010_public_pine_scripts.sql     published public indicator Store
0011_alerts.sql                  alerts + retained alert events (+ enums)
0012_replay_backend.sql          replay sessions, tracks, datasets and chunks
0013_replay_clock.sql            replay actor clock state
0014_replay_trading.sql          replay accounts, orders, fills and positions
0015_journal.sql                 journal entries, screenshots, blob deletion queue
0016_simulated_trading.sql       simulator accounts + snapshot positions, journal position FK
0017_user_integrations.sql      encrypted MT5/Telegram/Discord integration settings
0018_drawing_revisions.sql      optimistic drawing revisions and delete tombstones
0019_alert_source.sql           immutable drawing provenance for fixed-price alerts
0020_alert_technical_target.sql versioned fixed/dynamic technical alert geometry
0021_alert_expiration_and_arming_revision.sql  expired lifecycle + arming revision
0022_alert_event_idempotency.sql event arming revision + unique trigger attempt
0023_mt5_verification.sql      nullable per-user MT5 verification timestamp
```

`0015_journal` initially leaves `journal_entries.position_id` nullable without a foreign key because
`replay_positions` is not interchangeable with simulator positions. `0016_simulated_trading`
creates `sim_positions` and adds the FK. `0017`–`0023` add integrations, drawing conflict metadata,
immutable alert provenance, dynamic technical targets, expiration, re-arming, and idempotent
trigger attempts, followed by per-user MT5 verification. The current development schema head is
version `23`.

---

## 13. Retention & privacy

- **Account deletion** cascades through every `user_id` FK — one `DELETE FROM users` wipes the user.
- `sessions.revoked_at` + short access-token TTL bound the blast radius of a stolen token.
- `raw_profile` stores only what Google returns (name, email, picture) — no extra scopes requested.
- A `BEFORE DELETE` trigger on `screenshots` writes `storage_key`/`thumbnail_key` into
  `object_deletion_queue`, including deletes caused by journal/account cascades. API deletes log
  the storage key before the cascade. A future worker consumes the durable queue out-of-band.
- `alert_events` are pruned to the newest ~200 per user (matches the frontend cap).
