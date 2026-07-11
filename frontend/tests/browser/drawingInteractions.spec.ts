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
    expect(audit.expectedToolIds).toHaveLength(35);
    expect(audit.registeredToolIds).toEqual(audit.expectedToolIds);
    expect(audit.fixtureToolIds).toEqual(audit.expectedToolIds);
    expect(audit.errors).toEqual([]);
  }
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
