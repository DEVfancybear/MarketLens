# Desktop Terminal Override

> Inherits `../MASTER.md`. This file defines the pointer-and-keyboard desktop presentation rendered under `.desktop-terminal` / `data-platform="desktop"`.

---

## Product Role

The desktop terminal is the full Institutional Command Center. It is optimized for sustained analysis, simultaneous data monitoring, drawing, replay, and order management. Density is high, but related commands are grouped into clearly bounded surfaces.

Desktop is not a stretched mobile app. It uses docked information architecture, resizable work areas, keyboard shortcuts, and pointer-precise controls.

---

## Implemented Anatomy

```text
Desktop Terminal (100dvh)
├─ Top toolbar (56px)
└─ Workspace gutter (8px)
   ├─ Left drawing rail
   ├─ Center surface
   │  ├─ Chart viewport
   │  └─ Resizable bottom workspace
   │     ├─ Replay
   │     ├─ Trade
   │     ├─ Journal
   │     ├─ Analytics
   │     ├─ Pine Editor
   │     └─ Logs
   └─ Resizable market desk
      ├─ Watchlist
      └─ Object Tree
```

The chart owns the flexible center column. Left, right, and bottom regions are support surfaces and must never visually dominate it.

---

## Density and Dimensions

| Element | Desktop rule |
|---|---|
| Top toolbar | 56px high, grouped 40px control containers |
| Primary toolbar control | 32px high |
| Icon control | 32-36px visual target |
| Dock gutter | 8px |
| Main panel radius | 12px |
| Right/bottom header | 48px |
| Tab or segmented control | 28-32px high |
| Dense table row | 30-36px high |
| Default body | 13px |
| Compact control label | 11-12px, semibold |

These compact values are desktop-only. Do not reuse them as mobile hit areas.

---

## Surface Hierarchy

- Application canvas uses `terminal-bg`.
- Toolbars and dock content use `terminal-panel`.
- Grouped controls and table headers use `terminal-panel-2`.
- Nested controls use `terminal-panel-3`.
- Active tabs, menus, and popovers use `terminal-raised`.
- Main dock surfaces use the shared `surface-panel` treatment: quiet border, 12px radius, restrained shadow.
- Use blur on the persistent top toolbar or floating local controls only when it preserves chart context.

Avoid stacking multiple heavy shadows inside the docked layout. Border, fill, and spacing provide most hierarchy.

---

## Top Toolbar

- Group symbol, timeframe, indicators, layout, status, and account controls by workflow.
- Each group uses a bounded 40px container rather than one uninterrupted line of icons.
- Violet marks active modes, selected tools, focus, and the terminal brand.
- Connection or execution state uses semantic status color plus text/icon.
- Lower-priority actions move into overflow before primary analysis controls become cramped.
- Icon controls require accessible names and pointer tooltips.
- Toolbar menus and popovers use the shared body portal by default. They stay
  inside the viewport, render above the chart, dismiss on Escape/outside press,
  and return focus to their trigger. Do not repair a clipped popup with a local
  z-index escalation.

---

## Drawing Rail and Chart

- The drawing rail is a dedicated desktop tool surface, not primary navigation.
- Active drawing state uses accent-soft fill, accent text, and selected semantics.
- Tool flyouts must stay within the viewport and must not obscure the active chart anchor unnecessarily.
- Chart HUD and floating actions are compact and translucent only when the underlying chart must remain visible.
- Chart pan, zoom, crosshair, drawing, and context interactions take priority over decorative overlays.
- The live price badge contains price and countdown only. Its width follows the
  actual right price scale and must not extend into the plot or market desk;
  symbol context remains in the chart HUD and accessible metadata.
- Replay and risk controls must reserve enough chart space at 1024px width.

---

## Market Desk and Bottom Workspace

### Market desk

- Header identifies the desk and its realtime monitoring purpose.
- Watchlist/Object Tree uses a contained segmented switch.
- Quote rows favor fast scanning: symbol, venue, last, change, and explicit direction.
- Row hover may expose secondary actions, but every critical action needs a keyboard and non-hover path.

### Bottom workspace

- Tabs combine Lucide icon and label.
- Active state uses raised surface plus violet underline; it does not rely on color alone.
- Bottom panel height is user-resizable and persisted.
- Collapse/expand controls remain reachable without covering important data.
- Trade tables use aligned tabular figures and right-aligned numeric columns.

---

## Pointer, Drag, and Keyboard

- Pointer hover is enhancement, not the only discovery mechanism.
- Resizers provide clear hover/active feedback and should expose keyboard-operable separator semantics.
- Draggable dialogs are desktop-only and start from a designated non-interactive handle.
- Escape closes the topmost dismissible surface.
- Opening a menu/dialog moves focus correctly; closing it restores focus to its trigger.
- Existing trading shortcuts must not fire while focus is inside an editable field.

---

## Responsive Desktop Behavior

### 1024-1199px

- Preserve chart width first.
- Collapse low-priority toolbar labels into icon-plus-tooltip or overflow.
- Right desk and bottom panel remain available but use their minimum supported size.
- Never introduce horizontal page scrolling.

### 1200-1599px

- Standard command-center composition.
- Show primary toolbar labels where they improve recognition.
- Maintain 8px workspace gaps and full dock functionality.

### 1600px and above

- Allow additional market and analytics detail without inflating control sizes.
- Do not center the terminal in a marketing-style max-width container.
- Use extra space for data, not oversized headers or decorative whitespace.

---

## Desktop Accessibility Checklist

- [ ] Focus order follows toolbar, drawing rail, chart controls, market desk, then bottom workspace.
- [ ] Every icon-only action has an accessible name and tooltip.
- [ ] Menus support arrow keys, Escape, and focus return.
- [ ] Tables use semantic headers and announce sort state.
- [ ] Resizers expose separator orientation/value and keyboard controls.
- [ ] Market direction includes text/sign in addition to color.
- [ ] Dark and light themes are verified at 1024, 1440, and 1920px.
- [ ] Reduced motion leaves live data immediately readable.

---

## Desktop-Specific Anti-Patterns

- One flat toolbar with every action at equal prominence.
- Oversized cards or page headings that reduce chart space.
- Card-per-row treatment for dense market tables.
- Hover-only destructive or order actions.
- Random floating panels without a dock or clear trigger relationship.
- Mobile bottom navigation displayed alongside the desktop dock hierarchy.
