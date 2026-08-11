import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

const sourceRoot = resolve(__dirname, "../../../src");
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const nativeDialogNames = new Set(["alert", "confirm", "prompt"]);
const browserGlobals = new Set(["globalThis", "window"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

function usesNativeBrowserDialog(path: string): boolean {
  const extension = extname(path);
  const scriptKind = extension === ".tsx" || extension === ".jsx"
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  let violation = false;

  const visit = (node: ts.Node) => {
    if (violation) return;
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      violation =
        (ts.isIdentifier(expression) && nativeDialogNames.has(expression.text)) ||
        (ts.isPropertyAccessExpression(expression) &&
          ts.isIdentifier(expression.expression) &&
          browserGlobals.has(expression.expression.text) &&
          nativeDialogNames.has(expression.name.text));
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violation;
}

test("frontend source uses the common platform dialog instead of browser dialogs", () => {
  const violations = sourceFiles(sourceRoot).flatMap((path) => {
    return usesNativeBrowserDialog(path)
      ? [relative(sourceRoot, path).replaceAll("\\", "/")]
      : [];
  });

  assert.deepEqual(
    violations,
    [],
    `Replace native browser dialogs with PlatformDialog: ${violations.join(", ")}`,
  );
});
