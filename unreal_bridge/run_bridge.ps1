$ErrorActionPreference = "Stop"

$BridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Client = Join-Path $BridgeRoot "bridge_client\bridge_client.py"

Write-Host ""
Write-Host "Auralith Unreal 5.7 Bridge" -ForegroundColor Yellow
Write-Host "==========================" -ForegroundColor Yellow
Write-Host "Control branch: unreal-control"
Write-Host "Local endpoint: 127.0.0.1:8765"
Write-Host ""

if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 $Client
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    & python $Client
} else {
    throw "Python 3 was not found. Install Python 3 or add it to PATH."
}
