# Auralith 1.0.0-rc.49.3.8 — Gaming Overlay & Natural Flame

## Gaming Overlay — first step toward Gaming Mode
Auralith now has a dedicated **Overlay** workspace for building stream and gaming overlays directly on top of the current scene.

The first overlay object types are:
- **Web / Song Card** — embed an HTTPS web surface such as an embeddable Loudman.live card or page.
- **Frame / Panel** — create resizable HUD frames, borders and themed panels.
- **Text** — create labels, titles, player names and other overlay text.

Overlay objects are saved inside normal `.auralith` projects and can be duplicated, hidden, reordered or deleted.

## Angle and perspective matching
Web cards and other overlay objects can be transformed to visually match objects already present in a background image:
- Position X / Y
- Width / height
- Rotate Z
- Tilt X / Y
- Skew X / Y
- Perspective depth
- Opacity
- Rounded corners
- Layer ordering

This makes it possible to place an embeddable song card onto an angled monitor, wall display, sign, desk screen or similar surface in the background.

Web surfaces also include **Hue, Saturation, Brightness and Contrast** controls so the embedded content can better match the scene theme.

## Clean Capture behavior
Overlay objects remain visible in **Clean Capture** while editor outlines, selection handles and controls are hidden.

**Current limitation:** Web / Song Card objects are HTML/WebView overlay surfaces. They are visible through Auralith's window/clean-capture workflow, but the existing Virtual Camera framebuffer readback does not yet rasterize HTML iframe content into its WebGL pixel buffer. A later Gaming Mode step can add a dedicated web-surface-to-texture path for VCAM output.

Some external websites may also block iframe embedding with their own CSP or X-Frame-Options policy. Auralith cannot override a site's security policy. The Overlay workspace supports embeddable HTTPS pages; a dedicated native browser-surface renderer remains a future option for sites that need it.

## Neon Glow correction
The new-renderer **Neon Glow** no longer draws a hard-coded rectangle in the center of the effect.

Neon Glow now uses its local effect footprint instead of baked rectangular geometry, so the unwanted center rectangle is removed from both normal viewing and Clean Capture.

## Realistic Flame rebuild
**Realistic Flame** has been rebuilt from the single center-column / flamethrower-style shape into a broad natural fire bed with **nine independently moving flame tongues**.

The new flame model includes:
- independent tongue heights, widths, curl and turbulence;
- natural breakup and thin tip wisps;
- a denser hot core near the base;
- broader fuel-bed coverage instead of a nozzle-like center stream;
- Bass / Low response for body movement;
- Mid / High response for detail;
- Transient response for sharper flicker;
- higher inner-body opacity while keeping softer outer flame detail.

Realistic Flame now uses a denser normal blend for the flame body rather than treating the whole effect as a transparent additive energy effect.

## Existing features preserved
- All 80 selectable effects and the rc.49 compatibility renderer remain available.
- Low / Medium / High / Ultra quality tiers remain intact.
- The 2048-point audio analysis and Bass / Low / Mid / High / Beat / Transient mappings remain intact.
- Trace, Stamp, Emitter, Shape, Prop, marker and region workflows remain intact.
- Online Effect Pack Library and the Obsidian Wolf Effects Collection remain intact.
- Existing project, updater and capture plumbing are preserved.

## Update compatibility
Auralith Reborn **1.0.0-rc.49.3.7** can update directly to **1.0.0-rc.49.3.8** using **Check for Updates → Download & Install**.

## WINDOWS SMARTSCREEN NOTICE
Windows may show **“Windows protected your PC”** because Auralith does not yet have an established Windows code-signing reputation.

If the installer came from the official `dragonking587-ai/Auralith` GitHub release, use **More info → Run anyway**. Do not disable Windows SmartScreen or Windows Defender.
