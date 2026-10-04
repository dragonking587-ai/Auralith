import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "esbuild";

const bundled = await build({
  stdin: { contents: 'export * from "./src/scene/gamingOverlay.ts"; export * from "./src/scene/overlayEffects.ts"; export { semverNewer } from "./src/scene/updater.ts"; import { GamingOverlaySurface } from "./src/ui/GamingOverlaySurface.tsx"; import { createElement } from "react"; import { renderToStaticMarkup } from "react-dom/server.browser"; export { act as surfaceAct, create as createSurfaceRenderer } from "react-test-renderer"; export const surfaceElement = (props) => createElement(GamingOverlaySurface, props); export const renderSurface = (props) => renderToStaticMarkup(surfaceElement(props));', resolveDir: process.cwd() },
  bundle: true, write: false, platform: "node", format: "esm",
});
const module = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));
const { createGamingOverlay, normalizeGamingOverlay, normalizeGamingOverlays, overlayEffectState, overlayAudioLevel, smoothOverlayAudio, overlayRgba, semverNewer, renderSurface } = module;

const first = createGamingOverlay("panel");
const second = createGamingOverlay("panel");
assert.notEqual(first.id, second.id);
assert.notEqual(first.borderColor, "#d4af37", "new frames should no longer be forced to gold");
assert.equal(first.fillOpacity, 0.14);
const custom = normalizeGamingOverlay({ ...first, borderColor: "#2244ff", effectColor: "#ff4488", effect: "chase", effectSpeed: 1.7, effectIntensity: 1.25, audioReactive: true, audioBand: "high", audioSensitivity: 2, fillOpacity: 0 });
const saved = normalizeGamingOverlays(JSON.parse(JSON.stringify([custom, second])));
assert.deepEqual(saved[0], custom, "Save/Open must preserve all per-box style and audio settings");
assert.equal(saved[1].borderColor, second.borderColor, "editing one box must not change another");
assert.equal(saved[1].audioReactive, false);
assert.equal(overlayRgba(custom.fillColor, custom.fillOpacity), "rgba(13, 15, 20, 0)", "transparent fills must stay transparent");

const legacy = normalizeGamingOverlay({ id: "legacy-box", kind: "panel", fillColor: "#102030", borderColor: "#d4af37", borderWidth: 4, glow: 18, opacity: 0.72 });
assert.equal(legacy.effect, "none");
assert.equal(legacy.audioReactive, false);
assert.equal(legacy.fillOpacity, 1, "older saved projects keep their original solid fill");
assert.equal(legacy.opacity, 0.72);
assert.equal(overlayEffectState(legacy, 0).glow, overlayEffectState(legacy, 20).glow, "legacy static frames must not animate");
assert.equal(overlayEffectState(legacy, 0).glowColor, "#d4af37", "legacy glow keeps its original color");
assert.equal(overlayEffectState(custom, 0).glowColor, custom.effectColor, "live effects use their separate accent/glow color");
const malformed = normalizeGamingOverlay({ ...custom, effect: "script", audioBand: "constructor", effectSpeed: Infinity, effectIntensity: -99, audioSensitivity: 99, fillOpacity: 99, borderColor: "url(bad)" });
assert.equal(malformed.effect, "none");
assert.equal(malformed.audioBand, "bass");
assert.equal(malformed.effectIntensity, 0);
assert.equal(malformed.audioSensitivity, 3);
assert.equal(malformed.fillOpacity, 1);
assert.match(malformed.borderColor, /^#[0-9a-f]{6}$/i);

const audio = { raw: 0, rms: 0, bass: 1, low: 0, mid: 0, high: 0, beat: 0, transient: 0, fullMix: 0.5 };
const bassBox = { ...custom, audioBand: "bass" };
assert.equal(overlayAudioLevel(bassBox, audio), 1);
assert.equal(overlayAudioLevel(custom, audio), 0, "independent boxes must use their selected bands");
assert.equal(overlayAudioLevel({ ...bassBox, audioReactive: false }, audio), 0);
assert.equal(overlayAudioLevel(bassBox), 0);
const attack = smoothOverlayAudio(0, 1, 0.016);
assert.ok(attack > 0 && attack < 1);
assert.ok(smoothOverlayAudio(attack, 0, 0.016) < attack);
assert.ok(overlayEffectState(bassBox, 0, 1).glow > overlayEffectState(bassBox, 0, 0).glow);
const pulse = { ...first, effect: "pulse", effectSpeed: 0.5 };
assert.ok(overlayEffectState(pulse, 1).glow > overlayEffectState(pulse, 0).glow);
assert.notEqual(overlayEffectState(custom, 0.2).angle, overlayEffectState({ ...custom, effectSpeed: 0.2 }, 0.2).angle);
assert.equal(overlayEffectState({ ...custom, effectIntensity: 0 }, 1, 1).glow, 0);
assert.equal(overlayEffectState({ ...custom, effectIntensity: 0 }, 1, 1).chaseOpacity, 0);
const framedWeb = normalizeGamingOverlay({ ...createGamingOverlay("web"), ...custom, kind: "web", url: "https://loudman.live/", sourceWidth: 640, sourceHeight: 360, webFit: "fit" });
assert.equal(framedWeb.effect, "chase");
assert.equal(framedWeb.sourceWidth, 640);
assert.equal(framedWeb.webFit, "fit", "styling web frames must preserve whole-card scaling");

const surfaceProps = {
  items: [custom, { ...second, visible: false }],
  viewport: { x: 0, y: 0, w: 960, h: 540 }, projectWidth: 1920, projectHeight: 1080,
  edit: false, previewInteractive: false, selectedId: custom.id, onSelect: () => {}, onPatch: () => {},
};
const cleanHtml = renderSurface(surfaceProps);
assert.match(cleanHtml, /gaming-overlay-decoration/, "styled frames must remain in Clean Capture");
assert.match(cleanHtml, /gaming-overlay-chase/, "the selected border animation must render");
assert.doesNotMatch(cleanHtml, /gaming-overlay-edit-hit/, "Clean Capture must not include editor handles or labels");
assert.equal((cleanHtml.match(/class="gaming-overlay-item /g) || []).length, 1, "hidden boxes must stay hidden");
assert.match(cleanHtml, /--overlay-border-width:1.5px/, "borders must scale with scene resolution");
const editHtml = renderSurface({ ...surfaceProps, edit: true });
assert.match(editHtml, /gaming-overlay-edit-hit/, "box selection and dragging remain available in Edit");

// Run the actual component lifecycle with a controlled animation clock. In
// particular, disabling the last animated box must reset its imperative CSS.
const frames = new Map();
const styles = new Map();
const previousRaf = globalThis.requestAnimationFrame;
const previousCancel = globalThis.cancelAnimationFrame;
let nextFrame = 0;
globalThis.requestAnimationFrame = (callback) => { frames.set(++nextFrame, callback); return nextFrame; };
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
const node = { style: { setProperty: (name, value) => styles.set(name, value) } };
const { surfaceAct, createSurfaceRenderer, surfaceElement } = module;
let renderer;
try {
  const liveProps = { ...surfaceProps, items: [bassBox], getAudioSnapshot: () => audio };
  surfaceAct(() => { renderer = createSurfaceRenderer(surfaceElement(liveProps), { createNodeMock: () => node }); });
  assert.equal(frames.size, 1);
  const tick = frames.values().next().value;
  frames.clear();
  surfaceAct(() => tick(performance.now() + 100));
  assert.notEqual(styles.get("--overlay-border-color"), overlayEffectState(bassBox, 0, 0).borderColor);
  const stoppedBox = { ...bassBox, effect: "none", audioReactive: false };
  surfaceAct(() => renderer.update(surfaceElement({ ...liveProps, items: [stoppedBox] })));
  assert.equal(frames.size, 0, "disabling animation must cancel its scheduled frame");
  assert.equal(styles.get("--overlay-border-color"), overlayEffectState(stoppedBox, 0).borderColor, "stopping must restore the selected base color");
  assert.equal(styles.get("--overlay-chase-opacity"), "0");
  surfaceAct(() => renderer.update(surfaceElement(liveProps)));
  assert.equal(frames.size, 1);
  surfaceAct(() => renderer.unmount());
  assert.equal(frames.size, 0, "unmount must not leave an animation loop running");
} finally {
  globalThis.requestAnimationFrame = previousRaf;
  globalThis.cancelAnimationFrame = previousCancel;
}

// Exercise the actual comparison shipped in older clients. The new version
// must be visible even to clients that compare prerelease strings lexically.
const version = fs.readFileSync("VERSION", "utf8").trim();
for (const installed of ["1.0.0-rc.49", "1.0.0-rc.49.1", "1.0.0-rc.49.2", "1.0.0-rc.49.3.7", "1.0.0-rc.49.3.8", "1.0.0-rc.49.3.9", "1.0.0-rc.49.3.10"]) {
  assert.ok(semverNewer(version, installed), installed + " must detect " + version);
}
console.log("OVERLAY_EFFECTS_VERIFY_OK save/open=preserved legacy=preserved independent-audio=passed animations=passed animation-stop=passed clean-capture=passed older-client-update=passed");
