import fs from "node:fs";

const files = {
  bottomPanel: "src/components/layout/BottomPanel.tsx",
  pineEditor: "src/components/pine/PineEditor.tsx",
  chartStore: "src/store/chartStore.ts",
  indicators: "src/services/indicators.ts",
  pineCache: "src/services/pineRuntimeCache.ts",
  pineApi: "src/services/api/resources/pineRuntimeApi.ts",
  indicatorTypes: "src/types/indicators.ts",
  priceChart: "src/components/chart/PriceChart.tsx",
  indicatorLegend: "src/components/chart/IndicatorLegend.tsx",
  indicatorMenu: "src/components/toolbar/IndicatorMenu.tsx",
  indicatorSettings: "src/components/toolbar/IndicatorSettingsDialog.tsx",
  candleViewport: "src/services/candleViewport.ts",
  backendCompiler: "../backend/internal/pineruntime/compiler.go",
  backendBuiltins: "../backend/internal/pineruntime/builtin_runtime.go",
  backendCatalog: "../backend/internal/pineruntime/builtin_sources.go",
  backendStateParser: "../backend/internal/pineruntime/stateful_parser.go",
  backendStateEval: "../backend/internal/pineruntime/stateful_eval.go",
  backendStateRuntime: "../backend/internal/pineruntime/stateful_runtime.go",
  backendJobs: "../backend/internal/pineruntime/runtime_jobs.go",
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, "utf8")]),
);
const statefulSource = source.backendStateParser + source.backendStateEval + source.backendStateRuntime;
const catalogSources = fs
  .readdirSync("../backend/internal/pineruntime/sources")
  .filter((file) => file.endsWith(".pine"));

const checks = [
  {
    name: "Pine Editor is mounted as a bottom-panel tab",
    ok: source.bottomPanel.includes('key: "pine"') && source.bottomPanel.includes("<PineEditor />"),
  },
  {
    name: "Pine script library remains embedded instead of opening a popup",
    ok:
      source.pineEditor.includes("My scripts") &&
      source.pineEditor.includes("filteredScripts.map") &&
      !source.pineEditor.includes("createPortal"),
  },
  {
    name: "Saved scripts and active indicator instances remain separate",
    ok:
      source.chartStore.includes('const PINE_SCRIPTS_KEY = "pineScripts"') &&
      source.chartStore.includes("pineScriptsAtom") &&
      source.chartStore.includes("indicatorsAtom") &&
      source.chartStore.includes("indicator.scriptId === script.id"),
  },
  {
    name: "CUSTOM scripts call the backend compile endpoint and never a browser evaluator",
    ok:
      source.pineCache.includes("compilePineRuntime") &&
      source.pineApi.includes('"pine-runtime/compile"') &&
      source.indicators.includes("getCachedPineIndicatorResult") &&
      !source.indicators.includes("eval(") &&
      !source.indicators.includes("new Function"),
  },
  {
    name: "Every built-in is Pine source routed through the same Compile function",
    ok:
      catalogSources.length === 8 &&
      source.backendCatalog.includes("//go:embed sources/*.pine") &&
      source.backendBuiltins.includes("builtInCompileRequest(req)") &&
      source.backendBuiltins.includes("Compile(ctx, compileRequest)") &&
      !source.backendBuiltins.includes("calculateSMA") &&
      !source.backendBuiltins.includes("calculateFVG"),
  },
  {
    name: "Stateful dispatch is generic and does not match FVG or LuxAlgo identity",
    ok:
      source.backendStateParser.includes("parseStatefulProgram") &&
      source.backendStateEval.includes("executeBlock") &&
      source.backendStateRuntime.includes("statefulSourceCandidate") &&
      !/luxalgo|fair value gap|\bfvg\b/i.test(statefulSource),
  },
  {
    name: "Compiler reports unsupported Pine features instead of silently succeeding",
    ok:
      source.backendCompiler.includes("blockingUnsupportedFeatures") &&
      source.backendCompiler.includes("strategies and broker orders") &&
      source.backendCompiler.includes("multi-symbol data requests") &&
      source.backendCompiler.includes("unsupported visual calls"),
  },
  {
    name: "Pine work uses a bounded worker pool, queue, singleflight, and LRU",
    ok:
      source.backendJobs.includes("defaultRuntimeWorkers") &&
      /queue\s+chan runtimeJobTask/.test(source.backendJobs) &&
      /inflight\s+map/.test(source.backendJobs) &&
      source.backendJobs.includes("storeLocked"),
  },
  {
    name: "Runtime history follows loaded candles up to 5,000 instead of a 300-bar FVG default",
    ok:
      source.pineCache.includes("MAX_RUNTIME_CANDLES = 5_000") &&
      source.pineCache.includes("runtimeCandles") &&
      !source.pineCache.includes("FVG_HISTORY_BARS"),
  },
  {
    name: "Shared settings obtain CUSTOM schemas from the backend runtime",
    ok:
      source.indicatorSettings.includes("getPineRuntimeInputs") &&
      source.indicatorSettings.includes("getPineRuntimeStyles") &&
      source.indicatorSettings.includes("getPineRuntimeMeta") &&
      source.indicatorSettings.includes("StyleGroups") &&
      source.indicatorSettings.includes("CommonStyleOptions"),
  },
  {
    name: "The indicator catalog exposes FVG and user-script source actions",
    ok:
      source.indicatorTypes.includes("| 'FVG'") &&
      source.indicatorMenu.includes("Fair Value Gap [LuxAlgo]") &&
      source.indicatorMenu.includes("deletePineScriptAtom") &&
      source.indicatorMenu.includes("Braces"),
  },
  {
    name: "Chart renderer supports histogram, dynamic baseline fills, and dashboards",
    ok:
      source.priceChart.includes("HistogramSeries") &&
      source.priceChart.includes("BaselineSeries") &&
      source.priceChart.includes("fillBelowBase") &&
      source.priceChart.includes("indicatorDashboards") &&
      source.indicatorTypes.includes("IndicatorDashboard"),
  },
  {
    name: "Sparse future object anchors are guarded during viewport projection",
    ok:
      source.candleViewport.includes("start < points.length") &&
      source.candleViewport.includes("end > 0") &&
      source.candleViewport.includes("reachesLatestCandle"),
  },
  {
    name: "TradingView-style legend controls remain attached to overlay and pane indicators",
    ok:
      source.indicatorLegend.includes("EyeOff") &&
      source.indicatorLegend.includes("Braces") &&
      source.indicatorLegend.includes("Trash2") &&
      source.priceChart.includes("<IndicatorLegend") &&
      source.priceChart.includes("onToggleVisibility"),
  },
];

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  console[check.ok ? "log" : "error"](`${check.ok ? "PASS" : "FAIL"} ${check.name}`);
}
if (failed.length > 0) process.exit(1);
