# Auralith Desktop V2 — Rebuild Plan

Branch: `rebuild/auralith-desktop-v2`
Base: `43e350b` (`dev` / Test 20 — compiles + Native Broadcast UI wired)
`main` is not modified. History, tags, and releases are preserved.

## 1. Branch point
- Commit: `43e350b07dc52c90f291aeaf111aee60e5b55589`
- Reason: latest `dev` with Native Broadcast (`broadcast.rs`) + Output-tab wiring.

## 2. Rebuild branch
`rebuild/auralith-desktop-v2`

## 3. Preserve
- `src/lib/auralith/renderer.ts` (effects visual SoT)
- store / scene model / types
- Stamp, Trace, detect-lights, envelope, surge
- `audio-engine.ts` + `src-tauri/src/audio.rs` (WASAPI)
- `final-frame-provider.ts` + `broadcast.rs` (native output)
- Browser Source hub (`server.rs`) as alternative
- Existing presets / Fit-Fill / resolutions

## 4. Refactor (ownership, not a file dump)
- Theme tokens + shell chrome
- Output tab copy: Native = primary, Legacy WebView isolated
- Version SoT documented (`platform.ts` marketing vs Cargo 1.0.0)

## 5. Legacy isolated (not deleted)
- WebView `open_output` / StreamView second window
- Softcam / `vcam.rs` / installer hooks
- Dual `vcam_push_frame` APIs
- Stream Output naming leftovers

## 6. Target architecture
Editor + audio → renderer.ts → FinalFrameProvider (clean canvas)
→ broadcast.rs HWND present → Window Capture

## 7. Native Broadcast plan
Phase A/B already present (Win32 HWND + BGRA present).
Next on this branch: lifecycle/status polish only; D3D11 swap chain later.
Do not use second WebView as recommended path.

## 8. Theme
`public/brand/auralith-realm.png` — obsidian, gold geometry, cyan/purple energy.
Tokens: gold accent, charcoal panels, thin gold borders.
Artwork as splash/shell wash; editor canvas stays dominant.

## 9. Signing / release
No secrets in repo. Future: GitHub Actions + Trusted Signing / Authenticode secrets.
Do not tag from this branch until frontend + Tauri + NSIS gates pass.

## 10. Commit sequence
See commits on this branch. Merge to `dev` only after capture + installer verification.
