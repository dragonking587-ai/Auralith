# Auralith Native Rebuild

## Recovery

- Branch: `legacy/auralith-tauri`
- Tag: `auralith-tauri-final`

## Active branch

`rebuild/auralith-native`

## Stack

- .NET 8 (`net8.0-windows10.0.19041.0` for the WinUI app)
- WinUI 3 via Windows App SDK 1.6
- Unpackaged + self-contained (`WindowsPackageType=None`)
- Direct3D 11 through Vortice.Direct3D11 (`DXGI_FORMAT_B8G8R8A8_UNORM`, flip-discard)
- WASAPI planned in Phase 4 (project stub only)

## Phase 1 only

Do not start Phase 2 until the user tests the diagnostic HWND in OBS / Streamlabs / TikTok.
