import { expect, test, type Page, type Route } from "@playwright/test";

const INITIAL_START = 400;
const FIRST_AVAILABLE_TIME = "2024-01-02T00:00:00.000Z";

function replaySnapshot(
  id: string,
  trackId: string,
  simulatedTime: string,
  rowCount: number,
) {
  return {
    id,
    status: "paused" as const,
    mode: "single_chart" as const,
    generation: 1,
    version: 1,
    lastEventSeq: 0,
    speed: 1,
    replayIntervalSeconds: 900,
    startTime: simulatedTime,
    simulatedTime,
    tracks: [{
      id: trackId,
      slot: 0,
      symbol: "EURUSD",
      provider: "mt5",
      marketCalendar: "forex",
      chartTimeframe: "15m",
      cursorSeq: rowCount,
      visibleThrough: simulatedTime,
      dataset: {
        id: `dataset-${id}`,
        dataKind: "bars" as const,
        sourceTimeframe: "1m",
        baseIntervalSeconds: 60,
        firstAvailableTime: FIRST_AVAILABLE_TIME,
        lastAvailableTime: "2026-07-13T23:59:00.000Z",
        snapshotAt: "2026-07-14T00:00:00.000Z",
        rowCount,
        checksumSha256: id.padEnd(64, "0").slice(0, 64),
        status: "ready" as const,
      },
    }],
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

function replayBars(count: number, startTime: string) {
  const start = Date.parse(startTime);
  return Array.from({ length: count }, (_, index) => {
    const open = 1.1 + index * 0.0001;
    return {
      time: new Date(start + index * 15 * 60_000).toISOString(),
      open,
      high: open + 0.0004,
      low: open - 0.0003,
      close: open + 0.0001,
      volume: 100 + index,
      complete: true,
    };
  });
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  const origin = route.request().headers().origin ?? "http://127.0.0.1:3000";
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    },
    body: JSON.stringify(body),
  });
}

async function installReplayBackend(page: Page) {
  const initial = replaySnapshot(
    "replay-initial",
    "track-initial",
    "2026-07-13T18:05:00.000Z",
    120,
  );
  const firstDay = replaySnapshot(
    "replay-first-day",
    "track-first-day",
    FIRST_AVAILABLE_TIME,
    1,
  );
  const initialBars = replayBars(120, "2026-07-12T12:15:00.000Z");
  const firstDayBars = replayBars(1, FIRST_AVAILABLE_TIME);
  let forkRequestTime: string | null = null;

  await page.routeWebSocket(/\/api\/v1\/replay\/sessions\/[^/]+\/stream/, () => {
    // Keeping the mocked socket open is enough for ReplaySocket.onopen to mark
    // the projection connected; this test does not need streaming events.
  });
  await page.route("**/api/v1/replay/sessions**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === "OPTIONS") {
      await fulfillJson(route, null, 204);
      return;
    }
    if (request.method() === "POST" && path.endsWith("/replay/sessions")) {
      await fulfillJson(route, initial);
      return;
    }
    if (request.method() === "POST" && path.endsWith("/replay/sessions/replay-initial/fork")) {
      forkRequestTime = (request.postDataJSON() as { time?: string }).time ?? null;
      await fulfillJson(route, firstDay);
      return;
    }
    if (request.method() === "GET" && path.endsWith("/replay/sessions/replay-initial")) {
      await fulfillJson(route, initial);
      return;
    }
    if (request.method() === "GET" && path.endsWith("/replay/sessions/replay-first-day")) {
      await fulfillJson(route, firstDay);
      return;
    }
    if (request.method() === "GET" && path.endsWith("/replay/sessions/replay-initial/tracks/track-initial/bars")) {
      await fulfillJson(route, {
        sessionId: initial.id,
        trackId: "track-initial",
        chartTimeframe: "15m",
        cursorSeq: initialBars.length,
        visibleThrough: initial.simulatedTime,
        bars: initialBars,
      });
      return;
    }
    if (request.method() === "GET" && path.endsWith("/replay/sessions/replay-first-day/tracks/track-first-day/bars")) {
      await fulfillJson(route, {
        sessionId: firstDay.id,
        trackId: "track-first-day",
        chartTimeframe: "15m",
        cursorSeq: 1,
        visibleThrough: firstDay.simulatedTime,
        bars: firstDayBars,
      });
      return;
    }
    if (request.method() === "DELETE") {
      await fulfillJson(route, { ...initial, status: "closed" });
      return;
    }
    await fulfillJson(route, { error: { code: "unexpected_test_request", message: path } }, 500);
  });

  return {
    forkRequestTime: () => forkRequestTime,
  };
}

test("active Replay First day keeps one candle readable and never touches a disposed chart", async ({ page }) => {
  const disposedErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (/object is disposed/i.test(error.message)) disposedErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && /object is disposed/i.test(message.text())) {
      disposedErrors.push(message.text());
    }
  });

  const backend = await installReplayBackend(page);
  await page.goto("/?chartFixture=900&chartFixtureTail=500&chartBenchmarkProfile=phase2", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForFunction(() => Boolean(
    window.__replaySelectionTest && window.__chartInteractionTest,
  ));
  await page.evaluate(() => window.__replaySelectionTest!.begin());

  const selector = page.getByRole("slider", { name: "Replay start bar" });
  await expect(selector).toBeVisible();
  await selector.press("Enter");
  await expect(page.getByRole("button", { name: "Select time", exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Select time", exact: true }).first().click();
  await page.getByRole("button", { name: "Select date...", exact: true }).click();
  // Mirror the fork clearing its old track before the new session hydrates.
  // Keeping the chart empty while the session ID changes prevents this test
  // from accidentally accepting a logical range initialized for the old data.
  await page.evaluate((initialStart) => {
    window.dispatchEvent(new CustomEvent("chart-benchmark-replay", {
      detail: { count: initialStart, allowEmpty: true },
    }));
  }, INITIAL_START);
  await expect.poll(async () =>
    page.evaluate(() => window.__chartInteractionTest!.snapshot().candleCount),
  ).toBe(0);

  await page.getByRole("button", { name: "First day", exact: true }).click();
  await expect.poll(backend.forkRequestTime).toBe(FIRST_AVAILABLE_TIME);

  // The first available replay bucket contains one candle. Old code called
  // fitContent() for this empty-to-one transition and stretched it full width.
  await page.evaluate((initialStart) => {
    window.dispatchEvent(new CustomEvent("chart-benchmark-replay", {
      detail: { count: initialStart + 1 },
    }));
  }, INITIAL_START);
  await expect.poll(async () =>
    page.evaluate(() => window.__chartInteractionTest!.snapshot().candleCount),
  ).toBe(1);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));

  await expect.poll(async () => {
    const range = await page.evaluate(() =>
      window.__chartInteractionTest!.snapshot().viewport.logicalRange,
    );
    return range ? Number(range.to) - Number(range.from) : 0;
  }).toBeGreaterThanOrEqual(40);
  await expect.poll(async () =>
    page.evaluate(() => window.__chartInteractionTest!.snapshot().barSpacing),
  ).toBeLessThanOrEqual(32);

  await page.waitForTimeout(250);
  expect.soft(disposedErrors).toEqual([]);
});
