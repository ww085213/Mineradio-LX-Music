param(
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = 'Stop'
$toolDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$repositoryDirectory = Split-Path -Parent (Split-Path -Parent $toolDirectory)
$compilerCandidates = @(
  'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe',
  'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) {
  throw 'Windows .NET Framework C# compiler was not found.'
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $repositoryDirectory 'dist\cleanup'
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$outputFile = Join-Path $OutputDirectory 'Mineradio.Cleanup.1.0.0.exe'
$sourceFile = Join-Path $toolDirectory 'MineradioCleanup.cs'
$manifestFile = Join-Path $toolDirectory 'app.manifest'
$iconFile = Join-Path $repositoryDirectory 'build\icon.ico'

$arguments = @(
  '/nologo',
  '/target:winexe',
  '/platform:anycpu',
  '/optimize+',
  '/checked+',
  '/warn:4',
  '/codepage:65001',
  "/out:$outputFile",
  "/win32manifest:$manifestFile"
)
if (Test-Path -LiteralPath $iconFile) {
  $arguments += "/win32icon:$iconFile"
}
$arguments += @(
  '/reference:System.dll',
  '/reference:System.Core.dll',
  '/reference:System.Drawing.dll',
  '/reference:System.Windows.Forms.dll',
  '/reference:System.Management.dll',
  $sourceFile
)

& $compiler @arguments
if ($LASTEXITCODE -ne 0) {
  throw "Cleanup tool compilation failed with exit code $LASTEXITCODE"
}

# The legacy .NET Framework compiler writes the current PE timestamp and a
# random module MVID. Normalize both so public SHA-256 values are reproducible.
$peBytes = [IO.File]::ReadAllBytes($outputFile)
$peOffset = [BitConverter]::ToInt32($peBytes, 0x3c)
$timestampOffset = $peOffset + 8
for ($index = 0; $index -lt 4; $index++) {
  $peBytes[$timestampOffset + $index] = 0
}

$loadedAssembly = [Reflection.Assembly]::ReflectionOnlyLoad($peBytes)
$currentMvid = $loadedAssembly.ManifestModule.ModuleVersionId.ToByteArray()
$mvidOffset = -1
for ($candidate = 0; $candidate -le $peBytes.Length - $currentMvid.Length; $candidate++) {
  $matches = $true
  for ($index = 0; $index -lt $currentMvid.Length; $index++) {
    if ($peBytes[$candidate + $index] -ne $currentMvid[$index]) {
      $matches = $false
      break
    }
  }
  if ($matches) {
    $mvidOffset = $candidate
    break
  }
}
if ($mvidOffset -lt 0) {
  throw 'Compiled assembly MVID was not found in the PE image.'
}

$seedParts = @(
  (Get-FileHash -Algorithm SHA256 -LiteralPath $sourceFile).Hash,
  (Get-FileHash -Algorithm SHA256 -LiteralPath $manifestFile).Hash,
  (Get-Item -LiteralPath $compiler).VersionInfo.FileVersion,
  'MineradioCleanupTool/1.0.0'
)
if (Test-Path -LiteralPath $iconFile) {
  $seedParts += (Get-FileHash -Algorithm SHA256 -LiteralPath $iconFile).Hash
}
$seedBytes = [Text.Encoding]::UTF8.GetBytes(($seedParts -join '|'))
$sha256Provider = [Security.Cryptography.SHA256]::Create()
try {
  $deterministicMvid = $sha256Provider.ComputeHash($seedBytes)
} finally {
  $sha256Provider.Dispose()
}
for ($index = 0; $index -lt 16; $index++) {
  $peBytes[$mvidOffset + $index] = $deterministicMvid[$index]
}
[IO.File]::WriteAllBytes($outputFile, $peBytes)

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $outputFile).Hash.ToLowerInvariant()
$checksumFile = Join-Path $OutputDirectory 'Mineradio.Cleanup.1.0.0.SHA256.txt'
Set-Content -LiteralPath $checksumFile -Encoding ASCII -Value "$hash  Mineradio.Cleanup.1.0.0.exe"

$version = (Get-Item -LiteralPath $outputFile).VersionInfo
[pscustomobject]@{
  File = $outputFile
  Bytes = (Get-Item -LiteralPath $outputFile).Length
  SHA256 = $hash
  FileVersion = $version.FileVersion
  ProductVersion = $version.ProductVersion
  Compiler = $compiler
}
