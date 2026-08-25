# Developer helper: register/unregister Auralith Virtual Camera (x64 Softcam).
# Run from repo root in an elevated PowerShell when testing locally.
param(
  [ValidateSet('register','unregister')]
  [string]$Action = 'register',
  [string]$Dll = ''
)
$ErrorActionPreference = 'Stop'
if (-not $Dll) {
  $candidates = @(
    'vendor\softcam\out\softcam.dll',
    'vendor\softcam\dist\bin\x64\softcam.dll',
    'src-tauri\target\release\softcam.dll'
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $Dll = (Resolve-Path $c).Path; break }
  }
}
if (-not $Dll -or -not (Test-Path $Dll)) {
  Write-Error "softcam.dll not found. Build Softcam first (msbuild softcam.sln x64 Release)."
}
$regsvr = Join-Path $env:SystemRoot 'System32\regsvr32.exe'
if ($Action -eq 'register') {
  Write-Host "Registering $Dll"
  & $regsvr /s $Dll
} else {
  Write-Host "Unregistering $Dll"
  & $regsvr /s /u $Dll
}
Write-Host "Done. Check: reg query HKCR\CLSID\{A11A11A1-5A11-4A11-B111-A11A11A11A11}"
