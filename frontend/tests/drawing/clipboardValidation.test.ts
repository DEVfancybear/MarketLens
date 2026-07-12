import assert from "node:assert/strict";
import { test } from "node:test";

import { ClipboardManager } from "../../src/components/chart/drawing/history/ClipboardManager";

test("clipboard paste validates payloads and strips unknown tools", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        readText: async () =>
          JSON.stringify([
            {
              id: "valid",
              tool: "trendline",
              color: "#2962ff",
              lineWidth: 1.5,
              points: [
                { time: 1, price: 1 },
                { time: 2, price: 2 },
              ],
            },
            {
              id: "unknown",
              tool: "future-tool",
              points: [{ time: 1, price: 1 }],
            },
          ]),
        writeText: async () => {},
      },
    },
  });
  try {
    const pasted = await new ClipboardManager().paste();
    assert.equal(pasted.length, 1);
    assert.equal(pasted[0].id, "valid");
    assert.equal(pasted[0].schemaVersion, 1);
    assert.equal(pasted[0].points[0].time, 61);
  } finally {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
