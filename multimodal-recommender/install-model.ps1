param([switch]$CpuOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venv = Join-Path $root '.venv'
if (-not (Test-Path -LiteralPath $venv)) { python -m venv $venv }
$python = Join-Path $venv 'Scripts\python.exe'
& $python -m pip install --upgrade pip
if ($CpuOnly) {
  & $python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
  & $python -m pip install -r (Join-Path $root 'requirements.txt')
} else {
  & $python -m pip install -r (Join-Path $root 'requirements.txt')
}
& $python (Join-Path $root 'model_service.py') --probe




