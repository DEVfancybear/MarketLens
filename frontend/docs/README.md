# MarketLens frontend documentation

Verified against `frontend/package.json` and the source tree on 2026-08-24.

The maintained frontend uses Next.js 16.3.1, React 19.0.0, TypeScript 6.0.2 in strict mode, and
Lightweight Charts 5.2.0. This index separates current architecture/contracts from historical phase
records so old plans are not mistaken for runtime guidance.

## Current architecture

| Document | Scope |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | Frontend runtime, ownership, state, services, and tests |
| [Platform UI architecture](PLATFORM_UI_ARCHITECTURE.md) | Desktop/mobile ownership, lazy chunks, and accessibility |
| [Responsive architecture](RESPONSIVE_ARCHITECTURE.md) | Viewport/platform boundaries |
| [Localization architecture](LOCALIZATION_ARCHITECTURE.md) | Vietnamese/English state and terminology |
| [Backend API sync](BACKEND_API_SYNC_ARCHITECTURE.md) | Authenticated resource ownership and adapters |
| [Authentication UI](AUTH_UI.md) | Google sign-in and backend session exchange |
| [Frontend error reporting](FRONTEND_ERROR_REPORTING.md) | Error capture and reporting boundary |
| [Mobile/desktop feature parity](MOBILE_DESKTOP_FEATURE_PARITY.md) | Maintained capability matrix and regression rules |
| [Mobile touch gestures](MOBILE_TOUCH_GESTURES.md) | Pointer events and mobile interaction contract |

## Chart, replay, and indicators

| Document | Scope |
| --- | --- |
| [Chart layout architecture](CHART_LAYOUT_ARCHITECTURE.md) | Multi-chart workspaces and pane ownership |
| [Chart task tabs architecture](CHART_TASK_TABS_ARCHITECTURE.md) | Desktop task isolation, reorder, and backend sync |
| [Chart time navigation](CHART_TIME_NAVIGATION_ARCHITECTURE.md) | Time scale and range shortcuts |
| [Chart visual profile](CHART_VISUAL_PROFILE.md) | Rendering and visual contract |
| [Zoom/viewport synchronization](ZOOM_VIEWPORT_SYNC_ARCHITECTURE.md) | Lightweight Charts 5.2 viewport lifecycle |
| [Replay architecture](REPLAY_ARCHITECTURE.md) | Current backend-authoritative replay UI boundary |
| [Indicator architecture](INDICATOR_ARCHITECTURE.md) | Indicator model and renderer |
| [Candle virtualization research](CANDLE_VIRTUALIZATION_RESEARCH.md) | Performance research and benchmark rationale |

The root [Replay migration plan](../../docs/REPLAY_BACKEND_MIGRATION_PLAN.md),
[Replay Phase 6 record](../../docs/REPLAY_BACKEND_PHASE6.md), and
[Pine Go migration plan](../../docs/PINE_RUNTIME_GO_MIGRATION.md) define cross-package ownership.

## Drawings and interaction

| Document | Scope |
| --- | --- |
| [Drawing engine architecture](DRAWING_ENGINE_ARCHITECTURE.md) | Rendering and tool engine overview |
| [Drawing object model](DRAWING_OBJECT_MODEL.md) | Persisted drawing representation |
| [Drawing state machine](DRAWING_STATE_MACHINE.md) | Interaction states and transitions |
| [Selection engine](SELECTION_ENGINE.md) | Hit testing and selection |
| [Drawing text editor](DRAWING_TEXT_EDITOR.md) | Text editing lifecycle |
| [Tool registry](TOOL_REGISTRY.md) | Manifest and registration contract |
| [Tool activation](TOOL_ACTIVATION_SYSTEM.md) | Activation lifecycle |
| [Tool groups](TOOL_GROUP_ARCHITECTURE.md) | Toolbar grouping |
| [Tool interaction guide](TOOL_INTERACTION_GUIDE.md) | Shared interaction patterns |
| [Toolbar behavior](TOOLBAR_BEHAVIOR.md) | Toolbar UX contract |
| [Drawing snapshot matrix](DRAWING_TOOLS_VISUAL_SNAPSHOT_MATRIX.md) | Visual regression inventory and baselines |
| [Drawing maintenance](DRAWING_TOOLS_MAINTENANCE_REFACTOR_PLAN.md) | Completed refactor constraints and maintenance rules |

Tool-family references remain in `LINE_TOOLS_ARCHITECTURE.md`, `SHAPE_TOOLS_ARCHITECTURE.md`,
`POSITION_TOOL_ARCHITECTURE.md`, `FIBONACCI_TOOLS_MAINTENANCE.md`,
`RECTANGLE_TOOL_GUIDE.md`, `TREND_LINE_SUITE.md`, and `SMC_OVERLAY_MAINTENANCE.md`.

## Product surfaces and integrations

| Document | Scope |
| --- | --- |
| [Alert architecture](ALERT_ARCHITECTURE.md) | Alert lifecycle and delivery channels |
| [Dynamic drawing alerts](DYNAMIC_DRAWING_ALERTS_PLAN.md) | Implemented dynamic geometry alert contract |
| [Push notifications](PHASE6A_PUSH_NOTIFICATIONS.md) | Browser/push delivery implementation record |
| [Telegram and Discord](PHASE6A_TELEGRAM_DISCORD_PLAN.md) | External notification contract |
| [Watchlist architecture](WATCHLIST_ARCHITECTURE.md) | Lists, sections, ordering, and persistence |
| [OANDA integration](OANDA_INTEGRATION.md) | Provider integration reference |
| [Timeframe hotkeys](TIMEFRAME_HOTKEYS.md) | Keyboard behavior |
| [Draggable dialogs](DRAGGABLE_DIALOG_ARCHITECTURE.md) | Shared dialog interaction contract |

Trade execution is no longer owned by deleted frontend bridge documents. Use the root
[trade execution architecture](../../docs/TRADE_EXECUTION_ARCHITECTURE.md),
[bare-metal managed MT5 runbook](../../docs/MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md), and
[production security runbook](../../docs/TRADE_PRODUCTION_SECURITY_RUNBOOK.md).

## Historical and diagnostic records

- `archive/` contains pre-monorepo milestones, parity reports, and visual audits.
- `CANDLE_VIRTUALIZATION_PHASE*.md`, `DRAWING_PHASE*.md`, and `PHASE*.md` are implementation or
  rollout records unless a current architecture page explicitly points to them.
- files named `*_PLAN.md`, `*_AUDIT*.md`, `*_ROOT_CAUSE.md`, `*_INCIDENTS.md`, or with a date in the
  name preserve a proposal, diagnosis, or result from that time.
- `baselines/` contains benchmark data, not prose guidance.

Do not rewrite these records to look current. Promote durable conclusions into a maintained
architecture page and link the historical record as evidence.

## Maintenance rules

- Add a new document to the appropriate current table only when it is intended as ongoing guidance.
- Link cross-package backend/execution material from root docs instead of duplicating it here.
- Remove index entries when their files are deleted or superseded.
- Verify dependency versions from `frontend/package.json` and tests/scripts from its `scripts` map.
- Keep browser/UI regression details in the owning test README or architecture page.
