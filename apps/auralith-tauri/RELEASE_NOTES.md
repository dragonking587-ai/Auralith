# Auralith 1.0.0-rc.49.3.5 — Complete 80-Effect Renderer Coverage

## Complete Selectable Effect Migration
This release finishes new-engine coverage for all **80 selectable Auralith effects** on supported Point, Emitter, and Stamp placements while keeping the proven rc.49 renderer underneath as the compatibility and safety layer.

The final 24 effects added in this release are:

### Color / Digital
- **Hue Shift** — continuously rotated source color with audio-driven hue movement.
- **Chromatic Pulse** — radial RGB separation driven by pulse, high-frequency energy, and transients.
- **Glitch Light** — procedural row/block displacement, jitter, RGB splitting, and transient spikes.
- **Kaleidoscope** — polar folding and scene sampling with controlled mirrored sectors.
- **Mirror Fracture** — fractured wedge sampling with animated crack highlights.
- **Pixel Dissolve** — procedural cell dissolve with reactive transition edges.
- **Scanline Pulse** — animated scanline modulation with a moving reactive sweep.
- **RGB Split** — directional red/green/blue separation driven by highs and transients.
- **Film Burn** — domain-warped burn fields, glowing edges, and beat-reactive ember color.

### Shadow / Dark
- **Shadow Pulse** — breathing radial darkness with bass/beat response.
- **Room Dim** — broad low-frequency dimming field with slow atmospheric drift.
- **Local Dim** — localized radial darkness with smooth breathing response.
- **Contrast Surge** — source-aware dynamic contrast lift with reactive highlight shaping.
- **Shadow Tendrils** — procedural rotating tendrils with organic noise deformation.
- **Eclipse** — dark core, corona, and reactive outer falloff.
- **Gravity Well** — source-image lensing, spiral pull, dark core, and event-horizon highlight.

### Ice / Crystal / Symbol
- **Frost / Ice** — branching frost texture, crystalline facets, and high-frequency sparkle.
- **Crystal Growth** — expanding radial crystal branches and growing facet fronts.
- **Ice Shimmer** — directional crystalline shimmer, facets, and transient sparkle.
- **Rune Glow** — emissive rune ring with independently pulsing glyph marks.
- **Sigil Activation** — animated concentric sigil rings, spokes, glyph bands, and beat activation.

### Final Environmental
- **Realistic Flame** — layered procedural flame body, turbulent tongues, hot core, rise, flicker, and continuous audio response.
- **Rain** — depth-varied slanted rain streaks with randomized drop placement and surface splash accents.
- **Celestial Stars** — distributed star field with independent twinkle timing and occasional cross-glints.

## Full New-Engine Family Coverage
The complete selectable library is now accounted for across dedicated Three.js modules:
- Particle
- Volumetric / Atmospheric
- Electrical / Beam
- Water / Distortion / Refraction
- Light / Glow / Optical
- Pulse / Energy Motion
- Color / Digital
- Shadow / Dark
- Ice / Crystal / Symbol
- Environmental / Final

**Smart Neon remains intentionally outside the selectable 80-effect catalog** and has not been re-enabled.

## Renderer Integrity
The rc.49 renderer still renders the complete project first, including the backdrop, props, project data, and legacy effects. The Three.js renderer remains on a separate transparent WebGL2 canvas and cannot take ownership of the rc.49 WebGL context.

Screen-space families such as distortion, color/digital, and shadow/dark receive the completed rc.49 canvas only as a read-only texture upload. If the cinematic renderer cannot initialize or a new shader fails, the rc.49 project remains visible underneath instead of becoming a blank image.

Clean Output retains its rc.49 fallback path, and updater recovery continues serializing the backdrop before restart so temporary blob URLs do not break restored projects.

## Placement Compatibility
Point, Emitter, and Stamp placements can use the migrated GPU families. **Trace, Shape, and Prop/SDF placements remain on the proven rc.49 path renderer** until the path/mask subsystem receives its own dedicated migration. This prevents the new renderer from breaking existing traced outlines or shape workflows.

## Audio-Reactive Behavior
The migration preserves Auralith's existing **2048-point audio analysis** and Bass / Low / Mid / High / Beat / Transient signals. The new modules use continuous smoothed modulation rather than simple trigger-only animation.

## Regression / Build Guard
The build now verifies:
- all 80 selectable effects are represented by migrated families;
- no duplicate/missing effect names exist across those families;
- Smart Neon has not returned to the selectable catalog;
- the rc.49 base renderer and isolated Three.js context remain separate;
- read-only scene-texture families do not acquire a WebGL context;
- all new layers initialize, update every frame, and dispose correctly;
- transparent overlay pixels are discarded/capped to protect the base image;
- the frontend dependency lock matches the app version and pinned Three.js dependencies;
- the build-time migration patch is safe when Tauri invokes the frontend build more than once.

## UI / Project Compatibility
No rc.49 interface redesign is included. Existing image loading, editor controls, markers, regions, trace workflow, project structure, audio engine, capture plumbing, updater behavior, and existing project files remain on the established compatibility path.

## Update Compatibility
Auralith Reborn **1.0.0-rc.49.3.4** can update directly to **1.0.0-rc.49.3.5** using **Check for Updates → Download & Install**. The application identifier, updater public key, updater endpoints, passive Windows install mode, and updater signing chain are unchanged.

## WINDOWS SMARTSCREEN NOTICE
Windows may show **“Windows protected your PC”** because Auralith does not yet have an established Windows code-signing reputation.

If the installer came from the official `dragonking587-ai/Auralith` GitHub release, use **More info → Run anyway**. Do not disable Windows SmartScreen or Windows Defender.

## NORTON 360 — INSTALL WITHOUT TURNING PROTECTION OFF
You do **not** need to disable Norton globally.

Before allowing anything, confirm the installer came from the official `dragonking587-ai/Auralith` GitHub release and verify the published SHA-256 checksum when possible.

If Norton quarantines the installer:
1. Open **Norton**.
2. Go to **Security → Security History**.
3. Change the view to **Quarantine**.
4. Select the Auralith installer and review **File Insight / Advanced details**.
5. Choose **Create exception & restore** or **Restore & exclude this file** (wording can vary by Norton version).
6. Run the restored installer again.

If Norton blocks Auralith after installation, add an exception only for the Auralith executable or installation folder. Keep **Auto-Protect, SONAR, Download Intelligence, and Norton itself enabled**.
