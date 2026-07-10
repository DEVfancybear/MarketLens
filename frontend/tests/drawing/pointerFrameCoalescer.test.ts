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
