import { expect, test, type Page } from "@playwright/test";
import type { DrawingInteractionTestHarness } from "../../src/components/chart/drawing/testing/testHarnessTypes";

declare global {
  interface Window {
    __drawingInteractionTest?: DrawingInteractionTestHarness;
  }
}

test.use({
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 },
});

async function drawingSnapshot(page: Page) {
  return page.evaluate(() => {
    if (!window.__drawingInteractionTest) {
      throw new Error("Drawing test harness unavailable");
    }
    return window.__drawingInteractionTest.snapshot();
  });
}

async function dispatchTouchPointer(
  page: Page,
  type: "pointerdown" | "pointermove" | "pointerup",
  point: { x: number; y: number },
) {
  await page.evaluate(({ eventType, x, y }) => {
    const target = document.elementFromPoint(x, y) ?? document;
    target.dispatchEvent(new PointerEvent(eventType, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: 91,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: eventType === "pointerup" ? 0 : 1,
    }));
  }, { eventType: type, ...point });
}

test("mobile touch creates and resizes a Rectangle without leaking to chart gestures", async ({ page }) => {
  await page.route("**/api/push/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/v1/mt5/symbols", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connected: true,
        bridgeUrl: "fixture",
        source: "playwright",
        count: 1,
        streamSymbols: ["EURUSD"],
        symbols: [{
          name: "EURUSD",
          description: "Euro / US Dollar",
          visible: true,
          digits: 5,
          point: 0.00001,
          spread: 0,
          trade_mode: 4,
          currency_base: "EUR",
          currency_profit: "USD",
        }],
      }),
    });
  });
  await page.goto("/?chartFixture=900&chartFixtureTail=500&chartBenchmarkProfile=phase2", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForFunction(() =>
    Boolean(window.__drawingInteractionTest && window.__chartInteractionTest),
  );
  await page.evaluate(() => window.__drawingInteractionTest!.clear());

  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.24, y: pane.y + pane.height * 0.68 };
  // Stay below the mobile indicator legend; actionable popup bounds correctly
  // own their hit area while a drawing tool is armed.
  const end = { x: pane.x + pane.width * 0.68, y: pane.y + pane.height * 0.48 };

  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.touchscreen.tap(start.x, start.y);
  await page.touchscreen.tap(end.x, end.y);

  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);
  const created = await drawingSnapshot(page);
  expect(created.drawings[0].tool).toBe("rectangle");
  const original = created.drawings[0].points;
  const projected = await page.evaluate(
    (id) => window.__drawingInteractionTest!.projectDrawing(id),
    created.drawings[0].id,
  );
  expect(projected).not.toBeNull();

  const toolbar = page.locator("[data-drawing-toolbar][data-chart-popup]");
  await expect(toolbar).toBeVisible();
  const dragHandle = toolbar.locator("[data-chart-popup-drag-handle]");
  await expect(dragHandle).toBeVisible();

  const colorTrigger = toolbar.getByRole("button", { name: "Line color" });
  await colorTrigger.click();
  const drawingPopover = toolbar.locator("[data-drawing-toolbar-popover]");
  await expect(drawingPopover).toBeVisible();
  await expect(drawingPopover.locator("[data-chart-popup-drag-handle]")).toBeVisible();
  const popoverGeometry = await drawingPopover.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return {
      inViewport:
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= window.innerWidth &&
        rect.bottom <= window.innerHeight,
      topmost: Boolean(hit && element.contains(hit)),
    };
  });
  expect(popoverGeometry).toEqual({ inViewport: true, topmost: true });
  await drawingPopover.locator("[data-color-option]").first().click();
  await expect(drawingPopover).toHaveCount(0);

  const toolbarBefore = await toolbar.boundingBox();
  const dragBox = await dragHandle.boundingBox();
  expect(toolbarBefore).not.toBeNull();
  expect(dragBox).not.toBeNull();
  await dragHandle.dispatchEvent("pointerdown", {
    pointerId: 92,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: dragBox!.x + dragBox!.width / 2,
    clientY: dragBox!.y + dragBox!.height / 2,
  });
  await dragHandle.dispatchEvent("pointermove", {
    pointerId: 92,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: dragBox!.x + dragBox!.width / 2,
    clientY: dragBox!.y + dragBox!.height / 2 + 72,
  });
  await dragHandle.dispatchEvent("pointerup", {
    pointerId: 92,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
  });
  await expect.poll(async () => (await toolbar.boundingBox())!.y)
    .toBeGreaterThan(toolbarBefore!.y + 40);

  await dispatchTouchPointer(page, "pointerdown", projected![1]);
  await expect.poll(async () => (await drawingSnapshot(page)).machineState)
    .toBe("ResizingHandle");
  const resizedHandle = { x: projected![1].x - 42, y: projected![1].y + 28 };
  await dispatchTouchPointer(page, "pointermove", resizedHandle);
  await dispatchTouchPointer(page, "pointerup", resizedHandle);

  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Idle");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0].points)
    .not.toEqual(original);

  const canvasRange = await page.evaluate(() =>
    window.__chartInteractionTest!.snapshot().viewport.logicalRange,
  );
  expect(canvasRange).toEqual(chart.viewport.logicalRange);
});
