import { expect, test } from "@playwright/test";

test.describe("isolated terminal platforms", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/v1/mt5/symbols", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          connected: true,
          source: "fixture",
          count: 2,
          streamSymbols: ["AAPL"],
          symbols: [
            {
              name: "AAPL",
              path: "Pro\\Stocks\\AAPL",
              description: "Apple Inc.",
              currency_base: "USD",
              currency_profit: "USD",
              digits: 2,
              point: 0.01,
            },
            {
              name: "EURUSD",
              path: "Pro\\Forex\\EURUSD",
              description: "Euro vs US Dollar",
              currency_base: "EUR",
              currency_profit: "USD",
              digits: 5,
              point: 0.00001,
            },
          ],
        }),
      });
    });
  });

  test("mobile owns navigation, touch targets, theme and sheet history", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const mobile = page.locator('[data-platform="mobile"]');
    await expect(mobile).toBeVisible();
    await expect(page.locator('.desktop-terminal')).toHaveCount(0);

    const symbolTrigger = mobile.locator('.mobile-symbol-trigger');
    await symbolTrigger.click();
    const symbolPicker = page.getByRole('dialog', { name: 'Select market' });
    await expect(symbolPicker).toBeVisible();
    await expect.poll(async () => symbolPicker.locator('.mobile-symbol-avatar').count()).toBeGreaterThan(0);
    await expect.poll(async () => symbolPicker.locator('.mobile-symbol-avatar').first().locator('svg, img').count()).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(symbolPicker).toHaveCount(0);

    const nav = mobile.locator('.mobile-bottom-nav');
    await expect(nav.getByRole('button')).toHaveCount(5);
    await expect(nav.getByRole('button', { name: 'Chart', exact: true })).toHaveAttribute('aria-current', 'page');

    const undersizedTargets = await mobile.locator('button:visible').evaluateAll((buttons) =>
      buttons
        .map((button) => {
          const rect = button.getBoundingClientRect();
          return { label: button.getAttribute('aria-label') ?? button.textContent?.trim(), width: rect.width, height: rect.height };
        })
        .filter((target) => target.width < 44 || target.height < 44),
    );
    expect(undersizedTargets).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);

    await mobile.getByRole('button', { name: 'Select time zone' }).click();
    const timeZoneMenu = page.getByRole('menu', { name: 'Chart time zone' });
    const timeZoneHandle = timeZoneMenu.locator('[data-chart-popup-drag-handle]');
    await expect(timeZoneMenu).toBeVisible();
    await expect(timeZoneHandle).toBeVisible();
    const timeZoneBefore = await timeZoneMenu.boundingBox();
    const timeZoneTrigger = await mobile.getByRole('button', { name: 'Select time zone' }).boundingBox();
    expect(timeZoneBefore).not.toBeNull();
    expect(timeZoneTrigger).not.toBeNull();
    expect(timeZoneBefore!.x).toBeGreaterThan(8);
    expect(timeZoneBefore!.x + timeZoneBefore!.width).toBeLessThanOrEqual(382);
    expect(timeZoneBefore!.x).toBeLessThanOrEqual(
      timeZoneTrigger!.x + timeZoneTrigger!.width - timeZoneBefore!.width + 1,
    );
    const freeBelow = 844 - timeZoneBefore!.y - timeZoneBefore!.height;
    const moveKey = freeBelow >= 32 ? 'ArrowDown' : 'ArrowUp';
    await timeZoneHandle.focus();
    await timeZoneHandle.press(moveKey);
    await timeZoneHandle.press(moveKey);
    await expect.poll(async () => {
      const current = (await timeZoneMenu.boundingBox())!;
      return Math.abs(current.y - timeZoneBefore!.y);
    }).toBeGreaterThan(24);
    expect(await timeZoneMenu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.top >= 0 &&
        rect.right <= window.innerWidth && rect.bottom <= window.innerHeight;
    })).toBe(true);
    await page.keyboard.press('Escape');
    await expect(timeZoneMenu).toHaveCount(0);

    await nav.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tools & settings' })).toBeVisible();

    await page.getByRole('button', { name: 'Appearance Dark theme', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    const replayTrigger = page.getByRole('button', { name: 'Market replay Practice historical sessions', exact: true });
    await replayTrigger.click();
    const replayDialog = page.getByRole('dialog', { name: 'Market replay' });
    await expect(replayDialog).toBeVisible();
    await expect(page.locator('[data-mobile-app-content]')).toHaveAttribute('aria-hidden', 'true');
    await expect(replayDialog.locator('xpath=ancestor::*[@data-chart-ui]')).toHaveCount(1);

    await page.goBack();
    await expect(replayDialog).toHaveCount(0);
    await expect(page.locator('[data-mobile-app-content]')).not.toHaveAttribute('aria-hidden', 'true');
  });

  test("mobile landscape remains overflow-free", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto("/");
    await expect(page.locator('[data-platform="mobile"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await expect(page.locator('.mobile-chart')).toBeVisible();
  });

  test("mobile watchlist actions use the shared platform dialog", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let nativeDialogCount = 0;
    page.on("dialog", async (browserDialog) => {
      nativeDialogCount += 1;
      await browserDialog.dismiss();
    });
    await page.goto("/");

    const mobile = page.locator('[data-platform="mobile"]');
    await mobile.locator('.mobile-bottom-nav').getByRole('button', { name: 'Markets', exact: true }).click();
    await mobile.getByRole('button', { name: 'Manage watchlists' }).click();

    const manager = page.getByRole('dialog', { name: 'Manage watchlists' });
    await expect(manager).toBeVisible();
    await manager.getByRole('button', { name: 'New', exact: true }).click();

    const createDialog = page.getByRole('dialog', { name: 'Create new list' });
    await expect(createDialog).toBeVisible();
    await expect(createDialog.locator('xpath=ancestor::*[@data-platform-dialog]')).toHaveCount(1);
    await expect(createDialog.getByLabel('List name')).toBeFocused();
    expect(await createDialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
    })).toBe(true);

    await createDialog.getByLabel('List name').fill('Mobile list');
    await createDialog.getByRole('button', { name: 'Ok', exact: true }).click();
    await expect(createDialog).toHaveCount(0);
    await expect(manager.getByText('Mobile list', { exact: true })).toBeVisible();

    await manager.getByRole('button', { name: 'Delete', exact: true }).click();
    const deleteDialog = page.getByRole('dialog', { name: 'Delete “Mobile list”?' });
    await expect(deleteDialog).toBeVisible();
    await expect(deleteDialog.locator('xpath=ancestor::*[@data-platform-dialog]')).toHaveCount(1);
    await expect(deleteDialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(deleteDialog).toHaveCount(0);
    await expect(manager).toBeVisible();
    expect(nativeDialogCount).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });

  test("desktop loads only the command-center presentation", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/");
    const desktop = page.locator('[data-platform="desktop"]');
    await expect(desktop).toBeVisible();
    await expect(page.locator('.mobile-terminal')).toHaveCount(0);
    await expect(desktop.getByText('SMC Terminal', { exact: true })).toBeVisible();
    await expect(desktop.locator('[data-drawing-toolbar]')).toBeVisible();
    await expect(desktop.getByRole('complementary', { name: 'Market sidebar' })).toBeVisible();

    const smcTrigger = desktop.getByRole('button', { name: 'SMC', exact: true });
    await smcTrigger.click();
    const smcMenu = page.getByRole('menu', { name: 'Smart Money Concepts' });
    await expect(smcMenu).toBeVisible();
    await expect(page.locator('[data-dropdown-portal]')).toHaveCount(1);
    await expect(smcTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(smcMenu.getByRole('menuitemcheckbox')).toHaveCount(8);
    await expect(smcMenu.getByRole('menuitemcheckbox').first()).toBeFocused();
    expect(
      await smcMenu.evaluate((menu) => {
        const rect = menu.getBoundingClientRect();
        const topElement = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + Math.min(rect.height / 2, 80),
        );
        return {
          topmost: Boolean(topElement && menu.contains(topElement)),
          inViewport:
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= window.innerWidth &&
            rect.bottom <= window.innerHeight,
        };
      }),
    ).toEqual({ topmost: true, inViewport: true });

    await page.keyboard.press('Escape');
    await expect(smcMenu).toHaveCount(0);
    await expect(smcTrigger).toBeFocused();

    const marketSidebar = desktop.getByRole('complementary', { name: 'Market sidebar' });
    await marketSidebar.getByRole('button', { name: 'Watchlist', exact: true }).last().click();
    await page.getByRole('button', { name: 'Create new list...', exact: true }).click();
    const desktopCreateDialog = page.getByRole('dialog', { name: 'Create new list' });
    await expect(desktopCreateDialog).toBeVisible();
    await expect(desktopCreateDialog.locator('xpath=ancestor::*[@data-platform-dialog]')).toHaveCount(1);
    await desktopCreateDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(desktopCreateDialog).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
});
