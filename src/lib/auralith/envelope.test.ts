import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySensitivity, stepEnvelope } from "./envelope.ts";
import { energyContribute, magicTargets, magicTint, MAGIC_LIMITS, MagicSim } from "./magic.ts";
import { computeImageRect, canvasToImageNorm, imageNormToCanvas, snapRect } from "./coords.ts";
import { parseScene, emptyScene } from "./schema.ts";

describe("envelope", () => {
  it("attacks faster than it releases", () => {
    const dt = 0.016;
    const up = stepEnvelope(0, 1, dt, 0.006, 0.16);
    const down = stepEnvelope(1, 0, dt, 0.006, 0.16);
    assert.ok(up > 0.8, `attack should be nearly instant, got ${up}`);
    assert.ok(1 - down < 0.25, `release should be slower, drop=${1 - down}`);
  });

  it("soft-clips sensitivity above 1", () => {
    assert.equal(applySensitivity(0.4, 1), 0.4);
    assert.ok(applySensitivity(0.9, 2) <= 1);
    assert.ok(applySensitivity(1, 3) <= 1);
  });
});

describe("coords stay image-normalized", () => {
  it("round-trips through fill framing", () => {
    const rect = computeImageRect(1920, 1080, 1280, 720, "fill", 0.5, 0.5);
    const p = imageNormToCanvas(0.25, 0.4, rect);
    const back = canvasToImageNorm(p.x, p.y, rect);
    assert.ok(back);
    assert.ok(Math.abs(back.x - 0.25) < 1e-6);
    assert.ok(Math.abs(back.y - 0.4) < 1e-6);
  });

  it("fill crops rather than stretching", () => {
    const rect = computeImageRect(1920, 1080, 1080, 1920, "fill", 0.5, 0.5);
    const aspect = rect.w / rect.h;
    assert.ok(Math.abs(aspect - 1920 / 1080) < 1e-6);
  });

  it("snaps the image rect to integer pixels identically every frame", () => {
    const a = snapRect(computeImageRect(1920, 1080, 1280, 720, "fill", 0.5, 0.5));
    const b = snapRect(computeImageRect(1920, 1080, 1280, 720, "fill", 0.5, 0.5));
    assert.equal(a.x, b.x);
    assert.equal(a.y, b.y);
    assert.equal(a.w, b.w);
    assert.equal(a.h, b.h);
    assert.equal(a.x, Math.round(a.x));
    assert.equal(a.y, Math.round(a.y));
    assert.equal(a.w, Math.round(a.w));
    assert.equal(a.h, Math.round(a.h));
  });
});

describe("grouped magic brightness", () => {
  it("overlapping energy uses max, not additive white", () => {
    const a = energyContribute(0.7, 0.6);
    const b = energyContribute(0.7, 0.9);
    assert.equal(a, 0.7);
    assert.equal(b, 0.9);
  });

  it("tint never blows out to white", () => {
    const c = magicTint("#ffffff", 40, 1);
    assert.ok(Math.max(c.r, c.g, c.b) < 250);
  });
});

describe("bounded magic envelope", () => {
  it("maps current energy instead of integrating", () => {
    const quiet = magicTargets(0, 0, 0.5);
    const mid = magicTargets(0.5, 0, 0.5);
    const loud = magicTargets(1, 0, 0.5);
    const surge = magicTargets(1, 1, 0.5);
    assert.ok(quiet.aura < mid.aura);
    assert.ok(mid.aura < loud.aura);
    assert.ok(quiet.reach < mid.reach);
    assert.ok(mid.reach < surge.reach);
    const again = magicTargets(1, 1, 0.5);
    assert.equal(surge.aura, again.aura);
    assert.ok(surge.aura <= MAGIC_LIMITS.maxAura);
    assert.ok(surge.reach <= MAGIC_LIMITS.maxReach);
  });

  it("spread does not multiply size past the cap", () => {
    const hot = magicTargets(1, 1, 1);
    assert.ok(hot.aura <= MAGIC_LIMITS.maxAura);
    assert.ok(hot.reach <= MAGIC_LIMITS.maxReach);
  });

  it("does not accumulate size or sparks over a long loud run", () => {
    const sim = new MagicSim();
    const region = {
      id: "stamp_a",
      kind: "stamp" as const,
      x: 0.5,
      y: 0.8,
      r: 0.06,
      band: "bass" as const,
      effect: "magic" as const,
      color: "#88a0ff",
      intensity: 1,
    };
    const loud = { bass: 1, low: 0, mid: 0, high: 0 };
    const cfg = { intensity: 1, flow: 1, spread: 1, energy: 1, style: "flowing" as const, density: 0.65, distortion: false };
    let maxAura = 0;
    for (let i = 1; i <= 240; i++) {
      sim.step(1 / 60, [region], loud, cfg, 1, i * (1000 / 60));
      const s = sim.bodyScale("stamp_a");
      assert.ok(s);
      maxAura = Math.max(maxAura, s.aura);
      assert.ok(s.aura <= MAGIC_LIMITS.maxAura + 1e-6);
      assert.ok(s.reach <= MAGIC_LIMITS.maxReach + 1e-6);
      assert.ok(sim.liveCount() <= MAGIC_LIMITS.maxSparks);
      const ext = sim.extents();
      if (ext.live) {
        assert.ok(ext.minY >= region.y - 0.55, `spark escaped ${ext.minY}`);
        assert.ok(ext.maxY <= region.y + 0.55);
      }
    }
    const afterLoud = sim.bodyScale("stamp_a")!;
    assert.ok(afterLoud.aura <= MAGIC_LIMITS.maxAura);
    assert.equal(maxAura, afterLoud.aura);

    const silent = { bass: 0, low: 0, mid: 0, high: 0 };
    for (let i = 241; i <= 360; i++) {
      sim.step(1 / 60, [region], silent, cfg, 1, i * (1000 / 60));
    }
    const afterQuiet = sim.bodyScale("stamp_a")!;
    assert.ok(afterQuiet.aura < afterLoud.aura);
    assert.ok(afterQuiet.aura <= MAGIC_LIMITS.minAura + 0.4);
    assert.ok(sim.liveCount() < 40);
  });

  it("builds a wispy energy field rather than a solid blob of sparks", () => {
    const sim = new MagicSim();
    const region = {
      id: "stamp_body",
      kind: "stamp" as const,
      x: 0.5,
      y: 0.5,
      r: 0.08,
      band: "bass" as const,
      effect: "magic" as const,
      color: "#88a0ff",
      intensity: 1,
    };
    const loud = { bass: 1, low: 0.4, mid: 0, high: 0 };
    const cfg = { intensity: 0.8, flow: 0.7, spread: 0.7, energy: 0.75, style: "flowing" as const, density: 0.65, distortion: false };
    for (let i = 1; i <= 45; i++) {
      sim.step(1 / 60, [region], loud, cfg, 1, i * (1000 / 60));
    }
    assert.ok(sim.fieldCoverage() > 40, `expected an energy field, got ${sim.fieldCoverage()} cells`);
    assert.ok(sim.liveCount() < sim.fieldCoverage(), "sparks must stay secondary");
  });

  it("dense spell stays bounded and still uses a field", () => {
    const sim = new MagicSim();
    const region = {
      id: "stamp_dense",
      kind: "stamp" as const,
      x: 0.5,
      y: 0.5,
      r: 0.08,
      band: "bass" as const,
      effect: "magic" as const,
      color: "#88a0ff",
      intensity: 1,
    };
    const loud = { bass: 1, low: 0.3, mid: 0, high: 0 };
    const cfg = { intensity: 1, flow: 0.8, spread: 0.8, energy: 0.8, style: "dense" as const, density: 1, distortion: false };
    for (let i = 1; i <= 60; i++) {
      sim.step(1 / 60, [region], loud, cfg, 1, i * (1000 / 60));
      const s = sim.bodyScale("stamp_dense");
      assert.ok(s);
      assert.ok(s.aura <= MAGIC_LIMITS.maxAura + 1e-6);
      assert.ok(s.reach <= MAGIC_LIMITS.maxReach + 1e-6);
    }
    assert.ok(sim.fieldCoverage() > 40);
    assert.ok(sim.liveCount() < sim.fieldCoverage());
  });

  it("ethereal ribbons stays bounded and still uses a field", () => {
    const sim = new MagicSim();
    const region = {
      id: "stamp_ribbons",
      kind: "stamp" as const,
      x: 0.5,
      y: 0.72,
      r: 0.08,
      band: "bass" as const,
      effect: "magic" as const,
      color: "#3fd18a",
      intensity: 1,
    };
    const loud = { bass: 1, low: 0.3, mid: 0, high: 0 };
    const cfg = { intensity: 1, flow: 0.8, spread: 0.8, energy: 0.8, style: "ribbons" as const, density: 0.8, distortion: false };
    for (let i = 1; i <= 60; i++) {
      sim.step(1 / 60, [region], loud, cfg, 1, i * (1000 / 60));
      const s = sim.bodyScale("stamp_ribbons");
      assert.ok(s);
      assert.ok(s.aura <= MAGIC_LIMITS.maxAura + 1e-6);
      assert.ok(s.reach <= MAGIC_LIMITS.maxReach + 1e-6);
    }
    assert.ok(sim.fieldCoverage() > 40);
    assert.ok(sim.liveCount() < sim.fieldCoverage());
  });
});

describe("scene schema", () => {
  it("rejects garbage without throwing", () => {
    assert.equal(parseScene(null), null);
    assert.equal(parseScene("{not json"), null);
    assert.equal(parseScene(123), null);
  });

  it("migrates missing fields", () => {
    const s = parseScene({ schemaVersion: 1, regions: [{ kind: "stamp", x: 0.2, y: 0.3 }] });
    assert.ok(s);
    assert.equal(s.schemaVersion, 1);
    assert.equal(s.regions.length, 1);
    assert.equal(s.regions[0]?.kind, "stamp");
    assert.ok(s.audio.sensitivity > 0);
    assert.equal(emptyScene().output.fps, 60);
    assert.ok(s.magic);
    assert.ok(s.magic.intensity > 0);
    assert.equal(s.magic.distortion, false);
  });

  it("migrates old Flame scenes to Magic", () => {
    const s = parseScene({
      schemaVersion: 1,
      regions: [{ kind: "stamp", x: 0.2, y: 0.3, effect: "flame", color: "#e3944a" }],
      flame: { density: 0.8, speed: 0.4, heat: 0.9 },
    });
    assert.ok(s);
    assert.equal(s.regions[0]?.effect, "magic");
    assert.equal(s.magic.energy, 0.8);
    assert.equal(s.magic.flow, 0.4);
    assert.equal(s.magic.intensity, 0.9);
    assert.ok(s.magic.spread > 0);
    assert.equal(s.magic.style, "flowing");
    assert.equal(s.magic.distortion, false);
  });

  it("defaults missing Magic style to Flowing", () => {
    const s = parseScene({ schemaVersion: 1, magic: { intensity: 0.5, flow: 0.4, spread: 0.3, energy: 0.2 } });
    assert.ok(s);
    assert.equal(s.magic.style, "flowing");
    assert.ok(s.magic.density >= 0 && s.magic.density <= 1);
    assert.equal(s.magic.distortion, false);
  });

  it("preserves Dense Spell style in saved scenes", () => {
    const s = parseScene({
      schemaVersion: 1,
      magic: { intensity: 0.7, flow: 0.6, spread: 0.5, energy: 0.4, style: "dense", density: 0.88 },
    });
    assert.ok(s);
    assert.equal(s.magic.style, "dense");
    assert.equal(s.magic.density, 0.88);
  });

  it("preserves Ethereal Ribbons style in saved scenes", () => {
    const s = parseScene({
      schemaVersion: 1,
      magic: { style: "ribbons", density: 0.7, energy: 0.5, intensity: 0.6 },
    });
    assert.ok(s);
    assert.equal(s.magic.style, "ribbons");
    assert.equal(s.magic.density, 0.7);
  });

  it("ignores unknown Magic styles", () => {
    const s = parseScene({ schemaVersion: 1, magic: { style: "patronus" } });
    assert.ok(s);
    assert.equal(s.magic.style, "flowing");
  });

  it("keeps Distortion off unless explicitly enabled", () => {
    const off = parseScene({ schemaVersion: 1, magic: { intensity: 1 } });
    const on = parseScene({ schemaVersion: 1, magic: { distortion: true } });
    assert.equal(off?.magic.distortion, false);
    assert.equal(on?.magic.distortion, true);
  });
});
