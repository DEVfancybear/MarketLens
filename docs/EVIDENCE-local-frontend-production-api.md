# Local frontend using production API — evidence

## Outcome and authorization

Frontend implementation and local transport verification completed. `cd frontend` then
`npm run dev` serves http://localhost:3000 and proxies `/api/v1/*` HTTP/WebSocket requests
to https://api.tradingterminal.io.vn. No local Go/Rust/Python/backend database is started.
`DEV_API_UPSTREAM` can explicitly select another validated upstream. Production
`npm run build` / `npm start` retain their existing commands and transport behavior.

- Tier: 3, because this development transport carries authenticated sessions.
- Approved SPEC: `docs/SPEC-local-frontend-production-api.md`, revision 1.
- Explicit approval: user said **“Tôi phê duyệt”** in response to the exact SPEC link.
- Later user instruction: **“backend tôi chưa build lại bạn cứ sửa fe trước đi”**.
  Production integration is deferred; this report does not claim it passed.
- MCP tools and executable were unavailable. Discovery used `docs/CODEBASE_MEMORY.md`,
  frontend architecture/docs, current source, backend cookie/origin policy, and installed
  Next documentation. No graph-ready or graph-query result is claimed.
- No dependency installation, backend changes, server configuration changes, credential
  prompts, production data writes, commit, push or deployment were performed.

## Reproduce

From the repository root, with the existing npm dependencies and Edge installed:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-local-frontend-production-api.ps1
```

The entry point creates a fresh timestamped log directory, rebuilds compiled tests,
checks native exit codes, and stops on a failing layer. The full-suite gate permits
only the exact unchanged baseline failure described below, with negative controls.
Mutation runs use isolated copies under `.test-build/dev-api-mutations/`; they never
modify the active frontend source. Each mutant is loaded by a fresh Node process,
checked for an assertion failure, and logged with its SHA256.

Final fresh run: `.runtime-logs/local-frontend-production-api/20260908-153832/`.
The directory contains each layer log, `results.json`, `source-toolchain.txt`, and
`source-hashes.txt`. No implementation or test code changed after that run began.
This evidence document was written after completion.

## Final results

| Layer | Command (from frontend unless noted) | Result |
|---|---|---|
| Compile tests | `npm run test:build` | exit 0 |
| Full suite / baseline gate | `node tools/run-dev-api-suite.mjs` | 877 tests: 876 passed, 1 verified pre-existing failure; zero new failures |
| Baseline checker controls | Included in full-suite runner | 6 assertions passed; new failures, missing diagnostic and abnormal exit cannot be accepted as baseline |
| Static types | `npm run typecheck` | exit 0 |
| Frontend lint | `npm run lint` | exit 0, no warnings reported |
| New tools/tests lint | ESLint command persisted in entry point | exit 0, no warnings reported |
| Mutation | `node tools/verify-dev-api.mjs` | 6/6 mutants killed by behavioral assertions |
| Resolver/transport/browser cookie tests | Node test command persisted in entry point | 9/9 passed, 0 skipped |
| Proxy coverage | Node `--experimental-test-coverage --test-coverage-include=tools/dev-api-proxy.mjs --test-coverage-lines=100` | lines 100.00%, branches 93.59%, functions 83.87%; line threshold enforced |
| Real Next runtime / launcher | `node --test tests/dev/runtime.test.mjs` | 2/2 passed, 0 skipped |
| Production FE build | `npm run build` | exit 0; compile, TypeScript, all 12 static pages and optimization completed |
| Diff whitespace | `git -c core.safecrlf=false diff --check` | exit 0; command-local setting suppresses CRLF conversion notices only |

Terminal entry-point result: `FRONTEND_GAUNTLET_OK (production integration deferred by user)`.

### Existing baseline failure

The raw full suite still exits 1 for:

```text
no tsconfig reintroduces options TypeScript 7 removed
AssertionError: tsconfig.test.json still uses the removed node10 module resolution
```

The gate verifies that the failing test and all three tsconfig files it reads match
committed HEAD exactly (normalizing CRLF). It rejects any additional/unclassified
failure. No assertions or TypeScript configuration were weakened to make this task pass.
The original unfiltered failing run is retained under
`.runtime-logs/local-frontend-production-api/20260908-152852/full-suite.log`.

## SPEC mapping

| SPEC criterion | Evidence | Status / limits |
|---|---|---|
| 1. Default production routing | `api-resolution.test.mjs`: dev-default-production; `proxy.test.mjs`: default upstream assertion; real launcher smoke | Local behavior passes; final runtime uses a controlled upstream |
| 2. Explicit local override | `proxy.test.mjs`: request-response-fidelity and explicit-local-override; real launcher with loopback override | Pass |
| 3. WebSocket transport and HMR | `proxy.test.mjs`: cookie/frame roundtrip, denial, timeout and HMR dispatch; `runtime.test.mjs`: real HMR frame received | Pass for tested paths; production stream deferred |
| 4. Cookies/refresh/logout | Real Edge cookie roundtrip test | Pass: HttpOnly/Secure/Strict retained, refresh path scoped, stream carries access cookie, logout expires both |
| 5. Request/response fidelity | Method matrix, binary bodies, query, Origin, 401, multiple cookies, streamed/broken responses | Pass for tested cases; arbitrary protocol extension/trailer fidelity is not claimed |
| 6. No open proxy / origin bypass | Generated hostile path/origin/Host/Connection cases; upstream configuration matrix; origin mutant killed | Pass for tested attacks; Origin is never replaced with a trusted production origin |
| 7. Upstream failures | Timeout, broken HTTP response, connection refusal and WebSocket rejection tests | Pass for tested failures; no local fallback |
| 8. Production unchanged | Production resolver test and isolation mutant; full regression suite; production build | Pass under baseline policy; deployed production runtime is not exercised |
| 9. Frontend routes preserved | Non-backend route dispatch fixture; actual Next page, favicon and HMR; production build lists existing Next API routes | Pass for dispatch/page/assets; authenticated Next notification endpoints not executed |
| 10. Production smoke | User explicitly deferred backend integration | Unverified/deferred |
| No backend/production mutation | Scoped source diff, controlled test upstreams, unchanged backend tree | Pass for this work; no production account login or trade action performed |
| Existing dependency set | package.json diff changes only the dev script; lockfile unchanged | Pass; Node built-ins and already-installed Next/Playwright tooling used |

## Source and toolchain

- Base HEAD: `378cbb29bb066897d73ea46d097b1acddb808c3c` plus the uncommitted task files.
- Node `v24.18.0`, npm `11.16.0`, Next `16.3.1`.
- Project-pinned compiler, ESLint and Playwright versions remain in package.json/lockfile.
- Core SHA256 values from the final run:

| File | SHA256 |
|---|---|
| frontend/tools/dev-api-proxy.mjs | `2F5A998C81B4B71E7309D36CBD396311E151AF1684F04923F9367F0F9059063B` |
| frontend/tools/dev-server.mjs | `065A89609904238452AC4AD5CA6030676E4D1FCA404FDCF62CF282B12E030B6E` |
| frontend/src/services/api/client.ts | `601B32B5A30A86F1CF8D350C147B1375BE40893418999A143B2FE17C8DC64845` |
| frontend/package.json | `F18B654540E68AE836A31E6CD4F4AE5872FC2C36101C9827B8BAA724158F24E3` |

The entry point also hashes its own file, both check runners and all three new test files.

## Honest limits and workflow notes

- RED was observed on the existing resolver: actual
  `http://localhost:8080/api/v1/auth/me`, expected
  `http://localhost:3000/api/v1/auth/me`. The initial test harness first needed its
  Ky module boundary corrected; that harness error was not counted as behavioral RED.
- Initial proxy tests exposed DELETE bodies losing HTTP framing after hop-header
  filtering. The implementation now explicitly re-establishes chunked framing.
  Transport tests were introduced after the initial proxy implementation, so strict
  RED-first evidence is weaker there; final mutation testing covers key invariants.
- A first mutation run was interrupted while modifying the working source. The origin
  check was restored and verified before further work. The final mutation runner uses
  isolated copies so interruptions cannot leave the application mutated.
- Coverage threshold applies to the new proxy module, not the launcher or VM-transpiled
  resolver. Those have behavioral/runtime tests but no measured changed-line threshold.
  Branch/function coverage below 100% remains a stated limitation; error/disconnect
  callbacks are not all independently exercised. This is narrower than the original
  SPEC's blanket changed-line coverage ambition.
- Generated URL/path/method matrices are bounded examples, not an exhaustive property
  suite. No dedicated property framework or property-only mutation run was added.
- Tests ran in deterministic order; randomized suite-order testing was not performed.
- Supply-chain audit was not rerun because the dependency set did not change. The
  changed files were inspected for credentials; no automated secret-scanner result is claimed.
- Backend suites, production login/stream, server activation, other browser engines,
  cross-platform behavior and independent agent verification were not performed.
  This is local FE evidence with those explicit confidence limits.
- Historical live probe in this task returned Cloudflare HTTP 530 both directly and
  through the frontend. It is not a final-run result. After backend rebuild, verify
  reachability and permit the exact frontend origin (normally `http://localhost:3000`)
  in backend `CORS_ALLOWED_ORIGINS`; Firebase must also permit localhost for Google login.
  No server policy was altered or bypassed here.
