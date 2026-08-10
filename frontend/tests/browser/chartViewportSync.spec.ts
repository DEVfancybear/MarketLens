import { expect, test, type Page } from "@playwright/test";

const FIXTURE_URL = "/?chartFixture=900&chartFixtureTail=500&chartBenchmarkProfile=phase2";
const TIMEFRAME_TRANSITION_MATRIX = [
  "5m",
  "15m",
  "30m",
  "15m",
  "1m",
  "3m",
  "1H",
  "2H",
  "4H",
  "1D",
  "1W",
  "1M",
] as const;

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

function logicalRangesMatch(
  actual: { from: number; to: number } | null,
  tracked: { from: number; to: number } | null,
) {
  if (!actual || !tracked) return actual === tracked;
  return Math.abs(Number(actual.from) - Number(tracked.from)) < 0.001 &&
    Math.abs(Number(actual.to) - Number(tracked.to)) < 0.001;
}

async function captureTimeframeTransition(
  page: Page,
  timeframe: (typeof TIMEFRAME_TRANSITION_MATRIX)[number],
) {
  return page.evaluate(async (nextTimeframe) => {
    const chartHarness = window.__chartInteractionTest;
    const drawingHarness = window.__drawingInteractionTest;
    if (!chartHarness || !drawingHarness) {
      throw new Error("Chart timeframe test harness unavailable");
    }
    const before = chartHarness.snapshot();
    drawingHarness.changeTimeframe(nextTimeframe);
    const frames = [];
    for (let index = 0; index < 24; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      frames.push(chartHarness.snapshot());
    }
    return { before, frames, after: chartHarness.snapshot() };
  }, timeframe);
}

test("crosshair, zoom, resize, and prepend stay synchronized", async ({ page }) => {
  const computeAttempts = new Map<string, number>();
  let completedInitialComputes = 0;
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
    const payload = request.postDataJSON() as {
      indicatorId?: string;
      indicatorType?: string;
      candles?: Array<{ time: number; close: number }>;
    };
    const indicatorId = payload.indicatorId ?? "fixture";
    const attempt = (computeAttempts.get(indicatorId) ?? 0) + 1;
    computeAttempts.set(indicatorId, attempt);
    const paneSeries = payload.indicatorType?.includes("pane") ?? false;
    const series = attempt === 1
      ? []
      : [{
          key: `${indicatorId}:value`,
          color: paneSeries ? "#f8fafc" : "#818cf8",
          data: (payload.candles ?? []).map((candle, index) => ({
            time: candle.time,
            value: paneSeries ? 40 + (index % 21) : candle.close,
          })),
          type: "line",
          precision: paneSeries ? 1 : 5,
        }];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { id: indicatorId, series },
        errors: [],
      }),
    });
    if (attempt === 1) completedInitialComputes += 1;
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

  await test.step("indicator panes recover after live history invalidation", async () => {
    await expect.poll(() => completedInitialComputes).toBe(3);
    expect((await snapshot(page)).paneSeriesPointCounts.slice(1)).toEqual([[], []]);
    await page.evaluate(() =>
      window.__chartInteractionTest?.invalidateIndicatorHistory()
    );
    await expect.poll(() =>
      [...computeAttempts.values()].filter((attempt) => attempt >= 2).length
    ).toBe(3);
    await expect.poll(async () => {
      const current = await snapshot(page);
      return current.paneSeriesPointCounts
        .slice(1)
        .every((counts) => counts.some((count) => count > 0));
    }).toBe(true);
    const recovered = await snapshot(page);
    expect(recovered.priceScaleRanges.slice(1).every(Boolean)).toBe(true);
  });

  await test.step("initial candle density matches the TradingView visual profile", async () => {
    await expect.poll(async () => (await snapshot(page)).barSpacing).toBeCloseTo(16, 1);
  });

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

  await test.step("all timeframe changes use one indicator-safe viewport transaction", async () => {
    for (const timeframe of TIMEFRAME_TRANSITION_MATRIX) {
      await page.evaluate(() => window.__chartInteractionTest?.setBarSpacing(7));
      await expect.poll(async () => (await snapshot(page)).barSpacing).toBeCloseTo(7, 1);

      const transition = await captureTimeframeTransition(page, timeframe);
      await expect.poll(async () => (await snapshot(page)).viewport.cause)
        .toBe("market-change");
      await expect.poll(async () => (await snapshot(page)).barSpacing)
        .toBeCloseTo(16, 1);

      const settled = await snapshot(page);
      expect(settled.viewport.programmaticWrites)
        .toBe(transition.before.viewport.programmaticWrites + 1);
      expect(settled.paneMetrics.paneCount).toBe(3);
      expect(settled.paneMetrics.widthDrift).toBeLessThanOrEqual(1);
      expect(settled.priceScaleAutoScale.every(Boolean)).toBe(true);
      expect(settled.paneSeriesPointCounts.slice(1).every((counts) =>
        counts.some((count) => count > 0)
      )).toBe(true);

      const committedFrames = transition.frames.filter((frame) =>
        frame.viewport.programmaticWrites > transition.before.viewport.programmaticWrites
      );
      expect(committedFrames.length).toBeGreaterThan(0);
      expect(committedFrames.every((frame) =>
        frame.viewport.cause === "market-change" &&
        frame.viewport.programmaticWrites ===
          transition.before.viewport.programmaticWrites + 1 &&
        logicalRangesMatch(frame.actualLogicalRange, frame.viewport.logicalRange) &&
        frame.paneMetrics.paneCount === 3 &&
        frame.paneMetrics.widthDrift <= 1
      )).toBe(true);
      expect(logicalRangesMatch(
        settled.actualLogicalRange,
        settled.viewport.logicalRange,
      )).toBe(true);
    }
    await expectPaneLegendsAligned(page);
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

  await test.step("repeated price-axis drags survive cancellation and reset", async () => {
    const initial = await snapshot(page);
    const main = initial.paneBoxes[0];
    const x = main.x + main.width - 4;
    const y = main.y + main.height * 0.5;
    const beforeCancel = initial.priceScaleRanges[0];
    expect(beforeCancel).not.toBeNull();

    await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      if (!target) throw new Error("Price-axis target unavailable");
      const pointer = {
        bubbles: true,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
        isPrimary: true,
        pointerId: 777,
        pointerType: "mouse",
      };
      target.dispatchEvent(new PointerEvent("pointerdown", pointer));
      window.dispatchEvent(new PointerEvent("pointermove", {
        ...pointer,
        clientY: y - 28,
      }));
      window.dispatchEvent(new PointerEvent("pointercancel", {
        ...pointer,
        buttons: 0,
        clientY: y - 28,
      }));
    }, { x, y });
    await expect.poll(async () => {
      const current = (await snapshot(page)).priceScaleRanges[0];
      return current &&
        beforeCancel &&
        (current.from !== beforeCancel.from || current.to !== beforeCancel.to);
    }).toBe(true);

    let previous = (await snapshot(page)).priceScaleRanges[0];
    for (let attempt = 0; attempt < 12; attempt++) {
      const delta = attempt % 2 === 0 ? -24 : 24;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + delta, { steps: 5 });
      await page.mouse.up();
      await expect.poll(async () => {
        const current = (await snapshot(page)).priceScaleRanges[0];
        return current &&
          previous &&
          (current.from !== previous.from || current.to !== previous.to);
      }).toBe(true);
      previous = (await snapshot(page)).priceScaleRanges[0];
    }

    await page.mouse.dblclick(x, y);
    await expect.poll(async () => (await snapshot(page)).priceScaleAutoScale[0])
      .toBe(true);
  });

  await test.step("plot widths remain equal after autoscale and resize", async () => {
    const before = await snapshot(page);
    const beforeMaxBarSpacing = before.maxBarSpacing;
    const main = before.paneBoxes[0];
    await page.mouse.dblclick(main.x + main.width - 4, main.y + main.height * 0.5);
    await page.setViewportSize({ width: 1120, height: 760 });
    await expect.poll(async () => (await snapshot(page)).paneMetrics.timeScaleWidth)
      .not.toBe(before.paneMetrics.timeScaleWidth);
    const after = await snapshot(page);
    expect(after.paneMetrics.plotAreaWidths).toHaveLength(3);
    expect(after.paneMetrics.widthDrift).toBeLessThanOrEqual(1);
    expect(new Set(after.paneMetrics.plotAreaWidths).size).toBe(1);
    expect(after.maxBarSpacing).not.toBe(beforeMaxBarSpacing);
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

  await test.step("deep zoom clamps responsively on the live plot width", async () => {
    await page.evaluate(() => window.__chartInteractionTest?.setBarSpacing(1_000));
    await expect.poll(async () => {
      const current = await snapshot(page);
      return Math.abs(current.barSpacing - current.maxBarSpacing);
    }).toBeLessThan(0.05);
    const after = await snapshot(page);
    expect(after.maxBarSpacing).toBeGreaterThan(0);
    expect(after.barSpacing).toBeLessThanOrEqual(after.maxBarSpacing);
    const expectedMaxBarSpacing = (
        after.paneMetrics.plotAreaWidths[0] -
        after.rightPriceScaleWidths[0]
      ) / 2;
    expect(Math.abs(after.maxBarSpacing - expectedMaxBarSpacing))
      .toBeLessThanOrEqual(1);
  });
});
