# UI Design System

_Last updated: 2026-07-12_

This document is the source of truth for the terminal's visual language and
workspace shell. The current direction is **Institutional Pro** with balanced,
compact density: high information throughput, clear hierarchy, restrained
motion, and chart-first composition.

## Product Principles

1. The chart is the primary workspace. Chrome and docks must not compete with
   market data.
2. Application actions and chart commands have separate hierarchy. The first
   header row owns workspace/session actions; the second owns symbol, interval,
   studies, replay, layout, and chart panel controls.
3. Desktop uses resizable docks. Tablet and phone use an overlay drawer for the
   right panel so the chart retains usable width.
4. Dense does not mean cramped. Desktop controls are normally 32-36px high;
   coarse-pointer controls expand to at least 44px.
5. Color communicates state but is never the only state indicator.

## Shell Anatomy

```text
app bar: product / workspace                  connection / global actions
command bar: symbol / interval / studies      chart / panel actions
left tool rail | chart workspace | right dock or responsive drawer
                 optional resizable bottom dock
```

`TerminalLayout.tsx` owns the shell. Its main regions use the shared
`workspace-surface` treatment rather than ad-hoc borders and backgrounds.
`TopToolbar.tsx` owns the two-row header hierarchy.

## Theme Tokens

Theme variables live in `src/app/globals.css` and are mapped into Tailwind by
`tailwind.config.ts`. Components should use semantic utilities instead of raw
hex colors.

| Purpose | CSS variable | Tailwind examples |
| --- | --- | --- |
| Application background | `--bg` | `bg-terminal-bg` |
| Primary surface | `--panel` | `bg-terminal-panel` |
| Secondary surface | `--panel-2` | `bg-terminal-panel-2` |
| Floating surface | `--surface-elevated` | `bg-terminal-elevated` |
| Input surface | `--input` | `bg-terminal-input` |
| Borders | `--border`, `--border-strong` | `border-terminal-border` |
| Primary text | `--text` | `text-ink` |
| Secondary text | `--text-muted` | `text-ink-muted` |
| Low emphasis text | `--text-faint` | `text-ink-faint` |
| Primary action/focus | `--accent` | `text-brand`, `bg-brand` |
| Secondary signal | `--accent-2` | `text-signal`, `bg-signal` |
| Market up/down | `--bull`, `--bear` | `text-bull`, `text-bear` |

Dark and light themes must be designed together. Do not assume a dark-theme
hardcode remains legible in light mode. The compatibility selectors in
`globals.css` temporarily map legacy TradingView palette utilities to semantic
tokens; new code must not add more legacy hex utilities.

## Typography And Density

- UI: Fira Sans when available, followed by Segoe UI Variable/system fallback.
- Data/code: Fira Code when available, followed by Cascadia Code/monospace.
- Prices and changing numeric values use tabular figures.
- Primary UI text is 12-13px on desktop. Micro labels may use 10-11px only when
  contrast and uppercase tracking preserve readability.
- Spacing follows a 4px base rhythm.

## Components

### Icon buttons

Use `IconButton`. Every icon-only control requires a `label`. Active state uses
an accent-tinted surface plus a border; disabled state uses the native
`disabled` attribute.

### Dropdowns

Use `Dropdown`, which renders through a body portal to avoid toolbar and panel
overflow clipping. Choose one scroll owner:

- `scrollMode="menu"`: the primitive scrolls the entire menu.
- `scrollMode="content"`: the feature supplies exactly one internal scroll
  region and keeps headers/search fields fixed.

Never combine primitive scrolling with another `overflow-auto` descendant.
Scrollable content should use `overscroll-contain` and stable scrollbar gutter.

### Focus

Global focus-visible outlines cover native controls. Inputs using
`outline-none` must provide an explicit `focus:*` style or put focus treatment
on a containing control with `focus-within:*`. Do not show simultaneous focus
rings on both an input and its container.

### Panels and tabs

Panel tabs use bordered, rounded active surfaces. Right and bottom panels use
the same visual hierarchy; active state is not conveyed by color alone.

## Responsive Policy

`useViewportMode` is the only viewport classification source:

- Phone: up to 767px.
- Tablet: 768-1023px.
- Desktop: 1024px and above.

The right dock closes when entering phone/tablet mode and reopens as an overlay
drawer only on explicit user action. Browser zoom remains enabled. The shell
uses `dvh` and touch targets expand for coarse pointers.

## Motion And Layering

- Interaction transitions: about 150-200ms.
- Motion communicates state changes; avoid decorative continuous animation.
- Respect `prefers-reduced-motion` globally.
- Keep the layer order predictable: workspace, floating tools, drawers,
  dropdowns/dialogs, then toasts.

## Validation

Before merging UI changes, run:

```bash
npm run typecheck
npm run lint
npm run test:ui
npm run build
```

Also verify 390x844, 768x1024, 1024x768, 1366x768, and 1920x1080. Check both
themes, keyboard focus, browser zoom, reduced motion, popup clipping, and that
each popup exposes only one scrollbar.
