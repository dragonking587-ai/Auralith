# Auralith 1.0.0-rc.49.3.6 — Home, Navigation & Quality Cleanup

## Home page cleanup
- Home is now a dedicated Auralith landing page instead of sharing the Server/Output control surface.
- Added What's New, Upcoming, installed version, update status, Editor shortcut, tutorial access, and feedback access.
- Removed server administration clutter from Home.

## Navigation cleanup
- Home, Editor, Audio, Output, Server, Devices, and Settings now have distinct page states.
- Output contains Clean Capture and Virtual Camera controls.
- Server contains Public Relay, Local/LAN viewer, room, poll mapping, and server-status controls.
- Devices contains Host identity, Host Remote pairing, QR, authorization, revoke, and device-management controls.
- Audio contains audio-source controls and meters.
- Settings contains UI preferences, Help/Tutorials, About, and Feedback.
- Existing handlers were retained while controls were reorganized.

## Quality system
- Project quality is explicitly Low / Medium / High / Ultra.
- High remains the default.
- Project files preserve the selected quality tier and invalid legacy values fall back to High.
- Low / Medium / High / Ultra now have build-time verification across legacy detail, particle density, volumetric detail, fireworks, and cinematic post-processing.
- Particle density targets are 48 / 80 / 128 / 192 from Low through Ultra.

## Version reliability
- Runtime version display now comes from package metadata through Vite instead of a stale hard-coded App.tsx value.
- The updater comparison and About/Home version displays therefore follow the packaged release version.

## Build guard
- Preview builds now run dedicated navigation and quality audits before the frontend build.
- The release fails validation if page routing or the four-tier quality wiring regresses.

## Compatibility
- Renderer architecture, audio analysis, project structure, image loading, editor tools, Clean Output, capture plumbing, and updater signing identity are preserved.
- Existing projects remain compatible.
- Auralith Reborn 1.0.0-rc.49.3.5 can update directly to 1.0.0-rc.49.3.6 using Check for Updates → Download & Install.

## WINDOWS SMARTSCREEN NOTICE
Windows may show “Windows protected your PC” because Auralith does not yet have an established Windows code-signing reputation.
If the installer came from the official dragonking587-ai/Auralith GitHub release, use More info → Run anyway. Do not disable Windows SmartScreen or Windows Defender.
