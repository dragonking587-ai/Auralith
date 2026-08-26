import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesktopApp } from "./DesktopApp";
import "./auralith-styles.css";

// Prevent white flash before React/CSS in Broadcast Output webview
try {
  document.documentElement.style.background = "#000";
  document.body.style.background = "#000";
  document.body.style.margin = "0";
} catch {
  /* ignore */
}

window.addEventListener("error", (ev) => {
  console.error("[BroadcastOutput JS ERROR]", ev.message, ev.filename, ev.lineno);
});
window.addEventListener("unhandledrejection", (ev) => {
  console.error("[BroadcastOutput PROMISE]", ev.reason);
});

async function boot() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const port = await invoke<number>("local_port");
    (window as Window & { __AURALITH_PORT__?: number }).__AURALITH_PORT__ = port;
  } catch {
    // External localhost webview: derive port from location when on the hub
    const m = location.port ? Number(location.port) : 4317;
    (window as Window & { __AURALITH_PORT__?: number }).__AURALITH_PORT__ =
      Number.isFinite(m) && m > 0 ? m : 4317;
  }
  console.info("[BroadcastOutput] boot", {
    href: location.href,
    port: (window as Window & { __AURALITH_PORT__?: number }).__AURALITH_PORT__,
  });
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <DesktopApp />
    </StrictMode>,
  );
}

void boot();
