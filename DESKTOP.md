# Auralith Desktop (Windows)

Standalone app. After install it does not need Netlify, the website, or the internet except for optional updates and the Download button’s GitHub lookup.

This is **not** a wrapper around the hosted web app. The installer bundles the UI and a local runtime.

## Version

First test: `v1.0.0-desktop-test.1` (GitHub **pre-release**). Not a stable public release.

## What you get

- Editor, Smart Detect, automatic Bass / Low / Mid / High assignment
- Pulse, Hue, Flicker, Strobe, Room Dim, Light Surge
- Stamp, Trace, Move, Erase, Undo, Redo, Clear, Match Photo
- Saved scenes in Windows app data (`%APPDATA%\ai.auralith.desktop\`) plus the webview store
- Demo Scene bundled as `/demo/stage.jpg`
- Track (local files) and microphone
- **System audio** via WASAPI loopback of the selected output device
- **Auralith — Stream Output** window for Window Capture
- Local Browser Source on `127.0.0.1` only

## Build (Windows)

```bash
npm ci
npm run desktop:build
cargo tauri build --manifest-path src-tauri/Cargo.toml
```

CI recipe: [`scripts/desktop-windows.yml`](scripts/desktop-windows.yml) (intended path `.github/workflows/desktop-windows.yml`). Pushing that GitHub Actions file requires OAuth `workflow` scope. Until then, run the Windows job from a machine with that scope, or copy the recipe into `.github/workflows/`.

Installer is NSIS `.exe`. **No MSI** in this test. The installer is **unsigned**; SmartScreen may warn. Do not bypass SmartScreen as a product feature — a code-signing certificate is required before public release.

## Local services

Bound to **localhost only** (`127.0.0.1`). Ports `4317`–`4327` (first free).

| Use | URL |
| --- | --- |
| Editor (inside the app) | bundled UI, not the website |
| Browser Source | `http://127.0.0.1:4317/source/<session>` |
| Stream Output window | `http://127.0.0.1:4317/output?session=<session>` |
| Live hub | WebSocket `ws://127.0.0.1:4317/ws/auralith?session=…` |

OBS / Streamlabs / TikTok LIVE Studio should paste the Browser Source URL shown in **Output**. Nothing is routed through Netlify.

## System audio

Windows WASAPI loopback of a **render** (playback) device:

YouTube / Chrome / Edge / Spotify / games → default or selected output → Auralith FFT → Bass / Low / Mid / High.

- Default device is used unless you pick another output (speakers, headset, HDMI, virtual cable).
- No `getDisplayMedia` picker in the desktop app.
- Audio never leaves the machine.
- Process-specific capture (Chrome only, ignore Discord) is **not** in this test; the analyzer is structured so it can be added later.

## Updates

GitHub Releases host installers.

This test does **not** ship signed auto-update payloads (no certificate, updater plugin inactive). The desktop UI may quietly offer **An Auralith update is available** by reading public GitHub release metadata. If GitHub is unreachable, launch continues.

Future public release should:

1. Code-sign the NSIS installer (and updater artifacts).
2. Enable `tauri-plugin-updater` with a pubkey and `latest.json` on the **stable** GitHub Release.
3. Keep a pre-release / beta channel optional.

Stable channel ↔ `main` / non-prerelease GitHub Release. This test tag is pre-release only.

## Private repository

**The GitHub repository is currently private.**

- The web **Download for Windows** button cannot fetch a public installer URL without GitHub login.
- Unauthenticated visitors will land on a GitHub login / 404 Releases page.
- For this internal test, download from [Releases](https://github.com/dragonking587-ai/Auralith/releases) while signed in as the owner.
- Do **not** make the source repository public unless you intend a public release.
- Safest public distribution later: a **public** GitHub Release (or a public releases-only repo / website CDN) of **signed** installers, without publishing private source if you want source to stay private.

## Signing / SmartScreen

No certificate is configured. Expect:

- Windows SmartScreen: “Windows protected your PC”
- Browser download warnings on `.exe`

Do not disable SmartScreen. Before public release, Authenticode-sign the installer and updater files.

## Offline

After install, core use works without internet: startup, images, Demo Scene, Track, Mic, System Audio, effects, Smart Detect, saved scenes, Window Capture, local Browser Source. Only update checks and the website Download button need GitHub.

## Virtual Camera (Windows)

- **Device name:** `Auralith Virtual Camera`
- **Technology:** DirectShow user-mode filter (vendored Softcam, MIT), not a kernel driver
- **Frame path:** Stream Output canvas (final renderer) → RGBA → RGB24 → Softcam sender API
- **Registration:** `regsvr32 softcam.dll` (Administrator, once). Installer ships `softcam.dll` and `scripts/register-auralith-vcam.ps1`.
- **Uninstall:** `regsvr32 /u softcam.dll` or `scripts/unregister-auralith-vcam.ps1`
- **Resolutions:** uses current Output preset (1920×1080, 1280×720, 1080×1920, 720×1280, …)
- **FPS:** scene output FPS (60 preferred, 30 fallback)
- **Audio:** not carried on the virtual camera (effects still use WASAPI/mic analysis)
- **OBS / Streamlabs / TikTok:** Video Capture Device → Auralith Virtual Camera — **requires real Windows testing**

## In-app updates

- **Check for Updates** in Output → Updates
- Optional quiet check a few seconds after launch (never blocks startup)
- **No GitHub PAT** in the app binary or source
- Private source repository cannot serve unauthenticated release assets; for production auto-download use a **public binary-only channel** (separate public releases repo or public endpoint) with Tauri minisign (`TAURI_SIGNING_PRIVATE_KEY` in CI secrets, public key in config)
- Windows **code signing** is separate from updater package signing and is not enabled in test builds
