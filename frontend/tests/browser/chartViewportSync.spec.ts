import { expect, test, type Page } from "@playwright/test";

const FIXTURE_URL = "/?chartFixture=900&chartFixtureTail=500&chartBenchmarkProfile=phase2";

async function snapshot(page: Page) {
  return page.evaluate(() => {
    if (!window.__chartInteractionTest) throw new Error("Chart test harness unavailable");
    return window.__chartInteractionTest.snapshot();
  });
}

test("crosshair, zoom, resize, and prepend stay synchronized", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (
      message.type() === "error" &&
      (text.includes("cannot be a child of <tr>") || text.includes("hydration error"))
    ) {
      hydrationErrors.push(text);
    }
  });
  await page.goto(FIXTURE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForFunction(() =>
    window.__chartInteractionTest?.snapshot().paneMetrics.paneCount === 3
  );
  expect(hydrationErrors).toEqual([]);

  await test.step("crosshair keeps one UTC timestamp across native panes", async () => {
    const initial = await snapshot(page);
    const [main, rsi] = initial.paneBoxes;
    const x = main.x + main.width * 0.55;
    await page.mouse.move(x, main.y + main.height * 0.5);
    await expect.poll(async () => (await snapshot(page)).lastCrosshairTime).not.toBeNull();
    const mainTime = (await snapshot(page)).lastCrosshairTime;
    await page.mouse.move(x, rsi.y + rsi.height * 0.5);
    await expect.poll(async () => (await snapshot(page)).lastCrosshairTime).toBe(mainTime);
  });

  await test.step("wheel zoom is observed through the viewport controller", async () => {
    const before = await snapshot(page);
    const main = before.paneBoxes[0];
    const beforeSpan = Number(before.viewport.logicalRange!.to) -
      Number(before.viewport.logicalRange!.from);
    await page.mouse.move(main.x + main.width * 0.5, main.y + main.height * 0.5);
    await page.mouse.wheel(0, -650);
    await expect.poll(async () => (await snapshot(page)).viewport.revision)
      .toBeGreaterThan(before.viewport.revision);
    const after = await snapshot(page);
    const afterSpan = Number(after.viewport.logicalRange!.to) -
      Number(after.viewport.logicalRange!.from);
    expect(afterSpan).not.toBe(beforeSpan);
    expect(after.viewport.cause).toBe("user");
  });

  await test.step("plot widths remain equal after autoscale and resize", async () => {
    const before = await snapshot(page);
    const main = before.paneBoxes[0];
    await page.mouse.dblclick(main.x + main.width - 4, main.y + main.height * 0.5);
    await page.setViewportSize({ width: 1120, height: 760 });
    await expect.poll(async () => (await snapshot(page)).paneMetrics.timeScaleWidth)
      .not.toBe(before.paneMetrics.timeScaleWidth);
    const after = await snapshot(page);
    expect(after.paneMetrics.plotAreaWidths).toHaveLength(3);
    expect(after.paneMetrics.widthDrift).toBeLessThanOrEqual(1);
    expect(new Set(after.paneMetrics.plotAreaWidths).size).toBe(1);
  });

  await test.step("history prepend preserves visible timestamps and zoom span", async () => {
    const before = await snapshot(page);
    expect(before.candleCount).toBe(500);
    await page.evaluate(() => window.__chartInteractionTest?.prependHistory(200));
    await expect.poll(async () => (await snapshot(page)).candleCount).toBe(700);
    await expect.poll(async () => (await snapshot(page)).viewport.cause)
      .toBe("history-prepend");
    const after = await snapshot(page);
    expect(after.firstCandleTime).toBeLessThan(before.firstCandleTime!);
    expect(after.visibleTimeRange).toEqual(before.visibleTimeRange);
    const beforeSpan = Number(before.viewport.logicalRange!.to) -
      Number(before.viewport.logicalRange!.from);
    const afterSpan = Number(after.viewport.logicalRange!.to) -
      Number(after.viewport.logicalRange!.from);
    expect(afterSpan).toBeCloseTo(beforeSpan, 5);
  });
});
