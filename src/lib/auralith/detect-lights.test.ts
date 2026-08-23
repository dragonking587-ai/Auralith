import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectLights } from "./detect-lights.ts";

function rgba(w: number, h: number, fill: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fill(x, y);
      const o = (y * w + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return data;
}

describe("smart detect lights", () => {
  it("finds a compact lamp on a dark background", () => {
    const w = 64;
    const h = 64;
    const data = rgba(w, h, (x, y) => {
      const d = Math.hypot(x - 20, y - 44);
      if (d < 4) return [255, 220, 140];
      return [12, 14, 18];
    });
    const found = detectLights(data, w, h, "balanced");
    assert.ok(found.length >= 1, `expected a lamp, got ${found.length}`);
    const lamp = found[0]!;
    assert.ok(Math.abs(lamp.x - 20 / 63) < 0.12);
    assert.ok(Math.abs(lamp.y - 44 / 63) < 0.12);
    assert.ok(lamp.confidence > 0.2);
    assert.ok(lamp.strength >= 0.25 && lamp.strength <= 0.95);
  });

  it("does not treat a white wall as a lamp", () => {
    const data = rgba(48, 48, () => [235, 236, 238]);
    const found = detectLights(data, 48, 48, "balanced");
    assert.equal(found.length, 0);
  });

  it("keeps two well-separated lamps", () => {
    const w = 80;
    const h = 48;
    const data = rgba(w, h, (x, y) => {
      if (Math.hypot(x - 12, y - 24) < 3) return [255, 240, 180];
      if (Math.hypot(x - 68, y - 24) < 3) return [180, 210, 255];
      return [8, 10, 12];
    });
    const found = detectLights(data, w, h, "sensitive");
    assert.ok(found.length >= 2, `expected two lamps, got ${found.length}`);
  });

  it("merges adjacent pixels of one lamp", () => {
    const w = 48;
    const h = 48;
    const data = rgba(w, h, (x, y) => {
      if (x >= 20 && x <= 26 && y >= 20 && y <= 24) return [255, 230, 160];
      return [10, 10, 12];
    });
    const found = detectLights(data, w, h, "balanced");
    assert.ok(found.length <= 2, `one lamp should not explode into ${found.length} regions`);
    assert.ok(found.length >= 1);
  });

  it("strict mode is pickier than sensitive", () => {
    const w = 64;
    const h = 64;
    const data = rgba(w, h, (x, y) => {
      if (Math.hypot(x - 32, y - 32) < 5) return [255, 255, 230];
      if (Math.hypot(x - 10, y - 10) < 2) return [90, 90, 70];
      return [16, 16, 18];
    });
    const strict = detectLights(data, w, h, "strict");
    const sensitive = detectLights(data, w, h, "sensitive");
    assert.ok(strict.length >= 1);
    assert.ok(sensitive.length >= strict.length);
  });
});
