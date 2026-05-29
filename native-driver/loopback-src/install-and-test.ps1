<#
  SoundPipe native-driver — Phase 1b loopback: install + test helper.

  RUN THIS IN AN ELEVATED (Administrator) PowerShell INSIDE THE VM.
  The background Claude session is not elevated, so it cannot trust the test
  cert, install the driver, or restart the audio service — those steps live here.

  IMPORTANT (per CLAUDE.md): you must be in Hyper-V *Basic Session* (Enhanced
  Session off), otherwise local audio endpoints are suppressed and you'll only
  see "Remote Audio".

  What it does:
    1. Trusts the SoundPipe test cert (Root + TrustedPublisher).
    2. Installs/refreshes the driver package (devcon base + pnputil ext/apo).
    3. Restarts AudioEndpointBuilder and lists audio endpoints.

  After it finishes: set "Speaker" (SYSVAD) as the default playback device,
  play a sound, and record from the "Microphone (SYSVAD ... Mic In)" capture
  device. With the loopback build you should hear the PLAYED AUDIO on the mic
  recording instead of the old buzzing test tone (and silence when nothing is
  playing).
#>

$ErrorActionPreference = 'Stop'

$pkg     = "C:\drv\Windows-driver-samples\audio\sysvad\x64\Release\package"
$cer     = "C:\drv\Windows-driver-samples\audio\sysvad\SoundPipeTest.cer"
$hwid    = "Root\sysvad_ComponentizedAudioSample"
$baseInf = Join-Path $pkg "ComponentizedAudioSample.inf"
$extInf  = Join-Path $pkg "ComponentizedAudioSampleExtension.inf"
$apoInf  = Join-Path $pkg "ComponentizedApoSample.inf"

# Confirm elevation.
$p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Not elevated. Re-run this script from an Administrator PowerShell."
}

# Locate devcon (root-enumerated software device needs devcon, not pnputil, to create the devnode).
$devcon = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\Tools","D:\Program Files\Windows Kits\10\Tools" `
    -Recurse -Filter devcon.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
if (-not $devcon) {
    # Common EWDK location.
    $cand = "D:\Program Files\Windows Kits\10\Tools\10.0.28000.0\x64\devcon.exe"
    if (Test-Path $cand) { $devcon = $cand }
}
if (-not $devcon) { throw "devcon.exe not found. Mount the EWDK ISO (D:) or install the WDK tools." }
Write-Host "devcon: $devcon"

Write-Host "`n=== 1. Trust the test cert ==="
certutil -addstore -f Root $cer
certutil -addstore -f TrustedPublisher $cer

Write-Host "`n=== 2. Remove any previous instance, then install ==="
& $devcon remove $hwid 2>$null
pnputil /add-driver $extInf /install
pnputil /add-driver $apoInf /install
& $devcon install $baseInf $hwid

Write-Host "`n=== 2b. Remove + reinstall base so endpoints light up ==="
& $devcon remove $hwid 2>$null
Start-Sleep -Seconds 1
& $devcon install $baseInf $hwid

Write-Host "`n=== 3. Restart AudioEndpointBuilder (Basic Session only!) ==="
Restart-Service AudioEndpointBuilder -Force

Write-Host "`n=== Audio endpoints ==="
Get-PnpDevice -Class AudioEndpoint | Select-Object Status,FriendlyName | Format-Table -AutoSize

Write-Host "`nDone. Now: set the SYSVAD Speaker as default playback, play a sound, and"
Write-Host "record from the SYSVAD Mic In capture device — you should hear the played audio."
