# Auralith 1.0.0-rc.49.3.1 — Render Pipeline Recovery Fix

## Critical Fix

RC.49.3 introduced a cinematic Three.js renderer that shared the same WebGL canvas/context as Auralith’s proven rc.49 renderer. On affected Windows/WebView2 systems, the two renderers could invalidate each other’s WebGL state, causing backdrops and effects to appear blank or fail to update.

RC.49.3.1 fixes that architecture instead of disabling the render upgrade.

### Images / Backdrops
- Restored the proven rc.49 renderer as the authoritative backdrop and prop renderer.
- Removed the rc.49.3 build-time mutations to the base renderer’s WebGL context and clear behavior.
- The cinematic renderer no longer owns or resets the backdrop renderer’s textures, programs, buffers, framebuffer bindings, or pixel-store state.
- Update recovery now serializes the current project/backdrop before restart so temporary blob URLs are not relied on for the recovery snapshot.

### Effects
- The complete project and all 80 normal effects are always rendered through the proven rc.49 engine first.
- Three.js particle and volumetric effects now run as an enhancement layer instead of replacing the rc.49 effect.
- If Three.js is unavailable, a shader fails, or the cinematic layer encounters a frame error, the rc.49 effect remains visible and functional underneath.
- Removed the project-object-identity split cache that could leave effect routing stale after editor changes.

### Isolated Cinematic Pipeline
- Three.js now receives its own transparent WebGL2 canvas and context.
- The cinematic canvas is layered above the rc.49 canvas inside the existing stage without changing the visible UI layout.
- Post-processing alpha is derived from visible cinematic light instead of opaque black post-process pixels, preventing the overlay from covering the loaded image.
- Particle and volumetric enhancements remain limited to appropriate point / emitter / stamp placements; trace, shape, prop and other placements continue to use the rc.49 renderer.

### Clean Output / Virtual Camera Safety
- Clean-frame readback uses the rc.49 frame as the guaranteed base.
- When a cinematic overlay is active, its pixels are alpha-composited into the clean-frame readback.
- If cinematic readback fails, the rc.49 clean frame is returned instead of a blank frame.

### Build-Time Regression Guard
RC.49.3.1 adds a build audit that fails CI unless all of these conditions remain true:
- rc.49 base WebGL context is preserved;
- Three.js uses an isolated WebGL2 canvas;
- the full rc.49 project is rendered as the safety underlay;
- stale split caching is absent;
- cinematic overlay alpha is transparent-safe;
- updater recovery serializes the backdrop;
- the pinned Three.js runtime dependency is present.

## UI Compatibility
No rc.49 visual layout, controls, buttons, effect names, editor tools, project workflow, marker behavior, or styling were redesigned for this fix.

## Update Compatibility
Auralith Reborn **1.0.0-rc.49.3** can update directly to **1.0.0-rc.49.3.1** using the existing signed updater chain. The application identifier, updater public key, endpoints, installer mode, and updater-artifact generation remain unchanged.

## WINDOWS SMARTSCREEN NOTICE
Windows may show **“Windows protected your PC”** because Auralith does not yet have an established Windows code-signing reputation.

If the installer was downloaded from the official Auralith GitHub release, use:

**More info → Run anyway**

Do not disable Windows SmartScreen or Windows Defender.

## Installing on Windows
1. In rc.49.3, use **Check for Updates** and install **1.0.0-rc.49.3.1**, or download the installer from the official GitHub release.
2. If Windows shows “Windows protected your PC,” click **More info**.
3. Confirm the file came from the official `dragonking587-ai/Auralith` repository and click **Run anyway**.
4. Launch Auralith Reborn and verify your image and effects load normally.
