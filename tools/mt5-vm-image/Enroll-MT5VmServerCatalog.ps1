[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$TerminalPath,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')]
  [string]$AccountAlias,
  [Parameter(Mandatory = $true)][ValidateLength(1, 128)]
  [string]$CompanySearchLabel,
  [string]$CredentialPath,
  [ValidateRange(1000, 120000)][int]$TimeoutMs = 60000
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd('\')
$credentialRoot = [System.IO.Path]::GetFullPath(
  (Join-Path $env:LOCALAPPDATA 'MarketLens')
).TrimEnd('\')
$uiHelperPath = Join-Path $repoRoot 'backend\bridge\mt5_vm\Mt5VmTerminalUi.ps1'
. $uiHelperPath

if ([string]::IsNullOrWhiteSpace($CredentialPath)) {
  $CredentialPath = Join-Path $credentialRoot "mt5-vm-phase0-$AccountAlias.dpapi.json"
}
$fullCredentialPath = [System.IO.Path]::GetFullPath($CredentialPath)
$repoPrefix = $repoRoot + [System.IO.Path]::DirectorySeparatorChar
$credentialPrefix = $credentialRoot + [System.IO.Path]::DirectorySeparatorChar
if ($fullCredentialPath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    -not $fullCredentialPath.StartsWith(
      $credentialPrefix,
      [StringComparison]::OrdinalIgnoreCase
    )) {
  throw 'CredentialPath is outside the protected current-user credential root.'
}
if (-not (Test-Path -LiteralPath $fullCredentialPath -PathType Leaf)) {
  throw 'DPAPI credential file was not found.'
}
$credentialItem = Get-Item -LiteralPath $fullCredentialPath -Force
if ($credentialItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
  throw 'CredentialPath cannot be a reparse point.'
}

$credentialAcl = Get-Acl -LiteralPath $fullCredentialPath
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$ownerSid = $credentialAcl.Owner
try {
  $ownerSid = ([Security.Principal.NTAccount]$credentialAcl.Owner).Translate(
    [Security.Principal.SecurityIdentifier]
  ).Value
} catch {
  $ownerSid = [string]$credentialAcl.Owner
}
if ($ownerSid -ne $currentSid -or -not $credentialAcl.AreAccessRulesProtected) {
  throw 'Credential file ownership or inheritance protection is invalid.'
}
$allowedSids = @($currentSid, 'S-1-5-18')
foreach ($rule in @($credentialAcl.Access)) {
  try {
    $ruleSid = $rule.IdentityReference.Translate(
      [Security.Principal.SecurityIdentifier]
    ).Value
  } catch {
    throw 'Credential ACL contains an unresolvable identity.'
  }
  if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
      $allowedSids -notcontains $ruleSid -or $rule.IsInherited) {
    throw 'Credential ACL grants access outside the current user and SYSTEM.'
  }
}

function Read-MT5VmEnrollmentCredential {
  $outer = Get-Content -LiteralPath $fullCredentialPath -Raw | ConvertFrom-Json
  if ($outer.schema_version -ne 2 -or $outer.account_alias -ne $AccountAlias -or
      [string]::IsNullOrWhiteSpace([string]$outer.encrypted_payload)) {
    throw 'DPAPI credential file is malformed or belongs to another account alias.'
  }

  $securePayload = ConvertTo-SecureString -String $outer.encrypted_payload
  $payloadPointer = [IntPtr]::Zero
  $plainPayload = $null
  try {
    $payloadPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePayload)
    $plainPayload = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($payloadPointer)
    $secret = $plainPayload | ConvertFrom-Json
    if ($secret.schema_version -ne 1) {
      throw 'The decrypted MT5 credential payload has an unsupported schema.'
    }
    return [pscustomobject]@{
      login = [string]$secret.login
      server = [string]$secret.server
      password = [string]$secret.password
    }
  } finally {
    $plainPayload = $null
    if ($payloadPointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($payloadPointer)
    }
  }
}

$result = Invoke-MT5VmServerCatalogEnrollmentCore `
  -TerminalPath ([System.IO.Path]::GetFullPath($TerminalPath)) `
  -AccountAlias $AccountAlias `
  -CompanySearchLabel $CompanySearchLabel `
  -CredentialLoader ${function:Read-MT5VmEnrollmentCredential} `
  -TimeoutMs $TimeoutMs
$result | ConvertTo-Json -Compress
