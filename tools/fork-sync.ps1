<#
.SYNOPSIS
  Fork: brings the newest NeonPlan 3D release from Mastershort into this fork, checks it and publishes it for HACS.

.DESCRIPTION
  Run from PowerShell in the repository (any folder works, the script finds the repository itself):

    .\tools\fork-sync.ps1                 merge upstream's latest release, check, commit, push and publish
    .\tools\fork-sync.ps1 -DryRun         the same on a throwaway branch: nothing is kept, pushed or published
    .\tools\fork-sync.ps1 -NoRelease      merge and check, commit on 'unlocked' - but do not push or publish
    .\tools\fork-sync.ps1 -Tag v4.0.1     a particular upstream release instead of the latest
    .\tools\fork-sync.ps1 -ReleaseOnly    no merge: check the fork as it is and publish it (after own changes)

  Steps: upstream's release tag is merged into the 'unlocked' branch on a work branch. Conflicts in the built bundles
  are expected and solved by rebuilding them; any other conflict stops the run (nothing is changed) and lists the
  files. Then, inside WSL (tools/fork-sync-wsl.sh): npm ci, typecheck, frontend tests, build with the size budgets,
  Python tests and ruff - the same checks as upstream's CI. Only when all of them pass is the rebuild committed,
  'unlocked' pushed to the fork and a release v<version>.<1000+n> (e.g. v4.0.0.1011) published with neonplan3d.zip, which HACS
  installs. Last, the release is downloaded the way HACS does.

  Needs: git and the GitHub CLI (gh, signed in) on Windows, WSL with Ubuntu. Node 24 and Python 3.13 are installed
  into WSL's home folder on the first run (no sudo).
#>
[CmdletBinding()]
param(
  [string]$Tag,
  [switch]$DryRun,
  [switch]$NoRelease,
  [switch]$ReleaseOnly
)

$ErrorActionPreference = 'Stop'
$Upstream = 'Mastershort/neonplan3d'
$Branch = 'unlocked'
# built files: a conflict in them is solved by building them again
$Generated = @('custom_components/neonplan3d/frontend/', 'site/import/')

function Write-Step([string]$Text) { Write-Host "`n== $Text" -ForegroundColor Cyan }
function Stop-Sync([string]$Text, [int]$Code = 1) { Write-Host "`nSTOPPED: $Text" -ForegroundColor Red; exit $Code }

function Invoke-Git {
  & git @args
  if ($LASTEXITCODE -ne 0) { Stop-Sync "git $($args -join ' ') failed" }
}

function Invoke-Silent {
  # a native command whose output does not matter: in Windows PowerShell 5.1 a redirected stderr line would turn
  # into a terminating error under ErrorActionPreference 'Stop', so it is relaxed for this call only
  $ErrorActionPreference = 'Continue'
  $cmd, $rest = $args
  & $cmd @rest *> $null
}

function Get-GitText {
  $out = & git @args
  if ($LASTEXITCODE -ne 0) { Stop-Sync "git $($args -join ' ') failed" }
  return ($out | Out-String).Trim()
}

function Invoke-Wsl([string]$Command, [string[]]$Arguments) {
  & wsl -e bash "$WslRepo/tools/fork-sync-wsl.sh" $Command @Arguments
  return ($LASTEXITCODE -eq 0)
}

$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Repo

# --- preconditions ----------------------------------------------------------------------------------------------
Write-Step 'Checking the repository'
if ((Get-GitText rev-parse --abbrev-ref HEAD) -ne $Branch) { Stop-Sync "switch to the '$Branch' branch first (git switch $Branch)" }
if (Get-GitText status --porcelain) { Stop-Sync 'there are uncommitted changes - commit or stash them first' }
$remotes = (Get-GitText remote) -split "`r?`n"
if ($remotes -notcontains 'origin' -or $remotes -notcontains 'fork') { Stop-Sync "needs the remotes 'origin' ($Upstream) and 'fork' (your fork)" }
$forkUrl = Get-GitText remote get-url fork
if ($forkUrl -notmatch 'github\.com[:/](.+?)(\.git)?$') { Stop-Sync "cannot read the fork's name from $forkUrl" }
$Fork = $Matches[1]
Invoke-Silent gh auth status
if ($LASTEXITCODE -ne 0) { Stop-Sync 'the GitHub CLI is not signed in (gh auth login)' }
$WslRepo = (& wsl -e wslpath -a ($Repo -replace '\\', '/') | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $WslRepo) { Stop-Sync 'WSL is not available' }
Write-Host "Repository $Repo ($WslRepo in WSL), fork $Fork, upstream $Upstream"

Write-Step 'Node and Python tools in WSL'
if (-not (Invoke-Wsl 'setup' @())) { Stop-Sync 'could not install Node or uv in WSL' }

Write-Step 'Fetching'
Invoke-Git fetch --quiet --tags origin
Invoke-Git fetch --quiet fork
$behind = Get-GitText rev-list --count "HEAD..fork/$Branch"
if ([int]$behind -gt 0) { Stop-Sync "the fork on GitHub has $behind commit(s) this clone lacks - git pull fork $Branch first" }

$work = $null
$startHead = Get-GitText rev-parse HEAD

function Undo-Work {
  # back to where the run started: the work branch and everything this run changed are dropped
  if ($work) {
    Invoke-Silent git merge --abort
    Invoke-Silent git reset --hard --quiet
    Invoke-Silent git switch --quiet $Branch
    Invoke-Silent git branch -D $work
  } else {
    Invoke-Silent git reset --hard --quiet $startHead
  }
}

# --- merge ------------------------------------------------------------------------------------------------------
if (-not $ReleaseOnly) {
  if (-not $Tag) {
    $Tag = (& gh release view -R $Upstream --json tagName -q .tagName | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $Tag) { Stop-Sync "cannot find upstream's latest release" }
  }
  Invoke-Silent git rev-parse --verify --quiet "refs/tags/$Tag"
  if ($LASTEXITCODE -ne 0) { Stop-Sync "upstream has no tag $Tag" }
  & git merge-base --is-ancestor $Tag HEAD
  if ($LASTEXITCODE -eq 0) {
    Write-Host "`nAlready up to date: $Tag is in '$Branch'. (-ReleaseOnly publishes your own changes.)" -ForegroundColor Green
    exit 0
  }
  Write-Step "Merging upstream $Tag"
  $work = "fork-sync/$Tag"
  Invoke-Silent git branch -D $work
  Invoke-Git switch --quiet -c $work
  & git merge --no-ff --no-edit -m "Fork: merge upstream $Tag" $Tag
  if ($LASTEXITCODE -ne 0) {
    $conflicts = @((Get-GitText diff --name-only --diff-filter=U) -split "`r?`n" | Where-Object { $_ })
    $own = @($conflicts | Where-Object { $f = $_; -not ($Generated | Where-Object { $f.StartsWith($_) }) })
    if ($own.Count -gt 0) {
      Undo-Work
      Write-Host "`nThese files conflict between upstream $Tag and the fork's changes:" -ForegroundColor Yellow
      $own | ForEach-Object { Write-Host "  $_" }
      Stop-Sync "nothing was changed. Merge by hand (git merge $Tag on a branch) or ask Claude to resolve it." 2
    }
    # only built bundles: take upstream's for now, the build below replaces them
    foreach ($f in $conflicts) { Invoke-Git checkout --theirs -- $f; Invoke-Git add -- $f }
    Invoke-Git commit --quiet --no-edit
    Write-Host "Merged; $($conflicts.Count) built file(s) conflicted and will be rebuilt."
  }
}

# --- check ------------------------------------------------------------------------------------------------------
Write-Step 'Checking in WSL (npm ci, typecheck, tests, build, Python tests, ruff)'
if (-not (Invoke-Wsl 'check' @($WslRepo))) {
  Undo-Work
  Stop-Sync 'a check failed (see above). Nothing was kept. Ask Claude to look at the failure.'
}
Invoke-Git add -A -- $Generated
& git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  $what = if ($Tag -and -not $ReleaseOnly) { "for $Tag" } else { 'for the release' }
  Invoke-Git commit --quiet -m "Fork: rebuild the bundles $what"
}
$left = Get-GitText status --porcelain
if ($left) { Undo-Work; Stop-Sync "the check changed files it should not have:`n$left" }

if ($DryRun) {
  $summary = Get-GitText log --oneline "$startHead..HEAD"
  Undo-Work
  Write-Host "`nDry run passed. These commits would have been added to '$Branch':`n$summary" -ForegroundColor Green
  Write-Host 'Nothing was kept, pushed or published.'
  exit 0
}

if ($work) {
  Invoke-Git switch --quiet $Branch
  Invoke-Git merge --quiet --ff-only $work
  Invoke-Git branch --quiet -d $work
  $work = $null
}
if ($NoRelease) {
  Write-Host "`nDone: '$Branch' is updated and checked, but not pushed or published." -ForegroundColor Green
  exit 0
}

# --- publish ----------------------------------------------------------------------------------------------------
$version = (Get-Content -Raw (Join-Path $Repo 'custom_components/neonplan3d/manifest.json') | ConvertFrom-Json).version
$tags = @(& gh release list -R $Fork --limit 200 --json tagName -q '.[].tagName')
if ($LASTEXITCODE -ne 0) { Stop-Sync "cannot list the fork's releases" }
# Tags are v<version>.<1001...9999>: a fourth version part of fixed width. GitHub lists a repository's releases by day
# and then by tag name as text, and HACS takes the first one as the newest - "unlocked.10" sorted below
# "unlocked.9" and HACS never saw it. Four digits keep text order and number order the same; "." sorts above the old
# "-unlocked.<n>" tags, and AwesomeVersion (HACS) counts v4.0.0.1011 as newer than v4.0.0-unlocked.9.
$n = 0
foreach ($t in $tags) {
  if ($t -match "^v$([regex]::Escape($version))\.(\d{4})$") { $n = [Math]::Max($n, [int]$Matches[1] - 1000) }
  # the releases before the new numbering count on from where they ended
  elseif ($t -match "^v$([regex]::Escape($version))-unlocked\.(\d+)$") { $n = [Math]::Max($n, [int]$Matches[1]) }
}
if ($n + 1 -gt 8999) { Stop-Sync "release number $($n + 1) does not fit the four digits of the tag" }
$newTag = "v$version.$(1000 + $n + 1)"

Write-Step "Pushing '$Branch' to $Fork"
Invoke-Git push --quiet fork $Branch

Write-Step "Packing neonplan3d.zip"
$outDir = Join-Path $Repo '.fork-sync'
New-Item -ItemType Directory -Force $outDir | Out-Null
$exclude = Join-Path $Repo '.git/info/exclude'
if (-not (Select-String -Quiet -SimpleMatch '.fork-sync/' $exclude)) { Add-Content -Encoding ascii $exclude '.fork-sync/' }
$zip = Join-Path $outDir 'neonplan3d.zip'
if (-not (Invoke-Wsl 'zip' @($WslRepo, "$WslRepo/.fork-sync/neonplan3d.zip"))) { Stop-Sync 'could not pack the zip' }

Write-Step "Publishing $newTag"
$from = if ($ReleaseOnly) { "the fork's own changes" } else { "upstream's [$Tag](https://github.com/$Upstream/releases/tag/$Tag)" }
$notes = @"
NeonPlan 3D $version with $from, published by tools/fork-sync.ps1 after every check passed.

The fork's changes stay in: the built-in Pro add-ons without a pack, the generic prop, the temperature & humidity sensor and the Realistic style.
"@
& gh release create $newTag $zip -R $Fork --target $Branch --title "$version (unlocked $($n + 1))" --latest --notes $notes
if ($LASTEXITCODE -ne 0) { Stop-Sync 'could not publish the release (the branch is pushed; run again with -ReleaseOnly)' }

Write-Step 'Downloading the release the way HACS does'
if (-not (Invoke-Wsl 'hacs-check' @($Fork))) { Stop-Sync "the release is published, but HACS's download check failed" }

Write-Host "`nDone: $newTag is published. In Home Assistant: HACS -> NeonPlan 3D -> Update information, then download it." -ForegroundColor Green
