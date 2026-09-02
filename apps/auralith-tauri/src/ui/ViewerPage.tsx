import { useEffect, useMemo, useState } from "react";

const KEY = "auralith.poll.bus";

export function ViewerPage() {
  const [q, setQ] = useState("Which color?");
  const [red, setRed] = useState("RED");
  const [green, setGreen] = useState("GREEN");
  const [done, setDone] = useState("");
  const [live, setLive] = useState({ red: 0, green: 0, running: false });
  const viewerId = useMemo(() => {
    const k = "auralith.poll.viewerId";
    let id = localStorage.getItem(k);
    if (!id) { id = "v-" + Math.random().toString(36).slice(2, 10); localStorage.setItem(k, id); }
    return id;
  }, []);
  useEffect(() => {
    const read = () => {
      try {
        const s = JSON.parse(localStorage.getItem(KEY) || "{}");
        if (s.question) setQ(s.question);
        if (s.redLabel) setRed(s.redLabel);
        if (s.greenLabel) setGreen(s.greenLabel);
        setLive({ red: s.red || 0, green: s.green || 0, running: !!s.running });
      } catch {}
    };
    read();
    window.addEventListener("storage", read);
    const t = setInterval(read, 400);
    return () => { window.removeEventListener("storage", read); clearInterval(t); };
  }, []);
  const vote = (option: "red" | "green") => {
    const payload = { type: "vote", viewerId, option, ts: Date.now() };
    localStorage.setItem(KEY + ".vote", JSON.stringify(payload));
    window.dispatchEvent(new StorageEvent("storage", { key: KEY + ".vote", newValue: JSON.stringify(payload) }));
    setDone("Vote received ✓");
  };
  return (
    <div style={{ minHeight: "100vh", background: "#120c08", color: "#f4e4b0", fontFamily: "Georgia, serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: 24 }}>
      <p style={{ letterSpacing: 3, fontSize: 12, opacity: 0.6 }}>AURALITH · TEST / LAN MODE</p>
      <h1 style={{ margin: 0, textAlign: "center" }}>{q}</h1>
      <p style={{ opacity: 0.7 }}>{live.running ? "Voting open" : "Waiting for host"}</p>
      <div style={{ display: "flex", gap: 16 }}>
        <button disabled={!live.running} onClick={() => vote("red")} style={{ minWidth: 140, padding: "18px 22px", background: "#e23a3a", color: "#fff", border: 0, borderRadius: 10, fontSize: 22 }}>{red}</button>
        <button disabled={!live.running} onClick={() => vote("green")} style={{ minWidth: 140, padding: "18px 22px", background: "#2fbf5a", color: "#fff", border: 0, borderRadius: 10, fontSize: 22 }}>{green}</button>
      </div>
      {done && <p>{done}</p>}
      <p style={{ opacity: 0.55 }}>{red} {live.red} · {green} {live.green}</p>
    </div>
  );
}
