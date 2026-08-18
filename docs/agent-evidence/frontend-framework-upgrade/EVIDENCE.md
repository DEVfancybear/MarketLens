# EVIDENCE — Upgrade Next.js, Tailwind CSS, and TypeScript

- Task: frontend framework toolchain upgrade (`SPEC.md`, Revision 1, approved 2026-08-16)
- Completed: 2026-08-18
- Implementation root: `frontend/`
- Gauntlet entry point:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-frontend-framework-upgrade.ps1
```

- No commit and no push were performed.

## 1. Delivered toolchain

| Capability | Before (`f94e346`) | After | Notes |
| --- | --- | --- | --- |
| Next.js | `^16.2.12` | `16.3.1` | exact pin |
| `eslint-config-next` | `16.2.12` | `16.3.1` | matched to Next |
| Tailwind CSS | `3.4.17` | `4.3.3` | CSS-first `@theme`, `tailwind.config.ts` deleted |
| `@tailwindcss/postcss` | n/a | `4.3.3` | replaces the bundled v3 PostCSS plugin |
| `autoprefixer` | `10.4.20` | removed | subsumed by Tailwind v4 |
| TypeScript CLI | `5.7.3` | `7.0.2` | alias `@typescript/native` → `npm:typescript@7.0.2`, owns `tsc` |
| TypeScript API | `5.7.3` | `6.0.2` | alias `typescript` → `npm:@typescript/typescript6@6.0.2`, owns `tsc6` |

No prerelease, canary, or floating specifier remains for any targeted package.

## 2. Baseline used for every comparison

A clean worktree at `f94e346` was created and installed with the pre-upgrade
dependency set (`npm ci`), then measured with the same commands. This baseline is
what "no new failure" is judged against throughout this report.

| Measurement | Pre-upgrade baseline | After upgrade |
| --- | --- | --- |
| `npm audit` high / critical | 3 / 0 | 3 / 0 |
| ESLint errors / warnings | 0 / 1 | 0 / 1 |
| `platformUi` + `mobileOverlayResponsive` | 2 failed, 12 passed | 2 failed, 12 passed |
| Focused TypeScript suites | pass | pass |

The three high advisories are unchanged and transitive: `brace-expansion`,
`js-yaml`, `nanoid`.

## 3. Scenario results

### Scenario 1 — Manifest and lockfile resolve the approved stable toolchain — **PASS**

Gauntlet layer 1 asserts every exact pin and alias in `package.json`, rejects any
prerelease/floating specifier, rejects a surviving direct `autoprefixer`, and
requires `npm ls` to resolve the tree without an unmet dependency. Also asserted
by `frontend/tests/architecture/frameworkToolchainUpgrade.test.ts`.

### Scenario 2 — TypeScript 7 performs project type checking — **PASS with a documented deviation**

- `tsc --version` reports `7.0.2`, and `npm run typecheck` type-checks the whole
  project with TypeScript 7 and zero errors (gauntlet layer 2).
- **Deviation:** the SPEC required `experimental.useTypeScriptCli: true`. Next
  16.3.1 resolves its CLI checker strictly as `typescript/bin/tsc`
  (`next/dist/lib/typescript/runTypeScriptCli.js`, `getTypeScriptPackageInfo`).
  The `typescript` package name is held by the TypeScript 6 API-compatibility
  package, whose only binary is `tsc6`, so the flag makes `next build` abort with
  "It looks like you're trying to use TypeScript but do not have the required
  package(s) installed". Making the flag work would require `typescript` to be
  TypeScript 7, which has no JavaScript compiler API and would break
  typescript-eslint (Scenario 3).
- Resolution: `experimental.useTypeScriptCli: false`. Build-time type checking
  stays **enabled** and runs through the TypeScript 6 API — the build log shows
  `Running TypeScript ... Finished TypeScript`. `typescript.ignoreBuildErrors` is
  never set, `strict` is unchanged. TypeScript 7 still checks the identical
  project through `npm run typecheck`, which the gauntlet runs.
- Gauntlet layer 5 fails closed if the build stops reporting Next.js 16.3.1, if
  the TypeScript step stops running, or if `ignoreBuildErrors: true` appears.

### Scenario 3 — Existing TypeScript-API consumers remain operational — **PASS with a version-reporting note**

- `npm run lint` resolves the TypeScript 6 API through typescript-eslint and
  completes with 0 errors (layer 4).
- All architecture tests run and pass (layer 3).
- **Note:** `tsc6 --version` reports `6.0.3`, not `6.0.2`. `6.0.2` is the npm
  version of `@typescript/typescript6`; `6.0.3` is the compiler build it ships
  (`require('typescript').version === '6.0.3'`). The gauntlet asserts the npm
  version `6.0.2` against the manifest and lockfile, and the compiler build
  `6.0.3` against the binary, so both facts are pinned.

### Scenario 4 — Tailwind v4 compiles the existing design system — **PASS**

- `postcss.config.mjs` uses `@tailwindcss/postcss` only; no `tailwindcss` or
  `autoprefixer` plugin entry remains.
- `globals.css` uses `@import 'tailwindcss'`; no `@tailwind base/components/utilities`
  directive remains.
- Every terminal / ink / brand / market token, plus the font, `2xs` text,
  transition-duration, radius and shadow tokens, migrated to `@theme` and is
  asserted by name in the architecture test.
- `tailwind.config.ts` is deleted (the CSS-first path the SPEC pre-approved).
- The production build compiles the full stylesheet (layer 5).

### Scenario 5 — Responsive application behavior remains intact — **PASS relative to the baseline**

`platformUi.spec.ts` and `mobileOverlayResponsive.spec.ts` produce **exactly the
baseline result**: 12 passed, 2 failed, run twice consecutively (layer 9).

The two failures are **pre-existing** and reproduce identically on the
pre-upgrade worktree:

1. `mobile watchlist actions use the shared platform dialog` — the confirm dialog
   `Delete “Mobile list”?` is never rendered.
2. `desktop loads only the command-center presentation` — the test asserts the
   `SMC Terminal` brand label is visible at 1366px wide, but the label is gated
   behind `hidden min-[1720px]:block` in `TopToolbar.tsx`.

Neither is caused by this task and neither was fixed here; both are recorded in
`docs/KNOWN_ISSUES.md`. Layer 9 records them by name and still fails closed on
any failure outside that recorded set.

One genuine regression **was** introduced by the migration and **is fixed** —
see section 4.

### Scenario 6 — Existing non-browser behavior remains intact — **PASS**

All eleven suites named in the SPEC pass with zero failures (layer 3):
architecture, replay, position, trade, drawing, drawing-persistence,
indicator-catalog, watchlist, alerts, chart, ui.

## 4. Defects found and fixed during migration

### 4.1 Unlayered CSS silently disabled every typography utility on buttons and inputs

**The one real regression this upgrade introduced.** Tailwind v4 emits its
utilities inside real CSS cascade layers; unlayered rules outrank every layer
regardless of specificity. `globals.css` carried

```css
button, input, select, textarea { font: inherit; }
```

as unlayered CSS. Under Tailwind v3 (unlayered utilities) the class selector won
on specificity; under v4 the element selector won on layer order, so `text-*`,
`font-*`, `leading-*` and `tracking-*` became no-ops on every button and input in
the application.

Measured effect on the desktop toolbar at 1280px in Vietnamese: workspace nav
buttons rendered at the inherited `13px/400` instead of `text-[11px] font-semibold`,
widening the nav from `179.05px` to `191.63px` and overflowing the toolbar by 6px,
which failed `platformUi.spec.ts:128`.

Fix: the element-level resets and the `body`/scrollbar presentation rules are now
declared inside `@layer base`, restoring the v3 relationship exactly — they still
beat Tailwind's preflight (same layer, later in source) and utilities still beat
them. After the fix the nav measures `179.05px`, byte-identical to the baseline,
and the test passes. Component classes (`.mobile-*`, `.desktop-terminal`, …) were
deliberately left unlayered: their specificity already beat utilities under v3, so
their behavior is unchanged.

### 4.2 The Tailwind upgrader rewrote runtime strings, not just class names

`@tailwindcss/upgrade` renamed the v3 utility `blur` to `blur-sm` inside string
literals that were never CSS classes:

| File | Before | After the upgrader | Consequence |
| --- | --- | --- | --- |
| `PriceChart.tsx:712` | `removeEventListener("blur", …)` | `"blur-sm"` | window `blur` listener never removed — leak |
| `TradeWorkspace.tsx:455` | `removeEventListener("blur", …)` | `"blur-sm"` | window `blur` listener never removed — leak |
| `PositionSettingsDialog.tsx:78,111` | `commitMode: "change" \| "blur"` | `"blur-sm"` | 5 type errors; commit-on-blur broken |

All four sites were restored. A full audit of the upgrader's diff (every changed
quoted literal with a short token list, in every `.ts`/`.tsx` file it touched)
confirmed `"blur"` was the only runtime string affected; every other rename was a
genuine class-name transform.

### 4.3 Upgrader rewrote a class string pinned by an existing architecture test

The upgrader modernized `z-[2]` to `z-2` in `SmcLayer.tsx`, breaking
`smcOverlayParity.test.ts`, which pins that exact class string as a contract.
`z-[2]` remains valid in v4 and is semantically identical, so the source was
restored rather than the assertion loosened.

### 4.4 TypeScript 7 removed configuration options this repo used

- `baseUrl` was removed from `tsconfig.json`, `tsconfig.test.json` and
  `tsconfig.tools.json` (error `TS5102`). The `paths` entries are already
  tsconfig-relative (`./src/*`), so resolution is unchanged.
- `moduleResolution: "Node"` (node10) was removed (error `TS5108`). The test and
  tools projects now use `moduleResolution: "bundler"` while keeping
  `module: "CommonJS"`, which preserves the existing CommonJS emit consumed by
  `node --test`. `node16`/`nodenext` was rejected: it forces ESM-only packages
  such as `lightweight-charts` to be `import()`-ed, which would have required
  source changes far outside this task.

Both removals are pinned by a new negative assertion in the architecture test.

### 4.5 New React Compiler lint rules in `eslint-config-next@16.3.1`

Two rules that ship enabled in the new config reported real issues:

- `react-hooks/immutability` — `CursorModeOverlay.tsx` mutated
  `canvasRef.current.parentElement.style.cursor`, writing through a ref borrowed
  from props. The overlay `<svg>` is a sibling of the drawing canvas, so the
  component now reaches the same container through its own `overlayRef`.
- `react-hooks/preserve-manual-memoization` — `TradeWorkspace.tsx` passed a
  freshly-filtered `available` array as a `useMemo` dependency, which both
  defeated that memo and blocked compiler optimization. `available` is now
  memoized on `[accounts, selectedId]`.

Neither was suppressed; both were fixed at the source.

### 4.6 Mojibake introduced into `globals.css`

The migration left three em-dashes in `globals.css` comments double-encoded
(`U+2014` had become an 18-codepoint UTF-8/cp1252 round-trip artifact). All three
were restored to `U+2014`, and every modified tracked file was then compared
against its `HEAD` blob for non-ASCII runs that appear in the working tree but
not in `HEAD`: none remain. This is cosmetic, but the repository already guards
against mojibake elsewhere (`smcOverlayParity` / SMC menu checks), so it was
fixed rather than carried forward.

### 4.7 Known fragility left in place: self-referential font tokens

The upgrader emitted `--font-sans: var(--font-sans), system-ui, sans-serif` (and
the `--font-mono` equivalent) into `@theme`, which is self-referential. It
resolves correctly today because the application's own
`:root, .theme-dark { --font-sans: "Inter", … }` is unlayered and therefore
outranks the `@theme` definition — verified in the browser: computed
`font-family` is `Inter, "SF Pro Display", "Segoe UI", system-ui, sans-serif`,
matching the pre-upgrade tree, and `font-sans`/`font-mono` utilities resolve to
the intended stacks.

It was left as-is because removing the tokens would drop `font-sans`/`font-mono`
utilities back to Tailwind's own defaults, and renaming the application variables
is a wider refactor than this task authorizes. If the `:root` token block is ever
moved into a cascade layer, these two declarations become circular and must be
renamed at the same time.

## 5. Negative constraints

| Constraint | Result |
| --- | --- |
| No backend / database / trading / auth / market-data / deployment change | **Held.** Layer 8 rejects any changed path outside `frontend/`, this task's evidence directory, the gauntlet script and the project memory documents, and explicitly rejects `backend/`, `migrations/`, `infra/`. |
| No React / React DOM / unrelated dependency upgrade | **Held.** `react` and `react-dom` remain `19.0.0`; no other runtime dependency version changed. |
| No `ignoreBuildErrors`, no weakened `strict`, no skipped tests or loosened assertions | **Held.** `strict: true` is unchanged, `ignoreBuildErrors` is never set (asserted by the architecture test and layer 5), no existing assertion was weakened. Where the upgrader's output collided with an existing assertion (4.3) the source was reverted instead. |
| No prerelease or unbounded version for the requested toolchain | **Held.** Layer 1 rejects both. |
| Theme tokens and utility coverage preserved | **Held.** Every v3 theme token is asserted present in `@theme`; the upgrader's diff was reviewed line by line and three classes of unwanted edits were reverted (4.2, 4.3). |
| No new high/critical audit finding | **Held.** 3 high / 0 critical before and after, same three advisories. |
| No commit, no push | **Held.** |

## 6. Gauntlet layers

| Layer | Covers | Result |
| --- | --- | --- |
| 1 | exact packages/aliases/versions + `npm ls` | PASS |
| 2 | `tsc` 7.0.2, `tsc6` 6.0.3, TS API present, `npm run typecheck` | PASS |
| 3 | all eleven focused TypeScript suites | PASS |
| 4 | `npm run lint` (0 errors, warning budget 1) | PASS |
| 5 | `npm run build` on Next 16.3.1 with type checking proven to run | PASS |
| 6 | four architecture mutations, each proven detected and restored | PASS |
| 7 | `npm audit` vs the recorded baseline | PASS |
| 8 | `git diff --check`, intended-file review, secret scan | PASS |
| 9 | the two Playwright specs, twice consecutively, vs the recorded baseline | PASS |

Layer 6 mutates and restores, one at a time: the Tailwind PostCSS plugin, the
Next TypeScript checker flag, the Tailwind v4 CSS entry point, and `baseUrl` in
the root tsconfig. Each mutation is proven to fail the architecture checker, and
each file is restored byte-for-byte in a `finally` block.

The final run was executed fresh, in fail-closed mode (no `-ContinueOnFailure`),
against the exact tree described in this report, and all nine layers passed:

```
tsc  -> Version 7.0.2      tsc6 -> Version 6.0.3
ESLint errors=0 warnings=1 (baseline warning budget: 1)
npm audit high=3 critical=0
99 changed path(s), all within the intended surface
Playwright pass 1 -> 12 passed, 2 failed (both pre-existing)
Playwright pass 2 -> 12 passed, 2 failed (both pre-existing)
All applicable gauntlet layers passed.
```

## 7. Coverage rationale

Changed-line coverage is not meaningful for manifest, configuration and
CSS-directive edits. Those contracts are covered instead by direct architecture
assertions with proven negative controls (layer 6), a production build with type
checking (layer 5), and browser geometry/interaction tests measured against a
real pre-upgrade baseline (layer 9). Property-based testing is not applicable —
no algorithmic input domain changed. Mutation testing is handled by the explicit
configuration regressions in layer 6.

## 8. Pre-existing issue surfaced while verifying

`npm audit --omit=dev --audit-level=low`, which `docs/SECURITY.md` requires to
report zero findings, now fails with one high advisory: `nanoid@3.3.16`
(GHSA-2v37-7h3g-55p8), reached through the repository's own `postcss@8.5.23`
override. The lockfile entry is identical at `f94e346` — same version, same
non-dev flag — so this upgrade did not introduce it; the advisory is simply newer
than the last audit review. `docs/SECURITY.md` no longer claims the gate passes,
and the fix (advancing the pinned PostCSS override, which needs its own clean
production audit and build) is recorded in `docs/NEXT_TASKS.md` and
`docs/KNOWN_ISSUES.md`. It was not fixed here: changing a security-pinned
override is outside this task's approved scope.

Gauntlet layer 7 compares the full `npm audit` against the pre-upgrade baseline
(3 high / 0 critical, same three advisories) and is unaffected.

## 9. Not verified

- The two pre-existing `platformUi.spec.ts` failures were not fixed; they are out
  of this task's scope and are recorded in `docs/KNOWN_ISSUES.md`.
- Only the two Playwright specs named in the SPEC were run as gauntlet layer 9.
  The remaining browser specs were not part of the approved scope.
- No production deployment, runtime smoke test, or visual snapshot approval was
  performed.
