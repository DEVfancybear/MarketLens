import assert from "node:assert/strict";
import { test } from "node:test";

import {
  indicatorConfigFromDefinition,
  indicatorInputsFromConfig,
  indicatorStylesFromConfig,
} from "../../src/services/indicatorDefinitionModel";
import type { IndicatorRuntimeDefinition } from "../../src/services/api/resources/indicatorRuntimeApi";
import type { IndicatorConfig } from "../../src/types";

const definition: IndicatorRuntimeDefinition = {
  type: "backend-owned-key",
  name: "Backend owned indicator",
  shortTitle: "Backend title",
  overlay: false,
  inputs: [{
    key: "nativePeriod",
    title: "Period",
    kind: "int",
    defaultValue: 10,
  }],
  styles: [{
    key: "backend:primary",
    title: "Primary",
    target: "plot",
    group: "Plots",
    defaultVisible: true,
    defaultColor: "#123456",
    defaultLineWidth: 2,
    defaultLineStyle: 0,
    supportsColor: true,
    supportsLineWidth: true,
    supportsLineStyle: true,
  }],
  legacyInputBindings: { nativePeriod: "length" },
  legacyStyleBindings: { "backend:primary.color": "color" },
  requiresHistoryContext: true,
  sourceAvailable: false,
};

test("backend definition creates a complete indicator instance without a type switch", () => {
  const config = indicatorConfigFromDefinition(definition, "instance-1");
  assert.equal(config.type, "backend-owned-key");
  assert.equal(config.name, "Backend title");
  assert.equal(config.separatePane, true);
  assert.equal(config.inputValues?.nativePeriod, 10);
  assert.equal(config.styleValues?.["backend:primary.color"], "#123456");
  assert.equal(config.requiresHistoryContext, true);
});

test("series-color plots do not manufacture a scalar default override", () => {
  const dynamicDefinition: IndicatorRuntimeDefinition = {
    ...definition,
    styles: [{
      ...definition.styles[0],
      key: "plot:palette",
      supportsColor: false,
    }],
  };
  const config = indicatorConfigFromDefinition(dynamicDefinition, "dynamic-color");
  assert.equal(config.styleValues?.["plot:palette.visible"], true);
  assert.equal(config.styleValues?.["plot:palette.color"], undefined);
});

test("backend legacy bindings hydrate old presets while modern values win", () => {
  const oldPreset: IndicatorConfig = {
    id: "legacy",
    type: definition.type,
    visible: true,
    length: 14,
    color: "#abcdef",
  };
  assert.equal(indicatorInputsFromConfig(definition, oldPreset).nativePeriod, 14);
  assert.equal(
    indicatorStylesFromConfig(definition, oldPreset)["backend:primary.color"],
    "#abcdef",
  );

  const modernPreset: IndicatorConfig = {
    ...oldPreset,
    inputValues: { nativePeriod: 21 },
    styleValues: { "backend:primary.color": "#fedcba" },
  };
  assert.equal(indicatorInputsFromConfig(definition, modernPreset).nativePeriod, 21);
  assert.equal(
    indicatorStylesFromConfig(definition, modernPreset)["backend:primary.color"],
    "#fedcba",
  );
});
