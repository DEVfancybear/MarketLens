# Shared V40 file transactions. This file defines functions only.
function Assert-ProvisionPath {
  param([string]$Path)
  if (-not [IO.Path]::IsPathRooted($Path)) { throw 'PROVISIONING_PATH_INVALID' }
  $cursor = [IO.Path]::GetFullPath($Path)
  while ($cursor) {
    if (Test-Path -LiteralPath $cursor) {
      $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'PROVISIONING_REPARSE_PATH'
      }
    }
    $cursor = [IO.Path]::GetDirectoryName($cursor)
  }
}

function New-ProvisionAcl {
  param([switch]$Directory)
  $acl = if ($Directory) { New-Object Security.AccessControl.DirectorySecurity } else {
    New-Object Security.AccessControl.FileSecurity
  }
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl.SetOwner($sid)
  $acl.SetGroup($sid)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($id in @($sid.Value, 'S-1-5-18', 'S-1-5-32-544') | Select-Object -Unique) {
    $identity = New-Object Security.Principal.SecurityIdentifier($id)
    $inherit = if ($Directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else {
      [Security.AccessControl.InheritanceFlags]::None
    }
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
      $identity, [Security.AccessControl.FileSystemRights]::FullControl, $inherit,
      [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)))
  }
  # Windows records auto-inheritance processing even on a protected new DACL.
  $acl.SetSecurityDescriptorSddlForm($acl.Sddl.Replace('D:P(', 'D:PAI('),
    [Security.AccessControl.AccessControlSections]'Access,Owner,Group')
  return $acl
}

function Assert-ProvisionAcl {
  param([string]$Path)
  Assert-ProvisionPath $Path
  $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
  $expected = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544') | Select-Object -Unique
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  if (-not $acl.AreAccessRulesProtected -or $rules.Count -ne $expected.Count) { throw 'PROVISIONING_PROTECTED_ACL_INVALID' }
  foreach ($id in $expected) {
    $matches = @($rules | Where-Object { $_.IdentityReference.Value -ceq $id })
    if ($matches.Count -ne 1 -or $matches[0].IsInherited -or
        $matches[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
        $matches[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
        $matches[0].PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None) {
      throw 'PROVISIONING_PROTECTED_ACL_INVALID'
    }
  }
}

function Ensure-ProvisionDirectory {
  param([string]$Path)
  Assert-ProvisionPath $Path
  if (Test-Path -LiteralPath $Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw 'PROVISIONING_PATH_INVALID' }
    Assert-ProvisionAcl $Path
    return
  }
  $parent = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $parent)) { Ensure-ProvisionDirectory $parent }
  $null = [IO.Directory]::CreateDirectory($Path, (New-ProvisionAcl -Directory))
  Assert-ProvisionAcl $Path
}

function Write-ProvisionCreateNew {
  param([string]$Path, [byte[]]$Bytes, [object]$Acl)
  Assert-ProvisionPath $Path
  $stream = $null
  try {
    $stream = New-Object IO.FileStream($Path, [IO.FileMode]::CreateNew,
      [Security.AccessControl.FileSystemRights]::FullControl, [IO.FileShare]::None,
      4096, [IO.FileOptions]::WriteThrough, $Acl)
    # Descriptor is installed by CreateNew, before any payload reaches the file.
    $actual = $stream.GetAccessControl()
    if ($actual.Sddl -cne $Acl.Sddl) {
      $descriptor = New-Object Security.AccessControl.FileSecurity
      $descriptor.SetSecurityDescriptorSddlForm($Acl.Sddl,
        [Security.AccessControl.AccessControlSections]'Access,Owner,Group')
      $stream.SetAccessControl($descriptor)
      $actual = $stream.GetAccessControl()
    }
    if ($actual.Sddl -cne $Acl.Sddl) { throw 'PROVISIONING_CREATE_ACL_CHANGED' }
    $stream.Write($Bytes, 0, $Bytes.Length)
    $stream.Flush($true)
  } finally { if ($null -ne $stream) { $stream.Dispose() } }
}

function Move-ProvisionFile {
  param([string]$Source, [string]$Target)
  Assert-ProvisionPath $Source
  Assert-ProvisionPath $Target
  if ((Split-Path -Parent $Source) -ine (Split-Path -Parent $Target)) { throw 'PROVISIONING_MOVE_PATH_INVALID' }
  if ($null -eq ('MarketLensProvisionMove' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MarketLensProvisionMove {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool MoveFileEx(string source, string target, uint flags);
}
'@
  }
  if (-not [MarketLensProvisionMove]::MoveFileEx($Source, $Target, 9)) { throw 'PROVISIONING_ATOMIC_MOVE_FAILED' }
}

function Assert-ProvisionFileState {
  param([string]$Path, [byte[]]$Bytes, [string]$Sddl)
  Assert-ProvisionPath $Path
  if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($Path)) -cne [Convert]::ToBase64String($Bytes) -or
      (Get-Acl -LiteralPath $Path).Sddl -cne $Sddl) { throw 'PROVISIONING_FILE_STATE_CHANGED' }
}

function Set-ProvisionFileBytes {
  param([string]$Path, [byte[]]$Bytes, [switch]$ReplaceExisting)
  Assert-ProvisionPath $Path
  $exists = Test-Path -LiteralPath $Path
  if ($exists -and -not $ReplaceExisting) {
    Assert-ProvisionAcl $Path
    if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($Path)) -cne [Convert]::ToBase64String($Bytes)) {
      throw 'PROVISIONING_EXISTING_FILE_CONFLICT'
    }
    return
  }
  $parent = Split-Path -Parent $Path
  if (-not $ReplaceExisting) { Ensure-ProvisionDirectory $parent }
  $acl = if ($exists) { Get-Acl -LiteralPath $Path } else { New-ProvisionAcl }
  $original = if ($exists) { [IO.File]::ReadAllBytes($Path) } else { [byte[]]@() }
  $backup = $Path + '.marketlens-v40.bak'
  if (Test-Path -LiteralPath $backup) { throw 'PROVISIONING_RECOVERY_REQUIRED' }
  $temp = Join-Path $parent ('.marketlens-v40-' + [guid]::NewGuid().ToString('N') + '.tmp')
  $published = $false
  try {
    if ($exists) { Write-ProvisionCreateNew $backup $original $acl }
    Write-ProvisionCreateNew $temp $Bytes $acl
    Assert-ProvisionFileState $temp $Bytes $acl.Sddl
    if ($exists) {
      Assert-ProvisionFileState $Path $original $acl.Sddl
      Move-ProvisionFile $temp $Path
    } else { [IO.File]::Move($temp, $Path) }
    $published = $true
    Assert-ProvisionFileState $Path $Bytes $acl.Sddl
    Register-ProvisionOwnedFile $Path
    if ($exists) { Remove-Item -LiteralPath $backup -Force -ErrorAction Stop }
  } catch {
    $failure = $_
    if ($published) {
      try {
        if ($exists) {
          Assert-ProvisionFileState $backup $original $acl.Sddl
          Move-ProvisionFile $backup $Path
          Assert-ProvisionFileState $Path $original $acl.Sddl
        } else {
          Assert-ProvisionFileState $Path $Bytes $acl.Sddl
          Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
        }
      } catch { throw 'PROVISIONING_ROLLBACK_FAILED_RECOVERY_RETAINED' }
    } elseif ($exists -and (Test-Path -LiteralPath $backup)) {
      Assert-ProvisionFileState $Path $original $acl.Sddl
      Assert-ProvisionFileState $backup $original $acl.Sddl
      Remove-Item -LiteralPath $backup -Force -ErrorAction Stop
    }
    throw $failure
  } finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force -ErrorAction Stop }
  }
}

function Set-ProvisionDotEnv {
  param([string]$Path, [hashtable]$Assignments)
  Assert-ProvisionPath $Path
  $bytes = [IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -gt 1048576) { throw 'PROVISIONING_BACKEND_ENV_INVALID' }
  $bom = $bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191
  $offset = if ($bom) { 3 } else { 0 }
  $encoding = New-Object Text.UTF8Encoding($false, $true)
  try { $text = $encoding.GetString($bytes, $offset, $bytes.Length - $offset) } catch { throw 'PROVISIONING_BACKEND_ENV_INVALID' }
  $allowed = @('EXECUTION_MT5_VM_BOOTSTRAP_TOKEN', 'EXECUTION_MT5_MANAGED_WORKER_INSTALL_INPUT_FILE', 'EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE')
  foreach ($key in @($Assignments.Keys | Sort-Object)) {
    $value = [string]$Assignments[$key]
    if ($allowed -cnotcontains $key -or $value -match '[\r\n\0#]') { throw 'PROVISIONING_BACKEND_ENV_VALUE_INVALID' }
    $pattern = '(?m)^(?<prefix>[ \t]*' + [regex]::Escape($key) + '[ \t]*=)[^\r\n]*'
    $candidates = [regex]::Matches($text, ('(?m)^[ \t]*' + [regex]::Escape($key) + '\b[^\r\n]*'))
    $matches = [regex]::Matches($text, $pattern)
    if ($matches.Count -gt 1 -or $candidates.Count -ne $matches.Count) { throw 'PROVISIONING_BACKEND_ENV_DUPLICATE' }
    if ($matches.Count -eq 1) {
      $text = [regex]::Replace($text, $pattern, [Text.RegularExpressions.MatchEvaluator]{ param($m) $m.Groups['prefix'].Value + $value })
    } else {
      $newline = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
      if ($text.Length -gt 0 -and -not $text.EndsWith("`n")) { $text += $newline }
      $text += $key + '=' + $value + $newline
    }
  }
  $payload = $encoding.GetBytes($text)
  if ($bom) { $payload = [byte[]](239,187,191) + $payload }
  Set-ProvisionFileBytes -Path $Path -Bytes $payload -ReplaceExisting
}

function Write-ProvisionBundle {
  param([System.Collections.IDictionary]$Files)
  $existing = @($Files.Keys | Where-Object { Test-Path -LiteralPath $_ })
  if ($existing.Count -ne 0 -and $existing.Count -ne $Files.Count) { throw 'PROVISIONING_PARTIAL_BUNDLE_CONFLICT' }
  foreach ($path in $Files.Keys) {
    Assert-ProvisionPath $path
    if (Test-Path -LiteralPath $path) {
      Assert-ProvisionAcl $path
      Assert-ProvisionFileState $path $Files[$path] (Get-Acl -LiteralPath $path).Sddl
    }
  }
  $created = [Collections.Generic.List[string]]::new()
  try {
    foreach ($path in $Files.Keys) {
      Set-ProvisionFileBytes -Path $path -Bytes $Files[$path]
      if ($existing -notcontains $path) { $created.Add($path) }
    }
  } catch {
    $failure = $_
    foreach ($path in $created) {
      Assert-ProvisionFileState $path $Files[$path] (New-ProvisionAcl).Sddl
      Remove-Item -LiteralPath $path -Force -ErrorAction Stop
    }
    throw $failure
  }
}

function Read-ProvisionFlatJson {
  param([string]$Path, [switch]$AllowBoolean)
  Assert-ProvisionPath $Path
  $bytes = [IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -gt 16384) { throw 'PROVISIONING_JSON_INVALID' }
  $text = (New-Object Text.UTF8Encoding($false, $true)).GetString($bytes)
  # This schema is deliberately flat: no arrays, nesting, nulls or booleans.
  $string = '"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"'
  $extra = if ($AllowBoolean) { '|true|false' } else { '' }
  $pair = '(' + $string + ')\s*:\s*(' + $string + '|[0-9]+' + $extra + ')'
  if ($text -cnotmatch ('\A\s*\{\s*(?:' + $pair + '(?:\s*,\s*' + $pair + ')*)?\s*\}\s*\z')) {
    throw 'PROVISIONING_JSON_INVALID'
  }
  $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($match in [regex]::Matches($text, $pair)) {
    $key = ConvertFrom-Json ('[' + $match.Groups[1].Value + ']')
    if (-not $names.Add([string]$key)) { throw 'PROVISIONING_JSON_DUPLICATE' }
  }
  return ($text | ConvertFrom-Json -ErrorAction Stop)
}

function Assert-ProvisionProvenance {
  param([string]$Path, [string]$TerminalPath, [string]$StateRoot, [string]$ConfigPath, [string]$SourceCommit)
  Assert-ProvisionAcl $Path
  $value = Read-ProvisionFlatJson $Path
  $fields = @('schema_version','terminal_path','terminal_sha256','state_root','native_config_sha256',
    'allowed_origin','initial_state','receipt_sha256','source_commit')
  $names = @($value.PSObject.Properties.Name)
  if ($names.Count -ne $fields.Count -or @($names | Where-Object { $fields -cnotcontains $_ }).Count -ne 0) {
    throw 'PROVISIONING_NATIVE_PROVENANCE_INVALID'
  }
  foreach ($file in @($TerminalPath,$ConfigPath)) { Assert-ProvisionPath $file }
  if ($value.schema_version -isnot [int] -or $value.schema_version -ne 1 -or
      $value.terminal_path -cne $TerminalPath -or $value.state_root -cne $StateRoot -or
      $value.terminal_sha256 -cne (Get-FileHash -LiteralPath $TerminalPath).Hash.ToLowerInvariant() -or
      $value.native_config_sha256 -cne (Get-FileHash -LiteralPath $ConfigPath).Hash.ToLowerInvariant() -or
      $value.allowed_origin -cne 'http://127.0.0.1' -or $value.initial_state -cne 'empty-disabled' -or
      $value.receipt_sha256 -cnotmatch '\A[0-9a-f]{64}\z' -or
      $value.source_commit -cnotmatch '\A[0-9a-f]{40}\z' -or $value.source_commit -cne $SourceCommit) {
    throw 'PROVISIONING_NATIVE_PROVENANCE_INVALID'
  }
}

function Assert-ProvisionHistoricalReceipt {
  param([string]$Directory, [string]$Hash)
  Assert-ProvisionPath $Directory
  if ($Hash -cnotmatch '\A[0-9a-f]{64}\z') { throw 'PROVISIONING_NATIVE_RECEIPT_INVALID' }
  $matches = @(Get-ChildItem -LiteralPath $Directory -Filter 'webrequest-probe-*.json' -File -ErrorAction Stop |
    Where-Object { $_.Name -cmatch '^webrequest-probe-[0-9a-f]{32}\.json$' -and
      $_.Length -le 16384 -and (Get-FileHash -LiteralPath $_.FullName).Hash.ToLowerInvariant() -ceq $Hash })
  if ($matches.Count -ne 1) { throw 'PROVISIONING_NATIVE_RECEIPT_MISSING' }
  $receipt = Read-ProvisionFlatJson -Path $matches[0].FullName -AllowBoolean
  $fields = @('schemaVersion','nonce','url','httpStatus','mt5Error','terminalBuild','requestedAtUnix',
    'observedAtUnix','responseOk','responseService','responseProtocol','probeSucceeded')
  $names = @($receipt.PSObject.Properties.Name)
  if ($names.Count -ne $fields.Count -or @($names | Where-Object { $fields -cnotcontains $_ }).Count -gt 0 -or
      $receipt.schemaVersion -ne 1 -or $receipt.nonce -cne $matches[0].BaseName.Substring('webrequest-probe-'.Length) -or
      $receipt.url -cne 'http://127.0.0.1/health' -or $receipt.httpStatus -ne 200 -or $receipt.mt5Error -ne 0 -or
      $receipt.terminalBuild -le 0 -or $receipt.observedAtUnix -lt $receipt.requestedAtUnix) {
    throw 'PROVISIONING_NATIVE_RECEIPT_INVALID'
  }
  foreach ($field in @('responseOk','responseService','responseProtocol','probeSucceeded')) {
    if ($receipt.$field -isnot [bool] -or -not $receipt.$field) { throw 'PROVISIONING_NATIVE_RECEIPT_INVALID' }
  }
}

function Assert-ProvisionProofPair {
  param([object]$First, [object]$Second, [long]$Now = ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()))
  foreach ($proof in @($First,$Second)) {
    if ($proof.status -cne 'PASS' -or $proof.probe_url -cne 'http://127.0.0.1/health' -or
        $proof.requested_at_unix -lt ($Now - 180) -or $proof.requested_at_unix -gt ($Now + 5) -or
        $proof.observed_at_unix -lt $proof.requested_at_unix -or $proof.observed_at_unix -gt ($Now + 5)) {
      throw 'PROVISIONING_PROOF_PAIR_INVALID'
    }
    foreach ($field in @('terminal_sha256','native_config_sha256','nonce_sha256','receipt_sha256')) {
      if ($proof.$field -cnotmatch '\A[0-9a-f]{64}\z') { throw 'PROVISIONING_PROOF_PAIR_INVALID' }
    }
  }
  if ($First.terminal_path -cne $Second.terminal_path -or $First.terminal_sha256 -cne $Second.terminal_sha256 -or
      $First.native_config_sha256 -cne $Second.native_config_sha256 -or
      $First.nonce_sha256 -ceq $Second.nonce_sha256 -or $First.receipt_sha256 -ceq $Second.receipt_sha256 -or
      $Second.requested_at_unix -lt $First.requested_at_unix) { throw 'PROVISIONING_PROOF_PAIR_INVALID' }
}

function Invoke-ProvisionHostFlow {
  param([hashtable]$Actions)
  $handoff = $false
  try {
    foreach ($stage in @('Preflight','Proofs','Prepare','DryRun','Audit','Runner','Postconditions')) {
      if (-not $Actions.ContainsKey($stage)) { throw 'PROVISIONING_FLOW_STAGE_MISSING' }
      if ($stage -ceq 'Runner') { $handoff = $true }
      & $Actions[$stage]
    }
    & $Actions.Complete
  } catch {
    $failure = $_
    if (-not $handoff) { & $Actions.Rollback }
    throw $failure
  }
}

function Assert-ProvisionInstallerPlan {
  param([object]$Plan)
  if ($Plan.installed -isnot [bool] -or $Plan.installed -or
      $Plan.status -cnotin @('DRY_RUN','ADOPTED') -or
      ($Plan.status -ceq 'ADOPTED' -and -not [IO.Path]::IsPathRooted([string]$Plan.receipt_path))) {
    throw 'PROVISIONING_MANAGED_WORKER_DRY_RUN_INVALID'
  }
}

function New-ProvisionJournal {
  param([string[]]$Paths, [string]$Directory)
  Ensure-ProvisionDirectory $Directory
  $records = [Collections.Generic.List[object]]::new()
  foreach ($path in $Paths) {
    Assert-ProvisionPath $path
    $exists = Test-Path -LiteralPath $path
    $backup = Join-Path $Directory ([guid]::NewGuid().ToString('N') + '.bak')
    $sddl = ''
    $originalAcl = $null
    if ($exists) {
      $originalAcl = Get-Acl -LiteralPath $path
      $sddl = $originalAcl.Sddl
      Write-ProvisionCreateNew $backup ([IO.File]::ReadAllBytes($path)) (New-ProvisionAcl)
    }
    $backupHash = if ($exists) { (Get-FileHash -LiteralPath $backup).Hash } else { '' }
    $records.Add([pscustomobject]@{path=$path;existed=$exists;backup=$backup;backup_hash=$backupHash;sddl=$sddl;acl=$originalAcl;owned=$false;owned_hash='';owned_sddl=''})
  }
  $manifest = Join-Path $Directory 'journal.json'
  Write-ProvisionCreateNew $manifest ([Text.Encoding]::UTF8.GetBytes(($records | Select-Object path,existed,backup,backup_hash,sddl,owned,owned_hash,owned_sddl | ConvertTo-Json -Depth 4))) (New-ProvisionAcl)
  return [pscustomobject]@{records=$records;manifest=$manifest}
}

function Complete-ProvisionJournal {
  param([object]$Journal)
  foreach ($record in $Journal.records) {
    if ($record.existed) { Remove-Item -LiteralPath $record.backup -Force -ErrorAction Stop }
  }
  Remove-Item -LiteralPath $Journal.manifest -Force -ErrorAction Stop
  $script:ProvisionJournal = $null
}

function Restore-ProvisionJournal {
  param([object]$Journal)
  foreach ($record in $Journal.records) {
    if (-not $record.owned) { continue }
    Assert-ProvisionPath $record.path
    if ((Get-FileHash -LiteralPath $record.path).Hash -cne $record.owned_hash -or
        (Get-Acl -LiteralPath $record.path).Sddl -cne $record.owned_sddl) { throw 'PROVISIONING_RECOVERY_STATE_CHANGED' }
    if ($record.existed) {
      $acl = $record.acl
      Assert-ProvisionAcl $record.backup
      if ((Get-FileHash -LiteralPath $record.backup).Hash -cne $record.backup_hash) { throw 'PROVISIONING_RECOVERY_STATE_CHANGED' }
      $bytes = [IO.File]::ReadAllBytes($record.backup)
      $temp = $record.path + '.marketlens-v40-restore.tmp'
      Write-ProvisionCreateNew $temp $bytes $acl
      Move-ProvisionFile $temp $record.path
      Assert-ProvisionFileState $record.path $bytes $record.sddl
    } elseif (Test-Path -LiteralPath $record.path) {
      Assert-ProvisionAcl $record.path
      Remove-Item -LiteralPath $record.path -Force -ErrorAction Stop
    }
  }
  Complete-ProvisionJournal $Journal
}

function Register-ProvisionOwnedFile {
  param([string]$Path)
  $journalVariable = Get-Variable -Name ProvisionJournal -Scope Script -ErrorAction SilentlyContinue
  if ($null -eq $journalVariable -or $null -eq $journalVariable.Value) { return }
  foreach ($record in $journalVariable.Value.records) {
    if ($record.path -ieq $Path) {
      $record.owned = $true
      $record.owned_hash = (Get-FileHash -LiteralPath $Path).Hash
      $record.owned_sddl = (Get-Acl -LiteralPath $Path).Sddl
      $journal = $journalVariable.Value
      $metadata = $journal.records | Select-Object path,existed,backup,backup_hash,sddl,owned,owned_hash,owned_sddl | ConvertTo-Json -Depth 4
      Set-ProvisionFileBytes $journal.manifest ([Text.Encoding]::UTF8.GetBytes($metadata)) -ReplaceExisting
    }
  }
}
