const sizes = [900, 5000, 20000, 100000];

console.log("Candle virtualization Phase 0 browser harness");
console.log("1. Start the app with: npm run dev");
console.log("2. Open one of these development-only URLs:");
for (const size of sizes) {
  console.log(`   http://localhost:3000/?chartPerf=1&chartFixture=${size}`);
}
console.log("3. In DevTools Console run:");
console.log("   await window.__chartBenchmark.run()");
console.log("   copy(window.__chartPerformanceProbe.exportJson())");
console.log("4. Record a Chrome Performance trace and heap snapshot around the same run.");
