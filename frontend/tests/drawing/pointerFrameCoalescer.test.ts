import assert from "node:assert/strict";
import { test } from "node:test";

import { PointerFrameCoalescer } from "../../src/components/chart/drawing/interaction/PointerFrameCoalescer";

test("common drag coalescer applies immediately then keeps only the latest frame sample", () => {
  const applied: number[] = [];
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  const coalescer = new PointerFrameCoalescer<number>(
    (value) => applied.push(value),
    (callback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    (id) => frames.delete(id),
  );

  coalescer.push(1);
  coalescer.push(2);
  coalescer.push(3);

  assert.deepEqual(applied, [1]);
  assert.equal(frames.size, 1);
  const [id, frame] = [...frames.entries()][0];
  frames.delete(id);
  frame(16);
  assert.deepEqual(applied, [1, 3]);
});

test("pointer-up flush cancels a queued move and commits the exact final sample", () => {
  const applied: number[] = [];
  const canceled: number[] = [];
  let frame: FrameRequestCallback | null = null;
  const coalescer = new PointerFrameCoalescer<number>(
    (value) => applied.push(value),
    (callback) => {
      frame = callback;
      return 7;
    },
    (id) => {
      canceled.push(id);
      frame = null;
    },
  );

  coalescer.push(10);
  coalescer.push(20);
  coalescer.flush(30);

  assert.deepEqual(applied, [10, 30]);
  assert.deepEqual(canceled, [7]);
  assert.equal(frame, null);
});

test("default frame scheduler keeps the browser global receiver", () => {
  const rafDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "requestAnimationFrame",
  );
  const cancelDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "cancelAnimationFrame",
  );
  let frame: FrameRequestCallback | null = null;
  let canceled = 0;

  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: function (this: typeof globalThis, callback: FrameRequestCallback) {
      assert.equal(this, globalThis);
      frame = callback;
      return 9;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: function (this: typeof globalThis, handle: number) {
      assert.equal(this, globalThis);
      canceled = handle;
    },
  });

  try {
    const applied: number[] = [];
    const coalescer = new PointerFrameCoalescer<number>((value) =>
      applied.push(value),
    );

    coalescer.push(1);
    coalescer.push(2);
    assert.deepEqual(applied, [1]);
    assert.ok(frame);
    (frame as FrameRequestCallback)(16);
    assert.deepEqual(applied, [1, 2]);

    coalescer.push(3);
    coalescer.cancel();
    assert.equal(canceled, 9);
  } finally {
    if (rafDescriptor) {
      Object.defineProperty(globalThis, "requestAnimationFrame", rafDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    }
    if (cancelDescriptor) {
      Object.defineProperty(globalThis, "cancelAnimationFrame", cancelDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
    }
  }
});
