import { useEffect, useRef } from "react";
import type { AudioSnapshot } from "../audio/engine";
import { safeOverlayUrl, type GamingOverlayItem } from "../scene/gamingOverlay";
import { overlayAudioLevel, overlayEffectState, overlayRgba, smoothOverlayAudio } from "../scene/overlayEffects";

export type OverlayViewport = { x: number; y: number; w: number; h: number };

type Props = {
  items: GamingOverlayItem[];
  viewport: OverlayViewport;
  projectWidth: number;
  projectHeight: number;
  edit: boolean;
  previewInteractive: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPatch: (id: string, patch: Partial<GamingOverlayItem>) => void;
  getAudioSnapshot?: () => AudioSnapshot;
};

type DragState = { id: string; startX: number; startY: number; originX: number; originY: number; pointerId: number };

export function GamingOverlaySurface(props: Props) {
  const drag = useRef<DragState | null>(null);
  const sx = props.viewport.w / Math.max(1, props.projectWidth);
  const sy = props.viewport.h / Math.max(1, props.projectHeight);
  const scale = Math.min(sx, sy);
  const elements = useRef(new Map<string, HTMLDivElement>());
  const live = useRef(props);
  live.current = props;
  const animated = props.items.some((item) => item.visible && (item.effect === "pulse" || item.effect === "chase" || item.audioReactive));

  useEffect(() => {
    if (!animated) {
      const current = live.current;
      const viewportScale = Math.min(current.viewport.w / Math.max(1, current.projectWidth), current.viewport.h / Math.max(1, current.projectHeight));
      for (const item of current.items) {
        const element = elements.current.get(item.id);
        if (!element) continue;
        const effect = overlayEffectState(item, 0);
        element.style.setProperty("--overlay-border-color", effect.borderColor);
        element.style.setProperty("--overlay-glow-color", effect.glowColor);
        element.style.setProperty("--overlay-glow", effect.glow * viewportScale + "px");
        element.style.setProperty("--overlay-chase-opacity", String(effect.chaseOpacity));
        element.style.setProperty("--overlay-angle", "0deg");
      }
      return;
    }
    let frame = 0;
    let previousTime = performance.now();
    const envelopes = new Map<string, number>();
    const tick = (now: number) => {
      const current = live.current;
      const dt = (now - previousTime) / 1000;
      previousTime = now;
      const audio = current.getAudioSnapshot?.();
      const viewportScale = Math.min(current.viewport.w / Math.max(1, current.projectWidth), current.viewport.h / Math.max(1, current.projectHeight));
      for (const item of current.items) {
        const element = elements.current.get(item.id);
        if (!item.visible || !element) continue;
        const level = smoothOverlayAudio(envelopes.get(item.id) || 0, overlayAudioLevel(item, audio), dt);
        envelopes.set(item.id, level);
        const effect = overlayEffectState(item, now / 1000, level);
        element.style.setProperty("--overlay-border-color", effect.borderColor);
        element.style.setProperty("--overlay-glow-color", effect.glowColor);
        element.style.setProperty("--overlay-glow", effect.glow * viewportScale + "px");
        element.style.setProperty("--overlay-chase-opacity", String(effect.chaseOpacity));
        element.style.setProperty("--overlay-angle", effect.angle + "deg");
      }
      for (const id of envelopes.keys()) if (!elements.current.has(id)) envelopes.delete(id);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animated]);

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = (e.clientX - d.startX) / Math.max(0.0001, sx);
    const dy = (e.clientY - d.startY) / Math.max(0.0001, sy);
    props.onPatch(d.id, { x: d.originX + dx, y: d.originY + dy });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  return (
    <div className={`gaming-overlay-surface ${props.edit ? "editing" : ""}`} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      {props.items.filter((item) => item.visible).map((item) => {
        const selected = props.selectedId === item.id;
        const left = props.viewport.x + item.x * sx;
        const top = props.viewport.y + item.y * sy;
        const width = item.width * sx;
        const height = item.height * sy;
        const transform = `translate(-50%, -50%) perspective(${item.perspective}px) rotateX(${item.rotateX}deg) rotateY(${item.rotateY}deg) rotateZ(${item.rotation}deg) skewX(${item.skewX}deg) skewY(${item.skewY}deg)`;
        const effect = overlayEffectState(item, 0);
        const common = {
          left, top, width, height, opacity: item.opacity, zIndex: 30 + item.zIndex,
          transform, transformOrigin: "50% 50%", borderRadius: item.borderRadius * scale,
          "--overlay-border-color": effect.borderColor,
          "--overlay-glow-color": effect.glowColor,
          "--overlay-accent-color": item.effectColor || "#31d8ef",
          "--overlay-border-width": (item.borderWidth || 0) * scale + "px",
          "--overlay-glow": effect.glow * scale + "px",
          "--overlay-chase-opacity": effect.chaseOpacity,
          "--overlay-angle": effect.angle + "deg",
        } as React.CSSProperties;
        const webFilter = `hue-rotate(${item.hue || 0}deg) saturate(${item.saturation ?? 1}) brightness(${item.brightness ?? 1}) contrast(${item.contrast ?? 1})`;
        const sourceWidth = Math.max(160, item.sourceWidth || 640);
        const sourceHeight = Math.max(120, item.sourceHeight || 360);
        const webFit = item.webFit || "fit";
        let webScaleX = 1;
        let webScaleY = 1;
        if (webFit === "fit") {
          const scale = Math.min(width / sourceWidth, height / sourceHeight);
          webScaleX = scale;
          webScaleY = scale;
        } else if (webFit === "fill") {
          const scale = Math.max(width / sourceWidth, height / sourceHeight);
          webScaleX = scale;
          webScaleY = scale;
        } else if (webFit === "stretch") {
          webScaleX = width / sourceWidth;
          webScaleY = height / sourceHeight;
        }
        const webStyle: React.CSSProperties = webFit === "native"
          ? {
              position: "absolute",
              left: 0,
              top: 0,
              width: "100%",
              height: "100%",
              transform: "none",
              filter: webFilter,
              pointerEvents: props.edit ? "none" : (item.interactive && props.previewInteractive ? "auto" : "none"),
            }
          : {
              position: "absolute",
              left: "50%",
              top: "50%",
              width: `${sourceWidth}px`,
              height: `${sourceHeight}px`,
              transform: `translate(-50%, -50%) scale(${webScaleX}, ${webScaleY})`,
              transformOrigin: "50% 50%",
              filter: webFilter,
              pointerEvents: props.edit ? "none" : (item.interactive && props.previewInteractive ? "auto" : "none"),
            };
        return (
          <div
            key={item.id}
            ref={(element) => { if (element) elements.current.set(item.id, element); else elements.current.delete(item.id); }}
            className={`gaming-overlay-item ${selected ? "selected" : ""} kind-${item.kind}`}
            style={common}
            onPointerDown={(e) => {
              if (!props.edit) return;
              e.stopPropagation();
              props.onSelect(item.id);
              drag.current = { id: item.id, startX: e.clientX, startY: e.clientY, originX: item.x, originY: item.y, pointerId: e.pointerId };
              try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
            }}
          >
            {item.kind === "web" && (
              <div className="gaming-overlay-web-frame" style={{
                position: "relative",
                display: "block",
                width: "100%",
                height: "100%",
                overflow: "hidden",
                borderRadius: "inherit",
                background: "transparent",
              }}>
                <iframe
                  title={item.name}
                  src={safeOverlayUrl(item.url) || "about:blank"}
                  className="gaming-overlay-web"
                  sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-presentation"
                  referrerPolicy="strict-origin-when-cross-origin"
                  style={webStyle}
                />
              </div>
            )}
            {item.kind === "panel" && (
              <div className="gaming-overlay-panel" style={{
                background: overlayRgba(item.fillColor || "#000000", item.fillOpacity ?? 1),
                borderRadius: "inherit",
              }} />
            )}
            {item.kind === "text" && (
              <div className="gaming-overlay-text" style={{
                color: item.textColor,
                background: overlayRgba(item.fillColor || "#000000", item.fillOpacity ?? 1),
                borderRadius: "inherit",
                fontSize: `${Math.max(8, (item.fontSize || 48) * Math.min(sx, sy))}px`,
                fontWeight: item.fontWeight || 700,
                textAlign: item.align || "center",
              }}>{item.text}</div>
            )}
            <div className="gaming-overlay-decoration" aria-hidden="true">
              {item.effect === "chase" && <div className="gaming-overlay-chase" />}
            </div>
            {props.edit && <div className="gaming-overlay-edit-hit"><span>{item.name}</span></div>}
          </div>
        );
      })}
    </div>
  );
}
