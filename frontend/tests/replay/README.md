# Replay Contract Tests

Phase 0 replaces the old source-regex replay guard with executable TypeScript
tests and shared Go/TypeScript fixtures.

Run:

```bash
npm run test:replay
```

`replayBehavior.test.ts` executes current pure helper contracts. The
`replayKnownGaps.test.ts` cases are intentional Phase 0 reproductions: they
prove where legacy frontend behavior differs from the backend target without
changing production behavior. Replace each known-gap assertion with backend
parity coverage when its owning implementation phase lands.

Shared fixtures live at `testdata/replay/contracts.v1.json` from the repository
root and are also loaded by Go tests.
