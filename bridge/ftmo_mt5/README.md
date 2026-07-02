# FTMO MT5 Python Service

Standalone Python WebSocket bridge for copying web-terminal order intents to an FTMO MT5 terminal.

## Status

- Dry-run mode works without MT5 and is the default.
- Live mode uses the official `MetaTrader5` Python package and requires Windows with the MT5
  desktop terminal installed.
- Live mode must be explicitly enabled with both `FTMO_BRIDGE_DRY_RUN=false` and
  `FTMO_BRIDGE_ALLOW_LIVE=true`.

## Install

```powershell
python -m venv .venv-ftmo
.\.venv-ftmo\Scripts\Activate.ps1
python -m pip install -r bridge\ftmo_mt5\requirements.txt
```

## Dry-Run

The service reads bridge variables from the current process environment and, if present, `.env` /
`.env.local` in the repository root. Existing process environment values take priority over file
values. Restart the service after changing these values.

If `FTMO_ACCOUNT_SIZE` is not set, live mode uses the connected MT5 account equity as the risk
base. If `FTMO_ACCOUNT_SIZE` is set, that fixed value is used for FTMO-style loss/risk limits.
Startup logs print `riskBase`, `source`, `maxRiskPerTrade`, and `maxOrderVolume`.

Live account, position, order, and risk snapshots are pushed to connected web clients every
`FTMO_BRIDGE_SNAPSHOT_INTERVAL_MS` milliseconds. Default is `1000`.

The web order ticket sizes MT5 lots from `risk %`, account equity, stop distance, `tickSize`, and
`tickValue` streamed by the bridge. `FTMO_BRIDGE_MAX_ORDER_VOLUME` is still a hard cap; if it is set
to `0.01`, every web order will be capped at `0.01` lots even when risk % is higher.

The bridge also logs symbol lot limits once per connected chart symbol:

```text
[ftmo-mt5-python] symbol BTCUSDT->BTCUSD minLot=0.0100 brokerMaxLot=0.0100 bridgeMaxLot=1.0000 publicMaxLot=0.0100 lotStep=0.0100 tickSize=0.01 tickValue=1 stopLevel=0 minStopDistance=0 cap=broker
```

Use `cap` to diagnose risk sizing:

- `cap=bridge`: restart the service after changing `FTMO_BRIDGE_MAX_ORDER_VOLUME`, and clear any
  stale PowerShell process env that still overrides `.env.local`.
- `cap=broker`: MT5 reported `volume_max` below the bridge cap for that broker symbol/account. Pick
  a symbol/account type with a higher broker max lot, or accept the broker limit.
- `stopLevel`/`minStopDistance`: MT5's minimum SL/TP distance for that broker symbol. Buy orders
  need SL below entry and TP above entry; Sell orders need SL above entry and TP below entry.

```powershell
$env:FTMO_MT5_ENABLED="true"
$env:FTMO_BRIDGE_DRY_RUN="true"
python -m bridge.ftmo_mt5.service
```

## Live Demo Validation

Use only an FTMO demo/evaluation account first.

```powershell
$env:FTMO_MT5_ENABLED="true"
$env:FTMO_BRIDGE_DRY_RUN="false"
$env:FTMO_BRIDGE_ALLOW_LIVE="true"
$env:FTMO_BRIDGE_MAX_ORDER_VOLUME="1"
$env:FTMO_MT5_LOGIN="12345678"
$env:FTMO_MT5_PASSWORD="master-password"
$env:FTMO_MT5_SERVER="FTMO-Server"
$env:FTMO_MT5_TERMINAL_PATH="C:\Program Files\MetaTrader 5\terminal64.exe"
python -m bridge.ftmo_mt5.service
```

Never put FTMO credentials in `NEXT_PUBLIC_*`, browser localStorage, or committed files.
