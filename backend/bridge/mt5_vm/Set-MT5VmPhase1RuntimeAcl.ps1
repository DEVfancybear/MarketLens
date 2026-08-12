[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DataRoot,

  [Parameter(Mandatory = $true)]
  [string]$RuntimePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-NoReparsePoint {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$Candidate
  )

  $rootPath = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
  $current = Get-Item -LiteralPath $Candidate -Force
  while ($null -ne $current -and
         ($current.FullName.Equals($rootPath, [StringComparison]::OrdinalIgnoreCase) -or
          $current.FullName.StartsWith(
            $rootPath + [System.IO.Path]::DirectorySeparatorChar,
            [StringComparison]::OrdinalIgnoreCase
          ))) {
    if ($current.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw 'Managed runtime path cannot contain a reparse point.'
    }
    if ($current.FullName.Equals($rootPath, [StringComparison]::OrdinalIgnoreCase)) {
      return
    }
    $current = $current.Parent
  }
  throw 'Managed runtime path escaped the configured data root.'
}

function Set-RestrictedAcl {
  param([Parameter(Mandatory = $true)][string]$Path)

  $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $currentSid = $currentIdentity.User.Value
  $before = Get-Acl -LiteralPath $Path
  $beforeOwnerSid = try {
    ([Security.Principal.NTAccount]$before.Owner).Translate(
      [Security.Principal.SecurityIdentifier]
    ).Value
  } catch {
    [string]$before.Owner
  }
  if ($beforeOwnerSid -ne $currentSid) {
    throw 'Managed runtime directory must already be owned by the current user.'
  }

  $currentGrant = ('*' + $currentSid + ':(OI)(CI)F')
  $systemGrant = '*S-1-5-18:(OI)(CI)F'
  & icacls.exe $Path /inheritance:r /grant:r $currentGrant $systemGrant /Q | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to apply the managed runtime DACL.'
  }

  $verified = Get-Acl -LiteralPath $Path
  $ownerSid = try {
    ([Security.Principal.NTAccount]$verified.Owner).Translate(
      [Security.Principal.SecurityIdentifier]
    ).Value
  } catch {
    [string]$verified.Owner
  }
  if ($ownerSid -ne $currentSid -or -not $verified.AreAccessRulesProtected) {
    throw 'Managed runtime ACL owner or inheritance protection is invalid.'
  }

  $allowedSids = @($currentSid, 'S-1-5-18')
  $observedSids = @()
  foreach ($rule in $verified.Access) {
    if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) {
      continue
    }
    $sid = try {
      $rule.IdentityReference.Translate(
        [Security.Principal.SecurityIdentifier]
      ).Value
    } catch {
      throw 'Managed runtime ACL contains an unresolvable principal.'
    }
    if ($allowedSids -notcontains $sid) {
      throw 'Managed runtime ACL grants access to an unexpected principal.'
    }
    $observedSids += $sid
  }
  foreach ($requiredSid in $allowedSids) {
    if ($observedSids -notcontains $requiredSid) {
      throw 'Managed runtime ACL is missing a required principal.'
    }
  }
}

$fullDataRoot = [System.IO.Path]::GetFullPath($DataRoot).TrimEnd('\')
$fullRuntimePath = [System.IO.Path]::GetFullPath($RuntimePath).TrimEnd('\')
$accountsRoot = Join-Path $fullDataRoot 'accounts'
$accountsPrefix = $accountsRoot.TrimEnd('\') + [System.IO.Path]::DirectorySeparatorChar
if (-not $fullRuntimePath.StartsWith($accountsPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'RuntimePath must remain under DataRoot\accounts.'
}
$relativeRuntime = $fullRuntimePath.Substring($accountsPrefix.Length)
if ([string]::IsNullOrWhiteSpace($relativeRuntime) -or
    $relativeRuntime.Contains([System.IO.Path]::DirectorySeparatorChar) -or
    $relativeRuntime.Contains([System.IO.Path]::AltDirectorySeparatorChar) -or
    $relativeRuntime -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') {
  throw 'RuntimePath must identify exactly one safe account directory.'
}

New-Item -ItemType Directory -Path $fullDataRoot -Force | Out-Null
Assert-NoReparsePoint -Root $fullDataRoot -Candidate $fullDataRoot
New-Item -ItemType Directory -Path $accountsRoot -Force | Out-Null
Assert-NoReparsePoint -Root $fullDataRoot -Candidate $accountsRoot
New-Item -ItemType Directory -Path $fullRuntimePath -Force | Out-Null
Assert-NoReparsePoint -Root $fullDataRoot -Candidate $fullRuntimePath

Set-RestrictedAcl -Path $fullDataRoot
Set-RestrictedAcl -Path $accountsRoot
Set-RestrictedAcl -Path $fullRuntimePath
Assert-NoReparsePoint -Root $fullDataRoot -Candidate $fullRuntimePath

[ordered]@{
  schema_version = 1
  ok = $true
  owner_is_current_user = $true
  inheritance_disabled = $true
  allowed_principals = @('current_user', 'SYSTEM')
  reparse_free = $true
} | ConvertTo-Json -Compress
