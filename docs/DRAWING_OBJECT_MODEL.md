# DRAWING OBJECT MODEL

_Date: 2026-06-25._

## Interface

```ts
// ---- Tool identifiers ----
type DrawingTool =
  | 'cursor' | 'crosshair' | 'eraser' | 'measure'    // modes
  | 'trendline' | 'horizontal' | 'vertical' | 'channel'  // lines
  | 'rectangle' | 'fib'                                // shapes
  | 'text' | 'emoji'                                   // annotations
  | 'long' | 'short'                                   // positions
  | 'brush';                                            // freehand

// ---- Geometry ----
interface Point {
  time: number;   // UTC seconds (bar open time)
  price: number;  // exact price
}

// ---- Drawing ----
interface Drawing {
  id: string;          // unique (uid('dw'))
  tool: DrawingTool;   // type discriminator
  color: string;       // hex color
  lineWidth: number;   // stroke width in pixels
  points: Point[];     // geometry (1–N points depending on tool)

  text?: string;       // annotation content (text/emoji tools)
  zIndex?: number;     // stacking order (higher = on top)
  locked?: boolean;    // cannot be moved or deleted
  visible?: boolean;   // render toggle (false = hidden)
  stop?: number;       // position tools: stop-loss price
  target?: number;     // position tools: take-profit price
}
```

## Tool → point count mapping

| Tool | Points | Notes |
|---|---|---|
| horizontal | 1 | Y-only (price) |
| vertical | 1 | X-only (time) |
| text, emoji | 1 | position + text content |
| long, short | 1–2 | 1=entry, 2=projection width |
| trendline, rectangle, fib | 2 | Vector-based |
| channel | 2–3 | 2 main + optional offset |
| brush | N | Freehand path, recorded per-pointer-move |

## Ownership

- Chart region: drawings scoped to `chartStore.drawings[]`
- Persisted per symbol: localStorage key `drawings:<symbol>`
- Lifecycle: created on user action, persist on every mutation, loaded on symbol change

## Extension points

To add a new drawing tool:
1. Add to `DrawingTool` union in `types/drawing.ts`
2. Add to `DRAWING_TOOLS` array (if it creates persistent objects)
3. Add render case in `drawingRenderer.ts`
4. Add hit-test case in `drawingHitTest.ts`
5. Add creation flow in `DrawingLayer.tsx` (onPointerDown)
6. Add toolbar icon in `DrawingToolbar.tsx` (Phase 4.6)
