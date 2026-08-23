const KEY = "__AURALITH_LIVE_HUB__";
const BLOB_STORE = "auralith-live";

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

/** @type {Promise<import("@netlify/blobs").Store | null> | null} */
let blobStorePromise = null;


async function blobStore() {
  if (blobStorePromise) return blobStorePromise;
  blobStorePromise = (async () => {
    try {
      const { getStore } = await import("@netlify/blobs");
      return getStore({ name: BLOB_STORE, consistency: "strong" });
    } catch {
      return null;
    }
  })();
  return blobStorePromise;
}

/** @param {any} session */
function snapshot(session) {

  return {
    scene: session.scene,
    sceneRev: session.sceneRev,
    imageRev: session.imageRev,
    bands: session.bands,
  };
}

/** Load durable Netlify Blob state into the in-memory session (no-op locally).
 * @param {string} id
 */
export async function hydrateSession(id) {

  const s = getSession(id);
  const store = await blobStore();
  if (!store) return s;
  try {
    const state = await store.get(`session/${id}/state`, { type: "json" });
    if (state && typeof state === "object") {
      if ((state.sceneRev ?? 0) >= s.sceneRev && state.scene) {
        s.scene = state.scene;
        s.sceneRev = state.sceneRev ?? s.sceneRev;
      }
      if (state.bands && (state.bands.seq ?? 0) >= (s.bands?.seq ?? 0)) {
        s.bands = state.bands;
      }
      if ((state.imageRev ?? 0) > s.imageRev) {
        s.imageRev = state.imageRev;
        const image = await store.get(`session/${id}/image`, { type: "text" });
        if (typeof image === "string" && image.length) s.image = image;
      }
    } else if (!s.image) {
      const image = await store.get(`session/${id}/image`, { type: "text" });
      if (typeof image === "string" && image.length) s.image = image;
    }
  } catch {
    /* blobs unavailable in this isolate */
  }
  return s;
}

/** Persist latest-state session to Netlify Blobs when running on Netlify.
 * @param {string} id
 * @param {{ image?: boolean }} [opts]
 */
export async function persistSession(id, { image = false } = {}) {

  const s = getSession(id);
  const store = await blobStore();
  if (!store) return;
  try {
    await store.setJSON(`session/${id}/state`, snapshot(s));
    if (image && typeof s.image === "string") {
      await store.set(`session/${id}/image`, s.image);
    }
  } catch {
    /* drop — memory still holds latest for this isolate */
  }
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
