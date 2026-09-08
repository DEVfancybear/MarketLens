# Local frontend using the production API — revision 1

Status: awaiting explicit user approval. No implementation authorized by this document yet.

## Outcome and calibration

Run `cd frontend; npm run dev` and open http://localhost:3000 with no local Go,
Rust, Python, MT5 worker, or database required for server-managed features.
The development frontend forwards backend HTTP and WebSocket traffic to
https://api.tradingterminal.io.vn. External market-data providers retain their routes.
Tier 3: the development transport carries authenticated production sessions.

## Discovery

MCP graph tools and the codebase-memory-mcp executable are unavailable. Read
docs/CODEBASE_MEMORY.md, frontend/README.md, frontend/docs/BACKEND_API_SYNC_ARCHITECTURE.md,
frontend/next.config.mjs, frontend/src/services/api/client.ts, and backend auth cookie policy.
The API resolver currently forces localhost/127.0.0.1 to port 8080, overriding explicit env.
Backend cookies use SameSite=Strict. A direct cross-site URL change cannot establish
the required same-site browser session behavior.
The production OPTIONS probe on 2026-09-08 returned Cloudflare HTTP 530;
API reachability, live CORS policy, and authenticated operation remain unverified.

## Design and allowed scope

- Introduce a development-only frontend server/proxy, bound to loopback, using
  Node built-ins and existing Next dependencies. `npm run dev` starts this entry point.
- Route only `/api/v1/*` backend traffic, including WebSocket upgrades, to the fixed
  production upstream by default; retain Next routes and development hot reload.
- Browser HTTP and WebSocket URLs use the frontend origin in this dev mode.
  Server-side API calls resolve the configured upstream explicitly.
- Provide an explicit development upstream override for optional localhost backend use.
  Validate upstream configuration before listening; do not accept request-supplied targets.
- Preserve backend cookies, including HttpOnly, SameSite, Secure, expiry and path;
  do not introduce browser token storage. Verify localhost browser compatibility.
- Preserve Origin and backend authorization/CSRF checks. If production rejects the
  localhost origin, report the exact server prerequisite; do not spoof a trusted origin.
- Update frontend/package.json, frontend/next.config.mjs as needed, API URL resolution,
  frontend/.env.example, root .env.example and frontend/README.md. Add narrowly scoped
  frontend development proxy modules and tests under frontend/tools and frontend/tests.
- Production build/start behavior remains unchanged. No production deployment,
  server configuration edit, auth-policy relaxation, or production data mutation.

## Executable acceptance criteria (named tests)

1. `dev-default-production`: with no overrides, localhost HTTP `/api/v1/auth/me`
   reaches the configured production upstream path/query, never port 8080.
2. `explicit-local-override`: an explicit local upstream works without hostname rewriting.
3. `websocket-upgrade`: backend stream upgrades preserve path/query, cookies, frames,
   disconnects and upstream errors; Next HMR upgrades still reach Next.
4. `session-cookie-roundtrip`: a controlled upstream sets strict HttpOnly cookies;
   a real localhost browser sends them on subsequent API calls, refresh and WebSocket
   handshakes. Logout expiry and refresh cookie path semantics remain intact.
5. `request-response-fidelity`: methods, JSON/binary bodies, query strings, status codes,
   multiple Set-Cookie headers and streaming responses survive forwarding.
6. `no-open-proxy`: hostile paths, absolute URLs, malformed upstreams and foreign
   browser origins cannot select another destination or bypass origin validation.
7. `upstream-failure`: unreachable upstream returns a bounded, explicit failure;
   never silently falls back to a local backend or logs cookies/tokens.
8. `production-unchanged`: production URL configuration and existing API/auth tests pass;
   development proxy is not activated by build/start.
9. `frontend-routes-preserved`: ordinary pages and existing Next API routes still work.
10. `production-readonly-smoke`: real production health/CORS and unauthenticated API
    requests work through the local frontend. A 530 or unavailable authenticated session
    is recorded as blocked/unverified, never as successful production integration.

## Failure model and gauntlet

- Session/cookie regression: real browser cookie roundtrip against controlled upstream,
  existing auth regressions, header fidelity tests.
- CSRF/open proxy or secret leakage: hostile-origin/destination tests and sanitized logs.
- Wrong environment or accidental local dependency: dev/prod environment matrix.
- Broken live quotes: real local WebSocket handshake/frame/disconnect tests.
- Hanging requests: upstream timeout/disconnect tests.

Observe reproducing resolver tests RED before implementation. Keep test edits separate
from implementation edits. Use Node's existing test runner, TypeScript compiler, ESLint,
existing Playwright installation for browser execution, and Node HTTP/HTTPS test servers.
No new npm dependency or tool installation planned; report missing tooling before adding it.
Read the installed Next guides and relevant skill references before implementation.

Persist `tools/verify-local-frontend-production-api.ps1` as the fail-closed entry point:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-local-frontend-production-api.ps1
```

It runs focused transport/auth tests, the full compiled frontend Node test suite
(`npm run test:build` then Node --test with existing shims), `npm run typecheck`,
`npm run lint`, `npm run build`, browser cookie/runtime tests, changed-line coverage
with a nonzero exit on missed changed executable lines, and 3-5 persisted manual
mutants with execution verification. Generated input matrices cover URL/path/header
invariants. Negative controls must prove custom gates fail. Record exact commands,
versions, baseline failures and final results. Skip backend test suites because no
backend source changes; independent agent verification is not planned.

## Artifacts and authorization boundaries

Add scoped test fixtures and a persisted mutation/check runner as needed. Generated
build/test/coverage/browser reports and sanitized smoke logs go in ignored output
directories. Final report: docs/EVIDENCE-local-frontend-production-api.md, mapping
every criterion to fresh results or explicit limitations, plus Git SHA and changed-file hashes.
Git usage: status, diff, ls-files, rev-parse and check-ignore only; no commit, push,
pull, reset or deployment. Preserve unrelated work and secrets. No credential prompts,
trades, production writes, or production login automation in the verification run.
If live access or server origin policy blocks acceptance, report the blocker and required
follow-up without claiming completion or changing this SPEC silently.

## Approval record (append-only)

2026-09-08: user explicitly approved revision 1 with "Tôi phê duyệt", responding
to the question naming and linking this exact revision. The scope above is unchanged.

2026-09-08 user steering: "backend tôi chưa build lại bạn cứ sửa fe trước đi".
Finish frontend implementation and local verification now; defer production integration
criterion 10 until the user rebuilds backend. No backend build/deploy is requested.
