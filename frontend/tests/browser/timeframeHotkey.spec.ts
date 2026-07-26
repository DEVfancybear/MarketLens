import { expect, test } from "@playwright/test";

test.describe("quick timeframe keyboard switching", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
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
    await page.goto("/?chartFixture=300&chartFixtureTail=200");
    await expect(page.locator('[data-platform="desktop"]')).toBeVisible({
      timeout: 45_000,
    });
  });

  test("digit and comma open the accessible interval prompt", async ({ page }) => {
    await page.keyboard.press("1");

    const dialog = page.getByRole("dialog", { name: "Change interval" });
    const input = dialog.getByRole("textbox", { name: "Chart interval" });
    await expect(dialog).toBeVisible();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("1");
    await expect(dialog.getByRole("status")).toHaveText("Switch to 1m");

    await input.type("5");
    await expect(input).toHaveValue("15");
    await expect(dialog.getByRole("status")).toHaveText("Switch to 15m");

    await input.fill("60");
    await expect(dialog.getByRole("status")).toHaveText("Switch to 1H");
    await input.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "1H", exact: true })).toBeVisible();

    await page.keyboard.press(",");
    await expect(dialog).toBeVisible();
    await expect(input).toHaveValue("");
    await input.fill("10");
    await expect(dialog.getByRole("status")).toHaveText(
      "This interval is not available",
    );
    await expect(
      dialog.getByRole("button", { name: "Enter a supported interval" }),
    ).toBeDisabled();
    await input.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("typing fields are isolated and Shift+number keeps drawing shortcuts", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Add symbol" }).click();
    const search = page.getByRole("textbox", { name: "Search symbol" });
    await expect(search).toBeFocused();
    await search.type("1");
    await expect(search).toHaveValue("1");
    await expect(
      page.getByRole("dialog", { name: "Change interval" }),
    ).toHaveCount(0);
    await search.press("Escape");

    await page.keyboard.press("Shift+2");
    await expect(page.getByRole("button", { name: "Trend line" })).toHaveClass(
      /bg-brand\/10/,
    );
    await expect(
      page.getByRole("dialog", { name: "Change interval" }),
    ).toHaveCount(0);
  });
});
