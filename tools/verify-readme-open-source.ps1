[CmdletBinding()]
param(
    [switch]$NegativeControl
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:Failures = [System.Collections.Generic.List[string]]::new()
$script:Passes = [System.Collections.Generic.List[string]]::new()

function Read-RequiredFile {
    param([Parameter(Mandatory)][string]$RelativePath)

    $path = Join-Path $repoRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $script:Failures.Add("missing required file: $RelativePath")
        return ''
    }
    return Get-Content -Raw -Encoding UTF8 -LiteralPath $path
}

function Assert-Match {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Text,
        [Parameter(Mandatory)][string]$Pattern
    )

    if ($Text -match $Pattern) {
        $script:Passes.Add($Name)
    } else {
        $script:Failures.Add("$Name (pattern not found: $Pattern)")
    }
}

function Assert-NoMatch {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Text,
        [Parameter(Mandatory)][string]$Pattern
    )

    if ($Text -notmatch $Pattern) {
        $script:Passes.Add($Name)
    } else {
        $script:Failures.Add("$Name (forbidden pattern found: $Pattern)")
    }
}

function Assert-Equal {
    param(
        [Parameter(Mandatory)][string]$Name,
        [AllowNull()]$Actual,
        [AllowNull()]$Expected
    )

    if ($Actual -ceq $Expected) {
        $script:Passes.Add($Name)
    } else {
        $script:Failures.Add("$Name (expected '$Expected', got '$Actual')")
    }
}

$readmeVi = Read-RequiredFile 'README.md'
$readmeEn = Read-RequiredFile 'README.en.md'
$license = Read-RequiredFile 'LICENSE'
$agents = Read-RequiredFile 'AGENTS.md'
$runbook = Read-RequiredFile 'docs/CODEBASE_MEMORY.md'
$cbmIgnore = Read-RequiredFile '.cbmignore'
$artifactRaw = Read-RequiredFile '.codebase-memory/artifact.json'

if ($NegativeControl) {
    # Deliberately inject one forbidden implementation section into the in-memory input.
    # The same production checks below must reject it without touching repository files.
    $readmeVi += @'

## Runtime architecture

```powershell
npm run dev
```
'@
}

Assert-Match 'B1 Vietnamese hero identifies MarketLens' $readmeVi '(?m)^# .*MarketLens'
Assert-Match 'B1 Vietnamese live product link' $readmeVi 'https://tradingterminal\.io\.vn'
Assert-Match 'B1 Vietnamese journey includes observation' $readmeVi '(?i)quan s.t'
Assert-Match 'B1 Vietnamese journey includes replay' $readmeVi '(?i)replay'
Assert-Match 'B1 Vietnamese journey includes MT5' $readmeVi '(?i)MT5'
Assert-Match 'B1 Vietnamese journey includes alerts' $readmeVi '(?i)c.nh b.o|alerts?'
Assert-Match 'B1 Vietnamese journey includes journal' $readmeVi '(?i)nh.t k.|journal'
Assert-Match 'B1 Vietnamese journey includes analytics' $readmeVi '(?i)ph.n t.ch|analytics'
Assert-Match 'B1 Vietnamese experience includes desktop/mobile' $readmeVi '(?is)desktop.*mobile|mobile.*desktop'
Assert-Match 'B1 Vietnamese links English README' $readmeVi '\(README\.en\.md\)'
Assert-Match 'B1 Vietnamese links MIT license' $readmeVi '\(LICENSE\)'

Assert-Match 'B2 English hero identifies MarketLens' $readmeEn '(?m)^# .*MarketLens'
Assert-Match 'B2 English live product link' $readmeEn 'https://tradingterminal\.io\.vn'
Assert-Match 'B2 English journey includes replay' $readmeEn '(?i)replay'
Assert-Match 'B2 English journey includes MT5' $readmeEn '(?i)MT5'
Assert-Match 'B2 English journey includes alerts' $readmeEn '(?i)alerts?'
Assert-Match 'B2 English journey includes journal' $readmeEn '(?i)journal'
Assert-Match 'B2 English journey includes analytics' $readmeEn '(?i)analytics'
Assert-Match 'B2 English experience includes desktop/mobile' $readmeEn '(?is)desktop.*mobile|mobile.*desktop'
Assert-Match 'B2 English links Vietnamese README' $readmeEn '\(README\.md\)'
Assert-Match 'B2 English links MIT license' $readmeEn '\(LICENSE\)'

$readmeForbidden = '(?im)^##\s+(Ki.n tr.c|Ph.t tri.n|Production|Ki.m tra|B. nh. codebase|Runtime architecture|Development|Core checks|Agent codebase memory)|```|(?<![\w.-])(frontend/|backend/|Cargo\.toml|run-backend-production\.ps1)|Next\.js|React\s*19|\bRust\b'
Assert-NoMatch 'B1 README contains no architecture/code/setup content' $readmeVi $readmeForbidden
Assert-NoMatch 'B2 English README contains no architecture/code/setup content' $readmeEn $readmeForbidden

$financialClaims = '(?i)guaranteed profit|risk[- ]free|broker[- ]endorsed|b.o .{0,8}l.i nhu.n|kh.ng c. r.i ro'
Assert-NoMatch 'Vietnamese README makes no prohibited financial claim' $readmeVi $financialClaims
Assert-NoMatch 'English README makes no prohibited financial claim' $readmeEn $financialClaims

Assert-Match 'B3 canonical MIT title' $license '(?m)^MIT License$'
Assert-Match 'B3 MIT copyright holder' $license '(?m)^Copyright \(c\) 2026 DEVfancybear$'
Assert-Match 'B3 MIT permission grant' $license 'Permission is hereby granted, free of charge'
Assert-Match 'B3 MIT warranty disclaimer' $license 'THE SOFTWARE IS PROVIDED "AS IS"'

Assert-NoMatch 'B4 Playwright policy remains removed' $agents '(?i)playwright-automation|Mandatory Playwright'
Assert-Match 'B4 codebase-memory gate remains' $agents '(?m)^## Mandatory codebase-memory startup\r?$'
Assert-Match 'B4 old-coder workflow remains' $agents '(?m)^## Mandatory old-coder evidence-first workflow\r?$'

Assert-Match 'B5 runbook records v0.10.8' $runbook '(?i)v?0\.10\.8'
Assert-Match 'B5 runbook documents doctor' $runbook 'codebase-memory-mcp doctor'
Assert-Match 'B5 runbook documents list_projects' $runbook 'list_projects'
Assert-Match 'B5 runbook documents index_status' $runbook 'index_status'
Assert-Match 'B5 runbook documents CLI fallback' $runbook '(?i)CLI fallback|fallback.*CLI|CLI.*fallback'
Assert-Match 'B5 runbook documents transport recovery' $runbook '(?i)transport closed|MCP transport|MCP bridge'
Assert-Match 'B5 runbook documents agent restart' $runbook '(?i)restart.*(Codex|coding agent)|(Codex|coding agent).*restart'
Assert-Match 'B5 runbook documents .cbmignore' $runbook '\.cbmignore'
Assert-NoMatch 'B5 runbook does not prescribe early cache deletion' $runbook '(?i)(first|step\s*1|start by).{0,80}(delete|remove).{0,40}(cache|\.cache)'

foreach ($pattern in @('/.artifacts/', '/.tmp-tencentdb-agent-memory/', '/backend/.artifacts/')) {
    Assert-Match "B5 .cbmignore contains $pattern" $cbmIgnore ([regex]::Escape($pattern))
}

if ($artifactRaw) {
    try {
        $artifact = $artifactRaw | ConvertFrom-Json
        if ([int64]$artifact.nodes -gt 0) {
            $script:Passes.Add('B5 graph artifact has nodes')
        } else {
            $script:Failures.Add('B5 graph artifact has nodes (expected > 0)')
        }
        if ([int64]$artifact.edges -gt 0) {
            $script:Passes.Add('B5 graph artifact has edges')
        } else {
            $script:Failures.Add('B5 graph artifact has edges (expected > 0)')
        }
        $artifactCommit = ([string]$artifact.commit).Trim()
        & git -C $repoRoot cat-file -e "$artifactCommit`^{commit}" 2>$null
        if ($LASTEXITCODE -ne 0) {
            $script:Failures.Add('B5 graph artifact references an existing source commit')
        } else {
            & git -C $repoRoot merge-base --is-ancestor $artifactCommit HEAD
            if ($LASTEXITCODE -eq 0) {
                $script:Passes.Add('B5 graph artifact source commit is an ancestor of HEAD')
            } else {
                $script:Failures.Add('B5 graph artifact source commit is an ancestor of HEAD')
            }
        }
    } catch {
        $script:Failures.Add("B5 graph artifact is valid JSON ($($_.Exception.Message))")
    }
}

Write-Host "README/open-source verification: $($script:Passes.Count) passed, $($script:Failures.Count) failed"
foreach ($failure in $script:Failures) {
    Write-Host "FAIL: $failure" -ForegroundColor Red
}

if ($script:Failures.Count -gt 0) {
    exit 1
}

Write-Host 'PASS: README, MIT license, agent policy, and codebase-memory documentation satisfy the approved SPEC.' -ForegroundColor Green
exit 0
