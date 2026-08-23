import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesktopApp } from "./DesktopApp";
import "./auralith-styles.css";

async function boot() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const port = await invoke<number>("local_port");
    (window as Window & { __AURALITH_PORT__?: number }).__AURALITH_PORT__ = port;
  } catch {
    (window as Window & { __AURALITH_PORT__?: number }).__AURALITH_PORT__ = 4317;
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <DesktopApp />
    </StrictMode>,
  );
}

void boot();
