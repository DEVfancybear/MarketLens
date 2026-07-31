# Prop Risk Guard — Automated Prop-Account Protection on the Web

Status: implemented for the MT5 web execution path. The evaluator is
broker-neutral; FTMO 2-Step is the first versioned preset.

## Goals

Prop Risk Guard removes the need for prop-account traders to calculate
drawdown manually before every order. A user configures protection once for
each account in the web application; the system then:

- validates every order **before** it enters the MT5 command queue;
- requires a Stop Loss when the selected profile requires one;
- limits risk per order and combined risk across positions and pending orders;
- automatically reduces quantity to the largest safe lot step instead of
  requiring the user to recalculate it, rejecting only when the remaining
  budget is below the broker's minimum quantity;
- prevents Stop Loss and pending-entry modifications from increasing committed
  risk;
- tracks equity from account heartbeats using the firm's trading day and time
  zone;
- automatically blocks new orders, cancels pending orders, and closes positions
  when the safety buffer is reached;
- keeps the account locked for the remainder of the trading day so a price
  recovery cannot silently reopen trading; and
- writes audit records for configuration changes, rejected orders, and the
  first daily lock.

This is a **web/backend feature**, not firm-specific EA logic. The common EA
continues to act only as a transport, telemetry publisher, and executor of
commands approved by the backend.

## Automated Flow

```mermaid
flowchart LR
    H["MT5 heartbeat: balance, equity, portfolio"] --> E["Common risk evaluator"]
    W["Web or copy-trade order"] --> P["Pre-trade guard"]
    E --> S[("Daily state and audit")]
    S --> P
    P -->|"Valid SL and sufficient risk budget"| Q["Durable MT5 queue"]
    P -->|"Unsafe"| X["Reject with reason"]
    E -->|"Safety buffer or breach"| A["Block, cancel pending, close positions"]
    A --> Q
```

No manual daily reset is required. PostgreSQL derives `trading_day` from the
profile's IANA time zone and captures `day_start_balance` on the first heartbeat
of the new trading day. Once the state is locked, the lock remains sticky until
the next trading day.

## Common Formulas

Rates are stored as basis points (`100 bp = 1%`) and calculated from
`initial_balance`:

```text
daily_loss_limit = initial_balance × daily_loss_limit_bp / 10,000
max_loss_limit   = initial_balance × max_loss_limit_bp / 10,000

daily_floor = day_start_balance - daily_loss_limit
max_floor   = initial_balance   - max_loss_limit

daily_remaining = equity - daily_floor
max_remaining   = equity - max_floor
```

The evaluator uses **equity**, so floating P/L, commission, and swap are
included whenever the broker reflects them in equity. Before accepting a new
order, the backend also calculates:

```text
planned_risk = abs(entry - stop_loss) / tick_size × tick_value × quantity
projected_committed_risk = open_position_risk + pending_order_risk + planned_risk
```

An order cannot consume more than the per-trade limit, combined committed-risk
limit, daily budget, or total budget after the emergency buffer is reserved. If
some budget remains, the backend floors quantity to the broker's
`quantity_step` and returns `QUANTITY_CAPPED_BY_PROP_RISK` with the queued
result.

## FTMO 2-Step v1 Preset

| Rule | Step 1 | Step 2 |
| --- | ---: | ---: |
| Maximum Daily Loss | 5% | 5% |
| Maximum Loss | 10% | 10% |
| Application default maximum risk per trade | 1% | 1% |
| Application default combined position and pending risk | 3% | 3% |
| Warning buffer | 1% | 1% |
| Emergency buffer | 0.5% | 0.5% |
| Reset time zone | `Europe/Prague` | `Europe/Prague` |
| Stop Loss | Required | Required |
| Automatic block, cancel, and close | Enabled | Enabled |

The 5% and 10% limits reflect FTMO documentation when profile v1 was created.
The 1% and 3% limits and the safety buffers are application safety policies,
not additional requirements published by FTMO. If a firm changes its rules, a
new profile version must be created instead of silently modifying a profile
already assigned to accounts.

All rules and actions in a system preset are locked in both the UI and backend.
A payload therefore cannot loosen 5% to 8% while still saving the configuration
under the FTMO label. Users who need different thresholds must select
`custom_prop_firm`.

Sources verified on 2026-08-01:

- [DAOEA Prop Safe Pro](https://daoea.co/ea/prop-safe-pro)
- [FTMO Maximum Daily Loss](https://academy.ftmo.com/lesson/maximum-daily-loss/)
- [FTMO Maximum Loss](https://academy.ftmo.com/lesson/maximum-loss/)
- [FTMO 2-Step objectives](https://promo.ftmo.com/l26b-start-today-achieve-more-tomorrow/us/)

## Open Architecture for Future Firms

The core evaluator has no `if provider == FTMO` branch. Each profile is only a
versioned data object containing:

- identity: `profile_id`, `profile_version`, `provider_code`, and
  `program_code`;
- calendar: an IANA `timezone`;
- rules: daily and maximum loss, per-trade and combined risk, Stop Loss,
  warning and emergency buffers, and an optional daily profit target; and
- actions: block new orders, cancel pending orders, close positions, lock after
  a target, and fail closed when telemetry is stale.

To add another firm with the same drawdown model:

1. verify its rules from an official source;
2. add a new `PropRiskProfileTemplate`, increasing its version whenever the
   rules change;
3. leave the evaluator, Go BFF, React form, and EA unchanged; and
4. add test vectors for equity floors, time-zone reset behavior, and profile
   actions.

The `custom_prop_firm` profile allows rules and time zones to be configured on
the web without a deployment. Fundamentally different rule models, such as a
trailing drawdown based on a high-water mark, should be added as a new data
strategy in the domain rather than as broker-specific code or UI logic.

## API and Data Model

The browser calls only authenticated endpoints:

- `GET /api/v1/execution/prop-risk?accountId=...`
- `POST /api/v1/execution/prop-risk`

Go ignores client-supplied identity and injects the user ID from the
authenticated session. Rust verifies ownership again before every read or
write. The corresponding `/v1/admin/prop-risk` route is loopback-only and is
never exposed publicly.

Migration `0034_execution_prop_risk_guard` creates:

- `execution_prop_risk_assignments`: per-account snapshots of profiles, rules,
  and actions; and
- `execution_prop_risk_daily_state`: the baseline, minimum equity, status,
  reason, lock, and evaluation for each trading day.

## Fail-Safe Behavior and Operational Limits

- When `fail_closed_on_stale_data` is enabled, new orders are rejected until
  the first daily heartbeat is available and whenever quotes or metadata are
  insufficient to calculate risk.
- A safety buffer reduces the probability of a breach caused by spread,
  slippage, or latency, but it cannot guarantee protection during a market gap
  or broker outage.
- Trades submitted directly outside the web can still appear. The next
  heartbeat detects their equity and portfolio impact. Exposure without a Stop
  Loss locks the trading day and triggers the emergency action, but the backend
  cannot block an order before another terminal sends it directly to the
  broker.
- Users must still select the correct program and initial balance and verify
  the official rules for their account. Similar commercial names do not
  guarantee identical account conditions.
