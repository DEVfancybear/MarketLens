import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "src/components/chart/PriceChart.tsx",
  "src/components/chart/chartResizeScheduler.ts",
  "tests/chart/chartResizeScheduler.test.ts",
  "tsconfig.test.json",
  "docs/CANDLE_VIRTUALIZATION_RESEARCH.md",
  "tools/gauntlet-lightweight-charts.mjs",
  "tools/mutate-resize-scheduler.mjs",
].sort();
const hash = createHash("sha256");
for (const file of files) {
  hash.update(file);
  hash.update(readFileSync(resolve(frontendDir, file)));
}
console.log(hash.digest("hex"));
