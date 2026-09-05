import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { ViewerPage } from "./ui/ViewerPage";
import { HostPage } from "./ui/HostPage";
import "./ui/styles.css";
import "./ui/wolf-art.css";

console.log("REACT_ROOT_FOUND");
const rootEl = document.getElementById("root");
const boot = document.getElementById("boot");
const bootMsg = document.getElementById("boot-msg");
try {
  if (!rootEl) throw new Error("root element missing");
  console.log("REACT_MOUNT_BEGIN");
  const hash = location.hash || "";
  const hostFlag = Boolean((window as any).__AURALITH_HOST__)
    || /#host/i.test(hash)
    || /(?:\?|&)page=host\b/i.test(location.search)
    || /host\.html$/i.test(location.pathname);
  const page = /(#vote|#viewer)/i.test(hash) ? <ViewerPage /> : hostFlag ? <HostPage /> : <App />;
  createRoot(rootEl).render(page);
  console.log("REACT_MOUNT_OK");
  if (boot) boot.classList.add("ok");
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("APP_BOOT_FAILED stage=REACT_MOUNT error=" + msg);
  if (bootMsg) bootMsg.textContent = "Startup Error: " + msg;
  if (boot) boot.classList.remove("ok");
}
