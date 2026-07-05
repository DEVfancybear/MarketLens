# Trade Tests

This folder contains TypeScript tests for the bottom Trade ticket and simulator
risk math.

## Run

```bash
npm run test:trade
```

The script compiles these tests with `tsconfig.test.json` into `.test-build/`
and runs them with Node's built-in test runner.

## Add Cases

Add tests here when changing:

- Trade ticket input parsing,
- formatted price prefill from chart tools,
- Size / Risk / Reward / R:R calculations,
- simulator order risk math,
- pending Limit / Stop order ticket behavior.

Keep component UI thin. Shared parsing and math should live in small helpers so
the ticket, chart tools, and tests all use the same contract.
