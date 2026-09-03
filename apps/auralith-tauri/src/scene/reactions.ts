import { clearFireworksShows } from "./fireworksSim";

export type ReactionType = "fireworks" | "lightning" | "rune_burst" | "meteor_shower";

export type ReactionSlot = {
  id: ReactionType;
  label: string;
  enabled: boolean;
  reactionType: ReactionType;
  target: "canvas" | "point" | "shape" | "prop";
  durationMs: number;
  intensity: number;
  hostCooldownMs: number;
  trigger: "queue" | "replace_same" | "stack_limited";
  burstCount: number;
  launchHeight: number;
  spread: number;
  explosionRadius: number;
  sparkCount: number;
  trailLength: number;
  gravity: number;
  wind: number;
  shellMode: "random" | "chrysanthemum" | "peony" | "willow" | "palm" | "ring" | "crossette";
  brightness: number;
  bloom: number;
  lightSpill: number;
  exposureFlash: number;
  airDrag: number;
  windDir: number;
  turbulence: number;
  starLifetime: number;
  smokeAmt: number;
  smokePersist: number;
  smokeExp: number;
  smokeSoft: number;
  glitterAmt: number;
  glitterFreq: number;
  crackleAmt: number;
  secondary: boolean;
  secondaryChance: number;
  depthVar: number;
  imperfection: number;
  tempVar: number;
  audioReactive: boolean;
  colorA: string;
  colorB: string;
  colorC: string;
  marginL: number;
  marginR: number;
  marginT: number;
  marginB: number;
};

export type LiveReaction = {
  eventId: string;
  reactionId: ReactionType;
  started: number;
  durationMs: number;
  intensity: number;
  seed: number;
  colorA: string;
  colorB: string;
  colorC: string;
  burstCount: number;
  gravity: number;
  wind: number;
  shellMode: ReactionSlot["shellMode"];
  cfg: ReactionSlot;
};

export function defaultSlots(): ReactionSlot[] {
  const base = (id: ReactionType, label: string): ReactionSlot => ({
    id, label, enabled: true, reactionType: id, target: "canvas",
    durationMs: id === "lightning" ? 900 : 4200, intensity: 0.75, hostCooldownMs: 5000,
    trigger: "stack_limited", burstCount: 3, launchHeight: 0.72, spread: 0.55,
    explosionRadius: 0.22, sparkCount: 48, trailLength: 0.45, gravity: 0.42, wind: 0.12, shellMode: "random",
    brightness: 1, bloom: 0.55, lightSpill: 0.45, exposureFlash: 0.55, airDrag: 0.55, windDir: 0.2,
    turbulence: 0.25, starLifetime: 1, smokeAmt: 0.5, smokePersist: 0.7, smokeExp: 0.6, smokeSoft: 0.8,
    glitterAmt: 0.25, glitterFreq: 0.6, crackleAmt: 0.15, secondary: true, secondaryChance: 0.35,
    depthVar: 0.4, imperfection: 0.45, tempVar: 0.3, audioReactive: false,
    colorA: "#ffd27a", colorB: "#ff4d2a", colorC: "#fff6c8",
    marginL: 0.08, marginR: 0.08, marginT: 0.08, marginB: 0.12
  });
  return [
    base("fireworks", "Fireworks"),
    { ...base("lightning", "Lightning"), colorA: "#c8e8ff", colorB: "#7ab8ff", durationMs: 800 },
    { ...base("rune_burst", "Rune Burst"), colorA: "#d4af37", colorB: "#7cffb2", durationMs: 1800 },
    { ...base("meteor_shower", "Meteor Shower"), colorA: "#ffb070", colorB: "#fff0c8", durationMs: 2200 }
  ];
}

export function publicAllowed(slots: ReactionSlot[], enabled: boolean) {
  if (!enabled) return [];
  return slots.filter((s) => s.enabled).map((s) => ({
    id: s.id, label: s.label, enabled: true, iconKey: s.id, cooldownMs: s.hostCooldownMs
  }));
}

export class ReactionEngine {
  enabled = true;
  slots: ReactionSlot[] = defaultSlots();
  live: LiveReaction[] = [];
  seen = new Set<string>();
  last: { id: string; at: number } | null = null;
  counts: Record<string, number> = { fireworks: 0, lightning: 0, rune_burst: 0, meteor_shower: 0 };
  maxStack = 3;

  tick(now = Date.now()) {
    this.live = this.live.filter((r) => now - r.started < r.durationMs);
    if (this.seen.size > 200) this.seen.clear();
  }

  ingest(ev: { eventId?: string; reactionId?: string }) {
    if (!this.enabled) return false;
    const eventId = String(ev.eventId || "");
    const reactionId = String(ev.reactionId || "") as ReactionType;
    if (eventId && this.seen.has(eventId)) return false;
    if (eventId) this.seen.add(eventId);
    const slot = this.slots.find((s) => s.id === reactionId && s.enabled);
    if (!slot) return false;
    if (slot.trigger === "replace_same") this.live = this.live.filter((r) => r.reactionId !== reactionId);
    if (this.live.length >= this.maxStack) this.live.shift();
    this.live.push({
      eventId: eventId || ("local-" + Date.now()),
      reactionId,
      started: Date.now(),
      durationMs: slot.durationMs,
      intensity: slot.intensity,
      seed: Math.random() * 1000,
      colorA: slot.colorA, colorB: slot.colorB, colorC: slot.colorC,
      burstCount: slot.burstCount, gravity: slot.gravity, wind: slot.wind, shellMode: slot.shellMode || "random",
      cfg: { ...slot }
    });
    this.last = { id: reactionId, at: Date.now() };
    this.counts[reactionId] = (this.counts[reactionId] || 0) + 1;
    return true;
  }

  clear() { this.live = []; clearFireworksShows(); }

  persist() {
    return { enabled: this.enabled, slots: this.slots };
  }

  restore(raw: any) {
    if (!raw) return;
    if (typeof raw.enabled === "boolean") this.enabled = raw.enabled;
    if (Array.isArray(raw.slots)) {
      const next = defaultSlots();
      raw.slots.forEach((s: any, i: number) => { if (next[i] && s) Object.assign(next[i], s); });
      this.slots = next;
    }
    this.live = [];
  }
}
