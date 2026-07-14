import { expect, test, type Locator } from "@playwright/test";
import {
  DRAWING_TOOL_MANIFEST,
  isDrawingToolCreationEnabled,
} from "../../src/types/drawingToolManifest";

test.use({
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 },
});

async function expectTouchTargets(scope: Locator) {
  const undersized = await scope.locator("button:visible").evaluateAll((buttons) =>
    buttons
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          label: button.getAttribute("aria-label") ?? button.textContent?.trim(),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter((target) => target.width < 44 || target.height < 44),
  );
  expect(undersized).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/push/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto("/?chartFixture=900&chartFixtureTail=500", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await expect(page.locator('[data-platform="mobile"]')).toBeVisible();
});

test("mobile exposes the complete shared drawing manifest", async ({ page }) => {
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Drawing tools" });
  await expect(dialog).toBeVisible();

  const expectedTools = DRAWING_TOOL_MANIFEST.filter(
    (entry) => entry.group && isDrawingToolCreationEnabled(entry.id),
  );
  await expect(dialog.locator(".mobile-tool-card")).toHaveCount(expectedTools.length);
  for (const label of [
    "Trendline",
    "Modified Schiff Pitchfork",
    "Head and Shoulders",
    "Anchored VWAP",
    "Long position",
    "Table",
  ]) {
    await expect(dialog.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await expect(dialog.getByRole("switch", { name: "Keep drawing" })).toBeVisible();
  await expect(dialog.getByRole("radiogroup", { name: "New drawing synchronization" })).toBeVisible();

  const search = dialog.getByRole("searchbox", { name: "Search drawing tools" });
  await search.fill("pitchfork");
  await expect(dialog.locator(".mobile-tool-card")).toHaveCount(4);
  await search.fill("");
  await expectTouchTargets(dialog);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test("mobile shares the full interval catalog, favorites and custom interval flow", async ({ page }) => {
  await page.getByRole("button", { name: "Select interval" }).click();
  const dialog = page.getByRole("dialog", { name: "Chart interval" });
  await expect(dialog.getByText("1 week", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Custom interval type" })).toHaveValue("minutes");
  await dialog.getByRole("textbox", { name: "Custom interval value" }).fill("30");
  await expectTouchTargets(dialog);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "30m", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("mobile exposes indicator browser and chart command parity", async ({ page }) => {
  await page.getByRole("button", { name: "Indicators", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Indicators" });
  await expect(dialog.getByRole("searchbox", { name: "Search indicators" })).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "Store" })).toHaveAttribute("aria-selected", "true");
  await expectTouchTargets(dialog);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-platform="mobile"]')).toBeVisible();

  await page.getByRole("button", { name: "Tools", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Chart tools" });
  await expect(dialog.getByText("Smart Money Concepts", { exact: true })).toBeVisible();
  await expect(dialog.locator(".mobile-smc-grid > button")).toHaveCount(8);
  await expect(dialog.getByRole("button", { name: /Object tree/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Download image/ })).toBeVisible();
  await expect(dialog.getByRole("radiogroup", { name: "Chart arrangement" })).toBeVisible();
  await expectTouchTargets(dialog);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test("secondary desktop functions have mobile entry points", async ({ page }) => {
  await page.getByRole("button", { name: "Markets", exact: true }).click();
  await page.getByLabel("Search markets").click();
  let dialog = page.getByRole("dialog", { name: "Search markets" });
  await expect(dialog.getByPlaceholder("Search symbol, market or venue")).toBeVisible();
  await dialog.getByRole("button", { name: "Close Search markets" }).click();

  await page.getByRole("button", { name: "Manage watchlists" }).click();
  dialog = page.getByRole("dialog", { name: "Manage watchlists" });
  await expect(dialog.getByText("Sort instruments", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Sections", { exact: true })).toBeVisible();
  page.once("dialog", (prompt) => prompt.accept("FX Majors"));
  await dialog.getByRole("button", { name: "Add section" }).click();
  await expect(dialog.getByText("FX Majors", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close Manage watchlists" }).click();
  await expect(page.getByRole("button", { name: /FX Majors/ })).toBeVisible();

  await page.getByRole("button", { name: "Menu", exact: true }).click();
  for (const name of ["Indicators", "Chart tools", "Object tree", "Alerts", "Runtime logs", "Account"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await expectTouchTargets(page.locator('[data-platform="mobile"]'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test("new mobile workspaces remain touch-safe at compact and landscape sizes", async ({ page }) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Drawing tools" });
    await expect(dialog).toBeVisible();
    await expectTouchTargets(dialog);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await dialog.getByRole("button", { name: "Close Drawing tools" }).click();

    await page.getByRole("button", { name: "Tools", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Chart tools" });
    await expect(dialog).toBeVisible();
    await expectTouchTargets(dialog);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await dialog.getByRole("button", { name: "Close Chart tools" }).click();
  }
});
