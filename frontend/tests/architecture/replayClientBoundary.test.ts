import assert from "node:assert/strict";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const srcRoot = resolve(root, "src");

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const sourceFiles = walk(srcRoot).filter((file) => /\.[cm]?[jt]sx?$/.test(file));

test("legacy Replay client ownership files remain deleted", () => {
  const deletedFiles = [
    "src/hooks/useReplayPlayback.ts",
    "src/hooks/useReplayBackendShadow.ts",
    "src/hooks/useMtfSnapshotSeries.ts",
    "src/hooks/useVisibleCandles.ts",
    "src/services/replayEngine.ts",
    "src/store/replayStore.ts",
  ];

  for (const file of deletedFiles) {
    assert.equal(existsSync(resolve(root, file)), false, `${file} must stay deleted`);
  }
});

test("Replay source stays on the approved client boundary", () => {
  const failures: string[] = [];
  const removedIdentifiers = [
    "getReplayState",
    "stepAtom",
    "cursorAtom",
    "anchorAtom",
    "setCursorAtom",
    "reconcileReplayToCandlesAtom",
    "mtfSnapshot",
  ];
  const replayTimerModules = new Set([
    "src/services/replay/replaySocket.ts",
    "src/services/replay/trailingReplayCommand.ts",
  ]);

  for (const file of sourceFiles) {
    const rel = relative(root, file).replaceAll("\\", "/");
    const fileSource = readFileSync(file, "utf8");
    for (const identifier of removedIdentifiers) {
      if (new RegExp(`\\b${identifier}\\b`).test(fileSource)) {
        failures.push(`${rel}: removed Replay identifier ${identifier}`);
      }
    }

    const replayModule =
      rel.includes("/replay/") ||
      rel.includes("/replayClient") ||
      rel.includes("/Replay");
    if (!replayModule) continue;

    if (
      /from\s+["'][^"']*(HistoricalDataService|tradeEngine)[^"']*["']/.test(
        fileSource,
      )
    ) {
      failures.push(`${rel}: imports live history or simulation ownership`);
    }
    if (
      /\b(setInterval|setTimeout)\s*\(/.test(fileSource) &&
      !replayTimerModules.has(rel)
    ) {
      failures.push(`${rel}: timers are allowed only for transport and input debounce`);
    }
    if (
      /\brequestAnimationFrame\s*\(/.test(fileSource) &&
      !rel.endsWith("components/replay/ReplaySelectionLayer.tsx") &&
      !rel.endsWith("components/chart/replayViewport.ts")
    ) {
      failures.push(`${rel}: animation frames are presentation-only`);
    }
    if (/\b(checkPendingTrigger|checkExit|candlesAtom)\b/.test(fileSource)) {
      failures.push(`${rel}: imports forbidden market/trading state`);
    }
  }

  assert.deepEqual(failures, []);
});

test("only approved modules write Replay projections", () => {
  const approvedWriters = new Set([
    "src/services/replay/replaySocket.ts",
    "src/store/replayTradingClientStore.ts",
  ]);
  const projectionWriters = sourceFiles
    .filter((file) =>
      /replayClientStore\.(replaceSnapshot|replaceBars|applyEvent)\s*\(/.test(
        readFileSync(file, "utf8"),
      ),
    )
    .map((file) => relative(root, file).replaceAll("\\", "/"));

  assert.deepEqual(
    projectionWriters.filter((file) => !approvedWriters.has(file)),
    [],
  );
});
