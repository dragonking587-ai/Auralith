import type { AudioSnapshot } from "../audio/engine";
import type { EffectKind, Project } from "../scene/types";
import { sceneViewport } from "../scene/transform";

const VS = `attribute vec2 a; void main(){ gl_Position=vec4(a,0.0,1.0); }`;
const FS = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uMod;
uniform vec3 uA; uniform vec3 uB; uniform float uKind; uniform float uInt;
uniform vec2 uOrigin; uniform float uRadius;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float n2(vec2 p){ vec2 i=floor(p),f=fract(p); float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1)); vec2 u=f*f*(3.0-2.0*f); return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y; }
void main(){
  vec2 uv = gl_FragCoord.xy/uRes;
  vec2 p = (gl_FragCoord.xy - uOrigin)/max(uRadius,8.0);
  float d = length(p);
  float t = uTime;
  float k = uKind;
  float m = clamp(uMod,0.0,2.0);
  vec3 col = uA;
  float a = 0.0;
  if (k < 16.0) {
    float glow = exp(-d*(1.8+k*0.05))*(0.25+m);
    float pulse = 0.5+0.5*sin(t*(1.0+k*0.15));
    float rays = pow(abs(sin(atan(p.y,p.x)*(3.0+mod(k,8.0))+t)), 8.0);
    a = glow*(0.55+0.45*pulse) + rays*glow*step(11.0,k);
    col = mix(uA,uB,pulse*0.35);
  } else if (k < 31.0) {
    float ang = atan(p.y,p.x);
    float flow = n2(p*3.0+vec2(t*0.4,t*0.2));
    float tend = abs(sin(ang*5.0 + t + flow*4.0));
    float core = exp(-d*3.2);
    a = core*(0.4+m) + tend*exp(-d*1.4)*0.45*m;
    col = mix(uB,uA,core);
    if (k > 26.0) a += step(0.92, hash(vec2(ang,floor(t*20.0)))) * exp(-d);
  } else if (k < 37.0) {
    float flame = exp(-abs(p.x)*(3.5+2.0*m)) * smoothstep(0.85,-0.35,p.y);
    flame *= 0.55 + 0.45*n2(vec2(p.x*6.0, p.y*3.0 - t*2.5));
    a = flame * (0.7+m);
    col = mix(vec3(1.0,0.95,0.55), vec3(1.0,0.25,0.02), clamp(d+p.y*0.3,0.0,1.0));
  } else if (k < 46.0) {
    a = exp(-d*2.0)*(0.3+m);
    col = mix(uA,uB,0.5+0.5*sin(t+uv.x*8.0));
    a *= 0.7 + 0.3*n2(uv*20.0+t);
  } else if (k < 50.0) {
    a = (1.0-exp(-d*0.4))*0.25*m;
    col = vec3(0.02,0.02,0.05);
  } else if (k < 61.0) {
    float drop = step(0.97, fract(uv.x*50.0 + hash(vec2(uv.x,0.0))*10.0 - t*(0.6+m)));
    a = drop * 0.8 + n2(uv*8.0+t*0.05)*0.12*m;
    col = mix(uB, vec3(0.8,0.9,1.0), 0.5);
  } else if (k < 66.0) {
    float ring = abs(d-0.55-0.1*sin(t));
    a = exp(-ring*18.0)*(0.4+m);
    col = uA;
  } else {
    float bits = step(0.88, hash(floor(p*12.0)+floor(t*(4.0+k-66.0))));
    a = bits * exp(-d*1.1) * (0.35+m);
    col = mix(uA,uB,hash(p));
  }
  gl_FragColor = vec4(col, clamp(a*uInt,0.0,1.0));
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
  return s;
}
const KIND_INDEX: Record<EffectKind, number> = {
  Pulse:1,Flicker:2,LightSurge:3,Strobe:4,GlowBloom:5,BreathingGlow:6,Afterglow:7,EchoPulse:8,WaveSweep:9,Spotlight:10,
  Halo:11,LightRays:12,GodRays:13,LensFlare:14,Starburst:15,
  EnergyFlow:16,EnergyRipple:17,Shockwave:18,MagicEnergy:19,Plasma:20,VoidEnergy:21,Portal:22,Vortex:23,EnergyBeam:24,EnergySparks:25,
  SpectralAura:26,LightningArc:27,ElectricCrawl:28,ThunderFlash:29,Laser:30,
  RealisticFlame:31,Embers:32,Sparks:33,HeatDistortion:34,SmokeFog:35,Mist:36,
  HueShift:37,ChromaticPulse:38,PrismaticLight:39,NeonGlow:40,NeonChase:41,Shimmer:42,GlitterSparkle:43,HolographicDistortion:44,GlitchLight:45,
  ShadowPulse:46,RoomDim:47,LocalDim:48,ContrastSurge:49,
  Rain:50,WetReflection:51,Snow:52,Ash:53,DustMotes:54,Aurora:55,AtmosphericHaze:56,WaterReflection:57,Caustics:58,WaterRipple:59,Refraction:60,
  RuneGlow:61,RuneSequence:62,TraceChase:63,TracePulse:64,OutlineEnergy:65,
  ParticleBurst:66,ParticleFountain:67,OrbitingParticles:68,GravityParticles:69,ReverseGravity:70,Swarm:71,Trail:72,
  BeatFlash:73,TransientBurst:74,BassExpansion:75,FrequencyGradient:76,SpectrumSweep:77,AudioRipple:78,PeakHoldGlow:79,RhythmChase:80
};
export function bandOf(snap: AudioSnapshot, map: string) {
  switch (map) {
    case "Raw": return snap.raw; case "Bass": return snap.bass; case "Low": return snap.low;
    case "Mid": return snap.mid; case "High": return snap.high; case "FullMix": return snap.fullMix;
    case "Beat": return snap.beat; case "Transient": return snap.transient; default: return 1;
  }
}
const BVS = `attribute vec2 a; attribute vec2 u; varying vec2 v; void main(){ v=u; gl_Position=vec4(a,0.0,1.0); }`;
const BFS = `precision highp float; varying vec2 v; uniform sampler2D tex; void main(){ gl_FragColor = texture2D(tex, v); }`;

export class GlRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private bgProg: WebGLProgram;
  private buf: WebGLBuffer;
  private bgBuf: WebGLBuffer;
  private tex: WebGLTexture | null = null;
  private hasBackdrop = false;
  fps = 0;
  private frames = 0;
  private lastFps = performance.now();
  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 required");
    this.gl = gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
    this.prog = p;
    const bp = gl.createProgram()!;
    gl.attachShader(bp, compile(gl, gl.VERTEX_SHADER, BVS));
    gl.attachShader(bp, compile(gl, gl.FRAGMENT_SHADER, BFS));
    gl.linkProgram(bp);
    if (!gl.getProgramParameter(bp, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(bp) || "bg link");
    this.bgProg = bp;
    this.buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    this.bgBuf = gl.createBuffer()!;
  }
  setBackdrop(img: HTMLImageElement | null) {
    const gl = this.gl;
    if (!img) {
      this.hasBackdrop = false;
      console.log("[ImageLoad] STATE_UPDATED backdrop=none");
      return;
    }
    if (!this.tex) this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    this.hasBackdrop = true;
    console.log("[ImageLoad] DECODE_OK", img.naturalWidth, "x", img.naturalHeight);
    console.log("[ImageLoad] STATE_UPDATED backdrop=texture");
  }
  private drawBackdrop(w: number, h: number, vp: { x: number; y: number; w: number; h: number }) {
    if (!this.hasBackdrop || !this.tex) return;
    const gl = this.gl;
    const yGL = h - vp.y - vp.h;
    const x0 = (vp.x / w) * 2 - 1;
    const x1 = ((vp.x + vp.w) / w) * 2 - 1;
    const y0 = (yGL / h) * 2 - 1;
    const y1 = ((yGL + vp.h) / h) * 2 - 1;
    const data = new Float32Array([
      x0, y0, 0, 0,
      x1, y0, 1, 0,
      x0, y1, 0, 1,
      x1, y1, 1, 1,
    ]);
    gl.useProgram(this.bgProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bgBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    const a = gl.getAttribLocation(this.bgProg, "a");
    const u = gl.getAttribLocation(this.bgProg, "u");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(u);
    gl.vertexAttribPointer(u, 2, gl.FLOAT, false, 16, 8);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(gl.getUniformLocation(this.bgProg, "tex"), 0);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  draw(project: Project, snap: AudioSnapshot, cssW: number, cssH: number) {
    const gl = this.gl;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.floor(cssW * dpr)), h = Math.max(2, Math.floor(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.02, 0.02, 0.04, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const vp = sceneViewport(w, h, project.width, project.height, project.fit);
    gl.enable(gl.SCISSOR_TEST);
    const yGL = Math.max(0, Math.floor(h - vp.y - vp.h));
    gl.scissor(Math.max(0,Math.floor(vp.x)), yGL, Math.max(1,Math.floor(vp.w)), Math.max(1,Math.floor(vp.h)));
    gl.clearColor(0.05, 0.05, 0.07, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
    this.drawBackdrop(w, h, vp);
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const loc = gl.getAttribLocation(this.prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const t = performance.now() / 1000;
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    for (const r of project.regions) {
      const ox = vp.x + (r.x / project.width) * vp.w;
      const oy = vp.y + (1 - r.y / project.height) * vp.h;
      const rad = Math.max(20, r.radius * (vp.w / project.width));
      for (const e of r.effects) {
        if (!e.enabled) continue;
        const audio = e.audio === "Manual" ? 1 : bandOf(snap, e.audio);
        const mod = e.audio === "Manual" ? e.intensity : e.intensity * (1 - e.audioInfluence + e.audioInfluence * audio);
        const c = hex(e.color), c2 = hex(e.color2);
        gl.uniform2f(gl.getUniformLocation(this.prog, "uRes"), w, h);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uTime"), t * e.speed * project.masters.motion);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uMod"), mod * project.masters.intensity);
        gl.uniform3f(gl.getUniformLocation(this.prog, "uA"), c[0]*project.masters.brightness, c[1]*project.masters.brightness, c[2]*project.masters.brightness);
        gl.uniform3f(gl.getUniformLocation(this.prog, "uB"), c2[0], c2[1], c2[2]);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uKind"), KIND_INDEX[e.kind]);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uInt"), e.opacity);
        gl.uniform2f(gl.getUniformLocation(this.prog, "uOrigin"), ox, oy);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uRadius"), rad);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
    this.frames++;
    const now = performance.now();
    if (now - this.lastFps > 500) { this.fps = this.frames * 1000 / (now - this.lastFps); this.frames = 0; this.lastFps = now; }
  }
}
function hex(h: string): [number, number, number] {
  const n = (h || "#f4d27a").replace("#", "");
  return [parseInt(n.slice(0,2)||"f4",16)/255, parseInt(n.slice(2,4)||"d2",16)/255, parseInt(n.slice(4,6)||"7a",16)/255];
}
