# EVIDENCE — MarketLens project avatar / favicon (Tier 1)

- Spec: `docs/agent-evidence/project-avatar/SPEC.md`, Revision 1
- Spec approval: obtained before implementation. The user replied
  `Duyệt SPEC Revision 1` on 2026-08-22.
- Implementation source state: commit `2f92648711d94fc2bbf5683dd524827547e07693`
- Implementation commit: `feat(frontend): add MarketLens favicon`
- Entry point:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-project-avatar.ps1
```

- Final asset: `frontend/src/app/favicon.ico`
- Final asset size: 26,393 bytes
- Final asset SHA-256: `0d1f4cd24f8df87d661246c85aa0edb94315379a2ed651b5eaa6a3fee9e1f938`
- Independent verification: not performed; Tier 1 static asset change, and the approved SPEC did not
  request the experimental Tier 3 verifier protocol.

## Source state and ambient worktree

The final fresh gauntlet ran immediately before the implementation commit. A post-commit
`git diff --exit-code 2f926487... -- <implementation allowlist>` returned zero, proving the four
task files in the commit are byte-identical to those exercised by the final run.

The repository already contained user-owned backend/MT5 changes. During this task the user also
added frontend execution-dialog/localization/API work plus
`frontend/tests/trade/managedMt5DialogContract.test.ts` (two tests). Those changes remained
unstaged and are not in the implementation commit. They were present during the final full-suite
run, so the reported suite result describes the actual shared worktree as well as this task's
unchanged implementation bytes.

Commit `2f926487...` contains exactly:

```text
A  docs/agent-evidence/project-avatar/SPEC.md
A  frontend/src/app/favicon.ico
A  frontend/tests/architecture/projectAvatar.test.ts
A  tools/verify-project-avatar.ps1
```

## Toolchain

| Tool | Version / state |
| --- | --- |
| Windows PowerShell | `5.1.26100.9168` |
| Node.js | `v24.18.0` |
| npm | `11.16.0` |
| Next.js | `16.3.1` |
| Sharp | `0.35.0` (already installed) |
| Git | `2.55.0.windows.2` |
| `frontend/package.json` SHA-256 | `AD16B498D95783751C099BF86C72D374DEA5F15DFB3276143ED9D5B5A18E53F4` |
| `frontend/package-lock.json` SHA-256 | `3E59C8326ABE025B5C9790D8D85160768C0BB11240153B803EACF7B6AA1399FC` |

No package, lockfile, runtime dependency, or development dependency changed.

## SPEC → evidence mapping

| Scenario / invariant | Evidence | Status |
| --- | --- | --- |
| 1. Structurally valid 16/32/48/256 ICO | `projectAvatar.test.ts`; all four PNG signatures, IHDR dimensions, RGBA type, offsets, bounds, trailing bytes, and 512 KiB ceiling asserted | **pass** |
| 2. Next exposes the avatar to a real client | Production `next start`; root HTML published `/favicon.ico?favicon.25kjjcdqoh8p-.ico`; request returned HTTP 200, `image/x-icon`, 26,393 bytes, exact source SHA-256 | **pass** |
| 3. Recognizable and brand compliant | Final embedded 256/32/16 PNG payloads inspected after the fresh run; lens ring and three rising candles remain legible, upright, uncropped, text-free, and watermark-free; violet/navy dominate with only transparency/anti-alias boundary pixels | **pass (manual visual inspection)** |
| 4. Existing frontend behavior remains intact | 191 compiled test files, 858 tests passed, 0 failed; typecheck, lint, and production build passed | **pass** |
| 5. Git delivery contains only approved task files | Implementation commit path set is exact; evidence is isolated to its own commit; unrelated changes remain unstaged; fetched `origin/master` is `957fae6...` and is an ancestor of the task branch | **pass through pre-push gate; remote push confirmation belongs to the final handoff** |
| Must not change runtime logic, metadata code, design tokens, backend, trading, auth, data, deployment, or dependencies | `git show` path allowlist plus unchanged manifest/lock hashes | **pass** |
| Must not alter or commit existing user work | Empty index before task staging; exact allowlist comparison before commit; unrelated dirty paths remain after commit | **pass** |
| Must not use globe, text, copied trademark, green/red branding, gradient, 3D, shadow, glow, or watermark | Prompt constraints, deterministic violet/navy flattening, and final multi-size visual inspection | **pass within manual visual review limits** |
| Must not weaken/skip existing tests | New assertion file was written before the asset, observed RED, and never weakened; complete inventory passed | **pass** |
| Must not force-push, pull, rebase, or reset | None performed; only read-only `git fetch origin master` was used before the fast-forward gate | **pass** |
| Must not deploy | No deployment command or production mutation was performed | **pass** |

The push clause is necessarily confirmed outside this pre-push report: the EVIDENCE file must be
committed before the commit containing it can be pushed. Creating a third self-updating evidence
commit would violate the approved two-commit plan. The final user handoff reports the live remote
SHA after both approved commits are pushed and verified.

## RED → GREEN record

### RED

After adding only `frontend/tests/architecture/projectAvatar.test.ts`, the focused command exited 1:

```text
✖ MarketLens favicon contains the approved PNG-backed browser sizes
AssertionError [ERR_ASSERTION]: src/app/favicon.ico must exist so Next.js can publish the project avatar
false !== true
tests 1, pass 0, fail 1
```

The failure was behavioral and specific to the missing asset, not a TypeScript collection error.

### GREEN

After generating and packaging the favicon, the same focused test exited 0:

```text
tests 1, pass 1, fail 0
```

Its assertions were not edited after RED.

### Checker negative control

The persisted gauntlet changes the task-owned ICO type byte from `1` to `2`, runs the focused test,
requires a nonzero result containing `ICO type must identify an icon`, restores the original bytes
in `finally`, verifies the original SHA-256, and reruns the focused test green.

Final result:

```text
Corrupt-header negative control: killed
Restored SHA-256: 0d1f4cd24f8df87d661246c85aa0edb94315379a2ed651b5eaa6a3fee9e1f938
Focused test after restore: 1 passed, 0 failed
```

This proves the known corrupt-header case reaches the checker's failure path; it does not claim the
checker can detect every possible visual defect.

## Final fresh gauntlet

The successful run occurred after the last implementation/script edit and exited 0.

| Layer | Command / mechanism | Actual result |
| --- | --- | --- |
| Freshness | Entry point removes only validated `frontend/.test-build` and `frontend/.next` paths | stale generated outputs removed; run rebuilt from source |
| Complete test inventory | `npm run test:build`, then `node --test` over every compiled `*.test.js` | 191 files; 858 tests; 858 pass; 0 fail; 0 skipped; 0 cancelled |
| Static types | `npm run typecheck` | exit 0; 0 errors |
| Lint | `npm run lint` | exit 0; no diagnostics |
| Structural negative control | temporary ICO type corruption, expected focused failure, byte-exact restore | 1/1 known corruptions killed; restore hash exact |
| Production build | `npm run build` | Next.js 16.3.1 compiled; TypeScript finished; 12 static pages generated; exit 0 |
| Real execution | hidden `next start -p 3177`, local HTTP root and favicon requests | root available; favicon HTTP 200; `image/x-icon`; 26,393 bytes; hash exact |
| Visual payload export | ICO parser writes embedded 256/32/16 PNGs under ignored `.test-build/project-avatar/` | all three exported and manually inspected |
| Dependency gate | exact SHA-256 of `package.json` and `package-lock.json` | unchanged from baseline |
| Secret checker | known-bad control plus task-text scan | control detected; no credential pattern in task text |
| Diff/capability gate | task-scoped `git diff --check` and manual capability review | clean; static favicon only; no new runtime capability |

The pre-change baseline had 189 compiled test files and 855 passing tests, with typecheck, lint, and
build all green. The final count increased by this task's one architecture test plus the user's
concurrent two-test execution-dialog contract file; all 858 passed.

## Image generation and brand review

- Mode: built-in `image_gen`; no CLI/API fallback and no API key.
- Use case: `logo-brand`.
- Chosen geometry source:
  `C:\Users\duong\AppData\Roaming\orca\codex-runtime-home\home\generated_images\01a02760-2dbd-7792-955c-69418e34f059\exec-2be13af4-1276-4d8e-9020-fd0c0231e915.png`
- Deterministic finishing: existing Sharp 0.35.0 removed the source gradient/glow, mapped the mark to
  deep navy `#080B13`, mapped the tile to violet `#7C73FF`, preserved only edge alpha, resized with
  Lanczos, and packaged PNG-backed 16/32/48/256 entries into the ICO.

Initial generation prompt:

```text
Use case: logo-brand
Asset type: MarketLens browser favicon and project avatar
Primary request: create one original icon-only mark that combines the idea of a precision lens with a rising financial candlestick signal for an institutional trading workspace
Scene/backdrop: a transparent square canvas outside one solid rounded-square violet tile
Subject: one coherent geometric symbol: a bold deep-navy circular lens ring integrated cleanly with three simplified rising candlesticks; use only two or three large internal shapes so it remains recognizable at 16 by 16 pixels
Style/medium: crisp flat vector-like raster logo, minimal, calm, precise, institutional, strong silhouette, balanced negative space
Composition/framing: centered, perfectly upright, symmetric visual weight, generous clear margin around the mark, no element touches or crosses the canvas edge
Color palette: only MarketLens violet #7C73FF and deep navy #080B13, plus genuine transparency outside the rounded-square tile
Constraints: favicon-first design; no text, no letters, no numbers, no watermark, no trademark resemblance, no gradients, no 3D, no drop shadow, no glow, no texture, no photorealism, no green, no red, no extra decoration, no thin micro-details; render a single isolated icon, not a mockup or presentation sheet
Avoid: generic globe symbol, stock-chart app clone, busy background, tiny tick marks, axes, labels, reflections, lighting effects
```

One targeted edit prompt was used, as authorized by the SPEC:

```text
Use case: precise-object-edit
Asset type: MarketLens browser favicon and project avatar
Input images: Image 1 is the edit target
Primary request: change only the surface and color treatment of Image 1 into a truly flat two-color favicon
Preserve exactly: the centered rounded-square silhouette, circular lens geometry, three rising candlesticks, spacing, proportions, upright orientation, generous margin, and genuine transparency outside the rounded-square tile
Color palette: replace every violet pixel inside the tile with one uniform solid MarketLens violet #7C73FF; replace every dark glyph pixel with one uniform solid deep navy #080B13; retain anti-aliased boundary pixels only where required for crisp edges
Constraints: absolutely no gradient, lighting variation, highlight, glow, shadow, blur, texture, noise, bevel, depth, reflection, transparency inside the solid tile, text, letters, numbers, watermark, green, red, or extra elements; flat vector-like raster result; must remain legible at 16 by 16 pixels
Avoid: redesigning the symbol, changing composition, adding detail, soft rendering, mockup presentation
```

The edit output baked a checkerboard background and still contained tonal variation, so it was
rejected. The original output had the correct transparent geometry and became the deterministic
flat-color source. No additional model generation was used.

## Failures encountered and resolved

1. The initial generated image had the intended symbol but also gradient/glow. The one authorized
   targeted edit did not fix this cleanly and removed real alpha. Resolution: retain the initial
   transparent geometry and flatten it deterministically with the already-installed Sharp package.
2. The first one-off inline Node packaging command failed before execution because Windows native
   argument quoting stripped JavaScript string quotes. It created no favicon. Resolution: run the
   same packaging logic from an ignored temporary `.cjs` file under `.test-build`; the successful
   result was then tested. The temporary file was removed automatically by the fresh gauntlet.
3. The first gauntlet attempt passed tests/type/lint but failed inside its SHA helper because
   Windows PowerShell's .NET surface lacks `Convert.ToHexString`. Resolution: use compatible
   `BitConverter.ToString(...).Replace(...)`; rerun fresh from the beginning.
4. The second gauntlet attempt passed tests/type/lint/negative-control/build but failed before HTTP
   smoke because Windows PowerShell had not loaded `System.Net.Http`. Resolution: explicitly load
   the standard assembly with `Add-Type -AssemblyName System.Net.Http`; rerun fresh from the
   beginning.
5. The third and final fresh gauntlet passed every applicable layer. Only its numbers are reported
   as final evidence above.

## Skipped / not applicable layers

- Changed-line coverage: n/a for the sole production change, a binary favicon with no executable
  lines. Its binary contract is directly asserted and executed through Next.
- Production-code mutation tool: n/a because no production logic changed. The structural test uses
  the explicit corrupt-header negative control instead.
- Property-based testing: n/a; no algorithmic input domain or runtime function changed.
- Dependency vulnerability/license audit: n/a; manifests and lockfile are hash-identical and no
  dependency was added.
- Randomized-order suite health: not added for this Tier 1 binary asset. The complete existing Node
  inventory passed; no shared mutable test fixture or executable production branch was introduced.
- Browser automation: not used because browser-chrome favicon rendering is outside page screenshots.
  A real production Next server, HTTP asset identity check, and direct native-size payload review
  cover the requested surface more directly.
- Deployment: intentionally not performed per SPEC.

## Honest limitations

- Automated checks prove the file container, size inventory, Next metadata exposure, HTTP bytes,
  and regressions. They cannot prove subjective logo quality. That claim rests on the explicitly
  recorded 256/32/16 visual inspection and the human-approved visual contract.
- The final full-suite run included unrelated user-owned dirty frontend changes. The implementation
  commit path set and task bytes are exact and isolated, but the report does not claim a separate
  clean-clone test run.
- The in-repo report cannot contain the result of the push that transports its own commit without
  adding a third commit. Remote delivery is therefore verified and reported in the final handoff.
