import assert from "node:assert/strict";
import test from "node:test";
import { TrailingReplayCommand } from "../../src/services/replay/trailingReplayCommand";

test("trailing replay control sends only the final slider value", async () => {
  const sent: number[] = [];
  const command = new TrailingReplayCommand<number>(
    15,
    (_current, incoming) => incoming,
    async (value) => { sent.push(value); },
  );
  await Promise.all([command.schedule(1), command.schedule(3), command.schedule(10)]);
  assert.deepEqual(sent, [10]);
});

test("trailing replay step combines rapid button presses", async () => {
  const sent: number[] = [];
  const command = new TrailingReplayCommand<number>(
    15,
    (current, incoming) => (current ?? 0) + incoming,
    async (value) => { sent.push(value); },
  );
  await Promise.all([command.schedule(1), command.schedule(1), command.schedule(10)]);
  assert.deepEqual(sent, [12]);
});
