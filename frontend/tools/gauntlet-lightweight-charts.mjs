import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  execFileSync(command, args, {
    cwd: frontendDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

run("npm", ["run", "test:chart"]);
run("npm", ["run", "typecheck"]);
run("npm", ["run", "lint"]);
run("node", ["tools/mutate-resize-scheduler.mjs"]);

const packageVersion = execFileSync(
  "node",
  ["-p", "require('./node_modules/lightweight-charts/package.json').version"],
  { cwd: frontendDir, encoding: "utf8" },
).trim();
if (packageVersion !== "5.2.0") {
  throw new Error(`Expected lightweight-charts 5.2.0, found ${packageVersion}`);
}
console.log(`lightweight-charts: ${packageVersion} (package + lockfile verified separately)`);
