export interface Env {
  ROOM: DurableObjectNamespace;
  RELAY_ENV?: string;
  ALLOWED_ORIGINS?: string;
  ROOM_TTL_MS?: string;
  HOST_GRACE_MS?: string;
}

type Vote = "red" | "green";

type RoomData = {
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
  votes: Record<string, Vote>;
  hostSeen: number;
  created: number;
};

const DEFAULT: Omit<RoomData, "code" | "hostToken"> = {
  question: "Which color?",
  redLabel: "RED",
  greenLabel: "GREEN",
  allowChange: false,
  running: false,
  roundId: "r-1",
  red: 0,
  green: 0,
  votes: {},
  hostSeen: Date.now(),
  created: Date.now()
};

function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra }
  });
}

function publicState(r: RoomData) {
  return {
    room: r.code,
    question: r.question,
    red_label: r.redLabel,
    green_label: r.greenLabel,
    running_poll: r.running,
    round_id: r.roundId,
    red: r.red,
    green: r.green,
    host_online: Date.now() - r.hostSeen < 20000,
    status: r.running ? "LIVE" : "WAITING"
  };
}

function cors(req: Request, env: Env) {
  const origin = req.headers.get("Origin") || "";
  const allow = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = !origin || allow.length === 0 || allow.includes(origin) || allow.includes("*");
  return {
    "access-control-allow-origin": ok ? (origin || "*") : allow[0] || "*",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  };
}

function codeFromPath(path: string) {
  const m = path.match(/^\/(?:api\/rooms\/|r\/|ws\/(?:host|view)\/|)?([A-Z0-9]{4}-[A-Z0-9]{4})(?:\/|$)/i);
  return m ? m[1].toUpperCase() : "";
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, env) });
    if (path === "/health") return json({ ok: true, env: env.RELAY_ENV || "development" }, 200, cors(req, env));

    if (path === "/api/rooms" && req.method === "POST") {
      const code = makeCode();
      const id = env.ROOM.idFromName(code);
      const stub = env.ROOM.get(id);
      return stub.fetch(new Request(new URL("/internal/create?code=" + code, url).toString(), { method: "POST", body: await req.text(), headers: req.headers }));
    }

    const code = codeFromPath(path) || url.searchParams.get("room") || "";
    if (path === "/" || path.startsWith("/r/") || /^\/[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(path)) {
      if (path === "/" && !code) return new Response(landing(), { headers: { "content-type": "text/html; charset=utf-8" } });
      const room = code || path.slice(1);
      if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(room)) return new Response("Invalid room", { status: 400 });
      return new Response(viewerHtml(room.toUpperCase()), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (!code) return json({ error: "not_found" }, 404, cors(req, env));
    const stub = env.ROOM.get(env.ROOM.idFromName(code.toUpperCase()));
    return stub.fetch(req);
  }
};

export class PollRoom {
  state: DurableObjectState;
  env: Env;
  hosts = new Set<WebSocket>();
  views = new Set<WebSocket>();
  last = 0;
  votesMin = new Map<string, number>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req: Request) {
    const url = new URL(req.url);
    const path = url.pathname;
    const h = cors(req, this.env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });

    if (path.endsWith("/internal/create") || path.includes("/internal/create")) {
      const body = await readJson(req);
      const token = (body.hostToken && String(body.hostToken)) || randomToken();
      const room: RoomData = {
        ...DEFAULT,
        code: url.searchParams.get("code") || makeCode(),
        hostToken: token,
        question: String(body.question || DEFAULT.question).slice(0, 160),
        redLabel: String(body.redLabel || "RED").slice(0, 24),
        greenLabel: String(body.greenLabel || "GREEN").slice(0, 24),
        allowChange: !!body.allowChange,
        created: Date.now(),
        hostSeen: Date.now()
      };
      await this.state.storage.put("room", room);
      return json({ room: room.code, hostToken: token, viewerPath: "/" + room.code }, 200, h);
    }

    const room = (await this.state.storage.get<RoomData>("room")) || null;
    if (!room) return json({ error: "invalid_room" }, 404, h);

    if (path.includes("/ws/host/") && req.headers.get("Upgrade") === "websocket") {
      const token = url.searchParams.get("token") || "";
      if (token !== room.hostToken) return json({ error: "unauthorized" }, 401, h);
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.accept();
      this.hosts.add(server);
      room.hostSeen = Date.now();
      await this.state.storage.put("room", room);
      server.send(JSON.stringify({ type: "state", ...publicState(room) }));
      server.addEventListener("message", (ev) => { this.onHostMessage(room, String(ev.data)).catch(() => {}); });
      server.addEventListener("close", () => this.hosts.delete(server));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (path.includes("/ws/view/") && req.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.accept();
      this.views.add(server);
      server.send(JSON.stringify({ type: "state", ...publicState(room) }));
      server.addEventListener("close", () => this.views.delete(server));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (req.method === "GET" && (path.endsWith("/state") || path.includes("/api/rooms/"))) {
      return json(publicState(room), 200, h);
    }

    if (req.method === "POST" && path.endsWith("/vote")) {
      if (!this.rate("v:" + (req.headers.get("cf-connecting-ip") || "x"), 8)) return json({ error: "rate_limited" }, 429, h);
      const body = await readJson(req);
      const out = this.applyVote(room, body);
      await this.state.storage.put("room", room);
      this.fanout(room);
      return json(out, out.ok ? 200 : 400, h);
    }

    if (req.method === "POST" && path.endsWith("/host")) {
      const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (auth !== room.hostToken) return json({ error: "unauthorized" }, 401, h);
      const body = await readJson(req);
      this.applyHost(room, body);
      await this.state.storage.put("room", room);
      this.fanout(room);
      return json(publicState(room), 200, h);
    }

    return json({ error: "not_found" }, 404, h);
  }

  rate(key: string, max: number) {
    const now = Date.now();
    const n = (this.votesMin.get(key) || 0) + 1;
    if (now - this.last > 60000) { this.votesMin.clear(); this.last = now; }
    this.votesMin.set(key, n);
    return n <= max;
  }

  applyVote(room: RoomData, body: any) {
    const option = body?.option === "green" ? "green" : body?.option === "red" ? "red" : "";
    const viewer = String(body?.viewerSessionId || "").slice(0, 64);
    const round = String(body?.roundId || room.roundId);
    if (!option || !viewer) return { ok: false, error: "invalid_vote" };
    if (round !== room.roundId) return { ok: false, error: "stale_round", ...publicState(room) };
    if (!room.running) return { ok: false, error: "not_live", ...publicState(room) };
    const prev = room.votes[viewer];
    if (prev === option) return { ok: true, duplicate: true, ...publicState(room) };
    if (prev && !room.allowChange) return { ok: false, error: "already_voted", ...publicState(room) };
    if (prev && room.allowChange) {
      room[prev] -= 1;
      room[option] += 1;
    } else {
      room[option] += 1;
    }
    room.votes[viewer] = option as Vote;
    return { ok: true, ...publicState(room) };
  }

  applyHost(room: RoomData, body: any) {
    const action = String(body?.action || "");
    room.hostSeen = Date.now();
    if (action === "startPoll") room.running = true;
    if (action === "endPoll") room.running = false;
    if (action === "clearVotes" || action === "resetRound") {
      room.red = 0; room.green = 0; room.votes = {};
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
  }

  async onHostMessage(room: RoomData, raw: string) {
    let body: any = {};
    try { body = JSON.parse(raw); } catch { return; }
    if (body.type === "ping") { room.hostSeen = Date.now(); await this.state.storage.put("room", room); return; }
    this.applyHost(room, body);
    await this.state.storage.put("room", room);
    this.fanout(room);
  }

  fanout(room: RoomData) {
    const msg = JSON.stringify({ type: "state", ...publicState(room) });
    for (const s of [...this.hosts, ...this.views]) {
      try { s.send(msg); } catch { this.hosts.delete(s); this.views.delete(s); }
    }
  }
}

async function readJson(req: Request) {
  try {
    const t = await req.text();
    if (t.length > 4096) return {};
    return t ? JSON.parse(t) : {};
  } catch { return {}; }
}

function makeCode() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const n = "23456789";
  const pick = (s: string, k: number) => Array.from({ length: k }, () => s[Math.floor(Math.random() * s.length)]).join("");
  return pick(a, 4) + "-" + pick(n + a.slice(0, 8), 4);
}

function randomToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function landing() {
  return `<!doctype html><html><body style="font-family:Georgia;background:#120c08;color:#f4e4b0;padding:24px"><h1>Auralith Audience Relay</h1><p>Open a room URL from your host app. This service is poll transport only.</p></body></html>`;
}

function viewerHtml(room: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auralith Poll ${room}</title>
<style>
body{margin:0;min-height:100vh;background:#120c08;color:#f4e4b0;font-family:Georgia,serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px}
button{min-width:120px;min-height:48px;padding:14px 18px;border:0;border-radius:12px;font-size:18px;color:#fff}
#r{background:#e23a3a}#g{background:#2fbf5a}
.bubble{width:min(360px,92vw);background:rgba(18,12,8,.88);border:1px solid #d4af37;border-radius:22px;padding:16px}
body.mini{justify-content:flex-end}
body.mini .full-only{display:none}
.modes button{background:#2a2114;color:#f4e4b0;min-width:auto;font-size:13px}
</style></head><body>
<p class="full-only">AURALITH PUBLIC POLL · ${room} · web page, not a system overlay</p>
<div class="modes"><button id="full">Full Page</button><button id="mini">Mini Bubble</button></div>
<div id="card">
<h1 id="q">Connecting…</h1>
<p id="st">Waiting for host...</p>
<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center"><button id="r">RED</button><button id="g">GREEN</button></div>
<p id="msg"></p><p id="tally"></p>
</div>
<script>
const room = ${JSON.stringify(room)};
const proto = location.protocol === "https:" ? "wss:" : "ws:";
let round = "";
const vid = localStorage.getItem("vid") || (localStorage.setItem("vid","v-"+Math.random().toString(36).slice(2,10)), localStorage.getItem("vid"));
function apply(s){
  round = s.round_id || round;
  document.getElementById("q").textContent = s.question || "Which color?";
  document.getElementById("r").textContent = s.red_label || "RED";
  document.getElementById("g").textContent = s.green_label || "GREEN";
  document.getElementById("st").textContent = s.running_poll ? "Voting open" : (s.host_online === false ? "Host temporarily disconnected. Waiting for host..." : "No active poll. Waiting for host...");
  document.getElementById("tally").textContent = (s.red_label||"RED")+" "+(s.red||0)+" · "+(s.green_label||"GREEN")+" "+(s.green||0);
  document.getElementById("r").disabled = !s.running_poll;
  document.getElementById("g").disabled = !s.running_poll;
}
async function vote(option){
  const r = await fetch("/api/rooms/"+room+"/vote",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({option,viewerSessionId:vid,roundId:round})});
  const j = await r.json().catch(()=>({}));
  document.getElementById("msg").textContent = r.ok && j.ok ? "Vote received ✓" : (j.error || "Vote failed");
  if (j.red != null) apply(j);
}
document.getElementById("r").onclick=()=>vote("red");
document.getElementById("g").onclick=()=>vote("green");
function mode(m){ const mini=m==="mini"; document.body.classList.toggle("mini",mini); document.getElementById("card").classList.toggle("bubble",mini); }
document.getElementById("full").onclick=()=>mode("full");
document.getElementById("mini").onclick=()=>mode("mini");
if (new URLSearchParams(location.search).get("mode")==="bubble") mode("mini");
try {
  const ws = new WebSocket(proto+"//"+location.host+"/ws/view/"+room);
  ws.onmessage = (e)=>{ try{ apply(JSON.parse(e.data)); }catch(err){} };
  ws.onclose = ()=> setTimeout(()=>location.reload(), 2000);
} catch(e) {}
fetch("/api/rooms/"+room+"/state").then(r=>r.json()).then(apply).catch(()=>{});
</script></body></html>`;
}
