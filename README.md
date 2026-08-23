# Auralith

**Version:** 1.0.0-rebuild

Auralith is a real-time audio-reactive background creator for OBS, Streamlabs, and TikTok LIVE Studio. Create custom lighting effects including magic, pulse, hue, flicker, and strobe, synchronized to music with Browser Source and Window Capture support.

Load a background, mark lights with Stamp or Trace, assign those regions to Bass / Low / Mid / High, and output a clean reactive plate — background plus effects only — to your streaming software.

Permanent source of truth: [https://github.com/dragonking587-ai/Auralith](https://github.com/dragonking587-ai/Auralith)

- `dev` — active development
- `main` — stable production release

## Features

- Single Web Audio engine: Demo Audio, uploaded Track, Microphone, and System/computer audio (where the browser allows it)
- Four frequency bands with fast attack and natural release
- Stamp, Trace, Move, Erase, Undo, Redo, Clear, Match Photo
- Effects: Pulse, Hue, Flicker, Strobe, Room Dim, Magic (Flowing / Dense Spell)
- Nearby Magic stamps share an energy field so they blend, not blow out to white
- Saved scenes (versioned `schemaVersion: 1`)
- Streaming resolutions for TikTok, OBS, Streamlabs, plus custom width/height
- Image fit: Fill (default), Fit, Stretch, with repositioning
- Browser Source output (recommended, low latency)
- Window Capture output (`Auralith — Stream Output`) as the compatibility fallback
- Desktop, phone, and tablet (mouse, touch, stylus)

## Installation

```bash
git clone https://github.com/dragonking587-ai/Auralith.git
cd Auralith
git checkout dev
npm install
```

## Development

```bash
npm run dev
```

The editor listens on port 8080.

## Build command

```bash
npm run build
```

## Production build

```bash
npm run build
npm run preview
```

`npm run typecheck` and `npm test` should pass before merging `dev` into `main`.

## Netlify

Deploy the **`dev`** branch. `netlify.toml` sets:

| Field | Value |
| --- | --- |
| Base directory | *(blank)* |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Functions directory | *(blank — Nitro writes `.netlify/functions-internal`)* |
| Node version | `22` |

On Netlify, Browser Source uses latest-state HTTP (`/api/auralith/live` + `/api/auralith/image`) because Netlify Functions cannot upgrade WebSockets. The editor still publishes bands, scene, and image. Dev/local still uses WebSocket when available.

## Browser Source setup (recommended)

1. Open Auralith and load a scene.
2. Choose **Output → Browser Source**.
3. Pick platform + resolution + FPS (default 60).
4. Copy the Browser Source URL.
5. In OBS / Streamlabs / TikTok LIVE Studio, add a **Browser Source**.
6. Paste the URL and match the width, height, and FPS.

The editor is the audio authority. It sends a tiny live packet (timestamp + four bands + intensity). The Browser Source **renders locally**. It does not receive PNG/JPEG frames.

Latest-state only: if packets 100–103 arrive, only 103 is drawn. Nothing is queued.

## Window Capture setup

1. Choose **Output → Window Capture**.
2. Click **Open stream output**.
3. Capture the window titled **Auralith — Stream Output**.
4. That window contains only the background plus reactive effects — no stamps, traces, handles, or chrome.

## OBS setup

Auralith → OBS → select resolution → Browser Source → Copy URL → OBS → Add Browser Source → paste URL → match resolution.

## Streamlabs setup

Auralith → Streamlabs → select resolution → Browser Source → Copy URL → Streamlabs Desktop → Add Browser Source → paste URL → match resolution.

## TikTok LIVE Studio setup

Auralith → TikTok → select 1080×1920 (or 720×1280) → Browser Source → Copy URL → TikTok LIVE Studio → Add Browser Source → paste URL → match portrait size.

## Audio

One `AudioContext` and one analyser. Switching Demo / Track / Mic / System Audio swaps the source, not the engine.

Bands: Bass, Low, Mid, High. Fast attack, natural release. Sensitivity uses a soft knee so values stay in 0–1.

## Tools

| Tool | What it does |
| --- | --- |
| Stamp | Circle light on the image |
| Trace | Freehand region on the image |
| Move | Reposition a region |
| Erase | Remove a region |
| Frame | Reposition the image inside the frame |
| Undo / Redo | Region history |
| Clear | Remove every region |
| Match Photo | Sample the image color under the region |

Coordinates are stored normalized to the source image (0–1), not the canvas.

## Magic

Style selector (expandable): **Flowing** is the default cinematic vapor; **Dense Spell** is a heavier volumetric plasma with its own Density control. Intensity / Flow / Spread / Energy apply to both. Overlapping Magic stamps share one energy field (max blend). Sparks stay secondary. Older scenes without a style default to Flowing. Older Flame scenes migrate to Magic automatically.


## Saved scenes

Scenes persist in the browser (`schemaVersion: 1`) with a named library. Export/import JSON is available from the Look panel.

## Performance target

1080p60. One animation frame per document. Drop work rather than queue it.

## Git workflow

```text
dev  = active development (push every milestone)
main = stable release
```
