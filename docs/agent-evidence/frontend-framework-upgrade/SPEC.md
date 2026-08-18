# SPEC — Upgrade Next.js, Tailwind CSS, and TypeScript

- Tier: old-coder Tier 2 (cross-cutting frontend dependency/configuration migration)
- Requested outcome: upgrade the frontend to the latest stable Next.js, Tailwind CSS, and
  TypeScript releases available from npm on 2026-08-16 while preserving build correctness and the
  existing responsive UI.
- Repository: `C:\Users\duong\Downloads\tradingview`
- Implementation root: `C:\Users\duong\Downloads\tradingview\frontend`
- Spec approval: obtained. The user replied `Duyệt SPEC` on 2026-08-16, approving this exact
  Revision 1 specification before implementation began.

## Confirmed target versions and compatibility design

| Capability | Current | Target | Reason / compatibility treatment |
| --- | --- | --- | --- |
| Next.js | `^16.2.12` | exact `16.3.1` | Latest stable npm release; keep `eslint-config-next` at the identical version. |
| Tailwind CSS | `3.4.17` | exact `4.3.3` | Latest stable npm release; migrate to the dedicated PostCSS package and v4 CSS entry point. |
| TypeScript CLI | `5.7.3` | exact `7.0.2` | Latest stable native compiler, installed as the npm alias `@typescript/native`. |
| TypeScript API compatibility | `5.7.3` | exact `6.0.2` | Install `@typescript/typescript6` under the package name `typescript`, as recommended by the TypeScript 7 release guidance, because TypeScript 7.0 has no programmatic API and this repo/tests plus ESLint import that API. Its executable is `tsc6`; the TypeScript 7 alias owns `tsc`. |
| Tailwind PostCSS plugin | bundled in `tailwindcss` | exact `@tailwindcss/postcss@4.3.3` | Required by Tailwind v4. |
| Autoprefixer | `10.4.20` | removed | Tailwind v4 handles imports and vendor prefixing itself. |

No canary, preview, RC, beta, or floating `latest` dependency will be retained in `package.json`.

## Executable acceptance scenarios

### Scenario 1 — Manifest and lockfile resolve the approved stable toolchain

Given the existing frontend manifest and lockfile,
when the migration is installed,
then `npm ls` resolves Next.js `16.3.1`, `eslint-config-next` `16.3.1`, Tailwind CSS
`4.3.3`, `@tailwindcss/postcss` `4.3.3`, TypeScript CLI `7.0.2`, and the TypeScript API
compatibility package `6.0.2`, with no prerelease versions for these targets.

### Scenario 2 — TypeScript 7 performs project type checking

Given TypeScript 7 has no JavaScript compiler API,
when `npm run typecheck` and `npm run build` run,
then the project-local `tsc` reports version `7.0.2`, all project configurations type-check with
zero errors, and Next.js uses `experimental.useTypeScriptCli: true` rather than disabling or
ignoring type errors.

### Scenario 3 — Existing TypeScript-API consumers remain operational

Given existing architecture tests and ESLint require the `typescript` module API,
when the architecture suite and lint run,
then they resolve the TypeScript 6.0.2 compatibility API and complete without module/API errors,
while `tsc6 --version` reports `6.0.2`.

### Scenario 4 — Tailwind v4 compiles the existing design system

Given the current Tailwind theme extensions and global CSS,
when the Next.js production build runs,
then PostCSS uses `@tailwindcss/postcss`, the stylesheet uses Tailwind v4's `@import` entry point,
the existing custom terminal/ink/brand/market utilities compile, and no v3 `@tailwind` directive or
obsolete `tailwindcss` PostCSS plugin remains.

### Scenario 5 — Responsive application behavior remains intact

Given the upgraded production-equivalent frontend,
when Playwright runs the existing `platformUi.spec.ts` and `mobileOverlayResponsive.spec.ts`
regressions,
then desktop and mobile shells, dialogs, menus, touch targets, and overflow constraints pass at
their existing tested viewports; the deterministic regression command passes twice consecutively.

### Scenario 6 — Existing non-browser behavior remains intact

Given the dependency and configuration changes,
when the complete existing focused TypeScript test suite runs,
then it reports zero new failures across architecture, replay, position, trade, drawing,
drawing-persistence, indicator-catalog, watchlist, alerts, chart, and UI suites.

## Negative constraints

- Must NOT change backend, database, trading, authentication, market-data, or deployment behavior.
- Must NOT upgrade React/React DOM or unrelated application dependencies in this task.
- Must NOT set `typescript.ignoreBuildErrors`, weaken `strict`, skip tests, loosen assertions, or
  suppress Tailwind/TypeScript diagnostics merely to make the gauntlet pass.
- Must NOT leave prerelease or unbounded versions for the requested toolchain.
- Must NOT silently discard the existing Tailwind theme tokens or broad application utility
  coverage. If the official upgrader touches application CSS/TSX utilities, every edit must be
  reviewed and kept only when required for v4 semantic equivalence.
- Must NOT accept new high/critical audit findings attributable to this dependency change.
- Must NOT commit or push. Git is used only for status/diff checks and safe restoration of temporary
  mutants; unrelated user changes, if any appear, remain untouched.

## Planned files

Expected direct changes:

- `frontend/package.json`
- `frontend/package-lock.json`
- `frontend/postcss.config.mjs`
- `frontend/src/app/globals.css`
- `frontend/next.config.mjs`
- `frontend/tailwind.config.ts` (retain with explicit `@config` compatibility or replace with
  equivalent CSS-first tokens only if the official upgrader proves that path cleanly)
- `frontend/tsconfig.json`, `frontend/tsconfig.test.json`, and `frontend/tsconfig.tools.json` only
  where TypeScript 7 diagnostics require an explicit compatibility setting
- Tailwind utility-bearing `frontend/src/**/*.tsx` or `frontend/src/**/*.css` only when the official
  v4 upgrader identifies a required renamed/changed utility; no unrelated source edits
- `frontend/tests/architecture/frameworkToolchainUpgrade.test.ts`
- `tools/verify-frontend-framework-upgrade.ps1`
- `docs/agent-evidence/frontend-framework-upgrade/EVIDENCE.md`

The official Tailwind upgrader may produce a wider candidate diff. Such changes are not implicitly
accepted: they will be reviewed against this allowlist and reverted unless required by Scenario 4
or Scenario 5.

## Setup, dependency, and tool authorization

Approval of this SPEC authorizes:

1. Network-backed npm installation/update inside `frontend/node_modules` and `frontend/package-lock.json`.
2. A one-time execution of `npx @tailwindcss/upgrade@4.3.3` from `frontend` to generate a reviewable
   v3-to-v4 migration candidate.
3. Exact manifest changes for the target packages listed above, including npm aliases
   `@typescript/native@npm:typescript@7.0.2` and
   `typescript@npm:@typescript/typescript6@6.0.2`.
4. Removal of direct `autoprefixer` because Tailwind v4 subsumes that responsibility.
5. Creation of the architecture regression test, one rerunnable PowerShell gauntlet entry point,
   and the final EVIDENCE report.
6. Creation/removal of generated ignored artifacts under the exact frontend paths `.next`,
   `.test-build`, `.tools-build`, `test-results`, and `playwright-report` as verification runs.

No additional runtime dependency is authorized. If implementation reveals another required package
or a material source migration outside this SPEC, work stops for a visible SPEC revision and fresh
approval.

### Implementation decision record — CSS-first Tailwind theme

The approved specification explicitly permitted either a retained legacy config loaded with
`@config` or an equivalent CSS-first theme if the official upgrader proved that path cleanly. On
2026-08-16, `@tailwindcss/upgrade@4.3.3` migrated every existing terminal, ink, brand, market,
font, radius, shadow, transition, and `2xs` token to `globals.css` `@theme` declarations and
applied its documented utility compatibility transforms. This task therefore selects the approved
CSS-first path and deletes `tailwind.config.ts`; this is a choice within the approved scope, not a
behavioral SPEC change.

## RED → GREEN → REFACTOR plan

1. Baseline: record clean Git state, installed tool versions, existing focused test results, build,
   audit status, and the two selected Playwright regressions before dependency edits where the
   environment permits.
2. RED: add `frameworkToolchainUpgrade.test.ts` asserting the exact manifest aliases/versions,
   Tailwind v4 PostCSS/CSS directives, removal of Autoprefixer, and Next's TypeScript CLI flag; run
   it against the old stack and observe assertion failures.
3. GREEN: run the official Tailwind upgrader, review its diff, install exact dependencies, and make
   the minimum configuration/utility edits needed for the RED test, typecheck, build, and selected
   browser regressions to pass.
4. REFACTOR: remove obsolete v3 configuration only when equivalence is proven; do not edit
   behavioral assertions during implementation refactoring.
5. Mutation control: temporarily regress at least the Tailwind PostCSS plugin and TypeScript CLI
   flag one at a time; prove the new architecture test fails for each, restore exactly, and verify
   a clean intended diff.

## Risk-calibrated gauntlet

The persisted entry point will be:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-frontend-framework-upgrade.ps1
```

It will fail closed and run, from a fresh generated-artifact state:

1. exact package/alias/version verification plus `npm ls`;
2. `tsc --version` = `7.0.2`, `tsc6 --version` = `6.0.2`, and `npm run typecheck`;
3. all existing focused TypeScript test groups named in Scenario 6;
4. `npm run lint` with zero errors/warnings introduced;
5. `npm run build` with Next.js `16.3.1` and TypeScript CLI checking enabled;
6. the architecture checker's negative controls/mutations;
7. `npm audit --audit-level=high`, compared with the captured baseline so the change introduces no
   new high/critical advisory;
8. `git diff --check`, intended-file/capability review, and diff secret scan;
9. Playwright `platformUi.spec.ts` plus `mobileOverlayResponsive.spec.ts` twice consecutively,
   retaining traces/screenshots/output on failure.

Changed-line coverage is not a meaningful percentage for manifest/configuration/CSS-directive
edits; direct architecture assertions, the production build, and browser geometry/interaction tests
cover those changed contracts instead. Property-based testing is not applicable because no
algorithmic input domain changes. Mutation is handled by explicit configuration regressions.

## Evidence and completion rule

After the final source edit, run the single gauntlet entry point fresh and write
`C:\Users\duong\Downloads\tradingview\docs\agent-evidence\frontend-framework-upgrade\EVIDENCE.md`.
Map every scenario and negative constraint to an exact test/layer or mark it unverified/n-a with a
reason. Any failing applicable gauntlet layer blocks completion; no commit or push will occur.
