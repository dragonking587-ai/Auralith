$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$xamlPath = Join-Path $repo 'src/Auralith.App/MainWindow.xaml'
$codePath = Join-Path $repo 'src/Auralith.App/MainWindow.xaml.cs'

if (-not (Test-Path $xamlPath)) { throw "Missing $xamlPath" }
if (-not (Test-Path $codePath)) { throw "Missing $codePath" }

$xaml = Get-Content $xamlPath -Raw
$code = Get-Content $codePath -Raw

# Every visible XAML button must explicitly wire Click.
$buttonMatches = [regex]::Matches($xaml, '<Button\b(?<attrs>[^>]*)/?>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
if ($buttonMatches.Count -eq 0) { throw 'No XAML buttons found; audit cannot run.' }

$buttonErrors = @()
foreach ($m in $buttonMatches) {
    $attrs = $m.Groups['attrs'].Value
    $content = if ($attrs -match 'Content="([^"]+)"') { $Matches[1] } elseif ($attrs -match 'x:Name="([^"]+)"') { $Matches[1] } else { '<unnamed button>' }
    if ($attrs -notmatch '(?:^|\s)Click="([A-Za-z_][A-Za-z0-9_]*)"') {
        $buttonErrors += "XAML button '$content' has no Click handler."
    }
}
if ($buttonErrors.Count -gt 0) { throw ($buttonErrors -join [Environment]::NewLine) }

# All declared XAML event handlers must resolve to a code-behind method.
# Require the attribute to start at whitespace so IsChecked="True" cannot be
# mistaken for Checked="True".
$eventPattern = '(?:^|\s)(?:Click|Checked|Unchecked|SelectionChanged|ValueChanged|PointerPressed|PointerMoved|PointerReleased|KeyDown)="(?<handler>[A-Za-z_][A-Za-z0-9_]*)"'
$handlers = [regex]::Matches($xaml, $eventPattern, [System.Text.RegularExpressions.RegexOptions]::Multiline) |
    ForEach-Object { $_.Groups['handler'].Value } |
    Sort-Object -Unique

$missing = @()
foreach ($handler in $handlers) {
    $methodPattern = '\b' + [regex]::Escape($handler) + '\s*\('
    if ($code -notmatch $methodPattern) { $missing += $handler }
}
if ($missing.Count -gt 0) { throw "Missing code-behind handlers: $($missing -join ', ')" }

# Dynamically created buttons are not protected by XAML compilation, so verify
# that every local Button allocation is followed by a Click subscription.
$dynamic = [regex]::Matches($code, '\bvar\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*new\s+Button\s*\{')
$dynamicErrors = @()
foreach ($m in $dynamic) {
    $name = $m.Groups['name'].Value
    $start = $m.Index
    $length = [Math]::Min(1200, $code.Length - $start)
    $window = $code.Substring($start, $length)
    $wirePattern = '\b' + [regex]::Escape($name) + '\.Click\s*\+=' 
    if ($window -notmatch $wirePattern) { $dynamicErrors += $name }
}
if ($dynamicErrors.Count -gt 0) { throw "Dynamic buttons without Click subscription: $($dynamicErrors -join ', ')" }

Write-Host "UI handler audit PASS: $($buttonMatches.Count) XAML buttons, $($handlers.Count) XAML event handlers, $($dynamic.Count) dynamic buttons."
