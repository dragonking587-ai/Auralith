# Auralith 1.0.0-rc.49.3.10 — Neon Glow Fix & Gaming Overlay Foundation

## Neon Glow center-artifact fix
The Three.js Neon Glow renderer now guarantees a transparent center and fades before the edges of its render quad, preventing the render plane itself from appearing as a rectangle.

When the Three.js Neon Glow path is active, Auralith also suppresses the duplicate legacy Neon Glow underlay for native point, emitter and stamp placements. If a Three.js frame fails, Auralith immediately redraws the complete rc.49 fallback frame.

## Natural multi-tongue Realistic Flame
The natural fire rebuild remains intact:
- broad fuel-bed fire rather than a centered jet;
- nine independently moving flame tongues;
- separate height, width, curl, turbulence and breakup;
- hot inner core and thin tip wisps;
- continuous Bass / Low / Mid / High / Beat / Transient response;
- normal blending for a denser natural flame body.

## Gaming Overlay — first Gaming Mode foundation
The Overlay workspace remains included and supports:
- Web / Song Card surfaces;
- Frames / Panels;
- Text objects.

Overlay items can be positioned, resized, hidden, duplicated, reordered and saved with the project.

## Embedded link perspective matching
Web/Song Card surfaces, including embeddable Loudman.live links, retain Rotate Z, Tilt X/Y, Skew X/Y, Perspective, position, size, opacity, corner radius, z-order and color-matching controls. This lets users visually align a card to an angled monitor, wall display, sign, desk screen or similar background surface.

Some websites can still refuse iframe embedding through their own CSP or X-Frame-Options policies; Auralith does not bypass those policies.

## Existing features preserved
- Three.js 0.185.1 remains the cinematic effects renderer over the rc.49 compatibility base.
- All 80 selectable effects remain available.
- Existing quality tiers, audio mappings, editor workflows, updater, project and capture plumbing remain intact.

## Update compatibility
Auralith Reborn **1.0.0-rc.49.3.9** can update directly to **1.0.0-rc.49.3.10** using **Check for Updates → Download & Install** once the signed release metadata is published.

## WINDOWS SMARTSCREEN NOTICE
Windows may show **“Windows protected your PC”** because Auralith does not yet have an established Windows code-signing reputation. If the installer came from the official `dragonking587-ai/Auralith` GitHub release, use **More info → Run anyway**.
