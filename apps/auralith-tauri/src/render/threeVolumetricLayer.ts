import * as THREE from "three";
import type { AudioSnapshot } from "../audio/engine";
import type { EffectInstance, EffectKind, Project, Region } from "../scene/types";

const VOLUME_KINDS = new Set<EffectKind>([
  "MagicEnergy", "Plasma", "VoidEnergy", "Portal", "Vortex", "SmokeFog", "Mist",
  "AtmosphericHaze", "Aurora", "CosmicNebula", "FrozenBreath", "SpectralAura"
]);

const MODE: Partial<Record<EffectKind, number>> = {
  MagicEnergy: 1, Plasma: 1,
  VoidEnergy: 2, Portal: 2, Vortex: 2,
  SmokeFog: 3, Mist: 3, AtmosphericHaze: 3, FrozenBreath: 3,
  Aurora: 4, CosmicNebula: 4,
  SpectralAura: 5,
};

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uMode;
  uniform float uP0;
  uniform float uP1;
  uniform float uP2;
  uniform float uDrive;
  uniform float uBass;
  uniform float uLow;
  uniform float uMid;
  uniform float uHigh;
  uniform float uBeat;
  uniform float uTransient;
  uniform float uOpacity;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
  float noise2(vec2 p) {
    vec2 i=floor(p), f=fract(p);
    vec2 u=f*f*(3.0-2.0*f);
    float a=hash(i), b=hash(i+vec2(1.0,0.0)), c=hash(i+vec2(0.0,1.0)), d=hash(i+vec2(1.0));
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
  }
  float fbm(vec2 p) {
    float v=0.0, a=0.5;
    for(int i=0;i<5;i++) { v += noise2(p)*a; p=p*2.03+vec2(7.1,3.7); a*=0.5; }
    return v;
  }
  vec2 warp(vec2 p, float t, float amp) {
    float x=fbm(p*1.1+vec2(t*0.13,-t*0.09));
    float y=fbm(p*1.23+vec2(-t*0.11,t*0.15)+13.7);
    return p + (vec2(x,y)-0.5)*amp;
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float d = length(p);
    float radial = smoothstep(1.15, 0.12, d);
    float edge = 1.0 - smoothstep(0.78, 1.12, d);
    float drive = clamp(uDrive, 0.0, 2.0);
    float alpha = 0.0;
    vec3 col = uColorA;

    if (uMode < 1.5) {
      // Plasma/Magic: layered domain warping, energized filaments and hot core.
      vec2 q = warp(p*(1.8+uP0*1.8), uTime*0.18, 0.55+uP2*0.45+uMid*0.18);
      float n1 = fbm(q + vec2(0.0,-uTime*(0.12+uP1*0.22)));
      float n2 = fbm(q*2.5 + vec2(uTime*0.17,0.0));
      float filament = pow(clamp(1.0-abs(n1-n2)*2.5,0.0,1.0), 5.0);
      float core = exp(-d*d*(3.8-uBass*0.8));
      float ring = exp(-abs(d-(0.44+uBass*0.08+uBeat*0.04))*18.0);
      float spark = pow(max(0.0, noise2(q*7.0+uTime)-0.72), 3.0)*16.0*(0.3+uHigh);
      alpha = (filament*0.55 + core*0.78 + ring*0.28 + spark)*edge*(0.24+drive*0.58);
      col = mix(uColorB,uColorA,n1); col = mix(col,uColorC,clamp(core*0.8+spark,0.0,1.0));
      col *= 1.0 + core*1.5 + filament*0.8 + uTransient*0.65;
    } else if (uMode < 2.5) {
      // Void/Portal/Vortex: turbulent rotating structure with luminous rim.
      float ang=atan(p.y,p.x);
      float swirl=ang + (2.0+uP0*4.0)*log(max(d,0.055)) - uTime*(0.45+uP1*1.2);
      float arms=0.5+0.5*sin(swirl*(3.0+floor(uP2*5.0)) + fbm(p*3.0)*3.0);
      float rim=exp(-abs(d-(0.52+uBass*0.06))*24.0);
      float horizon=exp(-d*d*14.0);
      float turbulence=fbm(warp(p*3.0,uTime*0.07,0.45));
      alpha=(arms*0.30*radial + rim*0.92 + turbulence*0.13*edge)*(0.20+drive*0.52);
      col=mix(uColorB,uColorA,arms); col=mix(col,uColorC,rim);
      col*=1.0+rim*1.8+uBeat*0.38;
      alpha*=1.0-horizon*0.62;
    } else if (uMode < 3.5) {
      // Smoke/Mist/Frozen breath: broad low-frequency density with rolling curls.
      vec2 q=warp(p*0.92+vec2(uTime*(0.025+uP0*0.045),-uTime*0.035),uTime*0.025,0.65+uP2*0.35);
      float broad=fbm(q*1.75);
      float detail=fbm(q*4.2+vec2(4.2,-uTime*0.08));
      float density=smoothstep(0.30,0.72,broad*0.72+detail*0.28);
      float plume=smoothstep(-1.05,0.55,-p.y+0.35)*(1.0-smoothstep(0.58,1.2,d));
      alpha=density*plume*(0.07+uP1*0.20)*(0.4+drive*0.42);
      col=mix(uColorB,uColorA,broad); col=mix(col,uColorC,detail*0.15);
    } else if (uMode < 4.5) {
      // Aurora/Nebula: multi-scale emissive curtains and star-forming density.
      vec2 q=warp(p*vec2(1.35,0.85)+vec2(uTime*0.035,0.0),uTime*0.04,0.42+uP2*0.36);
      float cloud=fbm(q*(1.45+uP0*1.35));
      float detail=fbm(q*4.3+vec2(-uTime*0.08,uTime*0.04));
      float curtain=pow(0.5+0.5*sin(q.x*(5.0+uP2*7.0)+cloud*5.0+uTime*(0.14+uP1*0.3)),4.0);
      float stars=pow(max(0.0,noise2(q*13.0)-0.82),7.0)*110.0;
      alpha=(cloud*0.20+curtain*0.30+stars)*(0.18+drive*0.44)*edge;
      col=mix(uColorA,uColorB,clamp(cloud+curtain*0.35,0.0,1.0)); col=mix(col,uColorC,clamp(stars+uHigh*curtain*0.28,0.0,1.0));
      col*=1.0+curtain*1.15+stars*1.8;
    } else {
      // Spectral aura: layered edge energy and slow organic wisps.
      vec2 q=warp(p*2.2,uTime*0.07,0.35+uP2*0.25);
      float w=fbm(q+uTime*0.04);
      float rim=exp(-abs(d-(0.50+uBass*0.05))*18.0);
      float wisp=pow(clamp(w,0.0,1.0),3.0)*radial;
      alpha=(rim*0.65+wisp*0.32)*(0.18+drive*0.52);
      col=mix(uColorB,uColorA,w); col=mix(col,uColorC,rim*0.72);
      col*=1.0+rim*1.25;
    }

    alpha *= uOpacity;
    if(alpha < 0.002) discard;
    gl_FragColor=vec4(max(col,vec3(0.0)),clamp(alpha,0.0,1.0));
  }
`;

type Entry = { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; material: THREE.ShaderMaterial; lastSeen: number };

function makeMaterial(kind: EffectKind) {
  const smokeLike = kind === "SmokeFog" || kind === "Mist" || kind === "AtmosphericHaze" || kind === "FrozenBreath";
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime:{value:0},uMode:{value:MODE[kind]||1},uP0:{value:0.65},uP1:{value:0.5},uP2:{value:0.4},uDrive:{value:1},
      uBass:{value:0},uLow:{value:0},uMid:{value:0},uHigh:{value:0},uBeat:{value:0},uTransient:{value:0},uOpacity:{value:0.35},
      uColorA:{value:new THREE.Color("#7ad0ff")},uColorB:{value:new THREE.Color("#352060")},uColorC:{value:new THREE.Color("#ffffff")},
    },
    transparent:true,
    blending: smokeLike ? THREE.NormalBlending : THREE.AdditiveBlending,
    depthTest:false,depthWrite:false,toneMapped:false,
  });
}

function band(snapshot: AudioSnapshot, name: string) {
  switch(name){
    case "Raw": return snapshot.raw; case "Bass": return snapshot.bass; case "Low": return snapshot.low;
    case "Mid": return snapshot.mid; case "High": return snapshot.high; case "FullMix": return snapshot.fullMix;
    case "Beat": return snapshot.beat; case "Transient": return snapshot.transient; default: return 1;
  }
}

function drive(effect: EffectInstance, snapshot: AudioSnapshot, project: Project) {
  const selected=effect.audio==="Manual"?1:band(snapshot,effect.audio);
  const m=effect.audio==="Manual"?effect.intensity:effect.intensity*(1-effect.audioInfluence+effect.audioInfluence*selected);
  return m*project.masters.intensity;
}

export class ThreeVolumetricLayer {
  private entries=new Map<string,Entry>();
  private geometry=new THREE.PlaneGeometry(2,2,1,1);
  private frame=0;
  constructor(private scene:THREE.Scene){}

  update(project:Project,snapshot:AudioSnapshot,width:number,height:number,viewport:{x:number;y:number;w:number;h:number},colorOverrides?:Record<string,string>){
    this.frame++;
    const time=performance.now()/1000;
    for(const region of project.regions){
      for(const effect of region.effects){
        if(!effect.enabled||!VOLUME_KINDS.has(effect.kind)) continue;
        // Trace/path effects continue to use the exact rc.49 SDF renderer until
        // the Three path-mask module is migrated. Point/shape volumes can use
        // this dedicated cinematic layer immediately without changing projects.
        if(region.kind==="Trace" && (effect.geomMode||"path")!=="point") continue;
        this.updateEffect(region,effect,project,snapshot,width,height,viewport,time,colorOverrides);
      }
    }
    for(const [id,entry] of this.entries){
      if(entry.lastSeen===this.frame) continue;
      this.scene.remove(entry.mesh); entry.material.dispose(); this.entries.delete(id);
    }
  }

  private updateEffect(region:Region,effect:EffectInstance,project:Project,snapshot:AudioSnapshot,width:number,height:number,viewport:{x:number;y:number;w:number;h:number},time:number,colorOverrides?:Record<string,string>){
    let entry=this.entries.get(effect.id);
    if(!entry){
      const material=makeMaterial(effect.kind);
      const mesh=new THREE.Mesh(this.geometry,material); mesh.frustumCulled=false; mesh.renderOrder=18;
      this.scene.add(mesh); entry={mesh,material,lastSeen:this.frame}; this.entries.set(effect.id,entry);
    }
    entry.lastSeen=this.frame;
    const x=viewport.x+((region.x+(effect.offsetX||0))/project.width)*viewport.w;
    const y=viewport.y+((region.y+(effect.offsetY||0))/project.height)*viewport.h;
    const rx=Math.max(12,(effect.fxW||region.width||region.radius*2)/2*(viewport.w/project.width)*Math.max(0.05,effect.fxScaleX||effect.scale||region.sx||1));
    const ry=Math.max(12,(effect.fxH||region.height||region.radius*2)/2*(viewport.h/project.height)*Math.max(0.05,effect.fxScaleY||effect.scale||region.sy||1));
    entry.mesh.position.set((x/width)*2-1,1-(y/height)*2,0.08);
    entry.mesh.scale.set((rx/width)*2,(ry/height)*2,1);
    const u=entry.material.uniforms;
    u.uTime.value=time*effect.speed*project.masters.motion; u.uMode.value=MODE[effect.kind]||1;
    u.uP0.value=effect.p0??0.65;u.uP1.value=effect.p1??0.5;u.uP2.value=effect.p2??0.4;u.uDrive.value=drive(effect,snapshot,project);
    u.uBass.value=snapshot.bass;u.uLow.value=snapshot.low;u.uMid.value=snapshot.mid;u.uHigh.value=snapshot.high;u.uBeat.value=snapshot.beat;u.uTransient.value=snapshot.transient;
    u.uOpacity.value=Math.max(0,Math.min(1,effect.opacity*effect.brightness*0.42));
    u.uColorA.value.set(colorOverrides?.[effect.id]||effect.color||"#7ad0ff");u.uColorB.value.set(effect.color2||"#352060");u.uColorC.value.set(effect.color3||"#ffffff");
  }

  dispose(){
    for(const e of this.entries.values()) e.material.dispose(); this.entries.clear(); this.geometry.dispose();
  }
}
