# Database Design

> Status: **Design / planning** (not yet implemented). This document is the source of truth for the
> persistence layer the Go Fiber backend will own. Nothing here is wired into `internal/` yet.
> See `AUTH.md` for the Google auth flow and `API.md` for the endpoints that read/write these tables.

---

## 1. Goals & context

Today the frontend keeps **all** user data in the browser:

| Current store (frontend)              | Where it lives          | Becomes DB table(s)                 |
| ------------------------------------- | ----------------------- | ----------------------------------- |
| `ui`                                  | localStorage            | `user_settings.ui`                  |
| `smc-settings`                        | localStorage            | `user_settings.smc`                 |
| `drawings:<symbol>`                   | localStorage            | `drawings`                          |
| `indicators`                          | localStorage            | `indicator_presets`                 |
| `pineScripts`                         | localStorage            | `pine_scripts`                      |
| `watchlist`                           | localStorage            | `watchlists` + `watchlist_symbols`  |
| `alerts`                              | localStorage            | `alerts` + `alert_events`           |
| `journal` (IndexedDB)                 | IndexedDB               | `journal_entries`                   |
| `screenshots` (IndexedDB)             | IndexedDB               | `screenshots` (+ object storage)    |
| FCM push token                        | runtime                 | `push_tokens`                       |
| simulated equity / positions          | runtime only            | `sim_accounts` / `positions` / `orders` |

The backend becomes the **durable source of truth** so a signed-in user gets the same workspace on
any device. The browser stores keep working as a **local cache / offline buffer**; a sync layer
reconciles them against the API. This preserves the "single source of truth / no duplicate
architecture" principle: the *server* is authoritative, the client caches.

Everything user-owned is scoped by `user_id` and cascades on user deletion (GDPR-friendly hard
delete + a soft-delete option per row where history matters).

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
| Flexible payloads    | `jsonb` (drawing geometry, settings, indicator opts)|
| Large binaries       | Object storage (S3/R2), DB holds only metadata      |

Required extensions:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email
```

---

## 3. Conventions

- Every table has `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` unless it is a pure join table.
- Every table has `created_at timestamptz NOT NULL DEFAULT now()`.
- Mutable tables have `updated_at timestamptz NOT NULL DEFAULT now()` maintained by a trigger.
- User-owned rows have `user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`.
- Enumerable states use a Postgres `ENUM` type (documented per table).
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
        ┌───────────────┬───────┼───────────────┬───────────────┐
        │ N             │ N     │ N             │ N             │ N
┌───────────────┐ ┌───────────┐ │ ┌───────────────┐ ┌───────────────┐
│auth_identities│ │  sessions │ │ │ user_settings │ │  push_tokens  │
└───────────────┘ └───────────┘ │ │  (1:1)        │ └───────────────┘
                                │ └───────────────┘
        ┌───────────────┬───────┼───────────────┬───────────────┐
        │ N             │ N     │ N             │ N             │ N
┌───────────────┐ ┌───────────┐ │ ┌───────────────┐ ┌───────────────┐
│  watchlists   │ │  drawings │ │ │indicator_preset│ │  pine_scripts │
│   └ symbols   │ └───────────┘ │ └───────────────┘ └───────────────┘
└───────────────┘               │
        ┌───────────────┬───────┼───────────────┬───────────────┐
        │ N             │ N     │ N             │ N
┌───────────────┐ ┌───────────┐ │ ┌───────────────┐
│    alerts     │ │  journal  │ │ │  sim_accounts │
│  └ events     │ │  entries  │ │ │   └ orders    │
└───────────────┘ │ └ screensh.│ │ │   └ positions │
                  └───────────┘ │ └───────────────┘
                                │
                        ┌───────────────┐
                        │    layouts    │
                        └───────────────┘
```

---

## 5. Schema — Authentication & identity

### 5.1 `users`

Canonical account. One row per human, regardless of how many providers they link.

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

One row per linked provider. Currently only `google` (via Firebase), but the shape supports adding
`github`, `apple`, `password`, etc. later with zero schema change.

```sql
CREATE TYPE auth_provider AS ENUM ('google');

CREATE TABLE auth_identities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      auth_provider NOT NULL,
  provider_uid  text NOT NULL,              -- Google 'sub' / stable provider id
  firebase_uid  text,                       -- Firebase Auth uid (verified from ID token)
  raw_profile   jsonb NOT NULL DEFAULT '{}',-- last-seen provider claims (name, picture, ...)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);
CREATE INDEX idx_auth_identities_user ON auth_identities(user_id);
CREATE UNIQUE INDEX idx_auth_identities_firebase ON auth_identities(firebase_uid)
  WHERE firebase_uid IS NOT NULL;
```

### 5.3 `sessions` (refresh tokens)

The backend issues a short-lived **access JWT** (stateless, not stored) and a long-lived
**refresh token** (stored hashed, rotatable, revocable). One row = one active device/browser.

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

Moves the current runtime-only FCM registration into a durable per-user list so push alerts survive
reloads and target every device.

```sql
CREATE TYPE push_platform AS ENUM ('web', 'android', 'ios');

CREATE TABLE push_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fcm_token    text NOT NULL,
  platform     push_platform NOT NULL DEFAULT 'web',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fcm_token)
);
CREATE INDEX idx_push_tokens_user ON push_tokens(user_id);
```

---

## 6. Schema — User workspace / preferences

### 6.1 `user_settings` (1:1)

Collapses `ui` and `smc-settings` (and future chart defaults) into a single row per user. These are
small, read together on load, and rarely conflict — a single JSON row per section is the right grain.

```sql
CREATE TABLE user_settings (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ui         jsonb NOT NULL DEFAULT '{}',   -- theme, panel layout, bottomTab, flags
  smc        jsonb NOT NULL DEFAULT '{}',   -- SMC feature toggles + thresholds
  chart      jsonb NOT NULL DEFAULT '{}',   -- default timeframe, chart style, colors
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### 6.2 `layouts` (chart layouts / templates)

TradingView-style saved layouts. Optional but maps naturally to "save chart layout / template".

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

Supports multiple named watchlists (today's single localStorage array becomes the "Default" list).

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

### 7.2 `drawings`

One row per drawing object. Geometry/style stays in `jsonb` to mirror the frontend
`DRAWING_OBJECT_MODEL` exactly — the backend never needs to interpret it, only store & scope it.

```sql
CREATE TABLE drawings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol     text NOT NULL,
  tool_type  text NOT NULL,                 -- 'trendline' | 'rectangle' | 'fib' | ...
  payload    jsonb NOT NULL,                -- points, style, text, meta (client model)
  locked     boolean NOT NULL DEFAULT false,
  hidden     boolean NOT NULL DEFAULT false,
  client_id  text,                          -- client-generated id for sync dedupe
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_drawings_user_symbol ON drawings(user_id, symbol);
CREATE UNIQUE INDEX idx_drawings_client ON drawings(user_id, client_id)
  WHERE client_id IS NOT NULL;
```

### 7.3 `indicator_presets`

```sql
CREATE TABLE indicator_presets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  indicator_type text NOT NULL,             -- 'EMA' | 'RSI' | 'MACD' | 'CUSTOM' ...
  name           text,
  settings       jsonb NOT NULL DEFAULT '{}',
  enabled        boolean NOT NULL DEFAULT true,
  position       integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_indicator_presets_user ON indicator_presets(user_id);
```

### 7.4 `pine_scripts`

User-authored Pine-like source indicators.

```sql
CREATE TABLE pine_scripts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  source     text NOT NULL,                 -- raw script source
  meta       jsonb NOT NULL DEFAULT '{}',   -- inputs, plot config, last compile status
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pine_scripts_user ON pine_scripts(user_id);
```

---

## 8. Schema — Alerts

### 8.1 `alerts`

```sql
CREATE TYPE alert_condition AS ENUM ('above', 'below', 'crossUp', 'crossDown');
CREATE TYPE alert_status    AS ENUM ('active', 'paused', 'triggered', 'expired');

CREATE TABLE alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol      text NOT NULL,
  condition   alert_condition NOT NULL,
  price       numeric(20,8) NOT NULL,
  message     text,
  recurring   boolean NOT NULL DEFAULT false,
  status      alert_status NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  triggered_at timestamptz
);
CREATE INDEX idx_alerts_user ON alerts(user_id);
CREATE INDEX idx_alerts_active_symbol ON alerts(symbol) WHERE status = 'active';
```

### 8.2 `alert_events` (trigger history)

```sql
CREATE TABLE alert_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id     uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  price        numeric(20,8) NOT NULL,
  delivered    boolean NOT NULL DEFAULT false   -- push/notification delivery result
);
CREATE INDEX idx_alert_events_alert ON alert_events(alert_id);
CREATE INDEX idx_alert_events_user ON alert_events(user_id, triggered_at DESC);
```

---

## 9. Schema — Journal & screenshots

### 9.1 `journal_entries`

```sql
CREATE TABLE journal_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol      text,
  position_id uuid REFERENCES positions(id) ON DELETE SET NULL,  -- optional link to a sim trade
  title       text,
  notes       text,
  tags        text[] NOT NULL DEFAULT '{}',
  rating      smallint CHECK (rating BETWEEN 0 AND 5),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_journal_user ON journal_entries(user_id, created_at DESC);
CREATE INDEX idx_journal_tags ON journal_entries USING gin (tags);
```

### 9.2 `screenshots`

Binary blobs live in object storage (S3/R2). The DB holds metadata + the storage key only — never
the bytes. This keeps the DB small and lets the CDN serve images.

```sql
CREATE TABLE screenshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journal_entry_id  uuid REFERENCES journal_entries(id) ON DELETE CASCADE,
  storage_key       text NOT NULL,          -- object storage path
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

## 10. Schema — Simulated trading (backtest / replay)

The replay/trade simulator is currently runtime-only. Persisting it enables durable backtest
sessions and analytics over history.

```sql
CREATE TYPE order_side   AS ENUM ('buy', 'sell');
CREATE TYPE order_type   AS ENUM ('market', 'limit', 'stop');
CREATE TYPE order_status AS ENUM ('pending', 'filled', 'cancelled', 'rejected');
CREATE TYPE position_status AS ENUM ('open', 'closed');

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

CREATE TABLE orders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES sim_accounts(id) ON DELETE CASCADE,
  symbol     text NOT NULL,
  side       order_side NOT NULL,
  type       order_type NOT NULL,
  qty        numeric(20,8) NOT NULL,
  price      numeric(20,8),                 -- null for market
  sl         numeric(20,8),
  tp         numeric(20,8),
  status     order_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  filled_at  timestamptz
);
CREATE INDEX idx_orders_account ON orders(account_id);

CREATE TABLE positions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES sim_accounts(id) ON DELETE CASCADE,
  symbol      text NOT NULL,
  side        order_side NOT NULL,
  qty         numeric(20,8) NOT NULL,
  entry_price numeric(20,8) NOT NULL,
  sl          numeric(20,8),
  tp          numeric(20,8),
  status      position_status NOT NULL DEFAULT 'open',
  pnl         numeric(20,8),
  r_multiple  numeric(20,8),
  opened_at   timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz
);
CREATE INDEX idx_positions_account ON positions(account_id);
CREATE INDEX idx_positions_open ON positions(account_id) WHERE status = 'open';
```

> Ordering note: `journal_entries.position_id` references `positions`, so create the trading tables
> (§10) **before** the journal table (§9) in the migration, or add the FK in a later `ALTER TABLE`.

---

## 11. Sync strategy (client cache ↔ server)

The frontend already persists to localStorage/IndexedDB. Rather than rip that out, treat it as a
write-through cache:

1. **On sign-in** — pull the server snapshot (`GET /api/v1/sync/bootstrap`) and merge into the local
   stores; server wins on conflict by `updated_at`.
2. **On mutation** — write locally first (optimistic, current behavior), then `POST/PUT/DELETE` to
   the API. `client_id` on `drawings` (and similar) dedupes retries.
3. **Offline** — queue mutations; flush on reconnect. `updated_at` last-write-wins keeps it simple
   for a single-user-multi-device model (no CRDT needed at this scale).
4. **Anonymous users** — everything stays local exactly as today; nothing is sent to the API until
   they sign in, at which point the local workspace is uploaded once.

This keeps "single source of truth" honest: **server authoritative, client cache**, and it means the
auth work can ship before every feature is migrated.

---

## 12. Migration plan (order matters)

```
0001_extensions.sql          pgcrypto, citext
0002_auth.sql                users, auth_identities, sessions, push_tokens (+ enums)
0003_settings.sql            user_settings, layouts
0004_charting.sql            watchlists, watchlist_symbols, drawings, indicator_presets, pine_scripts
0005_alerts.sql              alerts, alert_events (+ enums)
0006_trading.sql             sim_accounts, orders, positions (+ enums)
0007_journal.sql             journal_entries, screenshots  (FK to positions from 0006)
0008_triggers.sql            set_updated_at() + attach to all mutable tables
```

Roll out auth (`0001`–`0002`) first; the rest can land feature-by-feature as each store is migrated
off the browser.

---

## 13. Retention & privacy

- **Account deletion** cascades through every `user_id` FK — one `DELETE FROM users` wipes the user.
- `sessions.revoked_at` + short access-token TTL bound the blast radius of a stolen token.
- `raw_profile` stores only what Google returns (name, email, picture) — no extra scopes requested.
- Object-storage blobs (screenshots) are deleted out-of-band by a worker that reacts to
  `screenshots` row deletes (storage keys are logged before cascade).
