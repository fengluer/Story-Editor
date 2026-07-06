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

function Invoke-NativeStep {
  param(
    [string]$Title,
    [scriptblock]$Step
  )

  Write-Host ""
  Write-Host "==> $Title"
  $global:LASTEXITCODE = 0
  & $Step
  $exitCode = $global:LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "$Title failed with exit code $exitCode"
  }
}

function Invoke-BuilderStep {
  param(
    [string]$Title,
    [string]$OutputBase,
    [scriptblock]$BuildStep
  )

  $maxAttempts = 3
  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    $attemptOutput = if ($attempt -eq 1) { $OutputBase } else { "$OutputBase-retry$attempt" }

    try {
      Write-Host ""
      Write-Host "==> $Title (attempt $attempt of $maxAttempts)"
      $global:LASTEXITCODE = 0
      & $BuildStep $attemptOutput | Out-Host
      $exitCode = $global:LASTEXITCODE
      if ($exitCode -ne 0) {
        throw "$Title (attempt $attempt of $maxAttempts) failed with exit code $exitCode"
      }
      return $attemptOutput
    } catch {
      if ($attempt -ge $maxAttempts) {
        throw
      }

      Write-Warning "$Title failed. Retrying in 3 seconds. Last error: $($_.Exception.Message)"
      Start-Sleep -Seconds 3
    }
  }
}

function Get-Sha256Hash {
  param([string]$Path)

  $stream = [System.IO.File]::OpenRead((Resolve-Path -LiteralPath $Path))
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($sha256.ComputeHash($stream)) -replace "-", "")
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$targetType = Resolve-Target $Target
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$releaseDir = Join-Path $projectRoot "release"
$tempOutputBase = Join-Path $env:TEMP "story-editor-$targetType-$stamp"
$builder = Join-Path $projectRoot "node_modules\.bin\electron-builder.cmd"
$electronDist = Join-Path $projectRoot "node_modules\electron\dist"

Assert-Command "npm"

if (-not (Test-Path -LiteralPath "node_modules")) {
  Invoke-NativeStep "Install dependencies" {
    npm install
  }
}

if (-not (Test-Path -LiteralPath $builder)) {
  throw "electron-builder was not found. Run npm install first."
}

if (-not (Test-Path -LiteralPath (Join-Path $electronDist "electron.exe"))) {
  throw "Electron runtime was not found in node_modules. Run npm install first."
}

New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

Invoke-NativeStep "Build renderer" {
  npm run build
}

if ($targetType -eq "portable") {
  $packageOutput = Invoke-BuilderStep "Package portable app" $tempOutputBase {
    param([string]$OutputPath)
    & $builder --dir "--config.directories.output=$OutputPath" "--config.electronDist=$electronDist" --publish never
  }

  $source = Join-Path $packageOutput "win-unpacked"
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Portable output was not created: $source"
  }

  $artifactPath = Join-Path $releaseDir "Story-Editor-portable-$stamp.zip"
  Invoke-Step "Create release zip" {
    Compress-Archive -Path $source -DestinationPath $artifactPath
  }
  $latestArtifactPath = Join-Path $releaseDir "Story-Editor-portable-latest.zip"
} else {
  $packageOutput = Invoke-BuilderStep "Package installer" $tempOutputBase {
    param([string]$OutputPath)
    & $builder --win "--config.directories.output=$OutputPath" "--config.electronDist=$electronDist" --publish never
  }

  $installer = Get-ChildItem -LiteralPath $packageOutput -Filter "*.exe" -File |
    Sort-Object Length -Descending |
    Select-Object -First 1

  if (-not $installer) {
    throw "Installer output was not created in: $packageOutput"
  }

  $artifactPath = Join-Path $releaseDir "Story-Editor-installer-$stamp.exe"
  Invoke-Step "Copy installer" {
    Copy-Item -LiteralPath $installer.FullName -Destination $artifactPath -Force
  }
  $latestArtifactPath = Join-Path $releaseDir "Story-Editor-installer-latest.exe"
}

Copy-Item -LiteralPath $artifactPath -Destination $latestArtifactPath -Force

$hash = Get-Sha256Hash $artifactPath
$latestHash = Get-Sha256Hash $latestArtifactPath

Write-Host ""
Write-Host "Release artifact created:"
Write-Host $artifactPath
Write-Host "SHA256:"
Write-Host $hash
Write-Host ""
Write-Host "Latest alias created:"
Write-Host $latestArtifactPath
Write-Host "SHA256:"
Write-Host $latestHash
Write-Host ""
