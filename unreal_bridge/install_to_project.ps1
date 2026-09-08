param(
    [Parameter(Mandatory=$true)]
    [string]$UProject,

    [switch]$InstallCppPlugin
)

$ErrorActionPreference = "Stop"

$UProjectPath = (Resolve-Path $UProject).Path
if (-not $UProjectPath.EndsWith(".uproject", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "-UProject must point to a .uproject file."
}

$ProjectDir = Split-Path -Parent $UProjectPath
$BridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonSource = Join-Path $BridgeRoot "unreal\auralith_unreal_bridge.py"
$ProductionSource = Join-Path $BridgeRoot "unreal\auralith_production_controls.py"
$PythonDir = Join-Path $ProjectDir "Content\Python"
$PythonTarget = Join-Path $PythonDir "auralith_unreal_bridge.py"
$ProductionTarget = Join-Path $PythonDir "auralith_production_controls.py"
$InitTarget = Join-Path $PythonDir "init_unreal.py"

New-Item -ItemType Directory -Force -Path $PythonDir | Out-Null
Copy-Item -Force $PythonSource $PythonTarget
Copy-Item -Force $ProductionSource $ProductionTarget

$Begin = "# AURALITH_UNREAL_BRIDGE_BEGIN"
$End = "# AURALITH_UNREAL_BRIDGE_END"
$Bootstrap = @"
$Begin
try:
    import auralith_unreal_bridge
    import auralith_production_controls
except Exception as exc:
    import unreal
    unreal.log_error(f"[AuralithBridge] startup failed: {exc}")
$End
"@

if (Test-Path $InitTarget) {
    $Existing = Get-Content -Raw $InitTarget
    if ($Existing -match [regex]::Escape($Begin)) {
        $Pattern = [regex]::Escape($Begin) + "[\s\S]*?" + [regex]::Escape($End)
        $Updated = [regex]::Replace($Existing, $Pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $Bootstrap }, 1)
        Set-Content -Path $InitTarget -Value $Updated -Encoding UTF8
        Write-Host "Updated existing Auralith bridge bootstrap in Content\Python\init_unreal.py"
    } else {
        Add-Content -Path $InitTarget -Value "`r`n$Bootstrap"
        Write-Host "Added bridge bootstrap to existing Content\Python\init_unreal.py"
    }
} else {
    Set-Content -Path $InitTarget -Value $Bootstrap -Encoding UTF8
    Write-Host "Created Content\Python\init_unreal.py"
}

if ($InstallCppPlugin) {
    $PluginSource = Join-Path $BridgeRoot "plugin\AuralithBridge"
    $PluginRoot = Join-Path $ProjectDir "Plugins"
    $PluginTarget = Join-Path $PluginRoot "AuralithBridge"
    New-Item -ItemType Directory -Force -Path $PluginRoot | Out-Null
    if (Test-Path $PluginTarget) {
        Remove-Item -Recurse -Force $PluginTarget
    }
    Copy-Item -Recurse -Force $PluginSource $PluginTarget
    Write-Host "Installed optional C++ reflection plugin to Plugins\AuralithBridge"
    Write-Host "Unreal may ask to compile the plugin. Visual Studio Build Tools / a C++ toolchain may be required."
}

Write-Host ""
Write-Host "Bridge runtime installed into:" -ForegroundColor Green
Write-Host "  $ProjectDir"
Write-Host ""
Write-Host "Installed Python modules:" -ForegroundColor Green
Write-Host "  Content\Python\auralith_unreal_bridge.py"
Write-Host "  Content\Python\auralith_production_controls.py"
Write-Host ""
Write-Host "In Unreal Engine 5.7 enable:" -ForegroundColor Yellow
Write-Host "  - Python Editor Script Plugin"
Write-Host "  - Editor Scripting Utilities"
Write-Host "Then restart Unreal and run unreal_bridge\run_bridge.ps1 from the Auralith clone."
