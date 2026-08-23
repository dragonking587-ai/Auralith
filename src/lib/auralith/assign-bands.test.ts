import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assignBands } from "./assign-bands.ts";
import type { DetectedLight } from "./detect-lights.ts";
import type { BandId } from "./types.ts";

function light(partial: Partial<DetectedLight> & { color: string; x: number; y: number }): DetectedLight {
  return {
    r: 0.04,
    confidence: 0.8,
    strength: 0.6,
    ...partial,
  };
}

function uniqueBands(lights: DetectedLight[]): Set<BandId> {
  return new Set(assignBands(lights));
}

describe("smart detect band assignment", () => {
  it("maps four distinct colors onto four bands", () => {
    const lights = [
      light({ color: "#e8b86a", x: 0.2, y: 0.5 }),
      light({ color: "#6aa8e8", x: 0.4, y: 0.5 }),
      light({ color: "#b07ce8", x: 0.6, y: 0.5 }),
      light({ color: "#f4f1ea", x: 0.8, y: 0.5 }),
    ];
    const bands = assignBands(lights);
    assert.equal(new Set(bands).size, 4);
  });

  it("keeps matching colors on the same band", () => {
    const lights = [
      light({ color: "#e8b86a", x: 0.1, y: 0.4 }),
      light({ color: "#efc27a", x: 0.2, y: 0.41 }),
      light({ color: "#6aa8e8", x: 0.7, y: 0.4 }),
      light({ color: "#7bb4ee", x: 0.8, y: 0.41 }),
    ];
    const bands = assignBands(lights);
    assert.equal(bands[0], bands[1]);
    assert.equal(bands[2], bands[3]);
    assert.notEqual(bands[0], bands[2]);
    assert.equal(uniqueBands(lights).size, 2);
  });

  it("does not split a row of identical lamps", () => {
    const lights = Array.from({ length: 8 }, (_, i) =>
      light({ color: "#e8b86a", x: 0.12 + i * 0.1, y: 0.5, r: 0.04, strength: 0.62 }),
    );
    const bands = assignBands(lights);
    assert.equal(new Set(bands).size, 1);
  });

  it("splits one color by size when scale clearly differs", () => {
    const lights = [
      light({ color: "#e8b86a", x: 0.2, y: 0.4, r: 0.11, strength: 0.9 }),
      light({ color: "#e8b86a", x: 0.35, y: 0.4, r: 0.1, strength: 0.88 }),
      light({ color: "#e8b86a", x: 0.7, y: 0.7, r: 0.018, strength: 0.35 }),
      light({ color: "#e8b86a", x: 0.8, y: 0.72, r: 0.016, strength: 0.32 }),
      light({ color: "#e8b86a", x: 0.75, y: 0.78, r: 0.017, strength: 0.3 }),
    ];
    const bands = assignBands(lights);
    assert.equal(bands[0], bands[1]);
    assert.equal(bands[2], bands[3]);
    assert.equal(bands[3], bands[4]);
    assert.notEqual(bands[0], bands[2]);
  });

  it("is deterministic", () => {
    const lights = [
      light({ color: "#c45c4a", x: 0.2, y: 0.3 }),
      light({ color: "#6ad08a", x: 0.5, y: 0.3 }),
      light({ color: "#6aa8e8", x: 0.8, y: 0.3 }),
      light({ color: "#c45c4a", x: 0.25, y: 0.6 }),
    ];
    const a = assignBands(lights).join(",");
    const b = assignBands(lights).join(",");
    const shuffled = assignBands([lights[2]!, lights[0]!, lights[3]!, lights[1]!]);
    assert.equal(a, b);
    assert.equal(shuffled[1], shuffled[2]);
  });

  it("uses up to three bands for three color families", () => {
    const lights = [
      light({ color: "#6ad08a", x: 0.2, y: 0.4 }),
      light({ color: "#6ad08a", x: 0.25, y: 0.45 }),
      light({ color: "#4ec4d4", x: 0.5, y: 0.4 }),
      light({ color: "#b07ce8", x: 0.8, y: 0.4 }),
    ];
    assert.equal(uniqueBands(lights).size, 3);
  });
});
