[CmdletBinding()]
param(
  [string]$BuildId,
  [string]$BaseVhdxPath,
  [string]$StagingRoot,
  [string]$PublishedRoot,
  [string]$ImageVersion,
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function New-MT5VmImageStageBoundary {
  param([string]$BuildId, [string]$StagePath, [string]$BaseVhdxPath)
  if (Test-Path -LiteralPath $StagePath) { throw 'IMAGE_STAGE_ALREADY_EXISTS' }
  New-Item -ItemType Directory -Path $StagePath | Out-Null
  $stageVhdx = Join-Path $StagePath 'worker.vhdx'
  Copy-Item -LiteralPath $BaseVhdxPath -Destination $stageVhdx
  [pscustomobject]@{ build_id = $BuildId; stage_path = $StagePath; vhdx_path = $stageVhdx }
}

function Invoke-MT5VmImageProvisionBoundary {
  throw 'IMAGE_GUEST_PROVISIONER_NOT_CONFIGURED'
}

function Test-MT5VmImageAttestationBoundary { return $false }
function Test-MT5VmImageSelfTestBoundary { return $false }

function Publish-MT5VmImageBoundary {
  param($Stage, [string]$PublishedRoot, [string]$ImageVersion)
  $target = Join-Path $PublishedRoot $ImageVersion
  if (Test-Path -LiteralPath $target) { throw 'PUBLISHED_IMAGE_ALREADY_EXISTS' }
  New-Item -ItemType Directory -Path $PublishedRoot -Force | Out-Null
  Move-Item -LiteralPath $Stage.stage_path -Destination $target
}

function Remove-MT5VmImageStageBoundary {
  param([string]$BuildId, [string]$StagePath)
  $leaf = Split-Path -Leaf ([IO.Path]::GetFullPath($StagePath).TrimEnd('\'))
  if ($leaf -ne $BuildId) { throw 'UNSAFE_IMAGE_STAGE_CLEANUP' }
  if (Test-Path -LiteralPath $StagePath) {
    Remove-Item -LiteralPath $StagePath -Recurse -Force
  }
}

function Invoke-MT5VmGoldenImageBuildCore {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')][string]$BuildId,
    [Parameter(Mandatory = $true)][string]$BaseVhdxPath,
    [Parameter(Mandatory = $true)][string]$StagingRoot,
    [Parameter(Mandatory = $true)][string]$PublishedRoot,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')][string]$ImageVersion,
    [switch]$Execute
  )

  $base = [IO.Path]::GetFullPath($BaseVhdxPath)
  $staging = [IO.Path]::GetFullPath($StagingRoot).TrimEnd('\')
  $published = [IO.Path]::GetFullPath($PublishedRoot).TrimEnd('\')
  $stagePath = Join-Path $staging $BuildId
  if ([string]::Equals($staging, $published, [StringComparison]::OrdinalIgnoreCase) -or
      $stagePath.StartsWith($published + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'UNSAFE_IMAGE_ROOTS'
  }
  if (-not $Execute) {
    return [pscustomobject][ordered]@{
      status = 'DRY_RUN'; dry_run = $true; build_id = $BuildId; stage_path = $stagePath
    }
  }

  $stage = $null
  $publishedSuccessfully = $false
  try {
    $stage = New-MT5VmImageStageBoundary `
      -BuildId $BuildId -StagePath $stagePath -BaseVhdxPath $base
    Invoke-MT5VmImageProvisionBoundary -Stage $stage -ImageVersion $ImageVersion
    if (-not (Test-MT5VmImageAttestationBoundary -Stage $stage)) {
      throw 'IMAGE_ATTESTATION_FAILED'
    }
    if (-not (Test-MT5VmImageSelfTestBoundary -Stage $stage)) {
      throw 'IMAGE_SELF_TEST_FAILED'
    }
    Publish-MT5VmImageBoundary `
      -Stage $stage -PublishedRoot $published -ImageVersion $ImageVersion
    $publishedSuccessfully = $true
    return [pscustomobject][ordered]@{
      status = 'PASS'; dry_run = $false; build_id = $BuildId; image_version = $ImageVersion
    }
  } finally {
    if (-not $publishedSuccessfully -and $null -ne $stage) {
      Remove-MT5VmImageStageBoundary -BuildId $BuildId -StagePath $stagePath
    }
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  if (@($BuildId, $BaseVhdxPath, $StagingRoot, $PublishedRoot, $ImageVersion |
        Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) {
    throw 'BuildId, BaseVhdxPath, StagingRoot, PublishedRoot, and ImageVersion are required.'
  }
  Invoke-MT5VmGoldenImageBuildCore @PSBoundParameters | ConvertTo-Json -Depth 6
}
