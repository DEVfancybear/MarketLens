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
| `MT5_SYMBOLS` | empty | Comma-separated symbols to stream, for example `EURUSD,GBPUSD,XAUUSD` |
| `MT5_STREAM_ALL_VISIBLE` | `false` | Stream every MT5 symbol currently marked visible when `MT5_SYMBOLS` is empty |
| `MT5_STREAM_HOST` | `localhost` | WebSocket listen host |
| `MT5_STREAM_PORT` | `8765` | WebSocket listen port |
| `MT5_POLL_INTERVAL_MS` | `100` | Tick polling interval |
| `MT5_TERMINAL_PATH` | empty | Optional MT5 terminal executable path |
| `MT5_LOGIN` | empty | Optional MT5 account login |
| `MT5_PASSWORD` | empty | Optional MT5 account password |
| `MT5_SERVER` | empty | Optional MT5 broker server name |
| `MT5_STREAM_LOG_LEVEL` | `INFO` | Python logging level |

If one of `MT5_LOGIN`, `MT5_PASSWORD`, or `MT5_SERVER` is set, all three must be set. If none are set,
the bridge uses the account already active in the local MT5 terminal.

The bridge always sends the full MT5 symbol catalog to every Go client on connect. Tick streaming is
separate from catalog loading:

- Set `MT5_SYMBOLS=EURUSD,GBPUSD` to stream specific symbols.
- Set `MT5_STREAM_ALL_VISIBLE=true` to stream every symbol that is visible in Market Watch.
- Leave both empty/false to publish the catalog only without streaming ticks.

## Run

Start the Python bridge:

```bash
python -m bridge.mt5_stream.mt5_server
```

In another terminal, start the Go consumer:

```bash
go run ./cmd/mt5-stream
```

The Go process logs ticks like:

```text
[EURUSD] Bid: 1.08425 | Ask: 1.08437 | Time: 14:05:31
```

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

## Operational Notes

- Bind to `localhost` by default. Do not expose this bridge directly to the internet.
- Run the Python bridge and Go consumer as separate processes so either side can restart safely.
- The Go consumer reconnects with exponential backoff if the Python bridge restarts.
- This stream is market-data only. Order execution remains a separate FTMO/MT5 bridge concern.
