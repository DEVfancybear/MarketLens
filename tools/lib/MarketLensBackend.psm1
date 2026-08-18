<#
.SYNOPSIS
  Shared helpers for the MarketLens artifact deploy path on Windows.

.DESCRIPTION
  tools/deploy-backend.ps1 acquires and verifies a CI-built backend artifact, then
  delegates the actual restart, MT5 startup and health gating to
  run-backend-production.ps1 -SkipPull -SkipBuild -SkipMigrations. That runner
  therefore remains the single implementation of the restart/health logic and is
  not modified by the deploy path.

  Only the pieces the deploy path genuinely needs live here. Nothing in this
  module starts or stops a service.
#>

Set-StrictMode -Version Latest

function Get-BackendEnvValue {
    <#
    .SYNOPSIS
      Read one backend configuration value, preferring the real process environment.
    .DESCRIPTION
      Deliberately mirrors the reader inside run-backend-production.ps1 so both
      paths resolve configuration identically. Process environment wins so an
      operator can override a single value for one run without editing
      backend\.env. Returns an empty string when the key is absent.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$EnvFilePath
    )

    $processValue = [Environment]::GetEnvironmentVariable($Name)
    if (-not [string]::IsNullOrWhiteSpace($processValue)) {
        return $processValue.Trim()
    }
    if (-not (Test-Path -LiteralPath $EnvFilePath -PathType Leaf)) { return "" }

    foreach ($line in Get-Content -LiteralPath $EnvFilePath) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
            continue
        }
        $parts = $trimmed.Split("=", 2)
        if ($parts[0].Trim() -eq $Name) {
            return $parts[1].Trim().Trim('"').Trim("'")
        }
    }
    return ""
}

function Get-BindPort {
    <#
    .SYNOPSIS
      Extract and validate the TCP port from a host:port bind string.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Bind,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($Bind -notmatch ':(\d{1,5})$') {
        throw "$Name must end in a TCP port."
    }
    $port = [int]$Matches[1]
    if ($port -lt 1 -or $port -gt 65535) {
        throw "$Name contains an invalid TCP port."
    }
    return $port
}

function Get-ListenerOwnership {
    <#
    .SYNOPSIS
      Report whether the process listening on a port belongs to this repository.
    .DESCRIPTION
      Walks up to six generations of the process tree looking for a process whose
      executable path or command line contains both the repository root and the
      caller's marker. The deploy path uses this read-only check during preflight
      so it can refuse early, before anything is downloaded or migrated, when a
      foreign process holds a port it would otherwise have to stop.

      Returns one object per listening owner. An empty result means the port is
      free.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$Marker,
        [Parameter(Mandatory = $true)][string]$RepositoryRoot
    )

    $results = @()
    $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    $owners = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($processId in $owners) {
        $processChain = @()
        $currentProcessId = $processId
        $owned = $false
        for ($depth = 0; $depth -lt 6 -and $currentProcessId -gt 0; $depth++) {
            $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $currentProcessId" -ErrorAction SilentlyContinue
            if ($null -eq $processInfo) { break }
            $processChain += $processInfo
            $identity = "$($processInfo.ExecutablePath) $($processInfo.CommandLine)"
            if ($identity.IndexOf($RepositoryRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
                $identity.IndexOf($Marker, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $owned = $true
                break
            }
            if ($processInfo.ParentProcessId -eq $currentProcessId) { break }
            $currentProcessId = $processInfo.ParentProcessId
        }
        $results += [pscustomobject]@{
            Port      = $Port
            Marker    = $Marker
            ProcessId = $processId
            Owned     = $owned
            ChainIds  = @($processChain | Select-Object -ExpandProperty ProcessId -Unique)
        }
    }
    return $results
}

function Test-ArtifactChecksums {
    <#
    .SYNOPSIS
      Verify every file listed in a SHA256SUMS manifest.
    .DESCRIPTION
      Lines are "<lowercase sha256>  <relative path>", the format sha256sum emits
      and the CI job writes. Returns the number of files verified. Throws on the
      first mismatch, missing file, or unparsable line.

      A manifest listing zero files is an error: an empty or stripped SHA256SUMS
      must never read as a successful verification.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$SumsPath
    )

    if (-not (Test-Path -LiteralPath $SumsPath -PathType Leaf)) {
        throw "Artifact is missing SHA256SUMS at $SumsPath; refusing to deploy an unverifiable build."
    }

    $verified = 0
    foreach ($line in Get-Content -LiteralPath $SumsPath) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        if ($trimmed -notmatch '^([0-9a-fA-F]{64})\s+\*?(.+)$') {
            throw "Unparsable SHA256SUMS line: $trimmed"
        }
        $expected = $Matches[1].ToLowerInvariant()
        $relative = $Matches[2].Trim().Replace('/', '\')
        $target = Join-Path $Root $relative
        if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
            throw "SHA256SUMS lists '$relative' but the artifact does not contain it."
        }
        $actual = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $expected) {
            throw "Checksum mismatch for '$relative': expected $expected, got $actual."
        }
        $verified++
    }

    if ($verified -eq 0) {
        throw "SHA256SUMS listed no files; refusing to treat an empty manifest as verified."
    }
    return $verified
}

Export-ModuleMember -Function `
    Get-BackendEnvValue, `
    Get-BindPort, `
    Get-ListenerOwnership, `
    Test-ArtifactChecksums
