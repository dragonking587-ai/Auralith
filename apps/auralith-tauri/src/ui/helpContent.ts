export const MAIN_TUTORIAL = [
  { title: "Main workspace", body: "The center is your scene. The toolbar loads images and tools. The right inspector holds Effects, Audio, Output, and Settings. Clean Output is what the audience sees. Public Server and Help live in Output/Settings." },
  { title: "Load a scene", body: "Load Image places the backdrop. Save/Open store the project. Add Shapes, Props, Emitters, and Stamps as targets. Effects attach to those targets, not to a hidden second scene." },
  { title: "Effects", body: "Add an effect, then use its named sliders, colors, presets, and audio bands. Changes are live. Audience poll colors are temporary overrides and do not permanently rewrite the saved effect color." },
  { title: "Clean Output", body: "Clean Output / Clean Capture show only the finished scene. Editor handles, menus, and Host QR never appear there. Use this window for OBS / Streamlabs / TikTok LIVE Studio." },
  { title: "Public Server", body: "Choose a room name such as OBSIDIAN-WOLF, Check Availability, then Start Public Server. Stopping the server does not give the name away. Release Room Name is the destructive action that frees the name." },
  { title: "Polls", body: "Set the question and RED/GREEN labels. Start Poll begins voting. End Poll stops it. Clear Votes starts a new round at 0–0. Viewers must vote again. Clear + Restore also removes temporary poll colors." },
  { title: "Viewer QR", body: "Viewer QR is PUBLIC. It is safe on stream. Phones open the Railway voting page for this room and can vote or send allowed reactions." },
  { title: "Host QR", body: "Host QR is PRIVATE. Never show it on stream. It is short-lived and one-time. The desktop must Approve. Revoke any device at any time. A valid Host QR uses https://obsidian-production-6e2e.up.railway.app/host/pair/..." },
  { title: "Audience Reactions", body: "Enable reactions, then viewers can trigger Fireworks, Lightning, Rune Burst, or Meteor Shower. Cooldowns prevent spam. Clear Active Reactions removes live bursts. They do not save into the project." },
  { title: "Fireworks", body: "Preview Fireworks uses the same renderer as a viewer trigger. Tune Preset, Intensity, Shell Count, Pattern, Brightness, Smoke, Bloom, and Duration. Only the configuration is saved, not live shells." },
  { title: "Host Console", body: "Auralith Host Console is a separate Windows app. Main Auralith keeps rendering. Pair Host Console with a Host QR, Approve it, and control polls from another screen. Closing Host Console does not stop the stream." },
  { title: "Updates", body: "Check for Updates contacts the official GitHub feed. Download & Install verifies the signed installer, then restarts this app only. Warn before updating during a live Public Server session. View Release is the manual fallback." }
];

export const MAIN_HELP: { id: string; title: string; body: string }[] = [
  { id: "start", title: "Getting Started", body: "Load an image, add targets, stack effects, then Start Public Server if you want audience voting. Use Help anytime. Reset Tutorials from Settings to see the walkthrough again." },
  { id: "workspace", title: "Main Workspace", body: "Canvas is the scene. Tools select Shapes, Props, Emitters, and Stamps. Inspector tabs are Effects, Audio, Output, and Settings." },
  { id: "load", title: "Load Scene", body: "Load Image opens a file picker. Props use PNG/WebP alpha as the effect silhouette. Shapes are geometry targets. Emitters and Stamps are point targets." },
  { id: "resize", title: "Resize a Prop", body: "Select a Prop to see a gold box and eight handles. Drag a corner to scale proportionally. Drag an edge to change width or height only. Drag the Prop body to move it. Handles are editor-only and never appear in Clean Capture." },
  { id: "effects", title: "Effects", body: "Each stacked effect has its own accordion. Named sliders only. Audio mapping uses Bass / Low / Mid / High / Beat / Transient. Poll colors are runtime overrides." },
  { id: "save", title: "Save / Open", body: "Save writes the project including backdrop, targets, effects, poll config, and fireworks settings. Active fireworks, votes, and cooldowns are not saved." },
  { id: "clean", title: "Clean Output / Clean Capture", body: "This is the stream feed: backdrop + effects only. No editor chrome. No Host QR. ESC leaves fullscreen Clean Capture." },
  { id: "server", title: "Public Server", body: "Start Public Server claims your room and opens the host socket. The room stays yours after Stop. Heartbeat keeps host_online true." },
  { id: "owner", title: "Room Ownership", body: "The first desktop that claims a name owns it. Another PC cannot take OBSIDIAN-WOLF unless you Release Room Name." },
  { id: "release", title: "Release Room", body: "Release Room Name gives the name away. Do this only if you want someone else to use that room." },
  { id: "poll", title: "Poll Controls", body: "Start / End / Clear Votes / Clear + Restore / Reset / Show Results. Start Poll does not change the room name." },
  { id: "clear", title: "Clear Votes / New Round", body: "Clear Votes increments the round, sets RED=0 GREEN=0, clears the old vote map, and removes poll color overrides. Old votes must not return. Viewers vote again in the new round." },
  { id: "vqr", title: "Viewer QR", body: "PUBLIC. Safe on stream. Encodes https://obsidian-production-6e2e.up.railway.app/<ROOM>." },
  { id: "hqr", title: "Host QR", body: "PRIVATE. Never on stream. Short-lived pairing URL. Phone/Host Console claims it, desktop Approves, session can be revoked." },
  { id: "rx", title: "Audience Reactions", body: "Host enables the reaction set. Viewers only send an allowed reactionId such as fireworks. They cannot set shaders or colors." },
  { id: "fw", title: "Fireworks", body: "Preview and viewer triggers share one renderer. Tune named realism controls. Quality modes change particle budget." },
  { id: "console", title: "Host Console", body: "Install the separate Host Console app. Pair it. It cannot open files, update Main Auralith, or show Host QR on the stream." },
  { id: "devices", title: "Authorized Devices / Revoke", body: "Listed devices can send allowed commands. Revoke one device or Revoke All. Disable All Remote Host Control blocks every remote until Enable is pressed." },
  { id: "updates", title: "Updates", body: "Check for Updates, Download & Install, Retry, View Details, View Release. Main Auralith installs only the Main Auralith artifact." },
  { id: "trouble", title: "Troubleshooting", body: "PUBLIC SERVER OFFLINE: Start Public Server and watch relay status.\nPOLL NOT LIVE: Start Public Server, then Start Poll.\nQR WON'T SCAN: use the large black/white Show QR modal.\nHOST QR OPENS tauri.localhost: update Auralith and generate a new Host QR.\nCLEAR VOTES RETURNS OLD VOTE: use a build that increments roundId.\nUPDATE 404: View Details, then View Release and install the official Setup.exe." }
];

export const CONSOLE_TUTORIAL = [
  { title: "Pair With Auralith", body: "Paste a Host QR URL from the desktop. Pair With Auralith claims it. Wait for desktop Approve. Do not reuse an old pairing link." },
  { title: "Remember This Host", body: "Optional. Saves this session on this PC only. It is not a permanent host token. Revoke on the desktop forgets it immediately." },
  { title: "Connection states", body: "CONNECTED means commands can run. OFFLINE means pair again. REVOKED means the desktop removed this device. PAIRING REQUIRED means Approve never finished." },
  { title: "Poll controls", body: "Start, End, Clear Votes, Clear + Restore, Reset, Question, RED/GREEN labels, Show Results. Clear Votes starts a new round. Old votes should not come back." },
  { title: "Audience Reactions", body: "Enable or disable reactions. Fireworks / Lightning / Rune / Meteor trigger the same live effects as viewers. Clear Active removes bursts." },
  { title: "Fireworks", body: "Preset, Intensity, Shells, Pattern, Brightness, Smoke, Bloom, Duration, then Apply Fireworks Settings or Preview." },
  { title: "Roles", body: "Full Host can run polls and effects. Poll Moderator cannot change effect settings. Effects Operator cannot reset polls. Unknown commands are rejected." },
  { title: "Updates", body: "Host Console Check for Updates only installs Host Console. Main Auralith keeps rendering. Download & Install restarts this window only." }
];

export const CONSOLE_HELP: { id: string; title: string; body: string }[] = [
  { id: "pair", title: "Pairing", body: "Generate a new Host QR on the desktop. Paste it here. Approve on Auralith. Expired links must be replaced." },
  { id: "remember", title: "Remember Host", body: "Stores the current session locally. Reconnect uses that session. If Railway restarted or the desktop revoked you, Forget Host and pair again." },
  { id: "states", title: "Connection States", body: "CONNECTED / RECONNECTING / OFFLINE / REVOKED / PAIRING REQUIRED. CONNECTED with unauthorized commands means the token is dead — pair again." },
  { id: "poll", title: "Poll Controls", body: "Same actions as the desktop poll panel. Clear Votes = new round." },
  { id: "rx", title: "Reactions", body: "Enable, Disable, Clear Active, Fireworks, Lightning, Rune, Meteor." },
  { id: "fw", title: "Fireworks", body: "Named sliders only. Preview uses the live renderer." },
  { id: "roles", title: "Roles", body: "The desktop chooses the role when it creates the Host QR." },
  { id: "updates", title: "Updates", body: "Uses latest-host-console.json. It must never install the main Auralith Setup.exe." },
  { id: "trouble", title: "Troubleshooting", body: "PAIRING EXPIRED: new QR.\nREVOKED: desktop Approve after a new pair.\nCOMMAND DENIED: role too limited.\nUNAUTHORIZED: Enable Remote Host Control on desktop, then pair again.\nOFFLINE: Main Auralith Public Server must be running.\nUPDATE FAILED: Retry or View Release." }
];
