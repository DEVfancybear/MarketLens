# Backend Implementation Plan (phased)

> Status: **planning**. A step-by-step build order for the Go backend, starting with Google auth and
> ending with per-feature persistence. Companion to `DATABASE.md` (schema), `AUTH.md` (auth flow),
> `API.md` (endpoint contract). Each phase is independently shippable and has explicit acceptance
> criteria so progress is unambiguous.

## ⚠ Framework reconciliation (read first)

The docs (`ARCHITECTURE.md`, `PROJECT_STRUCTURE.md`) declare **Fiber** as the backend framework, but
the code as of commit `64a33b0` actually uses the **Go 1.22 standard library** (`net/http` +
`http.ServeMux` method routing, see `internal/httpserver/server.go`, `internal/health/handler.go`).
`go.mod` has no Fiber dependency.

**Decision for this plan: adopt Fiber in Phase 0** (the documented decision; the current HTTP surface
is ~60 lines, so migration is cheap and the design docs already assume `fiber.Router` handlers).
If the team prefers to stay on stdlib instead, only Phase 0 changes — everything else (pgx, sqlc,
JWT, Firebase verify, repos) is framework-agnostic. Flag this before starting.

## Dependency additions (whole project)

| Purpose                | Module                                             |
| ---------------------- | -------------------------------------------------- |
| HTTP framework         | `github.com/gofiber/fiber/v2`                      |
| Postgres driver + pool | `github.com/jackc/pgx/v5` (`/pgxpool`)             |
| Migrations             | `github.com/golang-migrate/migrate/v4`             |
| Type-safe queries      | `sqlc` (dev tool; generates into `internal/db/gen`)|
| Firebase Admin (verify)| `firebase.google.com/go/v4`                        |
| Access JWT             | `github.com/golang-jwt/jwt/v5`                      |
| Dev env loading        | `github.com/joho/godotenv` (dev only)              |

---

## Phase 0 — Foundation & framework

**Goal:** Fiber app boots, config carries every new env var, shared helpers exist. No behavior change
for clients beyond the framework swap.

**Steps**
1. `go get` the Fiber + tooling deps above.
2. Rewrite `internal/httpserver/server.go` to build a `*fiber.App` (recover + request-id + the
   existing zerolog logging as Fiber middleware). Keep graceful shutdown (`app.ShutdownWithContext`).
3. Port `internal/health` to a Fiber handler; register `GET /health`.
4. Port `internal/middleware/logging.go` to Fiber middleware (or use `fiberzerolog`).
5. Extend `internal/config/config.go` with: `DatabaseURL`, `AuthJWTSecret`, `AuthAccessTTL`,
   `AuthRefreshTTL`, `FirebaseProjectID`, `FirebaseClientEmail`, `FirebasePrivateKey`,
   `CORSAllowedOrigins`. Fail fast if required secrets are missing when `APP_ENV != development`.
6. Add `backend/.env.example` documenting every var (mirror `AUTH.md` §8).
7. Add `internal/httpserver/response.go`: `WriteError(c, code, msg)` producing the standard
   `{ "error": { "code", "message" } }` shape from `API.md`.

**Acceptance**
- `go build ./...` and `go vet ./...` pass.
- Server starts on Fiber; `GET /health` returns the same JSON as before.
- Missing required secret in `production` aborts startup with a clear log line.

**Complexity:** Low–Medium.

---

## Phase 1 — Database layer

**Goal:** A live Postgres pool, a migration runner, and generated query code — no domain logic yet.

**Steps**
1. `internal/db/pool.go`: build a `pgxpool.Pool` from `DatabaseURL`; `Ping` on startup; expose
   `Close()`.
2. Add `backend/migrations/` and wire `golang-migrate` (a `make migrate-up` / small Go runner in
   `cmd/migrate`). Write:
   - `0001_extensions.(up|down).sql` — `pgcrypto`, `citext`.
   - `0002_auth.(up|down).sql` — `users`, `auth_identities`, `sessions`, `push_tokens` + enums +
     `set_updated_at()` trigger (from `DATABASE.md` §5).
3. Add `sqlc.yaml` + `internal/db/queries/*.sql`; generate typed Go into `internal/db/gen`.
   Start with user/identity/session queries only.
4. Add a readiness probe `GET /health/ready` that pings the pool (liveness `/health` stays DB-free).

**Acceptance**
- `migrate up` creates the auth tables on a local Postgres; `migrate down` reverses cleanly.
- `sqlc generate` produces compiling Go.
- `/health/ready` returns 200 when the DB is up, 503 when down.

**Complexity:** Medium.

---

## Phase 2 — Firebase ID-token verification

**Goal:** Given a Firebase ID token string, return verified claims (uid, email, name, picture).

**Steps**
1. `internal/auth/firebase.go`: initialize `firebase.NewApp` once from the service-account env
   (`FIREBASE_*`), expose an `*auth.Client`.
2. `internal/auth/verify.go`: `VerifyGoogleToken(ctx, idToken) (Identity, error)` calling
   `client.VerifyIDToken`; map claims → an internal `Identity{ UID, Email, Name, PhotoURL }`.
3. Distinguish error classes: expired, malformed, wrong audience → all surface as `unauthorized`.

**Acceptance**
- Unit test: a malformed/expired token returns an error, never a partial identity.
- Manual: a real Firebase ID token (from the frontend or Firebase REST) yields correct claims.

**Complexity:** Medium (Firebase Admin Go setup is the main effort).

---

## Phase 3 — Sessions & tokens (no HTTP yet)

**Goal:** Pure session/token services, unit-tested in isolation.

**Steps**
1. `internal/auth/jwt.go`: `MintAccess(userID, sessionID)` → HS256 JWT (`AuthJWTSecret`,
   `AuthAccessTTL`); `ParseAccess(token)` → claims.
2. `internal/auth/session.go`:
   - `Create(userID, ua, ip)` → generate 256-bit opaque refresh token, store SHA-256 hash in
     `sessions`, return raw token + session id.
   - `Rotate(rawRefresh)` → look up by hash; if revoked/expired → error; **reuse detection**: if a
     revoked token is presented, revoke the whole session family; else revoke old + insert new.
   - `Revoke(sessionID)` and `RevokeAll(userID)`.
3. `internal/auth/cookies.go`: `SetAuthCookies` / `ClearAuthCookies` (httpOnly, Secure gated by
   `APP_ENV`, SameSite=Lax, correct paths/max-age).

**Acceptance**
- Unit tests: mint→parse round-trip; expired access rejected; refresh rotate happy path; reuse of a
  revoked refresh token revokes the family.

**Complexity:** Medium.

---

## Phase 4 — Auth endpoints & middleware (the deliverable)

**Goal:** End-to-end Google login/register working from the frontend.

**Steps**
1. `internal/users/repo.go`: `UpsertFromIdentity(identity)` — find `auth_identities` by
   `(google, uid)`; insert user+identity if absent (register), else update profile + `last_login_at`
   (login). Returns `(user, isNewUser)`.
2. `internal/auth/service.go`: `LoginWithGoogle(ctx, idToken, ua, ip)` = verify → upsert → create
   session → mint access. Returns user + tokens.
3. `internal/auth/handler.go` (Fiber):
   - `POST /api/v1/auth/google`
   - `POST /api/v1/auth/refresh`
   - `POST /api/v1/auth/logout`  🔒
   - `GET  /api/v1/auth/me`       🔒
   - `DELETE /api/v1/auth/sessions` 🔒
4. `internal/auth/middleware.go`: `RequireAuth` — read `access_token` cookie, `ParseAccess`, put
   `user_id` + `session_id` in `c.Locals`; on failure return `401`.
5. Add CORS middleware (`CORSAllowedOrigins`, `AllowCredentials: true`). Register the `/api/v1` group
   and mount auth routes in `server.go`.

**Acceptance**
- From the frontend (or curl with a real ID token): `POST /auth/google` sets both cookies and
  returns the user; a second call with the same Google account returns `isNewUser: false`.
- `GET /auth/me` with the access cookie returns the user; without it → 401.
- `POST /auth/refresh` rotates and keeps the session alive after access expiry.
- `POST /auth/logout` revokes the session; subsequent `/me` → 401.

**Complexity:** Medium. **This closes the user's request (Google login/register).**

---

## Phase 5 — Sync bootstrap + first resource (settings)

**Goal:** Prove the authed-resource pattern with the smallest resource, then expose bootstrap.

**Steps**
1. Migration `0003_settings.sql` — `user_settings`, `layouts` (`DATABASE.md` §6).
2. `internal/settings`: repo + Fiber handler for `GET/PUT/PATCH /api/v1/settings` (auto-create the
   row on first read).
3. `GET /api/v1/sync/bootstrap` returning the workspace envelope (`API.md` §Sync). For now it returns
   settings + empty arrays; each later phase fills in its slice.

**Acceptance**
- Authed user can read defaults, PATCH `ui.theme`, and read it back.
- `sync/bootstrap` returns 200 with the settings section populated.

**Complexity:** Low–Medium (establishes the copy-paste template for all following resources).

---

## Phase 6+ — Remaining resources (one mini-phase each)

Each follows the identical template: **migration → sqlc queries → repo → Fiber handler behind
`RequireAuth` → add its slice to `sync/bootstrap` → tests**. Recommended order (value + independence):

| Phase | Resource            | Migration        | Endpoints (see `API.md`)                    |
| ----- | ------------------- | ---------------- | ------------------------------------------- |
| 6     | Watchlists          | `0004_charting`  | `/watchlists`, `/watchlists/:id/symbols`    |
| 7     | Drawings            | `0004_charting`  | `/drawings` (+ `/drawings/batch` for sync)  |
| 8     | Indicators          | `0004_charting`  | `/indicators`                               |
| 9     | Pine scripts        | `0004_charting`  | `/pine-scripts`                             |
| 10    | Alerts + push tokens| `0005_alerts`    | `/alerts`, `/alerts/history`, `/push/tokens`|
| 11    | Journal + screenshots | `0007_journal` | `/journal`, `/screenshots` (+ object storage) |
| 12    | Layouts             | `0003_settings`  | `/layouts`                                  |
| 13    | Simulated trading   | `0006_trading`   | `/sim/*`                                     |

> Migrations `0004`–`0007` can be authored up front (Phase 1-style) or lazily per phase — either
> works as long as the `journal_entries.position_id → positions` FK ordering from `DATABASE.md` §10
> is respected.

**Per-resource acceptance:** CRUD works for the owner, cross-user access returns `404`, and the
resource appears in `sync/bootstrap` (where applicable).

---

## Testing strategy

- **Unit** (`go test ./...`): JWT mint/parse, session rotation/reuse, config validation, repo logic
  against a throwaway Postgres.
- **Integration:** spin a disposable Postgres (docker / `testcontainers-go`), run migrations, exercise
  handlers via `app.Test(req)` (Fiber's in-memory test transport) — no network needed.
- **Auth manual smoke:** obtain a Firebase ID token, run the Phase 4 flow with curl (`-c/-b` cookie
  jar) before wiring the frontend.
- Keep domain logic out of handlers so it's testable without HTTP (per `ARCHITECTURE.md`).

## Suggested package layout after Phase 4

```
backend/
  cmd/
    api/main.go
    migrate/main.go            # golang-migrate runner
  migrations/                  # 0001..NNNN .up/.down.sql
  sqlc.yaml
  internal/
    config/                    # + DB/auth/firebase/CORS vars
    db/
      pool.go
      queries/*.sql
      gen/                     # sqlc output
    httpserver/                # Fiber app, response helpers, CORS
    health/                    # /health, /health/ready
    auth/                      # firebase, verify, jwt, session, cookies, service, handler, middleware
    users/                     # repo (upsert from identity)
    settings/                  # first resource (Phase 5)
```

## Rollout checklist

- [ ] Provision Postgres; set `DATABASE_URL`.
- [ ] Firebase console: enable Google provider + add authorized domains (`AUTH.md` §8).
- [ ] Set `AUTH_JWT_SECRET` (32+ bytes), `FIREBASE_*`, `CORS_ALLOWED_ORIGINS`.
- [ ] Run migrations in CI/CD before deploy.
- [ ] Verify Secure-cookie flag is on in production (`APP_ENV != development`).
