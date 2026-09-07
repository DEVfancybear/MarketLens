[CmdletBinding()]
param([switch]$KnownBadControl)
# Compatibility entrypoint; the original provisioning task owns code validation.
& (Join-Path $PSScriptRoot 'verify-production-worker-host-provision.ps1') -CodeTestsOnly -KnownBadControl:$KnownBadControl
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
