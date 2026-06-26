[CmdletBinding()]
param(
  [string]$ProjectDir = "",
  [string]$ExpectedOwner = "elysia2326",
  [string]$ExpectedRepo = "openhanako",
  [string]$DesktopLauncher = (Join-Path ([Environment]::GetFolderPath("Desktop")) "HanaAgent.exe"),
  [switch]$CheckRemote,
  [switch]$Json
)

$ErrorActionPreference = "SilentlyContinue"
$checks = New-Object System.Collections.Generic.List[object]
$scriptRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptRoot)) {
  $scriptRoot = Split-Path -Parent $PSCommandPath
}
if ([string]::IsNullOrWhiteSpace($ProjectDir)) {
  $ProjectDir = (Resolve-Path (Join-Path $scriptRoot "..")).Path
}

function Add-Check {
  param(
    [ValidateSet("PASS", "WARN", "FAIL", "INFO")]
    [string]$Status,
    [string]$Name,
    [string]$Details = ""
  )
  $checks.Add([pscustomobject]@{
    Status = $Status
    Name = $Name
    Details = $Details
  }) | Out-Null
}

function Get-FullPathOrNull {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
  try {
    return [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Path)).TrimEnd("\")
  } catch {
    return $null
  }
}

function Test-UnderPath {
  param([string]$Candidate, [string]$Root)
  $candidateFull = Get-FullPathOrNull $Candidate
  $rootFull = Get-FullPathOrNull $Root
  if (-not $candidateFull -or -not $rootFull) { return $false }
  $prefix = $rootFull + "\"
  return $candidateFull.Equals($rootFull, [StringComparison]::OrdinalIgnoreCase) -or
    $candidateFull.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Read-SimpleYaml {
  param([string]$Path)
  $map = @{}
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $map }
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ($line -match "^\s*#" -or [string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line -match "^\s*([^:#]+)\s*:\s*(.*?)\s*$") {
      $key = $matches[1].Trim()
      $value = $matches[2].Trim().Trim("'").Trim('"')
      $map[$key] = $value
    }
  }
  return $map
}

function Read-JsonFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  try {
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Get-ShortcutInfo {
  param([string]$Path)
  try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    return [pscustomobject]@{
      Path = $Path
      TargetPath = $shortcut.TargetPath
      WorkingDirectory = $shortcut.WorkingDirectory
    }
  } catch {
    return $null
  }
}

function Test-AsarFileContains {
  param([string]$ArchivePath, [string]$FilePath, [string[]]$Needles)
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  $asarModuleCandidates = @(
    (Join-Path $ProjectDir "node_modules\@electron\asar"),
    (Join-Path $ProjectDir "node_modules\asar")
  )
  $asarModule = $asarModuleCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Container } | Select-Object -First 1
  if (-not $node -or -not $asarModule -or -not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) { return $null }
  $checker = @'
const asar = require(process.argv[1]);
const archivePath = process.argv[2];
const filePath = process.argv[3];
const needles = process.argv.slice(4);
const content = asar.extractFile(archivePath, filePath);
const text = Buffer.isBuffer(content) ? content.toString() : String(content);
process.stdout.write(needles.map((needle) => text.includes(needle) ? '1' : '0').join('|'));
'@
  $output = & $node -e $checker $asarModule $ArchivePath $FilePath @Needles 2>$null
  if ($LASTEXITCODE -ne 0 -or $null -eq $output) { return $null }
  $flags = (($output -join "") -split "\|")
  if ($flags.Count -lt $Needles.Count) { return $null }
  for ($i = 0; $i -lt $Needles.Count; $i++) {
    if ($flags[$i] -ne "1") { return $false }
  }
  return $true
}

function Test-BinaryContainsUtf16Text {
  param([string]$Path, [string]$Needle)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  try {
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $needleBytes = [System.Text.Encoding]::Unicode.GetBytes($Needle)
    if ($needleBytes.Length -eq 0 -or $bytes.Length -lt $needleBytes.Length) { return $false }
    for ($i = 0; $i -le $bytes.Length - $needleBytes.Length; $i++) {
      $matched = $true
      for ($j = 0; $j -lt $needleBytes.Length; $j++) {
        if ($bytes[$i + $j] -ne $needleBytes[$j]) {
          $matched = $false
          break
        }
      }
      if ($matched) { return $true }
    }
    return $false
  } catch {
    return $null
  }
}

$projectFull = Get-FullPathOrNull $ProjectDir
$packagedExe = Join-Path $projectFull "dist\win-unpacked\HanaAgent.exe"
$updateYml = Join-Path $projectFull "dist\win-unpacked\resources\app-update.yml"
$packageJsonPath = Join-Path $projectFull "package.json"
$sourceUpdaterPath = Join-Path $projectFull "desktop\auto-updater.cjs"
$asarPath = Join-Path $projectFull "dist\win-unpacked\resources\app.asar"
$launcherMarker = "HANA_AGENT_LAUNCHER_PREFERS_INSTALLED_2026_06_26"

$oldInstallRoots = @(
  (Join-Path ${env:ProgramFiles} "HanaAgent"),
  (Join-Path ${env:ProgramFiles} "Hanako"),
  (Join-Path ${env:ProgramFiles(x86)} "HanaAgent"),
  (Join-Path ${env:ProgramFiles(x86)} "Hanako")
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

foreach ($oldRoot in $oldInstallRoots) {
  if (Test-Path -LiteralPath $oldRoot) {
    Add-Check FAIL "Old install directory" "$oldRoot still exists"
  }
}
if (-not ($checks | Where-Object { $_.Name -eq "Old install directory" -and $_.Status -eq "FAIL" })) {
  Add-Check PASS "Old install directory" "No HanaAgent/Hanako install tree under Program Files"
}

if (Test-Path -LiteralPath $packagedExe -PathType Leaf) {
  Add-Check PASS "Packaged app" $packagedExe
} else {
  Add-Check FAIL "Packaged app" "$packagedExe is missing"
}

$desktopCandidates = @(
  $DesktopLauncher,
  (Join-Path $env:USERPROFILE "Desktop\HanaAgent.exe")
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
$desktopExisting = $desktopCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if ($desktopExisting) {
  Add-Check PASS "Desktop launcher" $desktopExisting
  $launcherHasMarker = Test-BinaryContainsUtf16Text $desktopExisting $launcherMarker
  if ($null -eq $launcherHasMarker) {
    Add-Check WARN "Desktop launcher build" "Could not inspect launcher marker"
  } elseif ($launcherHasMarker) {
    Add-Check PASS "Desktop launcher build" "Prefers installed app before dev package"
  } else {
    Add-Check FAIL "Desktop launcher build" "Launcher is missing installed-app preference marker; rebuild C:\Users\23697\Desktop\HanaAgent.exe"
  }
} else {
  Add-Check FAIL "Desktop launcher" ("Missing expected launcher. Checked: " + ($desktopCandidates -join "; "))
}

$updateConfig = Read-SimpleYaml $updateYml
if ($updateConfig.Count -eq 0) {
  Add-Check FAIL "Packaged update config" "$updateYml is missing or unreadable"
} else {
  $provider = $updateConfig["provider"]
  $owner = $updateConfig["owner"]
  $repo = $updateConfig["repo"]
  if ($provider -eq "github" -and $owner -eq $ExpectedOwner -and $repo -eq $ExpectedRepo) {
    Add-Check PASS "Packaged update config" "github:$owner/$repo"
  } else {
    Add-Check FAIL "Packaged update config" "Expected github:$ExpectedOwner/$ExpectedRepo but found provider=$provider owner=$owner repo=$repo"
  }
}

$pkg = Read-JsonFile $packageJsonPath
if (-not $pkg) {
  Add-Check FAIL "Source package metadata" "$packageJsonPath is missing or invalid"
} else {
  $publish = @($pkg.build.publish) | Where-Object { $_.provider -eq "github" } | Select-Object -First 1
  if ($publish -and $publish.owner -eq $ExpectedOwner -and $publish.repo -eq $ExpectedRepo) {
    Add-Check PASS "Source publish config" "github:$($publish.owner)/$($publish.repo)"
  } else {
    Add-Check FAIL "Source publish config" "Expected github:$ExpectedOwner/$ExpectedRepo"
  }
  if ($pkg.build.appId -eq "com.hanako.app" -and $pkg.build.productName -eq "HanaAgent") {
    Add-Check PASS "App identity" "appId=$($pkg.build.appId), productName=$($pkg.build.productName), version=$($pkg.version)"
  } else {
    Add-Check WARN "App identity" "Unexpected appId/productName can create parallel installs"
  }
}

if (Test-Path -LiteralPath $sourceUpdaterPath -PathType Leaf) {
  $sourceUpdater = Get-Content -LiteralPath $sourceUpdaterPath -Raw -Encoding UTF8
  if ($sourceUpdater -match [regex]::Escape($ExpectedOwner) -and $sourceUpdater -match [regex]::Escape($ExpectedRepo)) {
    Add-Check PASS "Source updater feed" "Default feed points to github:$ExpectedOwner/$ExpectedRepo"
  } else {
    Add-Check FAIL "Source updater feed" "Source updater does not mention github:$ExpectedOwner/$ExpectedRepo"
  }
} else {
  Add-Check FAIL "Source updater feed" "$sourceUpdaterPath is missing"
}

$packedUpdaterHasFeed = Test-AsarFileContains $asarPath "desktop/main.bundle.cjs" @($ExpectedOwner, $ExpectedRepo)
if ($null -ne $packedUpdaterHasFeed) {
  if ($packedUpdaterHasFeed) {
    Add-Check PASS "Packaged updater feed" "Runtime app.asar points to github:$ExpectedOwner/$ExpectedRepo"
  } else {
    Add-Check FAIL "Packaged updater feed" "Runtime app.asar still points somewhere else; rebuild the packaged app"
  }
} else {
  Add-Check WARN "Packaged updater feed" "Could not inspect desktop/main.bundle.cjs inside app.asar"
}

$shortcutRoots = @(
  [Environment]::GetFolderPath("Desktop"),
  [Environment]::GetFolderPath("CommonDesktopDirectory"),
  [Environment]::GetFolderPath("StartMenu"),
  [Environment]::GetFolderPath("CommonStartMenu")
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -Unique

$staleShortcuts = @()
$unknownShortcuts = @()
foreach ($root in $shortcutRoots) {
  foreach ($lnk in Get-ChildItem -LiteralPath $root -Recurse -Filter "*.lnk" -File -ErrorAction SilentlyContinue) {
    if ($lnk.Name -notmatch "(?i)hana|hanako|openhanako") { continue }
    $info = Get-ShortcutInfo $lnk.FullName
    if (-not $info) { continue }
    $touchesOld = $false
    foreach ($oldRoot in $oldInstallRoots) {
      if ((Test-UnderPath $info.TargetPath $oldRoot) -or (Test-UnderPath $info.WorkingDirectory $oldRoot)) {
        $touchesOld = $true
      }
    }
    if ($touchesOld) {
      $staleShortcuts += "$($info.Path) -> $($info.TargetPath)"
    } elseif (-not ((Test-UnderPath $info.TargetPath $projectFull) -or ($desktopExisting -and (Get-FullPathOrNull $info.TargetPath) -eq (Get-FullPathOrNull $desktopExisting)))) {
      $unknownShortcuts += "$($info.Path) -> $($info.TargetPath)"
    }
  }
}
if ($staleShortcuts.Count -gt 0) {
  Add-Check FAIL "Stale shortcuts" ($staleShortcuts -join "; ")
} else {
  Add-Check PASS "Stale shortcuts" "No Hana shortcut points to Program Files"
}
if ($unknownShortcuts.Count -gt 0) {
  Add-Check WARN "Other Hana shortcuts" ($unknownShortcuts -join "; ")
}

$uninstallRoots = @(
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)
$oldUninstallEntries = @()
$otherUninstallEntries = @()
foreach ($root in $uninstallRoots) {
  foreach ($entry in Get-ItemProperty $root -ErrorAction SilentlyContinue) {
    $name = [string]$entry.DisplayName
    $installLocation = [string]$entry.InstallLocation
    $uninstallString = [string]$entry.UninstallString
    if (($name -notmatch "(?i)hana|hanako|openhanako") -and ($installLocation -notmatch "(?i)hana|hanako|openhanako") -and ($uninstallString -notmatch "(?i)hana|hanako|openhanako")) {
      continue
    }
    $touchesOld = $false
    foreach ($oldRoot in $oldInstallRoots) {
      if ((Test-UnderPath $installLocation $oldRoot) -or ($uninstallString -like "*$oldRoot*")) {
        $touchesOld = $true
      }
    }
    $label = "$name version=$($entry.DisplayVersion) location=$installLocation"
    if ($touchesOld) {
      $oldUninstallEntries += $label
    } elseif ($installLocation -and -not (Test-UnderPath $installLocation $projectFull)) {
      $otherUninstallEntries += $label
    }
  }
}
if ($oldUninstallEntries.Count -gt 0) {
  Add-Check FAIL "Old uninstall entries" ($oldUninstallEntries -join "; ")
} else {
  Add-Check PASS "Old uninstall entries" "No Program Files Hana uninstall entry found"
}
if ($otherUninstallEntries.Count -gt 0) {
  Add-Check WARN "Other uninstall entries" ($otherUninstallEntries -join "; ")
}

$running = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "^(HanaAgent|Hanako|hana-server)\.exe$" })
$oldProcesses = @()
$otherProcesses = @()
foreach ($proc in $running) {
  $path = [string]$proc.ExecutablePath
  $isOld = $false
  foreach ($oldRoot in $oldInstallRoots) {
    if (Test-UnderPath $path $oldRoot) { $isOld = $true }
  }
  if ($isOld) {
    $oldProcesses += "$($proc.Name) pid=$($proc.ProcessId) path=$path"
  } elseif ($path -and -not (Test-UnderPath $path $projectFull)) {
    $otherProcesses += "$($proc.Name) pid=$($proc.ProcessId) path=$path"
  }
}
if ($oldProcesses.Count -gt 0) {
  Add-Check FAIL "Old running processes" ($oldProcesses -join "; ")
} else {
  Add-Check PASS "Old running processes" "No running Hana process from Program Files"
}
if ($otherProcesses.Count -gt 0) {
  Add-Check WARN "Other running processes" ($otherProcesses -join "; ")
}

if ($CheckRemote) {
  $headers = @{ "User-Agent" = "hana-update-health" }
  $releaseUrl = "https://api.github.com/repos/$ExpectedOwner/$ExpectedRepo/releases/latest"
  try {
    $release = Invoke-RestMethod -Uri $releaseUrl -Headers $headers -TimeoutSec 15
    $assetNames = @($release.assets | ForEach-Object { $_.name })
    $hasLatestYml = $assetNames | Where-Object { $_ -eq "latest.yml" }
    $hasWindowsInstaller = $assetNames | Where-Object { $_ -match "^HanaAgent-.*-Windows-.*\.exe$" }
    if ($hasLatestYml -and $hasWindowsInstaller) {
      Add-Check PASS "Remote update release" "$($release.tag_name): $($assetNames -join ', ')"
    } else {
      Add-Check FAIL "Remote update release" "$($release.tag_name) is missing latest.yml or Windows installer asset"
    }
  } catch {
    Add-Check WARN "Remote update release" "No readable latest release at $releaseUrl"
  }
}

$failCount = @($checks | Where-Object { $_.Status -eq "FAIL" }).Count
$warnCount = @($checks | Where-Object { $_.Status -eq "WARN" }).Count
$passCount = @($checks | Where-Object { $_.Status -eq "PASS" }).Count

if ($Json) {
  [pscustomobject]@{
    projectDir = $projectFull
    expectedFeed = "github:$ExpectedOwner/$ExpectedRepo"
    summary = [pscustomobject]@{
      pass = $passCount
      warn = $warnCount
      fail = $failCount
    }
    checks = $checks
  } | ConvertTo-Json -Depth 5
} else {
  $checks | Sort-Object @{ Expression = {
      switch ($_.Status) {
        "FAIL" { 0 }
        "WARN" { 1 }
        "PASS" { 2 }
        default { 3 }
      }
    } }, Name | Format-Table Status, Name, Details -Wrap
  Write-Host ""
  Write-Host "Summary: PASS=$passCount WARN=$warnCount FAIL=$failCount"
}

if ($failCount -gt 0) { exit 1 }
exit 0
