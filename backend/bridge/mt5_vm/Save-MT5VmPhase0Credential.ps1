[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')]
  [string]$AccountAlias,

  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 9223372036854775807)]
  [long]$Login,

  [Parameter(Mandatory = $true)]
  [ValidateLength(1, 128)]
  [string]$Server,

  [string]$CredentialPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath(
  (Join-Path $PSScriptRoot '..\..\..')
).TrimEnd('\')
$credentialRoot = [System.IO.Path]::GetFullPath(
  (Join-Path $env:LOCALAPPDATA 'MarketLens')
).TrimEnd('\')

if ([string]::IsNullOrWhiteSpace($CredentialPath)) {
  $CredentialPath = Join-Path $credentialRoot "mt5-vm-phase0-$AccountAlias.dpapi.json"
}

$fullCredentialPath = [System.IO.Path]::GetFullPath($CredentialPath)
$repoPrefix = $repoRoot + [System.IO.Path]::DirectorySeparatorChar
if ($fullCredentialPath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'CredentialPath must be outside the repository.'
}
$credentialPrefix = $credentialRoot + [System.IO.Path]::DirectorySeparatorChar
if (-not $fullCredentialPath.StartsWith($credentialPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'CredentialPath must remain under the current user LocalAppData\MarketLens directory.'
}

$credentialDirectory = Split-Path -Parent $fullCredentialPath
if ([string]::IsNullOrWhiteSpace($credentialDirectory)) {
  throw 'CredentialPath must include a parent directory.'
}
New-Item -ItemType Directory -Path $credentialDirectory -Force | Out-Null
$directoryInfo = Get-Item -LiteralPath $credentialDirectory -Force
while ($null -ne $directoryInfo -and
       $directoryInfo.FullName.StartsWith($credentialRoot, [StringComparison]::OrdinalIgnoreCase)) {
  if ($directoryInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'CredentialPath cannot traverse a reparse point.'
  }
  if ($directoryInfo.FullName.Equals($credentialRoot, [StringComparison]::OrdinalIgnoreCase)) {
    break
  }
  $directoryInfo = $directoryInfo.Parent
}

$serverValue = $Server.Trim()
if ([string]::IsNullOrWhiteSpace($serverValue) -or $serverValue -match '[\x00-\x1F\x7F]') {
  throw 'Server must be a non-empty value without control characters.'
}

$securePassword = Read-Host 'Enter the disposable MT5 demo master password' -AsSecureString
if ($securePassword.Length -lt 1) {
  throw 'The MT5 password cannot be empty.'
}

$passwordPointer = [IntPtr]::Zero
$plainPassword = $null
$plainPayload = $null
$secretPayload = $null
$payloadSecure = $null
$encryptedPayload = $null
try {
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $secretPayload = [ordered]@{
    schema_version = 1
    login = [string]$Login
    server = $serverValue
    password = $plainPassword
  }
  $plainPayload = $secretPayload | ConvertTo-Json -Compress
  $payloadSecure = ConvertTo-SecureString -String $plainPayload -AsPlainText -Force
  $encryptedPayload = ConvertFrom-SecureString -SecureString $payloadSecure
  if ([string]::IsNullOrWhiteSpace($encryptedPayload)) {
    throw 'DPAPI encryption returned an empty value.'
  }
} finally {
  $plainPassword = $null
  $plainPayload = $null
  if ($null -ne $secretPayload) { $secretPayload.password = $null }
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
}

$payload = [ordered]@{
  schema_version      = 2
  account_alias       = $AccountAlias
  encrypted_payload   = $encryptedPayload
  protection          = 'windows-dpapi-current-user'
  created_at          = (Get-Date).ToUniversalTime().ToString('o')
}

$json = $payload | ConvertTo-Json -Depth 4
Set-Content -LiteralPath $fullCredentialPath -Value $json -Encoding UTF8

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$systemSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$acl = New-Object Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true, $false)
$acl.SetOwner($currentIdentity.User)
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
  $currentIdentity.User,
  [Security.AccessControl.FileSystemRights]::FullControl,
  [Security.AccessControl.AccessControlType]::Allow
)))
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
  $systemSid,
  [Security.AccessControl.FileSystemRights]::FullControl,
  [Security.AccessControl.AccessControlType]::Allow
)))
Set-Acl -LiteralPath $fullCredentialPath -AclObject $acl

Write-Host 'Saved DPAPI-protected disposable demo credential.' -ForegroundColor Green
Write-Host "Path: $fullCredentialPath"
Write-Host 'Login, server, and password were not written in plaintext.'
