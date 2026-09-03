import { useEffect, useState } from "react";
import { qrDataUrl } from "../scene/qr";

export function QrImage({ value, size = 220, alt = "QR" }: { value: string; size?: number; alt?: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    const payload = (value || "").trim();
    if (!payload) { setSrc(""); return; }
    let live = true;
    qrDataUrl(payload, size).then((u) => { if (live) setSrc(u); }).catch(() => { if (live) setSrc(""); });
    return () => { live = false; };
  }, [value, size]);
  if (!src) return <div style={{ width: size, height: size, background: "#FFFFFF" }} />;
  return (
    <img
      alt={alt}
      src={src}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        background: "#FFFFFF",
        imageRendering: "pixelated",
        display: "block"
      }}
    />
  );
}

export function QrModal(props: {
  title: string;
  value: string;
  room?: string;
  onCopy?: () => void;
  onOpen?: () => void;
  onClose: () => void;
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,.72)",
      display: "flex", alignItems: "center", justifyContent: "center"
    }} onClick={props.onClose}>
      <div className="card" style={{ width: 560, maxWidth: "92vw", padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <h3>{props.title}</h3>
        <div style={{ background: "#FFFFFF", padding: 16, display: "flex", justifyContent: "center" }}>
          <QrImage value={props.value} size={480} alt={props.title} />
        </div>
        {props.room ? <p>Room: {props.room}</p> : null}
        <p style={{ wordBreak: "break-all" }}>{props.value}</p>
        <div className="row">
          {props.onCopy ? <button onClick={props.onCopy}>Copy Link</button> : null}
          {props.onOpen ? <button onClick={props.onOpen}>Open Viewer</button> : null}
          <button onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
