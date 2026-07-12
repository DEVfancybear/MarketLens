import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseURL = process.env.RESPONSIVE_TEST_URL ?? "http://127.0.0.1:3000";
const outputDir = ".runtime-logs/responsive-ui";

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });

async function withViewport(name, viewport, check) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  try {
    await page.goto(baseURL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator('[aria-label="Chart workspace"]').waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await check(page);
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      page: document.documentElement.scrollWidth,
    }));
    assert.ok(
      dimensions.page <= dimensions.viewport,
      `${name}: page width ${dimensions.page}px exceeds viewport ${dimensions.viewport}px`,
    );
    await page.screenshot({
      path: `${outputDir}/${name}.png`,
      fullPage: true,
    });
    console.log(`PASS ${name}`);
  } finally {
    await context.close();
  }
}

try {
  await withViewport("phone-light-390x844", { width: 390, height: 844 }, async (page) => {
    const nav = page.getByRole("navigation", { name: "Mobile workspace" });
    await nav.waitFor({ state: "visible" });

    await nav.getByRole("button", { name: "Draw" }).click();
    await page.getByRole("complementary", { name: "Drawing tools" }).waitFor();
    await page.getByRole("button", { name: "Close drawing tools" }).click();

    await nav.getByRole("button", { name: "Watch" }).click();
    await page.getByRole("button", { name: "Close watchlist" }).click();

    await page.getByRole("button", { name: /Theme: dark/i }).click();
    await page.locator("html.theme-light").waitFor();
    await page.getByRole("button", { name: /Theme: light/i }).waitFor();
  });

  await withViewport("tablet-portrait-768x1024", { width: 768, height: 1024 }, async (page) => {
    const nav = page.getByRole("navigation", { name: "Mobile workspace" });
    await nav.waitFor({ state: "visible" });
    await nav.getByRole("button", { name: "Replay" }).click();
    await page.getByRole("region", { name: "replay panel" }).waitFor();
    await page.getByRole("button", { name: "Close panel" }).waitFor();
  });

  await withViewport("desktop-1366x768", { width: 1366, height: 768 }, async (page) => {
    assert.equal(
      await page.getByRole("navigation", { name: "Mobile workspace" }).count(),
      0,
      "desktop: mobile workspace must not render",
    );
    await page.getByLabel("Cursor").waitFor({ state: "visible" });
  });
} finally {
  await browser.close();
}
