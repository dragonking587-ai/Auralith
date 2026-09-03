export type ShellKind = "chrysanthemum" | "peony" | "willow" | "palm" | "ring" | "crossette";

export type FireCfg = {
  intensity: number;
  brightness: number;
  bloom: number;
  lightSpill: number;
  exposureFlash: number;
  burstCount: number;
  durationMs: number;
  launchHeight: number;
  spread: number;
  explosionRadius: number;
  sparkCount: number;
  trailLength: number;
  starLifetime: number;
  gravity: number;
  airDrag: number;
  windDir: number;
  wind: number;
  turbulence: number;
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
  colorA: string;
  colorB: string;
  colorC: string;
  shellMode: "random" | ShellKind;
  marginL: number; marginR: number; marginT: number; marginB: number;
  quality: "Low" | "Medium" | "High" | "Ultra";
  audioReactive: boolean;
  bass: number; mid: number; high: number; beat: number;
};

export type FwDot = { x: number; y: number; r: number; a: number; cr: number; cg: number; cb: number; kind: "star"|"trail"|"smoke"|"flash"|"glow" };

type Star = {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number;
  cr: number; cg: number; cb: number;
  trail: number[];
  split: boolean;
};

type Smoke = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; lit: number };

type Shell = {
  kind: ShellKind;
  x: number; y: number; vx: number; vy: number;
  state: "lift"|"apex"|"break"|"stars"|"fade";
  t: number;
  breakAt: number;
  depth: number;
  stars: Star[];
  smoke: Smoke[];
  flash: number;
};

function hex(c: string): [number, number, number] {
  const s = (c || "#fff").replace("#", "");
  const n = parseInt(s.length === 3 ? s.split("").map((x) => x + x).join("") : s.padEnd(6, "0"), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mulberry(seed: number) {
  let s = seed | 0;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function pickKind(mode: FireCfg["shellMode"], rnd: () => number): ShellKind {
  if (mode !== "random") return mode;
  const k: ShellKind[] = ["chrysanthemum", "peony", "willow", "palm", "ring", "crossette"];
  return k[Math.floor(rnd() * k.length)]!;
}

function qScale(q: FireCfg["quality"]) {
  if (q === "Low") return { stars: 0.35, trail: 0.4, smoke: 0.25, sec: false };
  if (q === "Medium") return { stars: 0.65, trail: 0.7, smoke: 0.55, sec: false };
  if (q === "Ultra") return { stars: 1.25, trail: 1.2, smoke: 1.15, sec: true };
  return { stars: 1, trail: 1, smoke: 1, sec: true };
}

export class FireworksShow {
  shells: Shell[] = [];
  eventId: string;
  started: number;
  cfg: FireCfg;
  rnd: () => number;
  done = false;

  constructor(eventId: string, seed: number, cfg: FireCfg) {
    this.eventId = eventId;
    this.started = performance.now();
    this.cfg = cfg;
    this.rnd = mulberry(seed * 1000);
    const n = Math.max(1, Math.min(8, Math.round(cfg.burstCount || 3)));
    for (let i = 0; i < n; i++) this.armShell(i, n);
  }

  private armShell(i: number, n: number) {
    const rnd = this.rnd;
    const cfg = this.cfg;
    const kind = pickKind(cfg.shellMode, rnd);
    const x0 = cfg.marginL + rnd() * Math.max(0.05, 1 - cfg.marginL - cfg.marginR);
    const delay = i * (0.18 + rnd() * 0.22 * (cfg.spread || 0.6));
    const depth = 0.55 + (rnd() - 0.5) * cfg.depthVar;
    const launch = 0.55 + cfg.launchHeight * 0.55 + rnd() * 0.12;
    this.shells.push({
      kind, x: x0, y: -0.04, vx: (rnd() - 0.5) * 0.12 * cfg.spread,
      vy: launch * (0.85 + rnd() * 0.3) * (0.7 + depth * 0.5),
      state: "lift", t: -delay, breakAt: 0.42 + rnd() * 0.18,
      depth, stars: [], smoke: [], flash: 0
    });
  }

  private burst(sh: Shell) {
    const cfg = this.cfg;
    const qs = qScale(cfg.quality);
    const rnd = this.rnd;
    const imp = cfg.imperfection;
    const [a0, a1, a2] = hex(cfg.colorA);
    const [b0, b1, b2] = hex(cfg.colorB);
    const [c0, c1, c2] = hex(cfg.colorC);
    let count = Math.round((cfg.sparkCount || 40) * qs.stars);
    if (sh.kind === "palm") count = Math.max(8, Math.round(count * 0.35));
    if (sh.kind === "ring") count = Math.max(16, Math.round(count * 0.7));
    if (sh.kind === "willow") count = Math.round(count * 0.8);
    const R = (cfg.explosionRadius || 0.22) * (0.7 + sh.depth);
    sh.flash = 1;
    sh.stars = [];
    for (let i = 0; i < count; i++) {
      let ang = (i / count) * Math.PI * 2;
      if (sh.kind === "ring") ang += (rnd() - 0.5) * 0.08;
      else ang += (rnd() - 0.5) * 0.35 * imp;
      const jitter = 1 + (rnd() - 0.5) * 0.55 * imp;
      let spd = R * 2.2 * jitter;
      if (sh.kind === "peony") spd *= 0.85;
      if (sh.kind === "willow") spd *= 0.7;
      if (sh.kind === "palm") spd *= 1.15;
      if (sh.kind === "chrysanthemum") spd *= 1.05;
      const mix = rnd();
      const cr = mix < 0.45 ? a0 : mix < 0.8 ? b0 : c0;
      const cg = mix < 0.45 ? a1 : mix < 0.8 ? b1 : c1;
      const cb = mix < 0.45 ? a2 : mix < 0.8 ? b2 : c2;
      const tv = 1 + (rnd() - 0.5) * cfg.tempVar * 0.4;
      const life = (cfg.starLifetime || 1) * (sh.kind === "willow" ? 1.6 : sh.kind === "peony" ? 0.75 : 1) * (0.7 + rnd() * 0.6);
      sh.stars.push({
        x: sh.x, y: sh.y,
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd * (sh.kind === "ring" ? 0.55 : 1),
        life, max: life, size: (1.6 + rnd() * 2.2) * sh.depth,
        cr: Math.min(1, cr * tv), cg: Math.min(1, cg * tv), cb: Math.min(1, cb * tv),
        trail: [], split: sh.kind === "crossette" && rnd() < 0.45
      });
    }
    const smn = Math.round(18 * cfg.smokeAmt * qs.smoke);
    for (let i = 0; i < smn; i++) {
      const a = rnd() * Math.PI * 2;
      sh.smoke.push({
        x: sh.x, y: sh.y,
        vx: Math.cos(a) * 0.04 * cfg.smokeExp, vy: Math.sin(a) * 0.02 * cfg.smokeExp,
        life: 0.9 + rnd() * cfg.smokePersist, max: 1.2 + cfg.smokePersist,
        size: (0.03 + rnd() * 0.05) * cfg.smokeSoft * sh.depth, lit: 1
      });
    }
  }

  step(dt: number) {
    const cfg = this.cfg;
    const qs = qScale(cfg.quality);
    const windX = Math.cos(cfg.windDir) * cfg.wind * 0.35;
    const windY = Math.sin(cfg.windDir) * cfg.wind * 0.08;
    const drag = 0.55 + cfg.airDrag;
    const g = cfg.gravity * 0.55;
    const audioBoost = cfg.audioReactive ? 1 + cfg.bass * 0.15 + cfg.beat * 0.1 : 1;
    let alive = false;
    for (const sh of this.shells) {
      sh.t += dt;
      if (sh.t < 0) { alive = true; continue; }
      if (sh.state === "lift" || sh.state === "apex") {
        alive = true;
        sh.vy -= g * dt * 0.55;
        sh.vx += windX * dt * 0.4 + (this.rnd() - 0.5) * cfg.turbulence * 0.05 * dt;
        sh.x += sh.vx * dt;
        sh.y += sh.vy * dt;
        if (sh.y > cfg.launchHeight * 0.85 + 0.15 || sh.vy < 0.08) sh.state = "apex";
        if (sh.state === "apex" && sh.t > sh.breakAt) {
          sh.state = "break";
          this.burst(sh);
          sh.state = "stars";
        }
        if (this.rnd() < 0.4) {
          sh.smoke.push({
            x: sh.x + (this.rnd() - 0.5) * 0.01, y: sh.y,
            vx: (this.rnd() - 0.5) * 0.02, vy: -0.02,
            life: 0.4, max: 0.5, size: 0.012 * sh.depth, lit: 0.6
          });
        }
      } else {
        sh.flash *= Math.pow(0.002, dt);
        const next: Star[] = [];
        for (const st of sh.stars) {
          st.life -= dt;
          if (st.life <= 0) continue;
          alive = true;
          const speed = Math.hypot(st.vx, st.vy);
          const d = Math.exp(-drag * dt * (sh.kind === "willow" ? 1.35 : 1));
          st.vx = st.vx * d + windX * dt + (this.rnd() - 0.5) * cfg.turbulence * 0.15 * dt;
          st.vy = st.vy * d - g * dt * (sh.kind === "willow" ? 1.4 : 1) + windY * dt;
          st.x += st.vx * dt * audioBoost;
          st.y += st.vy * dt;
          st.trail.push(st.x, st.y);
          const maxT = Math.round(10 * cfg.trailLength * qs.trail);
          if (st.trail.length > maxT * 2) st.trail.splice(0, st.trail.length - maxT * 2);
          if (st.split && st.life < st.max * 0.55 && cfg.secondary && qs.sec && this.rnd() < cfg.secondaryChance) {
            st.split = false;
            for (let k = 0; k < 3; k++) {
              const a = this.rnd() * Math.PI * 2;
              next.push({
                x: st.x, y: st.y,
                vx: Math.cos(a) * speed * 0.45, vy: Math.sin(a) * speed * 0.45,
                life: st.life * 0.5, max: st.max * 0.5, size: st.size * 0.6,
                cr: st.cr, cg: st.cg, cb: st.cb, trail: [], split: false
              });
            }
          }
        }
        sh.stars.push(...next);
        sh.stars = sh.stars.filter((s) => s.life > 0);
        for (const sm of sh.smoke) {
          sm.life -= dt * 0.35;
          sm.x += sm.vx * dt + windX * dt * 0.7;
          sm.y += sm.vy * dt + windY * dt;
          sm.vx *= 0.98; sm.vy *= 0.98;
          sm.size += dt * 0.02 * cfg.smokeExp;
          sm.lit *= 0.96;
          if (sm.life > 0) alive = true;
        }
        sh.smoke = sh.smoke.filter((s) => s.life > 0);
        if (!sh.stars.length && !sh.smoke.length && sh.flash < 0.02) sh.state = "fade";
        else alive = true;
      }
    }
    if (!alive && performance.now() - this.started > this.cfg.durationMs) this.done = true;
    if (performance.now() - this.started > this.cfg.durationMs + 1200) this.done = true;
  }

  dots(): FwDot[] {
    const out: FwDot[] = [];
    const cfg = this.cfg;
    const qs = qScale(cfg.quality);
    for (const sh of this.shells) {
      if (sh.t < 0) continue;
      if (sh.state === "lift" || sh.state === "apex") {
        out.push({ x: sh.x, y: sh.y, r: 3.2 * sh.depth * cfg.brightness, a: 0.95, cr: 1, cg: 0.92, cb: 0.75, kind: "star" });
        out.push({ x: sh.x, y: sh.y - 0.02, r: 10 * sh.depth, a: 0.18 * cfg.bloom, cr: 1, cg: 0.7, cb: 0.3, kind: "glow" });
      }
      if (sh.flash > 0.02) {
        out.push({ x: sh.x, y: sh.y, r: 28 * sh.depth * (0.5 + cfg.exposureFlash), a: sh.flash * 0.85, cr: 1, cg: 0.98, cb: 0.92, kind: "flash" });
        out.push({ x: sh.x, y: sh.y, r: 70 * sh.depth * cfg.lightSpill, a: sh.flash * 0.18 * cfg.lightSpill, cr: 1, cg: 0.85, cb: 0.55, kind: "glow" });
      }
      for (const st of sh.stars) {
        const u = st.life / st.max;
        const cool = 1 - (1 - u) * 0.55;
        const a = Math.min(1, u * 1.4) * cfg.brightness * cfg.intensity;
        const head = 2 + st.size * (0.8 + u);
        out.push({ x: st.x, y: st.y, r: head, a, cr: Math.min(1, st.cr * (0.55 + 0.45 / cool)), cg: st.cg * cool, cb: st.cb * cool, kind: "star" });
        const step = qs.trail < 0.5 ? 4 : 2;
        for (let i = 0; i < st.trail.length; i += step * 2) {
          const tx = st.trail[i]!, ty = st.trail[i + 1]!;
          const tu = i / Math.max(2, st.trail.length);
          out.push({ x: tx, y: ty, r: head * (0.35 + tu * 0.4), a: a * tu * 0.55, cr: st.cr * 0.8, cg: st.cg * 0.7, cb: st.cb * 0.5, kind: "trail" });
        }
        if (cfg.glitterAmt > 0.05 && u < 0.45 && ((st.x * 40 + st.y * 70 + performance.now() * 0.004 * cfg.glitterFreq) % 1) < cfg.glitterAmt * 0.25) {
          out.push({ x: st.x, y: st.y, r: 1.4, a: 0.8, cr: 1, cg: 1, cb: 0.92, kind: "flash" });
        }
        if (cfg.crackleAmt > 0 && u < 0.3 && this.rnd() < cfg.crackleAmt * 0.02) {
          out.push({ x: st.x + (this.rnd() - 0.5) * 0.02, y: st.y, r: 2.2, a: 0.7, cr: 1, cg: 0.95, cb: 0.7, kind: "flash" });
        }
      }
      for (const sm of sh.smoke) {
        const u = Math.max(0, sm.life / sm.max);
        out.push({
          x: sm.x, y: sm.y, r: sm.size * 220,
          a: 0.08 * u * cfg.smokeAmt * (0.35 + sm.lit * 0.65),
          cr: 0.35 + sm.lit * 0.5, cg: 0.32 + sm.lit * 0.35, cb: 0.3 + sm.lit * 0.2,
          kind: "smoke"
        });
      }
    }
    return out.slice(0, 2800);
  }
}

const shows = new Map<string, FireworksShow>();

export function syncFireworks(live: { eventId: string; seed: number }[], cfgFor: (id: string) => FireCfg, dt: number) {
  const ids = new Set(live.map((l) => l.eventId));
  for (const id of [...shows.keys()]) if (!ids.has(id)) shows.delete(id);
  for (const l of live) {
    if (!shows.has(l.eventId)) shows.set(l.eventId, new FireworksShow(l.eventId, l.seed, cfgFor(l.eventId)));
  }
  const dots: FwDot[] = [];
  for (const s of shows.values()) {
    s.step(Math.min(0.05, dt));
    if (s.done) shows.delete(s.eventId);
    else dots.push(...s.dots());
  }
  return dots;
}

export function clearFireworksShows() { shows.clear(); }

export const FIREWORK_PRESETS: Record<string, Partial<FireCfg>> = {
  "Realistic Balanced": { shellMode: "random", burstCount: 3, sparkCount: 48, gravity: 0.42, airDrag: 0.55, smokeAmt: 0.55, glitterAmt: 0.25, crackleAmt: 0.15, imperfection: 0.45, depthVar: 0.4 },
  "Cinematic Show": { shellMode: "random", burstCount: 5, sparkCount: 64, bloom: 0.85, lightSpill: 0.7, exposureFlash: 0.8, smokeAmt: 0.7, durationMs: 5000 },
  "Golden Willow": { shellMode: "willow", colorA: "#ffd27a", colorB: "#ff9a3a", colorC: "#fff1c2", trailLength: 0.9, gravity: 0.55, starLifetime: 1.4, smokeAmt: 0.4 },
  "Cold Sky": { shellMode: "peony", colorA: "#b8e0ff", colorB: "#6aa8ff", colorC: "#ffffff", gravity: 0.38, glitterAmt: 0.45, smokeAmt: 0.35 },
  "Festival Finale": { shellMode: "random", burstCount: 6, sparkCount: 72, secondary: true, secondaryChance: 0.55, crackleAmt: 0.4, intensity: 0.9 }
};
