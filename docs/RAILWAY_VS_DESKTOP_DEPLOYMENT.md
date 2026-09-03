AURALITH — STANDING DEPLOYMENT RULE FOR GROK
RAILWAY REMOTE RELAY VS DESKTOP APP UI

PROJECT
Existing public Auralith repository:
https://github.com/dragonking587-ai/Auralith

THIS IS A PERMANENT WORKFLOW RULE FOR FUTURE AURALITH WORK.

CORE RULE

Auralith now has TWO distinct deployment surfaces:

1. PUBLIC REMOTE / RELAY SERVICE
   Railway service rooted at:
   services/audience-relay

2. AURALITH DESKTOP APPLICATION
   Existing Auralith Reborn/Tauri desktop application and its UI/build/release pipeline.

Do NOT treat these as one deployment target.

WHEN I ASK FOR A REMOTE / VIEWER / RELAY UPDATE

Examples:
- worldwide viewer voting
- public viewer page
- remote host control API
- WebSocket behavior
- room/session logic
- remote vote handling
- relay reconnection
- relay security/rate limiting
- public Mini Bubble web UI
- server-side poll state
- remote host/viewer transport

Then:
A. Modify only the files required for the relay/backend and any absolutely necessary shared protocol files.
B. Primary deployment target: Railway.
C. Deploy only the Railway relay service: services/audience-relay
D. Do NOT rebuild or release the entire Auralith desktop app unless the desktop app itself also requires a code/UI/protocol change.
E. Do NOT deploy the Tauri desktop app to Railway.
F. Do NOT redeploy unrelated desktop code to Railway.

WHEN I ASK FOR AN AURALITH UI / DESKTOP UPDATE

Examples:
- Audience Polls host UI
- detached Host Controls
- Output panel
- buttons
- relay status display
- effect controls
- Clean Capture UI
- editor layout
- settings
- native windows

Then:
A. Modify the actual Auralith desktop application.
B. Use the normal desktop build/release workflow.
C. Do NOT redeploy Railway unless the desktop change requires a matching relay/backend change.

WHEN AN UPDATE REQUIRES BOTH RAILWAY + DESKTOP

If one feature requires both backend/relay behavior and desktop UI/client behavior:

1. Clearly separate the work into:
   PART A — Railway Relay
   PART B — Auralith Desktop/UI
2. Keep protocol/message changes explicit.
3. Prefer backward-compatible relay protocol changes where practical.
4. Deploy Railway first when the new desktop requires new relay capability.
5. Verify Railway build, /health, WSS connection, and existing viewer behavior.
6. Then update/build/release the Auralith desktop app.
7. Do not break currently installed Auralith clients during the Railway rollout if backward compatibility is practical.

RAILWAY SERVICE ROOT

The Railway deployment root is:
services/audience-relay

Railway must build/deploy ONLY that service package.

Never treat the repository root or Tauri app as the Railway service root.

RAILWAY-ONLY CHANGE EXAMPLE

Request:
"Add server-side viewer rate limiting."

Expected:
- update services/audience-relay
- commit/push existing repo
- deploy Railway relay
- verify /health
- verify WSS/viewer behavior

Do NOT:
- rebuild Windows installer
- create desktop release
- modify desktop UI without need

DESKTOP-ONLY CHANGE EXAMPLE

Request:
"Move Public Relay controls into a new accordion."

Expected:
- update desktop UI
- commit/push
- build/test desktop
- publish normal Auralith release if requested

Do NOT:
- redeploy Railway
- change server behavior unnecessarily

BOTH-SIDES CHANGE EXAMPLE

Request:
"Add a new remote host command called Pause Voting."

Expected:

RAILWAY:
- add authenticated host command
- add protocol support
- deploy Railway
- verify

DESKTOP:
- add Pause Voting button/state
- update PollRelayTransport client handling
- build/release desktop

Keep both changes clearly separated in report.

SOURCE CONTROL

Use ONLY the existing public Auralith repository.

No new GitHub repository.

Relay and desktop can be committed separately when practical.

Preferred commit structure:
relay: <description>
desktop: <description>

RAILWAY DEPLOYMENT REPORT

For relay changes report:

RAILWAY CHANGED:
YES/NO

RAILWAY SERVICE ROOT:
services/audience-relay

RAILWAY DEPLOY:
PASS/FAIL/NOT REQUIRED

PUBLIC DOMAIN:

HEALTH:
PASS/FAIL/NOT REQUIRED

WSS:
PASS/FAIL/NOT REQUIRED

REMOTE VIEWER:
PASS/FAIL/NOT REQUIRED

DESKTOP DEPLOYMENT REPORT

For desktop changes report:

DESKTOP CHANGED:
YES/NO

DESKTOP BUILD:
PASS/FAIL/NOT REQUIRED

INSTALLER:
<path/version or NOT REQUIRED>

APP VERSION:

COMMIT:

TAG:

RELEASE:
PASS/FAIL/NOT REQUIRED

DO NOT BREAK

Preserve:
- Local/LAN polls
- Railway Public Relay
- detached Host Controls
- viewer Full Page
- Mini Bubble
- Poll Bubble
- temporary poll effect overrides
- Clean Capture
- Clean Output
- Save/Open
- audio
- effects
- updater
- virtual camera if present

Do not reintroduce Trace or AI unless explicitly requested.

Do not regenerate updater signing keys.

ABSOLUTE RULE

Never redeploy the entire Auralith desktop application to Railway.

Never rebuild/release the desktop application for a Railway-only backend change unless the desktop code actually changed.

Never redeploy Railway for a desktop-only visual/UI change unless the relay/backend actually changed.

When both sides change, explicitly separate:
RAILWAY RELAY CHANGES
from
AURALITH DESKTOP/UI CHANGES.
