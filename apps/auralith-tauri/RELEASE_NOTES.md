# Auralith 1.0.0-rc.49.3.9 — Gaming Overlay Foundation & Natural Flame

## Gaming Overlay — first step toward Gaming Mode
Auralith now promotes the **Overlay** workspace as the foundation for the future Gaming Mode. Users can build and customize their own gaming/stream overlays directly over the active scene while keeping the existing Auralith editor and effects workflow intact.

Initial overlay objects:
- **Web / Song Card** — embed an HTTPS web surface such as a Loudman.live song card, artist card, or other embeddable page.
- **Frame / Panel** — build HUD frames, borders, panels, labels, and themed layout elements.
- **Text** — add player names, titles, status labels, stream text, or custom overlay copy.

Overlay objects are saved inside normal `.auralith` projects and can be selected, dragged, duplicated, hidden, reordered, and deleted.

## Embedded-link angle and perspective matching
Web cards and other overlay objects can be visually aligned to objects already present in a background image using:
- Position X / Y
- Width / height
- Rotate Z
- Tilt X / Y
- Skew X / Y
- Perspective depth
- Opacity
- Rounded corners
- Layer ordering

This allows a Loudman.live song card or other supported embedded link to be placed onto an angled monitor, wall display, sign, desk screen, panel, or similar surface in the background.

Web surfaces also include **Hue, Saturation, Brightness, and Contrast** controls to help match the lighting and color of the scene.

## Clean Capture behavior
Overlay content remains visible in **Clean Capture**, while editor selection outlines, drag hit areas, and controls stay hidden.

**Current limitation:** Web / Song Card objects are HTML/WebView surfaces. They are visible through Auralith's window/clean-capture workflow, but the existing Virtual Camera framebuffer readback does not yet rasterize HTML iframe content into its WebGL pixel buffer. A later Gaming Mode phase can add a dedicated web-surface-to-texture path for VCAM.

External websites can also block iframe embedding through CSP or X-Frame-Options. Auralith respects those security policies.

## Neon Glow rectangle correction
The Three.js/new-renderer **Neon Glow** path no longer draws the unwanted hard-coded rectangle in the center of the effect.

Neon Glow uses its actual local effect footprint instead of baked rectangular geometry, removing the visible rectangle from normal viewing and Clean Capture.

## Realistic Flame — natural multi-tongue fire
**Realistic Flame** uses the Three.js cinematic layer and is rebuilt as a broad, natural fire bed instead of a single center-column/flamethrower shape.

The fire model uses **nine independently moving flame tongues** with:
- different tongue heights and widths;
- independent curl and turbulence;
- natural breakup and thin tip wisps;
- a dense hot inner core near the fuel line;
- broad fuel-bed coverage rather than a nozzle-shaped center stream;
- Bass / Low response for body movement;
- Mid / High response for surface detail;
- Transient response for sharper flicker;
- denser normal blending for the flame body with softer transparent outer detail.

## Three.js rendering preserved
- Three.js remains the active cinematic effects layer.
- The proven rc.49 WebGL renderer remains the compatibility/base layer and fallback.
- All 80 selectable effects remain available.
- Low / Medium / High / Ultra quality tiers remain intact.
- Bass / Low / Mid / High / Beat / Transient audio mappings remain intact.

## Existing workflows preserved
- Trace, Stamp, Emitter, Shape, Prop, marker, and region editing remain intact.
- Effect packs and the online effect-pack library remain intact.
- Existing project save/load, updater, Clean Capture, and capture plumbing are preserved.

## Update compatibility
Auralith Reborn **1.0.0-rc.49.3.8** can update directly to **1.0.0-rc.49.3.9** using **Check for Updates → Download & Install** after the signed release and rolling `updater-latest` metadata are published.

## WINDOWS SMARTSCREEN NOTICE
Windows may show **“Windows protected your PC”** because Auralith does not yet have an established Windows code-signing reputation.

If the installer came from the official `dragonking587-ai/Auralith` GitHub release, use **More info → Run anyway**. Do not disable Windows SmartScreen or Windows Defender.
