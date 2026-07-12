import { expect, test } from "@playwright/test";

async function openTerminal(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Chart workspace" })).toBeVisible({
    timeout: 30_000,
  });
}

async function expectNoPageOverflow(page: import("@playwright/test").Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

test("phone is chart-first with reachable overlay workspaces and light theme", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTerminal(page);

  const mobileNav = page.getByRole("navigation", { name: "Mobile workspace" });
  await expect(mobileNav).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Drawing tools" })).toBeHidden();

  await mobileNav.getByRole("button", { name: "Draw" }).click();
  await expect(page.getByRole("complementary", { name: "Drawing tools" })).toBeVisible();
  await page.getByRole("button", { name: "Close drawing tools" }).click();

  await mobileNav.getByRole("button", { name: "Watch" }).click();
  await expect(page.getByRole("button", { name: "Close watchlist" })).toBeVisible();
  await page.getByRole("button", { name: "Close watchlist" }).click();

  const themeButton = page.getByRole("button", { name: /Theme: dark/i });
  await themeButton.click();
  await expect(page.locator("html")).toHaveClass(/theme-light/);
  await expect(page.getByRole("button", { name: /Theme: light/i })).toBeVisible();

  await expectNoPageOverflow(page);
});

test("tablet portrait uses overlay navigation instead of permanent docks", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await openTerminal(page);

  const mobileNav = page.getByRole("navigation", { name: "Mobile workspace" });
  await expect(mobileNav).toBeVisible();
  await mobileNav.getByRole("button", { name: "Replay" }).click();
  await expect(page.getByRole("region", { name: "replay panel" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close panel" })).toBeVisible();
  await expectNoPageOverflow(page);
});

test("desktop retains drawing rail and docked workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openTerminal(page);

  await expect(page.getByRole("navigation", { name: "Mobile workspace" })).toBeHidden();
  await expect(page.getByLabel("Cursor")).toBeVisible();
  await expectNoPageOverflow(page);
});
