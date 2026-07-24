import assert from "node:assert/strict";
import { test } from "node:test";
import type { IndicatorConfig } from "../../src/types";
import {
  bindIndicatorToChart,
  mergeIndicatorLayoutRegistry,
  rebindIndicatorsToLayout,
  scopeLegacyIndicatorsToChart,
  selectIndicatorsForChart,
  selectIndicatorsForLayout,
} from "../../src/components/chart/indicators/indicatorChartScope";

const main = { layoutId: "layout-a", chartId: "main" };
const secondary = { layoutId: "layout-a", chartId: "chart-2" };

function indicator(id: string): IndicatorConfig {
  return { id, type: "EMA", visible: true };
}

test("indicator chart scopes isolate panes in the same layout", () => {
  const registry = [
    bindIndicatorToChart(indicator("main"), main),
    bindIndicatorToChart(indicator("secondary"), secondary),
  ];

  assert.deepEqual(
    selectIndicatorsForChart(registry, main).map((item) => item.id),
    ["main"],
  );
  assert.deepEqual(
    selectIndicatorsForChart(registry, secondary).map((item) => item.id),
    ["secondary"],
  );
});

test("legacy indicators bind to the chart that loads them", () => {
  const scoped = scopeLegacyIndicatorsToChart([indicator("legacy")], secondary);
  assert.deepEqual(scoped[0].chartScope, secondary);
});

test("layout replacement preserves indicators owned by other layouts", () => {
  const other = bindIndicatorToChart(indicator("other"), {
    layoutId: "layout-b",
    chartId: "main",
  });
  const next = mergeIndicatorLayoutRegistry(
    [bindIndicatorToChart(indicator("old"), main), other],
    [bindIndicatorToChart(indicator("new"), secondary)],
    "layout-a",
  );

  assert.deepEqual(new Set(next.map((item) => item.id)), new Set(["other", "new"]));
  assert.deepEqual(
    selectIndicatorsForLayout(next, "layout-a").map((item) => item.id),
    ["new"],
  );
});

test("save-as rebinds every pane indicator to the new layout identity", () => {
  const rebound = rebindIndicatorsToLayout(
    [
      bindIndicatorToChart(indicator("main"), main),
      bindIndicatorToChart(indicator("secondary"), secondary),
    ],
    { layoutId: "layout-copy", chartId: "main" },
  );
  assert.deepEqual(
    rebound.map((item) => item.chartScope),
    [
      { layoutId: "layout-copy", chartId: "main" },
      { layoutId: "layout-copy", chartId: "chart-2" },
    ],
  );
});
