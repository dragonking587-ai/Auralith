# Register Auralith Virtual Camera (DirectShow Softcam filter). Requires elevation.
$ErrorActionPreference = "Stop"
$dll = Join-Path $PSScriptRoot "softcam.dll"
if (-not (Test-Path $dll)) {
  $dll = Join-Path (Split-Path $PSScriptRoot -Parent) "softcam.dll"
}
if (-not (Test-Path $dll)) {
  Write-Error "softcam.dll not found next to this script."
}
Write-Host "Registering $dll ..."
& regsvr32.exe /s $dll
if ($LASTEXITCODE -ne 0) { Write-Error "regsvr32 failed ($LASTEXITCODE). Run as Administrator." }
Write-Host "Registered Auralith Virtual Camera."
