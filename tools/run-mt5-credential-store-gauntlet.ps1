[CmdletBinding()]
param([switch]$SelfTest)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$artifactRoot = Join-Path $repoRoot '.artifacts\mt5-windows-credential-store\revision-9'
$credentialEnvironmentName = 'MT5_R9_POSTGRES_CREDENTIAL_FILE'
$currentUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')

function Assert-WindowsPlatform {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or
        $null -eq $script:currentUserSid) {
        throw 'Revision 9 requires a Windows current-user DPAPI identity'
    }
}

function Assert-InteractiveCurrentUser {
    Assert-WindowsPlatform
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not [Environment]::UserInteractive -or $identity.IsSystem -or $identity.IsAnonymous) {
        throw 'Revision 9 requires an interactive non-system Windows user'
    }
}

function Assert-CredentialArtifactRoot {
    if (Test-Path -LiteralPath $script:artifactRoot) {
        if (-not (Test-Path -LiteralPath $script:artifactRoot -PathType Container)) {
            throw 'Credential artifact root is not a directory'
        }
    } else {
        $null = New-Item -ItemType Directory -Path $script:artifactRoot
    }
    $rootItem = Get-Item -LiteralPath $script:artifactRoot -Force
    if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Credential artifact root must not be a reparse point'
    }
}

function Assert-CredentialPathShape([string]$Path, [switch]$MustExist) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw 'Credential file path is missing'
    }
    $root = [IO.Path]::GetFullPath($script:artifactRoot)
    $full = [IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith(
            $root + [IO.Path]::DirectorySeparatorChar,
            [StringComparison]::OrdinalIgnoreCase
        ) -or [IO.Path]::GetFileName($full) -cnotmatch '^credential-[0-9a-f]{32}\.clixml$') {
        throw 'Credential file path is outside the exact Revision 9 scope'
    }
    if ($MustExist -and -not (Test-Path -LiteralPath $full)) {
        throw 'Credential file is missing'
    }
    return $full
}

function Protect-CredentialFile([string]$Path) {
    $full = Assert-CredentialPathShape $Path -MustExist
    $acl = Get-Acl -LiteralPath $full
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($entry in @($acl.Access)) {
        $acl.RemoveAccessRuleSpecific($entry)
    }
    $acl.SetOwner($currentUserSid)
    foreach ($identity in @($script:currentUserSid, $script:systemSid)) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            $identity,
            [Security.AccessControl.FileSystemRights]::FullControl,
            [Security.AccessControl.AccessControlType]::Allow
        )
        $null = $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $full -AclObject $acl
}

function Assert-CredentialFileSecurity([string]$Path) {
    Assert-CredentialArtifactRoot
    $full = Assert-CredentialPathShape $Path -MustExist
    $item = Get-Item -LiteralPath $full -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint -or
        -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        throw 'Credential file must be a regular non-reparse file'
    }

    $acl = Get-Acl -LiteralPath $full
    if (-not $acl.AreAccessRulesProtected) {
        throw 'Credential file ACL inheritance is not protected'
    }
    $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier])
    if ($owner.Value -cne $script:currentUserSid.Value) {
        throw 'Credential file owner is not the current user SID'
    }

    $expectedSids = @($script:currentUserSid.Value, 'S-1-5-18')
    $actualSids = @()
    foreach ($entry in @($acl.Access)) {
        $entrySid = $entry.IdentityReference.Translate(
            [Security.Principal.SecurityIdentifier]
        ).Value
        if ($entry.IsInherited -or
            $entry.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
            [int]$entry.FileSystemRights -ne
                [int][Security.AccessControl.FileSystemRights]::FullControl -or
            $entry.InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]::None -or
            $entry.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None -or
            $entrySid -cnotin $expectedSids) {
            throw 'Credential file ACL contains a broad or unexpected rule'
        }
        $actualSids += $entrySid
    }
    if ($actualSids.Count -ne 2 -or
        @($actualSids | Where-Object { $_ -ceq $script:currentUserSid.Value }).Count -ne 1 -or
        @($actualSids | Where-Object { $_ -ceq 'S-1-5-18' }).Count -ne 1) {
        throw 'Credential file ACL is not exactly current-user and SYSTEM'
    }

    $serialized = [IO.File]::ReadAllText($full)
    if ($serialized -notmatch '<SS N="Password">[0-9a-fA-F]+</SS>' -or
        $serialized -match '<S N="Password">') {
        throw 'Credential file does not contain only the expected DPAPI SecureString form'
    }
    return $full
}

function Import-ValidatedCredential([string]$Path) {
    $full = Assert-CredentialFileSecurity $Path
    $credential = Import-Clixml -LiteralPath $full
    if ($credential -isnot [PSCredential] -or
        $credential.UserName -cne 'postgres' -or
        $null -eq $credential.Password -or
        $credential.Password.Length -eq 0) {
        throw 'Credential file is not a non-empty postgres PSCredential'
    }
    return $credential
}

function Remove-ExactCredentialFile([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return }
    $full = Assert-CredentialPathShape $Path
    if (Test-Path -LiteralPath $full) {
        $item = Get-Item -LiteralPath $full -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            if ($item.PSIsContainer) {
                [IO.Directory]::Delete($full)
            } else {
                [IO.File]::Delete($full)
            }
        } elseif (Test-Path -LiteralPath $full -PathType Leaf) {
            Remove-Item -LiteralPath $full -Force
        } else {
            throw 'Refusing to remove a non-file credential path'
        }
    }
    if (Test-Path -LiteralPath $full) {
        throw 'CREDENTIAL_FILE_ABSENT=FAIL'
    }
}

function Assert-ExpectedFailure([scriptblock]$Action, [string]$Label) {
    $failed = $false
    try {
        & $Action | Out-Null
    } catch {
        $failed = $true
    }
    if (-not $failed) {
        throw "Credential negative control unexpectedly passed: $Label"
    }
    Write-Host "CREDENTIAL_NEGATIVE_CONTROL=$Label`:PASS"
}

function Invoke-CredentialWrapperSelfTest {
    Assert-WindowsPlatform
    Assert-CredentialArtifactRoot
    $ownedPaths = [Collections.Generic.List[string]]::new()
    $synthetic = $null
    $emptySecure = $null
    try {
        Assert-ExpectedFailure {
            Assert-CredentialFileSecurity (Join-Path $repoRoot 'AGENTS.md')
        } 'outside-root'

        $missing = Join-Path $script:artifactRoot (
            'credential-' + [guid]::NewGuid().ToString('N') + '.clixml'
        )
        Assert-ExpectedFailure { Assert-CredentialFileSecurity $missing } 'missing-file'

        $valid = Join-Path $script:artifactRoot (
            'credential-' + [guid]::NewGuid().ToString('N') + '.clixml'
        )
        $ownedPaths.Add($valid)
        $secure = ConvertTo-SecureString 'revision-9-synthetic-fake-password' -AsPlainText -Force
        $synthetic = [PSCredential]::new('postgres', $secure)
        $synthetic | Export-Clixml -LiteralPath $valid
        Protect-CredentialFile $valid
        $imported = Import-ValidatedCredential $valid
        $imported.Password.Dispose()

        $broad = Join-Path $script:artifactRoot (
            'credential-' + [guid]::NewGuid().ToString('N') + '.clixml'
        )
        $ownedPaths.Add($broad)
        $synthetic | Export-Clixml -LiteralPath $broad
        Assert-ExpectedFailure { Assert-CredentialFileSecurity $broad } 'broad-acl'

        $wrongUser = Join-Path $script:artifactRoot (
            'credential-' + [guid]::NewGuid().ToString('N') + '.clixml'
        )
        $ownedPaths.Add($wrongUser)
        [PSCredential]::new('not-postgres', $secure) |
            Export-Clixml -LiteralPath $wrongUser
        Protect-CredentialFile $wrongUser
        Assert-ExpectedFailure { Import-ValidatedCredential $wrongUser } 'wrong-username'

        $empty = Join-Path $script:artifactRoot (
            'credential-' + [guid]::NewGuid().ToString('N') + '.clixml'
        )
        $ownedPaths.Add($empty)
        $emptySecure = [Security.SecureString]::new()
        [PSCredential]::new('postgres', $emptySecure) | Export-Clixml -LiteralPath $empty
        Protect-CredentialFile $empty
        Assert-ExpectedFailure { Import-ValidatedCredential $empty } 'empty-credential'

        $malformed = Join-Path $script:artifactRoot (
            'credential-' + [guid]::NewGuid().ToString('N') + '.clixml'
        )
        $ownedPaths.Add($malformed)
        [IO.File]::WriteAllText($malformed, '<Objs>malformed</Objs>')
        Protect-CredentialFile $malformed
        Assert-ExpectedFailure { Import-ValidatedCredential $malformed } 'malformed-clixml'

        $plaintext = Join-Path $script:artifactRoot (
            'credential-' + [guid]::NewGuid().ToString('N') + '.clixml'
        )
        $ownedPaths.Add($plaintext)
        [IO.File]::WriteAllText(
            $plaintext,
            '<Objs><S N="UserName">postgres</S><S N="Password">fake</S></Objs>'
        )
        Protect-CredentialFile $plaintext
        Assert-ExpectedFailure { Assert-CredentialFileSecurity $plaintext } 'plaintext-marker'

        $reparse = Join-Path $script:artifactRoot (
            'credential-' + [guid]::NewGuid().ToString('N') + '.clixml'
        )
        $ownedPaths.Add($reparse)
        $null = New-Item -ItemType Junction -Path $reparse -Target $PSScriptRoot
        Assert-ExpectedFailure { Assert-CredentialFileSecurity $reparse } 'reparse-point'
    } finally {
        if ($null -ne $synthetic -and $null -ne $synthetic.Password) {
            $synthetic.Password.Dispose()
        }
        if ($null -ne $emptySecure) { $emptySecure.Dispose() }
        foreach ($ownedPath in $ownedPaths) {
            Remove-ExactCredentialFile $ownedPath
        }
    }
    Write-Host 'CREDENTIAL_WRAPPER_SELF_TEST_OK'
}

if ($SelfTest) {
    Invoke-CredentialWrapperSelfTest
    exit 0
}

Assert-InteractiveCurrentUser
$oldCredentialPath = [Environment]::GetEnvironmentVariable(
    $credentialEnvironmentName,
    'Process'
)
if (-not [string]::IsNullOrWhiteSpace($oldCredentialPath)) {
    throw 'MT5_R9_POSTGRES_CREDENTIAL_FILE is already active'
}

$mutex = [Threading.Mutex]::new(
    $false,
    'Local\MarketLens-MT5-R9-Postgres-Credential'
)
$ownsMutex = $false
try {
    try {
        $ownsMutex = $mutex.WaitOne(0, $false)
    } catch [Threading.AbandonedMutexException] {
        $ownsMutex = $true
    }
    if (-not $ownsMutex) {
        throw 'Another Revision 9 credential handoff is already active'
    }

    Invoke-CredentialWrapperSelfTest
    $credential = $null
    $file = $null
    $exitCode = 0
    $failureLabel = $null
    try {
        $credential = Get-Credential `
            -UserName 'postgres' `
            -Message 'Enter the local PostgreSQL password (not transmitted or logged).'
        if ($null -eq $credential -or
            $credential.UserName -cne 'postgres' -or
            $null -eq $credential.Password -or
            $credential.Password.Length -eq 0) {
            throw 'A non-empty postgres credential is required'
        }

        Assert-CredentialArtifactRoot
        $file = Join-Path $artifactRoot (
            'credential-' + [guid]::NewGuid().ToString('N') + '.clixml'
        )
        $credential | Export-Clixml -LiteralPath $file
        Protect-CredentialFile $file
        $validated = Import-ValidatedCredential $file
        $validated.Password.Dispose()

        [Environment]::SetEnvironmentVariable(
            $credentialEnvironmentName,
            $file,
            'Process'
        )
        & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
            -File (Join-Path $repoRoot 'tools\verify-migration-0042-disposable.ps1') `
            -UseExistingLoopbackService
        $preflightExitCode = $LASTEXITCODE
        if ($preflightExitCode -ne 0) {
            $exitCode = $preflightExitCode
            $failureLabel = 'credential-preflight failed'
            throw $failureLabel
        }

        & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
            -File (Join-Path $repoRoot 'tools\verify-mt5-baremetal-managed-ea.ps1')
        $canonicalExitCode = $LASTEXITCODE
        if ($canonicalExitCode -ne 0) {
            $exitCode = $canonicalExitCode
            $failureLabel = 'canonical gauntlet failed'
            throw $failureLabel
        }
    } catch {
        if ($exitCode -eq 0) { $exitCode = 1 }
        if ([string]::IsNullOrWhiteSpace($failureLabel)) {
            $failureLabel = 'Revision 9 credential wrapper stopped safely'
        }
    } finally {
        [Environment]::SetEnvironmentVariable(
            $credentialEnvironmentName,
            $oldCredentialPath,
            'Process'
        )
        if ($null -ne $credential -and $null -ne $credential.Password) {
            $credential.Password.Dispose()
        }
        try {
            Remove-ExactCredentialFile $file
            Write-Host 'CREDENTIAL_FILE_ABSENT=PASS'
        } catch {
            $exitCode = 1
            $failureLabel = 'Revision 9 credential cleanup failed'
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($failureLabel)) {
        Write-Error -Message $failureLabel -ErrorAction Continue
    }
    exit $exitCode
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
