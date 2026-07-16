# DRAWING STATE MACHINE — Phase 4.2.1

_Date: 2026-06-25. Updated 2026-07-17 for the current interaction manager._

## States

| State | Description | User sees |
|---|---|---|
| **Idle** | No active pointer transaction | Cursor selection, or an armed drawing tool awaiting input |
| **Drawing** | A creation session owns confirmed/transient anchors | Live `__pending` preview follows input |
| **MovingDrawing** | A transform session owns one or more drawing bodies | Selected geometry moves from transient points |
| **ResizingHandle** | A transform session owns one drawing anchor | Selected handle updates transient geometry |

## Transitions

```
Idle
  │ pointerdown with a creation tool
  ├─ one-point commit ───────────────────────────────→ Idle
  ▼
Drawing
  │ click second anchor OR drag >= 4px + pointerup
  ├─ commit; Keep Drawing off ──────────────────────→ Idle + cursor tool
  └─ commit; Keep Drawing on ───────────────────────→ Idle + same tool

Idle + cursor tool
  │ pointerdown on drawing body / selected handle
  ├──────────────────────────────→ MovingDrawing / ResizingHandle
  │ pointermove: transient preview only
  └ pointerup: atomic store + history commit ───────→ Idle

Any active state
  │ Escape, right-click cancellation, or owned pointercancel
  └────────────────────────────────────────────────→ Idle
```

## Implementation

| Concern | File | Mechanism |
|---|---|---|
| Active tool state | `activeToolAtom` in `chartStore` | Jotai state set by toolbar/shortcuts |
| Creation topology | `CreationSession.ts` | Click, two-point, freeform, and continuous commit rules |
| Shared drag gesture | `CreationGesture.ts` | 4px threshold and `pointerId` ownership for all two-point tools |
| Pointer arbitration | `DrawingInteractionManager.ts` | Capture/release, release guard, coalescing, cancel/reset, Keep Drawing |
| Preview rendering | `CanvasRenderer.ts` | Virtual `__pending` geometry read from the mutable machine ref |
| Transform commit | `BatchMoveDrawingsCommand` + `batchUpdateDrawingsAtom` | One atomic write and one undo entry |
| Cancel | `DrawingInteractionManager.reset()` | Clears sessions/live refs, releases chart lock, returns machine to Idle |
