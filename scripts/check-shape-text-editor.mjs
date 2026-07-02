import fs from "node:fs";

const textEditor = fs.readFileSync(
  "src/components/chart/drawing/TextEditor.tsx",
  "utf8",
);
const drawingLayer = fs.readFileSync(
  "src/components/chart/DrawingLayer.tsx",
  "utf8",
);

const checks = [
  {
    name: "TextEditor is marked as chart UI",
    ok: textEditor.includes("data-chart-ui"),
  },
  {
    name: "TextEditor commits on outside pointerdown in capture phase",
    ok:
      textEditor.includes('document.addEventListener("pointerdown"') &&
      textEditor.includes("handleOutsidePointerDown") &&
      textEditor.includes("true"),
  },
  {
    name: "TextEditor ignores pointerdown inside the input",
    ok: textEditor.includes("inputRef.current?.contains(target)"),
  },
  {
    name: "TextEditor guards against double commit from pointerdown plus blur",
    ok: textEditor.includes("doneRef.current"),
  },
  {
    name: "Shape text editor remounts per drawing id",
    ok: drawingLayer.includes("key={shapeTextEdit.drawingId}"),
  },
  {
    name: "Standalone text editor remounts per drawing id",
    ok: drawingLayer.includes("key={textEdit.drawingId}"),
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
