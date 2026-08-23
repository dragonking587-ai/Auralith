import { parseScene } from "./schema";
import type { SavedSceneMeta, Scene } from "./types";
import { makeSessionId, uid } from "./id";

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
}

export async function saveImageBlob(id: string, dataUrl: string): Promise<void> {
  await idbSet(`image:${id}`, dataUrl);
}

export async function loadImageBlob(id: string): Promise<string | null> {
  return idbGet(`image:${id}`);
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
}

export async function saveNamedScene(scene: Scene, imageDataUrl: string | null): Promise<SavedSceneMeta> {
  const id = uid("scene");
  const meta: SavedSceneMeta = {
    id,
    name: scene.name || "Untitled",
    updatedAt: Date.now(),
  };
  await idbSet(`scene:${id}`, JSON.stringify(scene));
  if (imageDataUrl) await idbSet(`scene-image:${id}`, imageDataUrl);
  const list = [meta, ...loadLibrary().filter((s) => s.name !== meta.name)].slice(0, 40);
  saveLibrary(list);
  return meta;
}

export async function loadNamedScene(id: string): Promise<{ scene: Scene; image: string | null } | null> {
  const raw = await idbGet(`scene:${id}`);
  if (!raw) return null;
  const scene = parseScene(raw);
  if (!scene) return null;
  const image = await idbGet(`scene-image:${id}`);
  return { scene, image };
}

export function deleteNamedScene(id: string): void {
  saveLibrary(loadLibrary().filter((s) => s.id !== id));
}
