# Mobile Terminal Override

> Inherits `../MASTER.md`. This file defines the independent touch presentation rendered under `.mobile-terminal` / `data-platform="mobile"`.

_Updated: 2026-07-14_

---

## Product Role

The mobile terminal is a chart-first trading companion designed for touch, short decision cycles, and one focused task at a time. It shares stores, services, validation, and chart state with desktop, but its screen composition and interaction patterns are mobile-specific.

Mobile is not the desktop command center scaled down or embedded inside a sheet.

The maintained capability mapping is `../../../docs/MOBILE_DESKTOP_FEATURE_PARITY.md`.

---

## Implemented Navigation Model

The persistent bottom navigation contains exactly five labeled destinations:

1. **Chart** - symbol, shared-favorite timeframe strip, chart, Drawing, Indicators, Chart tools and Replay entry.
2. **Markets** - touch-friendly market cards plus complete watchlist search and management.
3. **Trade** - simulator, MT5 and Replay order flow, positions and bridge controls.
4. **Portfolio** - account balance, positions, and performance summary.
5. **Menu** - secondary workspaces and settings.

The active destination uses violet text/icon plus a visible top indicator. Preserve screen state when switching destinations.

Secondary workspaces open in sheets or full-screen sheets:

- Drawing tools.
- Indicators.
- Chart tools.
- Market replay.
- Trading journal.
- Performance analytics.
- Pine workspace.
- Object tree.
- Runtime logs.
- Account.

---

## Mobile Shell

```text
Mobile Terminal (100dvh)
├─ Active screen
│  ├─ Safe-area-aware screen header
│  └─ Scrollable or chart content
├─ Five-item bottom navigation
└─ Optional modal sheet above an isolated scrim
```

For the Chart screen:

```text
Chart Screen
├─ Top bar (about 58px plus safe area)
│  ├─ Brand mark
│  ├─ Symbol picker
│  └─ Account action
├─ Horizontal timeframe bar (44px region)
└─ Flexible chart viewport
   └─ Touch chart actions (Draw, Indicators, Tools, Replay)
```

Use `100dvh`, safe-area insets, and reserved navigation space. No scroll content may be hidden behind the bottom navigation or home indicator.

---

## Touch Density

| Element | Mobile rule |
|---|---|
| Minimum interactive target | 44x44px |
| Preferred primary/nav target | 48px or larger |
| Bottom navigation item | At least 50px high |
| Text input/select | At least 44px high, 16px text |
| Symbol/market row | 64-72px high |
| Screen horizontal gutter | 12-16px plus safe area |
| Card radius | 13-16px |
| Sheet radius | 18px top corners |
| Gap between adjacent targets | Prefer 8px |

A visual glyph may be 18-24px, but its interactive hit area still follows the minimum target rule.

---

## Screen Patterns

### Chart

- The chart consumes all remaining height after top bar, timeframe bar, and bottom navigation.
- The symbol picker is a dedicated 44px trigger, not a compact desktop combobox.
- Favorite timeframes scroll horizontally; each option has a 44px minimum width.
- The interval sheet exposes the shared desktop catalog, cloud-synced favorites and custom interval validation.
- Draw, Indicators, Tools and Replay are visible touch actions with label and icon.
- Chart overlays leave room for one-finger pan, pinch zoom, crosshair, and system gestures.
- The shared bottom chart-time toolbar provides Go to date and time-zone selection.

### Markets

- Use vertical quote cards or list rows, never a desktop multi-column watchlist table.
- Each row exposes symbol identity, venue/description, current quote, and signed change.
- Selected symbol uses accent-soft background plus a visible boundary.
- Search can add/remove symbols from the active shared watchlist.
- Manage watchlists provides list switching/create/rename/clear/delete, shared sorting, sections, collapse headers and explicit symbol/section move buttons.
- Reordering never depends on drag; ordinary vertical scroll remains reliable.
- Context actions have a visible overflow or detail action; long press is optional enhancement.

### Trade

- Present one order task at a time with progressive disclosure for advanced fields.
- Buy and sell remain explicit labeled actions, not color-only controls.
- Numeric fields use decimal input mode, 16px text, and clear validation.
- Critical live orders require a mobile-appropriate confirmation sheet.
- Positions render as structured cards/lists rather than a ten-column table.
- Execution mode, MT5 connection state, Replay bracket/close/cancel actions, account reset and Replay report export remain reachable.

### Portfolio

- Lead with balance/equity, then compact KPI cards and open positions.
- Use mono/tabular figures for changing metrics.
- Profit and loss include sign/label alongside bull/bear color.
- Empty states explain the next available action.

### Menu and secondary workspaces

- Menu groups use full-width rows at least 68px high with icon, title, and supporting copy.
- Secondary analytical workspaces may use full-screen sheets.
- The sheet title identifies the current task and always includes a visible close action.
- Chart tools groups SMC, snapshots, saved layouts, chart/replay arrangements, alerts, Object tree, runtime logs, display settings, connections and destructive chart actions.

---

## Sheets and Gestures

- The modal scrim uses the semantic `--scrim` and suppresses interaction with underlying app content.
- Standard sheet height is approximately 68dvh; complex workspaces may use a safe-area-aware full-screen sheet.
- The drag handle region is at least 44px high.
- Begin vertical drag only after an 8px movement threshold.
- Dismiss after a deliberate downward movement (the current behavior uses 72px), then animate with transform.
- Always provide a visible close button; swipe is never the only escape route.
- Do not intercept horizontal system back gestures, pinch zoom on the chart, or page scrolling outside the handle.
- Confirm before dismissing unsaved form work.

---

## Typography and Content

- Mobile shell base is 15px.
- Inputs and editable fields use at least 16px.
- Screen titles use approximately 24px with tight tracking.
- Section titles use 15-17px.
- Card values use 13-16px or larger for primary KPIs.
- Bottom navigation may use a compact 10-11px label because it is paired with a persistent icon; it must not contain task-critical instructions.
- Avoid uppercase body copy. Uppercase is reserved for short market/status metadata.

---

## Mobile Platform Isolation

Share:

- Stores and API state.
- Formatting, validation, and calculations.
- Chart engine and drawing models.
- Theme semantics and accessibility state naming.
- Drawing/timeframe/SMC catalogs, favorites synchronization, snapshots, authentication helpers and watchlist sorting.

Render independently:

- Symbol picker and timeframe picker.
- Market list/watchlist.
- Drawing palette.
- Order flow and confirmation.
- Position/portfolio list.
- Navigation, menus, dialogs, and sheets.

Do not use CSS to force a desktop rail into a horizontal strip or place a desktop dock/table unchanged inside a mobile sheet.

---

## Mobile Accessibility Checklist

- [ ] All primary targets are at least 44x44px.
- [ ] Adjacent critical targets have adequate spacing.
- [ ] Bottom navigation has icon, visible label, and `aria-current` for the active screen.
- [ ] Inputs have visible/programmatic labels, 16px text, and correct keyboard/input mode.
- [ ] Sheets expose dialog semantics, a title, a visible close button, and focus containment.
- [ ] Swipe, drag, and long-press interactions have button/menu alternatives.
- [ ] Safe areas are verified for top bar, bottom navigation, sheets, and landscape.
- [ ] Chart gestures do not conflict with system navigation.
- [ ] Dark and light themes are tested independently.
- [ ] Reduced motion keeps all tasks usable.

---

## Mobile Test Matrix

- 360x800 small Android-class viewport.
- 375x812 compact iPhone-class viewport.
- 390x844 standard modern phone.
- 430x932 large phone.
- Landscape with height at or below 520px.
- Coarse-pointer device at tablet width to confirm mobile platform policy.
- Dark and light theme for every viewport above.

---

## Mobile-Specific Anti-Patterns

- Desktop toolbar, right sidebar, bottom dock, or multi-column table embedded unchanged.
- A hard-coded mobile subset of a shared drawing, timeframe or indicator catalog.
- Touch targets below 44px for primary actions.
- Hover-only remove, favorite, settings, or context actions.
- Horizontal swipe on the main content region that competes with navigation.
- Bottom navigation with more than five top-level destinations.
- Gesture-only dismissal or destructive action.
- Fixed content hidden behind safe areas or the bottom navigation.
- Inputs below 16px text that trigger browser zoom.
- Decorative haptics, scanlines, typewriter loops, or animation that delays access to live data.
