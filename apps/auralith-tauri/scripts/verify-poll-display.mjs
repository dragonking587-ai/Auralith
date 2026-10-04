import assert from "node:assert/strict";
import { build } from "esbuild";

const bundled = await build({
  stdin: { contents: `
    export * from "./src/scene/poll.ts";
    export { serializeProject } from "./src/scene/projectIo.ts";
    export { newProject } from "./src/scene/types.ts";
    import { PollHud, PollDisplayToggle } from "./src/ui/PollHud.tsx";
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server.browser";
    export { act, create } from "react-test-renderer";
    export const hud = (props) => createElement(PollHud, props);
    export const toggle = (props) => createElement(PollDisplayToggle, props);
    export const renderHud = (props) => renderToStaticMarkup(hud(props));
  `, resolveDir: process.cwd() },
  bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic"
});
const model = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));
const { defaultPollConfig, defaultPollRuntime, normalizePollConfig, persistablePoll,
  startPoll, endPoll, resetPoll, applyVote, serializeProject, newProject,
  hud, toggle, renderHud, act, create } = model;

assert.equal(defaultPollConfig().display.visible, false, "new scenes must keep the card out of the way");
assert.equal(normalizePollConfig().display.visible, false);
const oldConfig = defaultPollConfig();
delete oldConfig.display.visible;
oldConfig.question = "Next effect?";
oldConfig.display.x = 450;
oldConfig.display.textColor = "#123456";
oldConfig.display.showCounts = false;
const migrated = normalizePollConfig(oldConfig);
assert.equal(migrated.display.visible, false, "older scenes must wait for the host to show the card");
assert.deepEqual(migrated, { ...oldConfig, display: { ...oldConfig.display, visible: false } }, "migration must preserve custom poll settings");

const shown = normalizePollConfig({ ...defaultPollConfig(), redEffectId: "red-effect", greenEffectId: "green-effect", display: { visible: true, x: 450, y: 210 } });
const hidden = { ...shown, display: { ...shown.display, visible: false } };
for (const config of [shown, hidden]) {
  const project = await serializeProject({ ...newProject(), poll: config }, { poll: persistablePoll(config) });
  const reopened = normalizePollConfig(JSON.parse(JSON.stringify(project)).poll);
  assert.deepEqual(reopened, config, "Save/Open must remember visibility, position, and all poll settings");
}

let rt = startPoll(defaultPollRuntime(), shown);
let votes = new Map();
for (const [viewer, option] of [["one", "red"], ["two", "red"], ["three", "green"]]) {
  const result = applyVote(rt, shown, votes, viewer, option);
  assert.equal(result.accepted, true);
  rt = result.rt;
  votes = result.votes;
}
const before = JSON.stringify({ rt, votes: [...votes], config: shown });
const props = { config: shown, runtime: rt, left: 100, top: 80, width: 260, clean: false, room: "TEST-ROOM", onPointerDown: () => {} };
for (const clean of [false, true]) {
  assert.equal(renderHud({ ...props, config: hidden, clean }), "", "a hidden card must leave no visible or clickable surface in any view");
  const html = renderHud({ ...props, clean });
  assert.match(html, /Which color\?/);
  assert.match(html, /Total 3/);
  assert.match(html, /67%/);
  assert.match(html, /TEST-ROOM/);
}
assert.equal(JSON.stringify({ rt, votes: [...votes], config: shown }), before, "display changes must not mutate votes, round, or effect overrides");
const votedWhileHidden = applyVote(rt, hidden, votes, "four", "red");
assert.equal(votedWhileHidden.accepted, true, "voting must continue while the card is hidden");
assert.equal(votedWhileHidden.rt.roundId, rt.roundId);
assert.equal(votedWhileHidden.rt.overrideId, "red-effect");
assert.match(renderHud({ ...props, runtime: votedWhileHidden.rt }), /Total 4/, "showing again must use current votes");
startPoll(rt, hidden);
endPoll(rt, hidden);
resetPoll(hidden);
assert.equal(hidden.display.visible, false, "starting, ending, or resetting a round must not force the card on");

let selected = hidden;
let controls;
const updateControls = () => controls.update(toggle({ visible: selected.display.visible, onChange }));
const onChange = (visible) => {
  selected = { ...selected, display: { ...selected.display, visible } };
  updateControls();
};
act(() => { controls = create(toggle({ visible: false, onChange })); });
assert.equal(controls.root.findByType("input").props.checked, false);
act(() => controls.root.findByType("input").props.onChange({ target: { checked: true } }));
assert.equal(controls.root.findByType("input").props.checked, true);
assert.deepEqual(selected, shown, "turning the card on must keep its existing settings");
act(() => controls.root.findByType("input").props.onChange({ target: { checked: false } }));
assert.deepEqual(selected, hidden);
act(() => controls.unmount());

let surface;
act(() => { surface = create(hud(props)); });
assert.equal(surface.root.findByProps({ className: "poll-hud" }).props.onPointerDown, props.onPointerDown, "visible Edit cards must still support dragging");
act(() => surface.update(hud({ ...props, clean: true })));
const captured = surface.root.findByProps({ className: "poll-hud" });
assert.equal(captured.props.style.pointerEvents, "none");
assert.equal(captured.props.onPointerDown, undefined, "Clean Capture must not allow poll dragging");
act(() => surface.update(hud({ ...props, config: hidden })));
assert.equal(surface.toJSON(), null, "hiding an already visible card must unmount its pointer target");
act(() => surface.update(hud({ ...props, runtime: votedWhileHidden.rt })));
assert.ok(surface.toJSON(), "the card must reappear without resetting the live round");
act(() => surface.unmount());

console.log("POLL_DISPLAY_VERIFY_OK default-hidden=passed legacy-settings=preserved save/open=passed hidden-voting=passed toggle=passed clean-capture=passed");
