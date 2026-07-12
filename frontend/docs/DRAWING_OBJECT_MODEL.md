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
  dataSnapshot?: DrawingDataSnapshot; // Wave D immutable OHLCV provenance, max 1,000 samples
  content?: DrawingRichContent;        // bounded table/image/social canvas content
  zIndex?: number;     // stacking order (higher = on top)
  locked?: boolean;    // cannot be moved or deleted
  visible?: boolean;   // render toggle (false = hidden)
  stop?: number;       // position tools: stop-loss price
  target?: number;     // position tools: take-profit price

  // Long/Short position settings
  accountSize?: number;
  accountCurrency?: string;       // "Default" or ISO-like display label
  lotSize?: number;
  riskValue?: number;
  riskUnit?: '%' | 'amount';
  leverage?: number;
  qtyPrecision?: number;
  showLabels?: boolean;
  stopColor?: string;
  targetColor?: string;
  positionStats?: ('percent' | 'ticks' | 'rr' | 'amount')[];
  compactStats?: boolean;
  alwaysShowStats?: boolean;
}
```

## Tool → point count mapping

| Tool | Points | Notes |
|---|---|---|
| horizontal | 1 | Y-only (price) |
| vertical | 1 | X-only (time) |
| text, emoji | 1 | position + text content |
| long, short | 3 | `[0]=entry left edge`, `[1]=target right edge`, `[2]=stop right edge`; a single click auto-expands to this 3-point box |
| trendline, rectangle, fib | 2 | Vector-based |
| channel | 2–3 | 2 main + optional offset |
| brush | N | Freehand path, recorded per-pointer-move |
| anchoredVWAP, anchoredVolumeProfile | 1 | anchor + immutable anchor-to-latest candle snapshot |
| regressionTrend, fixedVolumeProfile, barsPattern, ghostFeed | 2 | range + immutable between-anchor candle snapshot |
| forecast, sector | 3 | fixed manual projection geometry |
| table, image | 2 | bounded rich-content rectangle |
| socialEmbed | 1 | script-free static card + inline text |

Wave D snapshot samples are copied only when a creation transaction commits. Renderers derive
their pixels from the stored snapshot and never depend on the current live symbol/candle buffer.
Rich content is decoded through the same persistence boundary as geometry; executable HTML and
third-party iframe state are not part of the object model.

## Ownership

- Chart region: drawings scoped to `chartStore.drawings[]`
- Persisted per symbol: localStorage key `drawings:<symbol>`
- Lifecycle: created on user action, persist on every mutation, loaded on symbol change

## Extension points

To add a new drawing tool (plugin/adapter architecture — no `switch` cases):
1. Create `drawing/tools/plugins/MyNewTool.ts` implementing the `DrawingAdapter` plugin
   (`render`, `hitTest`, `movePoints`, `boundingBox`; optional `move`/`moveAnchor`/`getAnchors`)
   and call `registerTool(plugin)` at module load.
2. Add `import "./plugins/MyNewTool";` to `drawing/tools/adapters.ts`.
3. Add the tool id to the `DrawingTool` union (and `DRAWING_TOOLS`, if it creates persistent
   objects) in `types/drawing.ts`.
4. Add the toolbar icon in `DrawingToolbar.tsx`.

Creation/move/resize, hit-testing, and rendering are all driven by the adapter via
`getTool(tool)` — `DrawingLayer.tsx`, the renderer, and the interaction manager are
tool-agnostic and need no changes. See `TOOL_REGISTRY.md` and
`DRAWING_ENGINE_ARCHITECTURE.md` → Extensibility.
