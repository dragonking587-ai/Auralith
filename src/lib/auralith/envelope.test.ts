import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySensitivity, stepEnvelope } from "./envelope.ts";
import { heatContribute, normalizeHeat, flameColor } from "./flame.ts";
import { computeImageRect, canvasToImageNorm, imageNormToCanvas } from "./coords.ts";
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
});

describe("grouped flame brightness", () => {
  it("overlapping heat uses max, not additive white", () => {
    const a = heatContribute(0.7, 0.6);
    const b = heatContribute(0.7, 0.9);
    assert.equal(a, 0.7);
    assert.equal(b, 0.9);
    assert.ok(normalizeHeat(2.5) === 1);
  });

  it("never emits full white", () => {
    const c = flameColor(1, 1);
    assert.ok(c.r < 255 || c.g < 230);
    assert.ok(c.b < 120);
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
  });
});
