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
    await page.goto("/?chartFixture=300&chartFixtureTail=250");
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
});
