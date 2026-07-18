param(
  [switch]$ForceDownload
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$binRoot = Join-Path $repoRoot 'bin'
$repkgRoot = Join-Path $binRoot 'repkg'
$cacheRoot = Join-Path ([IO.Path]::GetTempPath()) 'MineradioBuildTools\1.5.6'

$ffmpegArchiveUrl = 'https://github.com/GyanD/codexffmpeg/releases/download/8.1.1/ffmpeg-8.1.1-full_build.zip'
$ffmpegArchiveSha256 = '49B28C5F16ADDD40239A66949973458769B7056FB7752C30AC0D53389D09A552'
$ffmpegExeSha256 = '09948D4CDD0650DA6FF5A87577469F2A218DC2615AE379F8F734D24C49DE0F73'
$repkgArchiveUrl = 'https://github.com/notscuffed/repkg/releases/download/v0.4.0-alpha/RePKG.zip'
$repkgArchiveSha256 = 'ABE653915793C86E6D65DC6B4FDA0563BB396EC2945D91CFD127FE8DDA6B684A'
$repkgExeSha256 = 'B5E0D603BAD5BE7C6605C31B96DDFB8BC2391658F777872A56F283AB2038ACF1'

function Get-Sha256([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '' }
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant()
}

function Assert-Hash([string]$Path, [string]$Expected, [string]$Label) {
  $actual = Get-Sha256 $Path
  if ($actual -ne $Expected) {
    throw "$Label SHA-256 mismatch. Expected $Expected, received $actual"
  }
}

function Get-VerifiedArchive([string]$Url, [string]$Destination, [string]$Expected, [string]$Label) {
  if (-not $ForceDownload -and (Get-Sha256 $Destination) -eq $Expected) { return }
  $partial = "$Destination.download"
  Invoke-WebRequest -Uri $Url -OutFile $partial -UseBasicParsing
  Assert-Hash $partial $Expected "$Label archive"
  Move-Item -LiteralPath $partial -Destination $Destination -Force
}

function Copy-VerifiedExecutable([string]$Source, [string]$Destination, [string]$Expected, [string]$Label) {
  Assert-Hash $Source $Expected $Label
  New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
  Assert-Hash $Destination $Expected $Label
}

New-Item -ItemType Directory -Path $binRoot, $repkgRoot, $cacheRoot -Force | Out-Null

$ffmpegDestination = Join-Path $binRoot 'ffmpeg.exe'
if ((Get-Sha256 $ffmpegDestination) -ne $ffmpegExeSha256) {
  $archive = Join-Path $cacheRoot 'ffmpeg-8.1.1-full_build.zip'
  $extract = Join-Path $cacheRoot 'ffmpeg-8.1.1-full_build'
  Get-VerifiedArchive $ffmpegArchiveUrl $archive $ffmpegArchiveSha256 'FFmpeg 8.1.1'
  New-Item -ItemType Directory -Path $extract -Force | Out-Null
  Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
  $candidate = Get-ChildItem -LiteralPath $extract -Filter 'ffmpeg.exe' -File -Recurse |
    Where-Object { $_.FullName -match '[\\/]bin[\\/]ffmpeg\.exe$' } |
    Select-Object -First 1
  if ($null -eq $candidate) { throw 'FFmpeg archive does not contain bin\ffmpeg.exe' }
  Copy-VerifiedExecutable $candidate.FullName $ffmpegDestination $ffmpegExeSha256 'FFmpeg 8.1.1 ffmpeg.exe'
}

$repkgDestination = Join-Path $repkgRoot 'RePKG.exe'
if ((Get-Sha256 $repkgDestination) -ne $repkgExeSha256) {
  $archive = Join-Path $cacheRoot 'RePKG-v0.4.0-alpha.zip'
  $extract = Join-Path $cacheRoot 'RePKG-v0.4.0-alpha'
  Get-VerifiedArchive $repkgArchiveUrl $archive $repkgArchiveSha256 'RePKG v0.4.0-alpha'
  New-Item -ItemType Directory -Path $extract -Force | Out-Null
  Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
  $candidate = Get-ChildItem -LiteralPath $extract -Filter 'RePKG.exe' -File -Recurse | Select-Object -First 1
  if ($null -eq $candidate) { throw 'RePKG archive does not contain RePKG.exe' }
  Copy-VerifiedExecutable $candidate.FullName $repkgDestination $repkgExeSha256 'RePKG v0.4.0-alpha RePKG.exe'
}

Assert-Hash $ffmpegDestination $ffmpegExeSha256 'FFmpeg 8.1.1 ffmpeg.exe'
Assert-Hash $repkgDestination $repkgExeSha256 'RePKG v0.4.0-alpha RePKG.exe'
Write-Host 'Mineradio Windows build tools ready: FFmpeg 8.1.1 and RePKG v0.4.0-alpha.'
