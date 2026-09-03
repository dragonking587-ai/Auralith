import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { landingHtml, viewerHtml } from "./viewer.js";

type Vote = "red" | "green";

type AllowedReaction = {
  id: string;
  label: string;
  enabled: boolean;
  iconKey: string;
  cooldownMs: number;
};

type Room = {
  code: string;
  hostToken: string;
  question: string;
  redLabel: string;
  greenLabel: string;
  allowChange: boolean;
  running: boolean;
  roundId: string;
  red: number;
  green: number;
  votes: Map<string, Vote>;
  hostSeen: number;
  created: number;
  hosts: Set<WebSocket>;
  views: Set<WebSocket>;
  reactionsEnabled: boolean;
  allowedReactions: AllowedReaction[];
  viewerCooldownMs: number;
  globalCooldownMs: number;
  lastReactionAt: number;
  lastByViewer: Map<string, number>;
  budget: Map<string, number[]>;
};


const SAFE_REACTION_IDS = ["fireworks", "lightning", "rune_burst", "meteor_shower"] as const;
const DEFAULT_REACTIONS: AllowedReaction[] = [
  { id: "fireworks", label: "Fireworks", enabled: true, iconKey: "fireworks", cooldownMs: 5000 }
];

function clamp(n: number, lo: number, hi: number, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

function sanitizeAllowed(list: any): AllowedReaction[] {
  if (!Array.isArray(list)) return DEFAULT_REACTIONS.map((r) => ({ ...r }));
  const out: AllowedReaction[] = [];
  const seen = new Set<string>();
  for (const item of list.slice(0, 4)) {
    const id = String(item?.id || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!(SAFE_REACTION_IDS as readonly string[]).includes(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: String(item?.label || id).slice(0, 24),
      enabled: item?.enabled !== false,
      iconKey: String(item?.iconKey || id).slice(0, 24),
      cooldownMs: clamp(item?.cooldownMs, 1000, 60000, 5000)
    });
  }
  return out.length ? out : DEFAULT_REACTIONS.map((r) => ({ ...r }));
}

function publicReactions(r: Room) {
  if (!r.reactionsEnabled) return [];
  return r.allowedReactions.filter((x) => x.enabled).map((x) => ({
    id: x.id,
    label: x.label,
    enabled: true,
    iconKey: x.iconKey,
    cooldownMs: x.cooldownMs
  }));
}

const rooms = new Map<string, Room>();
const rate = new Map<string, { n: number; t: number }>();
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS || 7_200_000);
const HOST_GRACE_MS = Number(process.env.HOST_GRACE_MS || 300_000);

function makeCode() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const n = "23456789";
  const pick = (s: string, k: number) => Array.from({ length: k }, () => s[Math.floor(Math.random() * s.length)]).join("");
  return pick(a, 4) + "-" + pick(n + a.slice(0, 8), 4);
}

function token() {
  return crypto.randomBytes(24).toString("hex");
}

function publicState(r: Room) {
  return {
    room: r.code,
    question: r.question,
    red_label: r.redLabel,
    green_label: r.greenLabel,
    running_poll: r.running,
    round_id: r.roundId,
    red: r.red,
    green: r.green,
    host_online: Date.now() - r.hostSeen < 20_000,
    status: r.running ? "LIVE" : "WAITING",
    reactions_enabled: r.reactionsEnabled,
    allowed_reactions: publicReactions(r)
  };
}

function json(res: http.ServerResponse, data: unknown, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  });
  res.end(body);
}

function html(res: http.ServerResponse, body: string, status = 200) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

function readBody(req: http.IncomingMessage) {
  return new Promise<any>((resolve) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > 4096) { resolve({}); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

function limited(key: string, max: number) {
  const now = Date.now();
  const cur = rate.get(key);
  if (!cur || now - cur.t > 60_000) { rate.set(key, { n: 1, t: now }); return false; }
  cur.n += 1;
  return cur.n > max;
}

function applyVote(room: Room, body: any) {
  const option: Vote | "" = body?.option === "green" ? "green" : body?.option === "red" ? "red" : "";
  const viewer = String(body?.viewerSessionId || "").slice(0, 64);
  const round = String(body?.roundId || room.roundId);
  if (!option || !viewer) return { ok: false, error: "invalid_vote" };
  if (round !== room.roundId) return { ok: false, error: "stale_round", ...publicState(room) };
  if (!room.running) return { ok: false, error: "not_live", ...publicState(room) };
  const prev = room.votes.get(viewer);
  if (prev === option) return { ok: true, duplicate: true, ...publicState(room) };
  if (prev && !room.allowChange) return { ok: false, error: "already_voted", ...publicState(room) };
  if (prev && room.allowChange) {
    room[prev] -= 1;
    room[option] += 1;
  } else {
    room[option] += 1;
  }
  room.votes.set(viewer, option);
  return { ok: true, ...publicState(room) };
}

function applyHost(room: Room, body: any) {
  const action = String(body?.action || "");
  room.hostSeen = Date.now();
  if (action === "startPoll") room.running = true;
  if (action === "endPoll") room.running = false;
  if (action === "clearVotes" || action === "resetRound") {
    room.red = 0; room.green = 0; room.votes = new Map();
    room.roundId = "r-" + Date.now().toString(36);
    if (action === "resetRound") room.running = false;
  }
  if (action === "updatePollMetadata") {
    if (body.question) room.question = String(body.question).slice(0, 160);
    if (body.redLabel) room.redLabel = String(body.redLabel).slice(0, 24);
    if (body.greenLabel) room.greenLabel = String(body.greenLabel).slice(0, 24);
    if (typeof body.allowChange === "boolean") room.allowChange = body.allowChange;
  }
  if (action === "closeRoom") room.running = false;
  if (action === "set_allowed_reactions" || action === "setAllowedReactions") {
    room.allowedReactions = sanitizeAllowed(body.allowedReactions || body.reactions);
    if (typeof body.viewerCooldownMs === "number") room.viewerCooldownMs = clamp(body.viewerCooldownMs, 1000, 60000, 5000);
    if (typeof body.globalCooldownMs === "number") room.globalCooldownMs = clamp(body.globalCooldownMs, 250, 10000, 1000);
  }
  if (action === "disable_reactions" || action === "disableReactions") room.reactionsEnabled = false;
  if (action === "enable_reactions" || action === "enableReactions") room.reactionsEnabled = true;
}


function applyReaction(room: Room, body: any) {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_reaction" };
  const blocked = ["effectId","targetId","shader","color","duration","intensity","hostToken","action","command"];
  for (const k of Object.keys(body)) {
    if (blocked.includes(k)) return { ok: false, error: "unsafe_field" };
  }
  const reactionId = String(body?.reactionId || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
  const viewer = String(body?.viewerSessionId || "").slice(0, 64);
  if (!viewer || !reactionId) return { ok: false, error: "invalid_reaction" };
  if (!room.reactionsEnabled) return { ok: false, error: "reactions_disabled" };
  if (room.hosts.size === 0 && Date.now() - room.hostSeen > 20_000) return { ok: false, error: "host_offline" };
  const allowed = room.allowedReactions.find((r) => r.id === reactionId && r.enabled);
  if (!allowed) return { ok: false, error: "reaction_not_allowed" };
  const now = Date.now();
  if (now - room.lastReactionAt < room.globalCooldownMs) return { ok: false, error: "global_cooldown", retryMs: room.globalCooldownMs - (now - room.lastReactionAt) };
  const last = room.lastByViewer.get(viewer) || 0;
  const need = Math.max(room.viewerCooldownMs, allowed.cooldownMs);
  if (now - last < need) return { ok: false, error: "viewer_cooldown", retryMs: need - (now - last) };
  const stamps = (room.budget.get(viewer) || []).filter((t) => now - t < 30_000);
  if (stamps.length >= 3) return { ok: false, error: "budget" };
  stamps.push(now);
  room.budget.set(viewer, stamps);
  room.lastByViewer.set(viewer, now);
  room.lastReactionAt = now;
  const event = {
    type: "audience_reaction",
    roomId: room.code,
    reactionId: allowed.id,
    viewerSessionId: viewer,
    eventId: "e-" + crypto.randomBytes(8).toString("hex"),
    timestamp: now
  };
  const msg = JSON.stringify(event);
  for (const s of room.hosts) {
    try { s.send(msg); } catch { room.hosts.delete(s); }
  }
  return { ok: true, reactionId: allowed.id, eventId: event.eventId };
}

function fanout(room: Room) {
  const msg = JSON.stringify({ type: "state", ...publicState(room) });
  for (const s of [...room.hosts, ...room.views]) {
    try { s.send(msg); } catch { room.hosts.delete(s); room.views.delete(s); }
  }
}

function sweep() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const idle = now - room.hostSeen > HOST_GRACE_MS && now - room.created > ROOM_TTL_MS;
    if (idle && room.hosts.size === 0) rooms.delete(code);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type,authorization",
      "access-control-allow-methods": "GET,POST,OPTIONS"
    });
    res.end();
    return;
  }

  if (path === "/health") {
    json(res, { ok: true, env: process.env.RELAY_ENV || "railway", rooms: rooms.size });
    return;
  }

  if (path === "/" && req.method === "GET") {
    html(res, landingHtml());
    return;
  }

  if (req.method === "POST" && path === "/api/rooms") {
    if (limited("create:" + (req.socket.remoteAddress || "x"), 20)) { json(res, { error: "rate_limited" }, 429); return; }
    const body = await readBody(req);
    let code = makeCode();
    while (rooms.has(code)) code = makeCode();
    const room: Room = {
      code,
      hostToken: (body.hostToken && String(body.hostToken)) || token(),
      question: String(body.question || "Which color?").slice(0, 160),
      redLabel: String(body.redLabel || "RED").slice(0, 24),
      greenLabel: String(body.greenLabel || "GREEN").slice(0, 24),
      allowChange: !!body.allowChange,
      running: false,
      roundId: "r-1",
      red: 0,
      green: 0,
      votes: new Map(),
      hostSeen: Date.now(),
      created: Date.now(),
      hosts: new Set(),
      views: new Set(),
      reactionsEnabled: true,
      allowedReactions: sanitizeAllowed(body.allowedReactions),
      viewerCooldownMs: clamp(body.viewerCooldownMs, 1000, 60000, 5000),
      globalCooldownMs: clamp(body.globalCooldownMs, 250, 10000, 1000),
      lastReactionAt: 0,
      lastByViewer: new Map(),
      budget: new Map()
    };
    rooms.set(code, room);
    json(res, { room: code, hostToken: room.hostToken, viewerPath: "/" + code });
    return;
  }

  const roomMatch = path.match(/^\/(?:api\/rooms\/)?([A-Z0-9]{4}-[A-Z0-9]{4})(?:\/(state|vote|host|react))?$/i);
  if (roomMatch) {
    const code = roomMatch[1].toUpperCase();
    const action = roomMatch[2] || "";
    const room = rooms.get(code);
    if (!room) { json(res, { error: "invalid_room" }, 404); return; }

    if (req.method === "GET" && (action === "state" || action === "")) {
      if (action === "" && !path.startsWith("/api/")) { html(res, viewerHtml(code)); return; }
      json(res, publicState(room));
      return;
    }
    if (req.method === "POST" && action === "vote") {
      if (limited("vote:" + (req.socket.remoteAddress || "x"), 30)) { json(res, { error: "rate_limited" }, 429); return; }
      const body = await readBody(req);
      const out = applyVote(room, body);
      if (out.ok) fanout(room);
      json(res, out, out.ok ? 200 : 400);
      return;
    }
    if (req.method === "POST" && action === "react") {
      if (limited("react:" + (req.socket.remoteAddress || "x"), 40)) { json(res, { error: "rate_limited" }, 429); return; }
      const body = await readBody(req);
      const out = applyReaction(room, body);
      json(res, out, out.ok ? 200 : 400);
      return;
    }
    if (req.method === "POST" && action === "host") {
      const auth = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (auth !== room.hostToken) { json(res, { error: "unauthorized" }, 401); return; }
      const body = await readBody(req);
      applyHost(room, body);
      fanout(room);
      json(res, publicState(room));
      return;
    }
  }

  if (/^\/[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(path) && req.method === "GET") {
    const code = path.slice(1).toUpperCase();
    if (!rooms.has(code)) { html(res, landingHtml() + `<p>Unknown room.</p>`, 404); return; }
    html(res, viewerHtml(code));
    return;
  }

  json(res, { error: "not_found" }, 404);
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", "http://localhost");
  const host = url.pathname.match(/^\/ws\/host\/([A-Z0-9]{4}-[A-Z0-9]{4})$/i);
  const view = url.pathname.match(/^\/ws\/view\/([A-Z0-9]{4}-[A-Z0-9]{4})$/i);
  const code = (host?.[1] || view?.[1] || "").toUpperCase();
  const room = rooms.get(code);
  if (!room) { socket.destroy(); return; }
  if (host) {
    const tok = url.searchParams.get("token") || "";
    if (tok !== room.hostToken) { socket.destroy(); return; }
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (host) {
      room.hosts.add(ws);
      room.hostSeen = Date.now();
      ws.on("message", (raw) => {
        try { applyHost(room, JSON.parse(String(raw))); fanout(room); } catch { /* ignore */ }
      });
      ws.on("close", () => room.hosts.delete(ws));
    } else {
      room.views.add(ws);
      ws.on("close", () => room.views.delete(ws));
    }
    try { ws.send(JSON.stringify({ type: "state", ...publicState(room) })); } catch { /* ignore */ }
  });
});

setInterval(sweep, 60_000).unref();

const port = Number(process.env.PORT || 8787);
server.listen(port, "0.0.0.0", () => {
  console.log(`[relay] listening on 0.0.0.0:${port}`);
});
