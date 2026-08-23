/** Localized WebGL volumetric Magic pass. Original cinematic vapor, not a copied spell. */

export interface MagicEmitterGPU {
  x: number;
  y: number;
  rx: number;
  ry: number;
  env: number;
  surge: number;
  seed: number;
  r: number;
  g: number;
  b: number;
}

export interface MagicGLParams {
  time: number;
  flow: number;
  energy: number;
  intensity: number;
  bright: number;
}

const MAX = 16;

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 1.0 - (aPos.y * 0.5 + 0.5));
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform float uTime;
uniform float uFlow;
uniform float uEnergy;
uniform float uIntensity;
uniform float uBright;
uniform int uCount;
uniform vec4 uA[16];
uniform vec4 uB[16];
uniform vec4 uC[16];
uniform sampler2D uPrev;
uniform vec2 uInv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p *= 2.05;
    a *= 0.5;
  }
  return s;
}
vec2 curl(vec2 p) {
  float e = 0.12;
  float n1 = fbm(p + vec2(0.0, e));
  float n2 = fbm(p - vec2(0.0, e));
  float n3 = fbm(p + vec2(e, 0.0));
  float n4 = fbm(p - vec2(e, 0.0));
  return vec2(n1 - n2, n4 - n3);
}

void main() {
  vec2 uv = vUv;
  float t = uTime;
  float flow = uFlow;
  vec2 adv = curl(uv * 2.4 + vec2(t * (0.07 + flow * 0.12), t * 0.05)) * (0.012 + flow * 0.018 + uEnergy * 0.01);
  vec4 hist = texture2D(uPrev, clamp(uv - adv, 0.0, 1.0));

  float dens = 0.0;
  float curr = 0.0;
  vec3 pigment = vec3(0.0);
  float pigmentW = 0.0;

  for (int i = 0; i < 16; i++) {
    if (i >= uCount) break;
    vec4 a = uA[i];
    vec4 b = uB[i];
    vec4 c = uC[i];
    vec2 pos = a.xy;
    vec2 rad = max(a.zw, vec2(0.012));
    float env = b.x;
    float surge = b.y;
    float seed = b.z;
    if (env < 0.02) continue;

    vec2 p = (uv - pos) / rad;
    float ang = seed * 6.2832;
    float cs = cos(ang * 0.15);
    float sn = sin(ang * 0.15);
    p = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y);

    vec2 w1 = curl(p * 1.35 + vec2(seed, t * (0.11 + flow * 0.2)));
    p += w1 * (0.22 + env * 0.18 + surge * 0.12);
    vec2 w2 = curl(p * 3.4 - vec2(t * (0.22 + flow * 0.45), seed * 2.0));
    p += w2 * (0.08 + uEnergy * 0.06);

    float d = length(p);
    float veil = smoothstep(1.55 + surge * 0.35, 0.18, d);
    float n = fbm(p * 2.8 + vec2(t * 0.16, seed));
    float n2 = fbm(p * 5.6 - vec2(t * (0.28 + flow * 0.5), 3.1));
    float smoke = veil * (0.22 + 0.78 * n) * (0.55 + 0.45 * n2);
    smoke *= env;

    vec2 cdir = curl(p * 2.2 + vec2(t * (0.35 + flow * 1.1), seed));
    float lanes = fbm(p * 7.5 - cdir * 1.8 - vec2(t * (0.8 + flow * 1.6), 0.0));
    float stream = veil * smoothstep(0.42, 0.82, lanes) * env * (0.45 + surge * 0.55);

    dens += smoke;
    curr += stream;
    float w = smoke + stream * 1.3;
    pigment += c.rgb * w;
    pigmentW += w;
  }

  dens = min(dens, 1.15);
  curr = min(curr, 1.0);
  vec3 baseCol = pigmentW > 0.001 ? pigment / pigmentW : vec3(0.6, 0.5, 0.9);
  vec3 deep = baseCol * 0.38;
  vec3 mid = baseCol * 0.92;
  vec3 hi = mix(baseCol, vec3(0.95, 0.93, 0.88), 0.28);

  float body = smoothstep(0.04, 0.55, dens);
  float inner = smoothstep(0.18, 0.75, curr);
  vec3 color = mix(deep, mid, body);
  color = mix(color, hi, inner * 0.65);
  float bloom = smoothstep(0.4, 0.9, dens * 0.6 + curr) * 0.22 * uBright;
  color += hi * bloom;

  float alpha = dens * 0.42 + curr * 0.32;
  alpha = min(alpha * uIntensity * uBright, 0.82);

  float persist = hist.a * (0.88 - uEnergy * 0.04);
  float outA = max(alpha, persist * 0.9);
  vec3 outC = color;
  if (persist > 0.02) {
    outC = mix(hist.rgb, color, clamp(alpha / max(outA, 0.001), 0.15, 1.0));
  }

  gl_FragColor = vec4(outC * outA, outA);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function makeTex(gl: WebGLRenderingContext, w: number, h: number): WebGLTexture | null {
  const t = gl.createTexture();
  if (!t) return null;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export class MagicGL {
  canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private buf: WebGLBuffer;
  private prev: WebGLTexture;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private packA = new Float32Array(MAX * 4);
  private packB = new Float32Array(MAX * 4);
  private packC = new Float32Array(MAX * 4);
  private w = 0;
  private h = 0;

  static tryCreate(): MagicGL | null {
    if (typeof document === "undefined") return null;
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl", {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: true,
      });
      if (!gl) return null;
      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return null;
      const prog = gl.createProgram();
      if (!prog) return null;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, 0, "aPos");
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
      const buf = gl.createBuffer();
      if (!buf) return null;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const inst = new MagicGL(canvas, gl, prog, buf);
      if (!inst.alloc(640, 360)) return null;
      return inst;
    } catch {
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext, prog: WebGLProgram, buf: WebGLBuffer) {
    this.canvas = canvas;
    this.gl = gl;
    this.prog = prog;
    this.buf = buf;
    this.prev = gl.createTexture()!;
    const names = ["uTime", "uFlow", "uEnergy", "uIntensity", "uBright", "uCount", "uPrev", "uInv"];
    for (const n of names) this.loc[n] = gl.getUniformLocation(prog, n);
    this.loc.uA = gl.getUniformLocation(prog, "uA[0]");
    this.loc.uB = gl.getUniformLocation(prog, "uB[0]");
    this.loc.uC = gl.getUniformLocation(prog, "uC[0]");
  }

  private alloc(w: number, h: number): boolean {
    const gl = this.gl;
    w = Math.max(64, Math.min(1280, w | 0));
    h = Math.max(64, Math.min(720, h | 0));
    if (w === this.w && h === this.h) return true;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    const t = makeTex(gl, w, h);
    if (!t) return false;
    gl.deleteTexture(this.prev);
    this.prev = t;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return true;
  }

  render(emitters: MagicEmitterGPU[], params: MagicGLParams, destW: number, destH: number): boolean {
    const gl = this.gl;
    const w = Math.max(160, Math.min(1280, destW | 0));
    const h = Math.max(90, Math.min(720, destH | 0));
    if (!this.alloc(w, h)) return false;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ZERO);
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.prev);
    gl.uniform1i(this.loc.uPrev, 0);
    gl.uniform2f(this.loc.uInv, 1 / this.w, 1 / this.h);
    gl.uniform1f(this.loc.uTime, params.time);
    gl.uniform1f(this.loc.uFlow, params.flow);
    gl.uniform1f(this.loc.uEnergy, params.energy);
    gl.uniform1f(this.loc.uIntensity, params.intensity);
    gl.uniform1f(this.loc.uBright, params.bright);

    const n = Math.min(MAX, emitters.length);
    gl.uniform1i(this.loc.uCount, n);
    this.packA.fill(0);
    this.packB.fill(0);
    this.packC.fill(0);
    for (let i = 0; i < n; i++) {
      const e = emitters[i]!;
      const o = i * 4;
      this.packA[o] = e.x;
      this.packA[o + 1] = e.y;
      this.packA[o + 2] = e.rx;
      this.packA[o + 3] = e.ry;
      this.packB[o] = e.env;
      this.packB[o + 1] = e.surge;
      this.packB[o + 2] = e.seed;
      this.packC[o] = e.r / 255;
      this.packC[o + 1] = e.g / 255;
      this.packC[o + 2] = e.b / 255;
      this.packC[o + 3] = 1;
    }
    if (this.loc.uA) gl.uniform4fv(this.loc.uA, this.packA);
    if (this.loc.uB) gl.uniform4fv(this.loc.uB, this.packB);
    if (this.loc.uC) gl.uniform4fv(this.loc.uC, this.packC);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindTexture(gl.TEXTURE_2D, this.prev);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, this.w, this.h, 0);
    return true;
  }
}

