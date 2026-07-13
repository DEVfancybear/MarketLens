# SMC Trading Terminal Design System

> **Canonical design contract:** This directory describes the implemented SMC Trading Terminal experience. It is manually curated for a professional trading product and must not be replaced with generic landing-page output.
>
> **Hierarchy:** Read this file first. Then apply the matching file in `pages/` as a platform-specific override. A page override may change density, layout, and interaction behavior, but never the semantic meaning of a shared token.

---

## Product Direction

**Design concept:** Institutional Command Center

The product is an operational trading workspace, not a marketing site. It should feel calm, precise, information-rich, and continuously available. The central chart is the dominant decision surface. Toolbars, market monitoring, orders, replay, analytics, and settings support that surface without competing with it.

### Visual character

- Deep navy-black or cool silver canvas, never pure black and never flat default gray.
- Layered terminal surfaces separated by restrained borders and controlled elevation.
- Violet is the brand and command color for focus, selection, navigation, and primary actions.
- Bull, bear, warning, and SMC colors are reserved for their data meanings.
- Dense desktop information architecture with deliberate grouping and breathing room.
- Touch-first mobile presentation with independent screens and 44px minimum controls.
- Subtle translucency is allowed for persistent chrome and modal context only; glass effects are not decoration.

### Core principles

1. **Chart first:** Preserve the chart viewport and keep overlays compact.
2. **Signal over ornament:** Every color, glow, badge, and animation must communicate state.
3. **Semantic parity:** Dark and light themes use the same roles, not literal color inversion.
4. **Platform independence:** Share business logic and tokens; do not reuse desktop composite layout on mobile.
5. **Fast recognition:** Prices, P/L, order side, connection state, and active tools must scan instantly.
6. **Stable geometry:** Hover, live ticks, and state changes must not move surrounding layout.

---

## Source of Truth and Runtime Mapping

The implementation currently maps this contract through:

- `src/app/globals.css` for theme variables, global states, and platform scopes.
- `tailwind.config.ts` for semantic Tailwind utilities.
- `.theme-dark` and `.theme-light` on the root element.
- `.desktop-terminal` and `.mobile-terminal` for platform density and layout behavior.
- `chartTheme.ts` and chart presentation helpers for canvas-rendered colors.

When a token changes, update its dark value, light value, RGB-channel mirror, Tailwind mapping, chart mapping where applicable, and contrast tests in the same change.

### Color utility contract

Each theme color that supports Tailwind opacity modifiers has two forms:

```css
--accent: #7c73ff;
--accent-rgb: 124 115 255;
```

Tailwind consumes the RGB form:

```ts
brand: "rgb(var(--accent-rgb) / <alpha-value>)"
```

This contract is required for utilities such as `bg-brand/10`, `border-bear/30`, and `bg-terminal-panel/95`. The hex and RGB values must always match.

---

## Semantic Color Tokens

### Foundation and surfaces

| Token | Dark | Light | Use |
|---|---:|---:|---|
| `--bg` | `#070A12` | `#EEF2F8` | Application canvas outside docked surfaces |
| `--panel` | `#0D121F` | `#FFFFFF` | Primary panel, toolbar, sheet, card |
| `--panel-2` | `#131A2A` | `#F7F9FC` | Secondary panel, segmented track, table head |
| `--panel-3` | `#192235` | `#EDF1F7` | Nested control and tertiary grouping |
| `--surface-raised` | `#1D2740` | `#FFFFFF` | Active tab, popover, menu, elevated control |
| `--chart-bg` | `#090D16` | `#FFFFFF` | Price chart canvas |

Surface order must remain visually legible in both themes. Use border and elevation to establish hierarchy; do not make every nested region a different color.

### Borders and interaction states

| Token | Dark | Light | Use |
|---|---:|---:|---|
| `--border` | `#232D43` | `#D9E0EB` | Low-emphasis dividers and panel boundaries |
| `--border-strong` | `#67778F` | `#8795A8` | Inputs, focused control boundaries, critical separators |
| `--hover` | `#182238` | `#EDF1F8` | Pointer hover and low-emphasis selection |
| `--pressed` | `#202D49` | `#E2E8F2` | Pointer/touch pressed feedback |

`--border` is intentionally quiet. Use `--border-strong` when the boundary is required to identify a control; control boundaries should maintain at least 3:1 non-text contrast.

### Text

| Token | Dark | Light | Use |
|---|---:|---:|---|
| `--text` | `#F2F5FB` | `#111827` | Primary labels, values, headings |
| `--text-muted` | `#9AA7BD` | `#56637A` | Secondary labels and supporting copy |
| `--text-faint` | `#8290A7` | `#667085` | Metadata, axes, timestamps, tertiary labels |

Normal text must meet WCAG AA 4.5:1. Faint text is still readable text, not a disabled-state shortcut. Disabled controls use semantics plus reduced emphasis and must remain identifiable.

### Brand and command color

| Token | Dark | Light | Use |
|---|---:|---:|---|
| `--accent` | `#7C73FF` | `#635BDB` | Focus, selected state, active navigation, command emphasis |
| `--accent-hover` | `#928BFF` | `#5148CD` | Theme-specific accent hover |
| `--accent-soft` | `rgba(124,115,255,.14)` | `rgba(99,91,219,.10)` | Selected background and low-emphasis tint |
| `--accent-contrast` | `#080B13` | `#FFFFFF` | Text/icon placed on solid accent |

Dark theme deliberately uses dark foreground on the brighter violet accent. Do not hardcode white text on dark-theme accent surfaces. Use `--accent-contrast`.

### Market and analysis semantics

| Role | Token | Dark | Light |
|---|---|---:|---:|
| Positive / bullish | `--bull` | `#24C99A` | `#067A65` |
| Negative / bearish | `--bear` | `#FF5D7D` | `#D9365A` |
| Break of structure | `--bos` | `#6F9CFF` | `#366DD8` |
| Change of character / warning | `--choch` | `#F3B95F` | `#A96609` |
| Fair value gap | `--fvg` | `#5EC8FF` | `#1683BA` |
| Order block | `--ob` | `#B47CFF` | `#7547B7` |
| Liquidity | `--liquidity` | `#F177C2` | `#BD367E` |

Rules:

- Violet remains the brand; green is not the generic primary CTA.
- Bull and bear only represent market direction, profit/loss, or corresponding order side.
- SMC colors belong to chart overlays, legends, filters, and related status labels.
- Never communicate state by color alone. Pair it with text, sign, icon, position, or pattern.

### Scrim, shadow, and glow

| Token | Dark | Light | Use |
|---|---|---|---|
| `--scrim` | `rgba(2,5,12,.72)` | `rgba(18,27,45,.48)` | Modal and sheet isolation |
| `--shadow-panel` | `0 14px 44px rgba(0,0,0,.46)` | `0 16px 42px rgba(41,55,82,.14)` | Menus, dialogs, sheets, floating chart actions |
| `--glow-accent` | Violet low-alpha ring and shadow | Violet low-alpha ring and shadow | Brand mark or selected premium surface only |

Use a glow on at most one focal element in a region. Avoid glowing tables, every active control, or chart data.

---

## Typography

### Families

- **UI:** `Inter`, then the declared system sans stack.
- **Data/code:** `JetBrains Mono`, then the declared system mono stack.
- Use `.tnum` for tabular figures in the UI sans face.
- Use `.tabular` or the mono family for strict column alignment, code, logs, and dense price metrics.

### Roles

| Role | Desktop | Mobile | Weight | Notes |
|---|---|---|---:|---|
| Screen title | 20-24 / 28-30 | 24 / 30 | 700-750 | Tight tracking, sentence case |
| Panel title | 13-15 / 18-20 | 15-17 / 20-24 | 700 | Clear hierarchy without oversized headers |
| Body | 13 / 20 | 15 / 22 | 400-500 | Default readable content |
| Control | 11-12 / 16 | 12-14 / 18 | 600-700 | Buttons, tabs, segmented controls |
| Metadata | 10-11 / 16 | 11-12 / 16 | 500-700 | Timestamps, venues, secondary metrics |
| Numeric KPI | 14-20 / 20-26 | 16-30 / 22-34 | 600-750 | Tabular figures; avoid width shift |

Text at 9-10px is limited to paired micro-labels such as chart HUD metadata or icon-supported navigation. It must never carry the only copy needed to complete a task. Mobile inputs use at least 16px text to prevent browser zoom.

### Language and labels

- Use short operational language: `Place order`, `Close all`, `Replay`, `Market desk`.
- Use sentence case for actions and headings.
- Reserve uppercase plus tracking for short category labels and terminal metadata.
- Format numbers, currencies, percentages, dates, and time zones consistently.

---

## Spacing, Shape, and Density

The system follows a 4px base rhythm with 2px and 6px exceptions for dense alignment.

| Step | Value | Typical use |
|---|---:|---|
| 0.5 | 2px | Hairline optical adjustment |
| 1 | 4px | Tight inline gap, segmented padding |
| 2 | 8px | Control groups, desktop panel gutter |
| 3 | 12px | Control padding, compact card padding |
| 4 | 16px | Mobile screen gutter, dialog content |
| 5 | 20px | Section grouping |
| 6 | 24px | Major section separation |
| 8 | 32px | Empty state and large composition gap |

### Radius scale

- 6px: small status badge and dense inner control.
- 8px: desktop buttons, tabs, and terminal controls.
- 10-12px: desktop panels, grouped controls, floating chart actions.
- 13-16px: mobile cards, lists, inputs, and content surfaces.
- 18-20px: bottom sheets and featured balance/KPI surfaces.
- Full circle/pill: avatars, drag handles, status dots, compact collapse handles.

Rounded geometry should communicate grouping and elevation. Do not convert every row into an isolated card on desktop.

---

## Layout and Platform Architecture

### Shared layer

Desktop and mobile share:

- Theme semantics and color meaning.
- Stores, services, validation, formatting, API clients, and chart engine.
- Accessibility behavior and state naming.
- Primitive contracts where density is an explicit variant.

They do not share composite presentation when interaction density differs. A desktop rail, ten-column table, hover menu, or draggable modal must not be placed unchanged inside a mobile sheet.

### Desktop density

- Full viewport command center with 56px top toolbar.
- Pointer-oriented controls generally use 32-36px visual height.
- Dock and panel gutters use 8px.
- Main panels use a 12px radius with quiet border and minimal shadow.
- Left drawing rail, chart, right market desk, and bottom workspace remain independently resizable where implemented.

### Mobile density

- Full `100dvh` application shell with safe-area-aware top and bottom chrome.
- Minimum touch target is 44x44px; preferred navigation target is 48px or larger.
- Primary mobile inputs are at least 44px high with 16px text.
- Mobile screens use 12-16px horizontal gutters and cards with 13-16px radius.
- Bottom navigation contains exactly five labeled top-level destinations.

See `pages/desktop-terminal.md` and `pages/mobile-terminal.md` for exact composition rules.

---

## Component Contracts

### Buttons and icon controls

- Primary: solid accent with `--accent-contrast`; one primary action per local workflow.
- Secondary: panel or transparent background with strong border when boundary is required.
- Ghost: transparent, muted text, hover/pressed state layers.
- Destructive: bear semantic with explicit destructive label.
- Selected toggle: accent text, accent-soft background, and selected semantics such as `aria-pressed`.
- Icon-only controls require an accessible name and a visible tooltip on pointer platforms.
- Disabled controls use the native disabled attribute, no pointer action, and visibly reduced emphasis.
- Pressed feedback must not translate layout or change control dimensions.

### Fields and form controls

- Every field has a visible label or a programmatically associated label when compact chart UI requires one.
- Use helper text for non-obvious formats and inline error text near the field.
- Focus uses a 2px accent ring or equally visible focus treatment.
- Desktop compact controls may be 32-36px high; mobile controls are at least 44px.
- Read-only and disabled states are visually and semantically different.

### Menus, popovers, and tooltips

- Use `--surface-raised`, `--border-strong`, and `--shadow-panel`.
- Menus support Escape, arrow-key navigation, focus return, pointer/touch outside dismissal, and viewport collision handling.
- Do not rely on hover to expose a critical action.
- Context-menu actions require a visible mobile alternative.

### Dialogs and sheets

- Desktop uses centered or draggable dialogs only where moving the dialog helps inspect the chart.
- Mobile uses bottom sheets or full-screen sheets; do not shrink a desktop dialog into the viewport.
- All modal surfaces provide focus containment, Escape/close behavior, focus return, a visible close action, and an isolated scrim.
- Destructive confirmations clearly identify the object and result.
- Unsaved work requires confirmation before dismissal.

### Panels and tables

- Panel headers establish title, state, and local actions without taking excessive chart space.
- Desktop data tables use sticky headers, tabular figures, aligned numeric columns, row hover, semantic headers, and compact 30-36px rows.
- Mobile translates dense tables into cards or structured lists; horizontal ten-column tables are forbidden.
- Empty, loading, and error states occupy the same reserved area to avoid layout shift.

### Chart and trading data

- Chart grid and borders remain subordinate to candles and drawings.
- Bull/bear data must retain readable shape and sign in addition to color.
- Exact values are available on pointer hover and touch interaction.
- Chart overlays must not block pan, zoom, crosshair, drawing, or system gestures.
- Performance-sensitive animation is limited to transform, opacity, or color.

### Feedback

- Tap/press feedback begins within 100ms.
- Loading longer than 300ms uses a skeleton or progress indicator.
- Toasts announce through a polite live region and do not steal focus.
- Errors state the cause and the recovery action.

---

## Motion

| Motion role | Duration | Use |
|---|---:|---|
| Immediate feedback | 80-100ms | Press highlight, context pop |
| Standard state | 160ms | Hover, active, border, color |
| Sheet/dialog | 180-240ms | Transform and opacity entrance/exit |
| Live tick flash | Up to 560ms | Color-only quote feedback |

- Use `cubic-bezier(.16,1,.3,1)` or an equivalent ease-out for sheet entrance.
- Exit is shorter than entrance when separate durations are used.
- Do not animate width, height, top, or left during continuous interaction.
- All animations are interruptible.
- `prefers-reduced-motion: reduce` collapses decorative and repeated motion to near-zero duration.
- No boot sequence, typewriter loop, scanline, parallax, or full-page transition overlay belongs in this product.

---

## Accessibility Requirements

- Normal text contrast: at least 4.5:1.
- Large text and non-text UI boundaries: at least 3:1 where required for identification.
- Visible 2px focus treatment on all keyboard-operable controls.
- Logical DOM and focus order follows the visible workspace.
- Icon-only buttons have accessible names.
- Selected, expanded, busy, invalid, and disabled states are announced semantically.
- Color is never the sole market or status indicator.
- Drag, swipe, right-click, and hover interactions have visible alternatives.
- Mobile touch targets are at least 44x44px with sufficient spacing.
- Fixed mobile chrome respects safe-area insets and does not obscure scroll content.
- Browser zoom remains enabled.
- Lucide is the established vector icon family; do not use emoji as structural icons.

---

## Layering Rules

Use layers by role, not arbitrary visual escalation:

1. Base canvas and panels.
2. Sticky headers and resizers.
3. Chart controls and floating local actions.
4. Menus, popovers, and context menus.
5. Drawers and sheets.
6. Dialog stack and scrim.
7. Toasts and critical system feedback.
8. Tooltips above the active surface.

An element should never use an extreme z-index merely to compensate for an incorrect portal or stacking context.

---

## Forbidden Patterns

- Generic landing-page hero, benefits, CTA, and footer structure inside the terminal.
- Green as a generic brand CTA or violet used for market profit.
- Hardcoded chrome colors inside feature components.
- White text hardcoded on dark-theme violet surfaces.
- Desktop tables, rails, compact actions, or hover-only controls reused unchanged on mobile.
- Tiny mobile controls or gesture-only critical actions.
- Emoji used as navigation or system icons.
- Decorative neon, ambient blobs, scanlines, typewriter effects, or excessive glass blur.
- Large card grids that reduce chart space without improving decisions.
- Layout-shifting hover transforms.
- Invisible focus rings, placeholder-only labels, or color-only state.
- Motion longer than 400ms for ordinary UI state changes.
- Disabling zoom or blocking platform navigation gestures.

---

## Delivery Checklist

### Theme and visual consistency

- [ ] Dark and light modes are checked independently.
- [ ] Hex and RGB token mirrors match.
- [ ] No UI chrome bypasses semantic tokens.
- [ ] Accent, bull/bear, and SMC colors preserve their assigned meaning.
- [ ] Chart colors match the application theme contract.

### Desktop

- [ ] Verified at 1024, 1440, and 1920px widths.
- [ ] Chart remains the dominant surface.
- [ ] Resizers, drawers, menus, and keyboard focus work without clipping.
- [ ] Dense text remains legible and numeric columns remain stable.

### Mobile

- [ ] Verified at 360/375/390px and landscape orientation.
- [ ] All primary targets are at least 44x44px.
- [ ] Inputs use at least 16px text.
- [ ] Safe areas and fixed bottom navigation do not cover content.
- [ ] No horizontal overflow from desktop composite UI.

### Accessibility and motion

- [ ] Contrast meets WCAG AA.
- [ ] Keyboard, screen-reader names, and focus return are verified.
- [ ] Gesture and hover interactions have visible alternatives.
- [ ] Reduced-motion mode is verified.
- [ ] Loading, empty, error, and disabled states are present and distinguishable.
