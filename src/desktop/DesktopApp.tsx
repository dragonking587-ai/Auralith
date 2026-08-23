import { useEffect, useState } from "react";
import { EditorShell } from "@/components/auralith/EditorShell";
import { StreamView } from "@/components/auralith/StreamView";
import { checkDesktopUpdate, type DesktopUpdateInfo } from "@/lib/auralith/desktop-release";

function sessionFromLocation(): string {
  const params = new URLSearchParams(window.location.search);
  const q = params.get("session");
  if (q) return q;
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "source" && parts[1]) return parts[1];
  return "";
}

function UpdateNotice() {
  const [info, setInfo] = useState<DesktopUpdateInfo | null>(null);
  useEffect(() => {
    let live = true;
    void checkDesktopUpdate().then((next) => {
      if (live) setInfo(next);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!info) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-bg-subtle px-4 py-2 text-xs text-muted">
      <span>An Auralith update is available ({info.tag}).</span>
      <a href={info.url} target="_blank" rel="noreferrer" className="font-medium text-fg underline-offset-2 hover:underline">
        Update
      </a>
    </div>
  );
}

export function DesktopApp() {
  const path = window.location.pathname;
  if (path.startsWith("/output") || path.startsWith("/source")) {
    const sessionId = sessionFromLocation();
    if (!sessionId) {
      return (
        <div className="flex h-dvh items-center justify-center bg-black text-xs text-zinc-500">Waiting for active scene</div>
      );
    }
    return <StreamView sessionId={sessionId} />;
  }
  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <UpdateNotice />
      <div className="min-h-0 flex-1">
        <EditorShell />
      </div>
    </div>
  );
}
