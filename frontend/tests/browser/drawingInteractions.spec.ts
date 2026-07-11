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
