import { BC_NAME, bandsToMsg, msgToBands, type BandsMsg, type LiveMsg } from "./live-protocol";
import { shouldReplaceImage } from "./live-rev";
import type { LiveBands, Scene } from "./types";

export { shouldReplaceImage } from "./live-rev";

export interface LiveViewState {
  bands: LiveBands | null;
  scene: Scene | null;
  sceneRev: number;
  imageRev: number;
  imageId: string;
  imageUrl: string | null;
  connected: boolean;
  transport: "ws" | "broadcast" | "http" | "none";
  seq: number;
}

type Handler = (state: LiveViewState) => void;

function wsUrl(session: string, role: "editor" | "view"): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws/auralith?session=${encodeURIComponent(session)}&role=${role}`;
}

export class LivePublisher {
  private ws: WebSocket | null = null;
  private bc: BroadcastChannel | null = null;
  private session: string;
  private sceneRev = 0;
  private imageRev = 0;
  private imageGen = 0;
  private closed = false;
  private retry = 0;
  private lastBandPost = 0;
  private bandTimer = 0;
  private pendingBands: BandsMsg | null = null;

  constructor(session: string) {
    this.session = session;
    try {
      this.bc = new BroadcastChannel(BC_NAME);
    } catch {
      this.bc = null;
    }
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    try {
      const ws = new WebSocket(wsUrl(this.session, "editor"));
      this.ws = ws;
      ws.onopen = () => {
        this.retry = 0;
      };
      ws.onclose = () => {
        this.ws = null;
        if (this.closed) return;
        const wait = Math.min(4000, 250 * 2 ** this.retry++);
        setTimeout(() => this.connect(), wait);
      };
      ws.onerror = () => ws.close();
    } catch {
      /* ws unavailable */
    }
  }

  publishBands(bands: LiveBands, intensity: number): void {
    const msg = bandsToMsg(this.session, bands, intensity);
    this.send(msg);
    this.bc?.postMessage(msg);
    this.queueBandPost(msg);
  }

  publishScene(scene: Scene): void {
    this.sceneRev += 1;
    const msg = { op: "scene" as const, session: this.session, rev: this.sceneRev, scene, imageRev: this.imageRev };
    this.send(msg);
    this.bc?.postMessage(msg);
    void fetch(`/api/auralith/live?session=${encodeURIComponent(this.session)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: this.session, scene, rev: this.sceneRev }),
    }).catch(() => undefined);
  }

  /** Upload new pixels, bump imageRev, notify all outputs. Latest call wins. */
  async publishImage(dataUrl: string, imageId: string): Promise<number> {
    const gen = ++this.imageGen;
    try {
      const j = await fetch(`/api/auralith/image?session=${encodeURIComponent(this.session)}&id=${encodeURIComponent(imageId)}`, {
        method: "POST",
        headers: { "content-type": "text/plain", "cache-control": "no-store" },
        body: dataUrl,
      }).then((r) => r.json() as Promise<{ imageRev?: number }>);
      if (gen !== this.imageGen) return this.imageRev;
      if (typeof j.imageRev === "number") this.imageRev = j.imageRev;
      else this.imageRev += 1;
    } catch {
      if (gen !== this.imageGen) return this.imageRev;
      this.imageRev += 1;
    }
    if (gen !== this.imageGen) return this.imageRev;
    this.notifyImage(imageId, dataUrl);
    return this.imageRev;
  }

  private notifyImage(imageId: string, dataUrl?: string): void {
    const msg = { op: "image" as const, session: this.session, imageRev: this.imageRev, imageId };
    this.send(msg);
    try {
      this.bc?.postMessage(dataUrl ? { ...msg, dataUrl } : msg);
    } catch {
      this.bc?.postMessage(msg);
    }
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
    this.bc?.close();
    if (this.bandTimer) window.clearTimeout(this.bandTimer);
  }

  private queueBandPost(msg: BandsMsg): void {
    this.pendingBands = msg;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const wait = Math.max(0, 120 - (now - this.lastBandPost));
    if (this.bandTimer) return;
    this.bandTimer = window.setTimeout(() => {
      this.bandTimer = 0;
      const payload = this.pendingBands;
      this.pendingBands = null;
      if (!payload || this.closed) return;
      this.lastBandPost = typeof performance !== "undefined" ? performance.now() : Date.now();
      void fetch(`/api/auralith/live?session=${encodeURIComponent(this.session)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session: this.session,
          bands: {
            seq: payload.seq,
            t: payload.t,
            b: payload.b,
            l: payload.l,
            m: payload.m,
            h: payload.h,
            dim: payload.dim,
            intensity: payload.intensity,
          },
        }),
      }).catch(() => undefined);
    }, wait);
  }

  private send(msg: object): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 8192) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* drop stale */
    }
  }
}

export class LiveViewer {
  private ws: WebSocket | null = null;
  private bc: BroadcastChannel | null = null;
  private session: string;
  private poll: number | null = null;
  private closed = false;
  private retry = 0;
  private handlers = new Set<Handler>();
  private state: LiveViewState = {
    bands: null,
    scene: null,
    sceneRev: 0,
    imageRev: 0,
    imageId: "",
    imageUrl: null,
    connected: false,
    transport: "none",
    seq: 0,
  };
  private pullGen = 0;

  constructor(session: string) {
    this.session = session;
    try {
      this.bc = new BroadcastChannel(BC_NAME);
      this.bc.onmessage = (ev) => this.onMsg(ev.data, "broadcast");
    } catch {
      this.bc = null;
    }
    this.connect();
    this.startPoll();
  }

  subscribe(fn: Handler): () => void {
    this.handlers.add(fn);
    fn(this.state);
    return () => this.handlers.delete(fn);
  }

  getState(): LiveViewState {
    return this.state;
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
    this.bc?.close();
    if (this.poll) window.clearInterval(this.poll);
  }

  private connect(): void {
    if (this.closed) return;
    try {
      const ws = new WebSocket(wsUrl(this.session, "view"));
      this.ws = ws;
      ws.onopen = () => {
        this.retry = 0;
        this.patch({ connected: true, transport: "ws" });
      };
      ws.onmessage = (ev) => {
        try {
          this.onMsg(JSON.parse(String(ev.data)), "ws");
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        this.ws = null;
        this.patch({ connected: false });
        if (this.closed) return;
        const wait = Math.min(4000, 250 * 2 ** this.retry++);
        setTimeout(() => this.connect(), wait);
      };
    } catch {
      /* ignore */
    }
  }

  private startPoll(): void {
    const tick = () => {
      if (this.closed) return;
      const wsOpen = this.ws?.readyState === WebSocket.OPEN;
      void fetch(`/api/auralith/live?session=${encodeURIComponent(this.session)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (!wsOpen && j.bands && (j.bands.seq ?? 0) >= this.state.seq) {
            this.patch({
              bands: {
                bass: j.bands.b,
                low: j.bands.l,
                mid: j.bands.m,
                high: j.bands.h,
                t: j.bands.t,
                seq: j.bands.seq,
                dim: j.bands.dim,
                intensity: j.bands.intensity,
              },
              seq: j.bands.seq,
              transport: this.state.transport === "ws" ? "ws" : "http",
            });
          }
          if (j.scene && (j.sceneRev ?? 0) >= this.state.sceneRev) {
            this.patch({ scene: j.scene, sceneRev: j.sceneRev ?? this.state.sceneRev });
          }
          const nextRev = typeof j.imageRev === "number" ? j.imageRev : 0;
          if (shouldReplaceImage(nextRev, this.state.imageRev) || (nextRev > 0 && !this.state.imageUrl)) {
            void this.pullImage(nextRev);
          }
        })
        .catch(() => undefined);
    };
    this.poll = window.setInterval(tick, 280);
    tick();
  }

  private onMsg(msg: LiveMsg | (BandsMsg & { dataUrl?: string; imageId?: string }) | { op: string; [k: string]: unknown }, via: LiveViewState["transport"]): void {
    if (!msg || typeof msg !== "object") return;
    if (msg.op === "bands") {
      const bands = msgToBands(msg as BandsMsg);
      if (bands.seq < this.state.seq) return;
      this.patch({ bands, seq: bands.seq, connected: true, transport: via });
      return;
    }
    if (msg.op === "scene") {
      const m = msg as { scene: Scene; rev: number; imageRev?: number };
      if ((m.rev ?? 0) < this.state.sceneRev) return;
      const imageRev = m.imageRev ?? this.state.imageRev;
      this.patch({
        scene: m.scene,
        sceneRev: m.rev ?? this.state.sceneRev,
        connected: true,
        transport: via,
      });
      if (shouldReplaceImage(imageRev, this.state.imageRev) || (imageRev > 0 && !this.state.imageUrl)) {
        void this.pullImage(imageRev);
      }
      return;
    }
    if (msg.op === "image") {
      const m = msg as { imageRev: number; dataUrl?: string; imageId?: string };
      const rev = m.imageRev ?? 0;
      if (m.dataUrl && (shouldReplaceImage(rev, this.state.imageRev) || !this.state.imageUrl)) {
        this.pullGen += 1;
        this.patch({
          imageUrl: m.dataUrl,
          imageRev: Math.max(rev, this.state.imageRev),
          imageId: m.imageId ?? this.state.imageId,
        });
        return;
      }
      if (shouldReplaceImage(rev, this.state.imageRev) || (rev > 0 && !this.state.imageUrl)) {
        void this.pullImage(rev, m.imageId);
      }
    }
  }

  private async pullImage(rev: number, imageId?: string): Promise<void> {
    const gen = ++this.pullGen;
    this.patch({ imageRev: Math.max(rev, this.state.imageRev), imageId: imageId ?? this.state.imageId });
    try {
      const text = await fetch(
        `/api/auralith/image?session=${encodeURIComponent(this.session)}&rev=${encodeURIComponent(String(rev))}`,
        { cache: "no-store" },
      ).then((r) => (r.ok ? r.text() : ""));
      if (gen !== this.pullGen) return;
      if (text) this.patch({ imageUrl: text, imageRev: Math.max(rev, this.state.imageRev) });
    } catch {
      /* ignore */
    }
  }

  private patch(p: Partial<LiveViewState>): void {
    this.state = { ...this.state, ...p };
    for (const fn of this.handlers) fn(this.state);
  }
}
