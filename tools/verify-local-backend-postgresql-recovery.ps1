<#
.SYNOPSIS
  Fail-closed gauntlet for the approved local backend PostgreSQL recovery.

.DESCRIPTION
  Proves the final local-only state described by
  local-backend-postgresql-recovery v1. The verifier is read-only apart from
  starting and stopping the repository's documented local API check. It never
  creates, drops, migrates, or reconfigures a database.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend"
$backendEnv = Join-Path $backendDir ".env"
$specPath = Join-Path $repoRoot "docs\agent-evidence\local-backend-postgresql-recovery\SPEC.md"
$revisionPath = Join-Path $repoRoot "docs\agent-evidence\local-backend-postgresql-recovery\SPEC_REVISION_2.md"
$revision3Path = Join-Path $repoRoot "docs\agent-evidence\local-backend-postgresql-recovery\SPEC_REVISION_3.md"
$serverHandoffPath = Join-Path $repoRoot "docs\agent-evidence\local-backend-postgresql-recovery\SERVER_HANDOFF.md"
$evidencePath = Join-Path $repoRoot "docs\agent-evidence\local-backend-postgresql-recovery\EVIDENCE.md"
$passwordVerifier = Join-Path $repoRoot "tools\verify-local-postgresql-password-rotation.ps1"
$apiVerifier = Join-Path $repoRoot "tools\verify-backend-local.ps1"
$passwordEvidenceDir = Join-Path $repoRoot "docs\agent-evidence\local-postgresql-password-rotation"
$recoveryEvidenceDir = Split-Path -Parent $specPath
$psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
$postgresLogDir = "C:\Program Files\PostgreSQL\17\data\log"
$runtimeLogDir = Join-Path $repoRoot ".runtime-logs"

$approvedBaseHead = "f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c"
$expectedSpecSha256 = "468A2B09F3D611CBFDE5BE98DEB34BD0C7827C786BDD54D80F7BE85E1D031776"
$expectedRevisionSha256 = "65FBBB365810CC661F96793FF30FC2E0A26DF7E390614E6D23176F8D86C2F584"
$expectedRevision3Sha256 = "0DE5997C933F514831E90969C50A85DEEBAD5F9F6C5307F56301D20DA1AA1098"
$expectedOldEnvSha256 = "B8BCC113C41BCC192D5EE91AD6319A9BB8007A3879652BC64BE88B80ACEF3DF0"
$expectedFinalEnvSha256 = "F27F9E0A0BE721808019E8449ED9B28D2AA05AA5DE8DD076006B99C6816880DF"
$expectedOwner = "DESKTOP-F7SJ82A\duong"
$expectedAclIdentities = @(
    "BUILTIN\Administrators",
    "DESKTOP-F7SJ82A\duong",
    "NT AUTHORITY\SYSTEM"
)
$requiredTables = @(
    "alerts",
    "execution_accounts",
    "execution_commands",
    "execution_mt5_vm_accounts",
    "execution_mt5_vm_credential_grants",
    "execution_mt5_vm_workers",
    "sessions",
    "user_settings",
    "users"
)
$allowedCommittedPaths = @(
    "docs/agent-evidence/local-backend-postgresql-recovery/SERVER_HANDOFF.md",
    "docs/agent-evidence/local-backend-postgresql-recovery/SPEC.md",
    "docs/agent-evidence/local-backend-postgresql-recovery/SPEC_REVISION_2.md",
    "docs/agent-evidence/local-backend-postgresql-recovery/SPEC_REVISION_3.md",
    "docs/agent-evidence/local-postgresql-password-rotation/EVIDENCE.md",
    "docs/agent-evidence/local-postgresql-password-rotation/SPEC.md",
    "tools/verify-backend-local.ps1",
    "tools/verify-local-backend-postgresql-recovery.ps1",
    "tools/verify-local-postgresql-password-rotation.ps1"
)
$unrelatedBaseline = [ordered]@{
    "backend/bridge/mt5_vm/test_managed_gauntlet.py" = "EE3F230EFB57299042E0D2512F6ACAF9407B1D909B227BA3A6E1DFAA01AB7695"
    "backend/migrations/test_0042_disposable_gate.py" = "453AD4B1E81D77DFD13A331C9E3AE26801205791C7391432604FB931E29D7A0E"
    "docs/agent-evidence/mt5-windows-credential-store/EVIDENCE.md" = "3DFD5366CB152F7A2226ED73E131F8681B94294AACA172A699B75C1F7F9AF7F7"
    "tools/verify-migration-0042-disposable.ps1" = "6A288ABB2D7E7AF02AE3D1971C5714E35E949B2377C38F1572CD5810BDC9970D"
    "tools/verify-mt5-baremetal-managed-ea-mutants.ps1" = "98001480EA448C0A4D3EF497339781045743968EDEFB56C571E9C13519064818"
    "tools/verify-mt5-baremetal-managed-ea.ps1" = "93709A541E087B80F00B2BFB1A26AC5435A1C16CD8CFB26C5480CC1AD7BCBF61"
    "backend/cmd/mt5-migration-gate/main.go" = "A50CBB4019F464984E7FD9B8EF1E22B6A8E90BF76100DB0AE6F12042D36977A6"
    "backend/cmd/mt5-migration-gate/main_test.go" = "A3DA21E340A0808A9A484934B6D60591871B4A45416362FC92877046B8F5B08B"
    "docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_4.md" = "74E72144AC81C42D4D91DF0A60BACB7860B12531DA62C0D13577F3A71C14B8FE"
    "docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_5.md" = "09DCA333BDC197763485013ABD1989FBAF82C43BB1D8C9BB9D4C5BD7E108B352"
    "docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_6.md" = "BCA670C6B5094D5CD418B02ECB746077A6CEF0DAC6519A36A9D7D1862F04F447"
    "docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_7.md" = "CBF44B8659004D5F43B2E71EEA17AC350FFFB859415852F3B8871A16FA7780C4"
    "docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_8.md" = "A2B6F107F180CF09DFE2E7C23B6451DDE344D41B53BCBFA0BB153B888EFC1F12"
    "docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_9.md" = "9EBA46408B742C2D0DF06E019091BC50BAEAE50035E08D4507C6B85472B111A7"
    "tools/run-mt5-credential-store-gauntlet.ps1" = "6FCFB7422BF89D95D1B37D806A28E93D555AD894FD7834CBEA453D2ED93846AD"
}

$script:targetSecret = $null
$script:databaseCredential = $null
$script:finalEnvReady = $false
$script:databaseReady = $false
$script:migrationReady = $false
$script:aclReady = $false
$script:results = New-Object System.Collections.Generic.List[object]

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)

    if (-not (Test-Path -LiteralPath $LiteralPath -PathType Leaf)) {
        throw "Required file is missing: $LiteralPath"
    }
    return (Get-FileHash -LiteralPath $LiteralPath -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Get-BytesSha256 {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)

    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace("-", "")
    } finally {
        $sha.Dispose()
    }
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

function Get-DatabaseCredentialFromText {
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
    $separator = $uri.UserInfo.IndexOf(':')
    if ($separator -lt 1 -or $separator -eq ($uri.UserInfo.Length - 1)) {
        throw "DATABASE_URL must contain a role and password"
    }
    $role = [Uri]::UnescapeDataString($uri.UserInfo.Substring(0, $separator))
    $password = [Uri]::UnescapeDataString($uri.UserInfo.Substring($separator + 1))
    if ($role -cne "postgres") { throw "DATABASE_URL role is not postgres" }
    if ($password -cnotmatch '^[A-Za-z0-9]{32}$') {
        throw "DATABASE_URL password does not match the approved credential contract"
    }
    return [pscustomobject]@{
        Role = $role
        Password = $password
        Host = $uri.Host
        Port = $uri.Port
        Database = $uri.AbsolutePath.TrimStart('/')
    }
}

function Assert-FinalEnvText {
    param(
        [Parameter(Mandatory = $true)][byte[]]$Bytes,
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][object]$Credential
    )

    Assert-Condition ($Bytes.Length -ge 3) "backend/.env is unexpectedly short"
    $hasBom = $Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF
    Assert-Condition (-not $hasBom) "backend/.env has an unexpected UTF-8 BOM"
    Assert-Condition (-not $Text.Contains("`r")) "backend/.env no longer uses LF-only line endings"
    Assert-Condition ($Credential.Host -ceq "127.0.0.1") "DATABASE_URL host changed"
    Assert-Condition ($Credential.Port -eq 5432) "DATABASE_URL does not target approved port 5432"
    Assert-Condition ($Credential.Database -ceq "smc") "DATABASE_URL database changed"
    $newEndpointCount = [regex]::Matches($Text, [regex]::Escape("127.0.0.1:5432")).Count
    $oldEndpointCount = [regex]::Matches($Text, [regex]::Escape("127.0.0.1:55432")).Count
    Assert-Condition ($newEndpointCount -eq 1) "Approved final endpoint must occur exactly once"
    Assert-Condition ($oldEndpointCount -eq 0) "Old 55432 endpoint remains in backend/.env"

    $reconstructed = $Text.Replace("127.0.0.1:5432", "127.0.0.1:55432")
    $encoding = New-Object System.Text.UTF8Encoding($false)
    $reconstructedHash = Get-BytesSha256 -Bytes $encoding.GetBytes($reconstructed)
    Assert-Condition ($reconstructedHash -ceq $expectedOldEnvSha256) "Non-endpoint backend/.env content changed"
    return "UTF-8 no BOM; LF; one approved endpoint; inverse hash=$reconstructedHash"
}

function Assert-SourceRunnerContractText {
    param([Parameter(Mandatory = $true)][string]$Text)

    $requiredFragments = @(
        '[switch]$RunFromSource',
        '$executionMode = if ($RunFromSource)',
        'run --locked --offline --release -p execution-gateway',
        'run ./cmd/api',
        '$env:CARGO_NET_OFFLINE = "true"',
        '$env:GOPROXY = "off"',
        '$env:GOSUMDB = "off"',
        '$entry.KillProcessTree',
        'taskkill.exe /PID',
        '/T /F',
        'execution mode: current source (offline)',
        'Join-Path $binDir "execution-gateway.exe"',
        'Join-Path $binDir "api.exe"'
    )
    foreach ($fragment in $requiredFragments) {
        if (-not $Text.Contains($fragment)) {
            throw "Source-runner contract fragment is absent: $fragment"
        }
    }
    if ($Text -match '(?m)\[switch\]\s*\$RunFromSource\s*=\s*\$true') {
        throw "RunFromSource must not be enabled by default"
    }
    foreach ($forbidden in @(
        'run-backend-production.ps1',
        'deploy-backend.ps1',
        'build-production.ps1'
    )) {
        if ($Text.Contains($forbidden)) {
            throw "Source runner references forbidden production command: $forbidden"
        }
    }
    return "offline locked source commands; compiled default; process-tree cleanup; no production command"
}

function Assert-ServerHandoffText {
    param([Parameter(Mandatory = $true)][string]$Text)

    foreach ($fragment in @(
        'Status: **BLOCKED**',
        '19/22',
        '21/21',
        '42,false',
        '{0283ac0f-fff1-49ae-ada1-8a933130cad6}',
        '3033/3077',
        'os error 4551',
        '12 API probes did not run',
        'backend/.env is not shipped',
        'host-specific and is not a portable production-server gauntlet',
        '.\tools\verify-backend-local.ps1 -RunFromSource -ReadyTimeoutSeconds 600',
        '.\run-backend-production.ps1',
        '.\tools\deploy-backend.ps1',
        'not invoked by this handoff',
        'Do not send credentials'
    )) {
        if (-not $Text.Contains($fragment)) {
            throw "Server handoff marker is absent: $fragment"
        }
    }
    if ($Text -match '(?i)postgres(?:ql)?://[^@\s]+@') {
        throw "Server handoff contains database URL userinfo"
    }
    if ($Text -match 'SCRAM-SHA-256\$') {
        throw "Server handoff contains a SCRAM verifier"
    }
    foreach ($forbidden in @('12/12 passed', 'production-ready', 'Status: **PASS**')) {
        if ($Text.Contains($forbidden)) {
            throw "Server handoff contains a false completion marker: $forbidden"
        }
    }
    return "blocked outcome, server boundaries, portable check, and credential guidance present"
}

function Assert-CommittedPathAllowlist {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$ActualPaths,
        [Parameter(Mandatory = $true)][string[]]$AllowedPaths
    )

    $allowed = New-Object System.Collections.Generic.HashSet[string]([StringComparer]::OrdinalIgnoreCase)
    foreach ($path in $AllowedPaths) { $null = $allowed.Add($path.Replace('\', '/')) }
    $actual = New-Object System.Collections.Generic.HashSet[string]([StringComparer]::OrdinalIgnoreCase)
    foreach ($path in $ActualPaths) {
        $normalized = $path.Replace('\', '/')
        if (-not $actual.Add($normalized)) { throw "Duplicate committed path: $normalized" }
        if (-not $allowed.Contains($normalized)) { throw "Unexpected committed path after approved base: $normalized" }
    }
    return "$($actual.Count) committed path(s) are inside the nine-path allowlist"
}

function Convert-ActualAclRules {
    param([Parameter(Mandatory = $true)][object]$Acl)

    return @($Acl.Access | ForEach-Object {
        [pscustomobject]@{
            Identity = $_.IdentityReference.Value
            Type = "$($_.AccessControlType)"
            Rights = "$($_.FileSystemRights)"
            IsInherited = [bool]$_.IsInherited
        }
    })
}

function Assert-AclModel {
    param(
        [Parameter(Mandatory = $true)][bool]$InheritanceProtected,
        [Parameter(Mandatory = $true)][object[]]$Rules
    )

    Assert-Condition $InheritanceProtected "ACL inheritance is not disabled"
    Assert-Condition ($Rules.Count -eq 3) "ACL must contain exactly three access rules"
    $actualIdentities = @($Rules | ForEach-Object { $_.Identity } | Sort-Object)
    Assert-Condition (($actualIdentities -join "|") -ceq (($expectedAclIdentities | Sort-Object) -join "|")) "ACL identities do not match owner/SYSTEM/Administrators"
    foreach ($rule in $Rules) {
        Assert-Condition ($rule.Type -ceq "Allow") "ACL contains a deny rule"
        Assert-Condition ($rule.Rights -match 'FullControl') "ACL identity lacks FullControl: $($rule.Identity)"
        Assert-Condition (-not $rule.IsInherited) "ACL contains an inherited rule"
    }
    return "inheritance disabled; three explicit FullControl allow rules"
}

function Invoke-Psql {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("127.0.0.1", "::1")][string]$HostName,
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port,
        [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z_][A-Za-z0-9_]{0,62}$')][string]$Role,
        [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z_][A-Za-z0-9_]{0,62}$')][string]$Database,
        [AllowNull()][string]$Password,
        [Parameter(Mandatory = $true)][string]$Sql,
        [int]$TimeoutMilliseconds = 15000
    )

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $psql
    $psi.Arguments = "-X -w -v ON_ERROR_STOP=1 -h $HostName -p $Port -U $Role -d $Database -At -F `"|`""
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables.Remove("PGPASSWORD")
    $psi.EnvironmentVariables["PGCONNECT_TIMEOUT"] = "3"
    if ($null -ne $Password) { $psi.EnvironmentVariables["PGPASSWORD"] = $Password }

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

function Assert-DatabaseInventoryText {
    param([Parameter(Mandatory = $true)][string]$Text)

    $actual = @(($Text.Trim() -split "`r?`n") | Where-Object { $_ })
    $expected = @("postgres|postgres", "smc|postgres", "template1|postgres")
    Assert-Condition ($actual.Count -eq $expected.Count) "Connectable database count is not three"
    Assert-Condition (($actual -join "`n") -ceq ($expected -join "`n")) "Database inventory or owner is not exact"
    return "postgres, smc, template1; each owned by postgres"
}

function Assert-MigrationStateText {
    param([Parameter(Mandatory = $true)][string]$Text)

    Assert-Condition ($Text.Trim() -ceq "42|f") "Migration state is not version 42, dirty=false"
    return "version=42; dirty=false"
}

function Assert-RequiredTablesText {
    param([Parameter(Mandatory = $true)][string]$Text)

    $actual = @(($Text.Trim() -split "`r?`n") | Where-Object { $_ })
    Assert-Condition ($actual.Count -eq $requiredTables.Count) "Required table count is incomplete"
    Assert-Condition (($actual -join "|") -ceq ($requiredTables -join "|")) "Required table inventory is incomplete"
    return "$($actual.Count) required tables present"
}

function Assert-NoSecretInContentMap {
    param(
        [Parameter(Mandatory = $true)][hashtable]$ContentByName,
        [Parameter(Mandatory = $true)][string]$Secret
    )

    foreach ($name in $ContentByName.Keys) {
        if ($ContentByName[$name].Contains($Secret)) {
            throw "Target secret found in retained content: $name"
        }
    }
    return "$($ContentByName.Count) retained file(s) clean"
}

function Invoke-CapturedProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FileName,
        [Parameter(Mandatory = $true)][string]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [ValidateRange(1000, 900000)][int]$TimeoutMilliseconds = 120000,
        [switch]$KillTreeOnTimeout
    )

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FileName
    $psi.Arguments = $Arguments
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    if (-not $process.Start()) { throw "Failed to start process: $FileName" }
    if (-not $process.WaitForExit($TimeoutMilliseconds)) {
        if ($KillTreeOnTimeout) {
            $null = & taskkill.exe /PID $process.Id /T /F 2>&1
        } else {
            $process.Kill()
        }
        $process.WaitForExit()
        throw "Process timed out after $TimeoutMilliseconds ms: $FileName"
    }
    return [pscustomobject]@{
        ExitCode = $process.ExitCode
        Stdout = $process.StandardOutput.ReadToEnd()
        Stderr = $process.StandardError.ReadToEnd()
    }
}

function Assert-NoTrailingWhitespace {
    param([Parameter(Mandatory = $true)][string[]]$LiteralPaths)

    foreach ($path in $LiteralPaths) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
        $lineNumber = 0
        foreach ($line in ([IO.File]::ReadAllLines($path))) {
            $lineNumber++
            if ($line -match '[ \t]+$') { throw "Trailing whitespace: ${path}:$lineNumber" }
        }
    }
    return "$($LiteralPaths.Count) task path(s) checked"
}

foreach ($requiredPath in @($backendEnv, $specPath, $revisionPath, $revision3Path, $passwordVerifier, $apiVerifier, $psql)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required verifier input is missing: $requiredPath"
    }
}

$envBytes = [IO.File]::ReadAllBytes($backendEnv)
$strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
try {
    $envText = $strictUtf8.GetString($envBytes)
} catch {
    throw "backend/.env is not valid UTF-8"
}
$script:databaseCredential = Get-DatabaseCredentialFromText -EnvText $envText
$script:targetSecret = $script:databaseCredential.Password

Invoke-Check -Name "PowerShell syntax" -Action {
    foreach ($path in @($PSCommandPath, $passwordVerifier, $apiVerifier)) {
        $tokens = $null
        $errors = $null
        $null = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
        if ($errors.Count -ne 0) { throw "$path has $($errors.Count) parser error(s)" }
    }
    "three scripts; zero parser errors"
}

Invoke-Check -Name "Approved SPEC identities" -Action {
    $actual = Get-Sha256 -LiteralPath $specPath
    $actualRevision = Get-Sha256 -LiteralPath $revisionPath
    $actualRevision3 = Get-Sha256 -LiteralPath $revision3Path
    Assert-Condition ($actual -ceq $expectedSpecSha256) "Approved v1 SPEC changed after approval"
    Assert-Condition ($actualRevision -ceq $expectedRevisionSha256) "Approved v2 revision changed after approval"
    Assert-Condition ($actualRevision3 -ceq $expectedRevision3Sha256) "Approved v3 revision changed after approval"
    $spec = [IO.File]::ReadAllText($specPath)
    $revision = [IO.File]::ReadAllText($revisionPath)
    $revision3 = [IO.File]::ReadAllText($revision3Path)
    Assert-Condition ($spec.Contains("local-backend-postgresql-recovery v1")) "v1 SPEC identity is absent"
    Assert-Condition ($revision.Contains("APPROVE SPEC: local-backend-postgresql-recovery v2")) "v2 approval token is absent"
    Assert-Condition ($revision3.Contains("APPROVE SPEC: local-backend-postgresql-recovery v3")) "v3 approval token is absent"
    "v1_sha256=$actual; v2_sha256=$actualRevision; v3_sha256=$actualRevision3"
}

Invoke-Check -Name "Source state and toolchain" -Action {
    $head = (& git -C $repoRoot rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw "git rev-parse failed" }
    $null = & git -C $repoRoot merge-base --is-ancestor $approvedBaseHead HEAD
    $ancestorExit = $LASTEXITCODE
    if ($ancestorExit -eq 1) { throw "Approved base commit is not an ancestor of current HEAD" }
    if ($ancestorExit -ne 0) { throw "git merge-base failed with exit $ancestorExit" }
    $committedPaths = @(& git -C $repoRoot diff --name-only "$approvedBaseHead..HEAD" --)
    if ($LASTEXITCODE -ne 0) { throw "git diff failed for approved committed delta" }
    $deltaDetail = Assert-CommittedPathAllowlist -ActualPaths $committedPaths -AllowedPaths $allowedCommittedPaths
    $goVersion = (& go version 2>&1) -join " "
    if ($LASTEXITCODE -ne 0) { throw "go version failed" }
    Assert-Condition ($goVersion -match '^go version go1\.26\.5 ') "Go toolchain changed: $goVersion"
    Assert-Condition ($PSVersionTable.PSVersion.Major -eq 5) "PowerShell major version is not 5"
    "approved_base=$approvedBaseHead; HEAD=$head; $deltaDetail; $goVersion; PowerShell $($PSVersionTable.PSVersion)"
}

Invoke-Check -Name "Final backend/.env invariant" -Action {
    $actual = Get-BytesSha256 -Bytes $envBytes
    Assert-Condition ($actual -ceq $expectedFinalEnvSha256) "backend/.env is not the approved final byte state"
    $detail = Assert-FinalEnvText -Bytes $envBytes -Text $envText -Credential $script:databaseCredential
    $script:finalEnvReady = $true
    "sha256=$actual; $detail"
}

Invoke-Check -Name "backend/.env Git boundary" -Action {
    $tracked = @(& git -C $repoRoot ls-files -- "backend/.env")
    if ($LASTEXITCODE -ne 0) { throw "git ls-files failed for backend/.env" }
    Assert-Condition ($tracked.Count -eq 0) "backend/.env is tracked by Git"
    $ignored = @(& git -C $repoRoot check-ignore -v -- "backend/.env")
    if ($LASTEXITCODE -ne 0) { throw "backend/.env is not ignored by Git" }
    Assert-Condition ($ignored.Count -eq 1) "backend/.env ignore resolution is ambiguous"
    "untracked; ignored by exactly one rule"
}

Invoke-Check -Name "Secret-file ACL" -Action {
    $acl = Get-Acl -LiteralPath $backendEnv
    Assert-Condition ($acl.Owner -ceq $expectedOwner) "backend/.env owner changed: $($acl.Owner)"
    $detail = Assert-AclModel -InheritanceProtected $acl.AreAccessRulesProtected -Rules (Convert-ActualAclRules -Acl $acl)
    $null = [IO.File]::ReadAllBytes($backendEnv)
    $script:aclReady = $true
    "owner=$($acl.Owner); $detail; owner-readable"
}

Invoke-Check -Name "Configuration checker negative controls" -Action {
    $oldEndpointText = $envText.Replace("127.0.0.1:5432", "127.0.0.1:55432")
    $oldCredential = Get-DatabaseCredentialFromText -EnvText $oldEndpointText
    $one = Assert-Throws -Label "old endpoint fixture" -Action {
        Assert-FinalEnvText -Bytes $envBytes -Text $oldEndpointText -Credential $oldCredential
    }
    $baseRules = @($expectedAclIdentities | ForEach-Object {
        [pscustomobject]@{ Identity = $_; Type = "Allow"; Rights = "FullControl"; IsInherited = $false }
    })
    $extraRules = @($baseRules) + @([pscustomobject]@{
        Identity = "DESKTOP-F7SJ82A\CodexSandboxUsers"
        Type = "Allow"
        Rights = "ReadAndExecute"
        IsInherited = $false
    })
    $two = Assert-Throws -Label "extra ACL identity fixture" -Action {
        Assert-AclModel -InheritanceProtected $true -Rules $extraRules
    }
    $three = Assert-Throws -Label "inherited ACL fixture" -Action {
        Assert-AclModel -InheritanceProtected $false -Rules $baseRules
    }
    "$one; $two; $three"
}

Invoke-Check -Name "Source-runner contract and negative controls" -Action {
    $source = [IO.File]::ReadAllText($apiVerifier)
    $detail = Assert-SourceRunnerContractText -Text $source
    $mutants = [ordered]@{
        "online Cargo command" = $source.Replace("--locked --offline", "--locked")
        "implicit source default" = $source.Replace('[switch]$RunFromSource,', '[switch]$RunFromSource = $true,')
        "missing process-tree cleanup" = $source.Replace("taskkill.exe /PID", "taskkill.exe /BROKENPID")
        "production command injection" = $source + "`nrun-backend-production.ps1`n"
    }
    $kills = New-Object System.Collections.Generic.List[string]
    foreach ($entry in $mutants.GetEnumerator()) {
        Assert-Condition ($entry.Value -cne $source) "Source-runner mutant did not alter source: $($entry.Key)"
        $kills.Add((Assert-Throws -Label $entry.Key -Action {
            Assert-SourceRunnerContractText -Text $entry.Value
        })) | Out-Null
    }
    "$detail; 4/4 static mutants killed ($($kills -join '; '))"
}

Invoke-Check -Name "Committed-path checker negative controls" -Action {
    $empty = @()
    $detail = Assert-CommittedPathAllowlist -ActualPaths $empty -AllowedPaths $allowedCommittedPaths
    $one = Assert-Throws -Label "unexpected committed path fixture" -Action {
        Assert-CommittedPathAllowlist -ActualPaths @("backend/cmd/api/main.go") -AllowedPaths $allowedCommittedPaths
    }
    $two = Assert-Throws -Label "duplicate committed path fixture" -Action {
        Assert-CommittedPathAllowlist -ActualPaths @(
            "tools/verify-backend-local.ps1",
            "tools\verify-backend-local.ps1"
        ) -AllowedPaths $allowedCommittedPaths
    }
    "$detail; $one; $two"
}

Invoke-Check -Name "Server handoff contract and negative controls" -Action {
    if (-not (Test-Path -LiteralPath $serverHandoffPath -PathType Leaf)) {
        throw "SERVER_HANDOFF.md is absent"
    }
    $text = [IO.File]::ReadAllText($serverHandoffPath)
    $detail = Assert-ServerHandoffText -Text $text
    $one = Assert-Throws -Label "database userinfo fixture" -Action {
        Assert-ServerHandoffText -Text ($text + "`npostgresql://role:KnownBadFixture@127.0.0.1/db`n")
    }
    $two = Assert-Throws -Label "false 12/12 fixture" -Action {
        Assert-ServerHandoffText -Text ($text + "`n12/12 passed`n")
    }
    $three = Assert-Throws -Label "missing BLOCKED marker fixture" -Action {
        Assert-ServerHandoffText -Text $text.Replace('Status: **BLOCKED**', 'Status: pending')
    }
    "$detail; $one; $two; $three"
}

Invoke-Check -Name "Database checker negative controls" -Action {
    $one = Assert-Throws -Label "absent smc fixture" -Action {
        Assert-DatabaseInventoryText -Text "postgres|postgres`ntemplate1|postgres"
    }
    $two = Assert-Throws -Label "dirty migration fixture" -Action {
        Assert-MigrationStateText -Text "42|t"
    }
    $three = Assert-Throws -Label "missing migration fixture" -Action {
        Assert-MigrationStateText -Text ""
    }
    "$one; $two; $three"
}

Invoke-Check -Name "Exact database inventory and owner" -Action {
    $sql = "SELECT datname, pg_get_userbyid(datdba) FROM pg_database WHERE datallowconn ORDER BY datname;"
    $result = Invoke-Psql -HostName "127.0.0.1" -Port 5432 -Role "postgres" -Database "postgres" -Password $script:targetSecret -Sql $sql
    if ($result.ExitCode -ne 0) { throw "Database inventory query failed: $(Protect-Text $result.Stderr)" }
    $detail = Assert-DatabaseInventoryText -Text $result.Stdout
    $script:databaseReady = $true
    $detail
}

Invoke-Check -Name "Migration state" -Action {
    $result = Invoke-Psql -HostName "127.0.0.1" -Port 5432 -Role "postgres" -Database "smc" -Password $script:targetSecret -Sql "SELECT version, dirty FROM public.schema_migrations;"
    if ($result.ExitCode -ne 0) { throw "Migration-state query failed: $(Protect-Text $result.Stderr)" }
    $detail = Assert-MigrationStateText -Text $result.Stdout
    $script:migrationReady = $true
    $detail
}

Invoke-Check -Name "Required schema tables" -Action {
    $quotedTables = ($requiredTables | ForEach-Object { "'$_'" }) -join ","
    $sql = "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ($quotedTables) ORDER BY tablename;"
    $result = Invoke-Psql -HostName "127.0.0.1" -Port 5432 -Role "postgres" -Database "smc" -Password $script:targetSecret -Sql $sql
    if ($result.ExitCode -ne 0) { throw "Required-table query failed: $(Protect-Text $result.Stderr)" }
    Assert-RequiredTablesText -Text $result.Stdout
}

Invoke-Check -Name "Old endpoint rejection" -Action {
    $result = Invoke-Psql -HostName "127.0.0.1" -Port 55432 -Role "postgres" -Database "smc" -Password $script:targetSecret -Sql "SELECT 1;"
    Assert-Condition ($result.ExitCode -ne 0) "Old endpoint 127.0.0.1:55432 unexpectedly accepted a connection"
    "127.0.0.1:55432 rejected"
}

Invoke-Check -Name "Password/HBA nested gauntlet" -Action {
    $quoted = '"' + $passwordVerifier.Replace('"', '\"') + '"'
    $result = Invoke-CapturedProcess -FileName "powershell.exe" -Arguments "-NoProfile -ExecutionPolicy Bypass -File $quoted" -WorkingDirectory $repoRoot -TimeoutMilliseconds 120000
    if ($result.ExitCode -ne 0) { throw "Password verifier failed: $(Protect-Text ($result.Stdout + "`n" + $result.Stderr))" }
    Assert-Condition ($result.Stdout -match 'ROTATION_GAUNTLET_OK') "Password verifier success marker is absent"
    Assert-Condition ($result.Stdout -match 'TOTAL=21 PASSED=21 FAILED=0') "Password verifier did not pass 21/21"
    "21/21; correct IPv4/IPv6; wrong/no password rejected; trust=0"
}

Invoke-Check -Name "Targeted Go tests" -Action {
    $result = Invoke-CapturedProcess -FileName "go.exe" -Arguments "test ./cmd/migrate ./internal/db -count=1 -timeout=60s" -WorkingDirectory $backendDir -TimeoutMilliseconds 120000
    if ($result.ExitCode -ne 0) { throw "Targeted go test failed: $(Protect-Text ($result.Stdout + "`n" + $result.Stderr))" }
    "go test exit=0; cmd/migrate and internal/db"
}

Invoke-Check -Name "Targeted Go vet" -Action {
    $result = Invoke-CapturedProcess -FileName "go.exe" -Arguments "vet ./cmd/migrate ./internal/db" -WorkingDirectory $backendDir -TimeoutMilliseconds 120000
    if ($result.ExitCode -ne 0) { throw "Targeted go vet failed: $(Protect-Text ($result.Stdout + "`n" + $result.Stderr))" }
    "go vet exit=0; cmd/migrate and internal/db"
}

Invoke-Check -Name "Real local API and gateway" -Action {
    if (-not ($script:finalEnvReady -and $script:databaseReady -and $script:migrationReady -and $script:aclReady)) {
        throw "Final database, migration, endpoint, and ACL preconditions are not all green"
    }
    foreach ($port in @(8080, 8790, 8791)) {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
        Assert-Condition ($listeners.Count -eq 0) "Pre-existing listener occupies local verifier port $port"
    }
    $quoted = '"' + $apiVerifier.Replace('"', '\"') + '"'
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File $quoted -RunFromSource -ReadyTimeoutSeconds 600"
    $result = Invoke-CapturedProcess -FileName "powershell.exe" -Arguments $arguments -WorkingDirectory $repoRoot -TimeoutMilliseconds 900000 -KillTreeOnTimeout
    if ($result.ExitCode -ne 0) { throw "Local API verifier failed: $(Protect-Text ($result.Stdout + "`n" + $result.Stderr))" }
    Assert-Condition ($result.Stdout -match 'All 12 API probes passed\.') "Local API verifier did not report 12/12"
    Assert-Condition ($result.Stdout -match 'execution mode: current source \(offline\)') "Local API verifier did not report approved source mode"
    Assert-Condition ($result.Stdout -notmatch '(?m)^\s*FAIL\s') "Local API verifier output contains a failed probe"
    foreach ($port in @(8080, 8790, 8791)) {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
        Assert-Condition ($listeners.Count -eq 0) "Local verifier left a listener on port $port"
    }
    "12/12 probes; zero 5xx; verifier-started listeners stopped"
}

Invoke-Check -Name "Final EVIDENCE contract" -Action {
    if (-not (Test-Path -LiteralPath $evidencePath -PathType Leaf)) { throw "Final EVIDENCE.md is absent" }
    $text = [IO.File]::ReadAllText($evidencePath)
    foreach ($needle in @(
        "APPROVE SPEC: local-backend-postgresql-recovery v1",
        "APPROVE SPEC: local-backend-postgresql-recovery v2",
        "APPROVE SPEC: local-backend-postgresql-recovery v3",
        $expectedRevisionSha256,
        $expectedRevision3Sha256,
        "RED",
        "13/21",
        "18/21",
        "42|f",
        "12/12",
        "Application Control",
        "go test ./...",
        "not production"
    )) {
        Assert-Condition ($text.Contains($needle)) "EVIDENCE is missing required marker: $needle"
    }
    "approval, RED, migration, API, unverified-layer, and production-boundary markers present"
}

Invoke-Check -Name "Secret-scan checker negative controls" -Action {
    $bad = @{ "in-memory-known-bad-fixture" = "prefix-$($script:targetSecret)-suffix" }
    $one = Assert-Throws -Label "injected target secret" -Action {
        Assert-NoSecretInContentMap -ContentByName $bad -Secret $script:targetSecret
    }
    $missing = Join-Path $env:TEMP "codex-local-backend-recovery-missing-input.txt"
    $two = Assert-Throws -Label "missing scan input" -Action { Read-SharedText -LiteralPath $missing }
    "$one; $two"
}

Invoke-Check -Name "Extended retained-secret scan" -Action {
    if (-not (Test-Path -LiteralPath $postgresLogDir -PathType Container)) {
        throw "PostgreSQL log directory is missing"
    }
    $paths = New-Object System.Collections.Generic.HashSet[string]([StringComparer]::OrdinalIgnoreCase)
    foreach ($path in @($PSCommandPath, $passwordVerifier, $specPath, $revisionPath, $revision3Path)) { $null = $paths.Add($path) }
    if (Test-Path -LiteralPath $serverHandoffPath -PathType Leaf) { $null = $paths.Add($serverHandoffPath) }
    foreach ($dir in @($recoveryEvidenceDir, $passwordEvidenceDir, $postgresLogDir, $runtimeLogDir)) {
        if (-not (Test-Path -LiteralPath $dir -PathType Container)) { continue }
        foreach ($file in @(Get-ChildItem -LiteralPath $dir -File -ErrorAction Stop)) {
            $null = $paths.Add($file.FullName)
        }
    }
    $content = @{}
    foreach ($path in $paths) { $content[$path] = Read-SharedText -LiteralPath $path }
    $detail = Assert-NoSecretInContentMap -ContentByName $content -Secret $script:targetSecret

    $commandLineHits = 0
    foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction Stop)) {
        if ($null -ne $process.CommandLine -and $process.CommandLine.Contains($script:targetSecret)) {
            $commandLineHits++
        }
    }
    Assert-Condition ($commandLineHits -eq 0) "Target secret found in a live process command line"
    "$detail; live command-line hits=0"
}

Invoke-Check -Name "Unrelated dirty-worktree preservation" -Action {
    foreach ($entry in $unrelatedBaseline.GetEnumerator()) {
        $path = Join-Path $repoRoot $entry.Key.Replace('/', '\')
        $actual = Get-Sha256 -LiteralPath $path
        Assert-Condition ($actual -ceq $entry.Value) "Unrelated dirty path changed: $($entry.Key)"
    }
    "$($unrelatedBaseline.Count) unrelated dirty files retain approved baseline hashes"
}

Invoke-Check -Name "Task-owned status and text hygiene" -Action {
    $taskPaths = @(
        $PSCommandPath,
        $passwordVerifier,
        $specPath,
        $revisionPath,
        $revision3Path,
        $serverHandoffPath,
        $evidencePath,
        (Join-Path $passwordEvidenceDir "SPEC.md"),
        (Join-Path $passwordEvidenceDir "EVIDENCE.md")
    )
    $detail = Assert-NoTrailingWhitespace -LiteralPaths $taskPaths
    $diffCheck = @(& git -C $repoRoot diff --check -- "tools/verify-local-postgresql-password-rotation.ps1")
    if ($LASTEXITCODE -ne 0) { throw "git diff --check failed: $($diffCheck -join '; ')" }
    foreach ($path in @($PSCommandPath, $passwordVerifier, $specPath, $revisionPath, $revision3Path, $serverHandoffPath, $evidencePath)) {
        Assert-Condition (Test-Path -LiteralPath $path -PathType Leaf) "Task-owned file is missing: $path"
    }
    "$detail; diff check clean; task-owned files present"
}

Write-Host ""
Write-Host "Local backend PostgreSQL recovery gauntlet" -ForegroundColor Cyan
foreach ($result in $script:results) {
    $color = if ($result.Status -eq "PASS") { "Green" } else { "Red" }
    Write-Host ("{0,-4} {1}: {2}" -f $result.Status, $result.Name, $result.Detail) -ForegroundColor $color
}

$failed = @($script:results | Where-Object { $_.Status -ne "PASS" })
Write-Host ""
Write-Host "TOTAL=$($script:results.Count) PASSED=$($script:results.Count - $failed.Count) FAILED=$($failed.Count)"
if ($failed.Count -ne 0) {
    throw "Local backend PostgreSQL recovery gauntlet failed: $($failed.Count) check(s) failed."
}

Write-Host "LOCAL_BACKEND_POSTGRESQL_RECOVERY_OK" -ForegroundColor Green
