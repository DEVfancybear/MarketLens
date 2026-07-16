import { expect, test, type Page } from "@playwright/test";

test.use({
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 },
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/push/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/v1/mt5/symbols", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connected: true,
        bridgeUrl: "fixture",
        source: "fixture",
        count: 1,
        streamSymbols: ["EURUSD"],
        symbols: [{
          name: "EURUSD",
          description: "Euro vs US Dollar",
          visible: true,
          digits: 5,
          point: 0.00001,
          spread: 10,
          trade_mode: 4,
        }],
      }),
    });
  });
  await page.goto("/?chartFixture=900&chartFixtureTail=500&chartBenchmarkProfile=phase2", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForFunction(() =>
    Boolean(window.__drawingInteractionTest && window.__chartInteractionTest),
  );
  await page.evaluate(() => window.__drawingInteractionTest?.clear());
});

async function createRectangle(page: Page) {
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await expect(page.locator(".mobile-scrim")).toHaveCount(0);

  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const [start, end] = await page.evaluate((box) => {
    const ratios = Array.from({ length: 9 }, (_, index) => (index + 1) / 10);
    const candidates = ratios.flatMap((xRatio) =>
      ratios.map((yRatio) => ({
        x: box.x + box.width * xRatio,
        y: box.y + box.height * yRatio,
      })),
    );
    const safe = candidates.filter(({ x, y }) => {
      const point = window.__drawingInteractionTest!.inspectClientPoint(x, y);
      return point.insideCanvas && !point.overDrawingUi;
    });
    const first = safe[0];
    const second = safe.find((point) =>
      first && Math.hypot(point.x - first.x, point.y - first.y) >= 48,
    );
    if (!first || !second) throw new Error("No two clear chart points for rectangle fixture");
    return [first, second];
  }, pane);

  await page.touchscreen.tap(start.x, start.y);
  await page.touchscreen.tap(end.x, end.y);
  await expect.poll(async () =>
    (await page.evaluate(() => window.__drawingInteractionTest!.snapshot())).drawings.length,
  ).toBe(1);
}

test("mobile header mark is optically centered on the shared control grid", async ({ page }, testInfo) => {
  const dismissToast = page.getByRole("button", { name: "Dismiss" });
  if (await dismissToast.count()) await dismissToast.first().click();
  await page.locator(".toast-stack").evaluateAll((stacks) => stacks.forEach((stack) => stack.remove()));
  const metrics = await page.locator(".mobile-brand").evaluate((brand) => {
    const mark = brand.querySelector("span")!.getBoundingClientRect();
    const icon = brand.querySelector("svg")!.getBoundingClientRect();
    const avatar = document.querySelector(".mobile-avatar")!.getBoundingClientRect();
    return {
      brand: brand.getBoundingClientRect().toJSON(),
      mark: mark.toJSON(),
      icon: icon.toJSON(),
      avatar: avatar.toJSON(),
    };
  });

  expect(metrics.brand.width).toBe(44);
  expect(metrics.brand.height).toBe(44);
  expect(Math.abs(metrics.icon.x + metrics.icon.width / 2 - (metrics.mark.x + metrics.mark.width / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.icon.y + metrics.icon.height / 2 - (metrics.mark.y + metrics.mark.height / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.brand.y + metrics.brand.height / 2 - (metrics.avatar.y + metrics.avatar.height / 2))).toBeLessThanOrEqual(1);
  await page.locator(".mobile-topbar").screenshot({ path: testInfo.outputPath("mobile-topbar.png") });
});

test("timeframe overflow chevron is centered in its touch target", async ({ page }, testInfo) => {
  const metrics = await page.getByRole("button", { name: "Select interval" }).evaluate((button) => {
    const control = button.getBoundingClientRect();
    const icon = button.querySelector("svg")!.getBoundingClientRect();
    const style = getComputedStyle(button);
    return {
      control: control.toJSON(),
      icon: icon.toJSON(),
      display: style.display,
      paddingInline: style.paddingInline,
    };
  });

  expect(metrics.control.width).toBe(44);
  expect(metrics.control.height).toBe(44);
  expect(metrics.display).toBe("flex");
  expect(metrics.paddingInline).toBe("0px");
  expect(Math.abs(metrics.icon.x + metrics.icon.width / 2 - (metrics.control.x + metrics.control.width / 2))).toBeLessThanOrEqual(.5);
  expect(Math.abs(metrics.icon.y + metrics.icon.height / 2 - (metrics.control.y + metrics.control.height / 2))).toBeLessThanOrEqual(.5);
  await page.locator(".mobile-timeframes").screenshot({ path: testInfo.outputPath("mobile-timeframes.png") });
});

test("drawing settings use an adaptive mobile sheet without distorted controls", async ({ page }, testInfo) => {
  await createRectangle(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Rectangle settings" });
  await expect(dialog).toBeVisible();
  await dialog.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(8);
  expect(box!.x + box!.width).toBeLessThanOrEqual(382);
  expect(box!.y + box!.height).toBeLessThanOrEqual(836);
  expect(box!.height).toBeLessThan(650);

  const checkbox = dialog.locator('button[role="checkbox"]').first();
  const checkboxBox = await checkbox.boundingBox();
  expect(checkboxBox).not.toBeNull();
  expect(Math.abs(checkboxBox!.width - checkboxBox!.height)).toBeLessThanOrEqual(1);

  for (const name of ["Template", "Cancel", "Ok"]) {
    const actionBox = await dialog.getByRole("button", { name, exact: true }).boundingBox();
    expect(actionBox?.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("drawing-settings-mobile.png") });
});

test("drawing settings tabs keep their fields inside the mobile sheet", async ({ page }, testInfo) => {
  await createRectangle(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Rectangle settings" });
  const body = dialog.locator("[data-dialog-body]");

  for (const tab of ["text", "coordinates", "visibility"]) {
    await dialog.getByRole("tab", { name: tab, exact: true }).click();
    await expect(dialog.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
    const metrics = await body.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const controls = Array.from(element.querySelectorAll<HTMLElement>("input, textarea, select, button")).filter((control) => getComputedStyle(control).display !== "none");
      return {
        overflow: element.scrollWidth - element.clientWidth,
        controlsOutside: controls.filter((control) => {
          const box = control.getBoundingClientRect();
          return box.left < rect.left - 1 || box.right > rect.right + 1;
        }).length,
      };
    });
    expect(metrics.overflow).toBeLessThanOrEqual(1);
    expect(metrics.controlsOutside).toBe(0);
    if (tab === "visibility") {
      const intervalTile = dialog.locator('[data-interval-visibility] button[role="checkbox"]').first();
      const intervalTileBox = await intervalTile.boundingBox();
      expect(intervalTileBox).not.toBeNull();
      expect(intervalTileBox!.width).toBeGreaterThan(40);
      expect(intervalTileBox!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: testInfo.outputPath(`drawing-settings-${tab}.png`) });
  }
});

test("adaptive dialog remains reachable at compact portrait and landscape sizes", async ({ page }, testInfo) => {
  for (const viewport of [
    { width: 320, height: 568, name: "compact" },
    { width: 844, height: 390, name: "landscape" },
  ]) {
    await page.setViewportSize(viewport);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() =>
      Boolean(window.__drawingInteractionTest && window.__chartInteractionTest),
    );
    await page.evaluate(() => window.__drawingInteractionTest?.clear());
    await createRectangle(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Rectangle settings" });
    await dialog.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(8);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(box!.y).toBeGreaterThanOrEqual(8);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 8);
    await expect(dialog.getByRole("button", { name: "Ok", exact: true })).toBeVisible();
    if (viewport.width === 320) {
      await dialog.getByRole("button", { name: "Choose color", exact: true }).first().click();
      const popover = page.locator(".mobile-popover:visible");
      const popoverBox = await popover.boundingBox();
      const colorBox = await popover.locator("[data-color-option]").first().boundingBox();
      expect(popoverBox).not.toBeNull();
      expect(popoverBox!.x).toBeGreaterThanOrEqual(12);
      expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(308);
      expect(colorBox?.width).toBe(40);
      expect(colorBox?.height).toBe(40);
      await popover.locator("[data-color-option]").first().click();

      await dialog.getByRole("button", { name: "Template", exact: true }).click();
      const templatePopover = dialog.locator(".mobile-popover:visible");
      const templateBox = await templatePopover.boundingBox();
      expect(templateBox).not.toBeNull();
      expect(templateBox!.x).toBeGreaterThanOrEqual(12);
      expect(templateBox!.x + templateBox!.width).toBeLessThanOrEqual(308);
      expect(templateBox!.y).toBeGreaterThanOrEqual(12);
      expect(templateBox!.y + templateBox!.height).toBeLessThanOrEqual(556);
      await dialog.getByRole("button", { name: "Template", exact: true }).click();
    }
    if (viewport.width === 320) {
      await dialog.getByRole("tab", { name: "coordinates", exact: true }).click();
      const coordinateInputs = dialog.locator("[data-coordinate-editor] section:first-child input");
      const firstInput = await coordinateInputs.nth(0).boundingBox();
      const secondInput = await coordinateInputs.nth(1).boundingBox();
      expect(firstInput).not.toBeNull();
      expect(secondInput).not.toBeNull();
      expect(secondInput!.y).toBeGreaterThan(firstInput!.y + 30);
      await page.screenshot({ path: testInfo.outputPath("drawing-settings-coordinates-compact.png") });
      const styleTab = dialog.getByRole("tab", { name: "style", exact: true });
      await styleTab.focus();
      await styleTab.press("Enter");
      await expect(styleTab).toHaveAttribute("aria-selected", "true");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`drawing-settings-${viewport.name}.png`) });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
});

test("toast and context-menu primitives stay inside compact visual viewports", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => {
    const toast = document.createElement("div");
    toast.dataset.testOverlay = "toast";
    toast.className = "toast-stack pointer-events-none fixed z-[1400] flex w-[356px] max-w-[calc(100vw-1.5rem)] flex-col gap-2.5";
    toast.innerHTML = '<div data-toast class="pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-terminal-border bg-terminal-raised/95 p-3.5 shadow-floating"><div class="min-w-0 flex-1"><strong>Connection restored</strong><p>Prices and alerts are synchronized again.</p></div><button class="toast-close" aria-label="Dismiss">×</button></div>';
    document.body.appendChild(toast);

    const menu = document.createElement("div");
    menu.dataset.testOverlay = "menu";
    menu.className = "context-menu-pop fixed min-w-[260px] overflow-y-auto rounded-xl border border-terminal-border bg-terminal-raised p-1.5";
    menu.style.left = "8px";
    menu.style.top = "72px";
    menu.innerHTML = '<button class="w-full">Action one</button><button class="w-full">Action two</button>';
    document.body.appendChild(menu);

    const checkboxProbe = document.createElement("div");
    checkboxProbe.dataset.testOverlay = "checkbox";
    checkboxProbe.className = "platform-dialog";
    checkboxProbe.innerHTML = '<label data-checkbox-label style="display:flex;align-items:center"><input aria-label="Native checkbox probe" type="checkbox" style="width:18px;height:18px">Keep visible</label>';
    document.body.appendChild(checkboxProbe);
  });

  const toastBox = await page.locator('[data-test-overlay="toast"]').boundingBox();
  const menuBox = await page.locator('[data-test-overlay="menu"]').boundingBox();
  const nativeCheckboxBox = await page.getByRole("checkbox", { name: "Native checkbox probe" }).boundingBox();
  const nativeCheckboxLabelBox = await page.locator("[data-checkbox-label]").boundingBox();
  expect(toastBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(toastBox!.x).toBeGreaterThanOrEqual(8);
  expect(toastBox!.x + toastBox!.width).toBeLessThanOrEqual(312);
  expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(496);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(312);
  await expect(page.locator('[data-test-overlay="menu"] button').first()).toHaveCSS("min-height", "44px");
  expect(nativeCheckboxBox).not.toBeNull();
  expect(Math.abs(nativeCheckboxBox!.width - nativeCheckboxBox!.height)).toBeLessThanOrEqual(1);
  expect(nativeCheckboxBox!.width).toBeGreaterThanOrEqual(16);
  expect(nativeCheckboxBox!.width).toBeLessThanOrEqual(20);
  expect(nativeCheckboxLabelBox?.height).toBeGreaterThanOrEqual(43.5);
});
