# Auralith 1.0.0-rc.49.3.3 — Light / Glow / Optical Pipeline Upgrade

## New Three.js Light / Glow / Optical Family
- **Glow Bloom** — emissive hot core with broad photographic falloff and bass/beat breathing.
- **Halo** — animated annular corona with a crisp ring and softer outer glow.
- **Light Rays** — independent fan-shaped light shafts with subtle organic movement.
- **God Rays** — crepuscular density shafts with broad radial falloff.
- **Lens Flare** — source bloom, anamorphic streak, lens-element ghosts, and glints.
- **Starburst** — diffraction spikes with a concentrated hot center.
- **Spotlight** — soft cone lighting with controlled edge softness and distance falloff.
- **Shimmer** — fine traveling specular bands driven strongly by high-frequency energy.
- **Glitter Sparkle** — seeded independent glints with asynchronous twinkle behavior.
- **Neon Glow** — bright tube core with a broader colored gas corona.
- **Neon Chase** — energized segments traveling around the neon perimeter.
- **Prismatic Light** — spectral fan with controlled color separation and emissive bloom.

## Renderer Integrity
The proven rc.49 renderer remains authoritative for the backdrop, props, project data, and complete effect library. The new Three.js Light / Glow / Optical effects render on the existing separate transparent WebGL2 enhancement canvas above the rc.49 base.

If the cinematic layer cannot initialize, compile, or render safely, the rc.49 image and original effects remain visible underneath. Clean Output continues to fall back to the rc.49 frame if cinematic readback fails.

Trace, Shape, and Prop/SDF placements continue using the established rc.49 renderer until those placement modes receive their dedicated new-engine migration. Point, Emitter, and Stamp placements for the migrated family can use the new GPU layer.

## Build Regression Guard
The runtime integrity audit now verifies that:
- the rc.49 base WebGL context remains unchanged;
- the cinematic renderer uses its own isolated WebGL2 context;
- the complete rc.49 project renders first as the safety underlay;
- all 12 Light / Glow / Optical effect kinds are routed into the new layer;
- the optical layer is initialized, updated every frame, and disposed correctly;
- the optical layer uses emissive additive blending;
- transparent pixels are discarded rather than covering the backdrop;
- overlay alpha is capped to protect the base image;
- the optical module cannot acquire or share a WebGL context;
- the God Rays radial falloff avoids undefined reversed-smoothstep behavior.

## UI / Project Compatibility
No rc.49 interface redesign is included. Existing controls, image loading, editor tools, project structure, marker behavior, audio engine, capture plumbing, updater flow, and existing project files remain on the established compatibility path.

## Update Compatibility
Auralith Reborn **1.0.0-rc.49.3.2** can update directly to **1.0.0-rc.49.3.3** using **Check for Updates → Download & Install**. The application identifier, updater public key, updater endpoints, passive Windows install mode, and updater signing chain remain unchanged.

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

If Norton blocks Auralith again after installation, add an exception only for the Auralith file or installation folder:
1. Open **Norton**.
2. Go to **Security → Advanced Security → Computer → Antivirus**.
3. Open the **Exclusions** tab.
4. Click **Add**.
5. Select only the Auralith executable or its installation folder, then **Save**.

Do **not** disable Auto-Protect, SONAR, Download Intelligence, or all antivirus protection. Only create the narrow Auralith exception after confirming you downloaded the installer from the official release.
