[CmdletBinding()]
param(
  [string]$WorkerRoot,
  [string]$DataRoot,
  [string]$WorkerIdentity,
  [string]$TaskName = 'MarketLens MT5 Worker',
  [string]$WorkerId = 'marketlens-baremetal-01',
  [string]$AgentPath,
  [ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$AgentSha256,
  [string]$PythonPath,
  [ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$PythonSha256,
  [string]$AdapterPath,
  [ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$AdapterSha256,
  [string]$AclHelperPath,
  [string]$PowerShellPath = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe',
  [string]$BootstrapTokenFile,
  [string]$EaReleaseManifestPath,
  [string]$EaReleaseChecksumPath,
  [string]$MinimumEaVersion = '1.26',
  [string]$GatewayUrl,
  [string]$CredentialApiUrl,
  [object[]]$TerminalSlots,
  [string]$AgentVersion = '0.1.0',
  [string]$ImageVersion = 'bare-metal-v1',
  [string]$RuntimeVersion = 'mt5-managed-ea-v1',
  [string]$Region = 'local',
  [string]$ProbeSymbol = 'EURUSD',
  [string[]]$SyncSymbols = @('EURUSD'),
  [ValidateRange(60000, 2678400000)][long]$HistoryLookbackMs = 604800000,
  [ValidateRange(1, 32)][int]$MaxProcesses = 8,
  [ValidateRange(268435456, 17179869184)][long]$ProcessMemoryBytes = 1610612736,
  [ValidateRange(1, 100)][int]$CpuBudgetPercent = 100,
  [ValidateRange(1073741824, 1099511627776)][long]$MinimumFreeDiskBytes = 5368709120,
  [ValidateRange(1000, 60000)][int]$StartupTimeoutMs = 30000,
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:MarketLensPinnedMetaQuotesPublisher = 'CN=MetaQuotes Ltd., O=MetaQuotes Ltd., S=Lemesos, C=CY'

function Assert-MT5BareMetalAbsolutePath {
  param([Parameter(Mandatory = $true)][string]$Path, [switch]$AllowMissingLeaf)
  # Windows PowerShell 5.1 targets a .NET version that does not expose
  # Path.IsPathFullyQualified. IsPathRooted plus GetFullPath gives us the same
  # fail-closed boundary on the supported Windows worker hosts.
  if (-not [IO.Path]::IsPathRooted($Path)) { throw 'BAREMETAL_PATH_NOT_ABSOLUTE' }
  $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  if ([string]::IsNullOrWhiteSpace((Split-Path -Leaf $full))) { throw 'BAREMETAL_PATH_TOO_BROAD' }
  $cursor = if (Test-Path -LiteralPath $full) { Get-Item -LiteralPath $full -Force } else {
    Get-Item -LiteralPath (Split-Path -Parent $full) -Force -ErrorAction SilentlyContinue
  }
  while ($null -ne $cursor) {
    if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw 'BAREMETAL_REPARSE_POINT'
    }
    $cursor = if ($cursor -is [IO.FileInfo]) { $cursor.Directory } else { $cursor.Parent }
  }
  if (-not $AllowMissingLeaf -and -not (Test-Path -LiteralPath $full -PathType Leaf)) {
    throw 'BAREMETAL_ARTIFACT_MISSING'
  }
  return $full
}

function Get-MT5BareMetalArtifactBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$ExpectedSha256
  )
  $full = Assert-MT5BareMetalAbsolutePath -Path $Path
  $actual = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
  if (-not [string]::IsNullOrWhiteSpace($ExpectedSha256) -and
      -not [string]::Equals($actual, $ExpectedSha256, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'BAREMETAL_ARTIFACT_HASH_MISMATCH'
  }
  [pscustomobject][ordered]@{ path = $full; sha256 = $actual }
}

function Get-MT5BareMetalEaReleaseBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$ManifestPath,
    [Parameter(Mandatory = $true)][string]$ChecksumPath,
    [Parameter(Mandatory = $true)][string]$MinimumEaVersion
  )
  $manifestArtifact = Get-MT5BareMetalArtifactBoundary -Path $ManifestPath
  $checksumArtifact = Get-MT5BareMetalArtifactBoundary -Path $ChecksumPath
  try {
    $manifest = Get-Content -LiteralPath $manifestArtifact.path -Raw | ConvertFrom-Json
  } catch {
    throw 'BAREMETAL_EA_RELEASE_SCHEMA_INVALID'
  }
  $requiredProperties = @(
    'schemaVersion',
    'fileName',
    'eaVersion',
    'compilerVersion',
    'compilerSha256',
    'compilerSignerSubject',
    'sourceSha256',
    'binarySha256'
  )
  $observedProperties = @($manifest.PSObject.Properties.Name)
  if ($observedProperties.Count -ne $requiredProperties.Count -or
      @($requiredProperties | Where-Object { $observedProperties -cnotcontains $_ }).Count -ne 0 -or
      $manifest.schemaVersion -ne 2 -or
      [string]$manifest.fileName -cne 'MarketLensExecutionEA.ex5' -or
      [string]$manifest.sourceSha256 -notmatch '^[A-Fa-f0-9]{64}$' -or
      [string]$manifest.binarySha256 -notmatch '^[A-Fa-f0-9]{64}$') {
    throw 'BAREMETAL_EA_RELEASE_SCHEMA_INVALID'
  }
  if ([string]$manifest.compilerVersion -notmatch '^\d+\.\d+\.\d+\.\d+$' -or
      [string]$manifest.compilerSha256 -notmatch '^[A-Fa-f0-9]{64}$' -or
      -not [string]::Equals(
        [string]$manifest.compilerSignerSubject,
        $script:MarketLensPinnedMetaQuotesPublisher,
        [StringComparison]::Ordinal
      )) {
    throw 'BAREMETAL_EA_RELEASE_COMPILER_INVALID'
  }
  $releaseVersion = New-Object Version
  $minimumVersion = New-Object Version
  if ([string]$manifest.eaVersion -notmatch '^\d+\.\d+(?:\.\d+){0,2}$' -or
      $MinimumEaVersion -notmatch '^\d+\.\d+(?:\.\d+){0,2}$' -or
      -not [Version]::TryParse([string]$manifest.eaVersion, [ref]$releaseVersion) -or
      -not [Version]::TryParse($MinimumEaVersion, [ref]$minimumVersion) -or
      $releaseVersion -lt $minimumVersion) {
    throw 'BAREMETAL_EA_RELEASE_VERSION_UNSUPPORTED'
  }
  $checksum = (Get-Content -LiteralPath $checksumArtifact.path -Raw).TrimEnd([char[]]"`r`n")
  $expectedChecksum = '{0}  MarketLensExecutionEA.ex5' -f [string]$manifest.binarySha256
  if (-not [string]::Equals($checksum, $expectedChecksum, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'BAREMETAL_EA_RELEASE_CHECKSUM_MISMATCH'
  }
  $binaryPath = Join-Path (Split-Path -Parent $manifestArtifact.path) 'MarketLensExecutionEA.ex5'
  $binary = Get-MT5BareMetalArtifactBoundary -Path $binaryPath
  if (-not [string]::Equals(
      $binary.sha256,
      [string]$manifest.binarySha256,
      [StringComparison]::OrdinalIgnoreCase
    )) {
    throw 'BAREMETAL_EA_RELEASE_CHECKSUM_MISMATCH'
  }
  [pscustomobject][ordered]@{
    ea_version = [string]$manifest.eaVersion
    binary_sha256 = ([string]$manifest.binarySha256).ToLowerInvariant()
    binary_path = $binary.path
    compiler_version = [string]$manifest.compilerVersion
    compiler_sha256 = ([string]$manifest.compilerSha256).ToLowerInvariant()
  }
}

function Get-MT5BareMetalTerminalBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256
  )
  $artifact = Get-MT5BareMetalArtifactBoundary -Path $Path -ExpectedSha256 $ExpectedSha256
  $signature = Get-AuthenticodeSignature -FilePath $artifact.path
  if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or
      -not [string]::Equals(
        [string]$signature.SignerCertificate.Subject,
        $script:MarketLensPinnedMetaQuotesPublisher,
        [StringComparison]::Ordinal
      )) {
    throw 'BAREMETAL_TERMINAL_SIGNER_MISMATCH'
  }
  return $artifact
}

function Test-MT5BareMetalLoopbackOrigin {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$Origin)
  $parsed = $null
  if ($Origin.Length -lt 8 -or $Origin.Length -gt 2048 -or
      -not [Uri]::TryCreate($Origin, [UriKind]::Absolute, [ref]$parsed) -or
      $parsed.Scheme -cne 'http' -or
      -not [string]::IsNullOrEmpty($parsed.UserInfo) -or
      -not [string]::IsNullOrEmpty($parsed.Query) -or
      -not [string]::IsNullOrEmpty($parsed.Fragment) -or
      $parsed.AbsolutePath -cne '/' -or
      $parsed.GetLeftPart([UriPartial]::Authority) -cne $Origin) {
    return $false
  }
  if ([string]::Equals($parsed.Host, 'localhost', [StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }
  $address = $null
  return [Net.IPAddress]::TryParse($parsed.Host, [ref]$address) -and
    [Net.IPAddress]::IsLoopback($address)
}

function Get-MT5BareMetalPrivateServiceUrlBoundary {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$Url)
  $parsed = $null
  if ($Url.Length -lt 8 -or $Url.Length -gt 2048 -or
      -not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$parsed) -or
      [string]::IsNullOrWhiteSpace($parsed.Host) -or
      -not [string]::IsNullOrEmpty($parsed.UserInfo) -or
      -not [string]::IsNullOrEmpty($parsed.Query) -or
      -not [string]::IsNullOrEmpty($parsed.Fragment)) {
    throw 'BAREMETAL_CONFIG_INVALID'
  }
  if ($parsed.Scheme -ieq 'https') {
    return [pscustomobject][ordered]@{ value = $Url; loopback_http = $false }
  }
  $address = $null
  if ($parsed.Scheme -ine 'http' -or
      -not [Net.IPAddress]::TryParse($parsed.Host, [ref]$address) -or
      -not [Net.IPAddress]::IsLoopback($address)) {
    throw 'BAREMETAL_CONFIG_INVALID'
  }
  return [pscustomobject][ordered]@{ value = $Url; loopback_http = $true }
}

function Get-MT5BareMetalExactTerminalProcessBoundary {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$TerminalPath)
  $expected = [IO.Path]::GetFullPath($TerminalPath)
  return @(Get-CimInstance Win32_Process -Filter "Name='terminal64.exe'" -ErrorAction Stop |
      Where-Object {
        -not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath) -and
        [string]::Equals(
          [IO.Path]::GetFullPath([string]$_.ExecutablePath),
          $expected,
          [StringComparison]::OrdinalIgnoreCase
        )
      })
}

function Assert-MT5BareMetalEaChartTemplateBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256,
    [Parameter(Mandatory = $true)][string]$BootstrapPipe,
    [Parameter(Mandatory = $true)][string]$GatewayOrigin
  )
  $artifact = Get-MT5BareMetalArtifactBoundary -Path $Path -ExpectedSha256 $ExpectedSha256
  try {
    $contents = Get-Content -LiteralPath $artifact.path -Raw
  } catch {
    throw 'BAREMETAL_EA_CHART_TEMPLATE_INVALID'
  }
  if ([string]::IsNullOrWhiteSpace($contents) -or $contents.IndexOf([char]0) -ge 0) {
    throw 'BAREMETAL_EA_CHART_TEMPLATE_INVALID'
  }
  $lines = @($contents -split "`r?`n" | ForEach-Object { $_.Trim() })
  $requiredExactLines = @(
    'path=Experts\MarketLensExecutionEA.ex5',
    ('GatewayUrl={0}' -f $GatewayOrigin),
    'PairingToken=',
    ('BootstrapPipe={0}' -f $BootstrapPipe)
  )
  if (@($lines | Where-Object { $_ -ceq '<chart>' }).Count -ne 1 -or
      @($lines | Where-Object { $_ -ceq '</chart>' }).Count -ne 1 -or
      @($lines | Where-Object { $_ -ceq '<expert>' }).Count -ne 1 -or
      @($lines | Where-Object { $_ -ceq '</expert>' }).Count -ne 1 -or
      @($lines | Where-Object { $_ -cmatch '^path=Experts\\.*\.ex5$' }).Count -ne 1 -or
      @($lines | Where-Object { $_ -cmatch '^GatewayUrl=' }).Count -ne 1 -or
      @($lines | Where-Object { $_ -cmatch '^PairingToken=' }).Count -ne 1 -or
      @($lines | Where-Object { $_ -cmatch '^BootstrapPipe=' }).Count -ne 1 -or
      @($requiredExactLines | Where-Object { $lines -cnotcontains $_ }).Count -ne 0) {
    throw 'BAREMETAL_EA_CHART_TEMPLATE_INVALID'
  }
  return $artifact
}

function Assert-MT5BareMetalWebRequestAttestationBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256,
    [Parameter(Mandatory = $true)][string]$ExpectedSettingsSha256,
    [Parameter(Mandatory = $true)][string]$GatewayOrigin
  )
  $artifact = Get-MT5BareMetalArtifactBoundary -Path $Path -ExpectedSha256 $ExpectedSha256
  try {
    $attestation = Get-Content -LiteralPath $artifact.path -Raw | ConvertFrom-Json
  } catch {
    throw 'BAREMETAL_WEBREQUEST_ATTESTATION_INVALID'
  }
  $requiredProperties = @(
    'schemaVersion',
    'settingsFileName',
    'settingsSha256',
    'allowedOrigins',
    'probeSucceeded'
  )
  $observedProperties = @($attestation.PSObject.Properties.Name)
  $allowedOrigins = @($attestation.allowedOrigins)
  if ($observedProperties.Count -ne $requiredProperties.Count -or
      @($requiredProperties | Where-Object { $observedProperties -cnotcontains $_ }).Count -ne 0 -or
      $attestation.schemaVersion -ne 1 -or
      [string]$attestation.settingsFileName -cne 'experts.ini' -or
      -not [string]::Equals(
        [string]$attestation.settingsSha256,
        $ExpectedSettingsSha256,
        [StringComparison]::OrdinalIgnoreCase
      ) -or
      $allowedOrigins.Count -ne 1 -or
      [string]$allowedOrigins[0] -cne $GatewayOrigin -or
      $attestation.probeSucceeded -isnot [bool] -or
      -not [bool]$attestation.probeSucceeded) {
    throw 'BAREMETAL_WEBREQUEST_ATTESTATION_INVALID'
  }
  return $artifact
}

function Install-MT5BareMetalPinnedFileBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$DestinationPath,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256,
    [switch]$Execute
  )
  $source = Get-MT5BareMetalArtifactBoundary -Path $SourcePath -ExpectedSha256 $ExpectedSha256
  $destination = Assert-MT5BareMetalAbsolutePath -Path $DestinationPath -AllowMissingLeaf
  if (Test-Path -LiteralPath $destination) {
    if (-not (Test-Path -LiteralPath $destination -PathType Leaf)) {
      throw 'BAREMETAL_TOPOLOGY_DESTINATION_CONFLICT'
    }
    $existing = Get-MT5BareMetalArtifactBoundary -Path $destination
    if (-not [string]::Equals(
        $existing.sha256,
        $source.sha256,
        [StringComparison]::OrdinalIgnoreCase
      )) {
      throw 'BAREMETAL_TOPOLOGY_DESTINATION_CONFLICT'
    }
    return $existing
  }
  if ($Execute) {
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $null = Assert-MT5BareMetalAbsolutePath -Path $parent -AllowMissingLeaf
    Copy-Item -LiteralPath $source.path -Destination $destination
    $installed = Get-MT5BareMetalArtifactBoundary -Path $destination -ExpectedSha256 $ExpectedSha256
    return $installed
  }
  return [pscustomobject][ordered]@{ path = $destination; sha256 = $source.sha256 }
}

function Install-MT5BareMetalEaTopologyBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$TerminalPath,
    [Parameter(Mandatory = $true)][string]$TerminalStateRoot,
    [Parameter(Mandatory = $true)][string]$EaSourcePath,
    [Parameter(Mandatory = $true)][string]$ExpectedEaSha256,
    [Parameter(Mandatory = $true)][string]$EaDestinationPath,
    [Parameter(Mandatory = $true)][string]$ChartTemplatePath,
    [Parameter(Mandatory = $true)][string]$ExpectedChartSha256,
    [Parameter(Mandatory = $true)][string]$ProfileName,
    [Parameter(Mandatory = $true)][string]$BootstrapPipe,
    [Parameter(Mandatory = $true)][string]$GatewayOrigin,
    [Parameter(Mandatory = $true)][string]$WebRequestSettingsPath,
    [Parameter(Mandatory = $true)][string]$ExpectedWebRequestSettingsSha256,
    [Parameter(Mandatory = $true)][string]$TopologyAttestationPath,
    [Parameter(Mandatory = $true)][string]$ExpectedTopologyAttestationSha256,
    [switch]$Execute
  )
  if ($ProfileName -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' -or
      $BootstrapPipe -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' -or
      -not (Test-MT5BareMetalLoopbackOrigin -Origin $GatewayOrigin) -or
      @($ExpectedEaSha256, $ExpectedChartSha256, $ExpectedWebRequestSettingsSha256,
        $ExpectedTopologyAttestationSha256 | Where-Object {
          [string]$_ -notmatch '^[A-Fa-f0-9]{64}$'
        }).Count -ne 0) {
    if (-not (Test-MT5BareMetalLoopbackOrigin -Origin $GatewayOrigin)) {
      throw 'BAREMETAL_EA_GATEWAY_ORIGIN_INVALID'
    }
    throw 'BAREMETAL_EA_TOPOLOGY_INVALID'
  }
  $terminal = Assert-MT5BareMetalAbsolutePath -Path $TerminalPath
  if ([IO.Path]::GetFileName($terminal) -ine 'terminal64.exe') {
    throw 'BAREMETAL_EA_TOPOLOGY_INVALID'
  }
  $stateRoot = Assert-MT5BareMetalAbsolutePath -Path $TerminalStateRoot -AllowMissingLeaf
  if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) {
    throw 'BAREMETAL_TERMINAL_STATE_INVALID'
  }
  $originPath = Join-Path $stateRoot 'origin.txt'
  if (-not (Test-Path -LiteralPath $originPath -PathType Leaf)) {
    throw 'BAREMETAL_TERMINAL_STATE_INVALID'
  }
  $observedInstallRoot = (Get-Content -LiteralPath $originPath -Raw).Trim()
  $expectedInstallRoot = [IO.Path]::GetFullPath((Split-Path -Parent $terminal)).TrimEnd('\')
  if (-not [IO.Path]::IsPathRooted($observedInstallRoot) -or
      -not [string]::Equals(
        [IO.Path]::GetFullPath($observedInstallRoot).TrimEnd('\'),
        $expectedInstallRoot,
        [StringComparison]::OrdinalIgnoreCase
      )) {
    throw 'BAREMETAL_TERMINAL_STATE_INVALID'
  }
  $expectedEaDestination = Join-Path $stateRoot 'MQL5\Experts\MarketLensExecutionEA.ex5'
  $eaDestination = Assert-MT5BareMetalAbsolutePath -Path $EaDestinationPath -AllowMissingLeaf
  if (-not [string]::Equals(
      $eaDestination,
      [IO.Path]::GetFullPath($expectedEaDestination),
      [StringComparison]::OrdinalIgnoreCase
    )) {
    throw 'BAREMETAL_EA_TOPOLOGY_INVALID'
  }
  $chart = Assert-MT5BareMetalEaChartTemplateBoundary `
    -Path $ChartTemplatePath -ExpectedSha256 $ExpectedChartSha256 `
    -BootstrapPipe $BootstrapPipe -GatewayOrigin $GatewayOrigin
  $settings = Get-MT5BareMetalArtifactBoundary `
    -Path $WebRequestSettingsPath -ExpectedSha256 $ExpectedWebRequestSettingsSha256
  $attestation = Assert-MT5BareMetalWebRequestAttestationBoundary `
    -Path $TopologyAttestationPath `
    -ExpectedSha256 $ExpectedTopologyAttestationSha256 `
    -ExpectedSettingsSha256 $settings.sha256 -GatewayOrigin $GatewayOrigin

  $profileDirectory = Join-Path $stateRoot ('MQL5\Profiles\Charts\' + $ProfileName)
  $chartDestination = Join-Path $profileDirectory 'chart01.chr'
  if (Test-Path -LiteralPath $profileDirectory -PathType Container) {
    $otherCharts = @(Get-ChildItem -LiteralPath $profileDirectory -Filter '*.chr' -File |
        Where-Object {
          -not [string]::Equals(
            [IO.Path]::GetFullPath($_.FullName),
            [IO.Path]::GetFullPath($chartDestination),
            [StringComparison]::OrdinalIgnoreCase
          )
        })
    if ($otherCharts.Count -ne 0) {
      throw 'BAREMETAL_EA_PROFILE_TOPOLOGY_INVALID'
    }
  }
  if ($Execute -and @(Get-MT5BareMetalExactTerminalProcessBoundary -TerminalPath $terminal).Count -ne 0) {
    throw 'BAREMETAL_TOPOLOGY_TERMINAL_RUNNING'
  }

  $installedEa = Install-MT5BareMetalPinnedFileBoundary `
    -SourcePath $EaSourcePath -DestinationPath $eaDestination `
    -ExpectedSha256 $ExpectedEaSha256 -Execute:$Execute
  $installedChart = Install-MT5BareMetalPinnedFileBoundary `
    -SourcePath $chart.path -DestinationPath $chartDestination `
    -ExpectedSha256 $chart.sha256 -Execute:$Execute
  $installedSettings = Install-MT5BareMetalPinnedFileBoundary `
    -SourcePath $settings.path -DestinationPath (Join-Path $stateRoot 'Config\experts.ini') `
    -ExpectedSha256 $settings.sha256 -Execute:$Execute
  $installedAttestation = Install-MT5BareMetalPinnedFileBoundary `
    -SourcePath $attestation.path `
    -DestinationPath (Join-Path $stateRoot 'Config\marketlens-webrequest-attestation.json') `
    -ExpectedSha256 $attestation.sha256 -Execute:$Execute

  if ($Execute) {
    $installedCharts = @(Get-ChildItem -LiteralPath $profileDirectory -Filter '*.chr' -File)
    if ($installedCharts.Count -ne 1 -or
        -not [string]::Equals(
          [IO.Path]::GetFullPath($installedCharts[0].FullName),
          [IO.Path]::GetFullPath($installedChart.path),
          [StringComparison]::OrdinalIgnoreCase
        )) {
      throw 'BAREMETAL_EA_PROFILE_TOPOLOGY_INVALID'
    }
    $null = Assert-MT5BareMetalEaChartTemplateBoundary `
      -Path $installedChart.path -ExpectedSha256 $installedChart.sha256 `
      -BootstrapPipe $BootstrapPipe -GatewayOrigin $GatewayOrigin
    $null = Assert-MT5BareMetalWebRequestAttestationBoundary `
      -Path $installedAttestation.path -ExpectedSha256 $installedAttestation.sha256 `
      -ExpectedSettingsSha256 $installedSettings.sha256 -GatewayOrigin $GatewayOrigin
  }
  [pscustomobject][ordered]@{
    status = if ($Execute) { 'PASS' } else { 'DRY_RUN' }
    dry_run = -not [bool]$Execute
    terminal_state_root = $stateRoot
    ea_path = $installedEa.path
    ea_sha256 = $installedEa.sha256
    ea_profile_chart_path = $installedChart.path
    ea_profile_chart_sha256 = $installedChart.sha256
    ea_webrequest_settings_path = $installedSettings.path
    ea_webrequest_settings_sha256 = $installedSettings.sha256
    ea_topology_attestation_path = $installedAttestation.path
    ea_topology_attestation_sha256 = $installedAttestation.sha256
    ea_gateway_origin = $GatewayOrigin
  }
}

function Get-MT5BareMetalIdentitySidBoundary {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$WorkerIdentity)
  try {
    return ([Security.Principal.NTAccount]$WorkerIdentity).Translate(
      [Security.Principal.SecurityIdentifier]
    ).Value
  } catch {
    throw 'BAREMETAL_WORKER_IDENTITY_NOT_FOUND'
  }
}

function New-MT5BareMetalAclBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$WorkerSid,
    [switch]$Container,
    [switch]$WorkerReadOnly
  )
  try {
    $workerIdentity = New-Object Security.Principal.SecurityIdentifier($WorkerSid)
    $systemIdentity = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
  } catch {
    throw 'BAREMETAL_ROOT_ACL_INVALID'
  }
  $acl = if ($Container) {
    New-Object Security.AccessControl.DirectorySecurity
  } else {
    New-Object Security.AccessControl.FileSecurity
  }
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner($workerIdentity)
  $inheritance = if ($Container) {
    [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor `
      [Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else {
    [Security.AccessControl.InheritanceFlags]::None
  }
  $workerRights = if ($WorkerReadOnly) {
    [Security.AccessControl.FileSystemRights]::ReadAndExecute
  } else {
    [Security.AccessControl.FileSystemRights]::FullControl
  }
  foreach ($entry in @(
    [pscustomobject]@{ identity = $workerIdentity; rights = $workerRights },
    [pscustomobject]@{
      identity = $systemIdentity
      rights = [Security.AccessControl.FileSystemRights]::FullControl
    }
  )) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(
      $entry.identity,
      $entry.rights,
      $inheritance,
      [Security.AccessControl.PropagationFlags]::None,
      [Security.AccessControl.AccessControlType]::Allow
    )
    $acl.AddAccessRule($rule) | Out-Null
  }
  return $acl
}

function Assert-MT5BareMetalAclBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][object]$Acl,
    [Parameter(Mandatory = $true)][string]$WorkerSid,
    [switch]$Container,
    [switch]$WorkerReadOnly
  )
  try {
    $ownerSid = $Acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    $rules = @($Acl.GetAccessRules(
      $true,
      $true,
      [Security.Principal.SecurityIdentifier]
    ))
  } catch {
    throw 'BAREMETAL_ROOT_ACL_INVALID'
  }
  if (-not $Acl.AreAccessRulesProtected -or
      -not [string]::Equals($ownerSid, $WorkerSid, [StringComparison]::OrdinalIgnoreCase) -or
      $rules.Count -ne 2) {
    throw 'BAREMETAL_ROOT_ACL_TOO_BROAD'
  }
  $expectedInheritance = if ($Container) {
    [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor `
      [Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else {
    [Security.AccessControl.InheritanceFlags]::None
  }
  $expectedRights = @{
    $WorkerSid = if ($WorkerReadOnly) {
      [Security.AccessControl.FileSystemRights]::ReadAndExecute
    } else {
      [Security.AccessControl.FileSystemRights]::FullControl
    }
    'S-1-5-18' = [Security.AccessControl.FileSystemRights]::FullControl
  }
  $observed = @{}
  foreach ($rule in $rules) {
    $sid = $rule.IdentityReference.Value
    if (-not $expectedRights.ContainsKey($sid) -or $observed.ContainsKey($sid) -or
        $rule.IsInherited -or
        $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
        [int]$rule.FileSystemRights -ne [int]$expectedRights[$sid] -or
        [int]$rule.InheritanceFlags -ne [int]$expectedInheritance -or
        $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None) {
      throw 'BAREMETAL_ROOT_ACL_TOO_BROAD'
    }
    $observed[$sid] = $true
  }
  if ($observed.Count -ne 2) { throw 'BAREMETAL_ROOT_ACL_INCOMPLETE' }
}

function Assert-MT5BareMetalTokenAclBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$WorkerSid
  )
  $acl = Get-Acl -LiteralPath $Path
  if (-not $acl.AreAccessRulesProtected) { throw 'BAREMETAL_TOKEN_ACL_INHERITED' }
  $allowed = @($WorkerSid, 'S-1-5-18')
  $observed = @()
  foreach ($rule in $acl.Access) {
    if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { continue }
    try {
      $sid = $rule.IdentityReference.Translate(
        [Security.Principal.SecurityIdentifier]
      ).Value
    } catch {
      throw 'BAREMETAL_TOKEN_ACL_INVALID'
    }
    if ($allowed -notcontains $sid) { throw 'BAREMETAL_TOKEN_ACL_TOO_BROAD' }
    $observed += $sid
  }
  foreach ($required in $allowed) {
    if ($observed -notcontains $required) { throw 'BAREMETAL_TOKEN_ACL_INCOMPLETE' }
  }
}

function Protect-MT5BareMetalRootBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$WorkerSid,
    [switch]$WorkerReadOnly
  )
  $full = Assert-MT5BareMetalAbsolutePath -Path $Path -AllowMissingLeaf
  New-Item -ItemType Directory -Path $full -Force | Out-Null
  $items = @((Get-Item -LiteralPath $full -Force)) + @(
    Get-ChildItem -LiteralPath $full -Force -Recurse -ErrorAction Stop
  )
  foreach ($item in $items) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw 'BAREMETAL_REPARSE_POINT'
    }
  }
  foreach ($item in $items) {
    $container = [bool]$item.PSIsContainer
    $aclArguments = @{
      WorkerSid = $WorkerSid
      Container = $container
      WorkerReadOnly = [bool]$WorkerReadOnly
    }
    $acl = New-MT5BareMetalAclBoundary @aclArguments
    Set-Acl -LiteralPath $item.FullName -AclObject $acl
    $applied = Get-Acl -LiteralPath $item.FullName
    Assert-MT5BareMetalAclBoundary -Acl $applied @aclArguments
  }
}

function Write-MT5BareMetalConfigBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$WorkerRoot,
    [Parameter(Mandatory = $true)][object]$Config,
    [Parameter(Mandatory = $true)][string]$AgentSourcePath,
    [Parameter(Mandatory = $true)][string]$ExpectedAgentSha256
  )
  $root = Assert-MT5BareMetalAbsolutePath -Path $WorkerRoot -AllowMissingLeaf
  $sourceAgent = Get-MT5BareMetalArtifactBoundary `
    -Path $AgentSourcePath -ExpectedSha256 $ExpectedAgentSha256
  New-Item -ItemType Directory -Path $root -Force | Out-Null
  $null = Assert-MT5BareMetalAbsolutePath -Path $root -AllowMissingLeaf
  $configPath = Join-Path $root 'managed-worker.json'
  $launcherPath = Join-Path $root 'Start-MT5BareMetalWorker.ps1'
  $installedAgentPath = Join-Path $root 'mt5-vm-agent.exe'
  $launcherSource = Join-Path $PSScriptRoot 'Start-MT5BareMetalWorker.ps1'
  if (-not (Test-Path -LiteralPath $launcherSource -PathType Leaf)) {
    throw 'BAREMETAL_LAUNCHER_MISSING'
  }
  if (-not [string]::Equals(
      $sourceAgent.path,
      $installedAgentPath,
      [StringComparison]::OrdinalIgnoreCase
    )) {
    Copy-Item -LiteralPath $sourceAgent.path -Destination $installedAgentPath -Force
  }
  $installedAgent = Get-MT5BareMetalArtifactBoundary `
    -Path $installedAgentPath -ExpectedSha256 $sourceAgent.sha256
  [IO.File]::WriteAllText(
    $configPath,
    ($Config | ConvertTo-Json -Depth 12 -Compress),
    (New-Object Text.UTF8Encoding($false))
  )
  Copy-Item -LiteralPath $launcherSource -Destination $launcherPath -Force
  [pscustomobject][ordered]@{
    config_path = $configPath
    launcher_path = $launcherPath
    agent_path = $installedAgent.path
    agent_sha256 = $installedAgent.sha256
    config_sha256 = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

function Get-MT5BareMetalTaskArgumentsBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$LauncherPath,
    [Parameter(Mandatory = $true)][string]$AgentPath,
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true)][string]$ExpectedAgentSha256,
    [Parameter(Mandatory = $true)][string]$ExpectedConfigSha256
  )
  foreach ($value in @($LauncherPath, $AgentPath, $ConfigPath)) {
    if ([string]::IsNullOrWhiteSpace($value) -or $value.IndexOfAny([char[]]"`"`r`n`0") -ge 0) {
      throw 'BAREMETAL_TASK_ARGUMENT_INVALID'
    }
  }
  foreach ($hash in @($ExpectedAgentSha256, $ExpectedConfigSha256)) {
    if ($hash -notmatch '^[A-Fa-f0-9]{64}$') {
      throw 'BAREMETAL_TASK_ARGUMENT_INVALID'
    }
  }
  return '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -AgentPath "{1}" -ConfigPath "{2}" -ExpectedAgentSha256 {3} -ExpectedConfigSha256 {4}' -f `
    $LauncherPath, $AgentPath, $ConfigPath, `
    $ExpectedAgentSha256.ToLowerInvariant(), $ExpectedConfigSha256.ToLowerInvariant()
}

function Assert-MT5BareMetalTaskContractBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][object]$Task,
    [Parameter(Mandatory = $true)][string]$WorkerIdentity,
    [Parameter(Mandatory = $true)][string]$PowerShellPath,
    [Parameter(Mandatory = $true)][string]$ExpectedArguments
  )
  $actions = @($Task.Actions)
  $triggers = @($Task.Triggers)
  if ($actions.Count -ne 1 -or $triggers.Count -ne 1 -or $null -eq $Task.Principal) {
    throw 'BAREMETAL_TASK_CONTRACT_INVALID'
  }
  $triggerClass = [string]$triggers[0].CimClass.CimClassName
  if (-not [string]::Equals(
        [string]$actions[0].Execute,
        $PowerShellPath,
        [StringComparison]::OrdinalIgnoreCase
      ) -or
      [string]$actions[0].Arguments -cne $ExpectedArguments -or
      -not [string]::Equals(
        [string]$Task.Principal.UserId,
        $WorkerIdentity,
        [StringComparison]::OrdinalIgnoreCase
      ) -or
      [string]$Task.Principal.LogonType -cne 'Interactive' -or
      [string]$Task.Principal.RunLevel -cne 'Limited' -or
      -not [bool]$triggers[0].Enabled -or
      -not [string]::Equals(
        [string]$triggers[0].UserId,
        $WorkerIdentity,
        [StringComparison]::OrdinalIgnoreCase
      ) -or
      $triggerClass -cne 'MSFT_TaskLogonTrigger') {
    throw 'BAREMETAL_TASK_CONTRACT_INVALID'
  }
}

function Register-MT5BareMetalTaskBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$TaskName,
    [Parameter(Mandatory = $true)][string]$WorkerIdentity,
    [Parameter(Mandatory = $true)][string]$PowerShellPath,
    [Parameter(Mandatory = $true)][string]$LauncherPath,
    [Parameter(Mandatory = $true)][string]$AgentPath,
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true)][string]$ExpectedAgentSha256,
    [Parameter(Mandatory = $true)][string]$ExpectedConfigSha256
  )
  if ($TaskName.Length -gt 96 -or [string]::IsNullOrWhiteSpace($WorkerIdentity) -or
      $WorkerIdentity.IndexOfAny([char[]]"`r`n`0") -ge 0) {
    throw 'BAREMETAL_TASK_IDENTITY_INVALID'
  }
  $arguments = Get-MT5BareMetalTaskArgumentsBoundary `
    -LauncherPath $LauncherPath -AgentPath $AgentPath -ConfigPath $ConfigPath `
    -ExpectedAgentSha256 $ExpectedAgentSha256 `
    -ExpectedConfigSha256 $ExpectedConfigSha256
  $action = New-ScheduledTaskAction -Execute $PowerShellPath -Argument $arguments
  $principal = New-ScheduledTaskPrincipal -UserId $WorkerIdentity -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $WorkerIdentity
  Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal `
    -Settings $settings -Trigger $trigger -Force | Out-Null
  $registered = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  if ($null -eq $registered) { throw 'BAREMETAL_TASK_HEALTH_INVALID' }
  Assert-MT5BareMetalTaskContractBoundary -Task $registered `
    -WorkerIdentity $WorkerIdentity -PowerShellPath $PowerShellPath `
    -ExpectedArguments $arguments
}

function Install-MT5BareMetalWorkerCore {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$WorkerRoot,
    [Parameter(Mandatory = $true)][string]$DataRoot,
    [Parameter(Mandatory = $true)][string]$WorkerIdentity,
    [Parameter(Mandatory = $true)][string]$TaskName,
    [string]$WorkerId = 'marketlens-baremetal-01',
    [Parameter(Mandatory = $true)][string]$AgentPath,
    [Parameter(Mandatory = $true)][string]$AgentSha256,
    [Parameter(Mandatory = $true)][string]$PythonPath,
    [Parameter(Mandatory = $true)][string]$PythonSha256,
    [Parameter(Mandatory = $true)][string]$AdapterPath,
    [Parameter(Mandatory = $true)][string]$AdapterSha256,
    [Parameter(Mandatory = $true)][string]$AclHelperPath,
    [Parameter(Mandatory = $true)][string]$PowerShellPath,
    [Parameter(Mandatory = $true)][string]$BootstrapTokenFile,
    [Parameter(Mandatory = $true)][string]$EaReleaseManifestPath,
    [Parameter(Mandatory = $true)][string]$EaReleaseChecksumPath,
    [string]$MinimumEaVersion = '1.26',
    [Parameter(Mandatory = $true)][string]$GatewayUrl,
    [Parameter(Mandatory = $true)][string]$CredentialApiUrl,
    [Parameter(Mandatory = $true)][object[]]$TerminalSlots,
    [string]$AgentVersion = '0.1.0',
    [string]$ImageVersion = 'bare-metal-v1',
    [string]$RuntimeVersion = 'mt5-managed-ea-v1',
    [string]$Region = 'local',
    [string]$ProbeSymbol = 'EURUSD',
    [string[]]$SyncSymbols = @('EURUSD'),
    [long]$HistoryLookbackMs = 604800000,
    [int]$MaxProcesses = 8,
    [long]$ProcessMemoryBytes = 1610612736,
    [int]$CpuBudgetPercent = 100,
    [long]$MinimumFreeDiskBytes = 5368709120,
    [int]$StartupTimeoutMs = 30000,
    [switch]$Execute
  )
  $gatewayService = Get-MT5BareMetalPrivateServiceUrlBoundary -Url $GatewayUrl
  $credentialService = Get-MT5BareMetalPrivateServiceUrlBoundary -Url $CredentialApiUrl
  if ($WorkerId -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' -or
      $TerminalSlots.Count -lt 1 -or $TerminalSlots.Count -gt 4 -or
      [string]::IsNullOrWhiteSpace($WorkerIdentity) -or
      $SyncSymbols.Count -gt 256 -or
      $CpuBudgetPercent -lt 1 -or $CpuBudgetPercent -gt 100 -or
      $MinimumFreeDiskBytes -lt 1073741824) {
    throw 'BAREMETAL_CONFIG_INVALID'
  }
  $root = Assert-MT5BareMetalAbsolutePath -Path $WorkerRoot -AllowMissingLeaf
  $data = Assert-MT5BareMetalAbsolutePath -Path $DataRoot -AllowMissingLeaf
  $rootPrefix = $root + [IO.Path]::DirectorySeparatorChar
  $dataPrefix = $data + [IO.Path]::DirectorySeparatorChar
  if ([string]::Equals($root, $data, [StringComparison]::OrdinalIgnoreCase) -or
      $root.StartsWith($dataPrefix, [StringComparison]::OrdinalIgnoreCase) -or
      $data.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'BAREMETAL_ROOTS_NOT_ISOLATED'
  }
  $workerSid = Get-MT5BareMetalIdentitySidBoundary -WorkerIdentity $WorkerIdentity
  $agent = Get-MT5BareMetalArtifactBoundary -Path $AgentPath -ExpectedSha256 $AgentSha256
  $python = Get-MT5BareMetalArtifactBoundary -Path $PythonPath -ExpectedSha256 $PythonSha256
  $adapter = Get-MT5BareMetalArtifactBoundary -Path $AdapterPath -ExpectedSha256 $AdapterSha256
  $acl = Get-MT5BareMetalArtifactBoundary -Path $AclHelperPath
  $powershell = Get-MT5BareMetalArtifactBoundary -Path $PowerShellPath
  $tokenFile = Assert-MT5BareMetalAbsolutePath -Path $BootstrapTokenFile
  Assert-MT5BareMetalTokenAclBoundary -Path $tokenFile -WorkerSid $workerSid
  $eaRelease = Get-MT5BareMetalEaReleaseBoundary `
    -ManifestPath $EaReleaseManifestPath -ChecksumPath $EaReleaseChecksumPath `
    -MinimumEaVersion $MinimumEaVersion
  $seenPaths = @{}
  $seenEaPaths = @{}
  $seenIds = @{}
  $seenPipes = @{}
  $seenProfiles = @{}
  $slots = @()
  foreach ($slot in $TerminalSlots) {
    if ([string]$slot.slot_id -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' -or
        [string]$slot.ea_bootstrap_pipe -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' -or
        [string]$slot.ea_profile -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' -or
        -not (Test-MT5BareMetalLoopbackOrigin -Origin ([string]$slot.ea_gateway_origin)) -or
        [string]$slot.terminal_sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or
        [string]$slot.servers_sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or
        [string]$slot.terminal_license_sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or
        [string]$slot.ea_sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or
        [string]$slot.ea_chart_template_sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or
        [string]$slot.ea_webrequest_settings_sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or
        [string]$slot.ea_topology_attestation_sha256 -notmatch '^[A-Fa-f0-9]{64}$') {
      throw 'BAREMETAL_SLOT_INVALID'
    }
    $terminal = Get-MT5BareMetalTerminalBoundary -Path ([string]$slot.terminal_path) `
      -ExpectedSha256 ([string]$slot.terminal_sha256)
    $topology = Install-MT5BareMetalEaTopologyBoundary `
      -TerminalPath $terminal.path `
      -TerminalStateRoot ([string]$slot.terminal_state_root) `
      -EaSourcePath $eaRelease.binary_path `
      -ExpectedEaSha256 ([string]$slot.ea_sha256) `
      -EaDestinationPath ([string]$slot.ea_path) `
      -ChartTemplatePath ([string]$slot.ea_chart_template_path) `
      -ExpectedChartSha256 ([string]$slot.ea_chart_template_sha256) `
      -ProfileName ([string]$slot.ea_profile) `
      -BootstrapPipe ([string]$slot.ea_bootstrap_pipe) `
      -GatewayOrigin ([string]$slot.ea_gateway_origin) `
      -WebRequestSettingsPath ([string]$slot.ea_webrequest_settings_source_path) `
      -ExpectedWebRequestSettingsSha256 ([string]$slot.ea_webrequest_settings_sha256) `
      -TopologyAttestationPath ([string]$slot.ea_topology_attestation_source_path) `
      -ExpectedTopologyAttestationSha256 ([string]$slot.ea_topology_attestation_sha256) `
      -Execute:$Execute
    if (-not [string]::Equals(
        $topology.ea_sha256,
        $eaRelease.binary_sha256,
        [StringComparison]::OrdinalIgnoreCase
      )) {
      throw 'BAREMETAL_EA_RELEASE_CHECKSUM_MISMATCH'
    }
    if ($seenPaths.ContainsKey($terminal.path) -or
        $seenEaPaths.ContainsKey($topology.ea_path) -or
        $seenIds.ContainsKey([string]$slot.slot_id) -or
        $seenPipes.ContainsKey([string]$slot.ea_bootstrap_pipe) -or
        $seenProfiles.ContainsKey([string]$slot.ea_profile)) {
      throw 'BAREMETAL_SLOT_DUPLICATE'
    }
    $seenPaths[$terminal.path] = $true
    $seenEaPaths[$topology.ea_path] = $true
    $seenIds[[string]$slot.slot_id] = $true
    $seenPipes[[string]$slot.ea_bootstrap_pipe] = $true
    $seenProfiles[[string]$slot.ea_profile] = $true
    $slots += [ordered]@{
      slot_id = [string]$slot.slot_id
      terminal_path = $terminal.path
      terminal_sha256 = $terminal.sha256
      servers_sha256 = [string]$slot.servers_sha256
      terminal_license_sha256 = [string]$slot.terminal_license_sha256
      ea_path = $topology.ea_path
      ea_sha256 = $topology.ea_sha256
      ea_bootstrap_pipe = [string]$slot.ea_bootstrap_pipe
      ea_profile = [string]$slot.ea_profile
      ea_gateway_origin = [string]$slot.ea_gateway_origin
      ea_profile_chart_path = $topology.ea_profile_chart_path
      ea_profile_chart_sha256 = $topology.ea_profile_chart_sha256
      ea_webrequest_settings_path = $topology.ea_webrequest_settings_path
      ea_webrequest_settings_sha256 = $topology.ea_webrequest_settings_sha256
      ea_topology_attestation_path = $topology.ea_topology_attestation_path
      ea_topology_attestation_sha256 = $topology.ea_topology_attestation_sha256
    }
  }
  $config = [ordered]@{
    gateway_url = $gatewayService.value
    credential_api_url = $credentialService.value
    bootstrap_token_file = $tokenFile
    process = [ordered]@{
      worker_id = $WorkerId
      data_root = $data
      terminal_slots = $slots
      python_path = $python.path
      adapter_path = $adapter.path
      acl_helper_path = $acl.path
      powershell_path = $powershell.path
      artifact_pins = [ordered]@{
        agent_sha256 = $agent.sha256
        python_sha256 = $python.sha256
        adapter_sha256 = $adapter.sha256
        ea_sha256 = $eaRelease.binary_sha256
        ea_version = $eaRelease.ea_version
        ea_compiler_version = $eaRelease.compiler_version
      }
      adapter_event_capacity = 16
      job_active_process_limit = $MaxProcesses
      job_process_memory_limit = $ProcessMemoryBytes
      cpu_budget_percent = $CpuBudgetPercent
      minimum_free_disk_bytes = $MinimumFreeDiskBytes
      io_timeout_ms = $StartupTimeoutMs
      graceful_stop_timeout_ms = 5000
      restart_spacing_ms = 2000
    }
    agent_version = $AgentVersion
    image_version = $ImageVersion
    runtime_version = $RuntimeVersion
    region = $Region
    probe_symbol = $ProbeSymbol
    sync_symbols = @($SyncSymbols)
    history_lookback_ms = $HistoryLookbackMs
    worker_substrate = 'bare_metal'
    allow_loopback_http = [bool]($gatewayService.loopback_http -or $credentialService.loopback_http)
  }
  if (-not $Execute) {
    return [pscustomobject][ordered]@{
      status = 'DRY_RUN'; dry_run = $true; worker_id = $WorkerId
      worker_root = $root; data_root = $data; slot_count = $slots.Count
    }
  }
  $written = Write-MT5BareMetalConfigBoundary -WorkerRoot $root -Config $config `
    -AgentSourcePath $agent.path -ExpectedAgentSha256 $agent.sha256
  $receiptPath = Assert-MT5BareMetalAbsolutePath `
    -Path (Join-Path $root 'managed-worker-installation.json') `
    -AllowMissingLeaf
  $receipt = [ordered]@{
    schema_version = 1
    worker_id = $WorkerId
    task_name = $TaskName
    worker_identity = $WorkerIdentity
    slot_count = $slots.Count
    config_path = $written.config_path
    config_sha256 = $written.config_sha256
    launcher_path = $written.launcher_path
    agent_path = $written.agent_path
    agent_sha256 = $written.agent_sha256
    powershell_path = $powershell.path
  }
  [IO.File]::WriteAllText(
    $receiptPath,
    ($receipt | ConvertTo-Json -Depth 4 -Compress),
    (New-Object Text.UTF8Encoding($false))
  )
  Protect-MT5BareMetalRootBoundary -Path $root -WorkerSid $workerSid
  Protect-MT5BareMetalRootBoundary -Path $data -WorkerSid $workerSid
  Register-MT5BareMetalTaskBoundary -TaskName $TaskName -WorkerIdentity $WorkerIdentity `
    -PowerShellPath $powershell.path -LauncherPath $written.launcher_path `
    -AgentPath $written.agent_path -ConfigPath $written.config_path `
    -ExpectedAgentSha256 $written.agent_sha256 -ExpectedConfigSha256 $written.config_sha256
  [pscustomobject][ordered]@{
    status = 'PASS'; dry_run = $false; worker_id = $WorkerId
    worker_root = $root; data_root = $data; slot_count = $slots.Count
    config_path = $written.config_path; config_sha256 = $written.config_sha256
    launcher_path = $written.launcher_path
    agent_path = $written.agent_path; agent_sha256 = $written.agent_sha256
    powershell_path = $powershell.path; worker_identity = $WorkerIdentity
    task_name = $TaskName; receipt_path = $receiptPath
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  Install-MT5BareMetalWorkerCore @PSBoundParameters | ConvertTo-Json -Depth 8
}
