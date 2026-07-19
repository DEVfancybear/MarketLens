# TradingTerminal MT5 Connector

The connector is the consumer entrypoint for a Windows computer that already has an FTMO
MetaTrader 5 terminal installed. It does not read repository `.env` files, broker credentials, or a
terminal path. It binds only to `127.0.0.1:8787`, discovers an FTMO terminal that is already logged
in, and validates the web app's short-lived pairing ticket with the production API before returning
account data or accepting an order.

For source-based development only:

```powershell
cd backend
.\.venv-mt5\Scripts\python.exe -m bridge.ftmo_mt5.connector `
  --api-base-url http://localhost:8080 `
  --allow-origin http://localhost:3000
```

Build the distributable Windows executable with:

```powershell
.\bridge\ftmo_mt5\build-connector.ps1
```

The build produces `backend\dist\TradingTerminal-MT5-Connector.zip` and publishes the same file to
`frontend\public\downloads\TradingTerminal-MT5-Connector.zip`. The archive contains the executable
and a user guide. The local build does not code-sign the executable; signing and installer/autostart
registration belong in the release pipeline.

The normal user flow is:

1. Install/run the released connector and open the FTMO MT5 terminal.
2. Log in inside MT5 using the normal broker UI.
3. Enter the account credentials in TradingTerminal and select **Connect & Verify MT5**. Verification
   remains backend-authoritative.
4. Allow Local Network Access when Chrome or Edge asks. The web app supplies the local Connector
   with a one-time backend ticket, and the Connector selects the open terminal matching its
   login/server. No local token,
   password, path, source checkout, or environment variable is required.

The API validation contract is:

```text
POST /api/v1/settings/integrations/mt5/connector/validate
Content-Type: application/json

{"ticket":"<one-time-ticket>"}
```

```json
{
  "ok": true,
  "account": { "login": "12345678", "server": "FTMO-Server4" },
  "expiresAt": 1783003600000
}
```

Only the exact production web Origin is accepted by default. Development Origins and API URLs must
be supplied explicitly with command-line switches.
