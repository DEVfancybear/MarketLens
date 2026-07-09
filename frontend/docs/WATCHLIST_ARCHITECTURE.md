# Watchlist Architecture

Last updated: 2026-07-09

## Goal

The Watchlist should behave like TradingView while treating backend Phase 6 as the source of truth.
Frontend Jotai state is only an optimistic in-memory cache; browser localStorage is no longer used
for watchlist lists, active list, symbols, sections, or reorder state.

## Source Files

- `frontend/src/components/watchlist/Watchlist.tsx`
- `frontend/src/store/watchlistStore.ts`
- `frontend/src/store/watchlistLayout.ts`
- `frontend/src/hooks/useMarketDataBootstrap.ts`
- `frontend/src/services/api/resources/watchlistsApi.ts`

## Data Model

Backend-owned model:

- `/api/v1/sync/bootstrap` reads server-owned watchlists during authenticated bootstrap.
- `/api/v1/watchlists` lists/creates/deletes named lists.
- `/api/v1/watchlists/active` persists the active list id.
- `/api/v1/watchlists/:id` renames/reorders list metadata and updates `shared`,
  `sortKey`, and `sortDir`.
- `/api/v1/watchlists/:id/layout` replaces the full ordered symbol array and section rows.

Frontend-owned runtime:

- `watchlistStore.ts` performs optimistic in-memory updates so the UI responds immediately.
- `watchlistSymbolsAtom` remains the compatibility read contract for chart context menus and
  market-data subscriptions.
- `watchlistsApi.ts` is the only watchlist network boundary and uses `ky` through the shared API
  client.
- If the backend session is unavailable, the UI can still mutate the in-memory cache for the
  current tab, but it is intentionally not persisted to localStorage.

## MT5 Catalog Cleanup

The MT5 symbol catalog is the only source of tradable/displayable symbols. Watchlists are loaded
from the backend and may contain stale symbols from older providers or previous migrations. The
frontend therefore sanitizes every remote watchlist against the current MT5 catalog before rows can
drive chart, history, drawing, or quote API calls.

Cleanup rules:

- `applyRemoteWatchlistsAtom` normalizes backend rows first, then removes symbols that are not in
  the loaded MT5 catalog.
- `refreshMt5SymbolCatalogAtom` runs the same sanitizer after `/api/v1/mt5/symbols` succeeds, which
  covers the startup order where bootstrap arrives before the catalog.
- Valid legacy aliases are migrated only when the target symbol exists in the MT5 catalog, for
  example older Binance-style `BTCUSDT`/`ETHUSDT` rows can become `BTCUSD`/`ETHUSD`.
- Invalid symbols are not clickable in the Watchlist. This prevents empty downstream calls such as
  `GET /api/v1/drawings?symbol=ETCUSD` or empty history requests when the broker catalog does not
  expose that symbol.
- Sanitized layouts are written back through `PUT /api/v1/watchlists/:id/layout` so stale symbols do
  not return on the next refresh.

The cleanup code lives in pure layout helpers (`sanitizeListForCatalog`) plus store integration in
`watchlistStore.ts`; tests live in `frontend/tests/watchlist/watchlistLayout.test.ts`.

## Store Atoms

Read atoms:

- `activeWatchlistAtom`
- `watchlistSymbolsAtom`
- `watchlistSectionsAtom`
- `watchlistSortKeyAtom`
- `watchlistSortDirAtom`

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
- `setWatchlistSortAtom`

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

- Saved list selector with per-list delete when more than one list exists
- Rename
- Add section
- Clear list
- Create new list

The menu intentionally omits unsupported TradingView actions:

- Share list
- Make a copy
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

The Sort by menu is live for both plain and sectioned lists:

- `Symbol name` sorts alphabetically.
- `Last price`, `Change`, `Change %`, and `Volume` sort from realtime quote data.
- Clicking the active sort key toggles `asc`/`desc`.
- For sectioned lists, sorting happens inside each section group so section headers keep their
  TradingView-style grouping role instead of floating away from their symbols.
- Sort ordering uses a quote snapshot when the user selects/toggles sort or changes list/layout.
  Realtime ticks update each `WatchRow` price/change cell, but they do not continuously reorder the
  parent list. This prevents dense watchlists from jumping every tick when values are close.

## Backend Sync

Backend watchlist persistence stores list metadata, active list preference, ordered symbols, section
rows, the `shared` flag, and sort preference (`sortKey`/`sortDir`). Frontend bootstrap hydrates
those lists after auth through
`/api/v1/sync/bootstrap`. If the backend has no watchlists yet, `useWorkspaceBootstrap()` creates a
server-side default list with `POST /api/v1/watchlists` and applies the returned id.

Implemented Phase 6 write-through:

- Set active list: optimistic active id, then `PUT /api/v1/watchlists/active`.
- Create list: optimistic list, then `POST /api/v1/watchlists`, replacing the temporary id with the
  backend id and saving layout.
- Rename list/shared flag/sort preference: optimistic metadata update, then
  `PATCH /api/v1/watchlists/:id`.
- Delete list: optimistic removal, then `DELETE /api/v1/watchlists/:id` and active preference sync.
- Add/remove/clear symbol: optimistic local layout update, then
  `PUT /api/v1/watchlists/:id/layout`.
- Add/rename/delete section: optimistic local layout update, then
  `PUT /api/v1/watchlists/:id/layout`.
- Symbol/section drag-drop reorder: optimistic local layout update, then
  `PUT /api/v1/watchlists/:id/layout`.

Known Phase 6 limits:

- Conflict handling for multiple browser tabs/devices is still pending.
- The compatibility `POST/DELETE /symbols` endpoints remain for older clients, but the frontend uses
  the full-layout endpoint for every modern watchlist gesture.
