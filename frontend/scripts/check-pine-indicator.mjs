import fs from "node:fs";

const files = {
  bottomPanel: "src/components/layout/BottomPanel.tsx",
  pineEditor: "src/components/pine/PineEditor.tsx",
  chartStore: "src/store/chartStore.ts",
  runtimeApi: "src/services/api/resources/indicatorRuntimeApi.ts",
  runtimeCache: "src/services/indicatorRuntimeCache.ts",
  runtimePolicy: "src/services/indicatorRuntimePolicy.ts",
  definitions: "src/services/indicatorDefinitions.ts",
  indicatorTypes: "src/types/indicators.ts",
  priceChart: "src/components/chart/PriceChart.tsx",
  indicatorLegend: "src/components/chart/IndicatorLegend.tsx",
  indicatorMenu: "src/components/toolbar/IndicatorMenu.tsx",
  indicatorSettings: "src/components/toolbar/IndicatorSettingsDialog.tsx",
  chartArea: "src/components/chart/ChartArea.tsx",
  benchmarkFixtures: "src/services/chartBenchmarkFixtures.ts",
  hotkeys: "src/hooks/useHotkeys.ts",
  candleViewport: "src/services/candleViewport.ts",
  backendCompiler: "../backend/internal/pineruntime/compiler.go",
  backendRuntime: "../backend/internal/pineruntime/builtin_runtime.go",
  backendCatalog: "../backend/internal/pineruntime/builtin_sources.go",
  backendHandler: "../backend/internal/pineruntime/handler.go",
  backendModels: "../backend/internal/pineruntime/models.go",
  backendStateParser: "../backend/internal/pineruntime/stateful_parser.go",
  backendStateEval: "../backend/internal/pineruntime/stateful_eval.go",
  backendStateRuntime: "../backend/internal/pineruntime/stateful_runtime.go",
  backendJobs: "../backend/internal/pineruntime/runtime_jobs.go",
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, "utf8")]),
);
const statefulSource = source.backendStateParser + source.backendStateEval + source.backendStateRuntime;
const dynamicFrontend = [
  source.chartStore,
  source.runtimeApi,
  source.runtimeCache,
  source.definitions,
  source.priceChart,
  source.indicatorLegend,
  source.indicatorMenu,
  source.indicatorSettings,
  source.chartArea,
  source.benchmarkFixtures,
  source.hotkeys,
].join("\n");
const catalogSources = fs
  .readdirSync("../backend/internal/pineruntime/sources")
  .filter((file) => file.endsWith(".pine"));

const checks = [
  {
    name: "Pine Editor remains a bottom-panel workspace",
    ok: source.bottomPanel.includes('key: "pine"') && source.bottomPanel.includes("<PineEditor />"),
  },
  {
    name: "Saved scripts and active instances remain separate",
    ok:
      source.chartStore.includes('const PINE_SCRIPTS_KEY = "pineScripts"') &&
      source.chartStore.includes("pineScriptsAtom") &&
      source.chartStore.includes("indicator.scriptId === script.id"),
  },
  {
    name: "One frontend runtime endpoint computes catalog and user-source indicators",
    ok:
      source.runtimeApi.includes('"indicator-runtime/compute"') &&
      source.runtimeApi.includes("sourceCode: config.sourceCode") &&
      source.priceChart.includes("ensureIndicatorRuntimeResult") &&
      !source.priceChart.includes("ensurePineIndicatorResult") &&
      !source.priceChart.includes('type === "CUSTOM"'),
  },
  {
    name: "Catalog, definitions, defaults, and schemas are backend-driven",
    ok:
      source.backendHandler.includes('"/indicator-runtime/catalog"') &&
      source.backendHandler.includes('"/indicator-runtime/definition"') &&
      source.runtimeApi.includes("listIndicatorRuntimeCatalog") &&
      source.definitions.includes("indicatorConfigFromDefinition") &&
      source.indicatorMenu.includes("loadIndicatorCatalog") &&
      source.indicatorSettings.includes("loadIndicatorDefinition"),
  },
  {
    name: "Frontend indicator UI contains no catalog-name dispatch",
    ok:
      !/\b(SMA|EMA|VWAP|RSI|MACD|ADR|FVG|SWING_SR)\b/.test(dynamicFrontend) &&
      !dynamicFrontend.includes("BUILT_IN_INDICATORS") &&
      !dynamicFrontend.includes("defaultIndicator(") &&
      !/switch\s*\([^)]*\.type/.test(dynamicFrontend),
  },
  {
    name: "Every catalog entry and user source reaches the same Compile function",
    ok:
      catalogSources.length > 0 &&
      source.backendCatalog.includes("indicatorCompileRequest") &&
      source.backendRuntime.includes("indicatorCompileRequest(req)") &&
      source.backendRuntime.includes("Compile(ctx, compileRequest)") &&
      !source.backendRuntime.includes("calculateSMA") &&
      !source.backendRuntime.includes("calculateFVG"),
  },
  {
    name: "Stateful compiler dispatch is identity-agnostic",
    ok:
      source.backendStateParser.includes("parseStatefulProgram") &&
      source.backendStateEval.includes("executeBlock") &&
      source.backendStateRuntime.includes("statefulSourceCandidate") &&
      !/luxalgo|fair value gap|\bfvg\b/i.test(statefulSource),
  },
  {
    name: "Runtime work is bounded and cached",
    ok:
      source.backendJobs.includes("defaultRuntimeWorkers") &&
      /queue\s+chan runtimeJobTask/.test(source.backendJobs) &&
      /inflight\s+map/.test(source.backendJobs) &&
      source.backendJobs.includes("storeLocked") &&
      source.runtimeCache.includes("MAX_RUNTIME_CANDLES = 5_000"),
  },
  {
    name: "History requirements come from backend metadata, not browser source parsing",
    ok:
      source.backendModels.includes("RequiresHistoryContext") &&
      source.runtimeCache.includes("definition.requiresHistoryContext") &&
      !source.runtimePolicy.includes("request.security") &&
      !source.runtimeCache.includes("request.security"),
  },
  {
    name: "Legacy split cache and frontend-default files are removed",
    ok:
      !fs.existsSync("src/services/pineRuntimeCache.ts") &&
      !fs.existsSync("src/services/pineRuntimeCachePolicy.ts") &&
      !fs.existsSync("src/services/indicators.ts"),
  },
  {
    name: "Renderer supports generic lines, histograms, fills, labels, and dashboards",
    ok:
      source.priceChart.includes("LineSeries") &&
      source.priceChart.includes("HistogramSeries") &&
      source.priceChart.includes("BaselineSeries") &&
      source.priceChart.includes("indicatorDashboards") &&
      source.indicatorTypes.includes("IndicatorDashboard"),
  },
  {
    name: "Sparse future object anchors remain viewport-safe",
    ok:
      source.candleViewport.includes("start < points.length") &&
      source.candleViewport.includes("end > 0") &&
      source.candleViewport.includes("reachesLatestCandle"),
  },
];

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  console[check.ok ? "log" : "error"](`${check.ok ? "PASS" : "FAIL"} ${check.name}`);
}
if (failed.length > 0) process.exit(1);
