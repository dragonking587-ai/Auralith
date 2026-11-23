import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ALL_EFFECTS, type Project, type Region } from "../scene/types";
import { validateVisionResult, visionRegions, type VisionResult } from "../scene/openaiVision";

type Props = {
  project: Project;
  getBackdrop: () => HTMLImageElement | null;
  onApply: (regions: Region[]) => void;
};

export function OpenAiVisionPanel({ project, getBackdrop, onApply }: Props) {
  const [key, setKey] = useState("");
  const [model, setModel] = useState("gpt-4.1");
  const [request, setRequest] = useState("Find the crystals and light-emitting objects and give them a blue GlowBloom that reacts to Bass.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<VisionResult | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [preview, setPreview] = useState("");
  const generation = useRef(0);
  const backdrop = project.backdropDataUrl;

  useEffect(() => {
    generation.current++;
    setResult(null);
    setPreview("");
    setSelected([]);
    setBusy(false);
    setError("");
    return () => { generation.current++; };
  }, [backdrop, project.width, project.height]);

  async function analyze() {
    const img = getBackdrop();
    if (!img) { setError("Import a backdrop first."); return; }
    if (!key.trim()) { setError("Enter your OpenAI API key."); return; }
    if (!request.trim() || !model.trim()) { setError("Enter a request and a vision model."); return; }
    const token = ++generation.current;
    setBusy(true); setError(""); setResult(null); setSelected([]);
    try {
      // Match the editor's backdrop mapping in project space. Only the source
      // image is sent, excluding live effects, selection handles and other UI.
      const scale = Math.min(1, 1600 / Math.max(project.width, project.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(project.width * scale));
      canvas.height = Math.max(1, Math.round(project.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not prepare the backdrop image.");
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL("image/jpeg", 0.88);
      setPreview(image);
      const raw = await invoke("analyze_backdrop", {
        apiKey: key.trim(), model: model.trim(), request: request.trim(),
        image, effects: ALL_EFFECTS,
      });
      if (generation.current !== token) return;
      const next = validateVisionResult(raw);
      setResult(next);
      setSelected(next.objects.map((_, i) => i));
    } catch (err) {
      if (generation.current === token) setError(String(err));
    } finally {
      if (generation.current === token) setBusy(false);
    }
  }

  return <details className="acc" style={{ marginBottom: 12 }}>
    <summary>OpenAI Vision · Find objects and apply effects</summary>
    <p className="muted">Analyze sends the loaded backdrop and your request to OpenAI. API usage is billed to your OpenAI account. Your key stays in memory for this session.</p>
    <label style={{ display: "block", marginBottom: 8 }}>OpenAI API Key <input style={{ width: "100%", boxSizing: "border-box" }} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} /></label>
    <button disabled={!key || busy} onClick={() => setKey("")}>Clear Key</button>
    <label style={{ display: "block", marginTop: 8 }}>Vision Model <input style={{ width: "100%", boxSizing: "border-box" }} value={model} maxLength={100} onChange={(e) => setModel(e.target.value)} /></label>
    <label style={{ display: "block", marginTop: 8 }}>What should Auralith find and do?
      <textarea style={{ width: "100%", boxSizing: "border-box", resize: "vertical" }} rows={4} maxLength={2000} value={request} onChange={(e) => setRequest(e.target.value)} />
    </label>
    {!isTauri() && <p>OpenAI analysis is available in the Reborn desktop app.</p>}
    <button disabled={busy || !isTauri() || !backdrop} onClick={() => { void analyze(); }}>{busy ? "Recognizing objects…" : "Analyze Backdrop with OpenAI"}</button>
    {error && <p role="alert">{error}</p>}
    {result && <>
      <p>{result.summary}</p>
      <p className="muted">Review the approximate outlines. After applying, use Edit to adjust the points. Undo removes the applied batch.</p>
      <svg viewBox="0 0 1000 1000" style={{ width: "100%", aspectRatio: String(project.width / project.height), display: "block" }} preserveAspectRatio="none" aria-label="Detected object outlines">
        <image href={preview} width="1000" height="1000" preserveAspectRatio="none" />
        {result.objects.map((obj, i) => selected.includes(i) && <g key={i}>
          <polygon points={obj.outline.map((p) => `${p.x},${p.y}`).join(" ")} fill={obj.color} fillOpacity={0.16} stroke={obj.color} strokeWidth={3} />
          <text x={obj.outline[0].x} y={obj.outline[0].y} fill="white" stroke="black" strokeWidth={0.5} fontSize={22}>{i + 1}</text>
        </g>)}
      </svg>
      {result.objects.map((obj, i) => <label key={i} style={{ display: "block", marginBlock: 8 }}>
        <input type="checkbox" checked={selected.includes(i)} onChange={(e) => setSelected((list) => e.target.checked ? [...list, i] : list.filter((n) => n !== i))} />
        {i + 1}. {obj.label} · {obj.effect} · {obj.audio}
      </label>)}
      <button disabled={selected.length === 0} onClick={() => {
        const regions = visionRegions(result.objects.filter((_, i) => selected.includes(i)), project.width, project.height);
        onApply(regions);
        setResult(null); setSelected([]); setPreview("");
      }}>Apply Selected Objects and Effects</button>
      <button onClick={() => { setResult(null); setSelected([]); setPreview(""); }}>Discard Suggestions</button>
    </>}
  </details>;
}
