import fs from "node:fs";

const brushTool = fs.readFileSync(
  "src/components/chart/drawing/tools/plugins/BrushTool.ts",
  "utf8",
);
const manager = fs.readFileSync(
  "src/components/chart/drawing/interaction/DrawingInteractionManager.ts",
  "utf8",
);
const registry = fs.readFileSync(
  "src/components/chart/drawing/tools/ToolRegistry.ts",
  "utf8",
);

const checks = [
  {
    name: "Tool registry supports pointer-drag continuous tools",
    ok:
      registry.includes("readonly continuous?: boolean") &&
      registry.includes("Pointer-drag freehand tool"),
  },
  {
    name: "Brush opts into continuous pointer-drag creation",
    ok:
      brushTool.includes('tool: "brush"') &&
      brushTool.includes("continuous: true") &&
      brushTool.includes("quadraticCurveTo"),
  },
  {
    name: "Brush selected state renders endpoint handles",
    ok:
      brushTool.includes("import { handle }") &&
      brushTool.includes("if (selected && last)") &&
      brushTool.includes("handle(g, p0.x, p0.y") &&
      brushTool.includes("handle(g, last.x, last.y"),
  },
  {
    name: "Drawing manager starts continuous tools without waiting for a second click",
    ok:
      manager.includes("adapter?.continuous") &&
      manager.includes("committedRef.current = [p]") &&
      manager.includes('state: "Drawing"') &&
      manager.includes("dragActiveRef.current = true"),
  },
  {
    name: "Drawing manager records continuous points on pointermove",
    ok:
      manager.includes("shouldRecordContinuousPoint") &&
      manager.includes("const next = [...committed, p]") &&
      manager.includes("transition({ anchors: next })"),
  },
  {
    name: "Drawing manager commits continuous stroke on pointerup",
    ok:
      manager.includes('document.addEventListener("pointerup", hU') &&
      manager.includes("if (pts.length >= adapter.minPoints)") &&
      manager.includes("points: pts.map((q) => ({ ...q }))"),
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
