import { CHART_BENCHMARK_SIZES } from "../../src/services/chartBenchmarkFixtures";

console.log("Candle virtualization browser benchmark");
console.log("1. Start the app with: npm run dev");
console.log("2. Open one of these development-only URLs:");
for (const size of CHART_BENCHMARK_SIZES) {
  console.log(`   http://localhost:3000/?chartPerf=1&chartFixture=${size}`);
}
console.log("3. In DevTools Console run:");
console.log("   await window.__chartBenchmark.run()");
console.log("   copy(window.__chartPerformanceProbe.exportJson())");
console.log("4. Record a Chrome Performance trace and heap snapshot around the same run.");
