import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const rendererPath = path.join(root, "src", "render", "renderer.ts");

let source = fs.readFileSync(rendererPath, "utf8");
const crlf = source.includes("\r\n");
source = source.replace(/\r\n/g, "\n");

const MARKER = "RC49_2_ENGINE_UPGRADE";
if (source.includes(MARKER)) {
  console.log("[rc.49.2 engine] renderer already upgraded");
  process.exit(0);
}

function mustReplace(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`[rc.49.2 engine] missing ${label}`);
  return text.replace(from, to);
}

function replaceBranch(text, kind, body) {
  const next = kind + 1;
  const re = new RegExp(`\\n  \\} else if \\(k < ${kind}\\.5\\) \\{[\\s\\S]*?\\n  \\} else if \\(k < ${next}\\.5\\) \\{`);
  if (!re.test(text)) throw new Error(`[rc.49.2 engine] could not locate shader branch ${kind}`);
  return text.replace(re, `\n  } else if (k < ${kind}.5) {\n${body}\n  } else if (k < ${next}.5) {`);
}

const helpers = `// ${MARKER}: renderer-only realism helpers. UI/layout/assets are intentionally untouched.\nfloat h1(float n){ return fract(sin(n*91.713+17.17)*43758.5453123); }\nfloat sdSeg(vec2 p0, vec2 a0, vec2 b0){ vec2 pa=p0-a0, ba=b0-a0; float den=max(dot(ba,ba),0.00001); float h=clamp(dot(pa,ba)/den,0.0,1.0); return length(pa-ba*h); }\nfloat softDot(vec2 q, float sharp){ return exp(-dot(q,q)*sharp); }\nvec2 flowWarp(vec2 q, float tt, float amount){ float e=0.035; float nx=fbm(q+vec2(e,0.0)+tt)-fbm(q-vec2(e,0.0)+tt); float ny=fbm(q+vec2(0.0,e)-tt)-fbm(q-vec2(0.0,e)-tt); return q+vec2(ny,-nx)*amount; }`;
source = mustReplace(
  source,
  'vec3 hueShift(vec3 c, float h){ return mix(c, vec3(c.g, c.b, c.r), clamp(abs(h)*2.0, 0.0, 1.0)); }',
  'vec3 hueShift(vec3 c, float h){ return mix(c, vec3(c.g, c.b, c.r), clamp(abs(h)*2.0, 0.0, 1.0)); }\n' + helpers,
  "shader helper insertion point"
);

source = replaceBranch(source, 25, `    // Energy sparks: short-lived electrical filaments, not generic dots.\n    float energy = 0.0; float hot = 0.0;\n    for(int i=0;i<12;i++){\n      float fi=float(i); float age=fract(t*(0.42+p0*0.85)+h1(fi*7.31));\n      float ang0=6.2831853*h1(fi*11.7+3.0); float spd=0.35+0.75*h1(fi*4.17+9.0);\n      vec2 vel=vec2(cos(ang0),sin(ang0))*spd;\n      vec2 cur=vel*age + vec2(0.0,-0.12*age*age);\n      vec2 prv=vel*max(age-0.08,0.0) + vec2(0.0,-0.12*max(age-0.08,0.0)*max(age-0.08,0.0));\n      float life=(1.0-age)*(1.0-age); float trail=exp(-sdSeg(p,prv,cur)*(72.0+p1*90.0))*life;\n      float core=softDot(p-cur,620.0)*life; energy+=trail*0.72+core*1.35; hot+=core;\n    }\n    a=energy*m*(0.45+uHigh*0.55+uTransient*0.45);\n    col=mix(mix(uB,uA,0.62),uC,clamp(hot,0.0,1.0));`);

source = replaceBranch(source, 27, `    // Natural lightning: leader path, forks, return stroke and afterglow.\n    float sid=floor(t*(1.2+p0*2.2)); float age=fract(t*(1.2+p0*2.2));\n    float yv=clamp((p.y+1.25)/2.5,0.0,1.0);\n    float coarse=(n2(vec2(floor(yv*14.0),sid*1.73))-0.5)*(0.34+p2*0.34);\n    float fine=(n2(vec2(floor(yv*46.0),sid*4.11+7.0))-0.5)*(0.08+p2*0.12);\n    float center=coarse+fine; float dist=abs(p.x-center);\n    float core=exp(-dist*(115.0+p1*120.0)); float corona=exp(-dist*(16.0+p1*18.0));\n    float ay=0.12+0.55*h1(sid+2.0); float ax=(n2(vec2(floor(ay*14.0),sid*1.73))-0.5)*(0.34+p2*0.34);\n    float dir=mix(-1.0,1.0,step(0.5,h1(sid+9.0)));\n    vec2 ba=vec2(ax,ay*2.5-1.25), bb=ba+vec2(dir*(0.28+0.45*h1(sid+6.0)),0.38+0.48*h1(sid+12.0));\n    float fork=exp(-sdSeg(p,ba,bb)*(72.0+p1*90.0));\n    float flash=exp(-age*24.0)+0.52*exp(-abs(age-0.075)*88.0)+0.22*exp(-abs(age-0.145)*72.0);\n    float after=exp(-age*5.2)*0.16;\n    a=(core*1.55+corona*0.42+fork*0.72)*(flash+after)*(0.52+m*0.72);\n    col=mix(mix(uA,uB,0.38),uC,clamp(core+fork*0.7,0.0,1.0));`);

source = replaceBranch(source, 28, `    // Electric crawl follows the selected edge/path with travelling micro-arcs.\n    float pathv=uUseSdf>0.5?along:(ang/6.2831853+0.5);\n    float edge=uUseSdf>0.5?exp(-abs(d)*(58.0+p1*70.0)):exp(-abs(d-0.55)*(55.0+p1*70.0));\n    float phase=fract(pathv*(5.0+p2*13.0)-t*(0.45+p0*2.2));\n    float packet=exp(-abs(phase-0.5)*(16.0+p2*25.0));\n    float jitter=0.55+0.45*n2(vec2(floor(pathv*70.0),floor(t*18.0)));\n    float filament=edge*(0.16+packet*1.25)*jitter;\n    a=filament*m*(0.45+uHigh*0.7+uTransient*0.3);\n    col=mix(uA,uC,clamp(packet*0.9,0.0,1.0));`);

source = replaceBranch(source, 31, `    // Layered flame body with domain-warped tongues, hot core and audio-fed turbulence.\n    vec2 fp=p; fp.y+=0.28;\n    vec2 wp=flowWarp(fp*vec2(1.25,0.88)+vec2(0.0,-t*0.34),t*0.055,0.24+p2*0.18+uMid*0.09);\n    float yn=clamp((fp.y+1.05)/2.2,0.0,1.0); float taper=0.78*(1.0-yn*0.78);\n    float n=fbmQ(wp*3.25+vec2(0.0,-t*0.42),2.0+p2*1.5);\n    float nFine=fbm(wp*7.0+vec2(4.0,-t*0.8));\n    float edge=taper-abs(fp.x+(n-0.5)*(0.32+p2*0.2));\n    float body=smoothstep(-0.12,0.08,edge+0.12*nFine)*(1.0-smoothstep(0.74,1.08,yn));\n    float tongues=smoothstep(0.34,0.82,n)*smoothstep(0.02,0.42,edge+0.18)*(1.0-yn);\n    float hotcore=smoothstep(0.06,0.34,edge)*smoothstep(0.48,0.95,1.0-yn);\n    float flick=0.82+0.18*n2(vec2(floor(t*18.0),3.7));\n    a=(body*0.72+tongues*0.58+hotcore*0.5)*flick*(0.42+m*0.62+uBass*0.16);\n    col=mix(uB,uA,clamp(1.0-yn+n*0.22,0.0,1.0)); col=mix(col,uC,hotcore*0.72);`);

source = replaceBranch(source, 32, `    // Embers rise buoyantly, drift in turbulence and cool during their lifetime.\n    float glow=0.0; float heat=0.0;\n    for(int i=0;i<14;i++){ float fi=float(i); float age=fract(t*(0.12+p0*0.28)+h1(fi*13.1));\n      float sx=(h1(fi*7.7)-0.5)*1.35; float rise=-1.0+age*2.15;\n      float drift=sin(age*8.0+fi*2.1)*0.09+(h1(fi*5.2)-0.5)*p2*0.22;\n      vec2 q=p-vec2(sx+drift,rise); float life=sin(3.14159*age);\n      float c=softDot(q,700.0)*life; float halo=softDot(q,105.0)*life; glow+=c+halo*0.28; heat+=c*(1.0-age); }\n    a=glow*m*(0.34+uBass*0.28+uHigh*0.24); col=mix(uB,uA,clamp(heat,0.0,1.0)); col=mix(col,uC,clamp(heat*0.55,0.0,1.0));`);

source = replaceBranch(source, 33, `    // Sparks use ballistic trajectories, gravity, incandescent cores and short luminous trails.\n    float sparks=0.0; float sparkHot=0.0;\n    for(int i=0;i<16;i++){ float fi=float(i); float age=fract(t*(0.3+p0*0.75)+h1(fi*9.31));\n      float theta=mix(-2.85,-0.30,h1(fi*4.91+2.0)); float dir=h1(fi*3.2)>0.5?1.0:-1.0;\n      vec2 v=vec2(cos(theta)*dir, -sin(theta))*(0.46+0.75*h1(fi*6.7+8.0));\n      vec2 cur=v*age+vec2(0.0,-0.72*age*age); float pa=max(age-0.095,0.0); vec2 prv=v*pa+vec2(0.0,-0.72*pa*pa);\n      float life=(1.0-age)*(1.0-age); float line=exp(-sdSeg(p,prv,cur)*(92.0+p1*95.0))*life; float c=softDot(p-cur,850.0)*life;\n      sparks+=line*0.9+c*1.45; sparkHot+=c; }\n    a=sparks*m*(0.42+uTransient*0.72+uHigh*0.34); col=mix(uA,uB,0.24); col=mix(col,uC,clamp(sparkHot*1.2,0.0,1.0));`);

source = replaceBranch(source, 35, `    // Smoke rolls upward in layered turbulent density instead of a flat translucent cloud.\n    vec2 sp=flowWarp(p*0.72+vec2(0.0,-t*(0.055+p0*0.08)),t*0.025,0.34+p2*0.26);\n    float low=fbmQ(sp*2.15,2.0); float detail=fbm(sp*5.1+vec2(4.0,-t*0.12));\n    float plume=smoothstep(0.28,0.76,low*0.78+detail*0.22)*exp(-abs(p.x)*0.42);\n    float base=exp(-max(p.y+0.65,0.0)*0.52); a=plume*base*(0.16+0.48*p0)*m;\n    col=mix(uA,uB,clamp(detail*0.45,0.0,1.0));`);

source = replaceBranch(source, 36, `    // Mist is broad, low-frequency and horizontally drifting with soft density pockets.\n    vec2 mp=p*0.48+vec2(t*(0.028+p0*0.055),sin(t*0.08)*0.08);\n    float layer1=fbmQ(mp*2.0,1.5); float layer2=fbmQ(mp*3.1+11.0,1.0);\n    float mist=smoothstep(0.30,0.72,layer1*0.66+layer2*0.34);\n    a=mist*(0.10+0.34*p1)*m*exp(-abs(p.y)*0.34); col=mix(uA,uB,layer2*0.28);`);

source = replaceBranch(source, 50, `    // Rain: depth-varied slanted streaks with intermittent bright droplets.\n    float rain=0.0;\n    for(int i=0;i<18;i++){ float fi=float(i); float lane=(h1(fi*4.7)-0.5)*2.8; float speed=0.75+1.25*h1(fi*8.2+2.0);\n      float yy=1.45-mod(t*speed+h1(fi*3.3)*3.0,3.0); float wind=(p2-0.5)*0.42; vec2 a0=vec2(lane+wind*yy,yy); vec2 b0=a0+vec2(-wind*0.16,-(0.16+p1*0.25));\n      float streak=exp(-sdSeg(p,a0,b0)*(115.0+p1*100.0)); rain+=streak*(0.35+0.65*h1(fi*6.1)); }\n    a=rain*(0.20+p1*0.11)*m*(0.55+uHigh*0.4); col=mix(uA,uC,0.22);`);

source = replaceBranch(source, 52, `    // Snow: independently drifting flakes with depth, soft bloom and non-uniform fall speeds.\n    float snow=0.0;\n    for(int i=0;i<16;i++){ float fi=float(i); float z=0.35+0.65*h1(fi*9.9); float yy=1.35-mod(t*(0.08+p0*0.22)*z+h1(fi*2.2)*2.7,2.7);\n      float xx=(h1(fi*4.3)-0.5)*2.65+sin(t*(0.24+z*0.3)+fi)*0.12*p2; vec2 q=p-vec2(xx,yy);\n      snow+=softDot(q,180.0+z*650.0)*(0.28+0.72*z); }\n    a=snow*m*(0.34+p1*0.25); col=mix(uA,uC,0.45);`);

source = replaceBranch(source, 53, `    // Ash: irregular, slowly tumbling flakes carried by convection.\n    float ash=0.0;\n    for(int i=0;i<14;i++){ float fi=float(i); float age=fract(t*(0.055+p0*0.16)+h1(fi*4.2)); float yy=-1.25+age*2.55;\n      float xx=(h1(fi*8.7)-0.5)*2.35+sin(t*0.45+fi*1.7)*0.18*(0.4+p2); vec2 q=p-vec2(xx,yy);\n      float tumble=0.28+0.72*abs(sin(t*(1.0+h1(fi)*2.0)+fi)); ash+=softDot(q*vec2(0.72,1.5),310.0)*tumble*sin(3.14159*age); }\n    a=ash*m*(0.22+p1*0.28); col=mix(uA,uB,0.22);`);

source = replaceBranch(source, 54, `    // Dust motes: slow suspended particles with depth shimmer, not falling snow.\n    float dust=0.0;\n    for(int i=0;i<12;i++){ float fi=float(i); float xx=(h1(fi*3.1)-0.5)*2.4+sin(t*0.12+fi)*0.15; float yy=(h1(fi*7.2)-0.5)*2.0+cos(t*0.09+fi*1.4)*0.12;\n      float tw=0.38+0.62*pow(0.5+0.5*sin(t*(0.7+h1(fi)*1.8)+fi*2.2),6.0); dust+=softDot(p-vec2(xx,yy),260.0+500.0*h1(fi+4.0))*tw; }\n    a=dust*m*(0.18+p1*0.25); col=mix(uA,uC,0.28);`);

source = replaceBranch(source, 55, `    // Aurora curtains: vertically stretched, folded ribbons with layered color and slow organic drift.\n    vec2 ap=flowWarp(p*vec2(0.62,0.34)+vec2(t*(0.018+p0*0.035),0.0),t*0.012,0.22+p2*0.18);\n    float fold=sin(ap.x*7.0+fbm(ap*2.4)*4.0+t*0.16); float ribbon=pow(max(0.0,0.5+0.5*fold),3.2);\n    float veil=smoothstep(0.15,0.82,fbmQ(ap*2.2+9.0,2.0)); float vertical=exp(-abs(p.y)*0.55);\n    a=(ribbon*0.58+veil*0.25)*vertical*m*(0.32+uMid*0.28); col=mix(uA,uB,clamp(0.5+0.5*fold,0.0,1.0)); col=mix(col,uC,ribbon*0.18);`);

source = replaceBranch(source, 56, `    // Atmospheric haze: broad depth falloff and gently advected density variation.\n    vec2 hp=p*0.31+vec2(t*(0.012+p0*0.025),-t*0.006); float hz=fbmQ(hp*2.0,1.5);\n    float depth=exp(-d*(0.28+p1*0.32)); a=smoothstep(0.24,0.78,hz)*depth*m*(0.10+0.28*p0); col=mix(uA,uB,hz*0.22);`);

source = replaceBranch(source, 58, `    // Caustics: moving intersecting light ridges instead of a generic wave texture.\n    vec2 cp=flowWarp(p*1.35+vec2(t*0.10,-t*0.07),t*0.02,0.18+p2*0.18);\n    float c1=abs(sin(cp.x*8.5+sin(cp.y*5.2+t*0.4))); float c2=abs(sin(cp.y*9.2+sin(cp.x*4.7-t*0.33)));\n    float ridge=pow(1.0-min(c1,c2),7.0+p1*7.0); a=ridge*m*(0.28+uHigh*0.3); col=mix(uA,uC,ridge*0.65);`);

source = replaceBranch(source, 59, `    // Water ripples: multiple decaying rings with subtle turbulence and highlight/underside separation.\n    float rip=0.0; float hi=0.0;\n    for(int i=0;i<5;i++){ float fi=float(i); float age=fract(t*(0.12+p0*0.34)+fi*0.19); float rr=age*(0.35+p1*1.15);\n      float wob=(fbm(p*3.0+fi*4.0+t*0.08)-0.5)*0.06*p2; float edge=abs(d+wob-rr); float ring=exp(-edge*(45.0+p1*45.0))*exp(-age*1.8); rip+=ring; hi+=exp(-edge*95.0)*exp(-age*2.2); }\n    a=rip*m*(0.32+uBeat*0.18); col=mix(uA,uB,clamp(rip*0.35,0.0,1.0)); col=mix(col,uC,clamp(hi*0.5,0.0,1.0));`);

source = replaceBranch(source, 61, `    // Frost grows from edges as branching crystalline veins with granular ice fill.\n    float edge=uUseSdf>0.5?exp(-abs(d)*(14.0+p0*22.0)):exp(-abs(d-0.72)*(12.0+p0*20.0));\n    float crystal=pow(abs(sin(ang*(6.0+floor(p2*10.0))+fbm(p*4.2)*5.0)),10.0); float grain=fbm(p*18.0);\n    a=(edge*(0.42+crystal*0.8)+smoothstep(0.72,0.92,grain)*0.16)*m; col=mix(uB,uC,0.55+0.35*crystal);`);

source = replaceBranch(source, 62, `    // Crystal growth: faceted radial shards with staged extension and bright leading tips.\n    float growth=clamp(fract(t*(0.06+p0*0.15))*1.35,0.0,1.0); float facets=5.0+floor(p2*13.0);\n    float ray=pow(abs(cos(ang*facets)),20.0+p1*18.0); float body=ray*step(d,growth*(0.45+p1*0.7))*exp(-d*0.8);\n    float tip=ray*exp(-abs(d-growth*(0.45+p1*0.7))*48.0); a=(body*0.45+tip*1.1)*m; col=mix(uB,uC,clamp(tip,0.0,1.0));`);

source = replaceBranch(source, 63, `    // Ice shimmer: thin moving specular highlights over a cold translucent field.\n    float grain=fbm(p*9.0); float spec=pow(max(0.0,sin((p.x+p.y*0.55)*18.0+t*(0.5+p0*1.7)+grain*4.0)),18.0+p1*16.0);\n    float base=exp(-d*0.75)*0.12; a=(base+spec*(0.32+p2*0.5))*m; col=mix(uB,uC,0.45+0.5*spec);`);

source = replaceBranch(source, 64, `    // Frozen breath: discrete soft puffs that curl, expand and dissipate.\n    float breath=0.0;\n    for(int i=0;i<6;i++){ float fi=float(i); float age=fract(t*(0.10+p0*0.22)+fi*0.17); vec2 c=vec2(-0.65+age*1.2, (h1(fi)-0.5)*0.42+sin(age*5.0+fi)*0.1*p2);\n      float radius=0.05+age*(0.18+p1*0.22); float q=length(p-c)/radius; breath+=exp(-q*q*1.7)*(1.0-age)*(0.5+0.5*h1(fi+2.0)); }\n    a=breath*m*0.34; col=mix(uA,uC,0.48);`);

source = replaceBranch(source, 65, `    // Fireflies: organic wandering agents with asynchronous bioluminescent blink envelopes.\n    float flies=0.0; float cores=0.0;\n    for(int i=0;i<12;i++){ float fi=float(i); float sx=(h1(fi*2.3)-0.5)*1.9; float sy=(h1(fi*5.1)-0.5)*1.45;\n      float wx=sin(t*(0.18+0.24*h1(fi+1.0))+fi*1.91)*0.22+sin(t*0.07+fi)*0.08; float wy=cos(t*(0.16+0.27*h1(fi+4.0))+fi*1.27)*0.18;\n      vec2 q=p-vec2(sx+wx,sy+wy); float blink=pow(max(0.0,0.5+0.5*sin(t*(0.7+1.1*h1(fi+8.0))+fi*2.17)),7.0);\n      float core=softDot(q,1100.0)*blink; float halo=softDot(q,95.0)*blink; flies+=core+halo*0.32; cores+=core; }\n    a=flies*m*(0.24+0.55*p2+uHigh*0.12); col=mix(uA,uB,0.24); col=mix(col,uC,clamp(cores,0.0,1.0));`);

source = replaceBranch(source, 66, `    // Bioluminescent spores drift as a denser, softer volumetric swarm with slow pulses.\n    float spores=0.0;\n    for(int i=0;i<16;i++){ float fi=float(i); float age=fract(t*(0.035+p0*0.11)+h1(fi*4.4)); float xx=(h1(fi*3.7)-0.5)*2.2+sin(t*0.15+fi)*0.16; float yy=-1.1+age*2.25+cos(t*0.12+fi*1.3)*0.1;\n      float pulse=0.35+0.65*pow(0.5+0.5*sin(t*(0.35+h1(fi)*0.75)+fi),4.0); spores+=softDot(p-vec2(xx,yy),190.0+350.0*h1(fi+7.0))*pulse; }\n    a=spores*m*(0.20+p1*0.28); col=mix(uA,uB,0.45+0.25*sin(t*0.08));`);

source = replaceBranch(source, 69, `    // Shadow tendrils: multiple curling filaments that grow outward rather than a single radial blob.\n    float tend=0.0;\n    for(int i=0;i<7;i++){ float fi=float(i); float dir=-1.0+2.0*h1(fi*5.2); float len=0.25+0.75*fract(t*(0.08+p0*0.22)+h1(fi*3.7));\n      float yy=mix(-0.8,0.8,h1(fi*8.1)); vec2 a0=vec2(0.0,yy*0.35); vec2 b0=vec2(dir*len,yy+sin(t*0.3+fi)*0.22*p2);\n      tend+=exp(-sdSeg(p,a0,b0)*(20.0+p1*38.0))*exp(-length(p)*0.22); }\n    a=tend*m*0.28; col=mix(uA,vec3(0.0),0.62);`);

source = replaceBranch(source, 79, `    // Celestial stars: depth-layered field with rare bright stars and independent twinkle.\n    vec2 cell=floor((p+2.0)*vec2(28.0,18.0)); vec2 local=fract((p+2.0)*vec2(28.0,18.0))-0.5; float seed=hash(cell);\n    float exists=step(0.84-p0*0.08,seed); vec2 ofs=vec2(hash(cell+3.1)-0.5,hash(cell+7.7)-0.5)*0.5;\n    float tw=0.42+0.58*pow(0.5+0.5*sin(t*(0.5+hash(cell+9.0)*2.0)+seed*40.0),8.0);\n    float star=softDot(local-ofs,160.0)*exists*tw; float cross=(exp(-abs((local-ofs).x)*70.0)+exp(-abs((local-ofs).y)*70.0))*star*0.22;\n    a=(star+cross)*m*(0.34+p1*0.5); col=mix(uA,uC,clamp(star,0.0,1.0));`);

source = replaceBranch(source, 80, `    // Cosmic nebula: multi-scale domain-warped gas, dark lanes and embedded luminous knots.\n    vec2 np=flowWarp(p*0.58+vec2(t*0.009,-t*0.006),t*0.008,0.48+p2*0.35);\n    float gas=fbmQ(np*2.3,3.0); float wisps=fbmQ(np*5.2+13.0,2.0); float lane=smoothstep(0.34,0.62,abs(gas-wisps));\n    float knots=pow(max(0.0,fbm(np*9.0)-0.66),3.0)*12.0; a=(gas*0.28+wisps*0.18+knots*0.5)*(0.55+0.45*lane)*m;\n    col=mix(uA,uB,clamp(wisps*0.9,0.0,1.0)); col=mix(col,uC,clamp(knots,0.0,0.55));`);

source = mustReplace(
  source,
  '  gl_FragColor = vec4(col, clamp(a*uInt,0.0,1.0));',
  `  // RC49_2_ENGINE_TONEMAP: gentle highlight rolloff shared by every existing effect.\n  float rawA=max(a,0.0); float coreLight=smoothstep(0.72,1.55,rawA);\n  col=mix(col,uC,coreLight*0.14); float outA=1.0-exp(-rawA*1.08);\n  gl_FragColor = vec4(col, clamp(outA*uInt,0.0,1.0));`,
  "final effect compositing"
);

const required = [
  MARKER,
  "Natural lightning: leader path",
  "Sparks use ballistic trajectories",
  "Layered flame body",
  "Fireflies: organic wandering agents",
  "Rain: depth-varied slanted streaks",
  "Cosmic nebula: multi-scale domain-warped gas",
  "RC49_2_ENGINE_TONEMAP"
];
for (const token of required) if (!source.includes(token)) throw new Error(`[rc.49.2 engine] validation failed: ${token}`);

fs.writeFileSync(rendererPath, crlf ? source.replace(/\n/g, "\r\n") : source, "utf8");
console.log("[rc.49.2 engine] realism upgrade applied; no UI files changed");
