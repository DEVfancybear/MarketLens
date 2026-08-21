import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/api",
  testMatch: "mt5VmPhase2Operational.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: "line",
  use: {
    trace: "off",
  },
});
