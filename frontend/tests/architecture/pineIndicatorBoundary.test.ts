import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const files = {
  bottomPanel: "src/components/layout/BottomPanel.tsx",
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
} as const;

type SourceKey = keyof typeof files;
const source = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [
    key,
    readFileSync(resolve(root, file), "utf8"),
  ]),
) as Record<SourceKey, string>;

const statefulSource =
  source.backendStateParser +
  source.backendStateEval +
  source.backendStateRuntime;
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

test("Pine editor and saved-script ownership remain separated", () => {
  assert.match(source.bottomPanel, /key: "pine"/);
  assert.match(source.bottomPanel, /<PineEditor \/>/);
  assert.match(source.chartStore, /const PINE_SCRIPTS_KEY = "pineScripts"/);
  assert.match(source.chartStore, /\bpineScriptsAtom\b/);
  assert.match(source.chartStore, /indicator\.scriptId === script\.id/);
});

test("catalog and user indicators share the backend runtime", () => {
  assert.match(source.runtimeApi, /"indicator-runtime\/compute"/);
  assert.match(source.runtimeApi, /sourceCode: config\.sourceCode/);
  assert.match(source.priceChart, /\bensureIndicatorRuntimeResult\b/);
  assert.doesNotMatch(source.priceChart, /\bensurePineIndicatorResult\b/);
  assert.doesNotMatch(source.priceChart, /type === "CUSTOM"/);

  assert.match(source.backendHandler, /"\/indicator-runtime\/catalog"/);
  assert.match(source.backendHandler, /"\/indicator-runtime\/definition"/);
  assert.match(source.runtimeApi, /\blistIndicatorRuntimeCatalog\b/);
  assert.match(source.definitions, /\bindicatorConfigFromDefinition\b/);
  assert.match(source.indicatorMenu, /\bloadIndicatorCatalog\b/);
  assert.match(source.indicatorSettings, /\bloadIndicatorDefinition\b/);
});

test("frontend indicator UI stays identity-agnostic", () => {
  assert.doesNotMatch(
    dynamicFrontend,
    /\b(SMA|EMA|VWAP|RSI|MACD|ADR|FVG|SWING_SR)\b/,
  );
  assert.doesNotMatch(dynamicFrontend, /\bBUILT_IN_INDICATORS\b/);
  assert.doesNotMatch(dynamicFrontend, /\bdefaultIndicator\(/);
  assert.doesNotMatch(dynamicFrontend, /switch\s*\([^)]*\.type/);
});

test("every backend catalog source reaches the same compiler", () => {
  const catalogSources = readdirSync(
    resolve(root, "../backend/internal/pineruntime/sources"),
  ).filter((file) => file.endsWith(".pine"));
  assert.ok(catalogSources.length > 0);
  assert.match(source.backendCatalog, /\bindicatorCompileRequest\b/);
  assert.match(source.backendRuntime, /indicatorCompileRequest\(req\)/);
  assert.match(source.backendRuntime, /Compile\(ctx, compileRequest\)/);
  assert.doesNotMatch(source.backendRuntime, /\bcalculate(SMA|FVG)\b/);
});

test("stateful runtime, work limits, and history metadata remain generic", () => {
  assert.match(source.backendStateParser, /\bparseStatefulProgram\b/);
  assert.match(source.backendStateEval, /\bexecuteBlock\b/);
  assert.match(source.backendStateRuntime, /\bstatefulSourceCandidate\b/);
  assert.doesNotMatch(statefulSource, /luxalgo|fair value gap|\bfvg\b/i);

  assert.match(source.backendJobs, /\bdefaultRuntimeWorkers\b/);
  assert.match(source.backendJobs, /queue\s+chan runtimeJobTask/);
  assert.match(source.backendJobs, /inflight\s+map/);
  assert.match(source.backendJobs, /\bstoreLocked\b/);
  assert.match(source.runtimeCache, /MAX_RUNTIME_CANDLES = 5_000/);
  assert.match(source.backendModels, /\bRequiresHistoryContext\b/);
  assert.match(source.runtimeCache, /definition\.requiresHistoryContext/);
  assert.doesNotMatch(source.runtimePolicy, /request\.security/);
  assert.doesNotMatch(source.runtimeCache, /request\.security/);
});

test("legacy Pine caches stay deleted and generic renderers remain supported", () => {
  for (const file of [
    "src/services/pineRuntimeCache.ts",
    "src/services/pineRuntimeCachePolicy.ts",
    "src/services/indicators.ts",
  ]) {
    assert.equal(existsSync(resolve(root, file)), false, `${file} must stay deleted`);
  }
  assert.match(source.priceChart, /\bLineSeries\b/);
  assert.match(source.priceChart, /\bHistogramSeries\b/);
  assert.match(source.priceChart, /\bBaselineSeries\b/);
  assert.match(source.priceChart, /\bindicatorDashboards\b/);
  assert.match(source.indicatorTypes, /\bIndicatorDashboard\b/);
  assert.match(source.candleViewport, /start < points\.length/);
  assert.match(source.candleViewport, /end > 0/);
  assert.match(source.candleViewport, /\breachesLatestCandle\b/);
});
