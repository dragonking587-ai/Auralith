# Auralith Native GPU Testing

Branch: `effects/native-gpu-testing`

This branch is deliberately isolated from the public updater/release channel while Auralith migrates effects from the legacy WebGL renderer to native Rust + wgpu one effect family at a time.

## Audio physics upgrade

The shared audio analyzer now uses:
- 4096-point FFT with linear spectral energy instead of byte-bin thresholds
- adaptive per-band noise floor and ceiling tracking
- independent attack/release envelopes for Bass / Low / Mid / High
- low-frequency spectral-flux beat detection with an adaptive threshold
- a beat refractory window so one kick cannot generate repeated triggers
- broadband spectral flux + waveform crest rise for transient detection
- compact normalized audio frames mirrored into Rust at ~30 Hz for native compute

## Particle quality rule

An effect that is supposed to represent a physical or luminous particle must not be rendered as a square hash cell.

Native compute physics is now defined for:
- Sparks — ballistic incandescent fragments, drag, gravity, trails
- Energy Sparks — charged outward acceleration and curved field motion
- Embers — buoyancy, cooling and turbulent drift
- Glitter Sparkle — diffraction glints rather than block cells
- Dust Motes — soft bokeh particles and room-current drift
- Ash — tumbling irregular flakes
- Snow — rounded depth-scaled flakes and lateral drift
- Bioluminescent Spores — breathing luminous orbs with curl motion
- Celestial Stars — depth-layered point lights with glint material data

The WebGL fallback in this branch receives matching analytic visual upgrades during Vite compilation so these effects stop appearing as square pixels before native compositing is finished.

Intentional digital/pixel effects such as `PixelDissolve` and `GlitchLight` remain block/pixel based because that is their actual visual identity.

## Safety / fallback

Native GPU adapter/device creation is capability-gated. A wgpu failure must not prevent Auralith from launching. Until native offscreen compositing into the main scene canvas is complete, the existing renderer remains the visual fallback.

The test workflow builds an isolated Windows installer artifact only. It does not publish a release, change the production updater manifest, or modify updater signing identity.
