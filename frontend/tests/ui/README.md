# UI Tests

This folder contains cloneable TypeScript tests for UI behavior that can be
verified without launching a browser.

Run:

```bash
npm run test:ui
```

Current coverage:

- draggable dialog viewport clamping,
- oversized dialog reachability.

Pointer-level drag behavior should be covered by browser tests when a browser
test suite is added. Pure positioning math belongs here.
