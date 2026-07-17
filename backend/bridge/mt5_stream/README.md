# MT5 Tick Stream Bridge

This sidecar streams live MT5 ticks from a locally installed MetaTrader 5 terminal to a localhost
WebSocket server. The Go backend can then consume MT5 data without linking against Python or C++ MT5
APIs.

## Architecture

```text
MetaTrader 5 terminal
  -> Python MetaTrader5 package
  -> bridge/mt5_stream/mt5_server.py
  -> ws://localhost:8765
  -> go run ./cmd/mt5-stream
```

This is a local development/runtime bridge. It does not use external cloud services.

## Requirements

- Windows host with MetaTrader 5 installed.
- MT5 terminal logged into a demo or live account.
- Python packages from `requirements.txt`.
- Go backend dependency `github.com/gorilla/websocket`.

Install Python dependencies from `backend/`:

```bash
python -m pip install -r bridge/mt5_stream/requirements.txt
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `MT5_SYMBOLS` | empty | Comma-separated extra symbols to stream, for example `EURUSD,GBPUSD,XAUUSD` |
| `MT5_STREAM_ALL_VISIBLE` | `true` | Stream every MT5 symbol currently marked visible. When enabled, `MT5_SYMBOLS` is added on top of visible symbols |
| `MT5_STREAM_HOST` | `localhost` | WebSocket listen host |
| `MT5_STREAM_PORT` | `8765` | WebSocket listen port |
| `MT5_POLL_INTERVAL_MS` | `100` | Tick polling interval |
| `MT5_HISTORY_BARS` | `1500` | Default bars returned for a history request |
| `MT5_HISTORY_TIMEFRAMES` | `1m,3m,5m,15m,30m,1H,2H,4H,1D,1W,1M` | Timeframes eligible for optional preload |
| `MT5_PRELOAD_HISTORY` | `false` | Preload history for streamed symbols on connect; normally leave false and use on-demand requests |
| `MT5_HISTORY_SYNC_RETRIES` | `2` | Retry budget when MT5 returns empty history during cold start |
| `MT5_HISTORY_SYNC_DELAY_MS` | `300` | Async delay between MT5 history refresh attempts |
| `MT5_TERMINAL_PATH` | empty | Optional MT5 terminal executable path |
| `MT5_LOGIN` | empty | Optional MT5 account login |
| `MT5_PASSWORD` | empty | Optional MT5 account password |
| `MT5_SERVER` | empty | Optional MT5 broker server name |
| `MT5_STREAM_LOG_LEVEL` | `INFO` | Python logging level |

If one of `MT5_LOGIN`, `MT5_PASSWORD`, or `MT5_SERVER` is set, all three must be set. If none are set,
the bridge uses the account already active in the local MT5 terminal.

The bridge always sends the full MT5 symbol catalog to every Go client on connect, then immediately
sends the current tick snapshot for every active stream symbol before waiting for new ticks. This is
important for stocks and other slower symbols: a symbol can have a valid last quote even when
`time_msc` does not change for a long period. Tick streaming is separate from catalog loading:

- Set `MT5_STREAM_ALL_VISIBLE=true` to stream every symbol that is visible in Market Watch.
- Set `MT5_SYMBOLS=EURUSD,GBPUSD` to add specific symbols even if they are not visible.
- Set `MT5_STREAM_ALL_VISIBLE=false` and leave `MT5_SYMBOLS` empty to publish the catalog only
  without streaming ticks.

MT5 Python calls are blocking. After startup, the bridge sends every MT5 call
that can run during normal operation through one dedicated worker thread:
history loading, current tick snapshots for new clients, live tick polling, and
on-demand `symbol_select()` from `stream.subscribe`. This keeps the asyncio
WebSocket loop free to accept Go reconnects and send the symbol catalog even
when MT5 is slow or a large Market Watch list is being polled. Keep the worker
single-threaded; the MT5 Python package should not be called concurrently from
multiple runtime threads.

On-demand history requests may need a cold-start refresh because MT5 downloads
bars after the first `copy_rates_*` call. A non-empty latest window is returned
immediately even if its newest bar is slightly stale; later active chart
refreshes pick up the terminal's warmed bars. Empty latest and cursor-page
responses use the bounded retry budget. The worker serializes `copy_rates_*` work, so a slow
request does not freeze the asyncio WebSocket loop or block catalog messages.

History `symbol_select()` and `copy_rates_*` execute together on that worker.
The Go client can send `history.cancel` when every HTTP waiter has abandoned a
request. Cancellation removes work that is still queued in the executor and
prevents an obsolete response from being sent. A blocking MetaTrader5 call that
has already started must finish on its worker thread.

MT5 `copy_rates_*` history timestamps are already UTC bar-open seconds according to the official
MetaQuotes Python docs, so the bridge sends candle `time` values unchanged. Live tick timestamps are
normalized only when the terminal exposes them with a broker/workstation offset; that keeps quote
freshness checks in the same UTC domain as history without shifting candles and creating false
history gaps. `1W` and `1M` freshness checks use calendar-tolerant age windows because broker weeks
and variable-length months are not aligned to fixed Unix-epoch intervals.

## Run

Start the Python bridge:

```bash
python -m bridge.mt5_stream.mt5_server
```

In another terminal, start the Go consumer:

```bash
go run ./cmd/mt5-stream
```

To expose the symbol catalog to the frontend through the Go API, start the normal backend API:

```bash
go run ./cmd/api
```

The frontend should call `GET /api/v1/mt5/symbols`. The Go API keeps an in-memory catalog cache from
the Python bridge and returns connection status plus the latest symbol metadata.

For live prices, the frontend opens the Go API WebSocket `GET /api/v1/mt5/stream`. The Go API
caches only the latest tick per streamed symbol and fans those ticks out to browser subscribers.
`GET /api/v1/mt5/ticks?symbols=EURUSD,GBPUSD` remains a one-off snapshot/debug endpoint. Ticks are
quote/watchlist data only and must not be used to synthesize MT5 chart candles.
If the Go API asks for a catalog symbol that was not in the initial stream set, it sends
`stream.subscribe` to this bridge; the bridge calls `symbol_select()` and only adds the symbol to
the live tick loop if MT5 confirms it is selectable. Symbols rejected by `symbol_select()` must not
be treated as streamable by the frontend.

For historical chart candles, the frontend calls
`GET /api/v1/mt5/history?symbol=EURUSD&timeframe=15m&limit=1500`. For older
pages, it adds `before=<first_loaded_bar_time>`. The Go API serves cached
candles when it has enough current data; otherwise it sends a `history.request`
message over the existing bridge WebSocket. Latest windows use
`copy_rates_from_pos`; older pages use `copy_rates_from(..., before - 1s, limit)`
so infinite-scroll history loads bars strictly before the first loaded candle.
Cursor responses include `has_more`; the frontend only treats an explicit false
value as the terminal history boundary.
Date navigation uses
`GET /api/v1/mt5/history/around?symbol=EURUSD&timeframe=15m&time=<unix-seconds>&limit=600`.
The bridge loads backward context and adaptively expands a forward range until it finds the first
tradable candle at or after the requested time, including across weekend gaps. The response carries
both `requestedTime` and `resolvedTime`; an unavailable future date is never clamped to the current
history tail.
The frontend uses timeframe-aware progressive window sizes rather than requesting
1500 bars for every first paint, then loads older pages only as the chart pans left.

The Go process logs ticks like:

```text
[EURUSD] Bid: 1.08425 | Ask: 1.08437 | Time: 14:05:31
```

## Tests

The Python bridge unit tests stub the `MetaTrader5` module, so they can run on a
machine without MT5 installed:

```bash
python -m unittest bridge.mt5_stream.test_mt5_server -v
```

These tests cover tick de-duplication, timestamp normalization,
`stream.subscribe` symbol selection, and the non-blocking worker wrapper that
keeps asyncio responsive while MT5 calls are running.

## Payload Contract

On connect, the Python bridge first sends the MT5 symbol catalog:

```json
{
  "type": "symbols",
  "source": "mt5",
  "count": 1200,
  "stream_symbols": ["EURUSD", "GBPUSD"],
  "symbols": [
    {
      "name": "EURUSD",
      "path": "Forex\\Majors",
      "description": "Euro vs US Dollar",
      "visible": true,
      "digits": 5,
      "spread": 10,
      "trade_mode": 4,
      "currency_base": "EUR",
      "currency_profit": "USD",
      "currency_margin": "EUR"
    }
  ]
}
```

For each new MT5 tick, it then sends:

```json
{
  "type": "tick",
  "source": "mt5",
  "symbol": "EURUSD",
  "bid": 1.08425,
  "ask": 1.08437,
  "timestamp": 1760000000,
  "time_msc": 1760000000123
}
```

`time_msc` is used for de-duplication and precise formatting. `timestamp` remains available for
systems that only need second precision.

The Go API can also request history over the same WebSocket:

```json
{
  "type": "history.request",
  "id": "hist-request-id",
  "symbol": "EURUSD",
  "timeframe": "15m",
  "limit": 1500,
  "before": 1760000000
}
```

If the browser changes symbol or timeframe and no caller still needs that
request, Go cancels it with the same request id:

```json
{
  "type": "history.cancel",
  "id": "hist-request-id"
}
```

The Go API can request extra live symbols over the same WebSocket:

```json
{
  "type": "stream.subscribe",
  "symbols": ["AAPL", "XAUUSD"]
}
```

The Python bridge responds:

```json
{
  "type": "history",
  "source": "mt5",
  "request_id": "hist-request-id",
  "symbol": "EURUSD",
  "timeframe": "15m",
  "has_more": false,
  "candles": [
    { "time": 1760000000, "open": 1.1, "high": 1.2, "low": 1.0, "close": 1.15, "volume": 42 }
  ]
}
```

## Operational Notes

- Bind to `localhost` by default. Do not expose this bridge directly to the internet.
- Run the Python bridge and Go consumer as separate processes so either side can restart safely.
- The Go consumer reconnects with exponential backoff if the Python bridge restarts.
- `stream_symbols` is the source of truth for which catalog symbols can show live
  prices. Use `MT5_STREAM_ALL_VISIBLE=true` for Market Watch parity, and use
  `MT5_SYMBOLS` only to add explicit symbols beyond that visible set.
- This stream is market-data only. Order execution remains a separate FTMO/MT5 bridge concern.
