import assert from "node:assert/strict";
import { test } from "node:test";

import { groupIndicatorInputRows } from "../../src/components/toolbar/indicatorSettingsInputRows";
import type { PineInputDefinition } from "../../src/services/pineRuntimeTypes";

function input(
  key: string,
  title: string,
  inline: string,
  kind: PineInputDefinition["kind"] = "string",
): PineInputDefinition {
  return {
    key,
    title,
    kind,
    defaultValue: kind === "bool" ? true : "",
    group: "Simple Moving averages",
    inline,
  };
}

test("indicator inputs with the same Pine inline key render as one settings row", () => {
  const groups = groupIndicatorInputRows([
    input("plot_ma_1", "MA 1", "ma1", "bool"),
    input("ma_1_type", "", "ma1"),
    input("ma_1_val", "", "ma1", "int"),
    input("ma1_res", "", "ma1"),
    input("ma_1_colour", "", "ma1", "color"),
    input("plot_ma_2", "MA 2", "ma2", "bool"),
    input("ma_2_type", "", "ma2"),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows.length, 2);
  assert.deepEqual(
    groups[0].rows.map((row) => row.fields.map((field) => field.key)),
    [
      ["plot_ma_1", "ma_1_type", "ma_1_val", "ma1_res", "ma_1_colour"],
      ["plot_ma_2", "ma_2_type"],
    ],
  );
});
