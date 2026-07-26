import { expect, test, type Page, type Route } from "@playwright/test";

interface RequestedTrack {
  slot: number;
  symbol: string;
  chartTimeframe: string;
  required?: boolean;
}

interface ReplayCreateRequest {
  mode: "single_chart" | "all_charts";
  start: { kind: "time"; time: string };
  tracks: RequestedTrack[];
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

function replaySnapshot(input: ReplayCreateRequest) {
  return {
    id: "replay-multi",
    status: "paused" as const,
    mode: "all_charts" as const,
    generation: 1,
    version: 1,
    lastEventSeq: 0,
    speed: 1,
    replayIntervalSeconds: 900,
    startTime: input.start.time,
    simulatedTime: input.start.time,
    tracks: input.tracks.map((track) => ({
      id: `track-${track.slot}`,
      slot: track.slot,
      symbol: track.symbol,
      provider: "mt5",
      marketCalendar: `mt5:${track.symbol}:UTC`,
      chartTimeframe: track.chartTimeframe,
      cursorSeq: 4,
      visibleThrough: input.start.time,
      dataset: {
        id: `dataset-${track.slot}`,
        dataKind: "bars" as const,
        sourceTimeframe: "1m",
        baseIntervalSeconds: 60,
        firstAvailableTime: "2024-01-01T00:00:00.000Z",
        lastAvailableTime: "2026-07-26T00:00:00.000Z",
        snapshotAt: "2026-07-26T00:00:00.000Z",
        rowCount: 5,
        checksumSha256: String(track.slot).repeat(64),
        status: "ready" as const,
      },
    })),
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
  };
}

function replayBars(simulatedTime: string, slot: number) {
  const end = Date.parse(simulatedTime);
  return Array.from({ length: 5 }, (_, index) => {
    const open = 1 + slot * 0.1 + index * 0.001;
    return {
      time: new Date(end - (4 - index) * 15 * 60_000).toISOString(),
      open,
      high: open + 0.002,
      low: open - 0.002,
      close: open + 0.001,
      volume: 100 + index,
      complete: true,
    };
  });
}

async function openLayoutMenu(page: Page) {
  await page.getByRole("button", { name: "Layout", exact: true }).click();
}

test("multi-chart Replay isolates an unavailable sibling without shifting pane slots", async ({ page }) => {
  const createRequests: ReplayCreateRequest[] = [];
  let snapshot: ReturnType<typeof replaySnapshot> | null = null;

  await page.route("**/api/v1/mt5/symbols", async (route) => {
    await fulfillJson(route, {
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
    });
  });
  await page.route("**/api/v1/mt5/history?*", async (route) => {
    const lastFixtureOpen = 1_704_067_200 + 899 * 60;
    const candles = Array.from({ length: 200 }, (_, index) => {
      const time = lastFixtureOpen - (199 - index) * 15 * 60;
      const open = 1.08 + index * 0.00005;
      return {
        time,
        open,
        high: open + 0.00008,
        low: open - 0.00004,
        close: open + 0.00003,
        volume: 100 + index,
      };
    });
    await fulfillJson(route, {
      connected: true,
      bridgeUrl: "playwright",
      source: "playwright",
      symbol: "EURUSD",
      timeframe: "15m",
      candles,
      hasMore: true,
    });
  });
  await page.routeWebSocket(/\/api\/v1\/replay\/sessions\/[^/]+\/stream/, () => {
    // The open socket is sufficient for connection state in this create flow.
  });
  await page.route("**/api/v1/replay/sessions**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") {
      await fulfillJson(route, null, 204);
      return;
    }
    if (request.method() === "POST" && path.endsWith("/replay/sessions")) {
      const input = request.postDataJSON() as ReplayCreateRequest;
      createRequests.push(input);
      if (createRequests.length === 1) {
        await fulfillJson(route, {
          error: {
            code: "data_point_unavailable",
            message: "the requested replay data point is unavailable",
            details: {
              slot: 0,
              symbol: input.tracks[0]?.symbol,
              chartTimeframe: input.tracks[0]?.chartTimeframe,
              firstAvailableTime: "2024-08-05T02:11:00.000Z",
              lastAvailableTime: "2024-08-08T13:39:00.000Z",
            },
          },
        }, 422);
        return;
      }
      snapshot = replaySnapshot(input);
      await fulfillJson(route, snapshot, 202);
      return;
    }
    if (request.method() === "GET" && path.endsWith("/replay/sessions/replay-multi")) {
      await fulfillJson(route, snapshot);
      return;
    }
    const barsMatch = path.match(/\/tracks\/track-(\d+)\/bars$/);
    if (request.method() === "GET" && barsMatch && snapshot) {
      const slot = Number(barsMatch[1]);
      await fulfillJson(route, {
        sessionId: snapshot.id,
        trackId: `track-${slot}`,
        chartTimeframe: "15m",
        cursorSeq: 4,
        visibleThrough: snapshot.simulatedTime,
        bars: replayBars(snapshot.simulatedTime, slot),
      });
      return;
    }
    if (request.method() === "DELETE") {
      await fulfillJson(route, snapshot ? { ...snapshot, status: "closed" } : {});
      return;
    }
    await fulfillJson(route, {
      error: { code: "unexpected_test_request", message: path },
    }, 500);
  });

  await page.goto("/?chartFixture=900&chartFixtureTail=500&chartBenchmarkProfile=phase2", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await expect(page.locator('[data-platform="desktop"]')).toBeVisible({ timeout: 45_000 });
  await openLayoutMenu(page);
  await page.getByRole("menuitemradio", { name: /Grid 2/ }).click();
  await expect(page.locator('[data-chart-layout="grid_2x2"] [data-chart-slot]')).toHaveCount(4);
  await page.getByRole("button", { name: /^Activate chart 3:/ }).click();

  await page.waitForFunction(() => Boolean(window.__replaySelectionTest));
  await page.evaluate(() => window.__replaySelectionTest!.begin());
  const selector = page.getByRole("slider", { name: "Replay start bar" });
  await expect(selector).toBeVisible();
  await selector.press("Enter");

  await expect.poll(() => createRequests.length).toBe(2);
  expect(createRequests[0]?.tracks.map((track) => track.slot)).toEqual([0, 1, 2, 3]);
  expect(
    createRequests[0]?.tracks.filter((track) => track.required).map((track) => track.slot),
  ).toEqual([2]);
  expect(createRequests[1]?.tracks.map((track) => track.slot)).toEqual([1, 2, 3]);

  await expect(page.getByTestId("replay-live-track-warning")).toContainText("remain live");
  await expect(page.locator('[data-chart-slot="2"]')).toHaveAttribute(
    "data-active-chart",
    "true",
  );
});
