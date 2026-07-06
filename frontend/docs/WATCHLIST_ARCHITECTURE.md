# Watchlist Architecture

Last updated: 2026-07-07

## Goal

The Watchlist should behave like TradingView while staying compatible with the existing frontend
data flow. Authenticated bootstrap can hydrate flat watchlist lists/symbols from the backend; section
metadata and local edits still use the existing frontend store until write-back and section
persistence are added.

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
- `moveWatchlistSectionAtom`

Pure section/order rules live in `watchlistLayout.ts`:

- section title normalization
- section delete without deleting symbols
- symbol removal with section-index repair
- symbol drag/drop before a section or inside a section
- section divider drag/drop before/after symbols or other section dividers
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
`moveSectionInList()` uses the same token stream for section-header dragging, so moving a section
row changes the divider boundary exactly like TradingView: symbols below the moved divider become
part of that section without mutating the symbol order itself.

Section header rows are treated as "drop inside section" targets. The UI also infers the active
section from the pointer Y position inside the scroll body, so an empty trailing section remains
droppable even when the pointer is below its 26px header row. Moving a symbol outside all sections
is handled by the unsectioned drop target at the top of the Watchlist/header area. This keeps empty
trailing sections easy to target while still allowing symbols to be pulled out of a section into
the ungrouped top area.

Watchlist symbol drag/drop is pointer-based, not native HTML `draggable`. Native drag produced a
browser screenshot ghost of the row/list and inconsistent drop events in dense section layouts. The
component now tracks pointer movement, resolves the hovered row token with `elementsFromPoint()`,
and renders a small ticker ghost with `pointer-events: none`. The ghost is moved imperatively with
`requestAnimationFrame()` and CSS `transform`, so pointer movement does not re-render every row in
the list on every pixel. `pointerup` performs one final hit-test at the release coordinates instead
of trusting React state from the last `pointermove`; that avoids stale drop targets when a release
happens immediately after the cursor crosses into a new section.

The drop affordance is a horizontal insertion line:

- dropping outside sections shows the line in the top unsectioned strip,
- dropping on a section shows the line under the section header,
- dropping on a symbol shows the line above or below that symbol based on pointer position.

Rows still fade while dragged, but the list itself does not animate as a grouped screenshot. This
matches the TradingView feel more closely and keeps dense watchlists readable while reordering.

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
leaves symbols in place. Section rows are draggable divider tokens; dropping a section before/after
a symbol or another section repositions the group boundary. Symbols are draggable; dropping on a
section header or the section's empty body moves the symbol inside that section, while the dedicated
top drop strip moves it back outside all sections.

## Backend Sync

Current backend watchlist persistence stores list metadata and flat symbols. Frontend bootstrap
hydrates those lists after auth through `/api/v1/sync/bootstrap`, but UI mutations and section
metadata are not written back yet.

Next sync steps:

1. Keep `watchlistSymbolsAtom` as the UI compatibility contract.
2. Add write-through mutations for create/rename/delete list and add/remove/reorder symbols.
3. Extend the backend contract before syncing section rows, because current Phase 6 only persists
   flat symbols.
4. Continue writing the legacy `watchlist` key until all older consumers are removed.
5. Add conflict handling for multiple browser tabs/devices.
