import { useEffect, useRef, useState } from "react";
import { ZERO_BANDS } from "@/lib/auralith/bands";
import { LiveViewer } from "@/lib/auralith/live-client";
import { createRenderer } from "@/lib/auralith/renderer";
import type { LiveBands, Scene } from "@/lib/auralith/types";
import { enableStreamOutputCapture, maybePushCanvas } from "@/lib/auralith/vcam-bridge";
import { isDesktopApp } from "@/lib/auralith/platform";

type InitStage =
  | "mounting"
  | "viewer"
  | "waiting_scene"
  | "waiting_image"
  | "rendering"
  | "error";

export function StreamView({ sessionId }: { sessionId: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<InitStage>("mounting");
  const [diag, setDiag] = useState<string>("");

  useEffect(() => {
    document.title = "Auralith — Broadcast Output";
    document.documentElement.style.background = "#000";
    document.body.style.background = "#000";
    document.body.style.margin = "0";
    console.info("[BroadcastOutput] StreamView module loaded");
    console.info("[BroadcastOutput] StreamView mounting", { sessionId, href: location.href });
  }, [sessionId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) {
      setStage("error");
      setDiag("Canvas or wrapper missing from DOM");
      return;
    }
    console.info("[BroadcastOutput] StreamView mounted");
    console.info("[BroadcastOutput] Canvas created");

    // Inline diagnostic paint so a pure white page is never silent failure
    const ctx0 = canvas.getContext("2d");
    canvas.width = 1920;
    canvas.height = 1080;
    if (ctx0) {
      ctx0.fillStyle = "#000";
      ctx0.fillRect(0, 0, canvas.width, canvas.height);
      ctx0.fillStyle = "#52525b";
      ctx0.font = "28px system-ui,sans-serif";
      ctx0.fillText("AURALITH BROADCAST OUTPUT", 64, 96);
      ctx0.font = "18px system-ui,sans-serif";
      ctx0.fillText("Connecting to live scene…", 64, 140);
      console.info("[BroadcastOutput] Diagnostic frame painted");
    }

    console.info("[BroadcastOutput] createRenderer starting");
    const renderer = createRenderer(canvas, { stream: true });
    console.info("[BroadcastOutput] createRenderer complete");

    const viewer = new LiveViewer(sessionId);
    console.info("[BroadcastOutput] LiveViewer started", { sessionId });
    setStage("viewer");

    let image: HTMLImageElement | null = null;
    let imageUrl = "";
    let imageRev = -1;
    let loadGen = 0;
    let scene: Scene | null = null;
    let bands: LiveBands | null = null;
    let loop = 0;
    let lastDraw = 0;
    let hasLiveImage = false;
    let firstFrameLogged = false;

    const unsub = viewer.subscribe((st) => {
      if (st.scene) {
        scene = st.scene;
        if (!hasLiveImage) setStage("waiting_image");
        console.info("[BroadcastOutput] Scene snapshot received", {
          sceneRev: st.sceneRev,
          w: st.scene.output?.width,
          h: st.scene.output?.height,
        });
      }
      if (st.bands) bands = st.bands;
      const nextUrl = st.imageUrl;
      if (nextUrl && (nextUrl !== imageUrl || st.imageRev !== imageRev)) {
        console.info("[BroadcastOutput] Backdrop reference received", {
          imageRev: st.imageRev,
          prefix: nextUrl.slice(0, 48),
        });
        imageUrl = nextUrl;
        imageRev = st.imageRev;
        const gen = ++loadGen;
        const img = new Image();
        if (!nextUrl.startsWith("data:") && !nextUrl.startsWith("blob:")) {
          img.crossOrigin = "anonymous";
        }
        console.info("[BroadcastOutput] Loading backdrop");
        img.onload = () => {
          if (gen !== loadGen) return;
          image = img;
          hasLiveImage = true;
          setStage("rendering");
          setDiag("");
          console.info("[BroadcastOutput] Backdrop loaded", {
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
          });
        };
        img.onerror = () => {
          if (gen !== loadGen) return;
          console.error("[BroadcastOutput] Backdrop load failed", nextUrl.slice(0, 80));
          setStage("error");
          setDiag("Backdrop image failed to load in Broadcast Output webview");
        };
        img.src = nextUrl;
      }
    });

    if (isDesktopApp()) {
      enableStreamOutputCapture(1920, 1080);
    }

    const fit = () => {
      const s = scene;
      const targetW = s?.output.width ?? 1920;
      const targetH = s?.output.height ?? 1080;
      if (canvas.width !== targetW) canvas.width = targetW;
      if (canvas.height !== targetH) canvas.height = targetH;
      if (isDesktopApp() && targetW > 0 && targetH > 0) {
        enableStreamOutputCapture(targetW, targetH);
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);

    // Timeout diagnostic if scene never arrives
    const watchdog = window.setTimeout(() => {
      if (!scene || !hasLiveImage) {
        setStage("error");
        setDiag(
          !scene
            ? "No scene state received from local hub (session sync). Re-open Broadcast Output after the editor has a backdrop."
            : "Scene received but backdrop never loaded (image URL may be invalid in this webview).",
        );
        console.error("[BroadcastOutput] Watchdog: live renderer produced no frames", {
          hasScene: !!scene,
          hasLiveImage,
        });
      }
    }, 8000);

    const tick = (now: number) => {
      loop = requestAnimationFrame(tick);
      const fps = scene?.output.fps ?? 60;
      const minDt = fps === 30 ? 32 : 15;
      if (now - lastDraw < minDt) return;
      lastDraw = now;
      if (!hasLiveImage || !scene || !image) {
        // Keep diagnostic visible
        const ctx = canvas.getContext("2d");
        if (ctx && canvas.width > 0) {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#71717a";
          ctx.font = "22px system-ui,sans-serif";
          ctx.fillText("AURALITH BROADCAST OUTPUT", 48, 72);
          ctx.font = "16px system-ui,sans-serif";
          ctx.fillText(scene ? "Loading backdrop…" : "Waiting for scene snapshot…", 48, 110);
        }
        return;
      }
      const tw = scene.output.width;
      const th = scene.output.height;
      if (canvas.width !== tw || canvas.height !== th) {
        canvas.width = tw;
        canvas.height = th;
      }
      if (!firstFrameLogged) {
        console.info("[BroadcastOutput] First render requested", { tw, th, canvas: `${canvas.width}x${canvas.height}` });
      }
      renderer.drawFrame({
        scene,
        image,
        bands: bands ?? ZERO_BANDS,
        now,
        guides: null,
      });
      if (!firstFrameLogged) {
        firstFrameLogged = true;
        console.info("[BroadcastOutput] First frame rendered");
      }
      void maybePushCanvas(canvas, now);
    };
    loop = requestAnimationFrame(tick);
    console.info("[BroadcastOutput] First render loop started");

    return () => {
      window.clearTimeout(watchdog);
      cancelAnimationFrame(loop);
      unsub();
      viewer.close();
      renderer.dispose();
      ro.disconnect();
    };
  }, [sessionId]);

  return (
    <div
      ref={wrapRef}
      style={{
        position: "relative",
        height: "100vh",
        width: "100%",
        overflow: "hidden",
        background: "#000",
        margin: 0,
      }}
    >
      <canvas ref={canvasRef} style={{ height: "100%", width: "100%", display: "block", background: "#000" }} />
      {stage === "error" ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            color: "#fafafa",
            background: "rgba(0,0,0,0.85)",
            fontFamily: "system-ui,sans-serif",
            fontSize: 13,
            textAlign: "center",
            whiteSpace: "pre-wrap",
          }}
        >
          {`Broadcast Output failed to initialize\n\nStage: ${stage}\n\n${diag}`}
        </div>
      ) : null}
    </div>
  );
}
