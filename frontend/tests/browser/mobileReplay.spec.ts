import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __replaySelectionTest?: {
      begin: (mode?: "selecting" | "reselecting") => void;
      cancel: () => void;
      dropSession: () => void;
      snapshot: () => {
        active: boolean;
        candidateCount: number;
        previewIndex: number | null;
        selection: string;
      };
    };
  }
}

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
  await page.goto("/?chartFixture=900&chartFixtureTail=500&chartBenchmarkProfile=phase2", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForFunction(() => Boolean(window.__replaySelectionTest));
  await expect.poll(async () =>
    page.evaluate(() => window.__replaySelectionTest!.snapshot().candidateCount),
  ).toBeGreaterThan(10);
});

test("mobile Replay exposes an immediate line and touch scrub selector", async ({ page }) => {
  await page.evaluate(() => window.__replaySelectionTest!.begin());
  await expect.poll(async () =>
    page.evaluate(() => window.__replaySelectionTest!.snapshot().active),
  ).toBe(true);

  const selector = page.getByRole("slider", { name: "Replay start bar" });
  await expect(selector).toBeVisible();
  await expect(selector).toHaveAttribute("aria-valuetext", /\d/);
  const initialIndex = Number(await selector.getAttribute("aria-valuenow"));
  const candidateCount = await page.evaluate(() =>
    window.__replaySelectionTest!.snapshot().candidateCount,
  );
  expect(initialIndex).toBeGreaterThanOrEqual(0);
  expect(initialIndex).toBeLessThan(candidateCount);
  await expect.poll(async () => selector.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (!context || canvas.width === 0 || canvas.height === 0) return 0;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0) painted++;
    }
    return painted;
  })).toBeGreaterThan(0);
  const backingScale = await selector.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    return {
      x: canvas.width / rect.width,
      y: canvas.height / rect.height,
    };
  });
  expect(backingScale.x).toBeGreaterThanOrEqual(2.9);
  expect(backingScale.y).toBeGreaterThanOrEqual(2.9);

  const hud = page.locator("[data-mobile-replay-selection]");
  await expect(hud).toBeVisible();
  await expect(hud.getByText("Select Replay bar", { exact: true })).toBeVisible();
  await expect(page.locator(".mobile-chart-actions")).toHaveCount(0);

  const box = await selector.boundingBox();
  expect(box).not.toBeNull();
  await selector.dispatchEvent("pointerdown", {
    pointerId: 71,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: box!.x + box!.width * 0.2,
    clientY: box!.y + box!.height * 0.5,
  });
  await expect.poll(async () => Number(await selector.getAttribute("aria-valuenow")))
    .not.toBe(initialIndex);
  const primaryIndex = Number(await selector.getAttribute("aria-valuenow"));
  await selector.dispatchEvent("pointermove", {
    pointerId: 72,
    pointerType: "touch",
    isPrimary: false,
    button: 0,
    clientX: box!.x + box!.width * 0.9,
    clientY: box!.y + box!.height * 0.5,
  });
  await expect(selector).toHaveAttribute("aria-valuenow", String(primaryIndex));
  await selector.dispatchEvent("pointermove", {
    pointerId: 71,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: box!.x + box!.width * 0.35,
    clientY: box!.y + box!.height * 0.5,
  });
  await expect.poll(async () => Number(await selector.getAttribute("aria-valuenow")))
    .not.toBe(primaryIndex);
  await selector.dispatchEvent("pointercancel", {
    pointerId: 71,
    pointerType: "touch",
    isPrimary: true,
  });

  const undersized = await hud.locator("button").evaluateAll((buttons) =>
    buttons
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      })
      .filter((target) => target.width < 44 || target.height < 44),
  );
  expect(undersized).toEqual([]);

  await selector.press("End");
  const finalIndex = Number(await selector.getAttribute("aria-valuemax"));
  await expect(selector).toHaveAttribute("aria-valuenow", String(finalIndex));
  await selector.press("ArrowLeft");
  await expect(selector).toHaveAttribute("aria-valuenow", String(finalIndex - 1));

  await page.evaluate(() => window.__replaySelectionTest!.cancel());
  await expect(page.getByRole("slider", { name: "Replay start bar" })).toHaveCount(0);
  await expect(page.locator("[data-replay-selection-canvas]")).toHaveAttribute("aria-hidden", "true");
});

test("mobile Replay selector stays operable in compact landscape", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => window.__replaySelectionTest!.begin("reselecting"));

  const selector = page.getByRole("slider", { name: "Replay start bar" });
  const hud = page.locator("[data-mobile-replay-selection]");
  await expect(selector).toBeVisible();
  await expect(hud).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  const box = await hud.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(390);

  await page.evaluate(() => window.__replaySelectionTest!.cancel());
});

test("mobile Replay exits selection cleanly when the session expires", async ({ page }) => {
  await page.evaluate(() => window.__replaySelectionTest!.begin());
  await expect(page.getByRole("slider", { name: "Replay start bar" })).toBeVisible();

  await page.evaluate(() => window.__replaySelectionTest!.dropSession());

  await expect.poll(async () =>
    page.evaluate(() => window.__replaySelectionTest!.snapshot().selection),
  ).toBe("idle");
  await expect(page.locator(".mobile-chart-actions")).toBeVisible();
  await expect(page.locator("[data-mobile-replay-selection]")).toHaveCount(0);
});

test("a real mobile touch tap commits one Replay request", async ({ page }) => {
  let createRequests = 0;
  await page.route("**/api/v1/replay/sessions", async (route) => {
    createRequests++;
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ message: "Deliberate mobile Replay test rejection" }),
    });
  });
  await page.evaluate(() => window.__replaySelectionTest!.begin());

  const selector = page.getByRole("slider", { name: "Replay start bar" });
  await expect(selector).toBeVisible();
  const box = await selector.boundingBox();
  expect(box).not.toBeNull();
  await page.touchscreen.tap(
    box!.x + box!.width * 0.4,
    box!.y + box!.height * 0.45,
  );

  await expect.poll(() => createRequests).toBe(1);
  await expect(selector).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Market replay" })).toBeVisible();
});
