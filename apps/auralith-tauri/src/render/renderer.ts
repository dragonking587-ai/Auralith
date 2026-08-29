import type { AudioSnapshot } from "../audio/engine";
import type { EffectKind, Project } from "../scene/types";
import { sceneViewport } from "../scene/transform";

const VS = `attribute vec2 a; void main(){ gl_Position=vec4(a,0.0,1.0); }`;
const FS = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uMod;
uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform float uKind; uniform float uInt;
uniform vec2 uOrigin; uniform float uRadius;
uniform float uP0; uniform float uP1; uniform float uP2;
uniform float uQ; uniform float uBass; uniform float uMid; uniform float uHigh; uniform float uBeat;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float n2(vec2 p){ vec2 i=floor(p),f=fract(p); float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1)); vec2 u=f*f*(3.0-2.0*f); return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y; }
float fbm(vec2 p){ float v=0.0,a=0.5; int oct = uQ>2.5?5:(uQ>1.5?4:3); for(int i=0;i<5;i++){ if(i>=oct) break; v+=a*n2(p); p=p*2.03+vec2(17.1,9.3); a*=0.5; } return v; }
vec3 hueShift(vec3 c, float h){ float k=h*6.2831; float cosA=cos(k),sinA=sin(k); vec3 w=vec3(0.299,0.587,0.114); vec3 v=c-dot(w,c); return c+v*cosA+cross(vec3(0.577,0.577,0.577),v)*sinA; }
void main(){
  vec2 uv = gl_FragCoord.xy/uRes;
  vec2 p = (gl_FragCoord.xy - uOrigin)/max(uRadius*(0.35+uP1), 8.0);
  float d = length(p);
  float ang = atan(p.y,p.x);
  float t = uTime;
  float k = uKind;
  float m = clamp(uMod,0.0,2.5);
  float p0 = clamp(uP0,0.0,2.0);
  float p2 = clamp(uP2,0.0,2.0);
  vec3 col = uA;
  float a = 0.0;
  if (k < 1.5) {
    float pulse = 0.5+0.5*sin(t*6.2831*(0.4+p0*1.8)+p2*6.2831);
    float sz = 1.0 + pulse*0.55*p0*m;
    a = exp(-d*sz*2.2)*(0.25+m*pulse);
    col = mix(uA,uB,pulse);
  } else if (k < 2.5) {
    float flick = n2(vec2(floor(t*(6.0+p0*28.0)), 3.1));
    float micro = n2(vec2(t*40.0, 8.0));
    float stab = mix(flick, 0.7, p2);
    a = exp(-d*2.4)*(0.15+m*(0.2+0.8*stab)+micro*0.12*p0);
    col = mix(uA,uB,flick);
  } else if (k < 3.5) {
    float env = exp(-fract(t*(0.4+p0))* (3.0+p2*8.0));
    float hold = smoothstep(0.15,0.0,abs(fract(t*0.35)-0.08));
    a = exp(-d*(1.6-0.4*env))*(env*1.4+hold*0.2)*m;
    col = mix(uA,uB,env);
  } else if (k < 4.5) {
    float rate = 2.0+p0*14.0;
    float duty = clamp(p1,0.05,0.9);
    float ph = fract(t*rate);
    float on = step(ph, duty);
    a = exp(-d*1.8)*on*m*(0.7+p2);
    col = mix(uA,uB,step(0.5,fract(t*rate*0.5)));
  } else if (k < 5.5) {
    float g1 = exp(-d*1.1); float g2 = exp(-d*0.45); float g3 = exp(-d*0.18);
    a = (g1*0.7+g2*0.35+g3*0.15)*(0.3+m)*p0;
    col = mix(uA,uB,smoothstep(0.0,1.2,d));
  } else if (k < 6.5) {
    float br = 0.5+0.5*sin(t*6.2831*(0.06+p0*0.5));
    float inh = smoothstep(-0.2,1.0,sin(t*(0.4+p0)));
    a = exp(-d*(1.4-0.4*br))*(0.18+0.55*br)*m;
    col = mix(uA,uB,inh);
  } else if (k < 7.5) {
    float tail = exp(-fract(t*0.7)* (1.2+p2*4.0));
    a = exp(-d*1.3)*tail*m*(0.4+p0);
    col = mix(uB,uA,tail);
  } else if (k < 8.5) {
    a = 0.0;
    for (int i=0;i<6;i++) {
      float fi = float(i);
      float e = exp(-d*(1.5+fi*0.25))*exp(-fi*(0.35+p2))* (0.5+0.5*sin(t*4.0 - fi*(0.8+p0)));
      a += e;
    }
    a *= 0.35*m;
    col = mix(uA,uB,clamp(d,0.0,1.0));
  } else if (k < 9.5) {
    float dir = p2*6.2831;
    vec2 nrm = vec2(cos(dir),sin(dir));
    float sweep = fract(dot(p,nrm)*0.35 + t*(0.3+p0));
    float band = exp(-abs(sweep-0.5)* (14.0+p1*20.0));
    a = band*exp(-d*0.6)*m;
    col = mix(uA,uB,sweep);
  } else if (k < 10.5) {
    float cone = abs(ang);
    float pool = exp(-d*(1.8+p0*2.0));
    float focus = exp(-cone*(2.0+p2*6.0));
    a = pool*mix(1.0,focus,p1)*m*0.9;
    col = mix(uA,uB,d);
  } else if (k < 11.5) {
    float rad = 0.48 + 0.18*p0 + 0.12*sin(t*(0.6+uMid))*uBeat*0.15;
    float ring = abs(d-rad);
    float broken = 0.65 + 0.35*smoothstep(p2,1.2,abs(sin(ang*3.0+t*0.4)));
    float inner = exp(-max(d-rad,0.0)*6.0);
    a = (exp(-ring*(14.0+p1*22.0))*broken + inner*0.22 + exp(-d*4.0)*0.08)*m;
    col = mix(mix(uA,uB,smoothstep(0.2,0.9,d)), uC, exp(-ring*30.0));
  } else if (k < 12.5) {
    float rays = pow(abs(sin(ang*(4.0+floor(p0*16.0))+t*p2)), 10.0+p1*10.0);
    a = rays*exp(-d*1.3)*m;
    col = mix(uA,uB,rays);
  } else if (k < 13.5) {
    float shafts = pow(abs(sin(ang*3.0 + n2(p*2.0+t*0.2)*2.0)), 4.0);
    float haze = fbm(uv*3.0+t*0.05)*0.35;
    a = (shafts*0.7+haze)*exp(-d*0.55)*m*(0.4+p0);
    col = mix(uA,uB,haze);
  } else if (k < 14.5) {
    float core = exp(-d*8.0);
    float streak = exp(-abs(p.y)*20.0)*exp(-abs(p.x)*1.2);
    float ghost = 0.0;
    for (int i=1;i<=4;i++) {
      vec2 gp = p + normalize(p+vec2(0.001))*float(i)*(0.12+p1*0.1);
      ghost += exp(-length(gp)*10.0)* (0.18/float(i));
    }
    a = (core*1.2+streak*p0+ghost)*m;
    col = mix(uA,uB,core);
  } else if (k < 15.5) {
    float spikes = pow(abs(sin(ang*(3.0+floor(2.0+p0*14.0)))), 16.0+p1*20.0);
    float burst = exp(-fract(t*(1.0+p2))*4.0);
    a = (spikes*exp(-d*1.1)+exp(-d*6.0))*burst*m;
    col = mix(uA,uB,spikes);
  } else if (k < 16.5) {
    float path = abs(d-0.55);
    float segs = 6.0+floor(p2*10.0);
    float flow = fract(ang/6.2831*segs - t*(0.35+p0+uBeat*0.6)+fbm(p*2.0)*uMid);
    float coreLine = exp(-path*(10.0+p1*16.0));
    float pulse = exp(-abs(flow-0.5)*(18.0+p1*10.0));
    a = coreLine*(0.35+pulse)*m;
    col = mix(mix(uA,uB,flow), uC, pulse);
  } else if (k < 17.5) {
    float rip = 0.0; float hi=0.0;
    for (int i=0;i<6;i++) {
      float rad = fract(t*(0.18+p0+uBeat*0.25)+float(i)*(0.12+p2*0.08));
      float edge = abs(d-(0.15+rad*(0.25+p1)));
      float ring = exp(-edge*(14.0+18.0*(1.0-p2)));
      float turb = 1.0 + (fbm(p*4.0+t)-0.5)*uMid*0.6;
      rip += ring*turb*exp(-rad*1.6);
      hi += exp(-edge*40.0)*exp(-rad);
    }
    a = rip*m*0.55;
    col = mix(mix(uA,uB,d), uC, clamp(hi,0.0,1.0));
  } else if (k < 18.5) {
    float rad = fract(t*(1.1+p0*2.4)+uBeat*0.15);
    float edge = abs(d-rad*1.35);
    float ring = exp(-edge*(20.0+p2*28.0));
    float kick = exp(-rad*2.4)*(0.7+uBeat);
    float tail = exp(-max(rad*1.35-d,0.0)*3.0)*0.18*kick;
    a = (ring*1.3+tail)*kick*m;
    col = mix(mix(uA,uB,rad), uC, ring);
  } else if (k < 19.5) {
    float swirl = ang + t*(0.35+uMid*0.4) + fbm(p*1.8)*1.4;
    vec2 tp = vec2(cos(swirl),sin(swirl))*d;
    float mass = fbm(tp*(1.6+p0*2.0)+t*0.12);
    float tendN = 4.0+floor(p2*10.0);
    float tend = pow(abs(sin(ang*tendN + mass*5.0 + t*(0.7+uMid))), 2.2+p1);
    tend *= exp(-d*(0.9+0.4*(1.0-p1)));
    float core = exp(-d*(3.2-uBass*1.4-p0));
    float bloom = exp(-d*0.55)*0.28;
    float dissolve = smoothstep(1.15,0.35,d+mass*0.25);
    float spark = step(0.92, hash(floor(p*18.0)+floor(t*12.0)))*uHigh;
    a = (core*1.15 + tend*0.75*m + bloom*m + spark*0.35)*dissolve;
    col = mix(mix(uA,uB,mass), uC, clamp(core+spark,0.0,1.0));
    col = hueShift(col, uBeat*0.08);
  } else if (k < 20.5) {
    vec2 fp = p;
    fp += vec2(n2(p+t*0.07), n2(p.yx-t*0.06)-0.5)*(0.15+p2*0.4+uBass*0.2);
    float field = fbm(fp*(1.2+p0*3.2)+vec2(t*(0.16+p1), t*0.11));
    float fil = smoothstep(0.32,0.72,field)*smoothstep(0.88,0.52,field);
    fil = pow(fil, 0.65+p2*0.4);
    float spark = step(0.94, hash(floor(fp*22.0)+floor(t*16.0)))*uHigh;
    a = (fil*0.95 + field*0.18 + spark*0.4)*mix(0.55,1.0,m);
    col = mix(mix(uA,uB,field), uC, fil*0.7+spark);
    col = hueShift(col, t*0.03+uMid*0.05);
  } else {
    a = exp(-d*2.0)*(0.2+m);
    col = mix(uA,uB,0.5);
  }
  gl_FragColor = vec4(col, clamp(a*uInt,0.0,1.0));
}
`;

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
  lastW = 0;
  lastH = 0;
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
        const c3 = hex(e.color3 || "#c8f4ff");
        gl.uniform3f(gl.getUniformLocation(this.prog, "uC"), c3[0], c3[1], c3[2]);
        const q = project.quality === "Ultra" ? 3 : project.quality === "High" ? 2 : project.quality === "Medium" ? 1 : 0;
        gl.uniform1f(gl.getUniformLocation(this.prog, "uQ"), q);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uBass"), snap.bass);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uMid"), snap.mid);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uHigh"), snap.high);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uBeat"), snap.beat);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uKind"), KIND_INDEX[e.kind]);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uInt"), e.opacity);
        gl.uniform2f(gl.getUniformLocation(this.prog, "uOrigin"), ox, oy);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uRadius"), rad);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uP0"), e.p0 ?? 0.65);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uP1"), e.p1 ?? 0.5);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uP2"), e.p2 ?? 0.4);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
    this.lastW = w; this.lastH = h;
    this.frames++;
    const now = performance.now();
    if (now - this.lastFps > 500) { this.fps = this.frames * 1000 / (now - this.lastFps); this.frames = 0; this.lastFps = now; }
  }

  readCleanRgba(): { width: number; height: number; pixels: Uint8Array } | null {
    const gl = this.gl;
    const w = this.lastW || this.canvas.width;
    const h = this.lastH || this.canvas.height;
    if (w < 2 || h < 2) return null;
    const pixels = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { width: w, height: h, pixels };
  }
}

function hex(h: string): [number, number, number] {
  const n = (h || "#f4d27a").replace("#", "");
  return [parseInt(n.slice(0,2)||"f4",16)/255, parseInt(n.slice(2,4)||"d2",16)/255, parseInt(n.slice(4,6)||"7a",16)/255];
}
