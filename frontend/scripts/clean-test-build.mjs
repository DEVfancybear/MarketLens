import { rmSync } from "node:fs";
import { resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, ".test-build");
if (!target.startsWith(root + sep) || !target.endsWith(`${sep}.test-build`)) {
  throw new Error(`Refusing to clean unexpected path: ${target}`);
}
rmSync(target, { recursive: true, force: true });
