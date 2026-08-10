import { expect, test } from "@playwright/test";

test("a stale pending MT5 window never reaches the chart before the authoritative window", async ({
  page,
}) => {
  const step = 15 * 60;
  const firstTime = 1_704_067_200;
  const candles = Array.from({ length: 3 }, (_, index) => {
    const open = 1.08 + index * 0.001;
    return {
      time: firstTime + index * step,
      open,
      high: open + 0.0008,
      low: open - 0.0004,
      close: open + 0.0003,
      volume: 100 + index,
    };
  });
  let historyRequests = 0;
  let releaseAuthoritative!: () => void;
  const authoritativeReleased = new Promise<void>((resolve) => {
    releaseAuthoritative = resolve;
  });

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
  await page.route("**/api/v1/mt5/history?*", async (route) => {
    historyRequests += 1;
    if (historyRequests === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          connected: true,
          source: "playwright-stale-cache",
          symbol: "EURUSD",
          timeframe: "15m",
          candles: candles.slice(0, 2),
          stale: true,
          refreshPending: true,
          freshnessKnown: true,
          lastBarTime: candles[1]!.time,
          minimumFreshBarTime: candles[2]!.time,
        }),
      });
      return;
    }

    await authoritativeReleased;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connected: true,
        source: "playwright-authoritative",
        symbol: "EURUSD",
        timeframe: "15m",
        candles,
        freshnessKnown: true,
        lastBarTime: candles[2]!.time,
        minimumFreshBarTime: candles[2]!.time,
      }),
    });
  });
  await page.route("**/api/v1/indicator-runtime/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        route.request().url().endsWith("/catalog")
          ? { indicators: [], errors: [] }
          : { result: { id: "fixture", series: [] }, errors: [] },
      ),
    });
  });

  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__chartInteractionTest));
  await expect.poll(() => historyRequests).toBeGreaterThanOrEqual(2);

  const intermediateCounts = await page.evaluate(async () => {
    const counts: number[] = [];
    for (let frame = 0; frame < 12; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      counts.push(window.__chartInteractionTest?.snapshot().candleCount ?? -1);
    }
    return counts;
  });
  expect(intermediateCounts.every((count) => count === 0)).toBe(true);

  releaseAuthoritative();
  await expect.poll(() =>
    page.evaluate(() => window.__chartInteractionTest?.snapshot().candleCount ?? 0)
  ).toBe(candles.length);
  const settled = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  expect(settled.viewport.programmaticWrites).toBe(1);
  expect(settled.viewport.cause).toBe("market-change");
});
