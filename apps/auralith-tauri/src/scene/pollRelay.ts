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
};

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
  onStatus?: (s: RelayStatus, err: string) => void;
  onState?: (s: RelayPublicState) => void;
  onReaction?: (ev: { type: string; eventId?: string; reactionId?: string; roomId?: string; timestamp?: number }) => void;

  configured(base?: string) {
    return !!(base || "").trim();
  }

  async connectHost(baseUrl: string, meta: { question: string; redLabel: string; greenLabel: string; allowChange: boolean }) {
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
      body: JSON.stringify(meta)
    });
    if (!res.ok) throw new Error("Relay room create failed (" + res.status + ")");
    const data = await res.json();
    const room = String(data.room || "");
    const hostToken = String(data.hostToken || "");
    if (!room || !hostToken) throw new Error("Relay did not return room/token");
    this.session = { baseUrl: base, room, hostToken, viewerUrl: base + "/" + room };
    this.openSocket();
    return this.session;
  }

  sendHost(action: string, extra: Record<string, unknown> = {}) {
    const s = this.session;
    if (!s) return;
    const payload = JSON.stringify({ action, ...extra });
    if (this.ws && this.ws.readyState === 1) this.ws.send(payload);
    fetch(s.baseUrl + "/api/rooms/" + s.room + "/host", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + s.hostToken },
      body: payload
    }).catch(() => {});
  }

  disconnect() {
    this.closed = true;
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    this.setStatus("IDLE", "");
  }

  private openSocket() {
    const s = this.session;
    if (!s || this.closed) return;
    const url = wsUrl(s.baseUrl, "/ws/host/" + s.room + "?token=" + encodeURIComponent(s.hostToken));
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => { this.tries = 0; this.setStatus("ONLINE", ""); };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === "audience_reaction") this.onReaction?.(msg);
        else if (msg.type === "state" || msg.room) this.onState?.(msg);
      } catch { /* ignore */ }
    };
    ws.onclose = () => {
      if (this.closed) return;
      this.setStatus("RECONNECTING", "Host socket closed");
      const delay = Math.min(15000, 800 * Math.pow(2, this.tries++));
      setTimeout(() => this.openSocket(), delay);
    };
    ws.onerror = () => { this.setStatus("RECONNECTING", "Host socket error"); };
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
