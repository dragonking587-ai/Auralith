import { useEffect, useRef, useState } from "react";
import { ZERO_BANDS } from "@/lib/auralith/bands";
import { LiveViewer } from "@/lib/auralith/live-client";
import { createRenderer } from "@/lib/auralith/renderer";
import type { LiveBands, Scene } from "@/lib/auralith/types";

export function StreamView({ sessionId }: { sessionId: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [waiting, setWaiting] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const renderer = createRenderer(canvas, { stream: true });
    const viewer = new LiveViewer(sessionId);
    let image: HTMLImageElement | null = null;
    let imageUrl = "";
    let imageRev = -1;
    let loadGen = 0;
    let scene: Scene | null = null;
    let bands: LiveBands | null = null;
    let loop = 0;
    let lastDraw = 0;
    let hasLiveImage = false;

    const unsub = viewer.subscribe((st) => {
      scene = st.scene;
      bands = st.bands;
      const nextUrl = st.imageUrl;
      if (nextUrl && (nextUrl !== imageUrl || st.imageRev !== imageRev)) {
        imageUrl = nextUrl;
        imageRev = st.imageRev;
        const gen = ++loadGen;
        const img = new Image();
        if (!nextUrl.startsWith("data:") && !nextUrl.startsWith("blob:")) {
          img.crossOrigin = "anonymous";
        }
        img.onload = () => {
          if (gen !== loadGen) return;
          image = img;
          hasLiveImage = true;
          setWaiting(false);
        };
        img.onerror = () => {
          if (gen !== loadGen) return;
        };
        img.src = nextUrl;
      }
    });

    const fit = () => {
      const s = scene;
      const targetW = s?.output.width ?? 1920;
      const targetH = s?.output.height ?? 1080;
      if (canvas.width !== targetW) canvas.width = targetW;
      if (canvas.height !== targetH) canvas.height = targetH;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);

    const tick = (now: number) => {
      loop = requestAnimationFrame(tick);
      const fps = scene?.output.fps ?? 60;
      const minDt = fps === 30 ? 32 : 15;
      if (now - lastDraw < minDt) return;
      lastDraw = now;
      if (!hasLiveImage || !scene || !image) return;
      const tw = scene.output.width;
      const th = scene.output.height;
      if (canvas.width !== tw || canvas.height !== th) {
        canvas.width = tw;
        canvas.height = th;
      }
      renderer.drawFrame({
        scene,
        image,
        bands: bands ?? ZERO_BANDS,
        now,
        guides: null,
      });
    };
    loop = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(loop);
      unsub();
      viewer.close();
      renderer.dispose();
      ro.disconnect();
    };
  }, [sessionId]);

  return (
    <div ref={wrapRef} className="relative h-dvh w-full overflow-hidden bg-black">
      <canvas ref={canvasRef} className="h-full w-full" />
      {waiting ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs tracking-wide text-zinc-500">
          Waiting for active scene
        </div>
      ) : null}
    </div>
  );
}