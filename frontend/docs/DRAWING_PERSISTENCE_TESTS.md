# DRAWING PERSISTENCE TESTS — Phase 4.2

_Date: 2026-06-25._

## Test matrix

| Test | Steps | Expected |
|---|---|---|
| Create + refresh | Draw a trendline, refresh page | Trendline reappears |
| Create + symbol switch | Draw on BTCUSDT, switch to ETHUSDT | ETHUSDT shows its own drawings (or none) |
| Switch back | Switch back to BTCUSDT | Trendline reappears |
| Wave D snapshot reload | Create Anchored VWAP/profile, refresh or switch away/back | Stored capped OHLCV snapshot reproduces identical geometry without reading current candles |
| Rich-content sanitization | Decode oversized table, unsafe image URL, or unapproved social URL | Content is capped/sanitized; scripts, non-HTTPS URLs, and unapproved hosts do not persist |
| Create + timeframe switch | Draw on 15m, switch to 1H | Drawing still appears (drawings scoped to symbol, not TF) |
| Modify + refresh | Draw, drag to new position, refresh | New position persists |
| Delete + refresh | Draw, delete, refresh | Drawing is gone |
| Multiple drawings | Create 5 drawings, refresh | All 5 reappear in correct position |
| Locked + refresh | Draw, lock via context menu, refresh | Locked state persists |
| Hidden + refresh | Draw, hide via context menu, refresh | Hidden state persists |
| LineStyle + refresh | Create with custom style (future), refresh | Style persists |

## Persistence mechanism

- Storage: `localStorage`
- Key: `drawings:<symbol>` (e.g. `drawings:BTCUSDT`)
- Format: `Drawing[]` (JSON serialized)
- Trigger: every state mutation (add, update, remove, clear)
- Hydrate: on `chartStore.setSymbol()` → reads from localStorage → sets `drawings[]`

## Symbol isolation

```
localStorage:
  drawings:BTCUSDT  → [{ id: "dw_1", tool: "trendline", ... }, ...]
  drawings:ETHUSDT  → [{ id: "dw_5", tool: "horizontal", ... }]
  drawings:EURUSD   → []
```

Switching symbols swaps the entire drawings array. No cross-contamination.
