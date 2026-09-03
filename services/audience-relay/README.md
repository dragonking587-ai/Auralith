# Auralith Audience Relay (Railway)

Public RED/GREEN poll transport for Auralith Reborn.

This package lives in the existing Auralith repository. It is **not** a separate GitHub repo.

Cloudflare Workers / Wrangler are **not** used.

## Architecture

- Node.js 18+
- TypeScript
- `http` + `ws`
- Bind `0.0.0.0`
- Port: `process.env.PORT` (Railway) or `8787` locally
- V1 state: **in-memory on one instance**
- Redis is not required for V1. Multiple Railway replicas will not share rooms.

## HTTP / WS

- `GET /health`
- `POST /api/rooms` — host creates a room (returns `room` + secret `hostToken`)
- `GET /:ROOM` — public viewer page
- `GET /api/rooms/:ROOM/state`
- `POST /api/rooms/:ROOM/vote` — `{ option, viewerSessionId, roundId }`
- `POST /api/rooms/:ROOM/host` — `Authorization: Bearer <hostToken>`
- `WS /ws/host/:ROOM?token=` — host outbound socket
- `WS /ws/view/:ROOM` — viewer live updates

Host token is never placed in viewer URLs.

Clear Votes increments `roundId` and keeps the same public room URL.

## Local run

```bash
cd services/audience-relay
npm install
npm run dev
# http://127.0.0.1:8787/health
```

## Railway deploy

Root of this package is `services/audience-relay`.

1. Create one Railway project.
2. Deploy this directory only (not the whole monorepo), or set the Railway service root to `services/audience-relay`.
3. Railway assigns `PORT` and an `*.up.railway.app` HTTPS domain.
4. Paste that origin (no path) into Auralith → Output → Audience Polls → Public Relay → Relay URL.

Example:

`https://auralith-audience-relay-production.up.railway.app`

## Desktop

`PollRelayTransport` already talks to this API. Local/LAN polling stays in the Tauri app if the relay is offline.

## Limits

- In-memory rooms die if the Railway instance restarts.
- No custom domain required for V1.
- Worldwide voting is unverified until a cellular-data phone vote reaches the host.

## Let Grok / GitHub Actions deploy to Railway

This remote environment cannot keep `railway login`.

Use a **Railway project token** as a GitHub Actions secret. Never commit it. Never paste it into chat.

1. Railway → project **Obsidian** → Settings → Tokens (or Account → Tokens).
2. Create a token scoped to **Obsidian**.
3. GitHub → https://github.com/dragonking587-ai/Auralith/settings/secrets/actions
4. New repository secret:
   - Name: `RAILWAY_TOKEN`
   - Value: the token (paste only on GitHub)
5. After that, any push to `services/audience-relay` on `tauri/auralith-reborn` deploys.
6. You can also run **Actions → Deploy audience relay → Run workflow**.

Public URL stays:

`https://obsidian-production-6e2e.up.railway.app`
DATA_DIR=/data
