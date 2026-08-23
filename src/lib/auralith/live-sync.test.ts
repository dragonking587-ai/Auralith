import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldReplaceImage } from "./live-rev.ts";
import { parseScene } from "./schema.ts";

describe("image revision sync", () => {
  it("replaces when the incoming revision is newer", () => {
    assert.equal(shouldReplaceImage(2, 1), true);
    assert.equal(shouldReplaceImage(1, 1), false);
    assert.equal(shouldReplaceImage(1, 3), false);
    assert.equal(shouldReplaceImage(4, 0), true);
  });

  it("parses image.rev and defaults missing rev to 0", () => {
    const s = parseScene({
      schemaVersion: 1,
      image: { id: "img_a", width: 100, height: 80, mime: "image/jpeg", rev: 7 },
    });
    assert.ok(s);
    assert.equal(s.image?.rev, 7);
    const old = parseScene({
      schemaVersion: 1,
      image: { id: "img_b", width: 100, height: 80, mime: "image/jpeg" },
    });
    assert.equal(old?.image?.rev, 0);
  });
});
