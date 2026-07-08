# Database Design

> Status: **Design / planning** (not yet implemented). Source of truth for the persistence layer the
> Go Fiber backend will own. See `AUTH.md` for the Google auth flow, `API.md` for endpoints, and
> `BACKEND_IMPLEMENTATION_PLAN.md` for the build order.
>
> **Audited against the frontend 2026-07-06** — every table below is reconciled with the real
> localStorage/IndexedDB shapes and TypeScript types (`frontend/src/types/*`, `store/*`). The jsonb
> columns intentionally mirror the frontend types so the client model can round-trip untouched.

---

## 1. Goals & context

Today the frontend keeps **all** user data in the browser. Exact keys and shapes (audited):

| Frontend store (exact key → shape)                                   | Where          | DB table(s)                                    |
| -------------------------------------------------------------------- | -------------- | ---------------------------------------------- |
| `ui` → `{ theme, panels }` **only**                                  | localStorage   | `user_settings.ui`                             |
| `smc-settings` → 8 boolean toggles (`SmcSettings`)                   | localStorage   | `user_settings.smc`                            |
| `tv:favoriteTimeframes` → `string[]`                                 | localStorage   | `user_settings.chart`                          |
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
  ui            jsonb NOT NULL DEFAULT '{}',  -- `ui` store: { theme, panels } ONLY (all that persists today)
  smc           jsonb NOT NULL DEFAULT '{}',  -- `smc-settings`: 8 overlay toggles (SmcSettings)
  chart         jsonb NOT NULL DEFAULT '{}',  -- default TF, chart style, `tv:favoriteTimeframes`
  notifications jsonb NOT NULL DEFAULT '{}',  -- global AlertSettings: toast/sound/browser/push/telegram/discord
  updated_at    timestamptz NOT NULL DEFAULT now()
);
```

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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_drawings_user_symbol ON drawings(user_id, symbol);
CREATE UNIQUE INDEX idx_drawings_client ON drawings(user_id, client_id)
  WHERE client_id IS NOT NULL;
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
  meta        jsonb NOT NULL DEFAULT '{}',   -- parsed inputs / plot config / last compile status
  client_id   text,                          -- frontend script id (for scriptId links + sync)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pine_scripts_user ON pine_scripts(user_id);
CREATE UNIQUE INDEX idx_pine_scripts_client ON pine_scripts(user_id, client_id)
  WHERE client_id IS NOT NULL;
```

### 7.6 `indicator_presets`

One row per `IndicatorConfig` (`indicators` key). The whole config lives in `config jsonb`
(length/length2/length3, colors, `inputValues`, `styleValues`); a few fields are promoted to columns
for filtering/ordering. `CUSTOM` indicators link to a saved script.

```sql
CREATE TABLE indicator_presets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  indicator_type text NOT NULL,             -- IndicatorConfig.type: SMA|EMA|VWAP|RSI|MACD|ADR|CUSTOM
  script_id      uuid REFERENCES pine_scripts(id) ON DELETE SET NULL,  -- for CUSTOM (frontend scriptId)
  config         jsonb NOT NULL DEFAULT '{}',-- full IndicatorConfig
  visible        boolean NOT NULL DEFAULT true, -- IndicatorConfig.visible
  position       integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_indicator_presets_user ON indicator_presets(user_id);
```

---

## 8. Schema — Alerts

Reconciled with the frontend `Alert` (per-alert delivery channels + `enabled`/`locked`/`note`) and
`AlertHistoryEntry`. The global `AlertSettings` lives in `user_settings.notifications` (§6.1), not
here.

### 8.1 `alerts`

```sql
CREATE TYPE alert_condition AS ENUM ('above', 'below', 'crossUp', 'crossDown');
CREATE TYPE alert_status    AS ENUM ('active', 'triggered');  -- frontend states; paused == enabled=false

CREATE TABLE alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_alerts_user ON alerts(user_id);
CREATE INDEX idx_alerts_active_symbol ON alerts(symbol) WHERE status = 'active' AND enabled;
```

### 8.2 `alert_events` (trigger history)

Matches `AlertHistoryEntry { alertId, symbol, condition, targetPrice, triggerPrice, triggerTime }`.
Frontend caps history at 200 rows — enforce a per-user prune on write or via a periodic job.

```sql
CREATE TABLE alert_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id      uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol        text NOT NULL,
  condition     alert_condition NOT NULL,
  target_price  numeric(20,8) NOT NULL,
  trigger_price numeric(20,8) NOT NULL,
  triggered_at  timestamptz NOT NULL DEFAULT now(),
  delivered     boolean NOT NULL DEFAULT false  -- push/notification delivery result
);
CREATE INDEX idx_alert_events_alert ON alert_events(alert_id);
CREATE INDEX idx_alert_events_user ON alert_events(user_id, triggered_at DESC);
```

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
0004_charting.sql     watchlists, watchlist_symbols, drawings, drawing_templates,
                      pine_scripts, indicator_presets   ← pine_scripts BEFORE indicator_presets (FK)
0005_alerts.sql       alerts, alert_events (+ enums)
0006_trading.sql      sim_accounts, sim_positions (+ trade_side/order_type/position_status enums)
0007_journal.sql      journal_entries (FK → sim_positions), screenshots (+ screenshot_phase enum)
0008_triggers.sql     set_updated_at() + attach to all mutable tables
```

Two hard ordering rules: **pine_scripts before indicator_presets** (0004), and **sim_positions
(0006) before journal_entries (0007)**. Roll out auth (`0001`–`0002`) first; the rest can land
feature-by-feature.

---

## 13. Retention & privacy

- **Account deletion** cascades through every `user_id` FK — one `DELETE FROM users` wipes the user.
- `sessions.revoked_at` + short access-token TTL bound the blast radius of a stolen token.
- `raw_profile` stores only what Google returns (name, email, picture) — no extra scopes requested.
- Object-storage blobs (screenshots) are deleted out-of-band by a worker reacting to `screenshots`
  row deletes (storage keys logged before cascade).
- `alert_events` are pruned to the newest ~200 per user (matches the frontend cap).
