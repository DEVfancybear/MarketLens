import assert from "node:assert/strict";
import test from "node:test";

import {
  alertOwnerChartId,
  selectAlertsForChart,
} from "../../src/services/alertChartScope";
import { alertLineRegistryKey } from "../../src/components/chart/alertLineRegistry";
import type { Alert } from "../../src/store/alertStore";
import type { ChartPaneState } from "../../src/store/replayLayoutStore";

const panes: ChartPaneState[] = [
  {
    id: "main",
    slot: 0,
    symbol: "EURUSD",
    timeframe: "15m",
    initialized: true,
  },
  {
    id: "chart-2",
    slot: 1,
    symbol: "EURUSD",
    timeframe: "1H",
    initialized: true,
  },
  {
    id: "chart-3",
    slot: 2,
    symbol: "GBPUSD",
    timeframe: "15m",
    initialized: true,
  },
  {
    id: "chart-4",
    slot: 3,
    symbol: "XAUUSD",
    timeframe: "15m",
    initialized: true,
  },
];

function alert(id: string, symbol = "EURUSD"): Alert {
  return {
    id,
    symbol,
    condition: "above",
    price: 1.1,
    status: "active",
    enabled: true,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    armingRevision: 1,
    recurring: false,
    sound: true,
    browser: false,
    push: false,
    telegram: false,
    discord: false,
  };
}

test("explicit alert ownership keeps a line on its source chart", () => {
  const source = alert("alert-1");
  const owners = { "alert-1": "main" };
  assert.equal(
    alertOwnerChartId(source, panes, "grid_2x2", owners),
    "main",
  );
  assert.deepEqual(
    selectAlertsForChart([source], {
      chartId: "chart-2",
      symbol: "EURUSD",
      panes,
      preset: "grid_2x2",
      owners,
    }),
    [],
  );
  assert.deepEqual(
    selectAlertsForChart([source], {
      chartId: "main",
      symbol: "EURUSD",
      panes,
      preset: "grid_2x2",
      owners,
    }),
    [source],
  );
});

test("legacy alerts get a stable first matching pane and registry keys stay chart-local", () => {
  const legacy = alert("legacy");
  assert.equal(
    alertOwnerChartId(legacy, panes, "grid_2x2", {}),
    "main",
  );
  assert.notEqual(
    alertLineRegistryKey("main", legacy.id),
    alertLineRegistryKey("chart-2", legacy.id),
  );
});
