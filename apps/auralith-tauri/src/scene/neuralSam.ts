/**
 * Enhanced Neural Vision — SAM 2 Hiera Tiny ONNX (Apache-2.0).
 * Real local encoder+decoder inference via onnxruntime-web.
 * Models download only after explicit user consent and SHA-256 verify.
 */
import { rdp, type Pt } from "./traceMath";

type OrtNs = {
  env: { wasm: { wasmPaths: string; numThreads: number } };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => any;
  InferenceSession: { create: (buf: ArrayBuffer, opts?: any) => Promise<any> };
};

let ort: OrtNs | null = null;

async function loadOrt(): Promise<OrtNs> {
  if (ort) return ort;
  const w = window as any;
  if (w.ort) { ort = w.ort; return ort!; }
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.min.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load ONNX Runtime"));
    document.head.appendChild(s);
  });
  ort = (window as any).ort;
  if (!ort) throw new Error("onnxruntime-web did not initialize");
  ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/";
  ort.env.wasm.numThreads = 1;
  return ort;
}

export const NEURAL_MODEL = {
  id: "sam2-hiera-tiny-onnx",
  version: "2.0",
  family: "SAM 2 Hiera Tiny",
  license: "Apache-2.0",
  source: "https://huggingface.co/SharpAI/sam2-hiera-tiny-onnx",
  officialWeights: "https://huggingface.co/facebook/sam2-hiera-tiny",
  officialCode: "https://github.com/facebookresearch/sam2",
  imageSize: 1024,
  maskSize: 256,
  encoder: {
    file: "encoder.onnx",
    url: "https://huggingface.co/SharpAI/sam2-hiera-tiny-onnx/resolve/main/encoder.onnx",
    bytes: 134261315,
    sha256: "df265cb552475e1b3a6cb57c939e57c95ed849bfc2f985c06efab85d8bca6db9",
  },
  decoder: {
    file: "decoder.onnx",
    url: "https://huggingface.co/SharpAI/sam2-hiera-tiny-onnx/resolve/main/decoder.onnx",
    bytes: 20639854,
    sha256: "63198f1f1e273d8f2f4a9d1baf926e53a01d78dc50e0674640e1513dc00d9927",
  },
};

const CACHE = "auralith-neural-v1";

export async function sha256Hex(buf: ArrayBuffer) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function cacheGet(name: string) {
  const c = await caches.open(CACHE);
  const r = await c.match(name);
  if (!r) return null;
  return await r.arrayBuffer();
}

async function cachePut(name: string, buf: ArrayBuffer) {
  const c = await caches.open(CACHE);
  await c.put(name, new Response(buf, { headers: { "Content-Type": "application/octet-stream" } }));
}

export type DownloadProgress = { file: string; received: number; total: number; pct: number };

export async function downloadVerified(
  spec: { file: string; url: string; bytes: number; sha256: string },
  onProg?: (p: DownloadProgress) => void,
  signal?: AbortSignal
) {
  const existing = await cacheGet(spec.file);
  if (existing && existing.byteLength === spec.bytes) {
    const h = await sha256Hex(existing);
    if (h === spec.sha256) return existing;
  }
  const res = await fetch(spec.url, { signal });
  if (!res.ok) throw new Error(`Download failed ${res.status} for ${spec.file}`);
  const total = Number(res.headers.get("content-length") || spec.bytes);
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProg?.({ file: spec.file, received, total, pct: Math.min(100, Math.round((received / total) * 100)) });
  }
  const buf = new Uint8Array(received);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.byteLength; }
  const hash = await sha256Hex(buf.buffer);
  if (hash !== spec.sha256) throw new Error(`Checksum mismatch for ${spec.file}: got ${hash}`);
  await cachePut(spec.file, buf.buffer);
  return buf.buffer;
}

export async function modelsInstalled() {
  const e = await cacheGet(NEURAL_MODEL.encoder.file);
  const d = await cacheGet(NEURAL_MODEL.decoder.file);
  if (!e || !d) return false;
  if (e.byteLength !== NEURAL_MODEL.encoder.bytes || d.byteLength !== NEURAL_MODEL.decoder.bytes) return false;
  return (await sha256Hex(e)) === NEURAL_MODEL.encoder.sha256 && (await sha256Hex(d)) === NEURAL_MODEL.decoder.sha256;
}

type Embed = {
  image_embed: any;
  high_res_feats_0: any;
  high_res_feats_1: any;
  srcW: number;
  srcH: number;
  scale: number;
  padX: number;
  padY: number;
};

let encSess: any = null;
let decSess: any = null;
let embedCache: { key: string; embed: Embed } | null = null;

export async function loadSessions(onStatus?: (s: string) => void) {
  if (encSess && decSess) return;
  onStatus?.("Loading ONNX Runtime…");
  const runtime = await loadOrt();
  const eBuf = await cacheGet(NEURAL_MODEL.encoder.file);
  const dBuf = await cacheGet(NEURAL_MODEL.decoder.file);
  if (!eBuf || !dBuf) throw new Error("Neural model files are not installed.");
  onStatus?.("Creating encoder session…");
  encSess = await runtime.InferenceSession.create(eBuf, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  onStatus?.("Creating decoder session…");
  decSess = await runtime.InferenceSession.create(dBuf, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
}

export function unloadSessions() {
  encSess = null;
  decSess = null;
  embedCache = null;
}

export function invalidateEmbed() { embedCache = null; }

async function letterbox(img: HTMLImageElement) {
  const S = NEURAL_MODEL.imageSize;
  const scale = Math.min(S / img.naturalWidth, S / img.naturalHeight);
  const nw = Math.round(img.naturalWidth * scale);
  const nh = Math.round(img.naturalHeight * scale);
  const padX = Math.floor((S - nw) / 2);
  const padY = Math.floor((S - nh) / 2);
  const c = document.createElement("canvas");
  c.width = S; c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, S, S);
  g.drawImage(img, padX, padY, nw, nh);
  const { data } = g.getImageData(0, 0, S, S);
  const f = new Float32Array(3 * S * S);
  // ImageNet-ish / SAM: RGB 0-1
  for (let i = 0; i < S * S; i++) {
    f[i] = data[i * 4]! / 255;
    f[S * S + i] = data[i * 4 + 1]! / 255;
    f[2 * S * S + i] = data[i * 4 + 2]! / 255;
  }
  const runtime = await loadOrt();
  return { tensor: new runtime.Tensor("float32", f, [1, 3, S, S]), scale, padX, padY };
}

function imageKey(img: HTMLImageElement) {
  return `${img.src}|${img.naturalWidth}x${img.naturalHeight}|${NEURAL_MODEL.id}`;
}

export async function encodeImage(img: HTMLImageElement, onStatus?: (s: string) => void) {
  await loadSessions(onStatus);
  const key = imageKey(img);
  if (embedCache?.key === key) return embedCache.embed;
  onStatus?.("Encoding image…");
  const { tensor, scale, padX, padY } = await letterbox(img);
  const out = await encSess!.run({ image: tensor });
  const embed: Embed = {
    image_embed: out["image_embed"] as ort.Tensor,
    high_res_feats_0: out["high_res_feats_0"] as ort.Tensor,
    high_res_feats_1: out["high_res_feats_1"] as ort.Tensor,
    srcW: img.naturalWidth,
    srcH: img.naturalHeight,
    scale, padX, padY,
  };
  embedCache = { key, embed };
  return embed;
}

export type NeuralPrompt = { x: number; y: number; label: number }; // 1 pos, 0 neg, 2/3 box

function toModelXY(p: NeuralPrompt, embed: Embed) {
  return {
    x: p.x * embed.scale + embed.padX,
    y: p.y * embed.scale + embed.padY,
    label: p.label,
  };
}

export type NeuralMask = {
  mask: Float32Array;
  w: number;
  h: number;
  quality: number;
  index: number;
  count: number;
};

export async function decodeMasks(embed: Embed, prompts: NeuralPrompt[], prev?: Float32Array) {
  if (!decSess) throw new Error("Decoder session missing");
  const mapped = prompts.map((p) => toModelXY(p, embed));
  while (mapped.length < 2) mapped.push({ x: 0, y: 0, label: -1 });
  const n = mapped.length;
  const coords = new Float32Array(n * 2);
  const labels = new Float32Array(n);
  mapped.forEach((p, i) => { coords[i * 2] = p.x; coords[i * 2 + 1] = p.y; labels[i] = p.label; });
  const maskIn = prev ? prev : new Float32Array(1 * 1 * 256 * 256);
  const runtime = await loadOrt();
  const feeds: Record<string, any> = {
    image_embed: embed.image_embed,
    high_res_feats_0: embed.high_res_feats_0,
    high_res_feats_1: embed.high_res_feats_1,
    point_coords: new runtime.Tensor("float32", coords, [1, n, 2]),
    point_labels: new runtime.Tensor("float32", labels, [1, n]),
    mask_input: new runtime.Tensor("float32", maskIn, [1, 1, 256, 256]),
    has_mask_input: new runtime.Tensor("float32", new Float32Array([prev ? 1 : 0]), [1]),
  };
  const out = await decSess.run(feeds);
  const masksT = out["masks"];
  const iouT = out["iou_predictions"];
  const dims = masksT.dims;
  const nMask = dims[1] || 1;
  const mh = dims[2] || 256;
  const mw = dims[3] || 256;
  const data = masksT.data as Float32Array;
  const ious = Array.from(iouT.data as Float32Array);
  const results: NeuralMask[] = [];
  for (let i = 0; i < nMask; i++) {
    const slice = data.slice(i * mh * mw, (i + 1) * mh * mw);
    results.push({ mask: slice, w: mw, h: mh, quality: ious[i] ?? 0, index: i, count: nMask });
  }
  results.sort((a, b) => b.quality - a.quality);
  results.forEach((r, i) => { r.index = i; r.count = results.length; });
  return results;
}

export function maskToScenePoints(
  mask: Float32Array, mw: number, mh: number,
  embed: Embed, sceneW: number, sceneH: number
) {
  const S = NEURAL_MODEL.imageSize;
  // mask is 256x256 over letterboxed 1024
  const pts: Pt[] = [];
  let minx = mw, miny = mh, maxx = 0, maxy = 0, n = 0;
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    if (mask[y * mw + x]! > 0) {
      n++; minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y);
    }
  }
  if (n < 8) return null;
  const step = Math.max(1, Math.floor(Math.max(maxx - minx, maxy - miny) / 80));
  const pushBorder = (x: number, y: number) => {
    const lx = (x + 0.5) / mw * S;
    const ly = (y + 0.5) / mh * S;
    const sx = (lx - embed.padX) / embed.scale;
    const sy = (ly - embed.padY) / embed.scale;
    const px = sx / embed.srcW * sceneW;
    const py = sy / embed.srcH * sceneH;
    if (px >= -4 && py >= -4 && px <= sceneW + 4 && py <= sceneH + 4)
      pts.push({ x: Math.max(0, Math.min(sceneW, px)), y: Math.max(0, Math.min(sceneH, py)) });
  };
  for (let x = minx; x <= maxx; x += step) for (let y = miny; y <= maxy; y++) if (mask[y * mw + x]! > 0 && (y === miny || mask[(y - 1) * mw + x]! <= 0)) { pushBorder(x, y); break; }
  for (let y = miny; y <= maxy; y += step) for (let x = maxx; x >= minx; x--) if (mask[y * mw + x]! > 0 && (x === maxx || mask[y * mw + x + 1]! <= 0)) { pushBorder(x, y); break; }
  for (let x = maxx; x >= minx; x -= step) for (let y = maxy; y >= miny; y--) if (mask[y * mw + x]! > 0 && (y === maxy || mask[(y + 1) * mw + x]! <= 0)) { pushBorder(x, y); break; }
  const simple = rdp(pts, Math.max(1.2, sceneW / 400));
  return simple.length >= 3 ? simple : pts;
}

export function upsampleMaskToScene(
  mask: Float32Array, mw: number, mh: number,
  embed: Embed, sceneW: number, sceneH: number
) {
  const S = NEURAL_MODEL.imageSize;
  const out = new Uint8Array(Math.ceil(sceneW) * Math.ceil(sceneH));
  const W = Math.ceil(sceneW), H = Math.ceil(sceneH);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ix = x / sceneW * embed.srcW * embed.scale + embed.padX;
      const iy = y / sceneH * embed.srcH * embed.scale + embed.padY;
      const mx = Math.max(0, Math.min(mw - 1, Math.round(ix / S * mw)));
      const my = Math.max(0, Math.min(mh - 1, Math.round(iy / S * mh)));
      out[y * W + x] = mask[my * mw + mx]! > 0 ? 1 : 0;
    }
  }
  return { data: out, w: W, h: H };
}
