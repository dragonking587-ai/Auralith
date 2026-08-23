$ErrorActionPreference = "Stop"
$dll = Join-Path $PSScriptRoot "softcam.dll"
if (-not (Test-Path $dll)) {
  $dll = Join-Path (Split-Path $PSScriptRoot -Parent) "softcam.dll"
}
if (Test-Path $dll) {
  & regsvr32.exe /u /s $dll
  Write-Host "Unregistered Auralith Virtual Camera."
}
