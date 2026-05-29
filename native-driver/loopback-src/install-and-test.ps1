<#
  SoundPipe native-driver - Phase 1b loopback: install + test helper.

  RUN THIS IN AN ELEVATED (Administrator) PowerShell INSIDE THE VM.
  The background Claude session is not elevated, so it cannot trust the test
  cert, install the driver, or restart the audio service - those steps live here.

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

# The EWDK ISO (D:) gets unmounted on reboot - remount it if needed so devcon
# (and signing tools) are available.
if (-not (Test-Path "D:\")) {
    $iso = Get-ChildItem "C:\Users\User\Downloads\EWDK_*.iso" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($iso) { Write-Host "Mounting EWDK ISO..."; Mount-DiskImage -ImagePath $iso.FullName | Out-Null; Start-Sleep -Seconds 2 }
}

# Locate the x64 devcon (root-enumerated software device needs devcon, not
# pnputil, to create the devnode). Must be the x64 build for this x64 VM - an
# arm64 devcon.exe will fail with "not a valid application for this OS platform".
$devcon = $null
$cand = "D:\Program Files\Windows Kits\10\Tools\10.0.28000.0\x64\devcon.exe"
if (Test-Path $cand) { $devcon = $cand }
if (-not $devcon) {
    $devcon = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\Tools","D:\Program Files\Windows Kits\10\Tools" `
        -Recurse -Filter devcon.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\x64\\' } |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $devcon) { throw "x64 devcon.exe not found. Mount the EWDK ISO (D:) or install the WDK tools." }
Write-Host "devcon: $devcon"

Write-Host "`n=== 1. Trust the test cert ==="
certutil -addstore -f Root $cer
certutil -addstore -f TrustedPublisher $cer

Write-Host "`n=== 2. Remove any previous instance + stale driver packages ==="
& $devcon remove $hwid 2>$null
Start-Sleep -Seconds 1
# Delete any previously-published componentizedaudiosample.inf packages so the
# freshly-built one is used (avoids an old buggy copy winning by driver ranking).
$old = (pnputil /enum-drivers 2>$null | Out-String) -split "`r?`n`r?`n" |
       Where-Object { $_ -match 'componentizedaudiosample\.inf' } |
       ForEach-Object { if ($_ -match 'Published Name:\s*(oem\d+\.inf)') { $Matches[1] } }
foreach ($o in $old) {
    Write-Host "  deleting stale package $o"
    pnputil /delete-driver $o /uninstall /force 2>$null
}

Write-Host "`n=== 2b. Install the freshly-built driver ==="
pnputil /add-driver $extInf /install
pnputil /add-driver $apoInf /install
& $devcon install $baseInf $hwid

Write-Host "`n=== 2c. Remove + reinstall base so endpoints light up ==="
& $devcon remove $hwid 2>$null
Start-Sleep -Seconds 1
& $devcon install $baseInf $hwid

Write-Host "`n=== 3. Clear stale cached endpoint formats + restart audio (Basic Session only!) ==="
# Windows caches each endpoint's mix format and keeps it across reinstalls. After
# changing the driver's formats (e.g. mono->stereo, 44100->48000) the old format
# sticks until cleared. Stop the audio service, delete the cached DeviceFormat for
# our endpoints so AudioEndpointBuilder re-reads the driver's 48kHz-stereo default.
$DEVFMT = '{f19f064d-082c-4e27-bc73-6882a1bb8e4c},0'
$NAMEKEY = '{a45c254e-df1c-4efd-8020-67d146a850e0},2'
Stop-Service AudioEndpointBuilder -Force   # also stops Audiosrv (dependent)
foreach ($flow in 'Render','Capture') {
    $b = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\$flow"
    Get-ChildItem $b -ErrorAction SilentlyContinue | ForEach-Object {
        $props = Join-Path $_.PSPath 'Properties'
        $name = (Get-ItemProperty $props -Name $NAMEKEY -ErrorAction SilentlyContinue).$NAMEKEY
        if ($name -match 'SoundPipe|SYSVAD|Speakers|Microphone|SinkDescription|SPDIF|Headphones') {
            Remove-ItemProperty $props -Name $DEVFMT  -ErrorAction SilentlyContinue   # cached format
            Remove-ItemProperty $props -Name $NAMEKEY -ErrorAction SilentlyContinue   # cached friendly name (so renames take)
            Write-Host "  cleared cached format+name: $name"
        }
    }
}
Start-Service AudioEndpointBuilder
Start-Service Audiosrv

Write-Host "`n=== Audio endpoints ==="
Get-PnpDevice -Class AudioEndpoint | Select-Object Status,FriendlyName | Format-Table -AutoSize

Write-Host "`nDone. Now: set the SYSVAD Speaker as default playback, play a sound, and"
Write-Host "record from the SYSVAD Mic In capture device - you should hear the played audio."
