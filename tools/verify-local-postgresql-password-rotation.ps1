<#
.SYNOPSIS
  Fail-closed verifier for the approved local PostgreSQL password rotation.

.DESCRIPTION
  Verifies the exact PostgreSQL 17 cluster, SCRAM authentication, removal of
  the temporary IPv4 trust rule, approved database inventory, and secret
  non-disclosure. It is intentionally read-only: it never changes a role,
  database, HBA file, service, or repository configuration.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendEnv = Join-Path $repoRoot "backend\.env"
$specPath = Join-Path $repoRoot "docs\agent-evidence\local-postgresql-password-rotation\SPEC.md"
$evidenceDir = Split-Path -Parent $specPath
$psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
$pgIsReady = "C:\Program Files\PostgreSQL\17\bin\pg_isready.exe"
$hbaPath = "C:\Program Files\PostgreSQL\17\data\pg_hba.conf"
$hbaBackupPath = "C:\Program Files\PostgreSQL\17\data\pg_hba.conf.bak"
$postgresLogDir = "C:\Program Files\PostgreSQL\17\data\log"
$runtimeLogDir = Join-Path $repoRoot ".runtime-logs"
$expectedSpecSha256 = "F67E334416FB815EC52AD781DB5278F819AA8E2CB305024F7B974587CD138955"
$expectedBackendEnvSha256 = "F27F9E0A0BE721808019E8449ED9B28D2AA05AA5DE8DD076006B99C6816880DF"
$expectedHbaBackupSha256 = "EF22BB9557EB84F3DBEDBB3219120EE95028FC7ADA5F1D2FCC16D7F05D41EABF"
$script:targetSecret = $null
$script:results = New-Object System.Collections.Generic.List[object]

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)

    if (-not (Test-Path -LiteralPath $LiteralPath -PathType Leaf)) {
        throw "Required file is missing: $LiteralPath"
    }
    return (Get-FileHash -LiteralPath $LiteralPath -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Protect-Text {
    param([AllowNull()][string]$Text)

    if ($null -eq $Text) { return "" }
    $safe = $Text
    if (-not [string]::IsNullOrEmpty($script:targetSecret)) {
        $safe = $safe.Replace($script:targetSecret, "[REDACTED]")
    }
    $safe = $safe -replace '(?i)(postgres(?:ql)?://)[^@\s]+@', '$1[REDACTED]@'
    $safe = $safe -replace 'SCRAM-SHA-256\$[^\s''"]+', '[REDACTED_VERIFIER]'
    return $safe.Trim()
}

function Assert-Condition {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )

    if (-not $Condition) { throw $Message }
}

function Assert-Throws {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )

    $threw = $false
    try {
        $null = & $Action
    } catch {
        $threw = $true
    }
    if (-not $threw) { throw "Negative control did not fail: $Label" }
    return "$Label rejected"
}

function Get-TargetDatabaseCredentialFromText {
    param([Parameter(Mandatory = $true)][string]$EnvText)

    $matches = [regex]::Matches($EnvText, '(?m)^\s*DATABASE_URL\s*=\s*(.+?)\s*$')
    if ($matches.Count -ne 1) {
        throw "backend/.env must contain exactly one non-empty DATABASE_URL"
    }

    $raw = $matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")
    try {
        $uri = New-Object System.Uri($raw)
    } catch {
        throw "DATABASE_URL is malformed (value redacted)"
    }

    if ($uri.Scheme -notin @("postgres", "postgresql")) {
        throw "DATABASE_URL scheme is not postgres/postgresql"
    }
    if ($uri.Host -ne "127.0.0.1" -or $uri.Port -ne 5432 -or $uri.AbsolutePath.TrimStart('/') -ne "smc") {
        throw "DATABASE_URL endpoint does not match the approved 127.0.0.1:5432/smc source"
    }

    $separator = $uri.UserInfo.IndexOf(':')
    if ($separator -lt 1 -or $separator -eq ($uri.UserInfo.Length - 1)) {
        throw "DATABASE_URL must contain a role and password"
    }
    $role = [Uri]::UnescapeDataString($uri.UserInfo.Substring(0, $separator))
    $password = [Uri]::UnescapeDataString($uri.UserInfo.Substring($separator + 1))
    if ($role -cne "postgres") { throw "DATABASE_URL role is not the approved postgres role" }
    if ($password -cnotmatch '^[A-Za-z0-9]{32}$') {
        throw "DATABASE_URL password does not match the approved 32-character secret contract"
    }

    return [pscustomobject]@{
        Role = $role
        Password = $password
    }
}

function Read-HbaText {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)

    if (-not (Test-Path -LiteralPath $LiteralPath -PathType Leaf)) {
        throw "HBA input is missing or unreadable: $LiteralPath"
    }
    return [IO.File]::ReadAllText($LiteralPath)
}

function Read-SharedText {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)

    if (-not (Test-Path -LiteralPath $LiteralPath -PathType Leaf)) {
        throw "Secret-scan input is missing or unreadable: $LiteralPath"
    }
    $share = [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
    $stream = New-Object System.IO.FileStream(
        $LiteralPath,
        [IO.FileMode]::Open,
        [IO.FileAccess]::Read,
        $share
    )
    try {
        $reader = New-Object System.IO.StreamReader($stream, $true)
        try {
            return $reader.ReadToEnd()
        } finally {
            $reader.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

function Assert-HbaTextSecure {
    param([Parameter(Mandatory = $true)][string]$Text)

    $rules = New-Object System.Collections.Generic.List[object]
    foreach ($line in ($Text -split "`r?`n")) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $parts = @($trimmed -split '\s+')
        if ($parts.Count -lt 4) { throw "Unparseable active HBA rule" }
        $type = $parts[0]
        $methodIndex = if ($type -eq "local") { 3 } else { 4 }
        if ($parts.Count -le $methodIndex) { throw "Unparseable active HBA rule" }
        $rules.Add([pscustomobject]@{
            Type = $type
            Database = $parts[1]
            User = $parts[2]
            Address = if ($type -eq "local") { "" } else { $parts[3] }
            Method = $parts[$methodIndex]
        }) | Out-Null
    }

    if ($rules.Count -lt 6) { throw "Too few active HBA rules" }
    if (@($rules | Where-Object { $_.Method -eq "trust" }).Count -ne 0) {
        throw "An active HBA trust rule remains"
    }
    foreach ($address in @("127.0.0.1/32", "::1/128")) {
        $match = @($rules | Where-Object {
            $_.Type -eq "host" -and $_.Database -eq "all" -and $_.User -eq "all" -and
            $_.Address -eq $address -and $_.Method -eq "scram-sha-256"
        })
        if ($match.Count -ne 1) { throw "Missing exact SCRAM loopback HBA rule for $address" }
    }
    return "$($rules.Count) active rules; trust=0; loopback SCRAM present"
}

function Assert-NoSecretInContentMap {
    param(
        [Parameter(Mandatory = $true)][hashtable]$ContentByName,
        [Parameter(Mandatory = $true)][string]$Secret
    )

    foreach ($name in $ContentByName.Keys) {
        if ($ContentByName[$name].Contains($Secret)) {
            throw "Target secret found in task artifact: $name"
        }
    }
    return "$($ContentByName.Count) artifact(s) clean"
}

function Invoke-Psql {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("127.0.0.1", "::1")][string]$HostName,
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port,
        [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z_][A-Za-z0-9_]{0,62}$')][string]$Role,
        [AllowNull()][string]$Password,
        [Parameter(Mandatory = $true)][string]$Sql,
        [int]$TimeoutMilliseconds = 10000
    )

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $psql
    $psi.Arguments = "-X -w -v ON_ERROR_STOP=1 -h $HostName -p $Port -U $Role -d postgres -At -F `"|`""
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables.Remove("PGPASSWORD")
    $psi.EnvironmentVariables["PGCONNECT_TIMEOUT"] = "3"
    if ($null -ne $Password) {
        $psi.EnvironmentVariables["PGPASSWORD"] = $Password
    }

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    if (-not $process.Start()) { throw "Failed to start psql" }
    $process.StandardInput.WriteLine($Sql)
    $process.StandardInput.Close()
    if (-not $process.WaitForExit($TimeoutMilliseconds)) {
        $process.Kill()
        $process.WaitForExit()
        throw "psql timed out after $TimeoutMilliseconds ms"
    }

    return [pscustomobject]@{
        ExitCode = $process.ExitCode
        Stdout = $process.StandardOutput.ReadToEnd()
        Stderr = $process.StandardError.ReadToEnd()
    }
}

function Assert-PsqlSuccess {
    param(
        [Parameter(Mandatory = $true)][string]$HostName,
        [Parameter(Mandatory = $true)][string]$ExpectedOutput
    )

    $result = Invoke-Psql -HostName $HostName -Port 5432 -Role "postgres" `
        -Password $script:targetSecret `
        -Sql "SELECT current_user, current_setting('port'), pg_is_in_recovery();"
    if ($result.ExitCode -ne 0) {
        throw "SCRAM authentication failed on ${HostName}: $(Protect-Text $result.Stderr)"
    }
    $actual = $result.Stdout.Trim()
    if ($actual -cne $ExpectedOutput) {
        throw "Unexpected authenticated probe output on ${HostName}: $(Protect-Text $actual)"
    }
    return "$HostName authenticated as postgres with SCRAM"
}

function Invoke-Check {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )

    try {
        $detail = & $Action
        $script:results.Add([pscustomobject]@{
            Status = "PASS"
            Name = $Name
            Detail = (Protect-Text (($detail | ForEach-Object { "$_" }) -join "; "))
        }) | Out-Null
    } catch {
        $script:results.Add([pscustomobject]@{
            Status = "FAIL"
            Name = $Name
            Detail = (Protect-Text $_.Exception.Message)
        }) | Out-Null
    }
}

foreach ($requiredPath in @($backendEnv, $specPath, $psql, $pgIsReady, $hbaPath, $hbaBackupPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required verifier input is missing: $requiredPath"
    }
}

$credential = Get-TargetDatabaseCredentialFromText -EnvText ([IO.File]::ReadAllText($backendEnv))
$script:targetSecret = $credential.Password

Invoke-Check -Name "PowerShell syntax" -Action {
    $tokens = $null
    $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($PSCommandPath, [ref]$tokens, [ref]$errors)
    if ($errors.Count -ne 0) { throw "Verifier has $($errors.Count) parser error(s)" }
    "0 parser errors"
}

Invoke-Check -Name "Approved SPEC hash" -Action {
    $actual = Get-Sha256 -LiteralPath $specPath
    Assert-Condition ($actual -ceq $expectedSpecSha256) "Approved SPEC changed after approval"
    "sha256=$actual"
}

Invoke-Check -Name "backend/.env invariant" -Action {
    $actual = Get-Sha256 -LiteralPath $backendEnv
    Assert-Condition ($actual -ceq $expectedBackendEnvSha256) "backend/.env changed from the approved baseline"
    "sha256=$actual; approved credential shape present"
}

Invoke-Check -Name "backend/.env Git boundary" -Action {
    $tracked = @(& git -C $repoRoot ls-files -- "backend/.env")
    if ($LASTEXITCODE -ne 0) { throw "git ls-files failed for backend/.env" }
    Assert-Condition ($tracked.Count -eq 0) "backend/.env is tracked by Git"
    $ignoreRule = @(& git -C $repoRoot check-ignore -v -- "backend/.env")
    if ($LASTEXITCODE -ne 0) { throw "backend/.env is not ignored by Git" }
    Assert-Condition ($ignoreRule.Count -eq 1) "backend/.env ignore resolution is ambiguous"
    "untracked; ignored by one repository rule"
}

Invoke-Check -Name "HBA checker negative controls" -Action {
    $badTrust = "host all postgres 127.0.0.1/32 trust`n" +
        "local all all scram-sha-256`n" +
        "host all all 127.0.0.1/32 scram-sha-256`n" +
        "host all all ::1/128 scram-sha-256`n" +
        "local replication all scram-sha-256`n" +
        "host replication all 127.0.0.1/32 scram-sha-256`n" +
        "host replication all ::1/128 scram-sha-256"
    $badMd5 = $badTrust.Replace("trust", "scram-sha-256").Replace(
        "host all all 127.0.0.1/32 scram-sha-256", "host all all 127.0.0.1/32 md5")
    $one = Assert-Throws -Label "trust fixture" -Action { Assert-HbaTextSecure -Text $badTrust }
    $two = Assert-Throws -Label "md5 fixture" -Action { Assert-HbaTextSecure -Text $badMd5 }
    $missing = Join-Path $env:TEMP "codex-missing-hba-negative-control.conf"
    $three = Assert-Throws -Label "missing HBA input" -Action { Read-HbaText -LiteralPath $missing }
    "$one; $two; $three"
}

Invoke-Check -Name "DATABASE_URL parser negative controls" -Action {
    $wrongEndpoint = "DATABASE_URL=postgres://postgres:Abcdefghijklmnopqrstuvwx12345678@127.0.0.1:55432/smc"
    $wrongRole = "DATABASE_URL=postgres://app_role:Abcdefghijklmnopqrstuvwx12345678@127.0.0.1:5432/smc"
    $one = Assert-Throws -Label "wrong endpoint" -Action { Get-TargetDatabaseCredentialFromText -EnvText $wrongEndpoint }
    $two = Assert-Throws -Label "wrong role" -Action { Get-TargetDatabaseCredentialFromText -EnvText $wrongRole }
    "$one; $two"
}

Invoke-Check -Name "Secret-scan negative control" -Action {
    $bad = @{ "in-memory-known-bad-fixture" = "prefix-$($script:targetSecret)-suffix" }
    $one = Assert-Throws -Label "injected target secret" -Action {
        Assert-NoSecretInContentMap -ContentByName $bad -Secret $script:targetSecret
    }
    $good = @{ "in-memory-clean-fixture" = "prefix-[REDACTED]-suffix" }
    $two = Assert-NoSecretInContentMap -ContentByName $good -Secret $script:targetSecret
    "$one; clean fixture accepted ($two)"
}

Invoke-Check -Name "PostgreSQL Windows service" -Action {
    $service = Get-CimInstance Win32_Service -Filter "Name='postgresql-x64-17'"
    if ($null -eq $service) { throw "postgresql-x64-17 service is missing" }
    Assert-Condition ($service.State -ceq "Running") "postgresql-x64-17 service is not Running"
    Assert-Condition ($service.StartMode -ceq "Auto") "postgresql-x64-17 service is not automatic"
    Assert-Condition ($service.StartName -ceq "NT AUTHORITY\NetworkService") "PostgreSQL service identity changed"
    Assert-Condition ($service.PathName -like '*C:\Program Files\PostgreSQL\17\data*') "PostgreSQL service data path changed"
    "Running; Auto; NetworkService; approved data path"
}

Invoke-Check -Name "HBA backup identity" -Action {
    $actual = Get-Sha256 -LiteralPath $hbaBackupPath
    Assert-Condition ($actual -ceq $expectedHbaBackupSha256) "Approved HBA backup hash changed"
    "sha256=$actual"
}

Invoke-Check -Name "Final HBA file and static rules" -Action {
    $current = Get-Sha256 -LiteralPath $hbaPath
    $backup = Get-Sha256 -LiteralPath $hbaBackupPath
    Assert-Condition ($current -ceq $backup) "pg_hba.conf does not equal the approved backup"
    $detail = Assert-HbaTextSecure -Text (Read-HbaText -LiteralPath $hbaPath)
    "sha256=$current; $detail"
}

Invoke-Check -Name "IPv6 SCRAM authentication" -Action {
    Assert-PsqlSuccess -HostName "::1" -ExpectedOutput "postgres|5432|f"
}

Invoke-Check -Name "IPv4 SCRAM authentication" -Action {
    Assert-PsqlSuccess -HostName "127.0.0.1" -ExpectedOutput "postgres|5432|f"
}

Invoke-Check -Name "Wrong-password rejection" -Action {
    $wrong = "KnownWrongPasswordForNegativeControl42"
    Assert-Condition ($wrong -cne $script:targetSecret) "Wrong-password fixture unexpectedly equals target"
    $result = Invoke-Psql -HostName "127.0.0.1" -Port 5432 -Role "postgres" -Password $wrong -Sql "SELECT 1;"
    Assert-Condition ($result.ExitCode -ne 0) "Known-wrong password unexpectedly authenticated"
    Assert-Condition ($result.Stderr -match 'password authentication failed') "Wrong-password failure was not an authentication rejection"
    "known-wrong password rejected (exit=$($result.ExitCode))"
}

Invoke-Check -Name "Absent-password rejection" -Action {
    $result = Invoke-Psql -HostName "127.0.0.1" -Port 5432 -Role "postgres" -Password $null -Sql "SELECT 1;"
    Assert-Condition ($result.ExitCode -ne 0) "Passwordless connection unexpectedly authenticated"
    Assert-Condition ($result.Stderr -match 'no password supplied') "Passwordless failure was not the expected non-interactive rejection"
    "passwordless -w connection rejected (exit=$($result.ExitCode))"
}

Invoke-Check -Name "Server and role identity" -Action {
    $sql = "SELECT current_setting('server_version_num'), current_user, current_setting('port'), current_setting('data_directory'), current_setting('hba_file'), pg_is_in_recovery(); SELECT rolcanlogin, rolsuper, (rolpassword IS NOT NULL), COALESCE(rolpassword LIKE 'SCRAM-SHA-256$%', false) FROM pg_authid WHERE rolname='postgres';"
    $result = Invoke-Psql -HostName "127.0.0.1" -Port 5432 -Role "postgres" -Password $script:targetSecret -Sql $sql
    if ($result.ExitCode -ne 0) { throw "Server identity query failed: $(Protect-Text $result.Stderr)" }
    $lines = @($result.Stdout.Trim() -split "`r?`n")
    Assert-Condition ($lines.Count -eq 2) "Server identity query returned an unexpected line count"
    $identity = @($lines[0] -split '\|')
    Assert-Condition ($identity.Count -eq 6) "Server identity tuple is malformed"
    Assert-Condition ($identity[0] -match '^17\d+$') "Server major version is not PostgreSQL 17"
    Assert-Condition ($identity[1] -ceq "postgres" -and $identity[2] -ceq "5432") "Wrong role or port"
    Assert-Condition ($identity[3] -ceq "C:/Program Files/PostgreSQL/17/data") "Wrong data directory"
    Assert-Condition ($identity[4] -ceq "C:/Program Files/PostgreSQL/17/data/pg_hba.conf") "Wrong HBA path"
    Assert-Condition ($identity[5] -ceq "f") "Server unexpectedly reports recovery mode"
    Assert-Condition ($lines[1] -ceq "t|t|t|t") "postgres role is not login+superuser+password+SCRAM"
    "PostgreSQL $($identity[0]); postgres login/superuser; SCRAM verifier present; primary"
}

Invoke-Check -Name "Live HBA catalog" -Action {
    $sql = "SELECT count(*) FILTER (WHERE auth_method='trust'), count(*) FILTER (WHERE error IS NOT NULL), count(*) FILTER (WHERE type='host' AND address IN ('127.0.0.1','::1') AND auth_method='scram-sha-256') FROM pg_hba_file_rules;"
    $result = Invoke-Psql -HostName "127.0.0.1" -Port 5432 -Role "postgres" -Password $script:targetSecret -Sql $sql
    if ($result.ExitCode -ne 0) { throw "Live HBA query failed: $(Protect-Text $result.Stderr)" }
    $fields = @($result.Stdout.Trim() -split '\|')
    Assert-Condition ($fields.Count -eq 3) "Live HBA tuple is malformed"
    Assert-Condition ($fields[0] -ceq "0") "Live HBA still contains trust authentication"
    Assert-Condition ($fields[1] -ceq "0") "Live HBA contains parse errors"
    Assert-Condition ([int]$fields[2] -ge 2) "Live HBA lacks loopback SCRAM rules"
    "trust=0; parse_errors=0; loopback_scram=$($fields[2])"
}

Invoke-Check -Name "Database inventory invariant" -Action {
    $result = Invoke-Psql -HostName "127.0.0.1" -Port 5432 -Role "postgres" -Password $script:targetSecret `
        -Sql "SELECT datname FROM pg_database WHERE datallowconn ORDER BY datname;"
    if ($result.ExitCode -ne 0) { throw "Database inventory query failed: $(Protect-Text $result.Stderr)" }
    $inventory = @($result.Stdout.Trim() -split "`r?`n")
    Assert-Condition ($inventory.Count -eq 3) "Connectable database count is not three"
    Assert-Condition ($inventory[0] -ceq "postgres" -and $inventory[1] -ceq "smc" -and $inventory[2] -ceq "template1") "Database inventory is not the approved final state"
    "postgres, smc, template1 (approved final inventory)"
}

Invoke-Check -Name "PostgreSQL readiness" -Action {
    $output = & $pgIsReady -h 127.0.0.1 -p 5432 -d postgres 2>&1
    $exitCode = $LASTEXITCODE
    Assert-Condition ($exitCode -eq 0) "pg_isready failed with exit $exitCode"
    Assert-Condition (("$output") -match 'accepting connections') "pg_isready did not report accepting connections"
    "127.0.0.1:5432 accepting connections"
}

Invoke-Check -Name "Adversarial wrong endpoint and role" -Action {
    $wrongPort = Invoke-Psql -HostName "127.0.0.1" -Port 55432 -Role "postgres" -Password $script:targetSecret -Sql "SELECT 1;"
    Assert-Condition ($wrongPort.ExitCode -ne 0) "Unapproved port 55432 unexpectedly accepted a connection"
    $wrongRole = Invoke-Psql -HostName "127.0.0.1" -Port 5432 -Role "codex_nonexistent_rotation_probe" -Password $script:targetSecret -Sql "SELECT 1;"
    Assert-Condition ($wrongRole.ExitCode -ne 0) "Unapproved role unexpectedly authenticated"
    "port 55432 rejected; unapproved role rejected"
}

Invoke-Check -Name "Task-artifact secret scan" -Action {
    $content = @{}
    $content[$PSCommandPath] = [IO.File]::ReadAllText($PSCommandPath)
    foreach ($file in @(Get-ChildItem -LiteralPath $evidenceDir -File -ErrorAction Stop)) {
        $content[$file.FullName] = [IO.File]::ReadAllText($file.FullName)
    }
    Assert-NoSecretInContentMap -ContentByName $content -Secret $script:targetSecret
}

Invoke-Check -Name "Extended secret-surface scan" -Action {
    if (-not (Test-Path -LiteralPath $postgresLogDir -PathType Container)) {
        throw "PostgreSQL log directory is missing"
    }
    $paths = New-Object System.Collections.Generic.HashSet[string]([StringComparer]::OrdinalIgnoreCase)
    $null = $paths.Add($PSCommandPath)
    foreach ($file in @(Get-ChildItem -LiteralPath $evidenceDir -File -ErrorAction Stop)) {
        $null = $paths.Add($file.FullName)
    }
    foreach ($file in @(Get-ChildItem -LiteralPath $postgresLogDir -File -ErrorAction Stop)) {
        $null = $paths.Add($file.FullName)
    }
    if (Test-Path -LiteralPath $runtimeLogDir -PathType Container) {
        foreach ($file in @(Get-ChildItem -LiteralPath $runtimeLogDir -File -ErrorAction Stop)) {
            $null = $paths.Add($file.FullName)
        }
    }

    $content = @{}
    foreach ($path in $paths) {
        $content[$path] = Read-SharedText -LiteralPath $path
    }
    $detail = Assert-NoSecretInContentMap -ContentByName $content -Secret $script:targetSecret

    $commandLineHits = 0
    foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction Stop)) {
        if ($null -ne $process.CommandLine -and $process.CommandLine.Contains($script:targetSecret)) {
            $commandLineHits++
        }
    }
    Assert-Condition ($commandLineHits -eq 0) "Target secret found in a live process command line"
    "$detail; command-line hits=0"
}

Write-Host ""
Write-Host "Local PostgreSQL password-rotation gauntlet" -ForegroundColor Cyan
foreach ($result in $script:results) {
    $color = if ($result.Status -eq "PASS") { "Green" } else { "Red" }
    Write-Host ("{0,-4} {1}: {2}" -f $result.Status, $result.Name, $result.Detail) -ForegroundColor $color
}

$failed = @($script:results | Where-Object { $_.Status -ne "PASS" })
Write-Host ""
Write-Host "TOTAL=$($script:results.Count) PASSED=$($script:results.Count - $failed.Count) FAILED=$($failed.Count)"
if ($failed.Count -ne 0) {
    throw "Local PostgreSQL password-rotation gauntlet failed: $($failed.Count) check(s) failed."
}

Write-Host "ROTATION_GAUNTLET_OK" -ForegroundColor Green
