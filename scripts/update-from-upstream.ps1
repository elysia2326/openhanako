[CmdletBinding()]
param(
  [string]$UpstreamRemote = "upstream",
  [string]$UpstreamUrl = "https://github.com/liliMozi/openhanako.git",
  [string]$Branch = "main",
  [string]$ExpectedOwner = "elysia2326",
  [string]$ExpectedRepo = "openhanako",
  [switch]$SkipMerge,
  [switch]$SkipVerify,
  [switch]$AllowDirty
)

$ErrorActionPreference = "Stop"
$scriptRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptRoot)) {
  $scriptRoot = Split-Path -Parent $PSCommandPath
}
$projectDir = (Resolve-Path (Join-Path $scriptRoot "..")).Path
Set-Location $projectDir

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  & git @Args
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Args -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Assert-CleanWorktree {
  $status = & git status --porcelain
  if ($LASTEXITCODE -ne 0) {
    throw "git status failed"
  }
  if (-not $AllowDirty -and $status) {
    throw "Working tree is dirty. Commit or stash local changes before syncing upstream, or pass -AllowDirty if you know what you are doing."
  }
}

function Ensure-Remote {
  $remoteNames = & git remote
  if ($LASTEXITCODE -ne 0) {
    throw "git remote failed"
  }

  if ($remoteNames -contains $UpstreamRemote) {
    Invoke-Git remote set-url $UpstreamRemote $UpstreamUrl
  } else {
    Invoke-Git remote add $UpstreamRemote $UpstreamUrl
  }
  Invoke-Git remote set-url --push $UpstreamRemote DISABLED
}

function Assert-TextContains {
  param([string]$Path, [string[]]$Needles)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Required file is missing: $Path"
  }

  $text = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  foreach ($needle in $Needles) {
    if (-not $text.Contains($needle)) {
      throw "Fork invariant failed: $Path does not contain '$needle'"
    }
  }
}

function Assert-ForkUpdateInvariants {
  Assert-TextContains (Join-Path $projectDir "desktop\auto-updater.cjs") @($ExpectedOwner, $ExpectedRepo)
  Assert-TextContains (Join-Path $projectDir "scripts\fix-modules.cjs") @($ExpectedOwner, $ExpectedRepo, "app-update.yml")
  Assert-TextContains (Join-Path $projectDir "package.json") @($ExpectedOwner, $ExpectedRepo, "check:update-health")
}

Assert-CleanWorktree
Ensure-Remote

$currentBranch = (& git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($currentBranch)) {
  throw "Could not determine current branch"
}
if ($currentBranch -ne $Branch) {
  throw "Current branch is '$currentBranch'. Switch to '$Branch' before syncing upstream."
}

Invoke-Git fetch origin
Invoke-Git fetch $UpstreamRemote

if ($SkipMerge) {
  Write-Host "SkipMerge set; fetched remotes and checked fork invariants without creating a backup branch."
} else {
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupBranch = "backup/pre-upstream-sync-$timestamp"
  Invoke-Git branch $backupBranch HEAD
  Write-Host "Created backup branch: $backupBranch"
  Invoke-Git merge "$UpstreamRemote/$Branch" --no-edit
}

Assert-ForkUpdateInvariants

if (-not $SkipVerify) {
  & npm run check:update-health
  if ($LASTEXITCODE -ne 0) {
    throw "npm run check:update-health failed"
  }
}

Write-Host "Upstream sync finished. Review the diff, run full tests if needed, then build and publish a fork release."
