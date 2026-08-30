/** On-device experimental vision. No network. Heuristic engine, not a bundled neural net. */
import { rdp, type Pt } from "./traceMath";

export type AiCandidate = {
  id: string;
  label: string;
  kind: "trace" | "mask";
  points: Pt[];
  closed: boolean;
  box: { x: number; y: number; w: number; h: number };
};

export type AiMask = { w: number; h: number; data: Uint8Array };

function canvasFrom(img: HTMLImageElement, max = 640) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(img.naturalWidth * s));
  c.height = Math.max(2, Math.round(img.naturalHeight * s));
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, c.width, c.height);
  return { c, g, s, data: g.getImageData(0, 0, c.width, c.height) };
}

function lum(d: Uint8ClampedArray, i: number) {
  return 0.2126 * d[i] + 0.7152 * d[i+1] + 0.0722 * d[i+2];
}

function flood(data: ImageData, sx: number, sy: number, tol: number) {
  const { width: w, height: h, data: px } = data;
  const mask = new Uint8Array(w * h);
  const x0 = Math.max(0, Math.min(w-1, sx|0));
  const y0 = Math.max(0, Math.min(h-1, sy|0));
  const seed = lum(px, (y0*w+x0)*4);
  const q = [x0, y0];
  mask[y0*w+x0] = 1;
  let qi = 0, n = 1;
  while (qi < q.length) {
    const x = q[qi++]!, y = q[qi++]!;
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x+dx, ny = y+dy;
      if (nx<0||ny<0||nx>=w||ny>=h) continue;
      const i = ny*w+nx;
      if (mask[i]) continue;
      if (Math.abs(lum(px, i*4) - seed) > tol) continue;
      mask[i] = 1; q.push(nx, ny); n++;
    }
  }
  return { mask, w, h, n };
}

function boxMask(data: ImageData, x: number, y: number, bw: number, bh: number, tol: number) {
  const { width: w, height: h, data: px } = data;
  const x0 = Math.max(0, Math.min(w-1, x|0));
  const y0 = Math.max(0, Math.min(h-1, y|0));
  const x1 = Math.max(x0+1, Math.min(w, (x+bw)|0));
  const y1 = Math.max(y0+1, Math.min(h, (y+bh)|0));
  let sum = 0, cnt = 0;
  for (let yy=y0; yy<y1; yy++) for (let xx=x0; xx<x1; xx++) { sum += lum(px,(yy*w+xx)*4); cnt++; }
  const seed = sum / Math.max(1,cnt);
  const mask = new Uint8Array(w*h);
  let n = 0;
  for (let yy=y0; yy<y1; yy++) for (let xx=x0; xx<x1; xx++) {
    if (Math.abs(lum(px,(yy*w+xx)*4)-seed) <= tol) { mask[yy*w+xx]=1; n++; }
  }
  return { mask, w, h, n };
}

function contour(mask: Uint8Array, w: number, h: number, scaleX: number, scaleY: number): Pt[] {
  let minx=w, miny=h, maxx=0, maxy=0;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) if (mask[y*w+x]) {
    if (x<minx) minx=x; if (y<miny) miny=y; if (x>maxx) maxx=x; if (y>maxy) maxy=y;
  }
  if (maxx<=minx) return [];
  const pts: Pt[] = [];
  for (let x=minx;x<=maxx;x++) if (mask[miny*w+x]) { pts.push({x:x*scaleX,y:miny*scaleY}); break; }
  // march boundary coarsely
  for (let x=minx;x<=maxx;x+=Math.max(1, Math.floor((maxx-minx)/48))) {
    for (let y=miny;y<=maxy;y++) if (mask[y*w+x] && (y===miny || !mask[(y-1)*w+x])) { pts.push({x:x*scaleX,y:y*scaleY}); break; }
  }
  for (let y=miny;y<=maxy;y+=Math.max(1, Math.floor((maxy-miny)/48))) {
    for (let x=maxx;x>=minx;x--) if (mask[y*w+x] && (x===maxx || !mask[y*w+x+1])) { pts.push({x:x*scaleX,y:y*scaleY}); break; }
  }
  for (let x=maxx;x>=minx;x-=Math.max(1, Math.floor((maxx-minx)/48))) {
    for (let y=maxy;y>=miny;y--) if (mask[y*w+x] && (y===maxy || !mask[(y+1)*w+x])) { pts.push({x:x*scaleX,y:y*scaleY}); break; }
  }
  const simp = rdp(pts, Math.max(2, Math.min(scaleX, scaleY)*3));
  return simp.length >= 3 ? simp : pts;
}

export async function assistedTrace(
  img: HTMLImageElement,
  sceneW: number, sceneH: number,
  mode: "click"|"box"|"brush",
  seed: { x: number; y: number; w?: number; h?: number; path?: Pt[] },
  sensitivity: number
): Promise<{ points: Pt[]; closed: boolean } | null> {
  const { data, s, c } = canvasFrom(img);
  const sx = sceneW / c.width, sy = sceneH / c.height;
  const tol = 18 + (1-sensitivity)*40;
  let res;
  if (mode === "box") res = boxMask(data, (seed.x/sceneW)*c.width, (seed.y/sceneH)*c.height, ((seed.w||80)/sceneW)*c.width, ((seed.h||80)/sceneH)*c.height, tol);
  else if (mode === "brush" && seed.path?.length) {
    const mask = new Uint8Array(c.width*c.height);
    for (const p of seed.path) {
      const x = Math.round((p.x/sceneW)*c.width), y = Math.round((p.y/sceneH)*c.height);
      for (let dy=-3; dy<=3; dy++) for (let dx=-3; dx<=3; dx++) {
        const xx=x+dx, yy=y+dy; if (xx>=0&&yy>=0&&xx<c.width&&yy<c.height) mask[yy*c.width+xx]=1;
      }
    }
    // grow from brush into similar color
    const grow = flood(data, Math.round((seed.path[0]!.x/sceneW)*c.width), Math.round((seed.path[0]!.y/sceneH)*c.height), tol);
    res = grow;
  } else res = flood(data, (seed.x/sceneW)*c.width, (seed.y/sceneH)*c.height, tol);
  if (res.n < 40) return null;
  const points = contour(res.mask, res.w, res.h, sx, sy);
  if (points.length < 3) return null;
  return { points, closed: true };
}

export async function analyzeCandidates(img: HTMLImageElement, sceneW: number, sceneH: number, minSize: number): Promise<AiCandidate[]> {
  const { data, c } = canvasFrom(img, 480);
  const { width: w, height: h, data: px } = data;
  const sx = sceneW / w, sy = sceneH / h;
  // gradient magnitude
  const mag = new Float32Array(w*h);
  for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
    const l = lum(px,(y*w+x)*4);
    const dx = lum(px,(y*w+x+1)*4)-lum(px,(y*w+x-1)*4);
    const dy = lum(px,((y+1)*w+x)*4)-lum(px,((y-1)*w+x)*4);
    mag[y*w+x] = Math.hypot(dx,dy);
  }
  const bin = new Uint8Array(w*h);
  for (let i=0;i<bin.length;i++) if (mag[i] > 28) bin[i]=1;
  const seen = new Uint8Array(w*h);
  const out: AiCandidate[] = [];
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]] as const;
  for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
    const i=y*w+x; if (!bin[i] || seen[i]) continue;
    const q=[x,y]; seen[i]=1; let qi=0, minx=x,miny=y,maxx=x,maxy=y,n=0;
    const mask = new Uint8Array(w*h);
    while (qi<q.length) {
      const cx=q[qi++]!, cy=q[qi++]!; mask[cy*w+cx]=1; n++;
      minx=Math.min(minx,cx); miny=Math.min(miny,cy); maxx=Math.max(maxx,cx); maxy=Math.max(maxy,cy);
      for (const [dx,dy] of dirs) {
        const nx=cx+dx, ny=cy+dy; if(nx<0||ny<0||nx>=w||ny>=h) continue;
        const j=ny*w+nx; if(!bin[j]||seen[j]) continue; seen[j]=1; q.push(nx,ny);
      }
    }
    const bw=maxx-minx, bh=maxy-miny;
    if (n < minSize || bw < 8 || bh < 8) continue;
    const points = contour(mask, w, h, sx, sy);
    if (points.length < 4) continue;
    out.push({
      id: crypto.randomUUID(),
      label: out.length===0 ? "Primary object" : `Region ${out.length+1}`,
      kind: "trace",
      points, closed: true,
      box: { x: minx*sx, y: miny*sy, w: bw*sx, h: bh*sy }
    });
    if (out.length >= 8) return out;
  }
  return out;
}

export async function foregroundMask(img: HTMLImageElement, sceneW: number, sceneH: number) {
  const { data, c } = canvasFrom(img, 480);
  const { width: w, height: h, data: px } = data;
  // center-weighted contrast vs border mean
  let border=0, bc=0;
  for (let x=0;x<w;x++) { border+=lum(px,x*4)+lum(px,((h-1)*w+x)*4); bc+=2; }
  const bg = border/bc;
  const mask = new Uint8Array(w*h);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const l = lum(px,(y*w+x)*4);
    const cx=(x/w-0.5), cy=(y/h-0.5);
    const center = 1 - Math.min(1, Math.hypot(cx,cy)*1.6);
    if (Math.abs(l-bg) > 22 + 10*(1-center)) mask[y*w+x]=1;
  }
  const pts = contour(mask, w, h, sceneW/w, sceneH/h);
  return { points: pts, closed: pts.length>=3, w, h, mask };
}

export async function estimateDepth(img: HTMLImageElement) {
  const { c, g, data } = canvasFrom(img, 384);
  const { width: w, height: h, data: px } = data;
  const out = g.createImageData(w,h);
  for (let i=0;i<w*h;i++) {
    const l = lum(px, i*4);
    // nearer = higher local contrast / brighter subject heuristic
    const v = Math.max(0, Math.min(255, 255-l));
    out.data[i*4]=v; out.data[i*4+1]=v; out.data[i*4+2]=v; out.data[i*4+3]=255;
  }
  g.putImageData(out,0,0);
  return c.toDataURL("image/png");
}

export function invertDepth(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas");
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext("2d")!;
      g.drawImage(im,0,0);
      const d = g.getImageData(0,0,c.width,c.height);
      for (let i=0;i<d.data.length;i+=4) {
        d.data[i]=255-d.data[i]; d.data[i+1]=255-d.data[i+1]; d.data[i+2]=255-d.data[i+2];
      }
      g.putImageData(d,0,0);
      resolve(c.toDataURL("image/png"));
    };
    im.onerror = () => reject(new Error("depth invert failed"));
    im.src = dataUrl;
  });
}
