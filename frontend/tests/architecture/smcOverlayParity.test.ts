import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { SMC_MENU_ITEMS } from "../../src/components/chart/smcMenuItems";
import { DEFAULT_SMC_SETTINGS } from "../../src/store/workspaceDefaults";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const smcLayer = source("src/components/smc/SmcLayer.tsx");
const smcMenu = source("src/components/toolbar/SmcMenu.tsx");
const supportedFeatures = [
  "structure",
  "swings",
  "fvg",
  "orderBlocks",
  "liquidity",
  "displacement",
  "sessions",
  "killzones",
] as const;

test("SMC menu and persisted defaults expose exactly the supported overlays", () => {
  const expected = [...supportedFeatures].sort();
  assert.deepEqual(
    SMC_MENU_ITEMS.map((item) => item.key).sort(),
    expected,
  );
  assert.deepEqual(Object.keys(DEFAULT_SMC_SETTINGS).sort(), expected);
  assert.match(smcMenu, /SMC_MENU_ITEMS\.map/);
});

test("SMC canvas remains above the chart and caps noisy overlay families", () => {
  assert.match(
    smcLayer,
    /pointer-events-none absolute inset-0 z-\[2\] h-full w-full/,
  );
  for (const projection of [
    "visibleStructures",
    "visibleSwings",
    "visibleFvgs",
    "visibleOrderBlocks",
    "visibleLiquidity",
    "visibleDisplacements",
    "visibleSessions",
    "visibleKillZones",
  ]) {
    assert.match(smcLayer, new RegExp(`\\b${projection}\\b`));
  }
  assert.match(smcLayer, /\bconst LIMITS\s*=/);
});

test("SMC liquidity labels and canvas fonts remain renderer-safe", () => {
  assert.match(smcLayer, /chip\(`\$\{l\.kind\}\$\{l\.swept \? " x" : ""\}`/);
  assert.match(smcLayer, /if \(!l\.swept\) priceTag\(l\.price, y, colLiq\);/);
  assert.match(smcLayer, /\bSMC_SANS_10\b/);
  assert.match(smcLayer, /\bSMC_MONO_10\b/);
  assert.doesNotMatch(smcLayer, /var\(--font/);
  assert.doesNotMatch(smcLayer, /[âš¡âœ•Ã¢ï¿½]/);
});

test("SMC menu renders an icon checkmark without mojibake", () => {
  assert.match(smcMenu, /import \{ Boxes, Check \} from "lucide-react"/);
  assert.match(smcMenu, /<Check size=\{10\}/);
  assert.doesNotMatch(smcMenu, /[Ã¢ï¿½]/);
});
