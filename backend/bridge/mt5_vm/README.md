# MT5 Windows VM Phase 0 harness

This directory contains the read-only feasibility harness for the
MarketLens-managed Windows VM connector.

It is not the production worker agent. It proves that a Windows host can find
the approved terminal/runtime and can read a disposable MT5 demo account
without putting its password in a command line, environment variable, log, or
repository file.

## Host preflight

From the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\backend\bridge\mt5_vm\Invoke-MT5VmPhase0.ps1 -Mode Host
```

The default paths are:

```text
C:\Program Files\MetaTrader 5\terminal64.exe
backend\.venv-mt5\Scripts\python.exe
```

Use `-TerminalPath` or `-PythonPath` only for a deliberate local override.

## Disposable demo credential

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\backend\bridge\mt5_vm\Save-MT5VmPhase0Credential.ps1 `
  -AccountAlias ftmo-free-trial `
  -Login 12345678 `
  -Server FTMO-Demo
```

The password prompt uses `SecureString`. The login, server, and password are
stored together inside one DPAPI-encrypted payload under
`%LOCALAPPDATA%\MarketLens`, outside the repository. The file has a protected
ACL for only the current Windows user and SYSTEM, and it can be decrypted only
by the same Windows user on the same host. Custom paths outside that protected
root and reparse-point paths are rejected.

Never move this file into Git, paste it into chat, or use a funded/live account
for Phase 0.

## Read-only account probe

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\backend\bridge\mt5_vm\Invoke-MT5VmPhase0.ps1 `
  -Mode Account `
  -AccountAlias ftmo-free-trial
```

PowerShell validates file ownership/ACL, decrypts the credential only in memory,
and writes the request to Python through redirected stdin. The Python command
arguments contain only the probe script path.

Account results default to `%LOCALAPPDATA%\MarketLens\phase0-results`. The
harness refuses to write an account result inside the repository.

Phase 0 is incapable of trading: `phase0_probe.py` contains no order mutation
operation.

## Tests

The tests use a stub and do not require MT5:

```powershell
backend\.venv-mt5\Scripts\python.exe -m unittest `
  backend.bridge.mt5_vm.test_phase0_probe -v
```
