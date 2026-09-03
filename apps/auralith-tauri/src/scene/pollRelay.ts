export type RelayStatus = "IDLE" | "CONNECTING" | "ONLINE" | "RECONNECTING" | "ERROR" | "NOT_CONFIGURED";

export type RelayPublicState = {
  room: string;
  question: string;
  red_label: string;
  green_label: string;
  running_poll: boolean;
  round_id: string;
  red: number;
  green: number;
  host_online?: boolean;
  status?: string;
};

export type RelaySession = {
  baseUrl: string;
  room: string;
  hostToken: string;
  viewerUrl: string;
  hostInstanceId?: string;
};

export function publicRelayOrigin(configured: string) {
  const raw = (configured || "").trim().replace(/\/$/, "");
  if (!raw || /tauri\.localhost|localhost|127\.0\.0\.1/i.test(raw)) {
    return "https://obsidian-production-6e2e.up.railway.app";
  }
  return raw;
}

export function rewritePublicPairingUrl(relayOrigin: string, rawQr: string, pairingId?: string) {
  const base = publicRelayOrigin(relayOrigin);
  try {
    const u = new URL(rawQr, base);
    const id = pairingId || u.pathname.split("/").filter(Boolean).pop() || "";
    const code = u.searchParams.get("code") || "";
    if (!id) return "";
    return base + "/host/pair/" + encodeURIComponent(id) + (code ? "?code=" + encodeURIComponent(code) : "");
  } catch {
    return "";
  }
}

function wsUrl(httpUrl: string, path: string) {
  const u = new URL(path, httpUrl.endsWith("/") ? httpUrl : httpUrl + "/");
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}

export class PollRelayTransport {
  status: RelayStatus = "IDLE";
  error = "";
  session: RelaySession | null = null;
  private ws: WebSocket | null = null;
  private tries = 0;
  private closed = false;
  private hb = 0;
  onStatus?: (s: RelayStatus, err: string) => void;
  onState?: (s: RelayPublicState) => void;
  onReaction?: (ev: { type: string; eventId?: string; reactionId?: string; roomId?: string; timestamp?: number }) => void;
  onRemote?: (ev: any) => void;

  configured(base?: string) {
    return !!(base || "").trim();
  }

  async connectHost(baseUrl: string, meta: { question: string; redLabel: string; greenLabel: string; allowChange: boolean; roomName?: string; hostInstanceId?: string; startPoll?: boolean }) {
    this.closed = false;
    const base = (baseUrl || "").trim().replace(/\/$/, "");
    if (/[<>]/.test(base) || /obsidian-service|your-service|your-worker/i.test(base)) {
      this.setStatus("NOT_CONFIGURED", "Paste the real Railway HTTPS origin from `railway domain`, not the example placeholder.");
      throw new Error(this.error);
    }
    try { new URL(base); } catch {
      this.setStatus("NOT_CONFIGURED", "Relay URL is not a valid origin.");
      throw new Error(this.error);
    }
    if (!base.startsWith("https://") && !base.startsWith("http://localhost") && !base.startsWith("http://127.0.0.1")) {
      this.setStatus("NOT_CONFIGURED", "Set an https:// relay URL (or localhost for development).");
      throw new Error(this.error);
    }
    this.setStatus("CONNECTING", "");
    const res = await fetch(base + "/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: meta.question, redLabel: meta.redLabel, greenLabel: meta.greenLabel, allowChange: meta.allowChange,
        roomName: meta.roomName, hostInstanceId: meta.hostInstanceId
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error === "room_name_unavailable" ? "Room name unavailable." : (data.error || "Relay room create failed (" + res.status + ")"));
    const room = String(data.room || "");
    const hostToken = String(data.hostToken || "");
    if (!room || !hostToken) throw new Error("Relay did not return room/token");
    this.session = { baseUrl: base, room, hostToken, viewerUrl: base + "/" + room, hostInstanceId: meta.hostInstanceId };
    await this.openSocket();
    this.sendHost("updatePollMetadata", { ...meta, hostInstanceId: meta.hostInstanceId });
    if (meta.startPoll) this.sendHost("startPoll", { hostInstanceId: meta.hostInstanceId });
    this.startHeartbeat();
    const verified = await this.verifyLiveState(!!meta.startPoll);
    if (!verified.ok) {
      this.setStatus("ERROR", verified.error);
      throw new Error(verified.error);
    }
    this.setStatus("ONLINE", "");
    return this.session;
  }

  async checkAvailability(baseUrl: string, roomName: string, hostInstanceId: string) {
    const base = baseUrl.replace(/\/$/, "");
    const res = await fetch(base + "/api/rooms/availability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomName, hostInstanceId })
    });
    return res.json();
  }

  async releaseRoom(hostInstanceId: string) {
    const s = this.session;
    if (!s) throw new Error("No public server session.");
    const res = await fetch(s.baseUrl + "/api/rooms/" + s.room + "/release", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + s.hostToken },
      body: JSON.stringify({ hostInstanceId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Release failed");
    return data;
  }

  sendHost(action: string, extra: Record<string, unknown> = {}) {
    const s = this.session;
    if (!s) return;
    const payload = JSON.stringify({ action, hostInstanceId: s.hostInstanceId, ...extra });
    if (this.ws && this.ws.readyState === 1) this.ws.send(payload);
    fetch(s.baseUrl + "/api/rooms/" + s.room + "/host", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + s.hostToken },
      body: payload
    }).catch(() => {});
  }

  async verifyLiveState(requirePoll = false): Promise<{ ok: boolean; error: string; state?: RelayPublicState }> {
    const s = this.session;
    if (!s) return { ok: false, error: "No public room session." };
    try {
      const res = await fetch(s.baseUrl + "/api/rooms/" + s.room + "/state");
      const state = await res.json() as RelayPublicState & { error?: string };
      if (!res.ok) return { ok: false, error: "State HTTP " + res.status };
      if (!state.host_online) return { ok: false, error: "PUBLIC SERVER SYNC FAILED: host_online=false", state };
      if (requirePoll && !state.running_poll) return { ok: false, error: "PUBLIC POLL SYNC FAILED: running_poll=false", state };
      this.onState?.(state);
      return { ok: true, error: "", state };
    } catch (e) {
      return { ok: false, error: "State check failed: " + String(e) };
    }
  }

  disconnect() {
    this.closed = true;
    if (this.hb) { clearInterval(this.hb); this.hb = 0; }
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    this.setStatus("IDLE", "");
  }

  private startHeartbeat() {
    if (this.hb) clearInterval(this.hb);
    this.hb = window.setInterval(() => this.sendHost("heartbeat"), 8000);
  }

  private openSocket(): Promise<void> {
    const s = this.session;
    if (!s || this.closed) return Promise.resolve();
    return new Promise((resolve) => {
      const url = wsUrl(s.baseUrl, "/ws/host/" + s.room + "?token=" + encodeURIComponent(s.hostToken));
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      ws.onopen = () => { this.tries = 0; this.setStatus("ONLINE", ""); this.sendHost("startPoll"); done(); };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          if (msg.type === "audience_reaction") this.onReaction?.(msg);
          else if (String(msg.type || "").startsWith("remote_") || msg.type === "remote_command") this.onRemote?.(msg);
          else if (msg.type === "state" || msg.room) this.onState?.(msg);
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        if (this.closed) return;
        this.setStatus("RECONNECTING", "Host socket closed");
        const delay = Math.min(15000, 800 * Math.pow(2, this.tries++));
        setTimeout(() => {
          this.openSocket().then(() => {
            this.sendHost("updatePollMetadata");
            this.sendHost("startPoll");
          });
        }, delay);
      };
      ws.onerror = () => { this.setStatus("RECONNECTING", "Host socket error"); };
      setTimeout(done, 2500);
    });
  }

  private setStatus(s: RelayStatus, err: string) {
    this.status = s;
    this.error = err;
    this.onStatus?.(s, err);
  }
}

export function defaultRelayUrl() {
  return localStorage.getItem("auralith.relayUrl") || "";
}
