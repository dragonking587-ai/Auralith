param(
    [Parameter(Mandatory=$true)]
    [string]$UProject
)

$ErrorActionPreference = "Stop"

$UProjectPath = (Resolve-Path $UProject).Path
if (-not $UProjectPath.EndsWith(".uproject", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "-UProject must point to a .uproject file."
}

$ProjectDir = Split-Path -Parent $UProjectPath
$BridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceRoot = Join-Path $BridgeRoot "unreal"
$TargetRoot = Join-Path $ProjectDir "Content\Python"

$Modules = @(
    "auralith_production_controls.py",
    "auralith_test_scene.py",
    "auralith_render_feedback.py",
    "auralith_cinematic_stage.py",
    "auralith_hot_reload.py"
)

New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null

foreach ($Module in $Modules) {
    $Source = Join-Path $SourceRoot $Module
    $Target = Join-Path $TargetRoot $Module
    if (-not (Test-Path $Source)) {
        throw "Missing bridge extension in local clone: $Source"
    }
    Copy-Item -Force $Source $Target
    if (-not (Test-Path $Target)) {
        throw "Copy failed: $Target"
    }
    Write-Host "Synced $Module" -ForegroundColor Green
}

Write-Host ""
Write-Host "Live bridge extensions are now present in Content\Python." -ForegroundColor Green
Write-Host "Leave Unreal and the bridge running. ChatGPT can now issue the safe import/reload command." -ForegroundColor Yellow
