# Draggable Dialog Architecture

_Last updated: 2026-07-14_

This document explains the shared TradingView-style draggable dialog behavior.
Read this before changing settings popups, modal dialogs, indicator dialogs, or
any chart UI surface that should be movable.

## 1. Behavior To Match

TradingView lets dialog-style popups move freely by dragging the header/title
area. The chart stays interactive behind the modal only where the overlay allows
it, while the dialog itself can be repositioned so it does not cover the user's
current candle, drawing, indicator, or watchlist area.

Expected behavior:

- drag starts from a header/title/tab strip, not from form controls,
- buttons, inputs, selects, textareas, and explicit no-drag regions remain
  clickable/editable,
- the dialog stays inside the viewport margin,
- resized viewports clamp the dialog back into reach,
- each dialog owns only its own position while open.

## 2. Shared Hook

File:

```txt
src/hooks/useDraggableDialog.ts
```

Use:

```tsx
const { dialogRef, dialogStyle, dragHandleProps, dragHandleClassName } =
  useDraggableDialog();

<div ref={dialogRef} style={dialogStyle}>
  <header {...dragHandleProps} className={cn("...", dragHandleClassName)}>
    ...
  </header>
</div>
```

The hook measures the dialog's current rendered location on mount, converts it
to a fixed-position surface, then updates `left/top` while the pointer is held
on the drag handle.

## 2.1 Responsive ownership

Dragging is a desktop/fine-pointer affordance. `useDraggableDialog` enables
the fixed-position drag state only at the desktop boundary (1100px or wider)
with a fine primary pointer. On mobile and coarse-pointer devices it returns
the dialog to its normal layout position so the shared `platform-dialog`
contract can size a bottom sheet, preserve native scrolling and keep the
header/tabs/footer reachable. Do not re-enable drag handlers as a workaround
for mobile placement; add a responsive slot or a viewport-safe surface rule
instead.

## 3. Initial Position

Most dialogs use their existing CSS/flex layout as the initial position. The
hook measures that rendered position, so no per-dialog centering math is needed.

Dialogs that already calculate a precise anchor can pass `initialPosition`:

```tsx
useDraggableDialog({ initialPosition });
```

`ChartTimeToolbar` uses this for the `Go to` popup so it still opens near the
bottom toolbar calendar button, then becomes freely draggable.

## 4. No-Drag Regions

Drag is ignored when the pointer starts inside:

```txt
button,input,textarea,select,a,[role='button'],[data-dialog-no-drag]
```

Use `data-dialog-no-drag` for any future custom control that is not covered by
the selector.

The hook checks `closest()` on any DOM `Element`, not only `HTMLElement`.
Keep that behavior: icon buttons often receive pointer events on nested
`svg/path` targets, and treating those as draggable can swallow the click on
close buttons.

## 5. Current Coverage

The shared hook is applied to:

- Indicator settings dialog,
- Drawing object settings dialog,
- Long/Short Position settings dialog,
- Text/Fib/shape/line settings surfaces through `ObjectSettingsDialog`,
- Indicator library popup and delete-script confirm dialog,
- Chart `Go to` date/range popup,
- Save drawing template dialog,
- Alert edit dialog,
- Live order confirm dialog.

Context menus and toolbar dropdown flyouts are intentionally not covered. They
are pointer-position menus, not movable modal dialogs.

## 6. Testing

Pure positioning math is covered by:

```bash
npm run test:ui
```

File:

```txt
tests/ui/draggableDialog.test.ts
```

The coarse-pointer policy is also covered by `tests/ui/platformPolicy.test.ts`,
while responsive sheet bounds, popovers, controls and toast placement are
covered by `tests/browser/mobileOverlayResponsive.spec.ts`.

Browser-level drag tests can be added later for pointer capture and visual drag
behavior. Keep viewport clamp math in the hook so all dialogs share fixes.
