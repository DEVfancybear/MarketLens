import { expect, test, type Page } from "@playwright/test";
import type { DrawingInteractionTestHarness } from "../../src/components/chart/drawing/testing/testHarnessTypes";

declare global {
  interface Window {
    __drawingInteractionTest?: DrawingInteractionTestHarness;
  }
}

const FIXTURE_URL = "/?chartFixture=900&chartFixtureTail=500&chartBenchmarkProfile=phase2";

async function drawingSnapshot(page: Page) {
  return page.evaluate(() => {
    if (!window.__drawingInteractionTest) {
      throw new Error("Drawing test harness unavailable");
    }
    return window.__drawingInteractionTest.snapshot();
  });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/push/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForFunction(() =>
    Boolean(window.__drawingInteractionTest && window.__chartInteractionTest),
  );
  await page.evaluate(() => window.__drawingInteractionTest?.clear());
});

test("all persistent tools register and satisfy the executable adapter contract", async ({ page }) => {
  for (let iteration = 0; iteration < 3; iteration++) {
    const audit = await page.evaluate(() =>
      window.__drawingInteractionTest!.auditAdapters(),
    );
    expect(audit.expectedToolIds).toHaveLength(62);
    expect(audit.registeredToolIds).toEqual(audit.expectedToolIds);
    expect(audit.fixtureToolIds).toEqual(audit.expectedToolIds);
    expect(audit.errors).toEqual([]);
  }
});

test("Phase 8 Wave A range, cycle, and inline-note gestures commit transactionally", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const a = { x: pane.x + pane.width * 0.28, y: pane.y + pane.height * 0.66 };
  const b = { x: pane.x + pane.width * 0.58, y: pane.y + pane.height * 0.36 };

  await page.getByRole("button", { name: "Ranges", exact: true }).click();
  await page.getByRole("button", { name: /^Date and price range\b/ }).click();
  await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y);

  await page.getByRole("button", { name: "Patterns", exact: true }).click();
  await page.getByRole("button", { name: /^Cyclic lines\b/ }).click();
  await page.mouse.click(a.x + 40, a.y); await page.mouse.click(b.x + 40, b.y);

  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("button", { name: /^Note\b/ }).click();
  await page.mouse.click(a.x, b.y);
  const editor = page.getByPlaceholder("Enter text...");
  await editor.fill("Wave A note"); await editor.press("Enter");

  await expect.poll(async () => (await drawingSnapshot(page)).drawings.map((drawing) => drawing.tool))
    .toEqual(["datePriceRange", "cyclicLines", "note"]);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.map((drawing) => drawing.tool))
    .toEqual(["datePriceRange", "cyclicLines"]);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[2]?.text).toBe("Wave A note");
});

test("Phase 8 Wave B level, radial, grid, and pitchfork gestures use manifest contracts", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const a = { x: pane.x + pane.width * 0.24, y: pane.y + pane.height * 0.66 };
  const b = { x: pane.x + pane.width * 0.48, y: pane.y + pane.height * 0.36 };
  const c = { x: pane.x + pane.width * 0.64, y: pane.y + pane.height * 0.56 };
  const create = async (name: RegExp, points: typeof a[]) => {
    await page.getByRole("button", { name: "Fib Retracement", exact: true }).click();
    await page.getByRole("button", { name }).click();
    for (const point of points) await page.mouse.click(point.x, point.y);
  };
  await create(/^Fib Channel\b/, [a,b,c]);
  await create(/^Fib Speed Resistance Fan\b/, [a,b]);
  await create(/^Fib Circles\b/, [a,b]);
  await create(/^Gann Square\b/, [a,b]);
  await create(/^Pitchfork\b/, [a,b,c]);
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.map((drawing) => drawing.tool))
    .toEqual(["fibChannel","fibSpeedFan","fibCircles","gannSquare","pitchfork"]);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(4);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(5);
});

test("settings dialog exposes keyboard semantics and returns focus on Escape", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.3, y: pane.y + pane.height * 0.65 };
  const end = { x: pane.x + pane.width * 0.62, y: pane.y + pane.height * 0.35 };

  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  const created = await drawingSnapshot(page);
  const projected = await page.evaluate(
    (id) => window.__drawingInteractionTest!.projectDrawing(id),
    created.drawings[0].id,
  );
  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Cursor\b/ }).last().click();
  await page.mouse.click(
    projected![0].x + (projected![1].x - projected![0].x) * 0.75,
    projected![0].y + (projected![1].y - projected![0].y) * 0.75,
  );

  const settingsButton = page.getByRole("button", { name: "Settings", exact: true });
  await settingsButton.focus();
  await settingsButton.click();
  const dialog = page.getByRole("dialog", { name: "Trendline settings" });
  await expect(dialog).toBeFocused();
  await expect(dialog.getByRole("tab", { name: "style", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("tablist", { name: "Drawing settings sections" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(settingsButton).toBeFocused();
});

test("fixed drawing targets create independent price-alert snapshots", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const anchor = { x: pane.x + pane.width * 0.42, y: pane.y + pane.height * 0.46 };

  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Horizontal line\b/ }).click();
  await page.mouse.click(anchor.x, anchor.y);
  const created = await drawingSnapshot(page);
  const id = created.drawings[0].id;
  const projected = await page.evaluate(
    (drawingId) => window.__drawingInteractionTest!.projectDrawing(drawingId),
    id,
  );

  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Cursor\b/ }).last().click();
  await page.mouse.click(pane.x + pane.width * 0.64, projected![0].y);
  await page.getByTestId("price-chart-root").getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Add alert", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Create drawing alert" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Drawing alert target" })).toContainText("Price level");
  await dialog.getByRole("button", { name: "Create alert", exact: true }).click();

  const center = page.getByRole("dialog", { name: "Alert Center" });
  await expect(center.getByText("Drawing · Price level", { exact: true })).toBeVisible();
  // Close through the backdrop. Alert evaluation may legitimately add a
  // top-right toast over the drawer's Close button in this same frame.
  await page.mouse.click(20, page.viewportSize()!.height / 2);
  await expect(center).toHaveCount(0);

  await page.mouse.click(pane.x + pane.width * 0.64, projected![0].y);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(0);
  // A just-triggered alert toast can overlap this top-right toolbar button.
  // Dispatch through the element so the snapshot contract is not coupled to
  // the toast's dismissal timer.
  await page.getByRole("button", { name: /^Alerts\b/ }).evaluate(
    (button: HTMLButtonElement) => button.click(),
  );
  await expect(page.getByRole("dialog", { name: "Alert Center" }).getByText("Drawing · Price level", { exact: true })).toBeVisible();
});

test("object tree groups, renames, locks, hides, and undo-redoes as one group action", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const points = [
    { x: pane.x + pane.width * 0.22, y: pane.y + pane.height * 0.68 },
    { x: pane.x + pane.width * 0.43, y: pane.y + pane.height * 0.42 },
    { x: pane.x + pane.width * 0.51, y: pane.y + pane.height * 0.65 },
    { x: pane.x + pane.width * 0.72, y: pane.y + pane.height * 0.37 },
  ];
  await page.getByRole("button", { name: "Keep drawing", exact: true }).click();
  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  for (const point of points) await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(2);

  await page.getByRole("button", { name: "Object tree", exact: true }).click();
  const tree = page.locator("[data-object-tree]");
  await expect(tree).toBeVisible();
  const rows = tree.locator("[data-object-id]");
  await expect(rows).toHaveCount(2);
  await rows.nth(0).click({ position: { x: 12, y: 16 } });
  await rows.nth(1).click({ modifiers: ["Control"], position: { x: 12, y: 16 } });
  await tree.getByRole("button", { name: "Group selected", exact: true }).click();
  await expect(tree.locator("[data-object-group]")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(tree.locator("[data-object-group]")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  const group = tree.locator("[data-object-group]");
  await expect(group).toHaveCount(1);

  await group.getByRole("button", { name: "Rename", exact: true }).first().click();
  const rename = group.getByRole("textbox", { name: "Rename group", exact: true });
  await rename.fill("Breakout setup");
  await rename.press("Enter");
  await expect(group).toContainText("Breakout setup");
  await group.getByRole("button", { name: "Hide", exact: true }).first().click();
  await group.getByRole("button", { name: "Lock", exact: true }).first().click();
  await expect.poll(async () => {
    const drawings = (await drawingSnapshot(page)).drawings;
    return drawings.every((drawing) =>
      drawing.group?.name === "Breakout setup" &&
      drawing.visible === false &&
      drawing.locked === true
    );
  }).toBe(true);
});

test("drawing sync defaults persist and a group changes scope in one undoable action", async ({ page }) => {
  const syncDefault = page.getByRole("button", { name: "New drawings: Sync globally", exact: true });
  await syncDefault.click();
  await page.getByRole("button", { name: "No sync", exact: true }).click();
  await expect(page.getByRole("button", { name: "New drawings: No sync", exact: true })).toBeVisible();

  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const points = [
    { x: pane.x + pane.width * 0.24, y: pane.y + pane.height * 0.67 },
    { x: pane.x + pane.width * 0.43, y: pane.y + pane.height * 0.43 },
    { x: pane.x + pane.width * 0.53, y: pane.y + pane.height * 0.64 },
    { x: pane.x + pane.width * 0.72, y: pane.y + pane.height * 0.38 },
  ];
  await page.getByRole("button", { name: "Keep drawing", exact: true }).click();
  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  for (const point of points) await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.map((drawing) => drawing.sync?.mode)).toEqual(["chart-only", "chart-only"]);

  await page.getByRole("button", { name: "Object tree", exact: true }).click();
  const tree = page.locator("[data-object-tree]");
  const rows = tree.locator("[data-object-id]");
  await rows.nth(0).click({ position: { x: 12, y: 16 } });
  await rows.nth(1).click({ modifiers: ["Control"], position: { x: 12, y: 16 } });
  await tree.getByRole("button", { name: "Group selected", exact: true }).click();
  const group = tree.locator("[data-object-group]");
  const groupHeader = group.locator(":scope > div").first();
  await groupHeader.getByRole("button", { name: "Sync: chart-only", exact: true }).click();
  await groupHeader.getByRole("button", { name: /^Sync globally / }).click();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.every((drawing) => drawing.sync?.mode === "global")).toBe(true);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.every((drawing) => drawing.sync?.mode === "chart-only")).toBe(true);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__drawingInteractionTest));
  await expect(page.getByRole("button", { name: "New drawings: No sync", exact: true })).toBeVisible();
});

test("selected and all drawing bulk actions are single undoable transactions", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const points = [
    { x: pane.x + pane.width * 0.23, y: pane.y + pane.height * 0.68 },
    { x: pane.x + pane.width * 0.43, y: pane.y + pane.height * 0.42 },
    { x: pane.x + pane.width * 0.53, y: pane.y + pane.height * 0.64 },
    { x: pane.x + pane.width * 0.73, y: pane.y + pane.height * 0.37 },
  ];
  await page.getByRole("button", { name: "Keep drawing", exact: true }).click();
  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  for (const point of points) await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(2);

  await page.getByRole("button", { name: "Object tree", exact: true }).click();
  const tree = page.locator("[data-object-tree]");
  const selectBoth = async () => {
    const rows = tree.locator("[data-object-id]");
    await rows.nth(0).click({ position: { x: 12, y: 16 } });
    await rows.nth(1).click({ modifiers: ["Control"], position: { x: 12, y: 16 } });
    await expect(tree.getByRole("button", { name: "Lock selected", exact: true })).toBeEnabled();
  };
  await selectBoth();
  await tree.getByRole("button", { name: "Lock selected", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.every((drawing) => drawing.locked)).toBe(true);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.every((drawing) => !drawing.locked)).toBe(true);

  await tree.getByRole("button", { name: "Hide selected", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.every((drawing) => drawing.visible === false)).toBe(true);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.every((drawing) => drawing.visible !== false)).toBe(true);

  await selectBoth();
  await tree.getByRole("button", { name: "Delete selected", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(0);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(2);

  await page.getByRole("button", { name: "Lock all drawings", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.every((drawing) => drawing.locked)).toBe(true);
  await page.keyboard.press("Control+z");
  await page.getByRole("button", { name: "Hide all drawings", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.every((drawing) => drawing.visible === false)).toBe(true);
  await page.keyboard.press("Control+z");
  await page.getByRole("button", { name: "Remove all drawings", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(0);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(2);
});

test("shared coordinate editor updates anchors in one undoable transaction", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.3, y: pane.y + pane.height * 0.65 };
  const end = { x: pane.x + pane.width * 0.62, y: pane.y + pane.height * 0.35 };

  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  const created = await drawingSnapshot(page);
  const original = created.drawings[0].points;
  const projected = await page.evaluate(
    (id) => window.__drawingInteractionTest!.projectDrawing(id),
    created.drawings[0].id,
  );
  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Cursor\b/ }).last().click();
  await page.mouse.click(
    projected![0].x + (projected![1].x - projected![0].x) * 0.75,
    projected![0].y + (projected![1].y - projected![0].y) * 0.75,
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Trendline settings" });
  await dialog.getByRole("tab", { name: "coordinates", exact: true }).click();
  const nextPrice = original[0].price + 1.25;
  const nextTime = original[0].time + 60;
  await dialog.getByRole("spinbutton", { name: "Point 1 price", exact: true }).fill(String(nextPrice));
  await dialog.getByRole("spinbutton", { name: "Point 1 price", exact: true }).press("Enter");
  await dialog.getByRole("spinbutton", { name: "Point 1 Unix time", exact: true }).fill(String(nextTime));
  await dialog.getByRole("spinbutton", { name: "Point 1 Unix time", exact: true }).press("Enter");
  await dialog.getByRole("button", { name: "Ok", exact: true }).click();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0].points[0])
    .toEqual({ time: nextTime, price: nextPrice });
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0].points).toEqual(original);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0].points[0])
    .toEqual({ time: nextTime, price: nextPrice });
});

test("keep drawing creates consecutive objects and survives reload", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const points = [
    { x: pane.x + pane.width * 0.2, y: pane.y + pane.height * 0.7 },
    { x: pane.x + pane.width * 0.4, y: pane.y + pane.height * 0.45 },
    { x: pane.x + pane.width * 0.5, y: pane.y + pane.height * 0.65 },
    { x: pane.x + pane.width * 0.7, y: pane.y + pane.height * 0.35 },
  ];

  const keepDrawing = page.getByRole("button", { name: "Keep drawing", exact: true });
  await keepDrawing.click();
  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  for (const point of points) await page.mouse.click(point.x, point.y);

  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(2);
  expect((await drawingSnapshot(page)).activeTool).toBe("trendline");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__drawingInteractionTest));
  await expect(page.getByRole("button", { name: "Keep drawing", exact: true }))
    .toHaveClass(/text-brand/);
});

test("confirmed settings become the persisted default for the same tool", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.25, y: pane.y + pane.height * 0.65 };
  const end = { x: pane.x + pane.width * 0.55, y: pane.y + pane.height * 0.4 };

  const selectTrendline = async () => {
    await page.getByRole("button", { name: "Trend line", exact: true }).click();
    await page.getByRole("button", { name: /^Trendline\b/ }).click();
  };
  await selectTrendline();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  const created = await drawingSnapshot(page);
  const projected = await page.evaluate(
    (id) => window.__drawingInteractionTest!.projectDrawing(id),
    created.drawings[0].id,
  );
  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Cursor\b/ }).last().click();
  await page.mouse.click(
    projected![0].x + (projected![1].x - projected![0].x) * 0.75,
    projected![0].y + (projected![1].y - projected![0].y) * 0.75,
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Trendline settings" });
  await dialog.getByRole("button", { name: "Line style", exact: true }).click();
  const width = dialog.getByRole("slider", { name: "Line width", exact: true });
  await width.fill("4");
  await dialog.getByRole("button", { name: "Ok", exact: true }).click();

  await page.evaluate(() => window.__drawingInteractionTest!.clear());
  await selectTrendline();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.lineWidth).toBe(4);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__drawingInteractionTest));
  await page.evaluate(() => window.__drawingInteractionTest!.clear());
  await selectTrendline();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.lineWidth).toBe(4);
});

test("strong OHLC magnet snaps creation and Ctrl temporarily disables it", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const first = { x: pane.x + pane.width * 0.37, y: pane.y + pane.height * 0.43 };
  const second = { x: pane.x + pane.width * 0.61, y: pane.y + pane.height * 0.57 };

  await page.getByRole("button", { name: "Magnet mode menu", exact: true }).click();
  await page.getByRole("button", { name: "Strong magnet", exact: true }).click();
  await expect(page.getByRole("button", { name: "Magnet: strong", exact: true }))
    .toHaveClass(/text-brand/);

  const chooseHorizontal = async () => {
    await page.getByRole("button", { name: "Trend line", exact: true }).click();
    await page.getByRole("button", { name: /^Horizontal line\b/ }).click();
  };
  const expectedStrong = await page.evaluate(
    ({ x, y }) => window.__drawingInteractionTest!.magnetPointsAtClient(x, y).strong,
    first,
  );
  await chooseHorizontal();
  await page.mouse.click(first.x, first.y);
  await expect.poll(async () => {
    const point = (await drawingSnapshot(page)).drawings[0]?.points[0];
    return point && expectedStrong
      ? point.time === expectedStrong.time && Math.abs(point.price - expectedStrong.price) < 0.00001
      : false;
  }).toBe(true);

  await page.evaluate(() => window.__drawingInteractionTest!.clear());
  const expectedRaw = await page.evaluate(
    ({ x, y }) => window.__drawingInteractionTest!.magnetPointsAtClient(x, y).raw,
    second,
  );
  await chooseHorizontal();
  await page.keyboard.down("Control");
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up("Control");
  await expect.poll(async () => {
    const point = (await drawingSnapshot(page)).drawings[0]?.points[0];
    return point && expectedRaw
      ? point.time === expectedRaw.time && Math.abs(point.price - expectedRaw.price) < 0.00001
      : false;
  }).toBe(true);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__drawingInteractionTest));
  await expect(page.getByRole("button", { name: "Magnet: strong", exact: true }))
    .toHaveClass(/text-brand/);
});

test("interval visibility settings filter drawings and quick presets update the model", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.28, y: pane.y + pane.height * 0.65 };
  const end = { x: pane.x + pane.width * 0.58, y: pane.y + pane.height * 0.38 };

  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  const created = await drawingSnapshot(page);
  const id = created.drawings[0].id;
  const projected = await page.evaluate(
    (drawingId) => window.__drawingInteractionTest!.projectDrawing(drawingId),
    id,
  );
  const body = {
    x: projected![0].x + (projected![1].x - projected![0].x) * 0.75,
    y: projected![0].y + (projected![1].y - projected![0].y) * 0.75,
  };

  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Cursor\b/ }).last().click();
  await page.mouse.click(body.x, body.y);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Trendline settings" });
  await dialog.getByRole("tab", { name: "visibility", exact: true }).click();
  await dialog.getByRole("button", { name: "Current interval", exact: true }).click();
  await dialog.getByRole("button", { name: "Ok", exact: true }).click();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.intervalVisibility)
    .toEqual({ timeframes: ["15m"] });

  await page.getByTestId("price-chart-root").getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Intervals: Current and above", exact: true }).click();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.intervalVisibility)
    .toEqual({ timeframes: ["15m", "30m", "1H", "2H", "4H", "1D", "1W", "1M"] });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const reopened = page.getByRole("dialog", { name: "Trendline settings" });
  await reopened.getByRole("tab", { name: "visibility", exact: true }).click();
  await reopened.getByRole("button", { name: "Current interval", exact: true }).click();
  await reopened.getByRole("button", { name: "Ok", exact: true }).click();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.intervalVisibility)
    .toEqual({ timeframes: ["15m"] });

  await page.evaluate(() => window.__drawingInteractionTest!.changeTimeframe("1H"));
  await expect.poll(async () => (await drawingSnapshot(page)).visibleDrawingIds).toEqual([]);
  await expect.poll(async () => (await drawingSnapshot(page)).selectedDrawingId).toBeNull();

  await page.evaluate(() => window.__drawingInteractionTest!.changeTimeframe("15m"));
  await expect.poll(async () => (await drawingSnapshot(page)).visibleDrawingIds).toEqual([id]);
});

async function exerciseTrendlineTransaction(page: Page) {
  await page.evaluate(() => window.__drawingInteractionTest!.clear());
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.3, y: pane.y + pane.height * 0.65 };
  const end = { x: pane.x + pane.width * 0.62, y: pane.y + pane.height * 0.35 };

  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);

  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);
  const created = await drawingSnapshot(page);
  expect(created.drawings[0].tool).toBe("trendline");
  const projected = await page.evaluate(
    (id) => window.__drawingInteractionTest!.projectDrawing(id),
    created.drawings[0].id,
  );
  expect(projected).not.toBeNull();
  const [projectedStart, projectedEnd] = projected!;
  const selectionPoint = {
    x: projectedStart.x + (projectedEnd.x - projectedStart.x) * 0.75,
    y: projectedStart.y + (projectedEnd.y - projectedStart.y) * 0.75,
  };

  if (created.activeTool !== "cursor") {
    await page.getByRole("button", { name: "Cursor", exact: true }).click();
    await page.getByRole("button", { name: /^Cursor\b/ }).last().click();
  }
  // The midpoint owns inline text editing, so selection and drag deliberately
  // use body points away from that overlay.
  await page.mouse.click(selectionPoint.x, selectionPoint.y);
  await expect.poll(async () => (await drawingSnapshot(page)).selectedDrawingId)
    .not.toBeNull();

  const selectedProjection = await page.evaluate(
    (id) => window.__drawingInteractionTest!.projectDrawing(id),
    created.drawings[0].id,
  );
  const [selectedStart, selectedEnd] = selectedProjection!;
  const dragPoint = {
    x: selectedStart.x + (selectedEnd.x - selectedStart.x) * 0.18,
    y: selectedStart.y + (selectedEnd.y - selectedStart.y) * 0.18,
  };
  const pointInspection = await page.evaluate(
    ({ x, y }) => window.__drawingInteractionTest!.inspectClientPoint(x, y),
    dragPoint,
  );
  expect(pointInspection.insideCanvas).toBe(true);
  expect(pointInspection.overDrawingUi).toBe(false);
  expect(pointInspection.hits.some((hit) => hit.id === created.drawings[0].id)).toBe(true);

  const beforeMove = (await drawingSnapshot(page)).drawings[0].points;
  await page.mouse.move(dragPoint.x, dragPoint.y);
  await page.mouse.down();
  await expect.poll(async () => (await drawingSnapshot(page)).machineState)
    .toBe("MovingDrawing");
  await page.mouse.move(dragPoint.x + 48, dragPoint.y + 24, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0].points)
    .not.toEqual(beforeMove);
  const afterMove = (await drawingSnapshot(page)).drawings[0].points;

  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0].points)
    .toEqual(beforeMove);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0].points)
    .toEqual(afterMove);

  await page.keyboard.press("Delete");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(0);
}

test("trendline transaction is stable and preserves chart interaction", async ({ page }) => {
  test.setTimeout(120_000);
  for (let iteration = 0; iteration < 3; iteration++) {
    await exerciseTrendlineTransaction(page);
  }

  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const beforeZoom = chart.viewport.revision;
  await page.mouse.move(pane.x + pane.width * 0.5, pane.y + pane.height * 0.5);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () =>
    page.evaluate(() => window.__chartInteractionTest!.snapshot().viewport.revision),
  ).toBeGreaterThan(beforeZoom);
});

test("creation cancellation and explicit freeform completion are transactional", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const first = { x: pane.x + pane.width * 0.25, y: pane.y + pane.height * 0.6 };
  const second = { x: pane.x + pane.width * 0.55, y: pane.y + pane.height * 0.35 };

  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  await page.mouse.click(first.x, first.y);
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Drawing");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Idle");
  expect((await drawingSnapshot(page)).drawings).toHaveLength(0);
  expect((await drawingSnapshot(page)).activeTool).toBe("cursor");

  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByRole("button", { name: /^Path\b/ }).click();
  await page.mouse.click(first.x, first.y);
  await page.mouse.click(second.x, second.y);
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Drawing");
  await page.mouse.click(second.x + 20, second.y + 20, { button: "right" });
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);
  expect((await drawingSnapshot(page)).drawings[0].tool).toBe("path");

  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(0);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);

  await page.evaluate(() => window.__drawingInteractionTest!.clear());
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByRole("button", { name: /^Triangle\b/ }).click();
  await page.mouse.click(first.x, first.y);
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Drawing");
  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Cursor\b/ }).last().click();
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Idle");
  expect((await drawingSnapshot(page)).drawings).toHaveLength(0);
});

test("eraser is undoable and pass-through modes never start creation", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.28, y: pane.y + pane.height * 0.62 };
  const end = { x: pane.x + pane.width * 0.58, y: pane.y + pane.height * 0.32 };

  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);

  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Eraser\b/ }).click();
  await page.mouse.click(
    start.x + (end.x - start.x) * 0.75,
    start.y + (end.y - start.y) * 0.75,
  );
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(0);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);

  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Crosshair\b/ }).click();
  await page.mouse.click(start.x, start.y);
  const snapshot = await drawingSnapshot(page);
  expect(snapshot.machineState).toBe("Idle");
  expect(snapshot.drawings).toHaveLength(1);
});

test("resize, pointer cancellation, and symbol cancellation preserve transaction boundaries", async ({ page }) => {
  test.setTimeout(120_000);
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.3, y: pane.y + pane.height * 0.65 };
  const end = { x: pane.x + pane.width * 0.62, y: pane.y + pane.height * 0.35 };

  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  const created = await drawingSnapshot(page);
  const original = created.drawings[0].points;
  const projected = await page.evaluate(
    (id) => window.__drawingInteractionTest!.projectDrawing(id),
    created.drawings[0].id,
  );
  expect(projected).not.toBeNull();

  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Cursor\b/ }).last().click();
  await page.mouse.move(projected![1].x, projected![1].y);
  await page.mouse.down();
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("ResizingHandle");
  await page.mouse.move(projected![1].x + 40, projected![1].y - 20, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0].points).not.toEqual(original);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0].points).toEqual(original);

  const body = {
    x: projected![0].x + (projected![1].x - projected![0].x) * 0.75,
    y: projected![0].y + (projected![1].y - projected![0].y) * 0.75,
  };
  await page.mouse.move(body.x, body.y);
  await page.mouse.down();
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("MovingDrawing");
  await page.mouse.move(body.x + 30, body.y + 20);
  await page.evaluate(() =>
    document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 })),
  );
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Idle");
  expect((await drawingSnapshot(page)).drawings[0].points).toEqual(original);
  await page.mouse.up();

  await page.evaluate(() => window.__drawingInteractionTest!.clear());
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByRole("button", { name: /^Brush\b/ }).click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 30, start.y + 20);
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Drawing");
  await page.evaluate(() =>
    document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 })),
  );
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Idle");
  expect((await drawingSnapshot(page)).drawings).toHaveLength(0);
  await page.mouse.up();

  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  await page.mouse.click(start.x, start.y);
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Drawing");
  await page.evaluate(() => window.__drawingInteractionTest!.changeSymbol("PHASE2_CANCEL_TEST"));
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Idle");
  expect((await drawingSnapshot(page)).activeTool).toBe("cursor");
  expect((await drawingSnapshot(page)).drawings).toHaveLength(0);
});

test("standalone and attached text edits each produce one undoable command", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.25, y: pane.y + pane.height * 0.6 };
  const end = { x: pane.x + pane.width * 0.52, y: pane.y + pane.height * 0.35 };

  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("button", { name: /^Text\b/ }).last().click();
  await page.mouse.click(start.x, start.y);
  const editor = page.getByPlaceholder("Enter text...");
  await editor.fill("Standalone note");
  await editor.press("Enter");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.text).toBe("Standalone note");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(0);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);

  await page.evaluate(() => window.__drawingInteractionTest!.clear());
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByRole("button", { name: /^Rectangle\b/ }).last().click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Cursor\b/ }).last().click();
  await page.mouse.click((start.x + end.x) / 2, (start.y + end.y) / 2);
  await page.getByPlaceholder("Enter text...").fill("Attached label");
  await page.getByPlaceholder("Enter text...").press("Enter");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.text).toBe("Attached label");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.text ?? "").toBe("");
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.text).toBe("Attached label");
});
