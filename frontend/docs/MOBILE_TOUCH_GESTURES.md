# Mobile Touch, Pointer and Drag Support

_Reviewed: 2026-07-16_

## Research basis

The mobile interaction model follows these primary standards:

- [W3C Pointer Events](https://www.w3.org/TR/pointerevents/) defines one hardware-agnostic event model for mouse, touch and pen, primary-pointer semantics, pointer capture and `touch-action`.
- [WCAG 2.2 — Dragging Movements (2.5.7)](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements) requires a single-pointer alternative when an interface uses a dragging movement.
- [WCAG 2.2 — Target Size (2.5.8)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) sets a 24 CSS pixel Level AA minimum or spacing exception. This product uses a stricter 44x44px mobile baseline.
- [WHATWG HTML Drag and Drop](https://html.spec.whatwg.org/dev/dnd.html) is retained for desktop file/list semantics only. Chart and touch gestures do not use native HTML DnD.

## Product decision

Use Pointer Events for chart drawing, sheet dismissal and every custom touch gesture. Do not fork separate mouse/touch handlers and do not use HTML Drag and Drop for chart objects.

Reasons:

- One `pointerId` can own a gesture from start through capture/release.
- `isPrimary` prevents a second finger from taking over a single-pointer drag.
- `pointercancel` and lost capture provide explicit rollback paths.
- `touch-action` declares whether the browser or application owns pan/zoom before the gesture begins.
- Pointer capture keeps the active gesture stable when a finger leaves the handle.

## Interaction ownership

| Surface | One pointer | Multiple pointers | Non-drag alternative |
|---|---|---|---|
| Chart, no drawing armed | pan/crosshair | pinch zoom | timeframe, Fit and zoom controls |
| Drawing armed | tap anchors or freehand draw | second pointer is ignored by the single-pointer operation | Cancel, Undo, numeric settings |
| Drawing selected | select; transform after movement threshold | foreign pointer cannot move/commit selection | coordinates/settings fields |
| Replay bar selection | scrub one primary captured pointer; tap confirm | foreign pointer is ignored | visible confirm/cancel, Arrow/Home/End, Enter/Space/Escape |
| Actionable chart popup | move from its dedicated handle | non-primary/foreign pointers are ignored | Arrow keys move, Home resets; popup actions remain tappable |
| Mobile sheet handle | pull down after 8px threshold | non-primary pointer ignored | Close button, scrim, Escape, browser Back |
| Sheet content | native vertical scroll | browser zoom where applicable | scrollbar and direct controls |
| Dialog/popover/toast surface | scrim, sheet footer and explicit close own the surface | underlying chart/list never receives a modal gesture | 44px controls, native scroll, safe-area placement |
| Market/list item | tap opens; explicit action button | native scroll remains owner | visible menu/move actions; no drag-only behavior |

## Sheet state machine

Implementation:

- `src/components/mobile/mobileSheetGesture.ts`
- `src/components/mobile/MobileSheet.tsx`

Rules:

1. Accept only a primary pointer while idle.
2. Store its `pointerId` and start coordinate.
3. Ignore movement through the first 8px to avoid accidental drags.
4. Expose only downward offset; upward movement resolves to zero.
5. Dismiss at 72px of visible downward movement.
6. `pointercancel` and lost capture always reset without dismissing.
7. Ignore all events from a foreign pointer.
8. Keep a Close button and scrim alternative.
9. Trap focus, close on Escape, return focus to the trigger and lock body scroll.
10. Top-level workspace sheets opened by `MobileTerminal` push a lightweight history state so browser Back closes the workspace before navigating away. Screen-local picker/manager sheets always retain visible Close, scrim and Escape paths.

The scrim carries `data-chart-ui`. Chart/drawing capture handlers must ignore any event whose target is inside this boundary, preventing a tap on a sheet control from creating a drawing behind the modal.

## Chart drawing and Replay ownership

Drawing, alert, and Replay overlays acquire named owners from the shared chart
interaction lock. The first owner snapshots the current scroll/scale options
and disables native chart gestures. The last owner restores that snapshot. An
overlay cleanup must release only its own owner; it may not blindly re-enable
pan/zoom while another overlay still owns the pointer stream.

During an active drawing transform, document-level `touchstart` and `touchmove`
blockers use `passive: false`, call `preventDefault()` when cancelable, and stop
propagation before Lightweight Charts receives the gesture. Rectangle handles
therefore remain resizable under real mobile touch emulation without changing
the chart viewport. Default drawing movement uses logical candle indices when
market context exists, preserving the object's visible bar span across closed
sessions and sparse Replay windows.

Replay selection uses a full-chart canvas with `touch-action: none` only while
the selector is active. It seeds a visible candidate line near the chart center,
captures one primary pointer, follows that pointer through scrub/release, and
ignores foreign pointers. Pointer cancel and lost capture clear ownership. The
mobile HUD provides 44px confirm/cancel targets, while the same canvas exposes
slider semantics and keyboard alternatives. Once a session exists, a compact
in-chart dock provides previous/play-next/speed/status access without forcing
the full Replay workspace open.

## Shared chart popup surface

Actionable floating surfaces owned by the mobile chart use one interaction
contract:

- `src/components/chart/ChartPopupSurface.tsx` provides the popup boundary and
  the visible `ChartPopupDragHandle`.
- `src/hooks/useDraggableSurface.ts` owns Pointer Events, pointer capture,
  cancel/lost-capture rollback, Arrow-key movement, Home reset and clamping.
- The nearest `data-chart-popup-bounds` element is the preferred movement
  boundary. Portalled surfaces fall back to the current Visual Viewport through
  `getViewportRect()`, including its offset during zoom or virtual-keyboard
  changes. Window resize, `visualViewport` resize/scroll and observed
  container/surface resizes all re-clamp the popup so it cannot be stranded
  outside the chart or visible viewport.
- Mobile chart actions, compact Replay controls, drawing settings and their
  option popovers, indicator legend, Replay selection HUD, risk controls, time
  zone menu and chart context menus use this shared behavior instead of
  implementing local mouse-only drag logic.
- `ChartArea` hosts mobile chart actions and compact Replay in the same
  `.mobile-chart-popup-stack`. This gives neighboring surfaces one positioning
  and stacking context, preserves the configured gap and prevents the Draw
  popup from covering Replay controls.
- Pointer-position context menus retain `useFloatingSurface` for anchor-aware
  placement and available-size calculation; on mobile, `ChartPopupSurface`
  layers the common drag, Escape/outside dismissal and chart-gesture isolation
  contract on top of that layout instead of replacing it.

Only the dedicated handle owns the move gesture and uses `touch-action: none`.
Buttons, inputs and scrollable popup content retain their normal tap, edit and
scroll behavior. The handle is at least 44x44px on mobile, has an accessible
label, supports keyboard movement and can reset the current offset.

This contract is intentionally limited to actionable chart-owned floating
surfaces. Crosshair labels, price markers, drawing previews and other
non-actionable transient overlays remain pointer-transparent and are not
draggable. Modal dialogs and `MobileSheet` keep their own focus, dismissal,
history and vertical-sheet gesture contracts; they are not wrapped in
`ChartPopupSurface`.

## CSS ownership

- Tap controls use `touch-action: manipulation`.
- Only dedicated sheet and chart-popup drag handles use `touch-action: none`.
- Scrollable sheet content keeps native `pan-y` behavior.
- Mobile input text is at least 16px to avoid iOS focus zoom.
- Touch controls are at least 44x44px, including timeframe buttons and modal actions.
- Safe-area insets are applied to app bars, bottom navigation, sheets, dialogs and toast placement.
- Dialogs use the shared `platform-dialog-overlay`/`platform-dialog` slots;
  anchored popovers use `mobile-popover`, and pointer-position menus clamp to
  `visualViewport` so a keyboard or pinch viewport cannot hide their actions.
- `prefers-reduced-motion` disables non-essential animation and transitions.

## Platform isolation

Mobile navigation, market cards, symbol picker, full timeframe browser, drawing palette, trade flow, portfolio, Replay, Journal, Analytics, Pine, Chart tools, Object tree, Logs and Account are mobile-owned presentations. They reuse stores/services and shared catalogs rather than desktop shell JSX. Desktop uses its own lazy-loaded command-center chunk.

This boundary prevents a desktop table/toolbar redesign from changing mobile hit targets, overflow or gesture ownership.

## Automated tests

`tests/ui/mobileSheetGesture.test.ts` covers:

- 8px activation threshold.
- 72px dismiss boundary.
- cancel rollback.
- rejection of non-primary and foreign pointers.

`tests/ui/draggableSurface.test.ts` covers chart/viewport clamping, including
surfaces larger than their bounds.

`tests/ui/platformPolicy.test.ts` covers phone, tablet, fine-pointer desktop and wide coarse-pointer policy.

`tests/browser/mobileReplay.spec.ts` covers the immediate Replay line, touch
scrubbing, primary-pointer ownership, compact landscape, session-expiry
cleanup, target sizes, a real touch commit, shared popup dragging and the
Replay/actions non-overlap and hit-test contract.

`tests/browser/mobileDrawing.spec.ts` creates and resizes a Rectangle with touch
events, moves its settings popup from the shared handle and asserts that the
underlying chart logical range does not move.

`tests/browser/mobileFeatureParity.spec.ts` verifies the complete drawing
manifest, full timeframe/favorite/custom flow, Indicator and Chart tools,
watchlist management, secondary workspace entry points, 44px targets and zero
document overflow in compact portrait and landscape.

`tests/browser/mobileOverlayResponsive.spec.ts` verifies the centered
timeframe chevron, adaptive settings sheet, Style/Text/Coordinates/Visibility
tabs, compact color/template popovers, native checkbox sizing, context-menu
bounds and non-blocking toast placement.

Run:

```bash
npm run test:ui
npm run typecheck
npx playwright test tests/browser/mobileReplay.spec.ts
npx playwright test tests/browser/mobileDrawing.spec.ts
npx playwright test tests/browser/mobileFeatureParity.spec.ts
npx playwright test tests/browser/mobileOverlayResponsive.spec.ts
```

## Browser/manual matrix

- Portrait: 320x568, 375x812, 390x844, 430x932.
- Landscape: 844x390.
- Tablet: 768x1024 and 1024x768.
- Desktop boundary: 1099/1100/1366px with fine and coarse pointers.
- Dark and light themes.
- Drawing armed while opening a sheet: drawing count must not change after tapping sheet controls.
- Primary pointer drag plus second pointer: second pointer must not move or finish the object.
- Replay selection shows a line before the first touch and offers visible confirm/cancel controls.
- Replay and chart actions keep their configured gap; hit-testing reaches the visible Replay control.
- Every actionable chart popup stays within chart/viewport bounds after touch drag, rotation and resize.
- Rectangle move/resize preserves both its logical-bar span and the chart viewport.
- `pointercancel`/lost capture: state rolls back and the sheet remains open.
- Browser Back, Escape, Close and scrim each dismiss one open sheet.
- Visible mobile buttons have no bounding box below 44px and the document has no horizontal overflow.
