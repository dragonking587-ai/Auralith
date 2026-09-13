import { createGamingOverlay, safeOverlayUrl, type GamingOverlayItem, type GamingOverlayKind } from "../scene/gamingOverlay";

type Props = {
  items: GamingOverlayItem[];
  selectedId: string | null;
  projectWidth: number;
  projectHeight: number;
  onChange: (items: GamingOverlayItem[]) => void;
  onSelect: (id: string | null) => void;
};

const number = (v: string, fallback: number) => Number.isFinite(Number(v)) ? Number(v) : fallback;

export function GamingOverlayDesigner(props: Props) {
  const selected = props.items.find((item) => item.id === props.selectedId) || null;
  const patch = (id: string, data: Partial<GamingOverlayItem>) => props.onChange(props.items.map((item) => item.id === id ? { ...item, ...data } : item));
  const add = (kind: GamingOverlayKind) => {
    const item = createGamingOverlay(kind, props.projectWidth, props.projectHeight);
    props.onChange([...props.items, item]);
    props.onSelect(item.id);
  };
  const duplicate = () => {
    if (!selected) return;
    const item = { ...selected, id: crypto.randomUUID(), name: selected.name + " Copy", x: selected.x + 30, y: selected.y + 30, zIndex: selected.zIndex + 1 };
    props.onChange([...props.items, item]);
    props.onSelect(item.id);
  };
  const remove = () => {
    if (!selected) return;
    props.onChange(props.items.filter((item) => item.id !== selected.id));
    props.onSelect(null);
  };
  const moveLayer = (dir: -1 | 1) => {
    if (!selected) return;
    patch(selected.id, { zIndex: Math.max(0, Math.min(200, selected.zIndex + dir)) });
  };

  return (
    <div className="pane gaming-overlay-designer">
      <h3>GAMING OVERLAY <span className="badge">FIRST STEP</span></h3>
      <p className="muted">Build stream/gaming overlays directly over the scene. Web cards can be angled to match signs, monitors, walls, desks, or other perspective in the background.</p>
      <div className="row">
        <button className="gold" onClick={() => add("web")}>+ Web / Song Card</button>
        <button onClick={() => add("panel")}>+ Frame / Panel</button>
        <button onClick={() => add("text")}>+ Text</button>
      </div>
      <p className="muted">Tip: paste a Loudman.live song-card or artist URL into a Web / Song Card item. Some websites may refuse iframe embedding through their own security headers.</p>

      <h3>OVERLAY ITEMS</h3>
      {props.items.length ? props.items.map((item) => (
        <div className={`overlay-list-item ${item.id === props.selectedId ? "on" : ""}`} key={item.id}>
          <button className="overlay-select" onClick={() => props.onSelect(item.id)}>{item.name}</button>
          <label className="mini"><input type="checkbox" checked={item.visible} onChange={(e) => patch(item.id, { visible: e.target.checked })} /> Show</label>
        </div>
      )) : <p className="muted">No overlay items yet.</p>}

      {selected && (
        <div className="acc on overlay-properties">
          <h3>SELECTED — {selected.name}</h3>
          <label>Name <input value={selected.name} onChange={(e) => patch(selected.id, { name: e.target.value.slice(0, 80) })} /></label>
          {selected.kind === "web" && <>
            <label>Embed URL <input value={selected.url || ""} placeholder="https://loudman.live/..." onChange={(e) => patch(selected.id, { url: e.target.value })} /></label>
            {(selected.url || "") && !safeOverlayUrl(selected.url) && <p className="warn">Use an HTTPS URL. HTTP is only allowed for localhost.</p>}
            <label className="chk"><input type="checkbox" checked={!!selected.interactive} onChange={(e) => patch(selected.id, { interactive: e.target.checked })} /> Allow interaction in Preview</label>
          </>}

          {selected.kind === "text" && <>
            <label>Text <textarea value={selected.text || ""} onChange={(e) => patch(selected.id, { text: e.target.value.slice(0, 300) })} /></label>
            <label>Text Color <input type="color" value={selected.textColor || "#ffffff"} onChange={(e) => patch(selected.id, { textColor: e.target.value })} /></label>
            <label>Font Size <input type="range" min={10} max={240} step={1} value={selected.fontSize || 48} onChange={(e) => patch(selected.id, { fontSize: number(e.target.value, 48) })} /></label>
            <label>Weight <select value={selected.fontWeight || 700} onChange={(e) => patch(selected.id, { fontWeight: number(e.target.value, 700) })}><option value={400}>Regular</option><option value={600}>Semi Bold</option><option value={700}>Bold</option><option value={800}>Extra Bold</option><option value={900}>Black</option></select></label>
            <label>Align <select value={selected.align || "center"} onChange={(e) => patch(selected.id, { align: e.target.value as GamingOverlayItem["align"] })}><option>left</option><option>center</option><option>right</option></select></label>
          </>}

          {(selected.kind === "panel" || selected.kind === "text") && <>
            <label>Fill <input type="color" value={selected.fillColor || "#000000"} onChange={(e) => patch(selected.id, { fillColor: e.target.value })} /></label>
            <label>Border <input type="color" value={selected.borderColor || "#d4af37"} onChange={(e) => patch(selected.id, { borderColor: e.target.value })} /></label>
            <label>Border Width <input type="range" min={0} max={40} step={1} value={selected.borderWidth || 0} onChange={(e) => patch(selected.id, { borderWidth: number(e.target.value, 0) })} /></label>
          </>}
          {selected.kind === "panel" && <label>Glow <input type="range" min={0} max={80} step={1} value={selected.glow || 0} onChange={(e) => patch(selected.id, { glow: number(e.target.value, 0) })} /></label>}

          <h4>POSITION & SIZE</h4>
          <label>X <input type="number" value={Math.round(selected.x)} onChange={(e) => patch(selected.id, { x: number(e.target.value, selected.x) })} /></label>
          <label>Y <input type="number" value={Math.round(selected.y)} onChange={(e) => patch(selected.id, { y: number(e.target.value, selected.y) })} /></label>
          <label>Width <input type="number" min={40} value={Math.round(selected.width)} onChange={(e) => patch(selected.id, { width: Math.max(40, number(e.target.value, selected.width)) })} /></label>
          <label>Height <input type="number" min={30} value={Math.round(selected.height)} onChange={(e) => patch(selected.id, { height: Math.max(30, number(e.target.value, selected.height)) })} /></label>
          <label>Opacity <input type="range" min={0} max={1} step={0.01} value={selected.opacity} onChange={(e) => patch(selected.id, { opacity: number(e.target.value, 1) })} /></label>
          <label>Corner Radius <input type="range" min={0} max={200} step={1} value={selected.borderRadius} onChange={(e) => patch(selected.id, { borderRadius: number(e.target.value, 0) })} /></label>

          <h4>ANGLE / PERSPECTIVE</h4>
          <label>Rotate Z {selected.rotation.toFixed(0)}° <input type="range" min={-180} max={180} step={1} value={selected.rotation} onChange={(e) => patch(selected.id, { rotation: number(e.target.value, 0) })} /></label>
          <label>Tilt X {selected.rotateX.toFixed(0)}° <input type="range" min={-75} max={75} step={1} value={selected.rotateX} onChange={(e) => patch(selected.id, { rotateX: number(e.target.value, 0) })} /></label>
          <label>Tilt Y {selected.rotateY.toFixed(0)}° <input type="range" min={-75} max={75} step={1} value={selected.rotateY} onChange={(e) => patch(selected.id, { rotateY: number(e.target.value, 0) })} /></label>
          <label>Skew X {selected.skewX.toFixed(0)}° <input type="range" min={-60} max={60} step={1} value={selected.skewX} onChange={(e) => patch(selected.id, { skewX: number(e.target.value, 0) })} /></label>
          <label>Skew Y {selected.skewY.toFixed(0)}° <input type="range" min={-60} max={60} step={1} value={selected.skewY} onChange={(e) => patch(selected.id, { skewY: number(e.target.value, 0) })} /></label>
          <label>Perspective <input type="range" min={120} max={4000} step={10} value={selected.perspective} onChange={(e) => patch(selected.id, { perspective: number(e.target.value, 900) })} /></label>

          {selected.kind === "web" && <>
            <h4>WEB COLOR MATCH</h4>
            <label>Hue {selected.hue || 0}° <input type="range" min={-180} max={180} step={1} value={selected.hue || 0} onChange={(e) => patch(selected.id, { hue: number(e.target.value, 0) })} /></label>
            <label>Saturation <input type="range" min={0} max={3} step={0.01} value={selected.saturation ?? 1} onChange={(e) => patch(selected.id, { saturation: number(e.target.value, 1) })} /></label>
            <label>Brightness <input type="range" min={0.2} max={3} step={0.01} value={selected.brightness ?? 1} onChange={(e) => patch(selected.id, { brightness: number(e.target.value, 1) })} /></label>
            <label>Contrast <input type="range" min={0.2} max={3} step={0.01} value={selected.contrast ?? 1} onChange={(e) => patch(selected.id, { contrast: number(e.target.value, 1) })} /></label>
          </>}

          <div className="row">
            <button onClick={() => moveLayer(1)}>Bring Forward</button>
            <button onClick={() => moveLayer(-1)}>Send Back</button>
            <button onClick={duplicate}>Duplicate</button>
            <button className="danger" onClick={remove}>Delete</button>
          </div>
        </div>
      )}

      <div className="hint">
        <b>Gaming Mode foundation</b><br/>
        This first overlay step is designed for stream frames, labels, HUD panels, sponsor/music cards and embedded web cards. Future gaming-mode work can build event/game reactions on top of the same overlay scene model.
      </div>
    </div>
  );
}
