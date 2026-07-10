# Replay Contract Tests

Phase 6 retains only frontend client-responsibility tests. Replay clocks,
aggregation, selection validation, and trading behavior are covered by Go.

Run:

```bash
npm run test:replay
```

The suite covers feature-gate semantics, server snapshot replacement, ordered
event application, duplicate/gap handling, progressive bar projection,
isolated trading projection, synchronized layout DTOs, and viewport behavior.

Shared fixtures live at `testdata/replay/contracts.v1.json` from the repository
root and are also loaded by Go tests.
