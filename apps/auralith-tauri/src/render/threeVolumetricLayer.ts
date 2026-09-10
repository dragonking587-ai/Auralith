import * as THREE from "three";
import type { AudioSnapshot } from "../audio/engine";
import type { EffectInstance, EffectKind, Project, Region } from "../scene/types";

const VOLUME_KINDS = new Set<EffectKind>([
  "MagicEnergy", "Plasma", "VoidEnergy", "Portal", "Vortex", "SmokeFog", "Mist",
  "AtmosphericHaze", "Aurora", "CosmicNebula", "FrozenBreath", "SpectralAura"
]);

const MODE: Partial<Record<EffectKind, number>> = {
  MagicEnergy: 1, Plasma: 2, VoidEnergy: 3, Portal: 4, Vortex: 5, SmokeFog: 6,
  Mist: 7, AtmosphericHaze: 8, FrozenBreath: 9, Aurora: 10, CosmicNebula: 11, SpectralAura: 12,
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
  uniform float uTime, uMode, uP0, uP1, uP2, uDrive;
  uniform float uBass, uLow, uMid, uHigh, uBeat, uTransient, uOpacity, uQuality;
  uniform vec3 uColorA, uColorB, uColorC;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
  float noise2(vec2 p) {
    vec2 i=floor(p), f=fract(p);
    vec2 u=f*f*(3.0-2.0*f);
    float a=hash(i), b=hash(i+vec2(1.0,0.0)), c=hash(i+vec2(0.0,1.0)), d=hash(i+vec2(1.0,1.0));
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
  float softRing(float d, float r, float sharpness) { return exp(-abs(d-r)*sharpness); }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float d = length(p);
    float radial = 1.0 - smoothstep(0.08, 1.18, d);
    float edge = 1.0 - smoothstep(0.80, 1.12, d);
    float drive = clamp(uDrive, 0.0, 2.0);
    float alpha = 0.0;
    vec3 col = uColorA;

    if (uMode < 1.5) {
      // MAGIC ENERGY — dense plasma core, orbiting ribbons, shock rim and micro-arcs.
      vec2 q = warp(p*(1.55+uP0*1.5), uTime*0.20, 0.52+uP2*0.42+uMid*0.14);
      float a = fbm(q + vec2(0.0,-uTime*(0.14+uLow*0.08)));
      float b = fbm(q*2.55 + vec2(uTime*0.18,-uTime*0.07));
      float filament = pow(clamp(1.0-abs(a-b)*2.6,0.0,1.0), 5.0);
      float core = exp(-d*d*(4.0-uBass*0.85));
      float orbit = softRing(d, 0.43+uBass*0.07+sin(uTime*0.7)*0.018, 20.0+uP1*13.0);
      float micro = pow(max(0.0,noise2(q*(7.0+uQuality*2.0)+uTime)-0.72),3.0)*17.0*(0.18+uHigh);
      alpha=(filament*0.50+core*0.80+orbit*0.30+micro)*edge*(0.22+drive*0.58);
      col=mix(uColorB,uColorA,a); col=mix(col,uColorC,clamp(core*0.80+orbit*0.35+micro,0.0,1.0));
      col*=1.0+core*1.65+filament*0.78+uTransient*0.72;
    } else if (uMode < 2.5) {
      // PLASMA — continuously rolling cellular energy rather than a radial pulse.
      vec2 q=warp(p*(1.8+uP0*2.0),uTime*0.22,0.48+uP2*0.55+uMid*0.18);
      float n=fbm(q+vec2(uTime*0.11,-uTime*0.15));
      float cells=abs(sin((n+fbm(q*2.9))*8.0+uTime*(0.55+uP1)));
      float veins=pow(1.0-cells,3.5);
      float hot=pow(max(0.0,n-0.54),2.0)*3.4;
      alpha=(veins*0.62+hot*0.30+fbm(q*4.5)*0.10)*edge*(0.20+drive*0.54);
      col=mix(uColorB,uColorA,n); col=mix(col,uColorC,clamp(veins*0.65+uHigh*0.18,0.0,1.0));
      col*=1.0+veins*1.25+uBeat*0.24;
    } else if (uMode < 3.5) {
      // VOID ENERGY — light is eaten by the core while unstable tendrils orbit the horizon.
      float ang=atan(p.y,p.x);
      float horizon=softRing(d,0.48+uBass*0.045,28.0+uP1*18.0);
      float tendril=pow(0.5+0.5*sin(ang*(4.0+floor(uP2*6.0))+fbm(p*3.2)*5.0-uTime*(0.55+uP0)),5.0);
      float haze=fbm(warp(p*2.1,uTime*0.05,0.48));
      float blackCore=exp(-d*d*17.0);
      alpha=(horizon*0.82+tendril*radial*0.27+haze*edge*0.11)*(0.18+drive*0.50);
      alpha*=1.0-blackCore*0.68;
      col=mix(uColorB,uColorA,tendril); col=mix(col,uColorC,horizon*0.66);
      col*=1.0+horizon*1.5;
    } else if (uMode < 4.5) {
      // PORTAL — stable luminous ring with a separately rotating turbulent interior.
      float ang=atan(p.y,p.x);
      float r=0.50+uBass*0.045+uBeat*0.02;
      float rim=softRing(d,r,28.0+uP1*26.0);
      float innerMask=1.0-smoothstep(r*0.82,r,d);
      float swirl=ang+(3.2+uP0*3.8)*log(max(d,0.055))-uTime*(0.55+uP2*1.2);
      float flow=0.5+0.5*sin(swirl*3.0+fbm(p*3.6)*4.0);
      float depth=fbm(warp(p*3.0,uTime*0.06,0.34));
      alpha=(rim*0.95+innerMask*(flow*0.20+depth*0.12))*(0.20+drive*0.52);
      col=mix(uColorB,uColorA,flow); col=mix(col,uColorC,rim);
      col*=1.0+rim*1.9+uTransient*0.28;
    } else if (uMode < 5.5) {
      // VORTEX — multiple spiral arms accelerate toward a bright compressed center.
      float ang=atan(p.y,p.x);
      float swirl=ang+(4.5+uP0*5.0)*log(max(d,0.045))-uTime*(0.8+uP1*1.8);
      float arms=pow(0.5+0.5*sin(swirl*(2.0+floor(uP2*6.0))),4.0);
      float turbulence=fbm(warp(p*3.2,uTime*0.08,0.38));
      float center=exp(-d*d*(12.0-uBass*2.0));
      alpha=(arms*radial*0.42+turbulence*edge*0.10+center*0.42)*(0.18+drive*0.52);
      col=mix(uColorB,uColorA,arms); col=mix(col,uColorC,center*0.82);
      col*=1.0+center*1.6+arms*0.48;
    } else if (uMode < 6.5) {
      // SMOKE / FOG — buoyant rolling density with fine turbulent breakup.
      vec2 q=warp(p*0.88+vec2(0.0,-uTime*(0.045+uP0*0.065)),uTime*0.025,0.68+uP2*0.36);
      float broad=fbm(q*1.62);
      float detail=fbm(q*4.3+vec2(3.7,-uTime*0.10));
      float density=smoothstep(0.30,0.72,broad*0.74+detail*0.26);
      float plume=smoothstep(-1.12,0.78,-p.y+0.30)*(1.0-smoothstep(0.72,1.25,d));
      alpha=density*plume*(0.065+uP1*0.19)*(0.38+drive*0.42);
      col=mix(uColorB,uColorA,broad); col=mix(col,uColorC,detail*0.08);
    } else if (uMode < 7.5) {
      // MIST — broad horizontal sheets with slow parallax and very soft edges.
      vec2 q=p*vec2(0.52,0.82)+vec2(uTime*(0.020+uP0*0.035),sin(uTime*0.09)*0.05);
      float low=fbm(q*1.6);
      float second=fbm(q*2.7+vec2(11.0,-uTime*0.025));
      float sheet=smoothstep(0.34,0.68,low*0.68+second*0.32);
      float band=exp(-abs(p.y)*0.46);
      alpha=sheet*band*(0.045+uP1*0.14)*(0.38+drive*0.34);
      col=mix(uColorB,uColorA,low*0.55);
    } else if (uMode < 8.5) {
      // ATMOSPHERIC HAZE — low-contrast depth veil that breathes with low frequencies.
      vec2 q=p*0.42+vec2(uTime*0.012,-uTime*0.006);
      float n=fbm(q*1.55)+fbm(q*3.1+7.0)*0.34;
      float veil=smoothstep(0.25,0.83,n)*(0.62+uLow*0.18);
      alpha=veil*edge*(0.028+uP0*0.085)*(0.35+drive*0.28);
      col=mix(uColorB,uColorA,0.35+n*0.22);
    } else if (uMode < 9.5) {
      // FROZEN BREATH — expanding cold plume with crystalline high-frequency sparkle.
      vec2 q=warp(p*1.05+vec2(-uTime*(0.035+uP0*0.04),0.0),uTime*0.03,0.48+uP2*0.25);
      float cloud=fbm(q*2.1);
      float plume=(1.0-smoothstep(-0.85,0.78,p.x))*smoothstep(-1.0,0.9,p.x)*(1.0-smoothstep(0.82,1.25,d));
      float crystal=pow(max(0.0,noise2(q*9.0+uTime*0.20)-0.78),5.0)*48.0*(0.12+uHigh);
      alpha=(smoothstep(0.35,0.72,cloud)*0.20+crystal*0.10)*plume*(0.34+drive*0.38);
      col=mix(uColorB,uColorA,cloud); col=mix(col,uColorC,clamp(crystal,0.0,1.0));
      col*=1.0+crystal*0.45;
    } else if (uMode < 10.5) {
      // AURORA — vertically stretched emissive curtains with independent ribbon motion.
      vec2 q=warp(p*vec2(1.2,0.55)+vec2(uTime*(0.025+uP0*0.04),0.0),uTime*0.035,0.36+uP2*0.28);
      float base=fbm(q*1.5);
      float ribbons=pow(0.5+0.5*sin(q.x*(5.0+uP2*8.0)+base*4.5+uTime*(0.15+uP1*0.34)),5.0);
      float vertical=smoothstep(-1.0,-0.05,p.y)*(1.0-smoothstep(0.30,1.08,p.y));
      alpha=(base*0.10+ribbons*0.42)*vertical*(0.20+drive*0.42);
      col=mix(uColorA,uColorB,clamp(base+ribbons*0.25,0.0,1.0)); col=mix(col,uColorC,ribbons*uHigh*0.18);
      col*=1.0+ribbons*1.35;
    } else if (uMode < 11.5) {
      // COSMIC NEBULA — layered gaseous clouds, cavities and sparse star-forming knots.
      vec2 q=warp(p*(1.05+uP0*1.2)+vec2(uTime*0.018,-uTime*0.012),uTime*0.025,0.52+uP2*0.38);
      float cloud=fbm(q*1.42);
      float detail=fbm(q*3.7+vec2(-uTime*0.05,uTime*0.03));
      float cavity=abs(cloud-detail);
      float gas=smoothstep(0.22,0.78,cloud*0.72+detail*0.28)*(0.75-cavity*0.30);
      float stars=pow(max(0.0,noise2(q*14.0)-0.84),7.0)*145.0;
      alpha=(gas*0.28+stars)*edge*(0.16+drive*0.42);
      col=mix(uColorB,uColorA,cloud); col=mix(col,uColorC,clamp(stars+detail*0.10,0.0,1.0));
      col*=1.0+stars*1.9+gas*0.30;
    } else {
      // SPECTRAL AURA — living perimeter energy with drifting wisps and a luminous skin.
      vec2 q=warp(p*2.15,uTime*0.07,0.34+uP2*0.27+uMid*0.06);
      float w=fbm(q+uTime*0.04);
      float rim=softRing(d,0.50+uBass*0.05,18.0+uP1*14.0);
      float wisp=pow(clamp(w,0.0,1.0),3.0)*radial;
      float pulse=0.82+0.18*sin(uTime*(0.7+uP0)+w*3.0);
      alpha=(rim*0.68+wisp*0.31)*pulse*(0.18+drive*0.52);
      col=mix(uColorB,uColorA,w); col=mix(col,uColorC,rim*0.76);
      col*=1.0+rim*1.35+uHigh*wisp*0.18;
    }

    alpha *= uOpacity;
    if(alpha < 0.002) discard;
    gl_FragColor=vec4(max(col,vec3(0.0)),clamp(alpha,0.0,1.0));
  }
`;

type Envelope = { bass:number; low:number; mid:number; high:number; beat:number; transient:number; last:number };
type Entry = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  material: THREE.ShaderMaterial;
  env: Envelope;
  lastSeen: number;
};

function makeMaterial(kind: EffectKind) {
  const normalBlend = kind === "SmokeFog" || kind === "Mist" || kind === "AtmosphericHaze" || kind === "FrozenBreath";
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime:{value:0}, uMode:{value:MODE[kind]||1}, uP0:{value:0.65}, uP1:{value:0.5}, uP2:{value:0.4}, uDrive:{value:1},
      uBass:{value:0}, uLow:{value:0}, uMid:{value:0}, uHigh:{value:0}, uBeat:{value:0}, uTransient:{value:0}, uOpacity:{value:0.35}, uQuality:{value:1},
      uColorA:{value:new THREE.Color("#7ad0ff")}, uColorB:{value:new THREE.Color("#352060")}, uColorC:{value:new THREE.Color("#ffffff")},
    },
    transparent:true,
    blending: normalBlend ? THREE.NormalBlending : THREE.AdditiveBlending,
    depthTest:false,
    depthWrite:false,
    toneMapped:false,
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

function qualityValue(effect: EffectInstance, project: Project) {
  if (effect.realismQuality === "Cinematic") return 2;
  if (effect.realismQuality === "High") return 1.45;
  if (effect.realismQuality === "Performance") return 0.75;
  return project.quality === "Ultra" ? 2 : project.quality === "High" ? 1.45 : project.quality === "Medium" ? 1 : 0.72;
}

function smoothEnvelope(entry: Entry, effect: EffectInstance, snapshot: AudioSnapshot) {
  const now=performance.now()/1000;
  const dt=Math.max(0.001,Math.min(0.05,now-entry.env.last));
  entry.env.last=now;
  const response=Math.max(0.15,Number(effect.responseSpeed??1));
  const decay=Math.max(0.05,Number(effect.decay??0.7));
  const step=(cur:number,target:number,fast=1)=>{
    const tau=target>cur?0.028/(response*fast):(0.09+decay*0.55)/fast;
    return cur+(target-cur)*(1-Math.exp(-dt/Math.max(0.008,tau)));
  };
  const magic=effect.kind==="MagicEnergy";
  const bass=snapshot.bass*(magic?Number(effect.bassInfluence??1):1);
  const low=snapshot.low*(magic?Number(effect.lowMidPlasma??1):1);
  const mid=snapshot.mid*(magic?Number(effect.midMotion??1):1);
  const high=snapshot.high*(magic?Number(effect.highSparkDensity??1):1);
  const beat=snapshot.beat*(magic?Number(effect.beatPulse??0.8):1);
  const transient=snapshot.transient*(magic?Number(effect.transientStrength??1):1);
  entry.env.bass=step(entry.env.bass,Math.min(2,bass));
  entry.env.low=step(entry.env.low,Math.min(2,low));
  entry.env.mid=step(entry.env.mid,Math.min(2,mid));
  entry.env.high=step(entry.env.high,Math.min(2,high),1.25);
  entry.env.beat=step(entry.env.beat,Math.min(2,beat),1.5);
  entry.env.transient=step(entry.env.transient,Math.min(2,transient),1.8);
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
        this.updateEffect(region,effect,project,snapshot,width,height,viewport,time,colorOverrides);
      }
    }
    for(const [id,entry] of this.entries){
      if(entry.lastSeen===this.frame) continue;
      this.scene.remove(entry.mesh);
      entry.material.dispose();
      this.entries.delete(id);
    }
  }

  private updateEffect(region:Region,effect:EffectInstance,project:Project,snapshot:AudioSnapshot,width:number,height:number,viewport:{x:number;y:number;w:number;h:number},time:number,colorOverrides?:Record<string,string>){
    let entry=this.entries.get(effect.id);
    if(!entry){
      const material=makeMaterial(effect.kind);
      const mesh=new THREE.Mesh(this.geometry,material);
      mesh.frustumCulled=false;
      mesh.renderOrder=18;
      this.scene.add(mesh);
      entry={mesh,material,env:{bass:0,low:0,mid:0,high:0,beat:0,transient:0,last:performance.now()/1000},lastSeen:this.frame};
      this.entries.set(effect.id,entry);
    }
    entry.lastSeen=this.frame;
    smoothEnvelope(entry,effect,snapshot);

    const x=viewport.x+((region.x+(effect.offsetX||0))/project.width)*viewport.w;
    const y=viewport.y+((region.y+(effect.offsetY||0))/project.height)*viewport.h;
    const rx=Math.max(12,(effect.fxW||region.width||region.radius*2)/2*(viewport.w/project.width)*Math.max(0.05,effect.fxScaleX||effect.scale||region.sx||1));
    const ry=Math.max(12,(effect.fxH||region.height||region.radius*2)/2*(viewport.h/project.height)*Math.max(0.05,effect.fxScaleY||effect.scale||region.sy||1));
    entry.mesh.position.set((x/width)*2-1,1-(y/height)*2,0.08);
    entry.mesh.scale.set((rx/width)*2,(ry/height)*2,1);

    const u=entry.material.uniforms;
    u.uTime.value=time*effect.speed*project.masters.motion;
    u.uMode.value=MODE[effect.kind]||1;
    u.uP0.value=effect.p0??0.65;
    u.uP1.value=effect.p1??0.5;
    u.uP2.value=effect.p2??0.4;
    u.uDrive.value=drive(effect,snapshot,project);
    u.uBass.value=entry.env.bass;
    u.uLow.value=entry.env.low;
    u.uMid.value=entry.env.mid;
    u.uHigh.value=entry.env.high;
    u.uBeat.value=entry.env.beat;
    u.uTransient.value=entry.env.transient;
    u.uQuality.value=qualityValue(effect,project);
    u.uOpacity.value=Math.max(0,Math.min(1,effect.opacity*effect.brightness*project.masters.brightness*0.46));
    u.uColorA.value.set(colorOverrides?.[effect.id]||effect.color||"#7ad0ff");
    u.uColorB.value.set(effect.color2||"#352060");
    u.uColorC.value.set(effect.color3||"#ffffff");
  }

  dispose(){
    for(const entry of this.entries.values()) {
      this.scene.remove(entry.mesh);
      entry.material.dispose();
    }
    this.entries.clear();
    this.geometry.dispose();
  }
}
