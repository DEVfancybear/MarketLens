import { expect, test } from "@playwright/test";

test.describe("isolated terminal platforms", () => {
  test("mobile owns navigation, touch targets, theme and sheet history", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const mobile = page.locator('[data-platform="mobile"]');
    await expect(mobile).toBeVisible();
    await expect(page.locator('.desktop-terminal')).toHaveCount(0);

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
    expect(timeZoneBefore).not.toBeNull();
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
});
