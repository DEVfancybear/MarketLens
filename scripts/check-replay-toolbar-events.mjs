import fs from "node:fs";

const toolbar = fs.readFileSync(
  "src/components/replay/ReplayFloatingToolbar.tsx",
  "utf8",
);
const dropdown = fs.readFileSync("src/components/ui/Dropdown.tsx", "utf8");

const checks = [
  {
    name: "Floating replay toolbar is marked as chart UI",
    ok: toolbar.includes("data-chart-ui"),
  },
  {
    name: "Floating replay toolbar does not clip timing dropdown",
    ok: !toolbar.includes("overflow-hidden"),
  },
  {
    name: "Dropdown root is marked as chart UI",
    ok:
      dropdown.includes('data-chart-ui ref={ref}') ||
      dropdown.includes("data-chart-ui\n      ref={ref}"),
  },
  {
    name: "Dropdown menu is marked as chart UI",
    ok: dropdown.includes("<div\n          data-chart-ui"),
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
