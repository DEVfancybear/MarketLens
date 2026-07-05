# TOOLBAR BEHAVIOR — Phase 4.2.2

_Date: 2026-06-26._

## Interaction model

| Action | Result |
|---|---|
| Click Cursor icon | Activates cursor tool immediately (no flyout) |
| Click Lines group icon | Opens flyout with 8 line tools |
| Click "Ray" in flyout | Activates ray tool, closes flyout, sidebar icon changes to Ray |
| Click Lines group again | Opens flyout (shows Ray as highlighted) |
| Click Shapes group icon | Opens shapes flyout (9 tools), closes any other flyout |
| Click outside flyout | Closes flyout |
| Right-click outside | Closes flyout |

## State transitions

```
IDLE (all groups closed)
  │ click group button
  ▼
FLYOUT_OPEN (one group's flyout visible)
  │ click tool in flyout
  ▼
TOOL_ACTIVE (tool activated, flyout closed, icon updated)
  │ click same group button
  ▼
FLYOUT_OPEN
  │ click different group button
  ▼
FLYOUT_OPEN (new group, old flyout closed)
  │ click outside / Escape
  ▼
IDLE
```

## Icon persistence

The `lastUsed` state is per-session (React state), not persisted to localStorage. On page refresh, groups reset to their default icons. This matches TradingView behavior.

## Color picker

The color picker remains as a `group-hover` grid — no flyout. It shows on hover, hides on mouse-out. This is a separate UI pattern from tool groups.
