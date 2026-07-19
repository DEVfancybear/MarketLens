[CmdletBinding()]
param(
  [switch]$SkipPull,
  [switch]$SkipBuild,
  [switch]$SkipMigrations,
  [switch]$SkipPublicHealthCheck
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $repoRoot "backend"
$runtimeLogs = Join-Path $repoRoot ".runtime-logs"
$buildScript = Join-Path $repoRoot "build-production.ps1"
$managedPython = Join-Path $backendDir ".venv-mt5\Scripts\python.exe"
$apiPath = Join-Path $backendDir "bin\api.exe"
$stagedApiPath = Join-Path $backendDir "bin\api.next.exe"
$backendEnv = Join-Path $backendDir ".env"
$managedVerifierDirectory = Join-Path $backendDir ".data\mt5-verifier-terminal"
$managedVerifierPath = Join-Path $managedVerifierDirectory "terminal64.exe"
$managedVerifierManifest = Join-Path $managedVerifierDirectory ".managed-source.json"
$officialFTMOInstallerUrl = "https://download.terminal.free/cdn/web/ftmo.global.markets/mt5/ftmo5setup.exe"
$mt5VerifierMutexName = "Global\SMCTradingTerminal.MT5Verifier.v1"
$mt5VerifierRefreshMutexTimeoutMs = 45000
$env:MT5_VERIFY_MUTEX_NAME = $mt5VerifierMutexName
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bridgeOut = Join-Path $runtimeLogs "mt5-stream-$stamp.out.log"
$bridgeErr = Join-Path $runtimeLogs "mt5-stream-$stamp.err.log"
$apiOut = Join-Path $runtimeLogs "backend-api-$stamp.out.log"
$apiErr = Join-Path $runtimeLogs "backend-api-$stamp.err.log"

function Get-BackendEnvValue {
  param([Parameter(Mandatory = $true)][string]$Name)

  $processValue = [Environment]::GetEnvironmentVariable($Name)
  if (-not [string]::IsNullOrWhiteSpace($processValue)) { return $processValue.Trim() }
  if (-not (Test-Path -LiteralPath $backendEnv -PathType Leaf)) { return "" }

  foreach ($line in Get-Content -LiteralPath $backendEnv) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) { continue }
    $parts = $trimmed.Split("=", 2)
    if ($parts[0].Trim() -eq $Name) {
      return $parts[1].Trim().Trim('"').Trim("'")
    }
  }
  return ""
}

function Test-Truthy {
  param([string]$Value)
  return @("1", "true", "yes", "on") -contains $Value.Trim().ToLowerInvariant()
}

function Stop-OwnedListener {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string]$Marker
  )

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
      if ($identity.IndexOf($repoRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
          $identity.IndexOf($Marker, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $owned = $true
        break
      }
      if ($processInfo.ParentProcessId -eq $currentProcessId) { break }
      $currentProcessId = $processInfo.ParentProcessId
    }
    if (-not $owned) {
      throw "Refusing to stop PID $processId on port $Port because it is not this repository's $Marker process."
    }
    $chainIds = @($processChain | Select-Object -ExpandProperty ProcessId -Unique)
    Write-Host "Stopping owned listener on port $Port (process chain $($chainIds -join ' -> '))..." -ForegroundColor Yellow
    foreach ($chainProcessId in $chainIds) {
      Stop-Process -Id $chainProcessId -Force -ErrorAction SilentlyContinue
    }
    foreach ($chainProcessId in $chainIds) {
      Wait-Process -Id $chainProcessId -Timeout 10 -ErrorAction SilentlyContinue
    }
  }
}

function Get-NormalizedPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  return [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
}

function Test-SamePath {
  param(
    [Parameter(Mandatory = $true)][string]$Left,
    [Parameter(Mandatory = $true)][string]$Right
  )

  return [System.StringComparer]::OrdinalIgnoreCase.Equals(
    (Get-NormalizedPath $Left),
    (Get-NormalizedPath $Right)
  )
}

function Invoke-WithMT5VerifierMutex {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [ValidateRange(1, 300000)][int]$TimeoutMs = $mt5VerifierRefreshMutexTimeoutMs
  )

  $mutex = $null
  $acquired = $false
  try {
    $mutex = [System.Threading.Mutex]::new($false, $mt5VerifierMutexName)
    try {
      $acquired = $mutex.WaitOne($TimeoutMs)
    } catch [System.Threading.AbandonedMutexException] {
      # .NET grants ownership when reporting an abandoned mutex.
      $acquired = $true
      Write-Verbose "Recovered the abandoned MT5 verifier mutex."
    }
    if (-not $acquired) {
      throw "Timed out after $TimeoutMs ms waiting for active MT5 verification to finish."
    }
    & $Action
  } finally {
    if ($acquired -and $null -ne $mutex) {
      try {
        $mutex.ReleaseMutex()
      } catch {
        Write-Warning "Could not release the MT5 verifier mutex: $($_.Exception.Message)"
      }
    }
    if ($null -ne $mutex) {
      try {
        $mutex.Dispose()
      } catch {
        Write-Warning "Could not dispose the MT5 verifier mutex: $($_.Exception.Message)"
      }
    }
  }
}

function Add-TerminalCandidate {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[string]]$Candidates,
    [string]$Path
  )

  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  if ([System.IO.Path]::GetFileName($Path) -ine "terminal64.exe") { return }
  $normalized = Get-NormalizedPath $Path
  foreach ($candidate in $Candidates) {
    if ([System.StringComparer]::OrdinalIgnoreCase.Equals($candidate, $normalized)) { return }
  }
  $Candidates.Add($normalized)
}

function Stop-TerminalAtPath {
  param([Parameter(Mandatory = $true)][string]$TerminalPath)

  if (-not (Test-Path -LiteralPath $TerminalPath -PathType Leaf)) { return }
  $expectedPath = Get-NormalizedPath $TerminalPath
  $processes = @()
  try {
    $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'terminal64.exe'" -ErrorAction Stop)
  } catch {
    Write-Verbose "CIM process inspection unavailable; falling back to Get-Process: $($_.Exception.Message)"
    foreach ($candidate in @(Get-Process -Name "terminal64" -ErrorAction SilentlyContinue)) {
      try {
        $processes += [pscustomobject]@{
          ProcessId = $candidate.Id
          ExecutablePath = $candidate.Path
        }
      } catch {
        Write-Verbose "Could not inspect terminal PID $($candidate.Id): $($_.Exception.Message)"
      }
    }
  }
  foreach ($process in $processes) {
    if ($process.ExecutablePath -and (Test-SamePath $process.ExecutablePath $expectedPath)) {
      Write-Host "Stopping managed MT5 terminal PID $($process.ProcessId)..." -ForegroundColor Yellow
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
      Wait-Process -Id $process.ProcessId -Timeout 15 -ErrorAction SilentlyContinue
    }
  }
}

function Find-InstalledFTMOTerminal {
  $candidates = [System.Collections.Generic.List[string]]::new()
  foreach ($root in @(
    [Environment]::GetFolderPath("ProgramFiles"),
    [Environment]::GetFolderPath("ProgramFilesX86"),
    [Environment]::GetFolderPath("LocalApplicationData")
  )) {
    if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root -PathType Container)) { continue }
    foreach ($directory in @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)) {
      if ($directory.Name -notmatch "(?i)ftmo") { continue }
      Add-TerminalCandidate -Candidates $candidates -Path (Join-Path $directory.FullName "terminal64.exe")
    }
  }
  return ($candidates | Sort-Object | Select-Object -First 1)
}

function Install-OfficialFTMOTerminal {
  $installedPath = Find-InstalledFTMOTerminal
  if ($installedPath) { return $installedPath }

  $managedDataDirectory = Split-Path -Parent $managedVerifierDirectory
  New-Item -ItemType Directory -Path $managedDataDirectory -Force | Out-Null
  $installerPath = Join-Path $managedDataDirectory ("ftmo5setup.next-" + $PID + ".exe")
  if (Test-Path -LiteralPath $installerPath) {
    Remove-Item -LiteralPath $installerPath -Force
  }

  Write-Host "Downloading the official FTMO MetaTrader 5 runtime..." -ForegroundColor Cyan
  try {
    Invoke-WebRequest -Uri $officialFTMOInstallerUrl -OutFile $installerPath -UseBasicParsing -TimeoutSec 120
    $installer = Get-Item -LiteralPath $installerPath -ErrorAction Stop
    if ($installer.Length -lt 1MB) {
      throw "The downloaded FTMO installer is unexpectedly small."
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $installerPath
    $signerSubject = [string]$signature.SignerCertificate.Subject
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
        $signerSubject -notmatch "(?i)(CN|O)=MetaQuotes Ltd\.") {
      throw "The FTMO installer did not have a valid MetaQuotes digital signature."
    }

    Write-Host "Installing the dedicated FTMO terminal runtime..." -ForegroundColor Cyan
    $installerProcess = Start-Process -FilePath $installerPath `
      -ArgumentList "/auto" `
      -WindowStyle Hidden `
      -PassThru
    try {
      Wait-Process -Id $installerProcess.Id -Timeout 120 -ErrorAction Stop
    } catch {
      if (-not $installerProcess.HasExited) {
        Stop-Process -Id $installerProcess.Id -Force -ErrorAction SilentlyContinue
      }
      throw "The official FTMO terminal installer did not finish within 120 seconds."
    }
    $installerProcess.Refresh()
    if ($installerProcess.ExitCode -ne 0) {
      throw "The official FTMO terminal installer exited with code $($installerProcess.ExitCode)."
    }
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
      $installedPath = Find-InstalledFTMOTerminal
      if ($installedPath) { break }
      Start-Sleep -Seconds 1
    }
    if (-not $installedPath -or -not (Test-Path -LiteralPath $installedPath -PathType Leaf)) {
      throw "The official FTMO terminal installer did not create terminal64.exe."
    }
    Stop-TerminalAtPath -TerminalPath $installedPath
  } finally {
    if (Test-Path -LiteralPath $installerPath) {
      Remove-Item -LiteralPath $installerPath -Force
    }
  }

  return $installedPath
}

function Find-MT5VerifierSource {
  param(
    [Parameter(Mandatory = $true)][string]$MarketTerminalPath,
    [string]$MarketServer = ""
  )

  $candidates = [System.Collections.Generic.List[string]]::new()

  try {
    foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name = 'terminal64.exe'" -ErrorAction Stop)) {
      Add-TerminalCandidate -Candidates $candidates -Path $process.ExecutablePath
    }
  } catch {
    Write-Verbose "Could not inspect running MT5 process paths: $($_.Exception.Message)"
  }

  $terminalDataRoot = Join-Path ([Environment]::GetFolderPath("ApplicationData")) "MetaQuotes\Terminal"
  if (Test-Path -LiteralPath $terminalDataRoot -PathType Container) {
    foreach ($instance in @(Get-ChildItem -LiteralPath $terminalDataRoot -Directory -ErrorAction SilentlyContinue)) {
      $origin = Join-Path $instance.FullName "origin.txt"
      if (-not (Test-Path -LiteralPath $origin -PathType Leaf)) { continue }
      try {
        $installDirectory = (Get-Content -LiteralPath $origin -Raw -ErrorAction Stop).Trim()
        Add-TerminalCandidate -Candidates $candidates -Path (Join-Path $installDirectory "terminal64.exe")
      } catch {
        Write-Verbose "Could not inspect MT5 origin file ${origin}: $($_.Exception.Message)"
      }
    }
  }

  $programRoots = @(
    [Environment]::GetFolderPath("ProgramFiles"),
    [Environment]::GetFolderPath("ProgramFilesX86"),
    [Environment]::GetFolderPath("LocalApplicationData")
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_ -PathType Container) }
  foreach ($programRoot in $programRoots) {
    foreach ($directory in @(Get-ChildItem -LiteralPath $programRoot -Directory -ErrorAction SilentlyContinue)) {
      if ($directory.Name -notmatch "(?i)(ftmo|meta.?trader|metaquotes)") { continue }
      Add-TerminalCandidate -Candidates $candidates -Path (Join-Path $directory.FullName "terminal64.exe")
    }
  }

  $marketPath = Get-NormalizedPath $MarketTerminalPath
  $managedPath = Get-NormalizedPath $managedVerifierPath
  $ftmoCandidate = $candidates |
    Where-Object {
      $_ -match "(?i)ftmo" -and
      -not [System.StringComparer]::OrdinalIgnoreCase.Equals($_, $marketPath) -and
      -not [System.StringComparer]::OrdinalIgnoreCase.Equals($_, $managedPath)
    } |
    Sort-Object |
    Select-Object -First 1
  if ($ftmoCandidate) { return $ftmoCandidate }

  # The active market-data terminal is a suitable FTMO source even when its
  # installation folder has a generic MetaTrader name. Never clone an unrelated
  # broker installation: provision FTMO's signed public runtime instead.
  if ($MarketServer -match "(?i)ftmo" -and (Test-Path -LiteralPath $marketPath -PathType Leaf)) {
    return $marketPath
  }

  return (Install-OfficialFTMOTerminal)
}

function Get-TerminalSourceIdentity {
  param([Parameter(Mandatory = $true)][string]$SourceTerminalPath)

  $source = Get-Item -LiteralPath $SourceTerminalPath -ErrorAction Stop
  return [pscustomobject]@{
    sourceTerminal = Get-NormalizedPath $source.FullName
    terminalSha256 = (Get-FileHash -LiteralPath $source.FullName -Algorithm SHA256).Hash
    fileVersion = $source.VersionInfo.FileVersion
    length = $source.Length
  }
}

function Test-ManagedVerifierCurrent {
  param([Parameter(Mandatory = $true)]$SourceIdentity)

  if (-not (Test-Path -LiteralPath $managedVerifierPath -PathType Leaf) -or
      -not (Test-Path -LiteralPath $managedVerifierManifest -PathType Leaf)) {
    return $false
  }
  try {
    $current = Get-Content -LiteralPath $managedVerifierManifest -Raw -ErrorAction Stop | ConvertFrom-Json
    return (
      [System.StringComparer]::OrdinalIgnoreCase.Equals(
        [string]$current.sourceTerminal,
        [string]$SourceIdentity.sourceTerminal
      ) -and
      [string]$current.terminalSha256 -eq [string]$SourceIdentity.terminalSha256 -and
      [string]$current.fileVersion -eq [string]$SourceIdentity.fileVersion -and
      [int64]$current.length -eq [int64]$SourceIdentity.length
    )
  } catch {
    return $false
  }
}

function Stop-ManagedVerifierTerminal {
  Stop-TerminalAtPath -TerminalPath $managedVerifierPath
}

function Install-ManagedVerifierTerminal {
  param(
    [Parameter(Mandatory = $true)][string]$SourceTerminalPath,
    [scriptblock]$BeforeRefresh
  )

  $sourceIdentity = Get-TerminalSourceIdentity $SourceTerminalPath
  if (Test-ManagedVerifierCurrent $sourceIdentity) {
    Write-Host "Managed MT5 verifier terminal is current." -ForegroundColor DarkGray
    return $managedVerifierPath
  }

  $managedParent = Split-Path -Parent $managedVerifierDirectory
  New-Item -ItemType Directory -Path $managedParent -Force | Out-Null
  $stagingDirectory = Join-Path $managedParent ("mt5-verifier-terminal.next-" + $PID)
  $backupDirectory = Join-Path $managedParent ("mt5-verifier-terminal.previous-" + $PID)
  foreach ($temporaryPath in @($stagingDirectory, $backupDirectory)) {
    if (Test-Path -LiteralPath $temporaryPath) {
      Remove-Item -LiteralPath $temporaryPath -Recurse -Force
    }
  }

  $sourceDirectory = Split-Path -Parent $SourceTerminalPath
  Write-Host "Provisioning isolated MT5 verifier terminal from $sourceDirectory..." -ForegroundColor Cyan
  try {
    Copy-Item -LiteralPath $sourceDirectory -Destination $stagingDirectory -Recurse -Force
    $stagedTerminal = Join-Path $stagingDirectory "terminal64.exe"
    if (-not (Test-Path -LiteralPath $stagedTerminal -PathType Leaf)) {
      throw "The managed MT5 verifier copy did not contain terminal64.exe."
    }
    [System.IO.File]::WriteAllText(
      (Join-Path $stagingDirectory ".managed-source.json"),
      ($sourceIdentity | ConvertTo-Json -Compress),
      [System.Text.UTF8Encoding]::new($false)
    )

    if ($null -ne $BeforeRefresh) {
      & $BeforeRefresh
    }
    Invoke-WithMT5VerifierMutex -Action {
      Stop-ManagedVerifierTerminal

      if (Test-Path -LiteralPath $managedVerifierDirectory) {
        Move-Item -LiteralPath $managedVerifierDirectory -Destination $backupDirectory
      }
      try {
        Move-Item -LiteralPath $stagingDirectory -Destination $managedVerifierDirectory
      } catch {
        if ((Test-Path -LiteralPath $backupDirectory) -and -not (Test-Path -LiteralPath $managedVerifierDirectory)) {
          Move-Item -LiteralPath $backupDirectory -Destination $managedVerifierDirectory
        }
        throw
      }
      if (Test-Path -LiteralPath $backupDirectory) {
        Remove-Item -LiteralPath $backupDirectory -Recurse -Force
      }
    }
  } finally {
    if (Test-Path -LiteralPath $stagingDirectory) {
      Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
    }
  }

  return $managedVerifierPath
}

function Wait-ForPort {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
    [int]$TimeoutSeconds = 60
  )

  for ($attempt = 0; $attempt -lt $TimeoutSeconds; $attempt++) {
    if ($Process.HasExited) { throw "Process PID $($Process.Id) exited before port $Port started listening." }
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { return }
    Start-Sleep -Seconds 1
  }
  throw "Timed out waiting for port $Port."
}

function Wait-ForJsonEndpoint {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][scriptblock]$Accept,
    [int]$TimeoutSeconds = 45
  )

  $lastFailure = "no response"
  for ($attempt = 0; $attempt -lt $TimeoutSeconds; $attempt++) {
    try {
      $response = Invoke-RestMethod -Uri $Uri -TimeoutSec 5
      if (& $Accept $response) { return $response }
      $lastFailure = "response did not pass readiness criteria"
    } catch {
      $lastFailure = $_.Exception.Message
    }
    Start-Sleep -Seconds 1
  }
  throw "Timed out waiting for $Uri ($lastFailure)."
}

function Wait-ForLogPattern {
  param(
    [Parameter(Mandatory = $true)][string[]]$Paths,
    [Parameter(Mandatory = $true)][string]$Pattern,
    [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
    [int]$TimeoutSeconds = 15
  )

  $lastFailure = "marker not written yet"
  for ($attempt = 0; $attempt -le $TimeoutSeconds; $attempt++) {
    if ($Process.HasExited) {
      throw "Process PID $($Process.Id) exited before its readiness log marker was written."
    }
    $logText = ""
    foreach ($path in $Paths) {
      if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
      try {
        $logText += [System.IO.File]::ReadAllText($path)
      } catch {
        $lastFailure = $_.Exception.Message
      }
    }
    if ($logText -match $Pattern) { return }
    if ($attempt -lt $TimeoutSeconds) { Start-Sleep -Seconds 1 }
  }
  throw "Timed out waiting for the API readiness log marker ($lastFailure)."
}

if (-not (Test-Path -LiteralPath $backendEnv -PathType Leaf)) {
  throw "Missing backend\.env. Create it from backend\.env.example before running production."
}
New-Item -ItemType Directory -Path $runtimeLogs -Force | Out-Null

if (-not $SkipPull) {
  Push-Location $repoRoot
  try {
    $dirty = @(& git status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw "git status failed (exit $LASTEXITCODE)." }
    if ($dirty.Count -gt 0) { throw "Production worktree is not clean; refusing to pull or deploy." }
    Write-Host "Pulling production branch..." -ForegroundColor Cyan
    & git pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw "git pull --ff-only failed (exit $LASTEXITCODE)." }
  } finally {
    Pop-Location
  }
}

$replaceApi = $false
if (-not $SkipBuild) {
  Write-Host "Building staged backend production artifact and MT5 runtime..." -ForegroundColor Cyan
  & $buildScript -BackendOnly -StageApi
  if (-not (Test-Path -LiteralPath $stagedApiPath -PathType Leaf)) {
    throw "Backend build did not produce backend\bin\api.next.exe."
  }
  $replaceApi = $true
} elseif (-not (Test-Path -LiteralPath $apiPath -PathType Leaf)) {
  throw "backend\bin\api.exe does not exist; rerun without -SkipBuild."
}

if (-not (Test-Path -LiteralPath $managedPython -PathType Leaf)) {
  throw "Managed MT5 Python is missing; rerun without -SkipBuild."
}
& $managedPython -c "import MetaTrader5, websockets"
if ($LASTEXITCODE -ne 0) { throw "Managed MT5 Python cannot import MetaTrader5/websockets." }

if (-not $SkipMigrations) {
  Write-Host "Applying forward-only database migrations..." -ForegroundColor Cyan
  Push-Location $backendDir
  try {
    $env:GOTOOLCHAIN = "local"
    & go run ./cmd/migrate up
    if ($LASTEXITCODE -ne 0) { throw "Database migration failed (exit $LASTEXITCODE)." }
    $migrationVersion = @(& go run ./cmd/migrate version 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "Migration version check failed (exit $LASTEXITCODE)." }
    $migrationVersion | ForEach-Object { Write-Host $_ }
    if (($migrationVersion -join "`n") -match "dirty\s*=\s*true") {
      throw "Database migration state is dirty; refusing to replace the running API."
    }
  } finally {
    Pop-Location
  }
}

$terminalPath = Get-BackendEnvValue "MT5_TERMINAL_PATH"
if ([string]::IsNullOrWhiteSpace($terminalPath)) {
  $terminalPath = "C:\Program Files\MetaTrader 5\terminal64.exe"
}
$terminalPath = Get-NormalizedPath $terminalPath
if (-not (Test-Path -LiteralPath $terminalPath -PathType Leaf)) {
  throw "The market-data MetaTrader 5 terminal was not found at: $terminalPath"
}
$env:MT5_TERMINAL_PATH = $terminalPath
if (-not (Get-Process -Name "terminal64" -ErrorAction SilentlyContinue)) {
  Write-Host "Starting MetaTrader 5; it must already have the intended FTMO account saved..." -ForegroundColor Cyan
  Start-Process -FilePath $terminalPath -WorkingDirectory (Split-Path -Parent $terminalPath)
  Start-Sleep -Seconds 5
}

$env:MT5_PROBE_TERMINAL_PATH = $terminalPath
$accountProbeJson = & $managedPython -c "import json,os,sys; import MetaTrader5 as mt5; path=os.environ.get('MT5_PROBE_TERMINAL_PATH',''); ok=mt5.initialize(path) if path else mt5.initialize(); info=mt5.account_info() if ok else None; print(json.dumps({'initialized':bool(ok),'login':str(getattr(info,'login','')),'server':str(getattr(info,'server','')),'tradeAllowed':bool(getattr(info,'trade_allowed',False))})); mt5.shutdown(); sys.exit(0 if ok and info is not None and bool(getattr(info,'trade_allowed',False)) else 2)"
if ($LASTEXITCODE -ne 0) {
  throw "MetaTrader 5 is not connected to a trade-enabled account. Open MT5, log in with the master password, and rerun."
}
$accountProbe = $accountProbeJson | ConvertFrom-Json

$configuredVerifierPath = Get-BackendEnvValue "MT5_VERIFY_TERMINAL_PATH"
$usesManagedVerifier = [string]::IsNullOrWhiteSpace($configuredVerifierPath)
if (-not $usesManagedVerifier) {
  $configuredVerifierPath = Get-NormalizedPath $configuredVerifierPath
  $usesManagedVerifier = Test-SamePath $configuredVerifierPath $managedVerifierPath
}

if ($usesManagedVerifier) {
  $verifierSource = Find-MT5VerifierSource -MarketTerminalPath $terminalPath -MarketServer $accountProbe.server
  $verifierPath = Install-ManagedVerifierTerminal -SourceTerminalPath $verifierSource -BeforeRefresh {
    Stop-OwnedListener -Port 8080 -Marker "bin\api.exe"
  }
  $env:MT5_VERIFY_PORTABLE = "true"
} else {
  if (-not (Test-Path -LiteralPath $configuredVerifierPath -PathType Leaf)) {
    throw "The configured MT5 verifier terminal does not exist: $configuredVerifierPath"
  }
  if (Test-SamePath $configuredVerifierPath $terminalPath) {
    throw "The configured MT5 verifier terminal must be different from the market-data terminal."
  }
  $verifierPath = $configuredVerifierPath
  $env:MT5_VERIFY_PORTABLE = "false"
}
$env:MT5_VERIFY_TERMINAL_PATH = Get-NormalizedPath $verifierPath
Write-Host "MT5 verifier terminal: $($env:MT5_VERIFY_TERMINAL_PATH) (managed=$usesManagedVerifier)" -ForegroundColor DarkGray

Stop-OwnedListener -Port 8080 -Marker "bin\api.exe"
Stop-OwnedListener -Port 8765 -Marker "bridge.mt5_stream.mt5_server"

if ($replaceApi) {
  Move-Item -LiteralPath $stagedApiPath -Destination $apiPath -Force
}

Write-Host "Starting private MT5 market-data sidecar..." -ForegroundColor Cyan
$bridgeProcess = Start-Process -FilePath $managedPython `
  -ArgumentList @("-m", "bridge.mt5_stream.mt5_server") `
  -WorkingDirectory $backendDir `
  -RedirectStandardOutput $bridgeOut `
  -RedirectStandardError $bridgeErr `
  -WindowStyle Hidden `
  -PassThru
Wait-ForPort -Port 8765 -Process $bridgeProcess
[System.IO.File]::WriteAllText((Join-Path $runtimeLogs "mt5-stream.pid"), [string]$bridgeProcess.Id)

Write-Host "Starting production Go API..." -ForegroundColor Cyan
$env:APP_ENV = "production"
$apiProcess = Start-Process -FilePath $apiPath `
  -WorkingDirectory $backendDir `
  -RedirectStandardOutput $apiOut `
  -RedirectStandardError $apiErr `
  -WindowStyle Hidden `
  -PassThru
Wait-ForPort -Port 8080 -Process $apiProcess
[System.IO.File]::WriteAllText((Join-Path $runtimeLogs "backend-api.pid"), [string]$apiProcess.Id)

$null = Wait-ForJsonEndpoint -Uri "http://localhost:8080/health" -Accept { param($r) $r.status -eq "ok" }
$null = Wait-ForJsonEndpoint -Uri "http://localhost:8080/health/ready" -Accept { param($r) $r.ready -eq $true -and $r.database -eq "up" }
$symbols = Wait-ForJsonEndpoint -Uri "http://localhost:8080/api/v1/mt5/symbols" -Accept { param($r) $r.connected -eq $true } -TimeoutSeconds 60

Wait-ForLogPattern `
  -Paths @($apiOut, $apiErr) `
  -Pattern "MT5 verifier runtime ready" `
  -Process $apiProcess

if (-not $SkipPublicHealthCheck) {
  $null = Wait-ForJsonEndpoint -Uri "https://api.tradingterminal.io.vn/health/ready" -Accept { param($r) $r.ready -eq $true -and $r.database -eq "up" } -TimeoutSeconds 30
}

Push-Location $repoRoot
try { $commit = (& git rev-parse --short HEAD).Trim() } finally { Pop-Location }
Write-Host "Backend production is ready." -ForegroundColor Green
Write-Host "Commit: $commit"
Write-Host "API PID: $($apiProcess.Id) | http://localhost:8080"
Write-Host "MT5 stream PID: $($bridgeProcess.Id) | ws://localhost:8765"
Write-Host "MT5 symbols connected: $($symbols.connected)"
Write-Host "MT5 account: $($accountProbe.login) | $($accountProbe.server) | tradeAllowed=$($accountProbe.tradeAllowed)"
Write-Host "Managed Python: $managedPython"
Write-Host "MT5 verifier terminal: $($env:MT5_VERIFY_TERMINAL_PATH)"
Write-Host "API log: $apiErr"
Write-Host "MT5 stream log: $bridgeErr"

$executionEnabled = Get-BackendEnvValue "FTMO_MT5_ENABLED"
if (Test-Truthy $executionEnabled) {
  Write-Warning "FTMO execution bridge 8787 is enabled but intentionally not started here; it belongs on the browser/account host, not the multi-user backend."
}
