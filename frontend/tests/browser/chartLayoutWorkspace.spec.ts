import { expect, test, type Locator, type Page } from "@playwright/test";

async function openLayoutMenu(page: Page) {
  await page.getByRole("button", { name: "Layout", exact: true }).click();
}

async function chooseArrangement(page: Page, label: string) {
  await openLayoutMenu(page);
  await page.getByRole("menuitemradio", { name: label, exact: true }).click();
}

async function previewCanvasArea(preview: Locator): Promise<number> {
  return preview.locator("canvas").evaluateAll((canvases) =>
    canvases.reduce((area, canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) return area;
      return area + canvas.width * canvas.height;
    }, 0),
  );
}

async function chartHasCandlePixels(surface: Locator): Promise<boolean> {
  return surface.locator("canvas").evaluateAll((canvases) => {
    const isCandleColor = (red: number, green: number, blue: number, alpha: number) =>
      alpha > 0 && (
        (Math.abs(red - 8) <= 8 && Math.abs(green - 153) <= 8 && Math.abs(blue - 129) <= 8) ||
        (Math.abs(red - 242) <= 8 && Math.abs(green - 54) <= 8 && Math.abs(blue - 69) <= 8)
      );

    for (const canvas of canvases) {
      if (!(canvas instanceof HTMLCanvasElement) || canvas.width <= 0 || canvas.height <= 0) {
        continue;
      }
      // Read a nearest-neighbour thumbnail instead of copying every backing
      // pixel from every Lightweight Charts layer. Candle bodies are several
      // CSS pixels wide, so this keeps the symptom assertion exact while the
      // repeated-switch regression stays fast on DPR-scaled CI canvases.
      const sample = document.createElement("canvas");
      sample.width = Math.min(320, canvas.width);
      sample.height = Math.min(180, canvas.height);
      const context = sample.getContext("2d", { willReadFrequently: true });
      if (!context) continue;
      context.imageSmoothingEnabled = false;
      context.drawImage(canvas, 0, 0, sample.width, sample.height);
      const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
      for (let index = 0; index < pixels.length; index += 4) {
        if (isCandleColor(
          pixels[index]!,
          pixels[index + 1]!,
          pixels[index + 2]!,
          pixels[index + 3]!,
        )) {
          return true;
        }
      }
    }
    return false;
  });
}

test.describe("TradingView-style chart layouts", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.route("**/api/v1/mt5/symbols", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          connected: true,
          source: "playwright",
          count: 2,
          streamSymbols: ["EURUSD", "GBPUSD"],
          symbols: [
            {
              name: "EURUSD",
              description: "Euro / US Dollar",
              visible: true,
              digits: 5,
              point: 0.00001,
              spread: 0,
              trade_mode: 4,
              currency_base: "EUR",
              currency_profit: "USD",
            },
            {
              name: "GBPUSD",
              description: "British Pound / US Dollar",
              visible: true,
              digits: 5,
              point: 0.00001,
              spread: 0,
              trade_mode: 4,
              currency_base: "GBP",
              currency_profit: "USD",
            },
          ],
        }),
      });
    });
    await page.route("**/api/v1/mt5/history?*", async (route) => {
      const lastFixtureOpen = 1_704_067_200 + 899 * 60;
      const candles = Array.from({ length: 200 }, (_, index) => {
        const time = lastFixtureOpen - (199 - index) * 15 * 60;
        const open = 1.08 + index * 0.00005;
        const close = open + (index % 2 === 0 ? 0.00003 : -0.00002);
        return {
          time,
          open,
          high: Math.max(open, close) + 0.00004,
          low: Math.min(open, close) - 0.00004,
          close,
          volume: 100 + index,
        };
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          connected: true,
          bridgeUrl: "playwright",
          source: "playwright",
          symbol: "EURUSD",
          timeframe: "15m",
          candles,
          hasMore: true,
        }),
      });
    });
    await page.route("**/api/v1/indicator-runtime/**", async (route) => {
      const request = route.request();
      if (request.url().endsWith("/catalog")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            indicators: [{
              type: "fixture-ema",
              name: "Fixture EMA",
              shortTitle: "Fixture EMA",
              overlay: true,
              inputs: [],
              styles: [],
              requiresHistoryContext: false,
              sourceAvailable: false,
            }],
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
          result: { id: payload.indicatorId ?? "fixture-ema", series: [] },
          errors: [],
        }),
      });
    });
    await page.goto("/?chartFixture=900&chartFixtureTail=500");
    await expect(page.locator('[data-platform="desktop"]')).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('[data-chart-layout="single"] [data-chart-slot]')).toHaveCount(1);
  });

  test("arrangements render real panes and preserve an explicit active chart", async ({ page }) => {
    await chooseArrangement(page, "2 Horizontal");
    const horizontal = page.locator('[data-chart-layout="two_horizontal"] [data-chart-slot]');
    await expect(horizontal).toHaveCount(2);
    const horizontalBoxes = await horizontal.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      }),
    );
    expect(horizontalBoxes[1]!.left).toBeGreaterThan(horizontalBoxes[0]!.left);
    expect(Math.abs(horizontalBoxes[1]!.top - horizontalBoxes[0]!.top)).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: /^Activate chart 2:/ }).click();
    await expect(page.locator('[data-chart-slot="1"]')).toHaveAttribute("data-active-chart", "true");

    await chooseArrangement(page, "2 Vertical");
    const vertical = page.locator('[data-chart-layout="two_vertical"] [data-chart-slot]');
    await expect(vertical).toHaveCount(2);
    const verticalBoxes = await vertical.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      }),
    );
    expect(verticalBoxes[1]!.top).toBeGreaterThan(verticalBoxes[0]!.top);
    expect(Math.abs(verticalBoxes[1]!.left - verticalBoxes[0]!.left)).toBeLessThanOrEqual(1);
    await expect(page.locator('[data-chart-slot="1"]')).toHaveAttribute("data-active-chart", "true");

    await chooseArrangement(page, "Grid 2×2");
    await expect(page.locator('[data-chart-layout="grid_2x2"] [data-chart-slot]')).toHaveCount(4);

    await page.getByRole("button", { name: /^Activate chart 4:/ }).click();
    await expect(page.locator('[data-chart-slot="3"]')).toHaveAttribute("data-active-chart", "true");

    await chooseArrangement(page, "Single");
    await expect(page.locator('[data-chart-layout="single"] [data-chart-slot]')).toHaveCount(1);
    await expect(page.locator('[data-chart-slot="0"]')).toHaveAttribute("data-active-chart", "true");

    await chooseArrangement(page, "Grid 2×2");
    await expect(page.locator('[data-chart-slot="3"]')).toHaveCount(1);
  });

  test("repeated activation keeps every multi-chart preview mounted with a live canvas", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await chooseArrangement(page, "2 Vertical");
    const layout = page.locator('[data-chart-layout="two_vertical"]');
    const previews = layout.locator("[data-chart-preview]");
    await expect(previews).toHaveCount(2);
    await expect.poll(
      async () => Math.min(
        await previewCanvasArea(previews.nth(0)),
        await previewCanvasArea(previews.nth(1)),
      ),
      { timeout: 15_000 },
    ).toBeGreaterThan(0);
    await expect.poll(
      async () => chartHasCandlePixels(
        layout.locator('[data-chart-slot="0"] [data-active-chart-surface]'),
      ),
      { timeout: 15_000 },
    ).toBe(true);

    const persistentPreviews = [
      await previews.nth(0).elementHandle(),
      await previews.nth(1).elementHandle(),
    ];
    expect(persistentPreviews.every(Boolean)).toBe(true);

    for (let iteration = 0; iteration < 6; iteration += 1) {
      const targetSlot = iteration % 2 === 0 ? 1 : 0;
      const inactiveSlot = targetSlot === 0 ? 1 : 0;
      await page.getByRole("button", {
        name: new RegExp(`^Activate chart ${targetSlot + 1}:`),
      }).click();
      await expect(layout.locator(`[data-chart-slot="${targetSlot}"]`))
        .toHaveAttribute("data-active-chart", "true");

      // The production failure clears the new preview bitmap after its delayed
      // device-pixel-ratio resize, roughly 150-200 ms after activation.
      await page.waitForTimeout(350);
      for (const preview of persistentPreviews) {
        expect(await preview!.evaluate((node) => node.isConnected)).toBe(true);
      }
      expect(await previewCanvasArea(previews.nth(inactiveSlot))).toBeGreaterThan(0);
      expect(await chartHasCandlePixels(previews.nth(inactiveSlot))).toBe(true);
      expect(await chartHasCandlePixels(
        layout.locator(
          `[data-chart-slot="${targetSlot}"] [data-active-chart-surface]`,
        ),
      )).toBe(true);
    }

    expect(pageErrors.filter((message) => /disposed|canvas|chart/i.test(message))).toEqual([]);
  });

  test("selecting Text once survives pane activation and opens a pane-local editor", async ({ page }) => {
    await chooseArrangement(page, "2 Vertical");
    await page.waitForFunction(() => Boolean(window.__drawingInteractionTest));
    await page.evaluate(() => window.__drawingInteractionTest!.clear());

    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page.getByRole("button", { name: /^Text\b/ }).last().click();
    await expect.poll(async () =>
      page.evaluate(() => window.__drawingInteractionTest!.snapshot().activeTool)
    ).toBe("text");

    await page.getByRole("button", { name: /^Activate chart 2:/ }).click();
    await expect(page.locator('[data-chart-slot="1"]')).toHaveAttribute(
      "data-active-chart",
      "true",
    );
    await expect.poll(async () =>
      page.evaluate(() => window.__drawingInteractionTest!.snapshot().activeTool)
    ).toBe("text");

    const target = page.locator('[data-chart-slot="1"]');
    const targetBox = await target.boundingBox();
    expect(targetBox).not.toBeNull();
    const placement = {
      x: targetBox!.x + targetBox!.width * 0.32,
      y: targetBox!.y + targetBox!.height * 0.56,
    };
    await page.mouse.click(placement.x, placement.y);

    const editor = target.locator("[data-inline-text-editor]");
    await expect(editor).toBeVisible();
    await expect(
      page.locator("[data-drawing-toolbar][data-chart-popup]"),
    ).toHaveCount(0);
    const editorBox = await editor.boundingBox();
    expect(editorBox).not.toBeNull();
    expect(Math.abs(editorBox!.x - placement.x)).toBeLessThan(3);
    expect(
      Math.abs(editorBox!.y + editorBox!.height / 2 - placement.y),
    ).toBeLessThan(3);
    expect(editorBox!.x).toBeGreaterThanOrEqual(targetBox!.x);
    expect(editorBox!.x + editorBox!.width).toBeLessThanOrEqual(
      targetBox!.x + targetBox!.width,
    );

    await editor.fill("Multi-chart text");
    await editor.press("Enter");
    await expect.poll(async () =>
      page.evaluate(() => {
        const drawing = window.__drawingInteractionTest!.snapshot().drawings[0];
        return drawing
          ? { tool: drawing.tool, text: drawing.text, chartId: drawing.sync?.chartId }
          : null;
      })
    ).toEqual({ tool: "text", text: "Multi-chart text", chartId: "chart-2" });
  });

  test("pane activation preserves two-point and continuous drawing tools", async ({ page }) => {
    await chooseArrangement(page, "2 Horizontal");
    await page.waitForFunction(() => Boolean(window.__drawingInteractionTest));
    await page.evaluate(() => window.__drawingInteractionTest!.clear());

    await page.getByRole("button", { name: "Trend line", exact: true }).click();
    await page.getByRole("button", { name: /^Trendline\b/ }).last().click();
    await page.getByRole("button", { name: /^Activate chart 2:/ }).click();
    await expect.poll(async () =>
      page.evaluate(() => window.__drawingInteractionTest!.snapshot().activeTool)
    ).toBe("trendline");

    const secondPaneBox = await page.locator('[data-chart-slot="1"]').boundingBox();
    expect(secondPaneBox).not.toBeNull();
    await page.mouse.click(
      secondPaneBox!.x + secondPaneBox!.width * 0.25,
      secondPaneBox!.y + secondPaneBox!.height * 0.65,
    );
    await page.mouse.click(
      secondPaneBox!.x + secondPaneBox!.width * 0.65,
      secondPaneBox!.y + secondPaneBox!.height * 0.35,
    );
    await expect.poll(async () =>
      page.evaluate(() => window.__drawingInteractionTest!.snapshot().drawings[0]?.tool)
    ).toBe("trendline");

    await page.evaluate(() => window.__drawingInteractionTest!.clear());
    await page.getByRole("button", { name: "Rectangle", exact: true }).click();
    await page.getByRole("button", { name: /^Brush\b/ }).click();
    await page.getByRole("button", { name: /^Activate chart 1:/ }).click();
    await expect.poll(async () =>
      page.evaluate(() => window.__drawingInteractionTest!.snapshot().activeTool)
    ).toBe("brush");

    const firstPaneBox = await page.locator('[data-chart-slot="0"]').boundingBox();
    expect(firstPaneBox).not.toBeNull();
    await page.mouse.move(
      firstPaneBox!.x + firstPaneBox!.width * 0.3,
      firstPaneBox!.y + firstPaneBox!.height * 0.6,
    );
    await page.mouse.down();
    await page.mouse.move(
      firstPaneBox!.x + firstPaneBox!.width * 0.6,
      firstPaneBox!.y + firstPaneBox!.height * 0.4,
      { steps: 6 },
    );
    await page.mouse.up();
    await expect.poll(async () =>
      page.evaluate(() => window.__drawingInteractionTest!.snapshot().drawings[0]?.tool)
    ).toBe("brush");
  });

  test("All charts replay scope is disabled for Single and enabled for multi-chart", async ({ page }) => {
    await openLayoutMenu(page);
    await expect(page.getByRole("menuitemradio", { name: "All charts", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");

    await chooseArrangement(page, "Grid 2×2");
    await openLayoutMenu(page);
    const allCharts = page.getByRole("menuitemradio", { name: "All charts", exact: true });
    await expect(allCharts).toBeEnabled();
    await allCharts.click();

    await openLayoutMenu(page);
    await expect(page.getByRole("menuitemradio", { name: "All charts", exact: true }))
      .toHaveAttribute("aria-checked", "true");
  });

  test("dragging a watchlist symbol targets the hovered pane without changing sibling panes", async ({ page }) => {
    await page.getByRole("button", { name: "Add symbol" }).click();
    await page.getByPlaceholder("Search symbol").fill("GBPUSD");
    await page.getByRole("button", { name: /GBPUSD/ }).click();
    await chooseArrangement(page, "2 Horizontal");

    const source = page.locator('[data-watchlist-symbol="GBPUSD"]');
    const target = page.locator('[data-chart-slot="1"]');
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    await page.mouse.move(
      sourceBox!.x + sourceBox!.width / 2,
      sourceBox!.y + sourceBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      sourceBox!.x + sourceBox!.width / 2 - 12,
      sourceBox!.y + sourceBox!.height / 2,
      { steps: 2 },
    );
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
      { steps: 8 },
    );
    await expect(target.getByText("Drop GBPUSD on Chart 2")).toBeVisible();
    await page.mouse.up();

    await expect(target).toHaveAttribute("data-active-chart", "true");
    await expect(target.getByTestId("current-price-symbol")).toHaveText("GBPUSD");
    await expect(
      page.locator('[data-chart-slot="0"]').getByTestId("current-price-symbol"),
    ).toHaveText("EURUSD");
  });

  test("every pane exposes its symbol and live candle countdown", async ({ page }) => {
    const lastFixtureOpen = 1_704_067_200 + 899 * 60;
    await page.clock.setFixedTime(new Date((lastFixtureOpen + 30) * 1000));
    await chooseArrangement(page, "Grid 2×2");

    const panes = page.locator('[data-chart-layout="grid_2x2"] [data-chart-slot]');
    await expect(panes).toHaveCount(4);
    await expect(panes.getByTestId("current-price-symbol")).toHaveCount(4);
    await expect(panes.getByTestId("current-price-symbol")).toHaveText([
      "EURUSD",
      "EURUSD",
      "EURUSD",
      "EURUSD",
    ]);
    await expect(panes.getByTestId("current-price-countdown")).toHaveCount(4);
    for (const countdown of await panes.getByTestId("current-price-countdown").all()) {
      await expect(countdown).not.toHaveText("");
    }
  });

  test("a cold inactive timeframe recovers after an aborted load and a transient history error", async ({ page }) => {
    await page.unroute("**/api/v1/mt5/history?*");
    let oneHourRequests = 0;

    await page.route("**/api/v1/mt5/history?*", async (route) => {
      const requestUrl = new URL(route.request().url());
      const timeframe = requestUrl.searchParams.get("timeframe") ?? "15m";
      if (timeframe === "1H") {
        oneHourRequests += 1;
        if (oneHourRequests === 1) {
          // Keep the active-chart request in flight long enough to switch panes.
          // Its AbortSignal must not poison the preview's recovery request.
          await new Promise((resolve) => setTimeout(resolve, 1_500));
        } else if (oneHourRequests === 2) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "temporary MT5 history warm-up failure" }),
          });
          return;
        }
      }

      const step = timeframe === "1H" ? 60 * 60 : 15 * 60;
      const lastOpen = 1_704_067_200 + 899 * 60;
      const candles = Array.from({ length: 120 }, (_, index) => {
        const time = lastOpen - (119 - index) * step;
        const open = 1.2 + index * 0.00005;
        const close = open + (index % 2 === 0 ? 0.00003 : -0.00002);
        return {
          time,
          open,
          high: Math.max(open, close) + 0.00004,
          low: Math.min(open, close) - 0.00004,
          close,
          volume: 100 + index,
        };
      });
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            connected: true,
            bridgeUrl: "playwright",
            source: "playwright",
            symbol: "EURUSD",
            timeframe,
            candles,
            hasMore: true,
          }),
        });
      } catch {
        // The first request is deliberately aborted when its chart becomes
        // inactive. Playwright may reject fulfillment after that cancellation.
      }
    });

    await chooseArrangement(page, "2 Horizontal");
    await page.getByRole("button", { name: /^Activate chart 2:/ }).click();
    await page.getByRole("button", { name: "Select interval", exact: true }).click();
    await page.getByRole("button", { name: /^1 hour(?: |$)/ }).click();
    await expect.poll(() => oneHourRequests).toBe(1);

    await page.getByRole("button", { name: /^Activate chart 1:/ }).click();

    await expect.poll(() => oneHourRequests, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
    const recoveredPane = page.locator('[data-chart-slot="1"]');
    await expect(
      recoveredPane.getByRole("button", { name: "Activate chart 2: EURUSD 1H", exact: true }),
    ).toBeVisible();
    await expect(recoveredPane.getByText(/^O 1\./)).toBeVisible();
    await expect(page.locator('[data-chart-slot="0"]')).toContainText("15m");
  });

  test("drawings and pending tools remain owned by their source pane", async ({ page }) => {
    await chooseArrangement(page, "2 Horizontal");
    await page.waitForFunction(() =>
      Boolean(window.__drawingInteractionTest && window.__chartInteractionTest)
    );
    await page.evaluate(() => window.__drawingInteractionTest?.clear());

    const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
    const pane = chart.paneBoxes[0];
    const creationPoint = {
      x: pane.x + pane.width * 0.35,
      y: pane.y + pane.height * 0.52,
    };
    const selectLongPosition = async () => {
      await page.getByRole("button", { name: "Long position", exact: true }).first().click();
      await page.getByRole("button", { name: /^Long position\b/ }).last().click();
    };

    await selectLongPosition();
    await page.mouse.click(creationPoint.x, creationPoint.y);
    await expect.poll(async () =>
      page.evaluate(() => window.__drawingInteractionTest!.snapshot().drawings.length)
    ).toBe(1);
    const created = await page.evaluate(() =>
      window.__drawingInteractionTest!.snapshot().drawings[0]
    );
    expect(created.sync).toEqual({
      mode: "chart-only",
      symbol: "EURUSD",
      layoutId: "workspace",
      chartId: "main",
    });
    await expect(
      page.locator('[data-chart-slot="1"] [data-drawing-preview-canvas]'),
    ).toHaveAttribute("data-drawing-count", "0");

    await selectLongPosition();
    await expect.poll(async () =>
      page.evaluate(() => window.__drawingInteractionTest!.snapshot().activeTool)
    ).toBe("long");
    await page.getByRole("button", { name: /^Activate chart 2:/ }).click();
    await expect(page.locator('[data-chart-slot="1"]')).toHaveAttribute(
      "data-active-chart",
      "true",
    );
    await expect.poll(async () =>
      page.evaluate(() => window.__drawingInteractionTest!.snapshot().activeTool)
    ).toBe("long");
    await expect.poll(async () =>
      page.evaluate(() => window.__drawingInteractionTest!.snapshot().drawings.length)
    ).toBe(0);
    await expect(
      page.locator('[data-chart-slot="0"] [data-drawing-preview-canvas]'),
    ).toHaveAttribute("data-drawing-count", "1");

    await page.getByRole("button", { name: /^Activate chart 1:/ }).click();
    await expect.poll(async () =>
      page.evaluate(() =>
        window.__drawingInteractionTest!.snapshot().drawings.map((drawing) => drawing.id)
      )
    ).toEqual([created.id]);
  });

  test("indicators remain owned by the pane where they were added", async ({ page }) => {
    await chooseArrangement(page, "2 Horizontal");
    await page.getByRole("button", { name: "Indicators", exact: true }).click();
    await page.getByRole("textbox", { name: "Search indicators" }).fill("Fixture EMA");
    await page.getByRole("button", { name: "Fixture EMA", exact: true }).click();

    await expect(
      page.locator('[data-chart-slot="0"] [data-indicator-legend]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-chart-slot="1"] [data-indicator-legend]'),
    ).toHaveCount(0);

    await page.getByRole("button", { name: /^Activate chart 2:/ }).click();
    await expect(
      page.locator('[data-chart-slot="1"] [data-indicator-legend]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-chart-slot="0"] [data-indicator-legend]'),
    ).toHaveCount(1);

    await page.getByRole("button", { name: /^Activate chart 1:/ }).click();
    await expect(
      page.locator('[data-chart-slot="0"] [data-indicator-legend]'),
    ).toContainText("Fixture EMA");
  });
});
