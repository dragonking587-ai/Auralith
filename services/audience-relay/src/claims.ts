import fs from "node:fs";
import path from "node:path";

const RESERVED = new Set(["api","host","health","ws","admin","localhost","pair","rooms","remote","viewer","status","claim"]);

export type RoomClaim = {
  name: string;
  display: string;
  ownerHostInstanceId: string;
  hostToken: string;
  claimedAt: number;
  released: boolean;
};

const dataDir = process.env.DATA_DIR || (fs.existsSync("/data") ? "/data" : path.join(process.cwd(), "data"));
const file = path.join(dataDir, "room-claims.json");

function load(): Record<string, RoomClaim> {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function save(db: Record<string, RoomClaim>) {
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, file);
}

export function normalizeRoomName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = String(raw || "").trim().toUpperCase();
  if (name.length < 3 || name.length > 32) return { ok: false, error: "invalid_room_name" };
  if (!/^[A-Z0-9][A-Z0-9-]*[A-Z0-9]$/.test(name) && !/^[A-Z0-9]{3,32}$/.test(name)) return { ok: false, error: "invalid_room_name" };
  if (/--/.test(name) || /[/?#\\]/.test(name)) return { ok: false, error: "invalid_room_name" };
  if (RESERVED.has(name.toLowerCase())) return { ok: false, error: "reserved_room_name" };
  return { ok: true, name };
}

export function availability(name: string, hostId: string) {
  const n = normalizeRoomName(name);
  if (!n.ok) return { status: "INVALID", ...n };
  const db = load();
  const c = db[n.name];
  if (!c || c.released) return { status: "AVAILABLE", name: n.name };
  if (c.ownerHostInstanceId === hostId) return { status: "OWNED_BY_THIS_HOST", name: n.name };
  return { status: "UNAVAILABLE", name: n.name, error: "room_name_unavailable" };
}

export function claimRoom(name: string, hostId: string, hostToken: string, display?: string) {
  const n = normalizeRoomName(name);
  if (!n.ok) return n;
  if (!hostId || hostId.length < 16) return { ok: false as const, error: "invalid_host_instance" };
  const db = load();
  const c = db[n.name];
  if (c && !c.released && c.ownerHostInstanceId !== hostId) {
    return { ok: false as const, error: "room_name_unavailable" };
  }
  const next: RoomClaim = {
    name: n.name,
    display: String(display || n.name).slice(0, 32),
    ownerHostInstanceId: hostId,
    hostToken: c && !c.released ? c.hostToken : hostToken,
    claimedAt: c?.claimedAt || Date.now(),
    released: false
  };
  db[n.name] = next;
  save(db);
  return { ok: true as const, claim: next };
}

export function getClaim(name: string) {
  const n = normalizeRoomName(name);
  if (!n.ok) return null;
  const c = load()[n.name];
  return c && !c.released ? c : null;
}

export function releaseRoom(name: string, hostId: string) {
  const n = normalizeRoomName(name);
  if (!n.ok) return n;
  const db = load();
  const c = db[n.name];
  if (!c || c.released) return { ok: true as const, name: n.name };
  if (c.ownerHostInstanceId !== hostId) return { ok: false as const, error: "tenant_mismatch" };
  c.released = true;
  db[n.name] = c;
  save(db);
  return { ok: true as const, name: n.name };
}

export function storageInfo() {
  return { dataDir, file, exists: fs.existsSync(file) };
}
