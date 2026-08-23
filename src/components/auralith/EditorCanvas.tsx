import { useEffect, useRef } from "react";
import { getAudioEngine } from "@/lib/auralith/audio-engine";
import { canvasToImageNorm, canvasToImageNormUnclamped, computeImageRect } from "@/lib/auralith/coords";
import { createRenderer, hitTest, stampHandleHit } from "@/lib/auralith/renderer";
import { useAuralith } from "@/lib/auralith/store";
import type { StampRegion } from "@/lib/auralith/types";

export function EditorCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ReturnType<typeof createRenderer> | null>(null);
  const dragRef = useRef<null | { mode: "move" | "resize" | "pan"; id?: string; lastX: number; lastY: number; snapped: boolean }>(
    null,
  );
  const loopRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const renderer = createRenderer(canvas);
    rendererRef.current = renderer;
    const engine = getAudioEngine();
    let lastFps = 0;
    let lastDraw = 0;

    const fit = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(2, Math.floor(r.width * dpr));
      const h = Math.max(2, Math.floor(r.height * dpr));
      renderer.resize(w, h);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);

    const tick = (now: number) => {
      loopRef.current = requestAnimationFrame(tick);
      const state = useAuralith.getState();
      const fps = state.scene.output.fps;
      const minDt = fps === 30 ? 32 : 15;
      if (now - lastDraw < minDt && lastFps === fps) return;
      lastFps = fps;
      lastDraw = now;
      engine.setSensitivity(state.scene.audio.sensitivity);
      const bands = engine.tick(now);
      state.getPublisher()?.publishBands(bands, state.scene.audio.masterIntensity);
      renderer.drawFrame({
        scene: state.scene,
        image: state.getImage(),
        bands,
        now,
        guides: {
          selectedId: state.selectedId,
          tool: state.tool,
          draftTrace: state.draftTrace,
          hoverId: state.hoverId,
        },
      });
    };
    loopRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(loopRef.current);
      ro.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  function localNorm(e: React.PointerEvent): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    const state = useAuralith.getState();
    const img = state.scene.image;
    if (!canvas || !img) return null;
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const cy = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const ir = computeImageRect(img.width, img.height, canvas.width, canvas.height, state.scene.framing.fit, state.scene.framing.panX, state.scene.framing.panY);
    return canvasToImageNorm(cx, cy, ir);
  }

  function localUnclamped(e: React.PointerEvent) {
    const canvas = canvasRef.current;
    const state = useAuralith.getState();
    const img = state.scene.image;
    if (!canvas || !img) return null;
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const cy = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const ir = computeImageRect(img.width, img.height, canvas.width, canvas.height, state.scene.framing.fit, state.scene.framing.panX, state.scene.framing.panY);
    return canvasToImageNormUnclamped(cx, cy, ir);
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const state = useAuralith.getState();
    const n = localNorm(e);
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    if (state.tool === "pan" || e.shiftKey) {
      const u = localUnclamped(e);
      if (!u) return;
      dragRef.current = { mode: "pan", lastX: u.x, lastY: u.y, snapped: false };
      return;
    }
    if (!n) return;
    if (state.tool === "stamp") {
      const selected = state.scene.regions.find((r) => r.id === state.selectedId);
      if (selected?.kind === "stamp" && stampHandleHit(selected, n.x, n.y)) {
        dragRef.current = { mode: "resize", id: selected.id, lastX: n.x, lastY: n.y, snapped: true };
        state.beginEdit();
        return;
      }
      state.addStamp(n.x, n.y);
      return;
    }
    if (state.tool === "trace") {
      canvasRef.current?.classList.add("tracing");
      state.startTrace(n.x, n.y);
      return;
    }
    if (state.tool === "erase") {
      state.eraseAt(n.x, n.y);
      return;
    }
    if (state.tool === "move") {
      const hit = hitTest(state.scene, n.x, n.y);
      if (hit) {
        if (hit.kind === "stamp" && stampHandleHit(hit as StampRegion, n.x, n.y)) {
          dragRef.current = { mode: "resize", id: hit.id, lastX: n.x, lastY: n.y, snapped: false };
          state.select(hit.id);
          return;
        }
        state.select(hit.id);
        state.beginEdit();
        dragRef.current = { mode: "move", id: hit.id, lastX: n.x, lastY: n.y, snapped: true };
      } else {
        state.select(null);
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const state = useAuralith.getState();
    if (state.tracing) {
      e.preventDefault();
      const n = localNorm(e) ?? localUnclamped(e);
      if (n) state.appendTrace(n.x, n.y);
      return;
    }
    const drag = dragRef.current;
    const n = localUnclamped(e);
    if (!n) return;
    if (!drag) {
      const hit = localNorm(e) ? hitTest(state.scene, localNorm(e)!.x, localNorm(e)!.y) : null;
      state.setHover(hit?.id ?? null);
      return;
    }
    if (drag.mode === "pan") {
      const dx = n.x - drag.lastX;
      const dy = n.y - drag.lastY;
      state.setPan(state.scene.framing.panX - dx, state.scene.framing.panY - dy);
      drag.lastX = n.x;
      drag.lastY = n.y;
      return;
    }
    if (drag.mode === "move" && drag.id) {
      state.moveRegion(drag.id, n.x - drag.lastX, n.y - drag.lastY);
      drag.lastX = n.x;
      drag.lastY = n.y;
    } else if (drag.mode === "resize" && drag.id) {
      const region = state.scene.regions.find((r) => r.id === drag.id);
      if (region?.kind === "stamp") {
        const r = Math.max(0.01, Math.min(0.35, Math.hypot(n.x - region.x, n.y - region.y)));
        state.resizeStamp(region.id, r);
      }
    }
  };

  const onPointerUp = () => {
    const state = useAuralith.getState();
    if (state.tracing) state.endTrace();
    canvasRef.current?.classList.remove("tracing");
    dragRef.current = null;
  };

  const tracing = useAuralith((s) => s.tracing);

  return (
    <div ref={wrapRef} className="relative h-full min-h-0 w-full overflow-hidden bg-bg">
      <canvas
        ref={canvasRef}
        className={`editor-canvas absolute inset-0 h-full w-full touch-none ${tracing ? "tracing" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
