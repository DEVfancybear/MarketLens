import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const toolbar = source("src/components/replay/ReplayFloatingToolbar.tsx");
const dropdown = source("src/components/ui/Dropdown.tsx");

test("floating Replay controls remain inside chart interaction boundaries", () => {
  assert.match(toolbar, /\bdata-chart-ui\b/);
  assert.doesNotMatch(
    toolbar,
    /overflow-hidden/,
    "the timing dropdown must not be clipped by the floating toolbar",
  );
});

test("Dropdown marks both its trigger root and portal panel as chart UI", () => {
  assert.match(
    dropdown,
    /<div\b(?=[^>]*\bdata-chart-ui\b)(?=[^>]*ref=\{ref\})[^>]*>/s,
  );
  assert.match(
    dropdown,
    /<div\b(?=[^>]*\bdata-chart-ui\b)(?=[^>]*\bdata-dropdown-portal=)[^>]*>/s,
  );
});
