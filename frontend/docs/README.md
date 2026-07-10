# Frontend Documentation

Architecture and maintenance documentation for the TradingView-style frontend.

## Core Architecture

| File | Topic |
| --- | --- |
| `ARCHITECTURE.md` | Overall frontend architecture |
| `AUTH_UI.md` | Google sign-in / sign-up UI |
| `BACKEND_API_SYNC_ARCHITECTURE.md` | Plan for consuming backend JSON/API instead of local saved data |
| `CHART_TIME_NAVIGATION_ARCHITECTURE.md` | Chart time navigation and range shortcuts |
| `CHART_VISUAL_PROFILE.md` | Chart visual profile / rendering |
| `INDICATOR_ARCHITECTURE.md` | Pine indicator runtime and renderer |
| `../../docs/PINE_RUNTIME_GO_MIGRATION.md` | Cross-package migration plan for moving Pine compile/runtime ownership to Go |
| `REPLAY_ARCHITECTURE.md` | Replay mode engine |
| `RESPONSIVE_ARCHITECTURE.md` | Responsive layout system |
| `SETTTING_ARCHITECTURE.md` | Settings dialog architecture |
| `WATCHLIST_ARCHITECTURE.md` | Watchlist lists, sections, and persistence |
| `ZOOM_VIEWPORT_SYNC_ARCHITECTURE.md` | Zoom / viewport synchronization |

## Drawing And Tools

| File | Topic |
| --- | --- |
| `DRAWING_ENGINE_ARCHITECTURE.md` | Drawing engine overview |
| `DRAWING_OBJECT_MODEL.md` | Drawing object data model |
| `DRAWING_STATE_MACHINE.md` | Drawing interaction state machine |
| `SELECTION_ENGINE.md` | Hit testing and selection |
| `DRAWING_TOOLBAR_PLAN.md` | Drawing toolbar design |
| `PHASE4_DRAWING_ENGINE_ROADMAP.md` | Drawing engine roadmap |
| `TOOL_REGISTRY.md` | Tool registration system |
| `TOOL_ACTIVATION_SYSTEM.md` | Tool activation lifecycle |
| `TOOL_GROUP_ARCHITECTURE.md` | Tool grouping design |
| `TOOL_INTERACTION_GUIDE.md` | Tool interaction patterns |
| `TOOLBAR_BEHAVIOR.md` | Toolbar UX behavior |
| `LINE_TOOLS_ARCHITECTURE.md` | Line tool suite |
| `SHAPE_TOOLS_ARCHITECTURE.md` | Shape tool suite |
| `SHAPES_GROUP_IMPLEMENTATION.md` | Shapes group implementation |
| `RECTANGLE_TOOL_GUIDE.md` | Rectangle tool guide |
| `TREND_LINE_SUITE.md` | Trend line suite |
| `POSITION_TOOL_ARCHITECTURE.md` | Long/short position tool design |
| `FIBONACCI_TOOLS_MAINTENANCE.md` | Fibonacci tools maintenance |
| `SMC_OVERLAY_MAINTENANCE.md` | SMC overlay maintenance |
| `SHAPE_TOOL_TEST_PLAN.md` | Shape tool test plan |
| `DRAGGABLE_DIALOG_ARCHITECTURE.md` | Draggable dialog system |

## Market Data, Alerts, And Bridge

| File | Topic |
| --- | --- |
| `ALERT_ARCHITECTURE.md` | Alert engine and notification channels |
| `FOREX_DATA_ANALYSIS.md` | Forex data provider notes |
| `OANDA_INTEGRATION.md` | OANDA integration notes |
| `OANDA_DEBUG_REPORT.md` | OANDA debugging notes |
| `MT5_BRIDGE_PROTOCOL.md` | Frontend bridge protocol contract |
| `PHASE10_ALERT_API_SYNC.md` | Go API sync for alerts, history, and push tokens |
| `PHASE6_IMPLEMENTATION_PLAN.md` | Phase 6 implementation overview |
| `PHASE6A_PUSH_NOTIFICATIONS.md` | Push notification implementation |
| `PHASE6A_TELEGRAM_DISCORD_PLAN.md` | Telegram/Discord alert channels |
| `PHASE6B_MT5_BRIDGE_PLAN.md` | MT5 bridge plan |
| `PHASE6B_FTMO_COPY_TRADING_PLAN.md` | FTMO copy trading plan |

## Debug And Historical Notes

| File | Topic |
| --- | --- |
| `DRAWING_ENGINE_ROOT_CAUSE.md` | Drawing root cause analysis |
| `DRAWING_INTERACTION_ROOT_CAUSE.md` | Interaction bug root cause |
| `DRAWING_LAYER_DEBUG.md` | Layer debugging notes |
| `DRAWING_PERSISTENCE_TESTS.md` | Persistence test notes |
| `DRAWING_REGRESSION_AUDIT.md` | Drawing regression audit |
| `archive/` | Restored milestone, audit, and parity reports from before the monorepo split |
