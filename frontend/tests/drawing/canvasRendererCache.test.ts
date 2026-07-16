import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import {
  createRenderLoop,
  partitionStaticScene,
} from "../../src/components/chart/drawing/renderer/CanvasRenderer";
import { getTool } from "../../src/components/chart/drawing/tools/ToolRegistry";

class FakeContext {
  operations: string[] = [];
  strokeStyle: string | CanvasGradient | CanvasPattern = "#000000";
  fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  lineWidth = 1;

  setTransform(a: number, _b: number, _c: number, d: number): void {
    this.operations.push(`transform:${a}:${d}`);
  }

  clearRect(): void {
    this.operations.push("clear");
  }

  setLineDash(): void {
    // renderDrawing resets the dash for every drawing.
  }

  save(): void {
    this.operations.push("save");
  }

  restore(): void {
    this.operations.push("restore");
  }

  drawImage(image: CanvasImageSource): void {
    this.operations.push(`image:${(image as unknown as FakeCanvas).name}`);
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  readonly context = new FakeContext();

  constructor(
    readonly name: string,
    readonly ownerDocument: Document,
    private readonly cssWidth = 120,
    private readonly cssHeight = 100,
  ) {}

  getContext(): CanvasRenderingContext2D {
    return this.context as unknown as CanvasRenderingContext2D;
  }

  getBoundingClientRect(): DOMRect {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: this.cssWidth,
      bottom: this.cssHeight,
      width: this.cssWidth,
      height: this.cssHeight,
      toJSON: () => ({}),
    } as DOMRect;
  }
}

function rectangle(id: string, zIndex: number): Drawing {
  return {
    id,
    tool: "rectangle",
    color: "#2962ff",
    lineWidth: 1.5,
    points: [
      { time: 10 + zIndex * 10, price: 10 },
      { time: 20 + zIndex * 10, price: 30 },
    ],
    visible: true,
    zIndex,
  };
}

test("static scene partition preserves ordered layers around one or many dynamic drawings", () => {
  const drawings = ["a", "b", "c", "d", "e"].map((id) => ({ id }));

  assert.deepEqual(partitionStaticScene(drawings, new Set(["c"])), {
    firstDynamicIndex: 2,
    lastDynamicIndex: 2,
  });
  assert.deepEqual(partitionStaticScene(drawings, new Set(["b", "d"])), {
    firstDynamicIndex: 1,
    lastDynamicIndex: 3,
  });
  assert.deepEqual(partitionStaticScene(drawings, new Set()), {
    firstDynamicIndex: drawings.length,
    lastDynamicIndex: drawings.length - 1,
  });
});

test("pending creation preview renders on the first invalidated-index frame", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousRaf = Object.getOwnPropertyDescriptor(
    globalThis,
    "requestAnimationFrame",
  );
  const previousCancelRaf = Object.getOwnPropertyDescriptor(
    globalThis,
    "cancelAnimationFrame",
  );
  let pendingFrame: FrameRequestCallback | null = null;
  let ownerDocument: Document;
  ownerDocument = {
    createElement: () =>
      new FakeCanvas("pending-layer", ownerDocument) as unknown as HTMLCanvasElement,
  } as unknown as Document;
  const canvas = new FakeCanvas("pending-main", ownerDocument);
  const adapter = getTool("rectangle");
  assert.ok(adapter);
  const originalRender = adapter.render;
  const rendered: string[] = [];
  const restoreGlobal = (
    name: "window" | "requestAnimationFrame" | "cancelAnimationFrame",
    descriptor: PropertyDescriptor | undefined,
  ) => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { devicePixelRatio: 1 },
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => {
      pendingFrame = callback;
      return 1;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: () => {
      pendingFrame = null;
    },
  });
  adapter.render = (_context, drawing) => {
    rendered.push(drawing.id);
  };

  let loop: ReturnType<typeof createRenderLoop> | null = null;
  try {
    loop = createRenderLoop({
      canvasRef: { current: canvas as unknown as HTMLCanvasElement },
      toX: (time) => time,
      toY: (price) => price,
      getData: () => ({
        drawings: [rectangle("committed", 0)],
        drawingsHidden: false,
        selectedDrawingId: null,
        selectedDrawingIds: new Set<string>(),
        drawColor: "#2962ff",
        activeTool: "rectangle",
        machine: {
          state: "Drawing",
          anchors: [
            { time: 30, price: 20 },
            { time: 60, price: 40 },
          ],
          drawingTool: "rectangle",
        },
        chartReady: true,
        livePoints: null,
        draggingId: null,
        hoveredId: null,
        barIntervalSeconds: 60,
      }),
    });
    assert.ok(pendingFrame);
    const callback = pendingFrame as FrameRequestCallback;
    pendingFrame = null;
    callback(performance.now());
    assert.deepEqual(rendered, ["committed", "__pending"]);
  } finally {
    loop?.destroy();
    adapter.render = originalRender;
    restoreGlobal("window", previousWindow);
    restoreGlobal("requestAnimationFrame", previousRaf);
    restoreGlobal("cancelAnimationFrame", previousCancelRaf);
  }
});

test("drag frames reuse DPR-scaled static layers and forced renders invalidate them", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousRaf = Object.getOwnPropertyDescriptor(
    globalThis,
    "requestAnimationFrame",
  );
  const previousCancelRaf = Object.getOwnPropertyDescriptor(
    globalThis,
    "cancelAnimationFrame",
  );
  const windowStub = { devicePixelRatio: 2 };
  let pendingFrame: FrameRequestCallback | null = null;
  let nextFrameId = 0;
  const layers: FakeCanvas[] = [];
  let ownerDocument: Document;
  ownerDocument = {
    createElement: () => {
      const layer = new FakeCanvas(`layer-${layers.length}`, ownerDocument);
      layers.push(layer);
      return layer as unknown as HTMLCanvasElement;
    },
  } as unknown as Document;
  const canvas = new FakeCanvas("main", ownerDocument);
  const adapter = getTool("rectangle");
  assert.ok(adapter);
  const originalRender = adapter.render;
  const renderCounts = new Map<string, number>();
  let drawings = [rectangle("a", 0), rectangle("b", 1), rectangle("c", 2)];
  const selectedDrawingIds = new Set(["b"]);
  let livePoints = new Map([
    [
      "b",
      [
        { time: 30, price: 20 },
        { time: 50, price: 40 },
      ],
    ],
  ]);

  const restoreGlobal = (
    name: "window" | "requestAnimationFrame" | "cancelAnimationFrame",
    descriptor: PropertyDescriptor | undefined,
  ) => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  };
  const runFrame = () => {
    const callback = pendingFrame;
    assert.ok(callback, "a render frame should be scheduled");
    pendingFrame = null;
    callback(performance.now());
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: windowStub,
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => {
      pendingFrame = callback;
      return ++nextFrameId;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: () => {
      pendingFrame = null;
    },
  });
  adapter.render = (context, drawing) => {
    renderCounts.set(drawing.id, (renderCounts.get(drawing.id) ?? 0) + 1);
    (context as unknown as FakeContext).operations.push(`render:${drawing.id}`);
  };

  let loop: ReturnType<typeof createRenderLoop> | null = null;
  try {
    loop = createRenderLoop({
      canvasRef: { current: canvas as unknown as HTMLCanvasElement },
      toX: (time) => time,
      toY: (price) => price,
      getData: () => ({
        drawings,
        drawingsHidden: false,
        selectedDrawingId: null,
        selectedDrawingIds,
        drawColor: "#2962ff",
        activeTool: "rectangle",
        machine: null,
        chartReady: true,
        livePoints,
        draggingId: "b",
        hoveredId: null,
        barIntervalSeconds: 60,
      }),
    });

    runFrame();
    assert.equal(layers.length, 2, "one static layer is kept on each z-order side");
    assert.deepEqual(
      layers.map((layer) => [layer.width, layer.height]),
      [
        [240, 200],
        [240, 200],
      ],
      "cache surfaces retain the main canvas DPR",
    );
    assert.ok(
      layers.every((layer) => layer.context.operations.includes("transform:2:2")),
    );
    assert.deepEqual(Object.fromEntries(renderCounts), { a: 1, c: 1, b: 1 });

    const secondFrameStart = canvas.context.operations.length;
    livePoints = new Map([
      [
        "b",
        [
          { time: 35, price: 22 },
          { time: 55, price: 42 },
        ],
      ],
    ]);
    loop.markDirty();
    runFrame();

    assert.equal(layers.length, 2, "static canvases should be reused across drag frames");
    assert.deepEqual(Object.fromEntries(renderCounts), { a: 1, c: 1, b: 2 });
    assert.deepEqual(
      canvas.context.operations
        .slice(secondFrameStart)
        .filter((operation) =>
          operation.startsWith("image:") || operation.startsWith("render:"),
        ),
      ["image:layer-0", "render:b", "image:layer-1"],
      "cached prefix/dynamic/cached suffix keep their original compositing order",
    );

    const staleLayers = [...layers];
    // The production render memo hashes Set values only when its reference
    // changes. The layer cache still checks actual static selection flags so a
    // mutable Set cannot leave stale handles baked into a static bitmap.
    selectedDrawingIds.add("a");
    livePoints = new Map([
      [
        "b",
        [
          { time: 36, price: 23 },
          { time: 56, price: 43 },
        ],
      ],
    ]);
    loop.markDirty();
    runFrame();
    assert.equal(layers.length, 4, "static selection changes rebuild cached pixels");
    assert.ok(staleLayers.every((layer) => layer.width === 0 && layer.height === 0));
    assert.deepEqual(Object.fromEntries(renderCounts), { a: 2, c: 2, b: 3 });

    const forcedStaleLayers = [...layers];
    loop.markDirty(true);
    runFrame();
    assert.equal(layers.length, 6, "a forced projection repaint rebuilds both layers");
    assert.ok(
      forcedStaleLayers.every((layer) => layer.width === 0 && layer.height === 0),
      "invalidated canvas memory should be released eagerly",
    );
    assert.deepEqual(Object.fromEntries(renderCounts), { a: 3, c: 3, b: 4 });

    drawings = drawings.map((drawing) =>
      drawing.id === "a" ? { ...drawing, zIndex: 4 } : drawing,
    );
    livePoints = new Map([
      [
        "b",
        [
          { time: 37, price: 24 },
          { time: 57, price: 44 },
        ],
      ],
    ]);
    loop.markDirty();
    runFrame();
    assert.deepEqual(
      Object.fromEntries(renderCounts),
      { a: 4, c: 4, b: 5 },
      "z-order-only changes must bypass the render memo",
    );

    drawings = drawings.map((drawing) =>
      drawing.id === "c"
        ? { ...drawing, clientRevision: (drawing.clientRevision ?? 0) + 1 }
        : drawing,
    );
    livePoints = new Map([
      [
        "b",
        [
          { time: 38, price: 25 },
          { time: 58, price: 45 },
        ],
      ],
    ]);
    loop.markDirty();
    runFrame();
    assert.deepEqual(
      Object.fromEntries(renderCounts),
      { a: 5, c: 5, b: 6 },
      "non-geometric store revisions must bypass the render memo",
    );
  } finally {
    loop?.destroy();
    adapter.render = originalRender;
    restoreGlobal("window", previousWindow);
    restoreGlobal("requestAnimationFrame", previousRaf);
    restoreGlobal("cancelAnimationFrame", previousCancelRaf);
  }
});
