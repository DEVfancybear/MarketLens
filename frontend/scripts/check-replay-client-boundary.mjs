import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const srcRoot = resolve(root, "src");
const failures = [];

const deletedFiles = [
  "src/hooks/useReplayPlayback.ts",
  "src/hooks/useReplayBackendShadow.ts",
  "src/hooks/useMtfSnapshotSeries.ts",
  "src/hooks/useVisibleCandles.ts",
  "src/services/replayEngine.ts",
  "src/store/replayStore.ts",
];
for (const file of deletedFiles) {
  if (existsSync(resolve(root, file))) failures.push(`${file}: legacy file must stay deleted`);
}

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const sourceFiles = walk(srcRoot).filter((file) => /\.[cm]?[jt]sx?$/.test(file));
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
  const source = readFileSync(file, "utf8");
  for (const identifier of removedIdentifiers) {
    if (new RegExp(`\\b${identifier}\\b`).test(source)) {
      failures.push(`${rel}: removed Replay identifier ${identifier}`);
    }
  }

  const replayModule = rel.includes("/replay/") || rel.includes("/replayClient") || rel.includes("/Replay");
  if (!replayModule) continue;
  if (/from\s+["'][^"']*(HistoricalDataService|tradeEngine)[^"']*["']/.test(source)) {
    failures.push(`${rel}: Replay client imports live history or simulation ownership`);
  }
  if (/\b(setInterval|setTimeout)\s*\(/.test(source) && !replayTimerModules.has(rel)) {
    failures.push(`${rel}: Replay timers are allowed only for transport and input debounce`);
  }
  if (/\brequestAnimationFrame\s*\(/.test(source) &&
      !rel.endsWith("components/replay/ReplaySelectionLayer.tsx") &&
      !rel.endsWith("components/chart/replayViewport.ts")) {
    failures.push(`${rel}: Replay animation frames are presentation-only`);
  }
  if (/\b(checkPendingTrigger|checkExit|candlesAtom)\b/.test(source)) {
    failures.push(`${rel}: Replay client imports forbidden market/trading state`);
  }
}

const projectionWriters = sourceFiles.filter((file) =>
  /replayClientStore\.(replaceSnapshot|replaceBars|applyEvent)\s*\(/.test(readFileSync(file, "utf8"))
);
for (const file of projectionWriters) {
  const rel = relative(root, file).replaceAll("\\", "/");
  if (![
    "src/services/replay/replaySocket.ts",
    "src/store/replayTradingClientStore.ts",
  ].includes(rel)) {
    failures.push(`${rel}: Replay projection writes must stay in approved client modules`);
  }
}

if (failures.length > 0) {
  console.error("Replay client boundary violations:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(`Replay client boundary OK (${sourceFiles.length} source files scanned)`);
