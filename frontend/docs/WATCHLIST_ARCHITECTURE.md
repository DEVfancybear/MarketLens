# Watchlist Architecture

Last updated: 2026-07-06

## Goal

The Watchlist should behave like TradingView while staying compatible with the existing frontend
data flow. It currently remains browser-local until backend persistence is implemented.

## Source Files

- `frontend/src/components/watchlist/Watchlist.tsx`
- `frontend/src/store/watchlistStore.ts`
- `frontend/src/store/watchlistLayout.ts`
- `frontend/src/hooks/useMarketDataBootstrap.ts`

## Data Model

The legacy contract is a flat symbol array stored in localStorage key `watchlist`.

The current implementation adds list metadata while keeping that legacy key synchronized:

- `watchlist:lists` stores named lists, sharing state, symbols, and section rows.
- `watchlist:activeId` stores the active list id.
- `watchlist` stores the active list symbols for older code paths.

This compatibility is important because chart context menus and market-data bootstrap still consume
`watchlistSymbolsAtom`.

## Store Atoms

Read atoms:

- `activeWatchlistAtom`
- `watchlistSymbolsAtom`
- `watchlistSectionsAtom`

Write atoms:

- `addToWatchlistAtom`
- `removeFromWatchlistAtom`
- `setWatchlistSymbolsAtom`
- `renameWatchlistAtom`
- `setWatchlistSharedAtom`
- `copyWatchlistAtom`
- `createWatchlistAtom`
- `clearWatchlistAtom`
- `addWatchlistSectionAtom`
- `renameWatchlistSectionAtom`
- `removeWatchlistSectionAtom`
- `moveWatchlistSymbolAtom`

Pure section/order rules live in `watchlistLayout.ts`:

- section title normalization
- section delete without deleting symbols
- symbol removal with section-index repair
- symbol drag/drop before a section or inside a section
- token-based section targeting when multiple sections share the same symbol index

The token model is important for this TradingView case:

```text
DOGE
SECTION 1
SECTION 2
ETH
```

`SECTION 1` and `SECTION 2` can both start at the same symbol index. A drop on a specific section
must target that section token, not only the numeric symbol index. `moveSymbolToSectionInList()`
rebuilds the row order from section/symbol tokens, inserts the dragged symbol before or after the
target section token, then derives section indexes back from the resulting token stream.

Section header rows are treated as "drop inside section" targets. Moving a symbol outside all
sections is handled by the unsectioned drop target at the top of the Watchlist/header area. This
keeps empty trailing sections easy to target while still allowing symbols to be pulled out of a
section into the ungrouped top area.

Watchlist symbol drag/drop is pointer-based, not native HTML `draggable`. Native drag produced a
browser screenshot ghost of the row/list and inconsistent drop events in dense section layouts. The
component now tracks pointer movement, resolves the hovered row token with `elementFromPoint()`, and
renders a small ticker ghost with `pointer-events: none`.

## UI Behavior

The Watchlist title opens a TradingView-style dropdown with:

- Share list
- Make a copy
- Rename
- Add section
- Clear list
- Create new list

The menu intentionally omits unsupported TradingView actions:

- Add alert on the list
- Upload list
- Open list

Rename mode replaces the header label with a focused input, selects the current text, saves on
Enter/blur, and cancels on Escape.

Section rows are rendered as full-width blue rows with a chevron and uppercase title. Adding a
section inserts it above the selected symbol when possible, otherwise at the end of the active list.
Double-clicking a section title opens inline rename mode. Section delete removes only the header and
leaves symbols in place. Symbols are draggable; dropping on the top half of a section places the
symbol before the section, while dropping on the lower half places it inside the section.

## Future Backend Sync

When backend watchlist persistence lands:

1. Keep `watchlistSymbolsAtom` as the UI compatibility contract.
2. Hydrate active-list metadata from the backend after auth bootstrap.
3. Continue writing the legacy `watchlist` key until all older consumers are removed.
4. Add conflict handling for multiple browser tabs/devices.
