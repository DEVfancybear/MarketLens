import { expect, test, type Page } from "@playwright/test";

const FIXTURE_URL = "/?chartFixture=900&chartFixtureTail=500&chartBenchmarkProfile=phase2";

async function snapshot(page: Page) {
  return page.evaluate(() => {
    if (!window.__chartInteractionTest) throw new Error("Chart test harness unavailable");
    return window.__chartInteractionTest.snapshot();
  });
}

async function paneLegendAlignment(page: Page) {
  return page.evaluate(() => {
    if (!window.__chartInteractionTest) throw new Error("Chart test harness unavailable");
    const panes = window.__chartInteractionTest.snapshot().paneBoxes;
    return Array.from(document.querySelectorAll<HTMLElement>("[data-indicator-pane-legend]"))
      .map((legend) => {
        const paneIndex = Number(legend.dataset.paneIndex);
        const pane = panes[paneIndex];
        return pane
          ? {
              id: legend.dataset.indicatorPaneLegend ?? "",
              delta: legend.getBoundingClientRect().top - pane.y,
            }
          : null;
      })
      .filter((item): item is { id: string; delta: number } => item != null);
  });
}

async function expectPaneLegendsAligned(page: Page) {
  await expect.poll(async () => {
    const alignment = await paneLegendAlignment(page);
    return alignment.length === 2 &&
      alignment.every(({ delta }) => Math.abs(delta - 4) <= 1);
  }).toBe(true);
}

test("crosshair, zoom, resize, and prepend stay synchronized", async ({ page }) => {
  await page.route("**/api/v1/mt5/symbols", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connected: true,
        source: "playwright",
        count: 1,
        streamSymbols: ["EURUSD"],
        symbols: [{
          name: "EURUSD",
          description: "Euro / US Dollar",
          visible: true,
          digits: 5,
          point: 0.00001,
          trade_mode: 4,
          currency_base: "EUR",
          currency_profit: "USD",
        }],
      }),
    });
  });
  await page.route("**/api/v1/indicator-runtime/**", async (route) => {
    const request = route.request();
    if (request.url().endsWith("/catalog")) {
      const definition = (
        type: string,
        name: string,
        overlay: boolean,
      ) => ({
        type,
        name,
        overlay,
        inputs: [],
        styles: [],
        requiresHistoryContext: false,
        sourceAvailable: false,
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          indicators: [
            definition("fixture-overlay", "Fixture overlay", true),
            definition("fixture-pane-a", "Fixture pane A", false),
            definition("fixture-pane-b", "Fixture pane B", false),
          ],
          errors: [],
        }),
      });
      return;
    }
    const payload = request.postDataJSON() as { indicatorId?: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { id: payload.indicatorId ?? "fixture", series: [] },
        errors: [],
      }),
    });
  });
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
  await expectPaneLegendsAligned(page);

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

  await test.step("repeated vertical plot drags stay responsive", async () => {
    const initial = await snapshot(page);
    const main = initial.paneBoxes[0];
    const x = main.x + main.width * 0.55;
    const y = main.y + main.height * 0.5;

    await page.mouse.click(x, y);
    await expect.poll(async () => (await snapshot(page)).priceScaleAutoScale[0])
      .toBe(true);

    let previous = (await snapshot(page)).priceScaleRanges[0];
    expect(previous).not.toBeNull();
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 2, y + 42, { steps: 5 });
      await page.mouse.up();
      await expect.poll(async () => (await snapshot(page)).priceScaleAutoScale[0])
        .toBe(false);
      await expect.poll(async () => {
        const current = (await snapshot(page)).priceScaleRanges[0];
        return current &&
          previous &&
          (current.from !== previous.from || current.to !== previous.to);
      }).toBe(true);
      previous = (await snapshot(page)).priceScaleRanges[0];
    }
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
    await expectPaneLegendsAligned(page);
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

  await test.step("a symbol change returns to the latest price region", async () => {
    const before = await snapshot(page);
    const main = before.paneBoxes[0];
    const x = main.x + main.width * 0.5;
    const y = main.y + main.height * 0.5;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + main.width * 0.35, y + 36, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => {
      const current = await snapshot(page);
      return Number(current.viewport.logicalRange?.to) <
        Number(before.viewport.logicalRange?.to);
    }).toBe(true);
    await expect.poll(async () => (await snapshot(page)).priceScaleAutoScale[0])
      .toBe(false);

    await page.evaluate(() =>
      window.__drawingInteractionTest?.changeSymbol("BTCUSD")
    );
    await expect.poll(async () => (await snapshot(page)).viewport.cause)
      .toBe("market-change");
    await expect.poll(async () =>
      Number((await snapshot(page)).viewport.logicalRange?.to)
    ).toBeGreaterThanOrEqual((await snapshot(page)).candleCount - 1);
    const reset = await snapshot(page);
    expect(Number(reset.viewport.logicalRange?.from)).toBeLessThanOrEqual(
      reset.candleCount - 1,
    );
    expect(reset.priceScaleAutoScale[0]).toBe(true);
  });
});
