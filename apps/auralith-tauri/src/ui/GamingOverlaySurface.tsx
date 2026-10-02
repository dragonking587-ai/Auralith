import { useRef } from "react";
import { safeOverlayUrl, type GamingOverlayItem } from "../scene/gamingOverlay";

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
};

type DragState = { id: string; startX: number; startY: number; originX: number; originY: number; pointerId: number };

export function GamingOverlaySurface(props: Props) {
  const drag = useRef<DragState | null>(null);
  const sx = props.viewport.w / Math.max(1, props.projectWidth);
  const sy = props.viewport.h / Math.max(1, props.projectHeight);

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
        const common: React.CSSProperties = {
          left, top, width, height, opacity: item.opacity, zIndex: 30 + item.zIndex,
          transform, transformOrigin: "50% 50%", borderRadius: item.borderRadius,
        };
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
                borderRadius: item.borderRadius,
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
                background: item.fillColor,
                border: `${item.borderWidth || 0}px solid ${item.borderColor || "transparent"}`,
                borderRadius: item.borderRadius,
                boxShadow: (item.glow || 0) > 0 ? `0 0 ${item.glow}px ${item.borderColor || "#d4af37"}` : "none",
              }} />
            )}
            {item.kind === "text" && (
              <div className="gaming-overlay-text" style={{
                color: item.textColor,
                background: item.fillColor,
                border: `${item.borderWidth || 0}px solid ${item.borderColor || "transparent"}`,
                borderRadius: item.borderRadius,
                fontSize: `${Math.max(8, (item.fontSize || 48) * Math.min(sx, sy))}px`,
                fontWeight: item.fontWeight || 700,
                textAlign: item.align || "center",
              }}>{item.text}</div>
            )}
            {props.edit && <div className="gaming-overlay-edit-hit"><span>{item.name}</span></div>}
          </div>
        );
      })}
    </div>
  );
}
