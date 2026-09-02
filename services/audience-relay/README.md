# Auralith Audience Relay

Public RED/GREEN poll transport for Auralith Reborn.

This package lives in the existing Auralith repository. It is **not** a separate GitHub repo.

## Status

**NOT DEPLOYED** until you publish a Worker with a public HTTPS hostname.

Do not treat local code as worldwide voting.

## What it does

- Room create / lookup
- Host session token (secret)
- Public room code
- One vote per viewer per round
- Optional vote change
- Authoritative tallies
- Host start / end / clear / reset
- WebSocket fanout

It does **not** receive projects, images, shaders, filesystem, updater, or virtual-camera commands.

## Environment

Set in Cloudflare (never commit values):

- `RELAY_ENV` — development | production
- `ALLOWED_ORIGINS` — comma-separated origins for host CORS (viewer is same-origin)
- `ROOM_TTL_MS` — inactive room expiry
- `HOST_GRACE_MS` — host disconnect grace

## Deploy

```bash
cd services/audience-relay
npm install
npx wrangler login
npx wrangler deploy
```

Optional custom domain later: `vote.auralith.app` → this Worker.

Copy the `https://….workers.dev` URL into Auralith:

Viewer Connection → Public Relay → Relay URL

## Desktop config

Auralith setting: Public Relay base URL  
Example: `https://auralith-audience-relay.<account>.workers.dev`

No inbound ports on the host PC. The desktop opens outbound HTTPS/WSS only.

## Local fallback

Auralith still includes Local / LAN Test mode. Use that when the public Worker is offline.
