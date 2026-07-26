# Timeframe Keyboard Shortcuts

## Purpose

The chart supports TradingView-style quick interval entry without requiring the
pointer to leave the chart. Pressing a digit starts an interval prompt with that
digit already entered. Pressing comma opens the same prompt empty.

Official behavior references:

- [How to change the time frame quickly](https://www.tradingview.com/support/solutions/43000762824-how-to-change-the-time-frame-quickly/)
- [Advanced Charts keyboard shortcuts](https://www.tradingview.com/charting-library-docs/latest/getting_started/Shortcuts/)

TradingView accepts arbitrary custom intervals. This terminal deliberately
accepts only intervals represented by the shared `Timeframe` type and supported
by the market-data backend.

## User Contract

| Input | Result |
| --- | --- |
| `1`, `3`, `5`, `15`, `30` | Minute intervals |
| `60`, `120`, `240` | `1H`, `2H`, `4H` minute aliases |
| `1440` | `1D` minute alias |
| `1H`, `2H`, `4H` | Hour intervals |
| `1D`, `1W`, `1M` | Day, week, and month intervals |
| `,` | Open an empty interval prompt |
| `Enter` | Apply a valid interval |
| `Escape` | Close without changing the interval |

Lowercase `m` means minutes; uppercase `M` means months. Hour, day, and week
suffixes are case-insensitive.

Unsupported input stays visible, exposes an error through the live status
region, and keeps the apply button disabled. Examples currently rejected by
design include `10`, `3H`, and `12D`.

## Activation Boundary

The global listener ignores:

- `Ctrl`, `Meta`, or `Alt` chords;
- inputs, textareas, selects, and content-editable regions;
- already-prevented keyboard events; and
- any open `aria-modal="true"` dialog.

This prevents interval entry from stealing text typed in Symbol Search, Pine
Editor, settings forms, or other modal workflows.

The prompt is a non-modal `role="dialog"` surface. It autofocuses the input,
places the caret after the initial digit, announces validation changes through
`role="status"`, and returns control to the chart when closed.

## Drawing Shortcut Compatibility

Bare digits are reserved for interval entry. Existing numeric drawing
shortcuts moved to `Shift+1` through `Shift+9`; modifier-based drawing shortcuts
such as `Alt+T`, `Alt+H`, `Alt+J`, `Alt+V`, `Alt+C`, and `Alt+Shift+R` are
unchanged.

Browsers report `Shift+1` as `event.key === "!"`. `useHotkeys` therefore
normalizes shifted number-row events from `KeyboardEvent.code` before resolving
the manifest chord. Do not remove that normalization or reintroduce bare digit
chords into the drawing manifest.

## Ownership

| Concern | Owner |
| --- | --- |
| Global listener, prompt, focus, and apply behavior | `src/components/toolbar/QuickTimeframeSwitcher.tsx` |
| Parsing and supported aliases | `src/components/toolbar/timeframeSelectorModel.ts` |
| Chart state transition | `setTimeframeAtom` in `src/store/chartStore.ts` |
| Runtime mount | `src/components/layout/GlobalRuntime.tsx` |
| Drawing chord metadata | `src/types/drawingToolManifest.ts` |

`QuickTimeframeSwitcher` must remain mounted once at the global runtime level.
It should not be duplicated per chart pane: `setTimeframeAtom` already targets
the active pane projection managed by the chart layout store.

## Regression Coverage

Pure model coverage lives in:

- `tests/ui/timeframeSelectorModel.test.ts`
- `tests/drawing/toolManifest.test.ts`

Rendered interaction coverage lives in:

- `tests/browser/timeframeHotkey.spec.ts`

The browser suite verifies initial digit capture, continued multi-digit entry,
minute aliases, comma activation, invalid input, `Enter`, `Escape`, editable
field isolation, and shifted drawing shortcuts.

Run the focused checks from `frontend`:

```powershell
npm.cmd run typecheck
npm.cmd run test:ui
npm.cmd run test:drawing
npx.cmd playwright test tests/browser/timeframeHotkey.spec.ts
```

When adding a new backend-supported timeframe:

1. Extend `Timeframe`, `TIMEFRAMES`, and `TF_SECONDS`.
2. Add it to the timeframe selector catalog.
3. Extend `customIntervalToTimeframe` and `resolveTimeframeShortcut`.
4. Add positive model and browser coverage.
5. Confirm favorites, layout persistence, replay, drawing visibility, and
   market-data requests accept the new value.
