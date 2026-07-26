import { expect, test, type Page } from "@playwright/test";

async function openLayoutMenu(page: Page) {
  await page.getByRole("button", { name: "Layout", exact: true }).click();
}

async function chooseArrangement(page: Page, label: string) {
  await openLayoutMenu(page);
  await page.getByRole("menuitemradio", { name: label, exact: true }).click();
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
    ).toBe("cursor");
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
