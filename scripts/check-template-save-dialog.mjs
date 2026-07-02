import fs from "node:fs";

const files = [
  "src/components/chart/DrawingSettingsToolbar.tsx",
  "src/components/chart/ObjectSettingsDialog.tsx",
  "src/components/chart/SaveDrawingTemplateDialog.tsx",
];

const contents = Object.fromEntries(
  files.map((file) => [file, fs.readFileSync(file, "utf8")]),
);
const allSource = Object.values(contents).join("\n");

const checks = [
  {
    name: "Template save flow does not use native browser prompt",
    ok: !allSource.includes("Save drawing template as:") && !allSource.includes("window.prompt"),
  },
  {
    name: "Floating toolbar opens the shared save-template dialog",
    ok:
      contents["src/components/chart/DrawingSettingsToolbar.tsx"].includes(
        "SaveDrawingTemplateDialog",
      ) &&
      contents["src/components/chart/DrawingSettingsToolbar.tsx"].includes(
        "setTemplateDialogOpen(true)",
      ),
  },
  {
    name: "Object settings opens the shared save-template dialog",
    ok:
      contents["src/components/chart/ObjectSettingsDialog.tsx"].includes(
        "SaveDrawingTemplateDialog",
      ) &&
      contents["src/components/chart/ObjectSettingsDialog.tsx"].includes(
        "setTemplateDialogOpen(true)",
      ),
  },
  {
    name: "Save-template dialog matches TradingView modal title and field label",
    ok:
      contents["src/components/chart/SaveDrawingTemplateDialog.tsx"].includes(
        "Save drawing template",
      ) &&
      contents["src/components/chart/SaveDrawingTemplateDialog.tsx"].includes(
        "New template name",
      ),
  },
  {
    name: "Save-template dialog supports selecting existing names for overwrite",
    ok:
      contents["src/components/chart/SaveDrawingTemplateDialog.tsx"].includes(
        "templateNames.map",
      ) &&
      contents["src/components/chart/SaveDrawingTemplateDialog.tsx"].includes(
        "setName(templateName)",
      ),
  },
  {
    name: "Save button is disabled until a non-empty name exists",
    ok:
      contents["src/components/chart/SaveDrawingTemplateDialog.tsx"].includes(
        "disabled={!trimmed}",
      ),
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
