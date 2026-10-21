$ErrorActionPreference = 'Stop'
$RepoUrl = 'https://github.com/aekpubg1/pole-survey-app-copy-pages.git'

Write-Host 'Deploy Pole Survey app to GitHub Pages' -ForegroundColor Cyan
Write-Host ('Current folder: ' + (Get-Location).Path)

$required = @('index.html', 'config.js', 'leaflet-compat.js', 'offline-bridge.js', 'service-worker.js', 'manifest.webmanifest')
foreach ($file in $required) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Missing file: $file. Open PowerShell in the folder that contains index.html."
    }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git was not found. Install Git for Windows from https://git-scm.com/download/win, then reopen PowerShell.'
}

git --version
if ($LASTEXITCODE -ne 0) { throw 'Could not run Git.' }

$userName = (git config user.name 2>$null)
if (-not $userName) {
    $userName = Read-Host 'Enter the name to use for the Git commit (for example, aekpubg1)'
    if (-not $userName) { throw 'A Git username is required.' }
    git config user.name $userName
}
$userEmail = (git config user.email 2>$null)
if (-not $userEmail) {
    $userEmail = Read-Host 'Enter the email address to use for the Git commit'
    if (-not $userEmail) { throw 'A Git email address is required.' }
    git config user.email $userEmail
}

if (-not (Test-Path -LiteralPath '.git' -PathType Container)) {
    git init -b main
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the Git repository in this folder.' }
}

$currentBranch = (git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not determine the current Git branch.' }
if ($currentBranch -ne 'main') {
    git branch -M main
    if ($LASTEXITCODE -ne 0) { throw 'Could not rename the branch to main.' }
}

git add --all
if ($LASTEXITCODE -ne 0) { throw 'Could not stage files in Git.' }
git diff --cached --quiet
if ($LASTEXITCODE -eq 1) {
    git commit -m 'Deploy pole survey app with OpenStreetMap'
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the Git commit.' }
} elseif ($LASTEXITCODE -gt 1) {
    throw 'Could not check staged changes in Git.'
}

$remoteUrl = (git remote get-url origin 2>$null)
$remoteExitCode = $LASTEXITCODE
if ($remoteExitCode -ne 0 -or -not $remoteUrl) {
    git remote add origin $RepoUrl
    if ($LASTEXITCODE -ne 0) { throw 'Could not add the origin remote.' }
} elseif ($remoteUrl.TrimEnd('/') -ne $RepoUrl.TrimEnd('/')) {
    throw "The existing origin remote is '$remoteUrl', not '$RepoUrl'. Stopped to avoid pushing to the wrong repository."
}

Write-Host ''
Write-Host 'Pushing files to GitHub...' -ForegroundColor Cyan
git push -u origin main
if ($LASTEXITCODE -ne 0) {
    throw 'Push failed. Confirm that repository aekpubg1/pole-survey-app-copy-pages exists and that you are signed in to GitHub with an account that has write access. If Git reports a non-fast-forward error, send that error for the next step.'
}

Write-Host ''
Write-Host 'Files were pushed to GitHub successfully.' -ForegroundColor Green
Write-Host 'Next: open repository Settings > Pages > Build and deployment.'
Write-Host 'Set Source to Deploy from a branch, Branch to main, Folder to /(root), then click Save.'
Write-Host 'Expected site URL after Pages finishes publishing: https://aekpubg1.github.io/pole-survey-app-copy-pages/' -ForegroundColor Yellow
