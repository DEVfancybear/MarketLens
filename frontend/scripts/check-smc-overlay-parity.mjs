import fs from "node:fs";

const smcLayer = fs.readFileSync("src/components/smc/SmcLayer.tsx", "utf8");
const smcMenu = fs.readFileSync("src/components/toolbar/SmcMenu.tsx", "utf8");
const smcStore = fs.readFileSync("src/store/smcStore.ts", "utf8");

const features = [
  "structure",
  "swings",
  "fvg",
  "orderBlocks",
  "liquidity",
  "displacement",
  "sessions",
  "killzones",
];

const checks = [
  {
    name: "SMC overlay canvas is above the chart canvas in the live UI",
    ok: smcLayer.includes('className="pointer-events-none absolute inset-0 z-[2] h-full w-full"'),
  },
  {
    name: "SMC layer caps every noisy overlay family before rendering",
    ok:
      smcLayer.includes("const LIMITS =") &&
      smcLayer.includes("visibleStructures") &&
      smcLayer.includes("visibleSwings") &&
      smcLayer.includes("visibleFvgs") &&
      smcLayer.includes("visibleOrderBlocks") &&
      smcLayer.includes("visibleLiquidity") &&
      smcLayer.includes("visibleDisplacements") &&
      smcLayer.includes("visibleSessions") &&
      smcLayer.includes("visibleKillZones"),
  },
  {
    name: "SMC liquidity only shows price tags for active untaken pools",
    ok:
      smcLayer.includes('chip(`${l.kind}${l.swept ? " x" : ""}`') &&
      smcLayer.includes("if (!l.swept) priceTag(l.price, y, colLiq);"),
  },
  {
    name: "SMC canvas fonts are concrete and do not rely on CSS vars",
    ok:
      smcLayer.includes("SMC_SANS_10") &&
      smcLayer.includes("SMC_MONO_10") &&
      !smcLayer.includes("var(--font"),
  },
  {
    name: "SMC menu includes every supported feature toggle",
    ok: features.every((feature) => smcMenu.includes(`key: "${feature}"`)),
  },
  {
    name: "SMC store keeps every supported feature in settings",
    ok: features.every((feature) => smcStore.includes(`${feature}:`)),
  },
  {
    name: "SMC menu uses icon checkmark instead of mojibake text",
    ok:
      smcMenu.includes("import { Boxes, Check }") &&
      smcMenu.includes("<Check size={10}") &&
      !/[â�]/.test(smcMenu),
  },
  {
    name: "SMC layer labels avoid unsupported canvas glyph markers",
    ok: !/[⚡✕â�]/.test(smcLayer),
  },
];

const failed = checks.filter((check) => !check.ok);

if (failed.length > 0) {
  for (const check of failed) {
    console.error(`FAIL ${check.name}`);
  }
  process.exit(1);
}

for (const check of checks) {
  console.log(`PASS ${check.name}`);
}
