import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { qrDataUrl } from "../scene/qr";

type Snap = {
  running: boolean; question: string; redLabel: string; greenLabel: string;
  red: number; green: number; leader: string; redMap: string; greenMap: string;
  viewer: { state: string; local_url: string; lan_url: string; port: number; health: string };
  relay?: { status: string; error: string; room: string; url: string; mode: string };
};

export function HostPage() {
  const [s, setS] = useState<Snap>({
    running: false, question: "Which color?", redLabel: "RED", greenLabel: "GREEN",
    red: 0, green: 0, leader: "", redMap: "", greenMap: "",
    viewer: { state: "STOPPED", local_url: "", lan_url: "", port: 0, health: "STOPPED" }
  });
  const [top, setTop] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const un = listen<Snap>("poll-sync", (e) => { if (e.payload) setS(e.payload); });
    emit("poll-cmd", { action: "sync" }).catch(() => {});
    return () => { un.then((f) => f()).catch(() => {}); };
  }, []);
  const cmd = (action: string) => emit("poll-cmd", { action }).catch((e) => setMsg(String(e)));
  const tot = s.red + s.green;
  const rp = tot ? Math.round(s.red / tot * 100) : 0;
  const gp = tot ? Math.round(s.green / tot * 100) : 0;
  return (
    <div style={{ minHeight: "100vh", background: "#120c08", color: "#f4e4b0", fontFamily: "Georgia,serif", padding: 18 }}>
      <p style={{ letterSpacing: 2, fontSize: 12, opacity: 0.65 }}>AUDIENCE POLL — HOST</p>
      <h2>{s.question}</h2>
      <p>Status: {s.running ? "LIVE" : "STOPPED"} · Leader {s.leader || "none"} · Total {tot}</p>
      <p style={{ color: "#e23a3a" }}>{s.redLabel}: {s.red} ({rp}%) · {s.redMap || "unmapped"}</p>
      <p style={{ color: "#2fbf5a" }}>{s.greenLabel}: {s.green} ({gp}%) · {s.greenMap || "unmapped"}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0" }}>
        <button onClick={() => cmd("start")}>Start Poll</button>
        <button onClick={() => cmd("end")}>End Poll</button>
        <button onClick={() => cmd("clear")}>Clear Votes</button>
        <button onClick={() => cmd("restore")}>Clear Votes + Restore Effects</button>
        <button onClick={() => cmd("reset")}>Reset Poll</button>
      </div>
      <h3>VIEWER CONNECTION</h3>
      <p>Mode: {s.relay?.mode || "lan"}</p>
      {s.relay?.mode === "public" && (
        <>
          <p>Relay: {s.relay.status}{s.relay.error ? " · " + s.relay.error : ""}</p>
          <p>Room: {s.relay.room || "—"}</p>
          {s.relay.url ? (
            <img alt="Public viewer QR" style={{ width: 200, height: 200, background: "#fff4d6" }} src={qrDataUrl(s.relay.url)} />
          ) : null}
        </>
      )}
      <p>Local server: {s.viewer.state} · Health: {s.viewer.health} · Port: {s.viewer.port || "—"}</p>
      <p>Local: {s.viewer.local_url || "—"}</p>
      <p>LAN: {s.viewer.lan_url || "—"}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button onClick={() => cmd("open-viewer")}>Open Viewer Page</button>
        <button onClick={() => navigator.clipboard.writeText(s.viewer.lan_url || s.viewer.local_url || "").catch(() => {})}>Copy Viewer Link</button>
        <button onClick={async () => {
          const next = !top; setTop(next);
          try { await getCurrentWindow().setAlwaysOnTop(next); } catch { setMsg("Always on top not available"); }
        }}>{top ? "Always On Top: ON" : "Always On Top"}</button>
      </div>
      <p style={{ opacity: 0.6, marginTop: 16 }}>Closing this window does not stop the poll or Clean Capture.</p>
      {msg && <p>{msg}</p>}
    </div>
  );
}
