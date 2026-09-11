# Auralith 1.0.0-rc.49.3.4 — Pulse / Energy Motion Pipeline Upgrade

## New Three.js Pulse / Energy Motion Family
- **Pulse** — concentric emissive breathing with beat/bass expansion and a bright moving ring.
- **Flicker** — layered low-frequency instability plus fast micro-flicker without hard random frame popping.
- **Light Surge** — outward-moving energy front with transient flash, decaying fill, and cinematic bloom response.
- **Strobe** — controlled duty-cycle flashes with softened gating, beat/transient emphasis, and retained base-image visibility.
- **Breathing Glow** — smooth inhale/exhale luminosity with bass support and a soft moving rim.
- **Afterglow** — persistent decaying light memory driven by recent beat/transient energy instead of a simple timer loop.
- **Echo Pulse** — staggered concentric pulse copies with independent temporal falloff.
- **Wave Sweep** — directional energy band sweeping through the effect area with adjustable angle and width.
- **Shockwave** — expanding high-energy ring with corona, tail, transient response, and decay.
- **Energy Flow** — turbulent GPU flow field with animated filaments, stream bands, and mid/high audio modulation.
- **Energy Ripple** — layered expanding ripples with procedural turbulence and frequency-reactive highlights.

## Renderer Integrity
The proven rc.49 renderer remains authoritative for the backdrop, props, project data, trace/path rendering, and the complete legacy effect library. The new Pulse / Energy Motion family renders on the existing isolated transparent Three.js WebGL2 enhancement canvas above the rc.49 base.

If the cinematic layer cannot initialize, compile, or render safely, the rc.49 image and original effects remain visible underneath. Clean Output continues to fall back to the rc.49 frame if cinematic readback fails.

Trace, Shape, and Prop/SDF placements continue using the established rc.49 renderer until those placement modes receive their dedicated new-engine migration. Point, Emitter, and Stamp placements for the migrated family can use the new GPU layer.

## Audio-Reactive Behavior
The new family keeps Auralith's existing 2048-point audio analysis and Bass / Low / Mid / High / Beat / Transient signals. It does not downgrade the audio engine. The Three.js layer adds its own short smoothing envelopes and an audio-memory envelope for Afterglow so reactions remain fluid instead of looking like cheap trigger animations.

## Build Regression Guard
The runtime integrity audit now verifies that:
- the rc.49 base WebGL context remains unchanged;
- the cinematic renderer uses its own isolated WebGL2 context;
- the complete rc.49 project renders first as the safety underlay;
- all 11 Pulse / Energy Motion effect kinds are routed into the new layer;
- the new layer is initialized, updated every frame, and disposed correctly;
- the family uses emissive additive blending;
- transparent pixels are discarded rather than covering the backdrop;
- overlay alpha is capped to protect the base image;
- Afterglow retains a decaying audio impulse envelope;
- the module cannot acquire or share a WebGL context;
- existing electrical, distortion/refraction, light/optical, particle, and volumetric safety checks remain in place.

## UI / Project Compatibility
No rc.49 interface redesign is included. Existing controls, image loading, editor tools, project structure, marker behavior, audio engine, capture plumbing, updater flow, and existing project files remain on the established compatibility path.

## Update Compatibility
Auralith Reborn **1.0.0-rc.49.3.3** can update directly to **1.0.0-rc.49.3.4** using **Check for Updates → Download & Install**. The application identifier, updater public key, updater endpoints, passive Windows install mode, and updater signing chain remain unchanged.

## WINDOWS SMARTSCREEN NOTICE
Windows may show **“Windows protected your PC”** because Auralith does not yet have an established Windows code-signing reputation.

If the installer came from the official `dragonking587-ai/Auralith` GitHub release, use **More info → Run anyway**. Do not disable Windows SmartScreen or Windows Defender.

## NORTON 360 — INSTALL WITHOUT TURNING PROTECTION OFF
Norton can sometimes flag a new or low-reputation installer even when it was downloaded intentionally. You do **not** need to turn Norton off.

Before allowing anything, make sure the installer came from the official `dragonking587-ai/Auralith` GitHub release and verify the published SHA-256 checksum when possible.

If Norton quarantines the Auralith installer:
1. Open **Norton**.
2. Go to **Security → Security History**.
3. Change the history view to **Quarantine**.
4. Select the Auralith installer.
5. Review **File Insight / Advanced details** to confirm the file and source are the ones you intended to download.
6. Choose **Create exception & restore** (wording may also appear as **Restore & exclude this file** on some Norton versions).
7. Confirm the restore, then run the installer again.

If Norton blocks Auralith again after installation, add an exception only for the Auralith file or installation folder. Do **not** disable Auto-Protect, SONAR, Download Intelligence, or all antivirus protection.
