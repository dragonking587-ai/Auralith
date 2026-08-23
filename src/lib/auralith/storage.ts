import { parseScene } from "./schema";
import type { SavedSceneMeta, Scene } from "./types";
import { makeSessionId, uid } from "./id";
import { desktopRead, desktopWrite } from "./desktop-store";

const LS_SESSION = "auralith.session";
const LS_SCENE = "auralith.scene";
const LS_LIBRARY = "auralith.library";
const DB_NAME = "auralith";
const DB_STORE = "blobs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<string | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet(key: string, value: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* quota / private mode */
  }
}

export function getOrCreateSessionId(): string {
  try {
    const existing = localStorage.getItem(LS_SESSION);
    if (existing && existing.length >= 8) return existing;
    const id = makeSessionId();
    localStorage.setItem(LS_SESSION, id);
    return id;
  } catch {
    return makeSessionId();
  }
}

export function loadSceneFromStorage(): Scene | null {
  try {
    const raw = localStorage.getItem(LS_SCENE);
    if (!raw) return null;
    return parseScene(raw);
  } catch {
    return null;
  }
}

export function saveSceneToStorage(scene: Scene): void {
  try {
    localStorage.setItem(LS_SCENE, JSON.stringify(scene));
  } catch {
    /* quota */
  }
  void desktopWrite("live-scene.json", JSON.stringify(scene));
}

export async function saveImageBlob(id: string, dataUrl: string): Promise<void> {
  await idbSet(`image:${id}`, dataUrl);
  void desktopWrite(`images-${id}.txt`, dataUrl);
}

export async function loadImageBlob(id: string): Promise<string | null> {
  const local = await idbGet(`image:${id}`);
  if (local) return local;
  return desktopRead(`images-${id}.txt`);
}

export interface LiveActiveState {
  scene: Scene;
  imageId: string;
  imageRev: number;
  sceneRev: number;
  updatedAt: number;
}

function liveKey(sessionId: string): string {
  return `live:${sessionId}`;
}

/** Editor's current unsaved scene — Window Capture reads this, not Netlify Blobs. */
export async function saveLiveActive(sessionId: string, state: LiveActiveState, dataUrl?: string | null): Promise<void> {
  if (!sessionId) return;
  await idbSet(liveKey(sessionId), JSON.stringify(state));
  if (dataUrl && state.imageId) await idbSet(`image:${state.imageId}`, dataUrl);
}

export async function loadLiveActive(sessionId: string): Promise<{ state: LiveActiveState; dataUrl: string | null } | null> {
  if (!sessionId) return null;
  const raw = await idbGet(liveKey(sessionId));
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as LiveActiveState;
    if (!state || typeof state !== "object") return null;
    const dataUrl = state.imageId ? await loadImageBlob(state.imageId) : null;
    return { state, dataUrl };
  } catch {
    return null;
  }
}

export function loadLibrary(): SavedSceneMeta[] {
  try {
    const raw = localStorage.getItem(LS_LIBRARY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedSceneMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLibrary(list: SavedSceneMeta[]): void {
  try {
    localStorage.setItem(LS_LIBRARY, JSON.stringify(list));
  } catch {
    /* quota */
  }
  void desktopWrite("library.json", JSON.stringify(list));
}

export async function saveNamedScene(scene: Scene, imageDataUrl: string | null): Promise<SavedSceneMeta> {
  const id = uid("scene");
  const meta: SavedSceneMeta = {
    id,
    name: scene.name || "Untitled",
    updatedAt: Date.now(),
  };
  const raw = JSON.stringify(scene);
  await idbSet(`scene:${id}`, raw);
  void desktopWrite(`scene-${id}.json`, raw);
  if (imageDataUrl) {
    await idbSet(`scene-image:${id}`, imageDataUrl);
    void desktopWrite(`scene-image-${id}.txt`, imageDataUrl);
  }
  const list = [meta, ...loadLibrary().filter((s) => s.name !== meta.name)].slice(0, 40);
  saveLibrary(list);
  return meta;
}

export async function loadNamedScene(id: string): Promise<{ scene: Scene; image: string | null } | null> {
  let raw = await idbGet(`scene:${id}`);
  if (!raw) raw = await desktopRead(`scene-${id}.json`);
  if (!raw) return null;
  const scene = parseScene(raw);
  if (!scene) return null;
  const image = (await idbGet(`scene-image:${id}`)) ?? (await desktopRead(`scene-image-${id}.txt`));
  return { scene, image };
}

export function deleteNamedScene(id: string): void {
  saveLibrary(loadLibrary().filter((s) => s.id !== id));
}
