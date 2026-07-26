import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(frontendDir, "..");

function parseEnvValue(rawValue) {
  const value = rawValue.trim();
  const quote = value[0];
  const last = value[value.length - 1];
  if ((quote === `"` && last === `"`) || (quote === `'` && last === `'`)) {
    return value.slice(1, -1).replace(/\\n/g, "\n");
  }
  return value;
}

function loadRepoRootEnvIfMissing(fileName) {
  const filePath = path.join(repoRoot, fileName);
  if (!existsSync(filePath)) return;

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = parseEnvValue(rawValue);
    }
  }
}

// Monorepo fallback: when Next is run from frontend/, it does not read the
// repository root .env files. Load them only for missing keys so Vercel/project
// env vars and frontend/.env.local keep priority.
loadRepoRootEnvIfMissing(".env.local");
loadRepoRootEnvIfMissing(".env");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Charts manage their own imperative lifecycle; double-invoke in dev breaks them.
  reactStrictMode: false,
  // Keep the framework dev badge from covering app controls on compact viewports.
  devIndicators: false,
  // Native Web Workers via `new Worker(new URL('./x.worker.ts', import.meta.url))`
  // are supported out of the box by the Next 15 / Turbopack + webpack pipeline.
  async headers() {
    return [
      {
        source: "/downloads/SMCExecutionEA.ex5",
        headers: [
          {
            key: "Content-Type",
            value: "application/octet-stream",
          },
          {
            key: "Content-Disposition",
            value: 'attachment; filename="SMCExecutionEA.ex5"',
          },
          {
            key: "Cache-Control",
            value: "public, max-age=300, must-revalidate",
          },
        ],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), local-network=(self), loopback-network=(self), local-network-access=(self)",
          },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default nextConfig;
