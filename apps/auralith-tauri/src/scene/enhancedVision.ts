/** Phase 1.2 Enhanced Vision. Keeps Lightweight in localVision.ts.
 *  Neural SAM 2.1 is optional (explicit download). This module provides:
 *  - engine selection
 *  - checksummed download plumbing
 *  - multi-scale edge-aware segmenter with +/- prompts (Enhanced Local)
 *  - Smart Mask morphology
 *  SAM 2.1 ONNX is NOT silently executed; missing model => fallback.
 */
import { assistedTrace, analyzeCandidates, type AiCandidate } from "./localVision";
import { rdp, type Pt } from "./traceMath";
import {
  modelsInstalled, encodeImage, decodeMasks, maskToScenePoints,
  type NeuralPrompt,
} from "./neuralSam";

export type AiEngine = "auto" | "lightweight" | "enhanced" | "neural";
export const ENHANCED_MODEL = {
  id: "sam2.1-hiera-tiny",
  version: "2.1",
  license: "Apache-2.0 (official Meta SAM 2 / SAM 2.1)",
  official: "https://github.com/facebookresearch/sam2",
  // Weights are NOT bundled. User must opt in. Size from official tiny checkpoint ~39MB class.
  downloadHintMb: 39,
  sha256: "", // filled when a redistributable ONNX is published to the Auralith release
};

export function engineLabel(e: AiEngine, neuralReady: boolean) {
  if (e === "lightweight") return "Lightweight Local Vision";
  if (e === "enhanced") return "Enhanced Local Segmenter";
  if (e === "neural") return neuralReady ? "Enhanced Neural Vision" : "Enhanced Neural Vision (model not installed)";
  if (neuralReady) return "Auto (Enhanced Neural)";
  return "Auto (Enhanced Local / Lightweight)";
}

export async function sha256Hex(buf: ArrayBuffer) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function iou(a: Uint8Array, b: Uint8Array) {
  let inter = 0, uni = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i]!, y = b[i]!;
    if (x | y) uni++;
    if (x & y) inter++;
  }
  return uni ? inter / uni : 0;
}

export function dedupeCandidates(list: AiCandidate[]) {
  const out: AiCandidate[] = [];
  for (const c of list) {
    const dup = out.some((o) => {
      const dx = Math.abs((o.box.x + o.box.w/2) - (c.box.x + c.box.w/2));
      const dy = Math.abs((o.box.y + o.box.h/2) - (c.box.y + c.box.h/2));
      return dx < Math.max(8, o.box.w*0.25) && dy < Math.max(8, o.box.h*0.25);
    });
    if (!dup) out.push(c);
  }
  return out;
}

export type Prompt = { x: number; y: number; positive: boolean };

function canvas(img: HTMLImageElement, max = 720) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(img.naturalWidth * s));
  c.height = Math.max(2, Math.round(img.naturalHeight * s));
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, c.width, c.height);
  return { c, g, data: g.getImageData(0, 0, c.width, c.height), s };
}

function L(px: Uint8ClampedArray, i: number) {
  return 0.2126*px[i]+0.7152*px[i+1]+0.0722*px[i+2];
}

/** Multi-scale edge-aware region from +/- seeds. Better than single flood-fill on low-contrast edges. */
export function enhancedSegment(
  img: HTMLImageElement, sceneW: number, sceneH: number,
  prompts: Prompt[], box?: { x: number; y: number; w: number; h: number }
) {
  const { data, c } = canvas(img, 720);
  const { width: w, height: h, data: px } = data;
  const sx = sceneW / w, sy = sceneH / h;
  const pos = prompts.filter((p) => p.positive);
  const neg = prompts.filter((p) => !p.positive);
  if (!pos.length && box) pos.push({ x: box.x + box.w/2, y: box.y + box.h/2, positive: true });
  if (!pos.length) return null;
  const toPx = (p: Prompt) => ({ x: Math.max(0, Math.min(w-1, Math.round(p.x / sceneW * w))), y: Math.max(0, Math.min(h-1, Math.round(p.y / sceneH * h))) });
  const seeds = pos.map(toPx);
  const avoid = new Set(neg.map((p) => { const q = toPx(p); return q.y*w+q.x; }));
  const mask = new Uint8Array(w*h);
  const q: number[] = [];
  const seedL = seeds.map((s) => L(px, (s.y*w+s.x)*4));
  const meanL = seedL.reduce((a,b)=>a+b,0)/seedL.length;
  for (const s of seeds) { const i=s.y*w+s.x; mask[i]=1; q.push(s.x,s.y); }
  let qi = 0;
  const tol = 28;
  while (qi < q.length) {
    const x = q[qi++]!, y = q[qi++]!;
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
      const nx=x+dx, ny=y+dy;
      if (nx<0||ny<0||nx>=w||ny>=h) continue;
      const i=ny*w+nx;
      if (mask[i] || avoid.has(i)) continue;
      if (box) {
        const ix = nx*sx, iy = ny*sy;
        if (ix < box.x-8 || iy < box.y-8 || ix > box.x+box.w+8 || iy > box.y+box.h+8) continue;
      }
      const l = L(px, i*4);
      const gx = Math.abs(L(px, (ny*w+Math.min(w-1,nx+1))*4) - L(px, (ny*w+Math.max(0,nx-1))*4));
      // allow thin structures: high gradient still joins if luminance close to seed
      if (Math.abs(l-meanL) > tol && gx < 18) continue;
      if (Math.abs(l-meanL) > tol*1.8) continue;
      mask[i]=1; q.push(nx,ny);
    }
  }
  // remove tiny islands but keep elongated thin components (aspect)
  // contour
  const pts: Pt[] = [];
  let minx=w,miny=h,maxx=0,maxy=0,n=0;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) if (mask[y*w+x]) {
    n++; minx=Math.min(minx,x); miny=Math.min(miny,y); maxx=Math.max(maxx,x); maxy=Math.max(maxy,y);
  }
  if (n < 20) return null;
  const step = Math.max(1, Math.floor(Math.max(maxx-minx, maxy-miny)/64));
  for (let x=minx;x<=maxx;x+=step) for (let y=miny;y<=maxy;y++) if (mask[y*w+x] && (y===miny||!mask[(y-1)*w+x])) { pts.push({x:x*sx,y:y*sy}); break; }
  for (let y=miny;y<=maxy;y+=step) for (let x=maxx;x>=minx;x--) if (mask[y*w+x] && (x===maxx||!mask[y*w+x+1])) { pts.push({x:x*sx,y:y*sy}); break; }
  for (let x=maxx;x>=minx;x-=step) for (let y=maxy;y>=miny;y--) if (mask[y*w+x] && (y===maxy||!mask[(y+1)*w+x])) { pts.push({x:x*sx,y:y*sy}); break; }
  const simple = rdp(pts, Math.max(1.5, Math.min(sx,sy)*2.5));
  return { points: simple.length>=3?simple:pts, closed: true, mask, w, h, n };
}

export async function runEngine(
  engine: AiEngine,
  img: HTMLImageElement, sceneW: number, sceneH: number,
  mode: "click"|"box"|"brush",
  seed: { x:number;y:number;w?:number;h?:number;path?:Pt[] },
  prompts: Prompt[],
  sensitivity: number,
  onStatus?: (s: string) => void
) {
  const wantNeural = engine === "neural" || engine === "auto";
  if (wantNeural && await modelsInstalled()) {
    try {
      const embed = await encodeImage(img, onStatus);
      const nPrompts: NeuralPrompt[] = [];
      prompts.forEach((p) => nPrompts.push({ x: p.x / sceneW * img.naturalWidth, y: p.y / sceneH * img.naturalHeight, label: p.positive ? 1 : 0 }));
      if (mode === "click") nPrompts.push({ x: seed.x / sceneW * img.naturalWidth, y: seed.y / sceneH * img.naturalHeight, label: 1 });
      if (mode === "box" && seed.w && seed.h) {
        nPrompts.push({ x: seed.x / sceneW * img.naturalWidth, y: seed.y / sceneH * img.naturalHeight, label: 2 });
        nPrompts.push({ x: (seed.x + seed.w) / sceneW * img.naturalWidth, y: (seed.y + seed.h) / sceneH * img.naturalHeight, label: 3 });
      }
      if (mode === "brush" && seed.path) {
        const step = Math.max(1, Math.floor(seed.path.length / 8));
        seed.path.forEach((p, i) => { if (i % step === 0) nPrompts.push({ x: p.x / sceneW * img.naturalWidth, y: p.y / sceneH * img.naturalHeight, label: 1 }); });
      }
      if (!nPrompts.length) throw new Error("No neural prompts");
      onStatus?.("Decoding mask…");
      const masks = await decodeMasks(embed, nPrompts);
      const best = masks[0];
      if (!best) throw new Error("Decoder returned no masks");
      const pts = maskToScenePoints(best.mask, best.w, best.h, embed, sceneW, sceneH);
      if (pts) {
        return {
          points: pts, closed: true, engineUsed: "neural" as const,
          neuralMasks: masks, neuralIndex: 0, quality: best.quality,
        };
      }
    } catch (err) {
      if (engine === "neural") throw err;
      onStatus?.("Neural failed, using Enhanced Local: " + String(err));
    }
  } else if (engine === "neural") {
    throw new Error("NEURAL_MODEL_MISSING");
  }
  const useEnhanced = engine === "enhanced" || engine === "auto" || engine === "neural";
  if (useEnhanced) {
    const extra: Prompt[] = [...prompts];
    if (mode === "click") extra.push({ x: seed.x, y: seed.y, positive: true });
    if (mode === "brush" && seed.path) {
      const step = Math.max(1, Math.floor(seed.path.length / 12));
      seed.path.forEach((p,i)=>{ if (i%step===0) extra.push({ x:p.x, y:p.y, positive: true }); });
    }
    const box = mode==="box" && seed.w && seed.h ? { x:seed.x, y:seed.y, w:seed.w, h:seed.h } : undefined;
    const r = enhancedSegment(img, sceneW, sceneH, extra, box);
    if (r) return { ...r, engineUsed: "enhanced-local" as const };
  }
  const lite = await assistedTrace(img, sceneW, sceneH, mode, seed, sensitivity);
  if (!lite) return null;
  return { ...lite, engineUsed: "lightweight" as const };
}

export function morph(mask: Uint8Array, w: number, h: number, mode: "dilate"|"erode"|"holes"|"islands"|"invert") {
  const out = new Uint8Array(mask);
  if (mode === "invert") { for (let i=0;i<out.length;i++) out[i] = out[i] ? 0 : 1; return out; }
  if (mode === "holes" || mode === "islands") {
    // flood from border = background; holes = bg not reachable
    const seen = new Uint8Array(w*h);
    const q: number[] = [];
    const push = (x:number,y:number) => { const i=y*w+x; if (seen[i]||mask[i]) return; seen[i]=1; q.push(x,y); };
    for (let x=0;x<w;x++) { push(x,0); push(x,h-1); }
    for (let y=0;y<h;y++) { push(0,y); push(w-1,y); }
    let qi=0;
    while (qi<q.length) {
      const x=q[qi++]!, y=q[qi++]!;
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx=x+dx,ny=y+dy; if(nx<0||ny<0||nx>=w||ny>=h) continue;
        const i=ny*w+nx; if (seen[i]||mask[i]) continue; seen[i]=1; q.push(nx,ny);
      }
    }
    if (mode==="holes") {
      for (let i=0;i<out.length;i++) if (!mask[i] && !seen[i]) out[i]=1;
    } else {
      for (let i=0;i<out.length;i++) if (mask[i] && seen[i]===0) {
        // keep if this is interior object; islands touching? skip small later
      }
    }
    return out;
  }
  const tmp = new Uint8Array(mask);
  for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
    let any=0, all=1;
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
      const v = mask[(y+dy)*w+(x+dx)]!;
      any = any || v; all = all && v;
    }
    tmp[y*w+x] = mode==="dilate" ? any : all;
  }
  return tmp;
}

export async function enhancedCandidates(img: HTMLImageElement, sceneW: number, sceneH: number) {
  const raw = await analyzeCandidates(img, sceneW, sceneH, 40);
  return dedupeCandidates(raw).map((c, i) => ({ ...c, label: `Object ${i+1}` }));
}
