import type { LiveBands, Scene } from "./types";

export type Role = "editor" | "view";

export interface HelloMsg {
  op: "hello";
  session: string;
  role: Role;
}

export interface BandsMsg {
  op: "bands";
  session: string;
  seq: number;
  t: number;
  b: number;
  l: number;
  m: number;
  h: number;
  dim: number;
  intensity: number;
}

export interface SceneMsg {
  op: "scene";
  session: string;
  rev: number;
  scene: Scene;
  imageRev: number;
}

export interface ImageReadyMsg {
  op: "image";
  session: string;
  imageRev: number;
  imageId?: string;
  dataUrl?: string;
}

export interface SnapshotMsg {
  op: "snapshot";
  session: string;
  sceneRev: number;
  imageRev: number;
  imageId: string;
  scene: Scene;
  dataUrl?: string;
}

export type LiveMsg = HelloMsg | BandsMsg | SceneMsg | ImageReadyMsg | SnapshotMsg;

export function bandsToMsg(session: string, bands: LiveBands, intensity: number): BandsMsg {
  return {
    op: "bands",
    session,
    seq: bands.seq,
    t: bands.t,
    b: round4(bands.bass),
    l: round4(bands.low),
    m: round4(bands.mid),
    h: round4(bands.high),
    dim: round4(bands.dim),
    intensity: round4(intensity),
  };
}

export function msgToBands(msg: BandsMsg): LiveBands {
  return {
    bass: msg.b,
    low: msg.l,
    mid: msg.m,
    high: msg.h,
    t: msg.t,
    seq: msg.seq,
    dim: msg.dim,
    intensity: msg.intensity,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export const BC_NAME = "auralith-live-v1";
