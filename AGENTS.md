# Repository agent instructions

## Production backend command

When the user says **build backend production** or **run backend**, execute this command from the
repository root on the Windows production host:

```powershell
.\run-backend-production.ps1
```

Use no switches in the normal case. Do not substitute `build-production.ps1`, a direct `go build`,
`api.exe`, or individual Python bridge commands; those are artifact-build or manual-recovery paths.
The canonical runner owns pull, MT5 runtime provisioning, staged API build, forward migration,
safe restart, and local/public health gates. Port `8787` is browser/account-local and is not part of
the multi-user backend runner.

Use `-SkipPull`, `-SkipBuild`, `-SkipMigrations`, or `-SkipPublicHealthCheck` only when the user
explicitly requests recovery behavior or the production runbook documents the reason.
