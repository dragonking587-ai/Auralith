# Effect library status — 2.0.0-rc.50

All 80 `EffectKind` values have renderer handlers and control schemas.

Auralith Effects Engine 2 renders effects on the CPU with SkiaSharp and persistent simulation state. Direct3D 11 remains the Windows presentation/output transport; effects are not implemented in the experimental native-GPU renderer.

Key rc.50 upgrades:
- Persistent attack/release audio envelopes per effect.
- Persistent particles for sparks, embers, snow, ash, dust, swarm, fountains, orbiting particles, gravity particles and related effects.
- Sparks use ballistic motion, gravity, cooling-style fade, luminous trails and a hot core.
- `Swarm` uses organic firefly-like agents with independent wandering and blinking rather than generic dots.
- Lightning uses irregular subdivided leaders, branches, short multi-pulse strokes, bloom/core layers and local flash illumination.
- Flame uses persistent rising hot particles with turbulence and layered glow.
- SkiaSharp paths, blur, gradients and blend modes provide improved glow, outlines, energy, fog, rain, water, aurora and related effects.
- Trace, Stamp and Emitter regions remain the masking/placement system.

Verification:
- CI audits every visible XAML button/event-handler mapping and dynamically-created effect button wiring.
- Rendering regression tests exercise every one of the 80 effect kinds for multiple frames.
- Installer CI still performs publish-payload verification plus installed-app smoke and uninstall tests.
