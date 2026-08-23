import { WebSocketServer } from "ws";
import {
  broadcastBands,
  broadcastImage,
  broadcastScene,
  getSession,
  sendLatest,
} from "./auralith-live-hub.mjs";

const PATH = "/ws/auralith";

function attach(httpServer) {
  if (!httpServer || httpServer.__auralithWs) return;
  httpServer.__auralithWs = true;
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    if (!url.startsWith(PATH)) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? PATH, "http://localhost");
    const sessionId = url.searchParams.get("session") ?? "";
    const role = url.searchParams.get("role") === "editor" ? "editor" : "view";
    if (!sessionId) {
      ws.close(1008, "session required");
      return;
    }
    const session = getSession(sessionId);
    if (role === "editor") session.editor = ws;
    else session.viewers.add(ws);
    sendLatest(ws, session);

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      if (msg.op === "bands") {
        session.bands = {
          seq: msg.seq ?? 0,
          t: msg.t ?? 0,
          b: msg.b ?? 0,
          l: msg.l ?? 0,
          m: msg.m ?? 0,
          h: msg.h ?? 0,
          dim: msg.dim ?? 0,
          intensity: msg.intensity ?? 1,
        };
        broadcastBands(session);
        return;
      }
      if (msg.op === "scene") {
        session.scene = msg.scene ?? null;
        session.sceneRev = msg.rev ?? session.sceneRev + 1;
        if (typeof msg.imageRev === "number") session.imageRev = msg.imageRev;
        broadcastScene(session);
      }
    });

    ws.on("close", () => {
      session.viewers.delete(ws);
      if (session.editor === ws) session.editor = null;
    });
  });
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function httpMiddleware(req, res, next) {
  const rawUrl = req.url ?? "";
  const path = rawUrl.split("?", 1)[0] ?? "";
  if (!path.startsWith("/api/auralith/")) {
    next();
    return;
  }
  const url = new URL(rawUrl, "http://localhost");
  const sessionId = url.searchParams.get("session") ?? "";

  if (path === "/api/auralith/live") {
    if (req.method === "GET") {
      if (!sessionId) return json(res, 400, { error: "session required" });
      const s = getSession(sessionId);
      return json(res, 200, {
        scene: s.scene,
        sceneRev: s.sceneRev,
        imageRev: s.imageRev,
        bands: s.bands,
      });
    }
    if (req.method === "POST") {
      return readBody(req)
        .then((buf) => {
          const msg = JSON.parse(buf.toString("utf8") || "{}");
          const id = msg.session || sessionId;
          if (!id) return json(res, 400, { error: "session required" });
          const s = getSession(id);
          if (msg.scene) {
            s.scene = msg.scene;
            s.sceneRev = msg.rev ?? s.sceneRev + 1;
            broadcastScene(s);
          }
          if (msg.bands) {
            s.bands = msg.bands;
            broadcastBands(s);
          }
          json(res, 200, { ok: true, sceneRev: s.sceneRev, imageRev: s.imageRev });
        })
        .catch((err) => json(res, 400, { error: String(err) }));
    }
    res.statusCode = 405;
    res.end();
    return;
  }

  if (path === "/api/auralith/image") {
    if (req.method === "GET") {
      if (!sessionId) return json(res, 400, { error: "session required" });
      const s = getSession(sessionId);
      if (!s.image) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(s.image);
      return;
    }
    if (req.method === "POST") {
      return readBody(req).then((buf) => {
        const id = sessionId || new URL(rawUrl, "http://localhost").searchParams.get("session");
        if (!id) return json(res, 400, { error: "session required" });
        const s = getSession(id);
        s.image = buf.toString("utf8");
        s.imageRev += 1;
        broadcastImage(s);
        json(res, 200, { ok: true, imageRev: s.imageRev });
      });
    }
    res.statusCode = 405;
    res.end();
    return;
  }

  next();
}

export function auralithWsPlugin() {
  return {
    name: "auralith-ws",
    configureServer(server) {
      server.middlewares.use(httpMiddleware);
      return () => attach(server.httpServer);
    },
    configurePreviewServer(server) {
      server.middlewares.use(httpMiddleware);
      return () => attach(server.httpServer);
    },
  };
}
