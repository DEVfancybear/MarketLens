# SPEC — MarketLens project avatar / favicon (Revision 1)

- Tier: old-coder Tier 1 (one static browser identity asset; no runtime business logic)
- Requested outcome: replace the generic browser globe shown for MarketLens with a distinctive,
  brand-aligned project avatar, then commit and push only this task's work.
- Repository: `C:\Users\duong\Downloads\tradingview`
- Frontend root: `C:\Users\duong\Downloads\tradingview\frontend`
- Spec approval: obtained before implementation. The user replied `Duyệt SPEC Revision 1` on
  2026-08-22, approving this exact Revision 1 specification.

## Discovery and current-state evidence

- `codebase-memory-mcp` was not exposed as an MCP tool in this session, and its documented CLI
  fallback is not installed (`CommandNotFoundException`). Per `AGENTS.md`, discovery therefore used
  `docs/CODEBASE_MEMORY.md`, `docs/PROJECT_STRUCTURE.md`, `frontend/docs/ARCHITECTURE.md`, the
  package-local `frontend/AGENTS.md`, current source, and the installed Next.js 16.3.1 guide.
- `frontend/src/app/layout.tsx` defines the MarketLens metadata but the root `app/` segment contains
  no `favicon`, `icon`, or `apple-icon` file.
- The installed Next.js guide confirms that `frontend/src/app/favicon.ico` automatically emits the
  root `<link rel="icon" href="/favicon.ico" sizes="any">` metadata.
- `frontend/src/app/firebase-messaging-sw.js/route.ts` already points notification icons at
  `/favicon.ico`, so the canonical file also repairs that existing missing asset without changing
  the service-worker route.
- The repository already had unrelated modified and untracked backend/MT5 files before this task.
  They are user-owned, outside scope, and must remain unstaged and uncommitted.

## Visual contract

The generated image is one icon-only MarketLens mark:

- Concept: a simple geometric lens combined with a rising candlestick/chart signal.
- Character: calm, precise, institutional, and legible at browser-tab size.
- Palette: MarketLens violet `#7C73FF` with deep navy `#080B13`; no bull/bear green or red because
  those colors are reserved for market semantics.
- Shape: centered, strong silhouette, generous internal clear space, square canvas suitable for a
  favicon.
- Must not contain text, letters, numbers, trademarks, gradients, 3D treatment, drop shadows,
  decorative glow, watermark, busy background, cropped elements, or fine detail that disappears at
  16×16.
- One base candidate will be generated with the built-in `image_gen` tool. At most one targeted
  regeneration is authorized if inspection finds a concrete violation of this contract.

The generated base image will be packaged into one final multi-resolution ICO containing PNG-backed
16×16, 32×32, 48×48, and 256×256 entries at:

`C:\Users\duong\Downloads\tradingview\frontend\src\app\favicon.ico`

## Executable acceptance scenarios

### Scenario 1 — The favicon is structurally valid at all required sizes

Given the final `frontend/src/app/favicon.ico`,
when `frontend/tests/architecture/projectAvatar.test.ts` reads its ICO directory and embedded PNG
headers,
then it finds exactly one image for each approved size (16, 32, 48, and 256), every payload is
in-bounds and PNG-backed, every embedded width/height matches its directory entry, and the file is
within the test's web-size ceiling.

### Scenario 2 — Next.js exposes the avatar to a real browser client

Given a successful production build,
when the gauntlet starts `next start` locally and requests the root document,
then the HTML contains a favicon link to `/favicon.ico`; requesting that URL returns HTTP 200 with
an image content type and the exact SHA-256 of the checked-in asset.

### Scenario 3 — The icon remains recognizable and brand compliant

Given the generated icon and extracted previews,
when inspected at 256×256 plus nearest-neighbor 32×32 and 16×16 previews,
then the lens/market idea remains recognizable, the approved violet/navy palette dominates, and no
forbidden text, watermark, gradient, shadow, glow, cropping, or unreadable micro-detail is present.
This scenario is a recorded visual inspection; aesthetic suitability cannot be fully proven by an
automated pixel checker.

### Scenario 4 — Existing frontend behavior remains intact

Given the favicon-only production change,
when the complete compiled TypeScript test inventory, type check, lint, and production build run,
then there are zero new failures or errors relative to the baseline captured before implementation.

### Scenario 5 — Git delivery contains only approved task files

Given the pre-existing dirty backend worktree,
when commits are created and pushed,
then their changed paths are limited to the allowlist below, the unrelated worktree changes remain
unstaged, and `origin/master` contains the two task commits.

## Negative constraints

- Must NOT change application runtime logic, metadata code, design tokens, backend code, trading
  behavior, authentication, data, deployment configuration, or dependencies.
- Must NOT stage, commit, restore, overwrite, or otherwise alter the pre-existing backend/MT5 work.
- Must NOT add a generic globe, copied trademark, wordmark, or text-dependent icon.
- Must NOT use semantic bull/bear colors as brand colors.
- Must NOT weaken or skip existing tests to obtain a green result.
- Must NOT force-push, pull, rebase, or reset the dirty worktree. A non-fast-forward push or remote
  conflict stops delivery and is reported instead of rewriting history.
- Must NOT deploy the frontend; this task ends after the requested Git push.

## Planned files

Implementation commit allowlist:

- `frontend/src/app/favicon.ico`
- `frontend/tests/architecture/projectAvatar.test.ts`
- `tools/verify-project-avatar.ps1`
- `docs/agent-evidence/project-avatar/SPEC.md`

Evidence commit allowlist:

- `docs/agent-evidence/project-avatar/EVIDENCE.md`

Ignored/generated verification artifacts may be created only under existing ignored frontend
paths such as `frontend/.test-build/` and `frontend/.next/`. The built-in image tool's source output
may remain under `$CODEX_HOME/generated_images/`; the final project-referenced ICO must be inside the
workspace at the path above.

## Dependencies, tools, and environment authorization

- New runtime dependencies: none.
- New development dependencies: none.
- Image generation: built-in `image_gen` only; no CLI/API fallback and no API key.
- Raster resizing: the already-installed `sharp` 0.35.0 package from `frontend/node_modules`.
- ICO packaging: Node.js standard-library buffer code plus the resized PNG buffers; no downloaded
  converter or package.
- Verification: existing Node.js, npm, TypeScript test build, Node test runner, ESLint, Next.js
  production build/server, PowerShell, Git, and read-only local HTTP requests.
- Network writes: only the explicitly requested `git push` to the existing `origin` remote after
  both commits pass scope checks.

No package installation, lockfile edit, browser automation dependency, or production deployment is
authorized. Discovery has already established that `magick`/ImageMagick is unavailable and is not
required.

## RED → GREEN → REFACTOR plan

1. Baseline: record current `HEAD`, branch/upstream, dirty paths, tool versions, and existing
   frontend test/type/lint/build results without touching unrelated files.
2. RED: add `projectAvatar.test.ts` first and run its focused compiled test while the favicon is
   absent; observe an assertion failure specifically for the missing asset.
3. GREEN: generate one base image, inspect it, package the minimum four ICO sizes, and rerun the
   focused test until it passes. Assertions remain frozen after RED.
4. REFACTOR: optimize only the binary packaging/output if needed; do not change visual semantics or
   test assertions. Re-run the focused test after any optimization.
5. Checker negative control: the persisted gauntlet temporarily corrupts a copy/byte of the
   task-owned favicon, proves the focused structural test exits nonzero, restores the asset
   byte-for-byte in `finally`, and verifies the original SHA-256 was restored.

## Risk-calibrated gauntlet

The single persisted entry point will be:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-project-avatar.ps1
```

It will fail closed and run these layers from a fresh generated-artifact state:

1. compile the TypeScript tests once and run every compiled `*.test.js` under
   `frontend/.test-build/tests/`;
2. run `npm run typecheck`;
3. run `npm run lint`;
4. run `npm run build`;
5. validate the ICO structure/size set and execute the corrupt-byte negative control with an exact
   SHA-256 restore check;
6. start the production Next server in a hidden process, request `/`, follow its favicon link,
   verify HTTP/content type/body SHA-256, and always stop the process in `finally`;
7. extract deterministic 256, 32, and 16 pixel previews for manual visual inspection;
8. run task-scoped `git diff --check`, dependency/capability review, and task-file secret review.

Changed-line coverage, property-based tests, and production-code mutation are not applicable: the
only production change is a static binary asset with no executable branches. The structural test,
its observed RED, its corrupt-byte negative control, the real Next server smoke, and manual
small-size inspection cover the relevant failure modes. No dependency audit is needed because the
manifest and lockfile must remain byte-for-byte unchanged.

## Git and delivery plan

After the fresh gauntlet passes:

1. Stage only the implementation allowlist and prove the staged path list contains nothing else.
2. Commit as `feat(frontend): add MarketLens favicon`.
3. Write `C:\Users\duong\Downloads\tradingview\docs\agent-evidence\project-avatar\EVIDENCE.md`,
   mapping every scenario/constraint to actual results from that fresh run and identifying the
   implementation commit SHA and toolchain.
4. Stage only `EVIDENCE.md` and commit as `docs: record MarketLens favicon evidence`.
5. Verify both commit path sets, confirm unrelated files are still unstaged, confirm the remote is a
   fast-forward target, and push the current `master` branch to `origin/master` without force.

Any applicable gauntlet failure blocks both commits and the push. A push rejection blocks delivery
and will be reported without modifying or rebasing the user's dirty worktree.
