import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySensitivity, stepEnvelope } from "./envelope.ts";
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
    assert.equal("magic" in s, false);
  });

  it("migrates old Flame and Magic regions to Pulse without crashing", () => {
    const flame = parseScene({
      schemaVersion: 1,
      regions: [{ kind: "stamp", x: 0.2, y: 0.3, effect: "flame", color: "#e3944a" }],
      flame: { density: 0.8, speed: 0.4, heat: 0.9 },
    });
    assert.ok(flame);
    assert.equal(flame.regions[0]?.effect, "pulse");
    assert.equal("magic" in flame, false);
    assert.equal("flame" in flame, false);

    const magic = parseScene({
      schemaVersion: 1,
      regions: [{ kind: "stamp", x: 0.4, y: 0.5, effect: "magic", color: "#7ec8ff" }],
      magic: { intensity: 0.7, flow: 0.6, spread: 0.5, energy: 0.4, style: "ribbons", density: 0.88, distortion: true },
    });
    assert.ok(magic);
    assert.equal(magic.regions[0]?.effect, "pulse");
    assert.equal("magic" in magic, false);
    assert.equal(magic.regions[0]?.color, "#7ec8ff");
  });

  it("keeps Pulse / Hue / Flicker / Strobe regions", () => {
    const s = parseScene({
      schemaVersion: 1,
      regions: [
        { kind: "stamp", x: 0.2, y: 0.3, effect: "hue" },
        { kind: "stamp", x: 0.4, y: 0.3, effect: "flicker" },
        { kind: "stamp", x: 0.6, y: 0.3, effect: "strobe" },
      ],
    });
    assert.ok(s);
    assert.equal(s.regions[0]?.effect, "hue");
    assert.equal(s.regions[1]?.effect, "flicker");
    assert.equal(s.regions[2]?.effect, "strobe");
  });
});
