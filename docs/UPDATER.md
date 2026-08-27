# Auralith V2 in-app updater

## Architecture

Auralith → `@tauri-apps/plugin-updater` 2.10.x → HTTPS `latest.json` → signed `.nsis.zip` → verify minisign → NSIS install → `plugin-process` relaunch.

Do not download/run an arbitrary unsigned EXE from the UI.

## Manifest schema (Tauri 2)

```json
{
  "version": "2.0.0-alpha.3",
  "notes": "…",
  "pub_date": "2026-08-27T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<minisign signature string>",
      "url": "https://github.com/dragonking587-ai/Auralith/releases/download/v2.0.0-alpha.3/Auralith_2.0.0-alpha.2_x64-setup.nsis.zip"
    }
  }
}
```

Endpoints (in `tauri.conf.json`):

1. `https://raw.githubusercontent.com/dragonking587-ai/Auralith-desktop-updates/main/latest.json`
2. `https://github.com/dragonking587-ai/Auralith/releases/download/auralith-v2-channel/latest.json`

Publish **latest.json only after** NSIS + `.sig` exist.

## Signing

- **Tauri updater signing** (minisign): public key in `tauri.conf.json` `plugins.updater.pubkey`.
- Private key: GitHub Actions secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Never commit the private key. Never log it.

## Windows Authenticode

**NOT YET CONFIGURED.** SmartScreen / Unknown Publisher may still appear. Separate from Tauri updater signatures.

## Version source

Packaged version = `src-tauri/tauri.conf.json` `version` = `DESKTOP_VERSION` in `src/lib/auralith/platform.ts`.

V2 prerelease channel: `2.0.0-alpha.N` (no `1.0.0-desktop-test.*` strings).

## Key pair (V2 alpha.2 repair)

The previous Actions secret was not a parseable Tauri/minisign **private** key
(`Missing comment in secret key` during artifact signing).

A new Tauri 2 `signer generate` key pair was created.

- Public key lives in `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
- Private key lives only in GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY`
- Password secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is empty (unattended CI)

Private key material is not in this repository.
