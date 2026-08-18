import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function readManifest(): PackageManifest {
  return JSON.parse(readSource("package.json")) as PackageManifest;
}

test("frontend manifest pins the approved Next, Tailwind, and TypeScript toolchain", () => {
  const manifest = readManifest();

  assert.equal(manifest.dependencies?.next, "16.3.1");
  assert.equal(manifest.devDependencies?.["eslint-config-next"], "16.3.1");
  assert.equal(manifest.devDependencies?.tailwindcss, "4.3.3");
  assert.equal(manifest.devDependencies?.["@tailwindcss/postcss"], "4.3.3");
  assert.equal(manifest.devDependencies?.["@typescript/native"], "npm:typescript@7.0.2");
  assert.equal(manifest.devDependencies?.typescript, "npm:@typescript/typescript6@6.0.2");
  assert.equal(manifest.devDependencies?.autoprefixer, undefined);
});

test("frontend config uses Tailwind v4 and lets Next invoke the TypeScript CLI", () => {
  const postcss = readSource("postcss.config.mjs");
  const globals = readSource("src/app/globals.css");
  const nextConfig = readSource("next.config.mjs");

  assert.match(postcss, /["']@tailwindcss\/postcss["']\s*:/);
  assert.doesNotMatch(postcss, /\btailwindcss\s*:/);
  assert.doesNotMatch(postcss, /\bautoprefixer\s*:/);
  assert.match(globals, /@theme\s*\{/);
  for (const token of [
    "terminal-bg",
    "terminal-panel",
    "terminal-border",
    "ink",
    "brand",
    "bull",
    "bear",
    "bos",
    "choch",
    "fvg",
    "ob",
    "liquidity",
  ]) {
    assert.match(globals, new RegExp(`--color-${token}:`));
  }
  assert.equal(existsSync(resolve(process.cwd(), "tailwind.config.ts")), false);
  assert.match(globals, /@import\s+["']tailwindcss["'];/);
  assert.doesNotMatch(globals, /@tailwind\s+(base|components|utilities)/);
  // Next resolves its CLI checker strictly as `typescript/bin/tsc`. This project
  // installs `typescript` as the TypeScript 6 API-compatibility package (bin
  // `tsc6`) so typescript-eslint keeps a compiler API, so the build checks types
  // through that API instead. What must never regress is that the build keeps
  // type checking at all.
  assert.match(nextConfig, /experimental\s*:\s*\{[\s\S]*?useTypeScriptCli\s*:\s*false/);
  assert.doesNotMatch(nextConfig, /ignoreBuildErrors\s*:\s*true/);
});

test("both TypeScript entry points stay installed and separately addressable", () => {
  const api = JSON.parse(
    readSource("node_modules/typescript/package.json"),
  ) as { name?: string; bin?: Record<string, string> };
  const native = JSON.parse(
    readSource("node_modules/@typescript/native/package.json"),
  ) as { name?: string; version?: string; bin?: Record<string, string> };

  // The API package must expose the JavaScript compiler API that ESLint needs.
  assert.equal(api.name, "@typescript/typescript6");
  assert.equal(
    existsSync(resolve(process.cwd(), "node_modules/typescript/lib/typescript.js")),
    true,
  );
  // The TypeScript 7 native compiler owns the `tsc` binary the scripts call.
  assert.equal(native.name, "typescript");
  assert.equal(native.version, "7.0.2");
  assert.equal(native.bin?.tsc, "./bin/tsc");
  assert.equal(api.bin?.tsc, undefined);
});

test("no tsconfig reintroduces options TypeScript 7 removed", () => {
  for (const file of ["tsconfig.json", "tsconfig.test.json", "tsconfig.tools.json"]) {
    const config = readSource(file);
    assert.doesNotMatch(config, /"baseUrl"/, `${file} still sets baseUrl`);
    assert.doesNotMatch(
      config,
      /"moduleResolution"\s*:\s*"(Node|node|node10)"/,
      `${file} still uses the removed node10 module resolution`,
    );
  }
});
