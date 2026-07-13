import { expect, test, type Page } from "@playwright/test";

async function readMarkerGeometry(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-testid="price-chart-root"]');
    const marker = document.querySelector<HTMLElement>('[data-testid="current-price-marker"]');
    const sidebar = document.querySelector<HTMLElement>('aside[aria-label="Market sidebar"]');
    const mainRow = root?.querySelector("table")?.rows[0];
    const visibleCells = mainRow
      ? Array.from(mainRow.cells).filter((cell) => cell.getBoundingClientRect().width > 0)
      : [];
    const plotCell = visibleCells.at(-2);
    const priceScaleCell = visibleCells.at(-1);
    if (!root || !marker || !sidebar || !plotCell || !priceScaleCell) return null;

    const rootRect = root.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const plotRect = plotCell.getBoundingClientRect();
    const priceScaleRect = priceScaleCell.getBoundingClientRect();
    const sidebarRect = sidebar.getBoundingClientRect();
    return {
      rootOverflow: getComputedStyle(root).overflow,
      rootRight: rootRect.right,
      markerLeft: markerRect.left,
      markerRight: markerRect.right,
      markerWidth: markerRect.width,
      plotRight: plotRect.right,
      priceScaleLeft: priceScaleRect.left,
      priceScaleRight: priceScaleRect.right,
      priceScaleWidth: priceScaleRect.width,
      sidebarLeft: sidebarRect.left,
    };
  });
}

async function expectMarkerInsidePriceScale(page: Page) {
  await expect
    .poll(async () => {
      const geometry = await readMarkerGeometry(page);
      return geometry
        ? Math.abs(geometry.rootRight - geometry.priceScaleRight)
        : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(2);

  const geometry = await readMarkerGeometry(page);

  expect(geometry).not.toBeNull();
  expect(geometry?.rootOverflow).toBe("hidden");
  expect(geometry?.sidebarLeft).toBeGreaterThanOrEqual(geometry?.rootRight ?? 0);
  expect(geometry?.markerLeft).toBeGreaterThanOrEqual((geometry?.plotRight ?? 0) - 0.75);
  expect(geometry?.markerLeft).toBeGreaterThanOrEqual((geometry?.priceScaleLeft ?? 0) - 0.75);
  expect(Math.abs((geometry?.markerWidth ?? 0) - (geometry?.priceScaleWidth ?? 0))).toBeLessThanOrEqual(0.75);
  expect(geometry?.markerRight).toBeGreaterThanOrEqual((geometry?.priceScaleRight ?? 0) - 0.75);
  expect(geometry?.markerRight).toBeLessThanOrEqual((geometry?.rootRight ?? 0) + 0.5);
}

test.describe("desktop overlay boundaries", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/");
    await expect(page.locator('[data-platform="desktop"]')).toBeVisible();
  });

  test("indicator search uses one focus ring around the complete control", async ({ page }) => {
    await page.getByRole("button", { name: "Indicators", exact: true }).click();

    const search = page.getByRole("textbox", { name: "Search indicators" });
    const control = page.getByTestId("indicator-search-control");
    await expect(search).toBeFocused();
    await expect(control).toHaveCSS("border-color", "rgb(124, 115, 255)");

    const focusStyles = await control.evaluate((element) => {
      const input = element.querySelector("input");
      const inputStyle = input ? getComputedStyle(input) : null;
      const controlStyle = getComputedStyle(element);
      return {
        inputOutlineColor: inputStyle?.outlineColor,
        inputOutlineStyle: inputStyle?.outlineStyle,
        controlBoxShadow: controlStyle.boxShadow,
      };
    });

    expect(
      focusStyles.inputOutlineStyle === "none" ||
        focusStyles.inputOutlineColor === "rgba(0, 0, 0, 0)",
    ).toBe(true);
    expect(focusStyles.controlBoxShadow).toContain("rgba(124, 115, 255, 0.2)");

    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Indicators", exact: true })).toBeFocused();
  });

  test("chart settings renders above the chart and restores focus on Escape", async ({ page }) => {
    const trigger = page.getByRole("button", { name: "Chart settings" });
    await trigger.click();

    const menu = page.getByRole("menu", { name: "Chart settings" });
    await expect(menu).toBeVisible();

    const geometry = await menu.evaluate((element) => {
      const panel = element.closest<HTMLElement>("[data-dropdown-portal]");
      if (!panel) return null;
      const rect = panel.getBoundingClientRect();
      const sampleX = rect.left + rect.width / 2;
      const sampleY = rect.top + Math.min(rect.height / 2, 24);
      const topmost = document.elementFromPoint(sampleX, sampleY);
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        topmostBelongsToMenu: Boolean(topmost && panel.contains(topmost)),
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry?.left).toBeGreaterThanOrEqual(0);
    expect(geometry?.top).toBeGreaterThanOrEqual(0);
    expect(geometry?.right).toBeLessThanOrEqual(geometry?.viewportWidth ?? 0);
    expect(geometry?.bottom).toBeLessThanOrEqual(geometry?.viewportHeight ?? 0);
    expect(geometry?.topmostBelongsToMenu).toBe(true);

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("shared toolbar dropdowns use the collision-safe portal", async ({ page }) => {
    const cases = [
      {
        label: "symbol search",
        width: 300,
        trigger: () => page.getByRole("button", { name: /^EURUSD\b/ }).first(),
      },
      {
        label: "timeframe",
        width: 236,
        trigger: () => page.getByRole("button", { name: "Select interval" }),
      },
      {
        label: "layout",
        width: 230,
        trigger: () => page.getByRole("button", { name: "Layout", exact: true }),
      },
      {
        label: "snapshot",
        width: 238,
        trigger: () => page.getByRole("button", { name: "Take a snapshot" }),
      },
    ];

    for (const item of cases) {
      const trigger = item.trigger();
      await trigger.click();

      const panel = page.locator("[data-dropdown-portal]");
      await expect(panel, `${item.label} portal`).toHaveCount(1);
      await expect(panel, `${item.label} visibility`).toBeVisible();

      const geometry = await panel.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const topmost = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + Math.min(rect.height / 2, 32),
        );
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
          topmostBelongsToPanel: Boolean(topmost && element.contains(topmost)),
        };
      });

      expect(geometry.width, `${item.label} width`).toBeCloseTo(item.width, 0);
      expect(geometry.left, `${item.label} left boundary`).toBeGreaterThanOrEqual(8);
      expect(geometry.top, `${item.label} top boundary`).toBeGreaterThanOrEqual(8);
      expect(geometry.right, `${item.label} right boundary`).toBeLessThanOrEqual(
        geometry.viewportWidth - 8,
      );
      expect(geometry.bottom, `${item.label} bottom boundary`).toBeLessThanOrEqual(
        geometry.viewportHeight - 8,
      );
      expect(geometry.documentOverflow, `${item.label} document overflow`).toBe(0);
      expect(geometry.topmostBelongsToPanel, `${item.label} topmost`).toBe(true);

      await page.keyboard.press("Escape");
      await expect(panel, `${item.label} closes`).toHaveCount(0);
      await expect(trigger, `${item.label} returns focus`).toBeFocused();
    }
  });

  test("current price marker stays inside the live price-scale geometry", async ({ page }) => {
    const chartRoot = page.getByTestId("price-chart-root");
    const priceMarker = page.getByTestId("current-price-marker");
    await expect(chartRoot).toBeVisible();
    await expect(priceMarker).toBeVisible();
    await expect(page.getByTestId("current-price-value")).not.toBeEmpty();
    await expect(page.getByTestId("current-price-countdown")).not.toBeEmpty();
    await expect(priceMarker).toHaveAttribute("data-symbol", "EURUSD");

    await expectMarkerInsidePriceScale(page);

    await page.setViewportSize({ width: 1100, height: 768 });
    await expect(page.locator('[data-platform="desktop"]')).toBeVisible();
    await expect(priceMarker).toBeVisible();
    await expectMarkerInsidePriceScale(page);
  });

  test("Go to exposes only the single-date flow", async ({ page }) => {
    const trigger = page.getByRole("button", { name: "Go to", exact: true });
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Go to" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Custom range", { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("textbox")).toHaveCount(2);
    await expect(dialog.getByRole("button", { name: "Previous month" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Next month" })).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Date" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
