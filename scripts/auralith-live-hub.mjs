const KEY = "__AURALITH_LIVE_HUB__";

function globals() {
  return /** @type {any} */ (globalThis);
}

/**
 * @returns {{ sessions: Map<string, any> }}
 */
export function getHub() {
  const g = globals();
  if (!g[KEY]) {
    g[KEY] = { sessions: new Map() };
  }
  return g[KEY];
}

/** @param {string} id */
export function getSession(id) {
  const hub = getHub();
  let s = hub.sessions.get(id);
  if (!s) {
    s = {
      scene: null,
      sceneRev: 0,
      image: null,
      imageRev: 0,
      bands: null,
      viewers: new Set(),
      editor: null,
    };
    hub.sessions.set(id, s);
  }
  return s;
}

/** @param {any} ws @param {any} session */
export function sendLatest(ws, session) {
  if (ws.readyState !== 1) return;
  if (session.scene) {
    safeSend(ws, {
      op: "scene",
      scene: session.scene,
      rev: session.sceneRev,
      imageRev: session.imageRev,
    });
  }
  if (session.bands) {
    safeSend(ws, { op: "bands", ...session.bands });
  }
  if (session.imageRev) {
    safeSend(ws, { op: "image", imageRev: session.imageRev });
  }
}

/** @param {any} session */
export function broadcastBands(session) {
  if (!session.bands) return;
  const payload = JSON.stringify({ op: "bands", ...session.bands });
  for (const ws of session.viewers) {
    if (ws.readyState !== 1) continue;
    if (ws.bufferedAmount > 8192) continue;
    try {
      ws.send(payload);
    } catch {
      /* drop */
    }
  }
}

/** @param {any} session */
export function broadcastScene(session) {
  const payload = JSON.stringify({
    op: "scene",
    scene: session.scene,
    rev: session.sceneRev,
    imageRev: session.imageRev,
  });
  for (const ws of session.viewers) {
    if (ws.readyState !== 1) continue;
    try {
      ws.send(payload);
    } catch {
      /* drop */
    }
  }
}

/** @param {any} session */
export function broadcastImage(session) {
  const payload = JSON.stringify({ op: "image", imageRev: session.imageRev });
  for (const ws of session.viewers) {
    if (ws.readyState !== 1) continue;
    try {
      ws.send(payload);
    } catch {
      /* drop */
    }
  }
}

/** @param {any} ws @param {any} obj */
function safeSend(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch {
    /* drop */
  }
}
