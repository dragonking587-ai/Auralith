import type { AudioSnapshot } from "../audio/engine";
import type { EffectKind, Project } from "../scene/types";
import { sceneViewport } from "../scene/transform";

const VS = `attribute vec2 a; void main(){ gl_Position=vec4(a,0.0,1.0); }`;
const FS = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uMod;
uniform vec3 uColor; uniform float uKind; uniform float uInt;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = uv * 2.0 - 1.0;
  float d = length(p);
  float k = uKind;
  float pulse = 0.5 + 0.5 * sin(uTime * (1.2 + k * 0.07) + d * 8.0);
  float glow = exp(-d * (2.2 + k * 0.04)) * (0.35 + uMod * 0.75) * uInt;
  float rays = abs(sin(atan(p.y,p.x)* (4.0 + mod(k,7.0)) + uTime));
  float n = fract(sin(dot(uv, vec2(12.9898,78.233))) * 43758.5453);
  float flame = exp(-abs(p.x)*6.0) * smoothstep(0.9, -0.2, p.y) * (0.6 + 0.4*n);
  float weather = step(0.985, fract(uv.x*40.0 + uv.y* (k*3.0) - uTime* (0.4+k*0.02)));
  float energy = glow + 0.25 * rays * glow + flame * step(30.0,k)*step(k,36.0) + weather * step(49.0,k);
  vec3 col = mix(uColor, vec3(1.0,0.85,0.4), pulse * 0.35);
  gl_FragColor = vec4(col * energy, clamp(energy, 0.0, 1.0));
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

export class GlRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private buf: WebGLBuffer;
  private tex: WebGLTexture | null = null;
  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 required");
    this.gl = gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    this.prog = p;
    this.buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  }
  setBackdrop(img: HTMLImageElement | null) {
    const gl = this.gl;
    if (!img) { if (this.tex) gl.deleteTexture(this.tex); this.tex = null; return; }
    if (!this.tex) this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  }
  draw(project: Project, snap: AudioSnapshot, cssW: number, cssH: number) {
    const gl = this.gl;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.floor(cssW * dpr)), h = Math.max(2, Math.floor(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.02, 0.02, 0.035, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const vp = sceneViewport(w, h, project.width, project.height, project.fit);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.floor(vp.x), Math.floor(vp.y), Math.max(1, Math.floor(vp.w)), Math.max(1, Math.floor(vp.h)));
    gl.clearColor(0.04, 0.04, 0.06, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const loc = gl.getAttribLocation(this.prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const t = performance.now() / 1000;
    for (const r of project.regions) {
      for (const e of r.effects) {
        if (!e.enabled) continue;
        const audio = e.audio === "Manual" ? 1 : bandOf(snap, e.audio);
        const mod = e.audio === "Manual" ? e.intensity : e.intensity * (1 - e.audioInfluence + e.audioInfluence * audio);
        const c = hex(e.color);
        gl.uniform2f(gl.getUniformLocation(this.prog, "uRes"), w, h);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uTime"), t * e.speed * project.masters.motion);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uMod"), mod * project.masters.intensity * project.masters.sensitivity);
        gl.uniform3f(gl.getUniformLocation(this.prog, "uColor"), c[0]*project.masters.brightness, c[1]*project.masters.brightness, c[2]*project.masters.brightness);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uKind"), KIND_INDEX[e.kind]);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uInt"), e.opacity);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
  }
}
function hex(h: string): [number, number, number] {
  const n = h.replace("#", "");
  return [parseInt(n.slice(0,2),16)/255, parseInt(n.slice(2,4),16)/255, parseInt(n.slice(4,6),16)/255];
}
