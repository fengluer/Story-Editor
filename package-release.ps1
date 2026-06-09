param(
  [ValidateSet("installer", "portable")]
  [string]$Target = ""
)

$ErrorActionPreference = "Stop"

function Resolve-Target {
  param([string]$SelectedTarget)

  if ($SelectedTarget) {
    return $SelectedTarget
  }

  Write-Host ""
  Write-Host "Story Editor release package"
  Write-Host "1) Installer"
  Write-Host "2) Portable"
  Write-Host ""

  $choice = Read-Host "Choose package type [1/2]"
  switch ($choice) {
    "1" { return "installer" }
    "2" { return "portable" }
    default { throw "Invalid package type: $choice" }
  }
}

function Assert-Command {
  param([string]$CommandName)

  $command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "$CommandName was not found. Please install Node.js first."
  }
}

function Invoke-Step {
  param(
    [string]$Title,
    [scriptblock]$Step
  )

  Write-Host ""
  Write-Host "==> $Title"
  & $Step
}

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$targetType = Resolve-Target $Target
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$releaseDir = Join-Path $projectRoot "release"
$tempOutput = Join-Path $env:TEMP "story-editor-$targetType-$stamp"
$builder = Join-Path $projectRoot "node_modules\.bin\electron-builder.cmd"

Assert-Command "npm"

if (-not (Test-Path -LiteralPath "node_modules")) {
  Invoke-Step "Install dependencies" {
    npm install
  }
}

if (-not (Test-Path -LiteralPath $builder)) {
  throw "electron-builder was not found. Run npm install first."
}

New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

Invoke-Step "Build renderer" {
  npm run build
}

if ($targetType -eq "portable") {
  Invoke-Step "Package portable app" {
    & $builder --dir "--config.directories.output=$tempOutput"
  }

  $source = Join-Path $tempOutput "win-unpacked"
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Portable output was not created: $source"
  }

  $zipPath = Join-Path $releaseDir "Story-Editor-portable-$stamp.zip"
  Invoke-Step "Create release zip" {
    Compress-Archive -Path $source -DestinationPath $zipPath
  }
} else {
  Invoke-Step "Package installer" {
    & $builder --win "--config.directories.output=$tempOutput"
  }

  $installer = Get-ChildItem -LiteralPath $tempOutput -Filter "*.exe" -File |
    Sort-Object Length -Descending |
    Select-Object -First 1

  if (-not $installer) {
    throw "Installer output was not created in: $tempOutput"
  }

  $zipPath = Join-Path $releaseDir "Story-Editor-installer-$stamp.zip"
  Invoke-Step "Create release zip" {
    Compress-Archive -Path $installer.FullName -DestinationPath $zipPath
  }
}

$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath

Write-Host ""
Write-Host "Release package created:"
Write-Host $zipPath
Write-Host "SHA256:"
Write-Host $hash.Hash
Write-Host ""
