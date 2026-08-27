# Auralith — Native Windows

C# / .NET 8 / WinUI 3 / Direct3D 11.

The previous Tauri desktop app is preserved on:

- branch `legacy/auralith-tauri`
- tag `auralith-tauri-final`

This branch (`rebuild/auralith-native`) is the clean native rebuild.

## Phase 1

Native GPU diagnostic window titled **Auralith — Native GPU Test Output**.

No editor, effects, updater, Virtual Camera, or WebView.

## Build

```
dotnet build Auralith.sln -c Release
dotnet publish src/Auralith.App/Auralith.App.csproj -c Release -r win-x64 --self-contained true
```
