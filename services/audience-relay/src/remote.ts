import crypto from "node:crypto";
import type { WebSocket } from "ws";

export type HostRole = "FULL_HOST" | "POLL_MODERATOR" | "EFFECTS_OPERATOR" | "REACTION_MODERATOR";

export const ALLOWED_CMDS: Record<string, HostRole[]> = {
  poll_start: ["FULL_HOST", "POLL_MODERATOR"],
  poll_end: ["FULL_HOST", "POLL_MODERATOR"],
  poll_clear: ["FULL_HOST", "POLL_MODERATOR"],
  poll_clear_restore: ["FULL_HOST", "POLL_MODERATOR"],
  poll_reset: ["FULL_HOST", "POLL_MODERATOR"],
  poll_set_question: ["FULL_HOST", "POLL_MODERATOR"],
  poll_set_red_label: ["FULL_HOST", "POLL_MODERATOR"],
  poll_set_green_label: ["FULL_HOST", "POLL_MODERATOR"],
  poll_set_show_results: ["FULL_HOST", "POLL_MODERATOR"],
  reactions_enable: ["FULL_HOST", "REACTION_MODERATOR", "EFFECTS_OPERATOR"],
  reactions_disable: ["FULL_HOST", "REACTION_MODERATOR", "EFFECTS_OPERATOR"],
  reaction_enable: ["FULL_HOST", "REACTION_MODERATOR", "EFFECTS_OPERATOR"],
  reaction_disable: ["FULL_HOST", "REACTION_MODERATOR", "EFFECTS_OPERATOR"],
  reaction_clear_active: ["FULL_HOST", "REACTION_MODERATOR", "EFFECTS_OPERATOR"],
  fireworks_preview: ["FULL_HOST", "EFFECTS_OPERATOR", "REACTION_MODERATOR"],
  fireworks_set_preset: ["FULL_HOST", "EFFECTS_OPERATOR"],
  fireworks_set_intensity: ["FULL_HOST", "EFFECTS_OPERATOR"],
  fireworks_set_shell_count: ["FULL_HOST", "EFFECTS_OPERATOR"],
  fireworks_set_pattern: ["FULL_HOST", "EFFECTS_OPERATOR"],
  fireworks_set_brightness: ["FULL_HOST", "EFFECTS_OPERATOR"],
  fireworks_set_smoke: ["FULL_HOST", "EFFECTS_OPERATOR"],
  fireworks_set_bloom: ["FULL_HOST", "EFFECTS_OPERATOR"],
  fireworks_set_duration: ["FULL_HOST", "EFFECTS_OPERATOR"]
};

export type Pairing = {
  pairingId: string;
  code: string;
  room: string;
  ownerHostInstanceId: string;
  role: HostRole;
  expiresAt: number;
  used: boolean;
  deviceName?: string;
  platform?: string;
  status: "open" | "pending" | "approved" | "denied" | "expired";
  approvedToken?: string;
  deviceId?: string;
};

export type RemoteSession = {
  token: string;
  room: string;
  ownerHostInstanceId: string;
  role: HostRole;
  deviceId: string;
  deviceName: string;
  platform: string;
  createdAt: number;
  lastSeen: number;
  expiresAt: number;
  revoked: boolean;
  sockets: Set<WebSocket>;
};

export const pairings = new Map<string, Pairing>();
export const remotes = new Map<string, RemoteSession>();

export function newId() { return crypto.randomBytes(12).toString("hex"); }
export function newCode() { return crypto.randomBytes(4).toString("hex"); }

const ROLES: HostRole[] = ["FULL_HOST", "POLL_MODERATOR", "EFFECTS_OPERATOR", "REACTION_MODERATOR"];

export function parseRole(v: any): HostRole {
  const s = String(v || "FULL_HOST").toUpperCase().replace(/[\s-]+/g, "_");
  return (ROLES as string[]).includes(s) ? s as HostRole : "FULL_HOST";
}

export function createPairing(room: string, role: HostRole, ttlSec: number, ownerHostInstanceId = "") {
  const ttl = Math.min(120, Math.max(60, ttlSec || 90));
  const p: Pairing = {
    pairingId: newId(),
    code: newCode(),
    room,
    ownerHostInstanceId,
    role,
    expiresAt: Date.now() + ttl * 1000,
    used: false,
    status: "open"
  };
  pairings.set(p.pairingId, p);
  return p;
}

export function publicPairing(p: Pairing, origin: string) {
  return {
    pairingId: p.pairingId,
    roomId: p.room,
    role: p.role,
    expiresAt: p.expiresAt,
    qrUrl: origin.replace(/\/$/, "") + "/host/pair/" + p.pairingId + "?code=" + p.code,
    status: p.status
  };
}

export function cmdAllowed(role: HostRole, cmd: string) {
  const allow = ALLOWED_CMDS[cmd];
  return !!allow && allow.includes(role);
}

export function listDevices(room: string) {
  return [...remotes.values()].filter((r) => r.room === room && !r.revoked).map((r) => ({
    deviceSessionId: r.deviceId,
    deviceName: r.deviceName,
    platform: r.platform,
    role: r.role,
    lastSeen: r.lastSeen,
    expiresAt: r.expiresAt,
    connected: r.sockets.size > 0
  }));
}

export function revokeRoom(room: string) {
  for (const r of remotes.values()) {
    if (r.room === room) {
      r.revoked = true;
      for (const s of r.sockets) try { s.close(); } catch { /* */ }
      r.sockets.clear();
    }
  }
}

export function revokeDevice(room: string, deviceId: string) {
  for (const r of remotes.values()) {
    if (r.room === room && r.deviceId === deviceId) {
      r.revoked = true;
      for (const s of r.sockets) try { s.close(); } catch { /* */ }
      r.sockets.clear();
    }
  }
}

export function persistRemotes() {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const dataDir = process.env.DATA_DIR || (fs.existsSync("/data") ? "/data" : path.join(process.cwd(), "data"));
    fs.mkdirSync(dataDir, { recursive: true });
    const rows = [...remotes.values()].filter((r) => !r.revoked && Date.now() < r.expiresAt).map((r) => ({
      token: r.token, room: r.room, ownerHostInstanceId: r.ownerHostInstanceId || "", role: r.role, deviceId: r.deviceId, deviceName: r.deviceName,
      platform: r.platform, createdAt: r.createdAt, lastSeen: r.lastSeen, expiresAt: r.expiresAt
    }));
    fs.writeFileSync(path.join(dataDir, "remote-sessions.json"), JSON.stringify(rows));
  } catch { /* */ }
}

export function restoreRemotes() {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const dataDir = process.env.DATA_DIR || (fs.existsSync("/data") ? "/data" : path.join(process.cwd(), "data"));
    const rows = JSON.parse(fs.readFileSync(path.join(dataDir, "remote-sessions.json"), "utf8")) as any[];
    for (const r of rows || []) {
      if (!r?.token || Date.now() > Number(r.expiresAt || 0)) continue;
      remotes.set(r.token, { ...r, revoked: false, sockets: new Set() });
    }
  } catch { /* */ }
}

export function sweepRemote() {
  const now = Date.now();
  for (const [id, p] of pairings) {
    if (now > p.expiresAt) { p.status = "expired"; pairings.delete(id); }
  }
  for (const [tok, r] of remotes) {
    if (r.revoked || now > r.expiresAt) {
      for (const s of r.sockets) try { s.close(); } catch { /* */ }
      remotes.delete(tok);
    }
  }
}
