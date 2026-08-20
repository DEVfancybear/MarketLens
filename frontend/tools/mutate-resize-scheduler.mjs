import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(scriptDir, "..");
const sourcePath = resolve(frontendDir, "src/components/chart/chartResizeScheduler.ts");
const testPath = ".test-build/tests/chart/chartResizeScheduler.test.js";
const original = readFileSync(sourcePath, "utf8");

const mutants = [
  {
    name: "schedule-every-frame",
    replace: "if (frameId === null) frameId = scheduleFrame(flush);",
    with: "frameId = scheduleFrame(flush);",
  },
  {
    name: "keep-first-size",
    replace: "pendingSize = { width, height };",
    with: "if (!pendingSize) pendingSize = { width, height };",
  },
  {
    name: "cancel-keeps-pending-size",
    replace: "pendingSize = null;",
    with: "pendingSize = pendingSize;",
  },
];

function run(command, args) {
  execFileSync(command, args, {
    cwd: frontendDir,
    stdio: "pipe",
    encoding: "utf8",
  });
}

let killed = 0;
try {
  for (const mutant of mutants) {
    const mutated = original.replace(mutant.replace, mutant.with);
    if (mutated === original) {
      throw new Error(`Mutation did not apply: ${mutant.name}`);
    }
    writeFileSync(sourcePath, mutated);
    let failed = false;
    try {
      run("npm.cmd", ["run", "test:build"]);
      run("node", ["--test", testPath]);
    } catch {
      failed = true;
    }
    if (!failed) throw new Error(`Surviving mutant: ${mutant.name}`);
    killed += 1;
  }
} finally {
  writeFileSync(sourcePath, original);
}

console.log(`manual mutation: ${killed}/${mutants.length} killed`);
