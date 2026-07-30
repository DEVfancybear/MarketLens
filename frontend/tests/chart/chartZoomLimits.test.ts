import assert from "node:assert/strict";
import { test } from "node:test";
import type { IChartApi } from "lightweight-charts";

import {
  DEEP_ZOOM_MIN_VISIBLE_SLOTS,
  applyResponsiveMaxBarSpacing,
  responsiveMaxBarSpacing,
} from "../../src/components/chart/chartZoomLimits";

test("deep zoom derives one responsive limit for mobile and desktop widths", () => {
  for (const plotWidth of [246, 606, 1_026, 1_846]) {
    const spacing = responsiveMaxBarSpacing(plotWidth);
    assert.equal(spacing, plotWidth / DEEP_ZOOM_MIN_VISIBLE_SLOTS);
  }

  assert.notEqual(
    responsiveMaxBarSpacing(246),
    responsiveMaxBarSpacing(1_026),
  );
  assert.equal(responsiveMaxBarSpacing(0), null);
  assert.equal(responsiveMaxBarSpacing(Number.NaN), null);
});

test("responsive limit uses the live plot width and avoids redundant writes", () => {
  let paneWidth = 1_100;
  let configuredMax = 0;
  let writes = 0;
  const chart = {
    panes: () => [{
      getHTMLElement: () => ({
        getBoundingClientRect: () => ({ width: paneWidth }),
      }),
    }],
    priceScale: () => ({ width: () => 74 }),
    timeScale: () => ({
      options: () => ({ maxBarSpacing: configuredMax }),
      applyOptions: ({ maxBarSpacing }: { maxBarSpacing: number }) => {
        configuredMax = maxBarSpacing;
        writes += 1;
      },
    }),
  } as unknown as IChartApi;

  const desktopLimit = applyResponsiveMaxBarSpacing(chart);
  assert.notEqual(desktopLimit, null);
  assert.equal(configuredMax, desktopLimit);
  assert.equal(writes, 1);

  applyResponsiveMaxBarSpacing(chart);
  assert.equal(writes, 1);

  paneWidth = 390;
  const mobileLimit = applyResponsiveMaxBarSpacing(chart);
  assert.notEqual(mobileLimit, null);
  assert.equal(configuredMax, mobileLimit);
  assert.equal(writes, 2);
  assert.notEqual(mobileLimit, desktopLimit);
});
