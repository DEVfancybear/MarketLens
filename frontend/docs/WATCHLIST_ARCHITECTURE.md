# Watchlist Architecture

Last updated: 2026-07-06

## Goal

The Watchlist should behave like TradingView while staying compatible with the existing frontend
data flow. It currently remains browser-local until backend persistence is implemented.

## Source Files

- `frontend/src/components/watchlist/Watchlist.tsx`
- `frontend/src/store/watchlistStore.ts`
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

## Future Backend Sync

When backend watchlist persistence lands:

1. Keep `watchlistSymbolsAtom` as the UI compatibility contract.
2. Hydrate active-list metadata from the backend after auth bootstrap.
3. Continue writing the legacy `watchlist` key until all older consumers are removed.
4. Add conflict handling for multiple browser tabs/devices.
