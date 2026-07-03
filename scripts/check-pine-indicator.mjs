import fs from "node:fs";

const files = {
  bottomPanel: "src/components/layout/BottomPanel.tsx",
  pineEditor: "src/components/pine/PineEditor.tsx",
  chartStore: "src/store/chartStore.ts",
  pineScript: "src/services/pineScript.ts",
  indicators: "src/services/indicators.ts",
  indicatorTypes: "src/types/indicators.ts",
  priceChart: "src/components/chart/PriceChart.tsx",
  indicatorLegend: "src/components/chart/IndicatorLegend.tsx",
  indicatorMenu: "src/components/toolbar/IndicatorMenu.tsx",
  indicatorPane: "src/components/chart/IndicatorPane.tsx",
  indicatorSettings: "src/components/toolbar/IndicatorSettingsDialog.tsx",
  settingsArchitecture: "docs/SETTTING_ARCHITECTURE.md",
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, "utf8")]),
);

const checks = [
  {
    name: "Pine Editor is mounted as a bottom-panel tab",
    ok:
      source.bottomPanel.includes('key: "pine"') &&
      source.bottomPanel.includes("<PineEditor />"),
  },
  {
    name: "Pine script library is embedded in the editor, not rendered as a popup",
    ok:
      source.pineEditor.includes("My scripts") &&
      source.pineEditor.includes("filteredScripts.map") &&
      !source.pineEditor.includes("createPortal") &&
      !source.pineEditor.includes("setPineLibraryOpen"),
  },
  {
    name: "Saved scripts persist separately from active indicator instances",
    ok:
      source.chartStore.includes('const PINE_SCRIPTS_KEY = "pineScripts"') &&
      source.chartStore.includes("pineScriptsAtom") &&
      source.chartStore.includes("indicatorsAtom"),
  },
  {
    name: "Saving a script updates active CUSTOM indicators with the same scriptId",
    ok:
      source.chartStore.includes('indicator.type === "CUSTOM"') &&
      source.chartStore.includes("indicator.scriptId === script.id") &&
      source.chartStore.includes("sourceCode: script.sourceCode"),
  },
  {
    name: "CUSTOM indicators route through the Pine compiler",
    ok:
      source.indicators.includes("case 'CUSTOM'") &&
      source.indicators.includes("computeCustomIndicator(cfg, candles)") &&
      source.pineScript.includes("cfg.inputValues"),
  },
  {
    name: "Pine compiler is whitelist-based and does not execute user JavaScript",
    ok:
      source.pineScript.includes("function evaluateCall") &&
      source.pineScript.includes('case "ta.sma"') &&
      source.pineScript.includes("compilePineScript") &&
      !source.pineScript.includes("eval(") &&
      !source.pineScript.includes("new Function"),
  },
  {
    name: "Pine compiler supports VSA-style columns, ternary palettes, comparisons, and history",
    ok:
      source.pineScript.includes("interface PineCallArg") &&
      source.pineScript.includes('namedCallArg(args, "defval")') &&
      source.pineScript.includes("parseTernary") &&
      source.pineScript.includes("compareValues") &&
      source.pineScript.includes("logicalValues") &&
      source.pineScript.includes("shiftValue") &&
      source.pineScript.includes("evaluateRecursiveAssignment") &&
      source.pineScript.includes("style_(columns|histogram)") &&
      source.pineScript.includes("colorSeries"),
  },
  {
    name: "Pine color constants match TradingView-style VSA palette",
    ok:
      source.pineScript.includes('"color.purple": "#9c27b0"') &&
      source.pineScript.includes('"color.red": "#f44336"') &&
      source.pineScript.includes('"color.orange": "#ff9800"') &&
      source.pineScript.includes('"color.green": "#4caf50"') &&
      source.pineScript.includes('"color.blue": "#2196f3"') &&
      source.pineScript.includes('"color.silver": "#b2b5be"'),
  },
  {
    name: "Indicator renderers support histogram series and per-bar colors",
    ok:
      source.indicatorPane.includes('s.type === "histogram"') &&
      source.indicatorPane.includes("p.color") &&
      source.indicatorPane.includes("p.value >= 0") &&
      source.priceChart.includes('s.type === "histogram"'),
  },
  {
    name: "Separate-pane histograms preserve Pine per-bar colors before fallback",
    ok:
      source.indicatorPane.includes("color: p.color") &&
      source.indicatorPane.includes("p.value >= 0") &&
      !source.indicatorPane.includes("p.color ??"),
  },
  {
    name: "Separate-pane indicators reuse series instead of recreating on every candle",
    ok:
      source.indicatorPane.includes("seriesRef") &&
      source.indicatorPane.includes("seriesSignature") &&
      source.indicatorPane.includes("chart.removeSeries(series)") &&
      source.indicatorPane.includes("series.setData("),
  },
  {
    name: "Pine compiler supports Better RSI v3 hlines, fills, and block if expressions",
    ok:
      source.pineScript.includes('case "rsi"') &&
      source.pineScript.includes('case "color"') &&
      source.pineScript.includes("readHlines") &&
      source.pineScript.includes("readFills") &&
      source.pineScript.includes("parsePineIfExpression") &&
      source.pineScript.includes("evaluateSelfReferentialAssignment") &&
      source.pineScript.includes("scalarValueAt") &&
      source.pineScript.includes("isLineBreakStyle") &&
      source.pineScript.includes("baselineFill") &&
      source.pineScript.includes("flatLinePoints") &&
      source.pineScript.includes("FLAT_LINE_RIGHT_EXTENSION_BARS") &&
      source.pineScript.includes("candleStepSeconds") &&
      source.pineScript.includes("topLevelEquals") &&
      source.indicatorPane.includes("addBaselineSeries") &&
      source.indicatorPane.includes("color: p.color"),
  },
  {
    name: "CUSTOM indicator settings use the shared Pine input schema dialog",
    ok:
      source.indicatorTypes.includes("inputValues?: IndicatorInputValues") &&
      source.pineScript.includes("export function extractPineInputDefinitions") &&
      source.pineScript.includes("inputOverrides") &&
      source.indicatorSettings.includes("extractPineInputDefinitions") &&
      source.indicatorSettings.includes("defaultInputValues") &&
      source.indicatorLegend.includes("extractPineInputDefinitions") &&
      source.priceChart.includes("setEditingIndicator(indicator.id)") &&
      source.indicatorPane.includes("setEditingIndicator(cfg.id)") &&
      source.indicatorPane.includes("onSource={openSource}") &&
      source.indicatorPane.includes('setBottomTab("pine")') &&
      !source.indicatorSettings.includes('if (indicator?.type === "CUSTOM") setEditingIndicator(null)') &&
      source.settingsArchitecture.includes("Do not build one settings dialog per indicator") &&
      source.settingsArchitecture.includes("IndicatorConfig.inputValues") &&
      source.settingsArchitecture.includes("EvalContext.inputOverrides"),
  },
  {
    name: "Indicator menu uses a TradingView-style browser modal",
    ok:
      source.indicatorMenu.includes("createPortal") &&
      source.indicatorMenu.includes("ChartNoAxesCombined") &&
      source.indicatorMenu.includes("Indicators, metrics, and strategies") &&
      source.indicatorMenu.includes("Favorites") &&
      source.indicatorMenu.includes("My scripts") &&
      source.indicatorMenu.includes("grid-cols-[minmax(220px,1fr)_124px_88px]"),
  },
  {
    name: "My scripts indicator browser supports source and delete confirmation actions",
    ok:
      source.indicatorMenu.includes("deletePineScriptAtom") &&
      source.indicatorMenu.includes("Braces") &&
      source.indicatorMenu.includes("Trash2") &&
      source.indicatorMenu.includes("Script name") &&
      source.indicatorMenu.includes("Delete this script?") &&
      source.indicatorMenu.includes("permanently delete your"),
  },
  {
    name: "Pine compiler supports generic Pine object-style overlay rendering",
    ok:
      source.pineScript.includes("compilePineObjectRuntime") &&
      source.pineScript.includes("evaluateRequestSecurityExpression") &&
      source.pineScript.includes("evaluateInputExpression") &&
      source.pineScript.includes("objectCreationCalls") &&
      source.pineScript.includes("request.security") &&
      source.pineScript.includes("line.new") &&
      source.pineScript.includes("box.new") &&
      source.pineScript.includes("label.new") &&
      source.pineScript.includes("table.new") &&
      source.pineScript.includes("table.cell") &&
      source.pineScript.includes("aggregateTimeframeCandles") &&
      source.pineScript.includes("timeframe.change") &&
      source.pineScript.includes("objectLinePointsFromCoords") &&
      source.pineScript.includes("objectXTime") &&
      source.pineScript.includes("label.style_label_left") &&
      source.indicatorTypes.includes("backgroundColor?: string") &&
      source.priceChart.includes("function labelBackground") &&
      source.pineScript.includes("barstate.isfirst") &&
      source.pineScript.includes("last_bar_index") &&
      source.pineScript.includes("OBJECT_RIGHT_EXTENSION_BARS") &&
      !source.pineScript.includes("compileAdrObjectScript") &&
      source.priceChart.includes("IndicatorOverlay") &&
      source.priceChart.includes("indicatorDashboards") &&
      source.priceChart.includes("priceToCoordinate(label.price)") &&
      source.priceChart.includes("leftClip") &&
      source.priceChart.includes("if (x < leftClip) return []") &&
      source.indicatorTypes.includes("IndicatorDashboard"),
  },
  {
    name: "Price chart renders TradingView-style overlay indicator controls",
    ok:
      source.indicatorLegend.includes("export function IndicatorLegend") &&
      source.indicatorLegend.includes("EyeOff") &&
      source.indicatorLegend.includes("Braces") &&
      source.indicatorLegend.includes("Trash2") &&
      source.indicatorLegend.includes("indicatorLegendTitle") &&
      source.priceChart.includes("updateIndicatorAtom") &&
      source.priceChart.includes("removeIndicatorAtom") &&
      source.priceChart.includes("loadPineScriptAtom") &&
      source.priceChart.includes("<IndicatorLegend") &&
      source.indicatorPane.includes("<IndicatorLegend") &&
      source.indicatorLegend.includes("onToggleVisibility") &&
      source.indicatorLegend.includes("onRemove(indicator.id)"),
  },
];

const failed = checks.filter((check) => !check.ok);

if (failed.length > 0) {
  for (const check of failed) {
    console.error(`FAIL ${check.name}`);
  }
  process.exit(1);
}

for (const check of checks) {
  console.log(`PASS ${check.name}`);
}
