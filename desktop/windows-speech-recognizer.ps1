param(
  [ValidateRange(3, 30)]
  [int]$TimeoutSeconds = 18
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Write-Result([hashtable]$Value) {
  [Console]::Out.WriteLine(($Value | ConvertTo-Json -Compress -Depth 4))
}

$recognizer = $null
try {
  Add-Type -AssemblyName System.Speech
  $installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() |
    Where-Object { $_.Culture.Name -eq 'zh-CN' } |
    Select-Object -First 1
  if (-not $installed) {
    Write-Result @{ ok = $false; error = 'SPEECH_ZH_CN_NOT_INSTALLED'; message = 'Windows Chinese speech recognizer is not installed.' }
    exit 2
  }

  $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($installed)
  $recognizer.InitialSilenceTimeout = [TimeSpan]::FromSeconds([Math]::Min(8, $TimeoutSeconds))
  $recognizer.BabbleTimeout = [TimeSpan]::FromSeconds(4)
  $recognizer.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(850)
  $recognizer.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(1200)
  $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $recognizer.SetInputToDefaultAudioDevice()

  $result = $recognizer.Recognize([TimeSpan]::FromSeconds($TimeoutSeconds))
  if (-not $result -or [String]::IsNullOrWhiteSpace($result.Text)) {
    Write-Result @{ ok = $false; error = 'SPEECH_NOT_HEARD'; message = 'No speech was recognized.' }
    exit 3
  }

  Write-Result @{
    ok = $true
    text = [String]$result.Text
    confidence = [Math]::Round([Double]$result.Confidence, 3)
    engine = 'windows-offline-zh-CN'
  }
} catch {
  Write-Result @{ ok = $false; error = 'SPEECH_RECOGNITION_FAILED'; message = 'Local speech recognition failed.' }
  exit 1
} finally {
  if ($recognizer) {
    try { $recognizer.Dispose() } catch {}
  }
}
