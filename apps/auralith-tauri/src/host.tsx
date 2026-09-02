import React from "react";
import { createRoot } from "react-dom/client";
import { HostPage } from "./ui/HostPage";
import "./ui/styles.css";

const rootEl = document.getElementById("root");
const boot = document.getElementById("boot");
try {
  if (!rootEl) throw new Error("host root missing");
  createRoot(rootEl).render(<HostPage />);
  if (boot) boot.classList.add("ok");
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  const bootMsg = document.getElementById("boot-msg");
  if (bootMsg) bootMsg.textContent = "Host window failed: " + msg;
  if (boot) boot.classList.remove("ok");
}
