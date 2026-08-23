param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sourcePath = Join-Path $repoRoot 'backend\execution\crates\mt5-vm-agent\tests\managed_commands.rs'
$rustRoot = Join-Path $repoRoot 'backend\execution'
$originalBytes = [IO.File]::ReadAllBytes($sourcePath)
$utf8 = New-Object Text.UTF8Encoding($false)
$originalText = $utf8.GetString($originalBytes)

function Get-BytesSha256([byte[]]$Bytes) {
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha256.ComputeHash($Bytes))).Replace('-', '')
    } finally {
        $sha256.Dispose()
    }
}

$originalHash = Get-BytesSha256 $originalBytes

$mutants = @(
    [pscustomobject]@{
        Name = 'reject-broken-pipe'
        Pattern = 'io::ErrorKind::BrokenPipe\s+\|\s+io::ErrorKind::ConnectionReset'
        Replacement = "io::ErrorKind::NotConnected`n                    | io::ErrorKind::ConnectionReset"
    },
    [pscustomobject]@{
        Name = 'swallow-all-io-errors'
        Pattern = 'Err\(error\)\s+if matches!\('
        Replacement = "Err(error)`n            if true || matches!("
    },
    [pscustomobject]@{
        Name = 'skip-response-flush'
        Pattern = '\.and_then\(\|\(\)\| writer\.flush\(\)\);'
        Replacement = '.and(Ok(()));'
    }
)

$killed = 0

try {
    foreach ($mutant in $mutants) {
        $matches = [regex]::Matches($originalText, $mutant.Pattern)
        if ($matches.Count -ne 1) {
            throw "Mutant $($mutant.Name) expected one source match, found $($matches.Count)."
        }

        $mutatedText = [regex]::Replace($originalText, $mutant.Pattern, $mutant.Replacement, 1)
        $mutatedBytes = $utf8.GetBytes($mutatedText)
        $mutatedHash = Get-BytesSha256 $mutatedBytes
        if ($mutatedHash -eq $originalHash) {
            throw "Mutant $($mutant.Name) did not change the source hash."
        }

        [IO.File]::WriteAllBytes($sourcePath, $mutatedBytes)
        $onDiskHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
        if ($onDiskHash -ne $mutatedHash) {
            throw "Mutant $($mutant.Name) was not written exactly."
        }

        Push-Location $rustRoot
        try {
            $previousErrorAction = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            try {
                $output = & cargo test --quiet --locked -p mt5-vm-agent --test managed_commands scripted_response_ -- --test-threads=1 2>&1
                $exitCode = $LASTEXITCODE
            } finally {
                $ErrorActionPreference = $previousErrorAction
            }
        } finally {
            Pop-Location
        }

        if ($exitCode -eq 0) {
            $output | ForEach-Object { Write-Host $_ }
            throw "SURVIVED: $($mutant.Name)"
        }

        $killed += 1
        Write-Host "KILLED: $($mutant.Name) (source SHA256 $mutatedHash)"
        [IO.File]::WriteAllBytes($sourcePath, $originalBytes)
    }
} finally {
    [IO.File]::WriteAllBytes($sourcePath, $originalBytes)
}

$restoredHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
if ($restoredHash -ne $originalHash) {
    throw 'Mutation runner failed to restore the exact original source.'
}
if ($killed -ne $mutants.Count) {
    throw "Mutation score was $killed/$($mutants.Count)."
}

Write-Host "Manual mutation: $killed/$($mutants.Count) killed; exact source restored."
