import { expect, test, type Page } from "@playwright/test";
import type { DrawingInteractionTestHarness } from "../../src/components/chart/drawing/testing/testHarnessTypes";
import {
  DRAWING_BROWSER_SNAPSHOT_CASES,
  DRAWING_VISUAL_SNAPSHOT_MATRIX,
  type DrawingVisualSnapshotCase,
} from "../drawing/visualSnapshotMatrix";

declare global {
  interface Window {
    __drawingInteractionTest?: DrawingInteractionTestHarness;
  }
}

const FIXTURE_URL = "/?chartFixture=900&chartFixtureTail=500&chartBenchmarkProfile=phase2";
const SNAPSHOT_CLOCK_START = new Date("2026-07-16T00:00:00.000Z");
const SNAPSHOT_CLOCK_FIXED = new Date("2026-07-16T02:00:00.000Z");
const MATRIX_MODE = process.env.DRAWING_VISUAL_MATRIX ?? "";
const FULL_MATRIX = MATRIX_MODE === "1";
const REPRESENTATIVE_MATRIX = MATRIX_MODE === "representative";
const REQUESTED_IDS = new Set(
  FULL_MATRIX || REPRESENTATIVE_MATRIX
    ? []
    : MATRIX_MODE.split(",").map((id) => id.trim()).filter(Boolean),
);
const RUN_MATRIX = FULL_MATRIX || REPRESENTATIVE_MATRIX || REQUESTED_IDS.size > 0;

// One stable representative per visual family keeps the normal browser suite
// fast. CI/review jobs can opt into every visible tool with
// DRAWING_VISUAL_MATRIX=1.
const REPRESENTATIVE_IDS = new Set([
  "trendline",
  "channel",
  "rectangle",
  "brush",
  "fibRetracement",
  "gannFan",
  "pitchfork",
  "abcdPattern",
  "cyclicLines",
  "long",
  "anchoredVWAP",
  "fixedVolumeProfile",
  "forecast",
  "text",
  "table",
]);

function matrixCases(): readonly DrawingVisualSnapshotCase[] {
  if (FULL_MATRIX) return DRAWING_BROWSER_SNAPSHOT_CASES;
  const ids = REPRESENTATIVE_MATRIX ? REPRESENTATIVE_IDS : REQUESTED_IDS;
  return DRAWING_BROWSER_SNAPSHOT_CASES.filter((item) => ids.has(item.id));
}

async function drawingSnapshot(page: Page) {
  return page.evaluate(() => {
    if (!window.__drawingInteractionTest) throw new Error("Drawing test harness unavailable");
    return window.__drawingInteractionTest.snapshot();
  });
}

async function chartPoints(page: Page, count: number) {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  if (!pane || pane.width < 100 || pane.height < 100) throw new Error("Chart pane is not ready");
  const total = Math.max(1, count);
  return Array.from({ length: total }, (_, index) => {
    const ratio = total === 1 ? 0.5 : index / (total - 1);
    return {
      x: pane.x + pane.width * (0.22 + ratio * 0.56),
      y: pane.y + pane.height * (index % 2 === 0 ? 0.68 : 0.34),
    };
  });
}

async function chooseTool(page: Page, item: DrawingVisualSnapshotCase) {
  if (!item.groupLabel) throw new Error(`${item.id} has no toolbar group`);
  const toolbar = page.locator("[data-drawing-toolbar]");
  await toolbar.getByRole("button", { name: item.groupLabel, exact: true }).click({ timeout: 12_000 });
  // Flyouts are portalled to body. Use the manifest id because hotkeys and the
  // nested favorite action intentionally contribute to the accessible name.
  await page.locator(`[data-drawing-tool-id="${item.id}"]`).click({ timeout: 12_000 });
}

async function createTool(page: Page, item: DrawingVisualSnapshotCase) {
  const points = await chartPoints(page, item.pointCount);
  await chooseTool(page, item);

  if (item.creationMode === "pointer-continuous") {
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    for (const point of points.slice(1)) {
      await page.mouse.move(point.x, point.y, { steps: 2 });
    }
    await page.mouse.up();
  } else {
    for (const point of points) await page.mouse.click(point.x, point.y);
    if (item.creationMode === "click-freeform") {
      // TradingView-style freeform tools finish explicitly with a secondary
      // click; this also avoids accidentally committing a partial path.
      const last = points[points.length - 1];
      await page.mouse.click(last.x + 8, last.y + 8, { button: "right" });
    }
  }

  // Text-capable one-point tools open the shared inline editor. Commit a
  // deterministic value so screenshots contain the same visible state.
  const editor = page.locator("[data-inline-text-editor]");
  if (await editor.count()) {
    await editor.fill(`matrix:${item.id}`);
    await editor.press("Enter");
  }

  await expect.poll(async () => {
    const snapshot = await drawingSnapshot(page);
    return snapshot.drawings.some((drawing) => drawing.tool === item.id);
  }, { timeout: 12_000 }).toBe(true);
}

// Browser screenshots are an explicit review job. Keeping this opt-in avoids
// making the ordinary unit/adapter suite depend on a running Next server or a
// particular browser binary.
test.skip(
  !RUN_MATRIX,
  "Set DRAWING_VISUAL_MATRIX=representative, 1, or a comma-separated tool id list to capture browser artifacts",
);
// Keep a focused run fail-fast, while scaling the budget for representative
// and full-catalog review jobs that intentionally create many tools serially.
test.describe.configure({
  mode: "serial",
  timeout: 60_000 + matrixCases().length * 30_000,
});

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: SNAPSHOT_CLOCK_START });
  await page.route("**/api/push/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForFunction(
    () => Boolean(window.__drawingInteractionTest && window.__chartInteractionTest),
    undefined,
    { timeout: 20_000 },
  );
  // Keep intervals/RAF running while Date/Intl stay fixed. This stabilizes the
  // countdown and time-axis labels without freezing chart interactions.
  await page.clock.setFixedTime(SNAPSHOT_CLOCK_FIXED);
  await page.evaluate(() => window.__drawingInteractionTest?.clear());
});

test("manifest-driven drawing visual snapshot matrix", async ({ page }) => {
  expect(DRAWING_VISUAL_SNAPSHOT_MATRIX.length).toBeGreaterThanOrEqual(84);
  const cases = matrixCases();
  expect(cases.length).toBeGreaterThan(0);

  for (const item of cases) {
    await test.step(item.id, async () => {
      await page.evaluate(() => window.__drawingInteractionTest?.clear());
      await createTool(page, item);

      const snapshot = await drawingSnapshot(page);
      const drawing = snapshot.drawings.find((candidate) => candidate.tool === item.id);
      expect(drawing, `${item.id}: committed drawing`).toBeTruthy();
      expect(drawing!.points.length, `${item.id}: fixture anchors`).toBeGreaterThanOrEqual(item.pointCount);

      // Geometry remains the semantic oracle, while a real Playwright baseline
      // catches visual regressions in paint order, labels, handles, and fills.
      const chart = page.getByTestId("price-chart-root");
      await expect(chart).toHaveScreenshot(item.screenshotName, {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.005,
        timeout: 15_000,
      });
      const renderedChart = await chart.boundingBox();
      expect(renderedChart?.width ?? 0).toBeGreaterThan(200);
      expect(renderedChart?.height ?? 0).toBeGreaterThan(150);
    });
  }
});
