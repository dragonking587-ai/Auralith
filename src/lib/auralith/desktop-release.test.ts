import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isNewerVersion, parseVersionParts } from "./version-compare.ts";

describe("desktop version compare", () => {
  it("parses desktop-test tags", () => {
    assert.deepEqual(parseVersionParts("1.0.0-desktop-test.9"), [1, 0, 0, 9]);
    assert.deepEqual(parseVersionParts("v1.0.0-desktop-test.10"), [1, 0, 0, 10]);
  });

  it("orders desktop-test builds numerically", () => {
    assert.equal(isNewerVersion("1.0.0-desktop-test.10", "1.0.0-desktop-test.9"), true);
    assert.equal(isNewerVersion("1.0.0-desktop-test.9", "1.0.0-desktop-test.10"), false);
    assert.equal(isNewerVersion("1.0.0-desktop-test.9", "1.0.0-desktop-test.9"), false);
  });

  it("orders classic semver", () => {
    assert.equal(isNewerVersion("1.0.10", "1.0.9"), true);
    assert.equal(isNewerVersion("1.0.5", "1.0.10"), false);
  });
});
