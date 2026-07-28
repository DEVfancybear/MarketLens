# Passkey-bound trade authorization

Every live order and execution command requires a WebAuthn user-verification
ceremony. The resulting authorization is bound to the authenticated user,
active backend session, operation, and exact JSON transaction payload.

## Security boundary

1. The browser sends `{operation, payload}` to the Go API.
2. Go creates a random, two-minute WebAuthn challenge and stores the encrypted
   ceremony state plus the payload as PostgreSQL `jsonb`.
3. The authenticator must return both user-presence and user-verification
   flags. Challenges are origin/RP-ID checked by the WebAuthn verifier and can
   be consumed only once.
4. Go creates an opaque 256-bit authorization token, stores only its SHA-256
   hash, and expires it after 45 seconds.
5. The browser sends that token in `X-Trade-Authorization`. It is never accepted
   from the request body.
6. Go forwards the server-derived user ID and session ID to the loopback Rust
   gateway.
7. Rust atomically consumes the token only when its hash, user, active session,
   operation, and `jsonb` payload all match. Enqueue happens only after this
   update succeeds.

Changing a symbol, side, quantity, target account, allocation, stop, limit, or
command after approval therefore invalidates the authorization. Reuse,
cross-session use, expired credentials, revoked sessions, and missing database
state fail closed.

## Enrollment

If the user has no trade passkey, the first trade starts enrollment. Enrollment
requires both the active HttpOnly backend session and a live Firebase ID token
for the exact same backend user. The credential itself requires WebAuthn user
verification. Credential public data and counters are encrypted at rest with
AES-GCM; associated data binds the ciphertext to its user and credential ID.

Production must set:

```env
WEBAUTHN_RP_ID=tradingterminal.io.vn
WEBAUTHN_RP_ORIGINS=https://tradingterminal.io.vn
WEBAUTHN_ENCRYPTION_KEY=<independent-random-secret-at-least-32-bytes>
WEBAUTHN_CHALLENGE_TTL=2m
TRADE_AUTHORIZATION_TTL=45s
# Frontend server, only when direct browser upload/custom origins are used:
CSP_CONNECT_SOURCES=https://your-storage-origin.example
```

Do not set the RP ID to `api.tradingterminal.io.vn`. WebAuthn is invoked by the
frontend origin. Keep the encryption key stable and backed up; rotating it
intentionally makes existing encrypted credentials unreadable.

## CSP

The Next.js request proxy creates a fresh nonce per document, forwards it as
`x-nonce`, and emits an enforced policy. Production scripts require the nonce
and `'strict-dynamic'`; script attributes, objects, framing, and base-URI
changes are blocked. `unsafe-eval` exists only in development. The app is
request-rendered because a reusable static document cannot safely reuse a
nonce. Inline React style attributes remain separately allowed while style
elements require the request nonce.

The Firebase messaging service worker has a narrower dedicated policy allowing
only its pinned Google script host and Firebase network endpoints.

## Verification

Before production rollout:

```bash
cd backend
go test ./...

cd ../frontend
npm run typecheck
npm run test:ui
npm run build
```

This is a coordinated execution-protocol rollout: briefly drain live trading,
apply migration `0031`, deploy Rust and Go together, then deploy the frontend.
Do not run old Go against new Rust or new Go against old Rust because the
internal admin request contract now requires the authorization token and
session ID.

Then verify on the deployed HTTPS hostname:

- first trade enrolls a passkey and asks for user verification;
- every subsequent order/close/cancel command asks for verification;
- cancelling the prompt does not enqueue anything;
- replaying the authorization header returns `403`;
- changing any approved payload field returns `403`;
- signing out or revoking the session invalidates outstanding authorizations;
- document responses contain the nonce CSP and production contains no
  `unsafe-eval`.
