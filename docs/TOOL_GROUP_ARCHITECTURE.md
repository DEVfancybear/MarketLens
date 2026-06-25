# TOOL GROUP ARCHITECTURE — Phase 4.2.2

_Date: 2026-06-26._

## TradingView pattern

TradingView groups related drawing tools behind a single sidebar icon:

```
Sidebar:           Flyout (on click):
┌──────────┐       ┌─────────────────────┐
│  Cursor  │       │                     │
│  ─────── │       │                     │
│  Lines   │  →    │  Trend line         │
│  Shapes  │       │  Ray                │
│  Text    │       │  Extended line      │
│  ─────── │       │  Horizontal line    │
│  Color   │       │  Horizontal ray     │
│  Clear   │       │  Vertical line      │
└──────────┘       │  Cross line         │
                   │  Info line          │
                   └─────────────────────┘
```

## Groups implemented

| Group | Default Tool | Tools |
|---|---|---|
| Cursor | cursor | (no flyout — direct) |
| Lines | trendline | trendline, ray, extendedLine, horizontal, horizRay, vertical, crossLine, infoLine |
| Shapes | rectangle | rectangle, rotatedRect, circle, ellipse, triangle, polyline, curve, path, fib |
| Text | text | text |

## Last-used tool per group

When the user selects "Ray" from the Lines flyout, the sidebar icon changes to the Ray icon. Future clicks on the Lines group button open the flyout while showing the Ray icon. This matches TradingView's behavior where "the last selected tool becomes the visible icon."

Implemented via `useLastUsed()` hook that tracks `lastUsed[groupId]` state.

## Flyout behavior

- Click group button → open flyout (positioned at `left-full`, z-50)
- Click a tool in flyout → activate tool, close flyout
- Click group button again → toggle flyout closed
- Click anywhere outside (backdrop) → close flyout
- Only ONE flyout open at a time

## Backdrop

A `fixed inset-0 z-40` transparent div closes the flyout on outside click. Placed between the flyout (z-50) and the canvas (z-5), ensuring clicks outside the flyout don't reach the chart during flyout interaction.

## Visual parity

- 18px icons on sidebar, 14px icons in flyout
- TradingView-dark flyout background (`bg-terminal-panel-2`)
- 1px border (`border-terminal-border`)
- 11px text, 12px padding, 6px border-radius
- Active tool highlighted in blue (`text-brand`)
- Hover: `bg-terminal-hover`
