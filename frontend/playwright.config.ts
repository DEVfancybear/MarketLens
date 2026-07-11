import { defineConfig } from "@playwright/test";

const onWindows = process.platform === "win32";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3000",
    ...(onWindows ? { channel: "msedge" as const } : {}),
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: onWindows
      ? "npm.cmd run dev -- --hostname 127.0.0.1"
      : "npm run dev -- --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
