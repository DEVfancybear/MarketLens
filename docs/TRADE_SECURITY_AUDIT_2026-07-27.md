# Trade security audit — 2026-07-27

## Scope and threat model

The audit followed the complete execution path:

```text
Browser
  -> Firebase identity + Go HttpOnly session
  -> Go execution BFF
  -> loopback-only Rust admin API
  -> PostgreSQL ownership/risk/idempotency state
  -> public allow-listed EA relay
  -> owner/account-bound EA session
  -> MT5 terminal and broker
```

Threats considered were stolen/replayed cookies, CSRF, cross-owner object access, request and
pairing floods, direct command bypass, duplicate/ambiguous broker submission, compromised public EA
traffic, exposed internal credentials, stale sessions after logout, and same-origin browser
compromise.

## Research baseline

- [OWASP Transaction Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html):
  authorization must be sequential, bound to the exact transaction, checked at execution, short
  lived, and unique per operation.
- [OWASP API4:2023 Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/):
  enforce operation-specific limits and tune them to business needs.
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html):
  protect cookie confidentiality and make session lifecycle/revocation server controlled.
- [Firebase session-cookie guidance](https://firebase.google.com/docs/auth/admin/manage-cookies):
  protect cookie-session exchange from CSRF, apply secure cookie policy, and check revocation for
  sensitive applications.
- [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html):
  authenticated sessions and transaction protocols should be replay resistant and use freshness
  mechanisms.

## Findings fixed

### High: revoked backend session could retain mutation capability until JWT expiry

The access JWT default lifetime is 15 minutes. Logout revoked the PostgreSQL refresh-session row,
but the generic middleware only validated the JWT signature and claims. A copied access cookie
could therefore continue calling execution mutations until expiry.

Fix:

- added an owner-bound, expiry-aware `IsSessionActive` PostgreSQL query;
- added `RequireActiveSession` after JWT authentication;
- applied it to every execution read and mutation before any gateway call;
- fail closed with `503` when active-session state cannot be verified.

### High: execution mutations lacked authenticated-user throttling at the Go boundary

The Rust gateway already caps payloads, pairing state, targets, risk, command delivery, and durable
idempotency, but a valid browser session could still flood mutation calls.

Fix:

- authenticated reads and writes: 1,200/minute before the session-store lookup;
- broad per-user limit for all execution mutations: 180/minute;
- stricter shared order/command limit: 60/minute;
- pairing-token limit: 10/5 minutes;
- limits run only after authentication and return `429`;
- the production runbook still requires distributed reverse-proxy/WAF limits because local
  in-process counters are not a multi-instance quota.

### Medium: frontend could appear signed out after backend revocation failed

The frontend reported the backend error but continued Firebase sign-out. This could show an
anonymous UI while the HttpOnly backend execution cookie remained usable.

Fix: logout now stops after a backend revocation failure. The user remains visibly signed in and can
retry; Firebase sign-out only runs after the backend session has been revoked or is already
unauthorized.

## Controls verified

- unsafe cookie-bearing browser requests require an exact allow-listed `Origin`;
- credentialed CORS never uses a wildcard;
- access/refresh cookies are `HttpOnly`, production `Secure`, and `SameSite=Strict`;
- refresh tokens are random, hashed at rest, atomically rotated, and reuse revokes the family;
- owner identity always comes from the authenticated server session;
- account/resource ownership is re-checked by the Rust gateway;
- raw Place commands cannot bypass the risk-aware order route;
- order targets, quantities, symbols, prices, lifecycle resources, and account readiness are
  server validated;
- admin traffic is token-authenticated and loopback only;
- pairing and EA session tokens are hashed, owner/account bound, short-lived or rotated;
- command IDs and EA journals prevent blind duplicate broker submission;
- service clients reject redirects, bound bodies/responses, and use timeouts;
- audit records cover pairing, mappings, routing, commands, rejects, and EA outcomes.

## Follow-up milestone completed — 2026-07-28

The recommended strict CSP and transaction step-up are implemented. Users may enable an optional
Argon2id-hashed trade password, requested once per browser trade session. Browser unlocks are
random, hashed at rest, bound to the user and active backend session, and carried only in a
non-persistent hardened cookie. Each execution authorization remains bound to the exact `jsonb`
payload, user, active session, operation, short expiry, and one-time token. The Rust execution
boundary consumes it atomically before enqueueing.

The frontend now uses a fresh nonce per document with production `strict-dynamic`; script
attributes, object embedding, and framing are blocked, and `unsafe-eval` is development-only. See
[TRADE_PASSWORD_AUTHORIZATION.md](TRADE_PASSWORD_AUTHORIZATION.md) for the protocol and
rollout checklist.
