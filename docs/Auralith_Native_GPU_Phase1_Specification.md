# AURALITH NATIVE GPU OUTPUT — PHASE 1 DIAGNOSTIC ENGINE

Build PHASE 1 ONLY of the new Auralith Native GPU Broadcast architecture.

This phase is a STANDALONE NATIVE GPU DIAGNOSTIC OUTPUT ENGINE.

Its purpose is to prove that the Windows native rendering and presentation path works reliably BEFORE connecting it to the full Auralith renderer, backdrop, effects engine, or audio-reactive system.

DO NOT connect live Auralith scene frames yet.

DO NOT redesign unrelated Auralith functionality.

DO NOT remove legacy output paths yet.

DO NOT work on:
- Virtual Camera
- Browser Source
- updater
- remote control
- new effects
- unrelated UI
- Media Foundation
- Spout
- NDI

The goal is to isolate and validate:

- native HWND creation
- Direct3D 11 device creation
- DXGI swap chain
- DirectComposition if appropriate
- native GPU rendering
- frame pacing
- resize handling
- DPI handling
- portrait and landscape output
- OBS Window Capture compatibility
- Streamlabs compatibility
- TikTok LIVE Studio compatibility
- open/close lifecycle
- GPU resource cleanup
- error handling

==================================================
PRIMARY GOAL
==================================================

Create a standalone native Windows output window titled:

Auralith — Native GPU Test Output

This window must NOT depend on:

- React rendering
- StreamView
- Axum hub
- scene snapshots
- image URLs
- browser routing
- second WebView
- WebView state
- audio analyzer
- Auralith effects engine
- Softcam
- DirectShow
- Virtual Camera

It should be driven entirely by the native GPU output module.

The purpose is to answer one question:

CAN AURALITH CREATE A RELIABLE NATIVE GPU WINDOW THAT STREAMING SOFTWARE CAN CAPTURE?

Do not move to live Auralith rendering until that answer is YES.

==================================================
PHASE 1 ARCHITECTURE
==================================================

Target architecture:

Auralith UI
↓
Tauri / Rust command
↓
Native Windows render thread
↓
Native HWND
↓
D3D11 Device
↓
DXGI Swap Chain
↓
DirectComposition if appropriate
↓
Animated Native GPU Diagnostic Scene
↓
Windows Desktop
↓
OBS / Streamlabs / TikTok LIVE Studio Window Capture

This phase must prove the native presentation path independently from the rest of Auralith.

==================================================
1. WORK ON THE CLEAN REBUILD BRANCH
==================================================

Use the dedicated Auralith rebuild branch created for the clean desktop rebuild.

Do NOT:

- modify main directly
- delete existing Git history
- delete previous tags
- force-push over existing branches
- destroy the existing working Auralith implementation

Preserve the previous implementation for reference.

Make Phase 1 a clearly isolated set of commits.

==================================================
2. BUTTON / COMMAND
==================================================

Add a desktop-only development control:

OPEN NATIVE GPU TEST OUTPUT

This can temporarily live in:

Output
→ Native GPU Test

The button should invoke a narrowly scoped Rust/Tauri command.

Conceptual flow:

UI
→ invoke native GPU test command
→ Rust handler
→ native output thread
→ HWND
→ D3D11
→ animated test renderer

Use Auralith's existing Tauri ACL/capability security model.

DO NOT disable ACL globally.

DO NOT use unrestricted wildcard permissions.

Add only the permission required for the Native GPU Test command.

==================================================
3. STATUS UI
==================================================

The test control should show:

Native GPU Test Output

Status:

CLOSED
STARTING
RUNNING
RECONFIGURING
STOPPING
ERROR

When running, optionally display:

Resolution
Target FPS
Actual FPS
GPU adapter

Example:

Native GPU Test Output

RUNNING

1920×1080
30 FPS
NVIDIA GeForce ...

Do not fabricate status values.

They must come from the native engine where practical.

==================================================
4. NATIVE WINDOW
==================================================

Create a genuine native Windows HWND.

Window title:

Auralith — Native GPU Test Output

Requirements:

- real HWND
- normal taskbar entry
- resizable
- windowed
- close button works
- reopen works
- no WebView inside the output window
- discoverable by Windows Window Capture
- does not require OBS to be installed
- does not require a browser
- does not require DirectShow registration

The native test window should be independent from the main Auralith WebView.

==================================================
5. WINDOWS MESSAGE LOOP
==================================================

Implement a proper Win32 message loop.

Correctly handle at minimum:

WM_CLOSE
WM_DESTROY
WM_SIZE
WM_DPICHANGED
WM_PAINT if required
WM_QUIT

Do not create an uncontrolled busy loop that prevents Windows messages from being processed.

The render loop and message loop must coexist correctly.

==================================================
6. D3D11 INITIALIZATION
==================================================

Create a Direct3D 11 device and immediate context.

Use the correct windows-rs APIs for the exact version in the repository.

Do not copy Windows API examples from another windows-rs version without checking signatures.

Log:

[NativeGpuTest] Starting
[NativeGpuTest] Creating native window
[NativeGpuTest] HWND created
[NativeGpuTest] Selecting GPU adapter
[NativeGpuTest] Creating D3D11 device
[NativeGpuTest] Adapter: <name>
[NativeGpuTest] Feature level: <level>
[NativeGpuTest] D3D11 device ready

If initialization fails:

DO NOT CRASH AURALITH.

Report:

Subsystem
Stage
HRESULT
Readable error

==================================================
7. GPU ADAPTER SELECTION
==================================================

Identify which GPU adapter is being used.

Consider systems containing:

- Intel integrated graphics
- NVIDIA graphics
- AMD graphics
- hybrid laptops

Do not over-engineer adapter selection during Phase 1.

But report the selected adapter so capture problems can be diagnosed.

==================================================
8. PRESENTATION PATH
==================================================

Use a modern native Windows presentation architecture.

Preferred:

Direct3D 11
+
DXGI Swap Chain
+
DirectComposition where appropriate

If DirectComposition is unnecessary for the initial window, a standard HWND-compatible DXGI swap chain is acceptable if it provides reliable Window Capture.

Document the choice.

Do NOT use GDI as the final Phase 1 renderer.

Do NOT use:

- browser rendering
- Canvas
- screenshots
- PNG encoding
- JPEG encoding
- base64
- disk image files
- HTTP frame transfer

The diagnostic scene should be generated directly by the native renderer.

==================================================
9. BACKBUFFER FORMAT
==================================================

Prefer a GPU-friendly format such as:

DXGI_FORMAT_B8G8R8A8_UNORM

or another technically appropriate Windows/D3D11 format.

Document the exact format.

Verify:

- red/blue channels correct
- alpha handling correct
- no vertical inversion
- no corrupted stride
- no washed-out gamma

==================================================
10. DIAGNOSTIC VISUAL
==================================================

Render an animated diagnostic scene generated entirely by the native GPU output engine.

The visual should make it obvious whether frames are updating.

Use an Auralith-inspired diagnostic appearance:

- dark charcoal / obsidian background
- metallic gold border
- subtle cyan/purple energy accent
- clean readable text

Display:

AURALITH
NATIVE GPU TEST

Also display:

Resolution
Target FPS
Actual FPS
Frame number
Elapsed time

Add at least one obvious continuously animated object.

For example:

- moving gold square
- moving gold orb
- rotating geometric shape
- animated energy band
- moving gradient

The animation must make frozen capture immediately obvious.

Do NOT integrate the full Auralith theme artwork yet.

Do NOT integrate the actual Auralith effects engine yet.

==================================================
11. ANIMATION REQUIREMENT
==================================================

The diagnostic scene must continuously animate.

Example:

Gold orb moves left → right → left.

Energy band continuously changes.

Frame counter increments.

Elapsed timer increases.

If OBS captures only a frozen frame, we should be able to tell immediately.

==================================================
12. FRAME RATE
==================================================

Support:

30 FPS
60 FPS

Start testing with:

1920×1080 @ 30 FPS

After stable:

1920×1080 @ 60 FPS

Use proper frame pacing.

Do NOT render unlimited frames.

Do NOT busy-spin unnecessarily.

Target timing:

30 FPS ≈ 33.3 ms/frame

60 FPS ≈ 16.7 ms/frame

==================================================
13. LOW-LATENCY BEHAVIOR
==================================================

Do not build a large frame queue.

For future Auralith use, low latency is more important than displaying every stale frame.

The diagnostic renderer should therefore establish the correct behavior now.

If rendering falls behind:

DROP OLD WORK

and continue with the newest frame.

Do NOT accumulate latency.

==================================================
14. RESOLUTIONS
==================================================

Support and test:

1920×1080
1280×720
1080×1920
720×1280

The diagnostic engine must support:

LANDSCAPE

and

PORTRAIT

The native output must preserve the selected logical resolution.

==================================================
15. RESOLUTION VS WINDOW SIZE
==================================================

Separate:

LOGICAL OUTPUT RESOLUTION

from:

DESKTOP WINDOW SIZE

Example:

Logical output:
1920×1080

Desktop window:
960×540

The user should be able to resize the physical window without accidentally changing the logical scene resolution unless explicitly requested.

This will be important when Auralith is eventually used with OBS.

==================================================
16. RESIZE HANDLING
==================================================

When the native window is resized:

- handle WM_SIZE
- safely release/recreate affected render targets
- resize swap-chain buffers correctly
- continue animation
- preserve D3D device if possible
- avoid permanent black screen
- avoid corrupted buffers
- avoid crashes

Log:

[NativeGpuTest] Resize requested
[NativeGpuTest] Swap chain buffers resized
[NativeGpuTest] Rendering resumed

==================================================
17. MINIMIZE / RESTORE
==================================================

Test:

Minimize
→ Restore

The native renderer should recover correctly.

Do not continuously perform expensive rendering while minimized if unnecessary.

When restored:

animation should resume normally.

==================================================
18. DPI / WINDOWS SCALING
==================================================

Support Windows desktop scaling correctly.

Test:

100%
125%
150%
200%

Logical render resolution must remain correct.

Do not accidentally use CSS concepts or WebView scaling.

This is a native window.

Handle DPI changes appropriately.

==================================================
19. FULLSCREEN PREPARATION
==================================================

Phase 1 does not require a polished fullscreen UI.

However, structure the native window so fullscreen can be supported later without replacing the architecture.

Do not make fullscreen the focus of Phase 1.

==================================================
20. D3D DEVICE LOSS
==================================================

Handle D3D/DXGI failure gracefully.

Possible failures include:

device removed
device reset
swap-chain failure
present failure

If the device is lost:

- do not crash main Auralith
- stop using invalid resources
- record the HRESULT
- attempt safe recreation if reasonable
- transition to ERROR if recovery fails

Report:

[NativeGpuTest] Device lost
HRESULT: ...
Reason: ...

==================================================
21. ERROR STATE
==================================================

Never leave an unexplained blank native window.

If startup fails, return something meaningful to Auralith.

Example:

Native GPU Test Output failed.

Subsystem:
D3D11

Stage:
Swap Chain Creation

HRESULT:
0xXXXXXXXX

Reason:
<readable Windows error>

==================================================
22. THREADING MODEL
==================================================

Use a clean native threading model.

The native HWND/message loop/presentation loop should live on an appropriate native thread.

Do NOT block:

React UI
Tauri main UI
audio processing

Do not use unlimited blocking waits.

Do not spawn a new uncontrolled render thread every time the button is pressed.

==================================================
23. DUPLICATE OPEN PROTECTION
==================================================

If Native GPU Test Output is already running and the user presses Open again:

Do NOT create another uncontrolled output engine.

Instead:

- focus existing window

or:

- report RUNNING

Only one Phase 1 test output should exist at a time unless there is a specific reason otherwise.

==================================================
24. CLOSE BEHAVIOR
==================================================

Closing the native test window must:

- stop render loop
- destroy HWND
- release render target
- release swap chain
- release D3D resources
- terminate output thread cleanly
- update status to CLOSED

The main Auralith application must remain open.

==================================================
25. RESOURCE LIFETIME
==================================================

Correctly manage:

HWND
D3D11 device
D3D11 context
DXGI interfaces
swap chain
backbuffer
render target view
DirectComposition resources if used
event handles
thread handles
timers

Do not leak resources between open/close cycles.

==================================================
26. OPEN/CLOSE STRESS TEST
==================================================

Perform:

Open
→ Close
→ Open
→ Close

at least 50 times.

Verify:

- no leaked HWNDs
- no leaked render threads
- no D3D device leaks
- no swap-chain leaks
- no crashes
- no increasing handle count
- no steadily increasing memory

Record memory before and after.

==================================================
27. SOAK TEST
==================================================

Run:

1920×1080 @ 30 FPS

for at least:

30 minutes

Then test:

1920×1080 @ 60 FPS

for at least:

30 minutes

Record:

Average FPS
Minimum FPS if available
Dropped frames
CPU usage
GPU usage
Memory at start
Memory at end
Present failures
Device resets
Resize failures

Memory should remain reasonably stable.

==================================================
28. OBS TEST
==================================================

ONLY after the native window itself is working correctly:

Open OBS.

Add:

Source
→ Window Capture

Select:

Auralith — Native GPU Test Output

Test the appropriate Windows Graphics Capture method where available.

Verify:

- Auralith appears in window selector
- diagnostic scene visible
- moving object animates
- frame counter changes
- FPS remains smooth
- no white output
- no black output
- no frozen frame
- aspect ratio correct
- resize survives
- minimize/restore behavior documented

==================================================
29. OBS 30 FPS TEST
==================================================

Test:

1920×1080 @ 30 FPS

Verify captured motion.

Compare:

native window

vs

OBS preview.

Look for obvious latency or stutter.

==================================================
30. OBS 60 FPS TEST
==================================================

Test:

1920×1080 @ 60 FPS

Verify OBS receives smooth motion where hardware supports it.

Do not claim 60 FPS stability without measurement.

==================================================
31. STREAMLABS TEST
==================================================

Repeat equivalent testing in Streamlabs Desktop.

Confirm:

Auralith — Native GPU Test Output

appears in Window Capture.

Verify live animation.

==================================================
32. TIKTOK LIVE STUDIO TEST
==================================================

Repeat equivalent testing in TikTok LIVE Studio.

Confirm the native output appears in its Window Capture selector.

Test:

1920×1080 landscape

and:

1080×1920 portrait

Verify animation remains live.

==================================================
33. PORTRAIT TEST
==================================================

Set:

1080×1920

Verify:

- native backbuffer correct
- diagnostic visual positioned correctly
- no accidental rotation
- no stretching
- text readable
- animation works
- streaming software captures it

==================================================
34. PERFORMANCE TELEMETRY
==================================================

Add development diagnostics for:

GPU adapter
D3D feature level
logical resolution
backbuffer resolution
target FPS
actual FPS
average frame time
Present time
dropped frames
device reset count
output state

Do not clutter the normal production Auralith UI.

This is development telemetry.

==================================================
35. LOGGING
==================================================

Use useful logs such as:

[NativeGpuTest] Open requested
[NativeGpuTest] Native thread started
[NativeGpuTest] HWND created
[NativeGpuTest] D3D11 device created
[NativeGpuTest] Adapter: ...
[NativeGpuTest] Swap chain created
[NativeGpuTest] Render target ready
[NativeGpuTest] Running
[NativeGpuTest] Resize
[NativeGpuTest] Present error ...
[NativeGpuTest] Closing
[NativeGpuTest] Resources released
[NativeGpuTest] Closed

Avoid flooding logs once per frame.

==================================================
36. BUILD / CI GATE
==================================================

Before creating any new test tag:

Frontend build must pass.

Rust cargo check must pass.

Tauri production build must pass.

NSIS installer must be generated.

Do not create another release tag merely because source code was committed.

The exact production build must succeed first.

==================================================
37. WINDOWS-RS COMPATIBILITY
==================================================

The previous Native Broadcast work exposed Windows API compatibility problems.

Therefore:

Use the EXACT windows-rs version in the repository.

Verify all API signatures.

Pay particular attention to:

HWND pointer representation
message constants
HRESULT handling
COM interfaces
DXGI interfaces
D3D11 interfaces
PCWSTR
BOOL
HANDLE
pointer types

Do not assume HWND is an isize if the installed windows-rs version represents it as a pointer.

==================================================
38. UNSAFE CODE
==================================================

Native Windows/D3D code will require unsafe blocks.

That is acceptable.

But unsafe code must be deliberate.

Verify:

- pointer lifetime
- COM lifetime
- buffer lifetime
- HWND lifetime
- render target lifetime
- thread lifetime

Do not use unsafe simply to force incompatible types through the compiler.

==================================================
39. NO SOFTCAM DEPENDENCY
==================================================

The Native GPU Test Output must work even if:

Auralith Virtual Camera is not installed.

It must NOT require:

softcam.dll
regsvr32
DirectShow
camera registration
PC restart

This is a completely separate output path.

==================================================
40. DO NOT CONNECT LIVE AURALITH YET
==================================================

THIS IS CRITICAL.

Phase 1 is NOT the complete Broadcast Output.

Do NOT connect:

- backdrop
- scene state
- renderer.ts
- audio bands
- Trace
- Stamp
- Pulse
- Flicker
- Strobe
- Room Dim
- Fit / Fill scene composition
- live Auralith frames

until Phase 1 has proven that the native GPU window itself is reliable and capturable.

This specification is the source of truth for Phase 1 implementation on the Auralith Desktop V2 rebuild branch.
