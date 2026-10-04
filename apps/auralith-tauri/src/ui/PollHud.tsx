import type { PointerEventHandler } from "react";
import type { PollConfig, PollRuntime } from "../scene/poll";

export function PollDisplayToggle({ visible, onChange }: {
  visible: boolean;
  onChange: (visible: boolean) => void;
}) {
  return (
    <label className="chk" title="Show or hide the poll card. Votes and poll settings are preserved.">
      <input type="checkbox" checked={visible} onChange={(e) => onChange(e.target.checked)} /> Poll Display
    </label>
  );
}

export function PollHud({ config, runtime, left, top, width, clean, room, onPointerDown }: {
  config: PollConfig;
  runtime: PollRuntime;
  left: number;
  top: number;
  width: number;
  clean: boolean;
  room: string;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
}) {
  const d = config.display;
  if (!d.visible) return null;
  const total = runtime.red + runtime.green;
  const redPct = total ? Math.round(runtime.red / total * 100) : 0;
  const greenPct = total ? Math.round(runtime.green / total * 100) : 0;
  return (
    <div className="poll-hud" style={{
      position: "absolute", left, top, width, opacity: d.opacity,
      background: `rgba(18,12,8,${d.bgOpacity})`, color: d.textColor, padding: d.pad,
      borderRadius: d.radius, border: d.border ? `${d.borderW}px solid #d4af37` : "none",
      textAlign: d.align, fontSize: d.fontSize, pointerEvents: clean ? "none" : "auto",
      fontFamily: "Georgia, serif"
    }} onPointerDown={clean ? undefined : onPointerDown}>
      {d.showQuestion && <div style={{ letterSpacing: 1, marginBottom: 8 }}>{config.question}</div>}
      <div style={{ display: "flex", gap: 16, justifyContent: d.align === "center" ? "center" : d.align === "right" ? "flex-end" : "flex-start" }}>
        <div>
          <div style={{ color: d.redAccent, fontWeight: 700 }}>{config.redLabel}{d.showLeader && runtime.leader === "red" ? " ●" : ""}</div>
          {d.showCounts && <div>{runtime.red}</div>}
          {d.showPct && <div>{redPct}%</div>}
        </div>
        <div>
          <div style={{ color: d.greenAccent, fontWeight: 700 }}>{config.greenLabel}{d.showLeader && runtime.leader === "green" ? " ●" : ""}</div>
          {d.showCounts && <div>{runtime.green}</div>}
          {d.showPct && <div>{greenPct}%</div>}
        </div>
      </div>
      {d.showTotal && <div style={{ marginTop: 6, opacity: 0.75 }}>Total {total}</div>}
      <div style={{ marginTop: 8, fontSize: Math.max(12, d.fontSize * 0.7), opacity: 0.8 }}>
        Vote on your phone{room ? " · " + room : ""}
      </div>
    </div>
  );
}
