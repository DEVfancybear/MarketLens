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
| `CANDLE_VIRTUALIZATION_RESEARCH.md` | React Native VirtualizedList research mapped to canvas candle, indicator, history, and benchmark optimization |
| `INDICATOR_ARCHITECTURE.md` | Pine indicator runtime and renderer |
| `../../docs/PINE_RUNTIME_GO_MIGRATION.md` | Cross-package migration plan for moving Pine compile/runtime ownership to Go |
| `../../docs/PIVOT_FORMATION_ALERT_PLAN.md` | Deferred backend-owned Swing pivot-formation alert contract and rollout plan |
| `REPLAY_ARCHITECTURE.md` | Replay mode engine |
| `REPLAY_CONTROL_INCIDENTS.md` | Pause race and debounced Replay control incident analysis |
| `../../docs/REPLAY_BACKEND_MIGRATION_PLAN.md` | Target architecture and phased migration from frontend-owned replay to Go/PostgreSQL |
| `RESPONSIVE_ARCHITECTURE.md` | Implemented two-platform responsive boundary |
| `PLATFORM_UI_ARCHITECTURE.md` | Desktop/mobile ownership, lazy chunks and accessibility contract |
| `MOBILE_TOUCH_GESTURES.md` | Pointer Events, drag alternatives, sheet state machine and test matrix |
| `MOBILE_DESKTOP_FEATURE_PARITY.md` | Maintained desktop-to-mobile capability matrix, shared-code rules and regression gate |
| `../design-system/smc-trading-terminal/MASTER.md` | Canonical Institutional Command Center design system |
| `SETTTING_ARCHITECTURE.md` | Settings dialog architecture |
| `WATCHLIST_ARCHITECTURE.md` | Watchlist lists, sections, and persistence |
| `ZOOM_VIEWPORT_SYNC_ARCHITECTURE.md` | Zoom / viewport synchronization |

## Drawing And Tools

| File | Topic |
| --- | --- |
| `DRAWING_ENGINE_ARCHITECTURE.md` | Drawing engine overview |
| `DRAWING_TOOLS_MAINTENANCE_REFACTOR_PLAN.md` | Implemented multi-phase drawing refactor plan and current completion state |
| `DRAWING_TOOLS_POST_PHASE8_MAINTENANCE_2026-07-13.md` | Current 88-manifest/84-adapter audit, invariants, fixes, and test gates (verified 2026-07-17) |
| `DRAWING_TOOLS_TRADINGVIEW_PARITY_AUDIT_2026-07-15.md` | Official-source parity contracts and the 2026-07-16/17 follow-up evidence |
| `DRAWING_TOOLS_VISUAL_SNAPSHOT_MATRIX.md` | Manifest-derived semantic/browser visual matrix and committed baselines |
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
| `../../docs/PIVOT_FORMATION_ALERT_PLAN.md` | Pending indicator-event alert architecture; frontend remains configuration/rendering only |
| `DYNAMIC_DRAWING_ALERTS_PLAN.md` | Implemented dynamic line/channel/Fib Channel alert contract, evidence, and lifecycle |
| `FOREX_DATA_ANALYSIS.md` | Forex data provider notes |
| `OANDA_INTEGRATION.md` | OANDA integration notes |
| `OANDA_DEBUG_REPORT.md` | OANDA debugging notes |
| `MT5_BRIDGE_PROTOCOL.md` | Frontend bridge protocol contract |
| `MT5_POSITION_SIZING.md` | MT5 Position Sizer-compatible lot/risk calculation and verification |
| `PHASE10_ALERT_API_SYNC.md` | Go API sync for alerts, history, and push tokens |
| `PHASE6_IMPLEMENTATION_PLAN.md` | Phase 6 implementation overview |
| `PHASE6A_PUSH_NOTIFICATIONS.md` | Push notification implementation |
| `PHASE6A_TELEGRAM_DISCORD_PLAN.md` | Telegram/Discord alert channels |
| `PHASE6B_MT5_BRIDGE_PLAN.md` | MT5 bridge plan |
| `PHASE6B_FTMO_COPY_TRADING_PLAN.md` | FTMO copy trading plan |

## Debug And Historical Notes

| File | Topic |
| --- | --- |
| `DRAWING_PHASE0_CHARACTERIZATION.md` | Historical 35-tool pre-refactor baseline |
| `DRAWING_PHASE7_PARITY.md` | Historical Phase 7 parity checkpoint |
| `DRAWING_PHASE8_WAVE_A.md` | Historical range/channel/annotation/time expansion checkpoint |
| `DRAWING_PHASE8_WAVE_B.md` | Historical Fib/Gann/pitchfork expansion checkpoint |
| `DRAWING_PHASE8_WAVE_C.md` | Historical pattern/time-cycle expansion checkpoint |
| `DRAWING_PHASE8_WAVE_D.md` | Historical data/projection/rich-content completion checkpoint |
| `DRAWING_ENGINE_ROOT_CAUSE.md` | Drawing root cause analysis |
| `DRAWING_INTERACTION_ROOT_CAUSE.md` | Interaction bug root cause |
| `DRAWING_LAYER_DEBUG.md` | Layer debugging notes |
| `DRAWING_PERSISTENCE_TESTS.md` | Persistence test notes |
| `DRAWING_REGRESSION_AUDIT.md` | Drawing regression audit |
| `archive/` | Restored milestone, audit, and parity reports from before the monorepo split |
