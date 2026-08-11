# Optional trade-password authorization

Live execution keeps a one-time, exact-payload authorization boundary. Users
may additionally enable a separate trade password from **Account → Trade
security**. The password is requested once per browser trade session, not once
per order.

## User behavior

- Protection is `OFF` by default for every user.
- When protection is `OFF`, live actions do not ask for a second password. Go
  still issues a short-lived, one-time authorization for the exact request.
- When protection is `ON`, the first live action in a browser session opens the
  password dialog.
- After successful verification, other tabs in the same browser profile share
  the unlock. Reloading or opening another tab does not prompt again.
- A private/incognito window has a separate cookie jar and must unlock
  separately.
- Normal browser shutdown removes the non-persistent unlock cookie. The next
  browser session prompts again.
- **Lock this browser now** revokes the server-side unlock, clears the cookie
  across all tabs, and invalidates unconsumed one-time authorizations from that
  browser session.
- Turning protection off requires the current trade password. Replacing the
  password while protection is on also requires the current password, so a
  signed-in browser cannot reset the password and then bypass the disable
  confirmation.
- Changing, enabling, or disabling trade security revokes every outstanding
  trade unlock and unconsumed execution authorization for that user, and
  invalidates any active recovery code.
- A user who forgets the trade password can request a six-digit confirmation
  code at the account's verified Google email and set a new password. Recovery
  keeps protection enabled and revokes every outstanding unlock and unconsumed
  execution authorization.

Browsers with “restore previous session” may restore session cookies as if the
browser had never closed. This is browser-defined behavior, not something a web
application can reliably distinguish from a continuing browser session. The
explicit lock action is the deterministic close control. Server-side unlocks
also expire after 12 hours absolute or two hours without a trade authorization.

## Request flow

1. The frontend posts the exact order/command to
   `POST /api/v1/execution/authorizations`.
2. If protection is disabled, Go immediately creates an authorization.
3. If protection is enabled, Go checks the host-bound trade-unlock cookie against a
   hashed, user/session-bound server record.
4. If no valid unlock exists, Go returns `428 trade password required`.
5. The frontend asks for the password and retries the same payload.
6. A successful password check creates:
   - a non-persistent `HttpOnly`, `SameSite=Strict`, production-`Secure`
     `__Host-` unlock cookie; and
   - a random one-time authorization token bound to the exact JSON payload,
     user, active backend session, operation, and expiry.
7. The frontend sends the one-time token in `X-Trade-Authorization`.
8. Go validates the header shape and forwards the token plus the authenticated
   backend session ID in the loopback-only internal order or command envelope.
9. Rust atomically consumes it before enqueueing. Replay, payload mutation,
   operation changes, expiry, revocation, or unavailable storage fail closed.

The unlock cookie never replaces the one-time authorization. It only avoids
rehashing/re-entering the password for every order.

The internal token/session fields are mandatory. Omitting either causes the
gateway request to fail closed before order validation, durable lifecycle
command enqueue, or MT5 submission.

## Password storage and policy

- Passwords are never stored in frontend persistence and are cleared from
  component state after submission/cancel.
- The backend stores only an Argon2id PHC hash with a random 16-byte salt.
- Argon2id parameters are `m=19456 KiB`, `t=2`, `p=1`, with a 32-byte output.
- Length is 8–128 Unicode characters (the password is a second factor after
  the signed-in account session).
- Spaces and paste/password managers are supported; there are no composition
  rules.
- Common passwords are rejected.
- The fifth consecutive failure starts a 30-second lock. Further failures
  exponentially increase the lock, capped at 15 minutes.
- HTTP request rate limits are applied in addition to the database-backed
  account lock.

Security-setting changes require a fresh Firebase ID token for the same backend
user. A copied backend cookie alone cannot enable, disable, or replace the
trade password.

## API

### Read status

```http
GET /api/v1/execution/trade-security
```

```json
{
  "enabled": true,
  "configured": true,
  "unlocked": false
}
```

### Configure

```http
PUT /api/v1/execution/trade-security
Content-Type: application/json

{
  "enabled": true,
  "password": "a memorable trade phrase",
  "idToken": "<fresh Firebase ID token>"
}
```

`password` may be omitted when toggling a previously configured password back
on. It contains the new password when initially configuring or replacing the
stored hash. `currentPassword` is required when turning enabled protection off
or replacing its password:

```json
{
  "enabled": false,
  "currentPassword": "the current trade password",
  "idToken": "<fresh Firebase ID token>"
}
```

The backend verifies `currentPassword` against the stored hash while holding
the user's security-settings row lock. Missing or incorrect proof leaves the
setting, stored hash, unlock sessions, and pending authorizations unchanged.

### Recover a forgotten password

Request a code with a fresh Firebase identity proof:

```http
POST /api/v1/execution/trade-security/recovery
Content-Type: application/json

{
  "idToken": "<fresh Firebase ID token>"
}
```

```json
{
  "maskedEmail": "d***@example.com",
  "expiresAtMs": 1786435800000
}
```

The backend resolves the destination from the verified account identity; the
client cannot supply or redirect the email address. A new request invalidates
the previous code. Sends have a one-minute database cooldown and an additional
per-user HTTP rate limit.

SMTP is intentionally configured once for the MarketLens system, not once per
user. User A receives the code at user A's verified email and user B receives a
separate, user-bound code at user B's verified email. Recovery rows are keyed by
`user_id`, and the code HMAC also includes that ID, so a code issued to one user
cannot reset another user's trade password.

Confirm the code and set the replacement password:

```http
POST /api/v1/execution/trade-security/recovery/confirm
Content-Type: application/json

{
  "idToken": "<fresh Firebase ID token>",
  "code": "042731",
  "password": "a new memorable trade phrase"
}
```

Codes contain six digits, expire after 10 minutes, are single-use, and allow at
most five failed checks. PostgreSQL stores only an HMAC-SHA256 digest bound to
the user ID; the HMAC key is domain-separated from `AUTH_JWT_SECRET`. Successful
recovery replaces the Argon2id password hash in one transaction, clears the
password failure lock, deletes the code, and revokes all browser unlocks and
unconsumed authorizations. The `enabled` setting is preserved.

### Authorize

```http
POST /api/v1/execution/authorizations
Content-Type: application/json

{
  "operation": "order",
  "payload": {
    "intent": {},
    "targets": []
  },
  "password": "<only when the server returns 428>"
}
```

### Lock this browser

```http
DELETE /api/v1/execution/trade-security/unlock
```

## Multi-tab cases

| Case | Expected result |
| --- | --- |
| First live trade, protection on | Password prompt; browser becomes unlocked |
| Next trade in same tab | No password prompt; new one-time payload token |
| New/reloaded tab, same browser profile | Uses the shared HttpOnly unlock cookie |
| Two tabs submit simultaneously before unlock | A cross-tab Web Lock serializes approval; the waiting tab rechecks the shared cookie before showing a dialog |
| Close one of several tabs | Remaining tabs stay unlocked |
| Normal close of the whole browser | Session cookie is removed; next session prompts |
| Private/incognito window | Separate unlock |
| Password/security toggle changed in another tab | Server-side unlock is revoked; next live action returns `428` |
| Explicit **Lock this browser now** | Server record and cookie are invalidated |
| Backend auth session revoked/expired | Unlock fails because it is bound to that session |
| More than 12 hours open or two hours idle | Password is required again |

## Production rollout

Migration `0032_optional_trade_password` creates password/unlock storage,
removes the passkey credential/challenge tables, and removes the credential
foreign key from `trade_authorizations`. Migration `0031` remains immutable
because it may already be recorded in production migration history.

Migration `0037_trade_password_recovery` adds the single active recovery-code
record per user, its expiry index, attempt counter, and update trigger.

The execution-specific environment settings are:

```dotenv
TRADE_AUTHORIZATION_TTL=45s
TRADE_RECOVERY_SMTP_HOST=smtp.example.com
TRADE_RECOVERY_SMTP_PORT=587
TRADE_RECOVERY_SMTP_USERNAME=<smtp-user>
TRADE_RECOVERY_SMTP_PASSWORD=<smtp-password>
TRADE_RECOVERY_SMTP_MODE=starttls
TRADE_RECOVERY_EMAIL_FROM="MarketLens Security <security@example.com>"
```

Production requires authenticated SMTP. `starttls` and implicit `tls` require
TLS 1.2 or newer; `plain` is accepted only for a loopback development server.
The SMTP password stays backend-only.

Deploy the migration, Go API, frontend, and Rust gateway as one compatible
release. Verify enabled/disabled flows, multi-tab reuse, explicit lock,
password-change revocation, failure backoff, token replay rejection, payload
mutation rejection, normal browser restart, recovery expiry/attempt limits,
and recovery revocation of existing unlocks.

## Standards and implementation references

- [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html)
  for password length, paste support, blocklists, and rate limiting.
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
  for Argon2id storage parameters.
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
  for random server-side session identifiers and hardened, non-persistent
  cookies instead of browser storage.
- [MDN Set-Cookie reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
  for browser-session and session-restore behavior.
