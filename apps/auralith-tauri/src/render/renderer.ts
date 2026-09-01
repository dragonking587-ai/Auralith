import type { AudioSnapshot } from "../audio/engine";
import type { EffectKind, Project } from "../scene/types";
import { sceneViewport } from "../scene/transform";
import { buildPathField, fieldKey, regionGeomMode } from "../scene/pathSdf";

const VS = `attribute vec2 a; void main(){ gl_Position=vec4(a,0.0,1.0); }`;
const FS = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uMod;
uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform float uKind; uniform float uInt;
uniform vec2 uOrigin; uniform float uRadius;
uniform float uP0; uniform float uP1; uniform float uP2;
uniform float uQ; uniform float uBass; uniform float uMid; uniform float uHigh; uniform float uBeat;
uniform sampler2D uMask; uniform float uUseMask;
uniform sampler2D uSdf; uniform float uUseSdf; uniform float uApply; uniform float uBoundW; uniform float uPathT;
uniform vec2 uVpXY; uniform vec2 uVpWH;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float n2(vec2 p){ vec2 i=floor(p),f=fract(p); float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1)); vec2 u=f*f*(3.0-2.0*f); return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y; }
float fbm(vec2 p){ float v=0.0,a=0.5; v+=a*n2(p); p=p*2.03; a*=0.5; v+=a*n2(p); p=p*2.03; a*=0.5; v+=a*n2(p); p=p*2.03; a*=0.5; v+=a*n2(p); return v; }
float fbmQ(vec2 p, float q){
  float v=0.0,a=0.5; int oct = int(clamp(q,0.0,3.0))+2;
  for(int i=0;i<6;i++){ if(i>=oct) break; v+=a*n2(p); p=p*2.07+vec2(1.7,9.2); a*=0.5; }
  return v;
}
vec2 warp(vec2 p, float t, float amp){
  float n1 = fbm(p*1.1 + vec2(t*0.17, -t*0.11));
  float n2b = fbm(p*1.3 + vec2(-t*0.13, t*0.19) + 17.0);
  return p + amp*vec2(n1-0.5, n2b-0.5);
}
float envAR(float x, float atk, float rel){ return smoothstep(0.0, max(atk,0.02), x) * (1.0-smoothstep(1.0-max(rel,0.02), 1.0, x)); }
vec3 hueShift(vec3 c, float h){ return mix(c, vec3(c.g, c.b, c.r), clamp(abs(h)*2.0, 0.0, 1.0)); }
void main(){
  vec2 uv = gl_FragCoord.xy/uRes;
  vec2 p = (gl_FragCoord.xy - uOrigin)/max(uRadius*(0.35+uP1), 8.0);
  float d = length(p);
  float along = 0.0;
  if (uUseSdf > 0.5) {
    vec2 css = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
    vec2 suv = (css - uVpXY) / max(uVpWH, vec2(1.0));
    vec4 f = texture2D(uSdf, suv);
    float sd = (f.r - 0.5) * 2.0;
    along = f.g;
    if (uApply < 0.5) d = max(sd, 0.0) * 8.0 + (1.0 - f.b) * 8.0;
    else if (uApply < 1.5) d = abs(sd) * (10.0 / max(uBoundW, 0.04));
    else d = max(-sd, 0.0) * 8.0 + f.b * 8.0;
    p = vec2(along * 2.0 - 1.0, sd * 4.0);
  }
  float ang = atan(p.y,p.x);
  float t = uTime;
  float k = uKind;
  float m = clamp(uMod,0.0,2.5);
  float p0 = clamp(uP0,0.0,2.0);
  float p1 = clamp(uP1,0.0,2.0);
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
    float core = exp(-d*(2.4+p1*2.0));
    float midb = exp(-d*(0.85+p2));
    float spill = exp(-d*(0.22+0.08*p0));
    a = (core*0.95 + midb*0.42 + spill*0.16)*(0.28+m)*p0;
    col = mix(mix(uC,uA,core), uB, smoothstep(0.15,1.1,d));
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
    float path = uUseSdf>0.5 ? d : abs(d-0.55);
    float segs = 6.0+floor(p2*10.0);
    float flow = uUseSdf>0.5 ? fract(along - t*(0.35+p0+uBeat*0.6)) : fract(ang/6.2831*segs - t*(0.35+p0+uBeat*0.6)+fbm(p*2.0)*uMid);
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
  } else if (k < 21.5) {
    float absorb = smoothstep(0.15,1.1,d);
    float tend = pow(abs(sin(ang*(4.0+p2*8.0)+fbm(p)*4.0+t)), 3.0)*exp(-d*(0.8+p1));
    float rim = exp(-abs(d-0.55)*18.0);
    a = (1.0-absorb)*0.55*p0 + tend*0.5*m + rim*0.7;
    col = mix(uA*0.25, uB, tend);
    col = mix(col, uC, rim);
  } else if (k < 22.5) {
    float hole = smoothstep(0.42+p0*0.15, 0.28, d);
    float rim = exp(-abs(d-(0.38+p0*0.12))*(16.0+p1*20.0));
    float inner = fbm(vec2(ang*1.2, d*3.0-t*(0.3+p2)))*hole;
    a = rim*1.2*m + inner*0.55 + exp(-d*0.4)*0.08;
    col = mix(uA, uB, inner);
    col = mix(col, uC, rim);
  } else if (k < 23.5) {
    float arms = 3.0+floor(p2*5.0);
    float spiral = fract(ang/6.2831*arms + d*(2.0+p0*4.0) - t*(0.4+p1+uBeat*0.4));
    float arm = exp(-abs(spiral-0.5)*(14.0+p1*10.0))*exp(-d*0.45);
    float core = exp(-d*(3.0+p0));
    a = arm*m + core;
    col = mix(mix(uA,uB,spiral), uC, core);
  } else if (k < 24.5) {
    float beam = exp(-abs(p.x)*(8.0+p1*18.0))*smoothstep(1.1,-0.1,p.y*(0.6+p0));
    float turb = 0.7+0.3*n2(vec2(p.y*6.0-t, p.x*10.0));
    a = beam*turb*m;
    col = mix(uA, uC, exp(-abs(p.x)*30.0));
  } else if (k < 25.5) {
    float cells = hash(floor(p*(8.0+p0*20.0)+t*(2.0+uHigh*4.0)));
    float dots = step(0.82-p1*0.2, cells)*exp(-d*1.1);
    a = dots*m;
    col = mix(uA, uC, cells);
  } else if (k < 26.5) {
    float wisp = fbm(p*1.4+vec2(t*0.08, t*0.05));
    float aura = exp(-d*(0.7+p1))* (0.25+wisp*0.7);
    a = aura*m*(0.45+p0);
    col = mix(uA, uB, wisp);
    col = mix(col, uC, exp(-d*4.0));
  } else if (k < 27.5) {
    float bolt = pow(abs(sin(ang*2.0 + n2(vec2(t*8.0, floor(d*12.0)))*6.0)), 18.0+p1*20.0);
    float fork = pow(abs(sin(ang*5.0+t*3.0)), 22.0)*0.45;
    a = (bolt+fork)*exp(-d*0.35)*step(0.35, fract(t*(1.2+p0)+uBeat))*m;
    col = mix(uA, uC, bolt);
  } else if (k < 28.5) {
    float crawl = exp(-abs(d-0.5)*(10.0+p1*16.0));
    float walk = exp(-abs(fract(ang*4.0 - t*(0.5+p0))-0.5)*22.0);
    a = crawl*walk*m;
    col = mix(uA, uC, walk);
  } else if (k < 29.5) {
    float hit = exp(-fract(t*(0.25+p0)+uBeat)* (3.0+p2*6.0));
    a = hit*m*(0.4+p1);
    col = mix(uA, uC, hit);
  } else if (k < 30.5) {
    float core = exp(-abs(p.x)*(28.0+p1*40.0));
    float glow = exp(-abs(p.x)*(8.0+p2*8.0))*0.35;
    float len = smoothstep(1.05,-0.2,p.y*(0.5+p0));
    a = (core+glow)*len*m;
    col = mix(uA, uC, core);
  } else if (k < 31.5) {
    float bassW = 1.0 + uBass*0.55*m;
    float bassH = 0.55 + p0*0.55 + uBass*0.45*m + uBeat*0.18*m;
    float wind = (p2-0.5)*0.55 + uMid*0.12;
    float y = p.y + 0.72;
    float x = p.x - y*y*wind*0.35;
    float hMax = max(bassH, 0.28);
    float srcW = (0.16 + p1*0.28) * bassW;
    float taper = mix(1.0, 0.18, clamp(y/hMax,0.0,1.0));
    vec2 fl = warp(vec2(x*2.4, y*1.6 - t*(0.55+uMid*0.35)), t, 0.22+uMid*0.18);
    float bodyN = fbmQ(fl*1.15 + vec2(0.0,-t*0.85), uQ);
    float tongueN = fbmQ(fl*2.4 + vec2(t*0.15,-t*1.25), uQ);
    float edgeN = n2(fl*7.0 + vec2(0.0,-t*(2.2+uHigh*3.0)));
    float envY = smoothstep(-0.04, 0.08, y) * (1.0 - smoothstep(hMax*0.62, hMax, y));
    float rad = srcW * taper * (0.85 + bodyN*0.35 + tongueN*0.28);
    float body = exp(-abs(x)/(rad+0.02)) * envY;
    float tongues = pow(max(tongueN,0.0), mix(2.4,1.1,uMid)) * envY * (1.0-smoothstep(hMax*0.5, hMax, y));
    float core = exp(-abs(x)/(srcW*0.38+0.01)) * smoothstep(0.0,0.12,y) * (1.0-smoothstep(hMax*0.18, hMax*0.42, y));
    float flicker = 0.92 + 0.08*edgeN*uHigh;
    float flame = clamp(body*0.85 + tongues*0.55 + core*0.7, 0.0, 2.0) * flicker;
    flame *= 1.0 + uBeat*0.35;
    a = flame * m * (0.55+p0*0.35);
    float temp = clamp(core*1.3 + body*(1.0-y/hMax) - tongues*0.15, 0.0, 1.0);
    col = mix(uC, mix(uB, uA, temp), clamp(flame,0.0,1.0));
    col = mix(col, uA, core*0.65);
  } else if (k < 32.5) {
    float id = hash(floor(p*vec2(9.0,6.0)+vec2(2.1, floor(t*(0.18+p0*0.2)))));
    float life = fract(id + t*(0.08+p1*0.16) + uBeat*0.04);
    float rise = life * (0.9+p0*0.5);
    vec2 ep = vec2((id-0.5)*(0.55+p2*0.4)*life, -0.55 + rise);
    float sz = mix(0.035, 0.09, hash(vec2(id,2.2)));
    float ember = exp(-length(p-ep)/sz) * step(0.62, hash(vec2(id,7.7)));
    ember *= (1.0-smoothstep(0.72,1.0,life)) * (1.0 + step(0.85,uBeat)*0.8);
    a = ember*m;
    col = mix(uA, uB, life);
  } else if (k < 33.5) {
    float id = hash(floor(p*22.0 + 4.0));
    float life = fract(id*2.7 + t*(1.6+p0+uHigh*1.4+uBeat));
    vec2 vel = vec2((id-0.5)*(1.1+p1), 0.55+id*0.7);
    vec2 sp = vel*life*0.85;
    float trail = exp(-abs(dot(p-sp, normalize(vel+1e-4)))*28.0) * exp(-length(p-sp)*10.0);
    float spark = exp(-length(p-sp)*26.0) + trail*0.45;
    a = spark*m*(1.0-life)*step(0.55,id);
    col = mix(uC, uA, 1.0-life);
  } else if (k < 34.5) {
    float above = smoothstep(-0.1, 0.55, p.y);
    float field = fbmQ(warp(p*2.2, t*(0.4+p0), 0.3), uQ);
    float heat = exp(-d*(0.55+p1)) * above * (0.25+field);
    a = heat*0.28*m;
    col = mix(uA, uC, field);
  } else if (k < 35.5) {
    vec2 sw = warp(p*vec2(0.7,0.9) + vec2(t*0.04*(p2-0.5), -t*(0.08+p0*0.12)), t*0.2, 0.35);
    float billow = fbmQ(sw*0.9, uQ);
    float wisp = fbmQ(sw*2.6 + 8.0, uQ);
    float rise = smoothstep(-0.8, 0.9, p.y);
    float smoke = mix(billow, wisp, 0.35+rise*0.4);
    smoke = smoothstep(0.28, 0.72, smoke) * (1.0-smoothstep(0.55, 1.15, rise)) * (0.35+p1);
    a = smoke*m*0.62;
    col = mix(uA, uB, wisp);
  } else if (k < 36.5) {
    float mist = fbm(vec2(uv.x*1.4+t*(0.04+p0), uv.y*0.6));
    a = mist*0.22*m*(0.4+p1);
    col = mix(uA, uC, mist);
  } else if (k < 37.5) {
    a = 0.35*m;
    col = hueShift(mix(uA,uB,0.5), p0-1.0 + uBass*0.2);
  } else if (k < 38.5) {
    float pulse = 0.5+0.5*sin(t*(2.0+p0*6.0));
    float sep = (p1+uBeat)*0.08;
    col = vec3(uA.r, uB.g, uC.b);
    a = (0.25+pulse*0.5)*m;
    col = mix(uA, col, clamp(sep*8.0,0.0,1.0));
  } else if (k < 39.5) {
    float band = fract(ang/6.2831*6.0 + d*(2.0+p0) + t*p1);
    a = exp(-d*0.7)*m*0.6;
    col = mix(uA, uB, band);
    col = mix(col, uC, exp(-d*5.0));
  } else if (k < 40.5) {
    float tube = exp(-abs(d-0.5)*(18.0+p1*22.0));
    float bloom = exp(-abs(d-0.5)*3.5)*0.35;
    float buzz = 0.75+0.25*n2(vec2(t*(6.0+p2*10.0), 2.0));
    a = (tube+bloom)*buzz*m;
    col = mix(uA, uC, tube);
  } else if (k < 41.5) {
    float segs = 3.0+floor(p2*8.0);
    float chase = fract(ang/6.2831*segs - t*(0.45+p0+uBeat*0.5));
    float seg = exp(-abs(chase-0.5)*(16.0+p1*14.0))*exp(-abs(d-0.52)*8.0);
    a = seg*m;
    col = mix(uA, uC, seg);
  } else if (k < 42.5) {
    float sh = fbm(p*(3.0+p1*6.0)+vec2(t*(0.2+p0), 0.0));
    float silk = smoothstep(0.4,0.75,sh)*smoothstep(0.9,0.55,sh);
    a = silk*exp(-d*0.4)*m*0.55;
    col = mix(uA, uC, silk);
  } else if (k < 43.5) {
    float g = hash(floor(p*(14.0+p0*30.0))+floor(t*(4.0+p1*10.0+uHigh*6.0)));
    a = step(0.88,g)*exp(-d*0.3)*m;
    col = mix(uA, uC, g);
  } else if (k < 44.5) {
    float scan = 0.5+0.5*sin(uv.y*(40.0+p1*80.0)+t*(0.8+p0));
    float ghost = abs(sin(uv.x*20.0+t*0.3+uMid));
    a = (0.18+scan*0.25+ghost*0.2)*m;
    col = mix(uA, uB, scan);
    col = mix(col, uC, ghost*0.4);
  } else if (k < 45.5) {
    float blk = hash(floor(uv*(6.0+p1*16.0)+floor(t*(3.0+p0+uBeat*4.0))));
    float tear = step(0.7, blk);
    a = (0.12+tear*0.7)*m;
    col = mix(uA, uC, tear);
  } else if (k < 46.5) {
    float pulse = 0.5+0.5*sin(t*(1.2+p0)+p2);
    float shad = exp(-d*(1.2+p1))*pulse;
    a = shad*m;
    col = mix(uA*0.15, uB, 1.0-pulse);
  } else if (k < 47.5) {
    a = (0.18+p0*0.25)*m*(0.5+uBass*0.4);
    col = mix(uA*0.2, vec3(0.02), 0.6);
  } else if (k < 48.5) {
    float mask = exp(-d*(1.4+p1*2.0));
    a = mask*(0.2+p0*0.4)*m;
    col = uA*0.2;
  } else if (k < 49.5) {
    float surge = 0.4+0.6*uBeat;
    a = 0.22*m*surge;
    col = mix(uA, uC, surge);
  } else if (k < 50.5) {
    float drop = fract(uv.x*(40.0+p1*40.0)+hash(vec2(uv.x,0.0))*10.0 - t*(0.8+p0));
    float rain = step(0.92, drop)*smoothstep(0.0,0.15,fract(uv.y*20.0));
    a = rain*m*0.7;
    col = mix(uA, uC, rain);
  } else if (k < 51.5) {
    float wet = exp(-abs(uv.y-0.72)*(8.0+p1*10.0))*fbm(vec2(uv.x*8.0, t*0.2+p0));
    a = wet*0.45*m;
    col = mix(uA, uC, wet);
  } else if (k < 52.5) {
    float flake = hash(floor(uv*(18.0+p0*20.0)+vec2(t*(0.15+p1),0.0)));
    a = step(0.9, flake)*m*0.6;
    col = mix(uA, uC, flake);
  } else if (k < 53.5) {
    float ash = hash(floor(uv*(12.0+p0*16.0)+vec2(t*0.08, t*0.11)));
    float glow = step(0.93, ash)*uHigh;
    a = step(0.84, ash)*m*0.45 + glow*0.3;
    col = mix(uA, uC, glow);
  } else if (k < 54.5) {
    float mote = hash(floor(uv*(22.0+p1*20.0)+t*0.05));
    a = step(0.94, mote)*m*0.4;
    col = mix(uA, uC, mote);
  } else if (k < 55.5) {
    float fold = sin(uv.x*(4.0+p2*6.0)+t*(0.15+p0))*0.5+0.5;
    float curtain = exp(-abs(uv.y-(0.35+p1*0.2))*2.2)*fold;
    a = curtain*m*0.55;
    col = mix(uA, uB, fold);
    col = mix(col, uC, exp(-abs(uv.y-0.3)*8.0));
  } else if (k < 56.5) {
    float haze = fbm(uv*1.2+t*0.02);
    a = haze*0.18*m*(0.4+p0);
    col = mix(uA, uB, haze);
  } else if (k < 57.5) {
    float line = exp(-abs(uv.y-0.55)*(10.0+p1*12.0));
    float wave = 0.5+0.5*sin(uv.x*(10.0+p2*20.0)+t*(0.4+p0));
    a = line*wave*0.5*m;
    col = mix(uA, uC, wave);
  } else if (k < 58.5) {
    float cau = fbm(uv*(4.0+p0*8.0)+vec2(t*(0.2+p1), t*0.13));
    float pat = smoothstep(0.45,0.7,cau)*smoothstep(0.85,0.55,cau);
    a = pat*m*0.55;
    col = mix(uA, uC, pat);
  } else if (k < 59.5) {
    float rad = fract(t*(0.35+p0)+uBeat*0.2);
    float rip = exp(-abs(d-rad*(0.2+p1))* (14.0+p2*16.0));
    a = rip*m*0.5;
    col = mix(uA, uC, rip);
  } else if (k < 60.5) {
    float lens = exp(-d*(1.2+p1*2.0));
    float fringe = abs(sin(d*(8.0+p0*10.0)+t*0.2));
    a = lens*0.28*m + fringe*lens*0.2;
    col = mix(uA, uC, fringe);
  } else if (k < 61.5) {
    float cover = smoothstep(0.15, 0.95, fbm(p*(2.0+p1*3.0))+p0*0.35);
    float branch = pow(abs(sin(ang*8.0+fbm(p)*5.0)), 8.0)*exp(-d*0.6);
    a = (cover*0.45 + branch*0.35)*m;
    col = mix(uA, uC, branch);
  } else if (k < 62.5) {
    float facet = abs(sin(ang*(3.0+floor(p2*6.0)) + d*(4.0+p0)));
    float grow = smoothstep(1.1, 0.15+p1*0.2, d)*pow(facet, 4.0);
    a = grow*m;
    col = mix(uA, uC, facet);
  } else if (k < 63.5) {
    float shine = fbm(p*(5.0+p1*6.0)+vec2(t*(0.3+p0),0.0));
    float ice = smoothstep(0.55,0.8,shine)*smoothstep(0.95,0.65,shine);
    a = ice*exp(-d*0.35)*m;
    col = mix(uA, uC, ice);
  } else if (k < 64.5) {
    float puff = exp(-d*(1.1+p1))*fbm(p*1.6+vec2(t*(0.2+p0),0.0));
    a = puff*m*0.55;
    col = mix(uA, uC, puff);
  } else if (k < 65.5) {
    float id = hash(floor(p*9.0));
    vec2 w = vec2(sin(t*(0.4+p0)+id*6.0), cos(t*0.33+id*4.0))* (0.3+p1);
    float fly = exp(-length(p-w)*18.0);
    float blink = step(0.35, fract(t*(0.6+p2)+id));
    a = fly*blink*m;
    col = mix(uA, uC, fly);
  } else if (k < 66.5) {
    float spore = hash(floor(p*11.0+t*0.04));
    float glow = step(0.86, spore)*exp(-d*0.5);
    a = glow*(0.4+0.4*sin(t*(0.7+p0)+spore*10.0))*m;
    col = mix(uA, uB, spore);
  } else if (k < 67.5) {
    float rune = exp(-abs(d-0.48)*(12.0+p1*16.0));
    float flow = exp(-abs(fract(ang*3.0 - t*(0.3+p0))-0.5)*18.0);
    a = (rune+flow*0.6)*m;
    col = mix(uA, uC, flow);
  } else if (k < 68.5) {
    float phase = fract(t*(0.2+p0)+uBeat*0.15);
    float ring = exp(-abs(d-(0.25+phase*0.4))*(14.0+p1*10.0));
    float core = exp(-d*(3.0+p2))*step(0.35, phase);
    a = (ring+core)*m;
    col = mix(uA, uC, core+phase);
  } else if (k < 69.5) {
    float tend = pow(abs(sin(ang*(3.0+p2*4.0)+fbm(p)*3.0+t*(0.2+p0))), 5.0);
    tend *= exp(-d*(0.6+p1));
    a = tend*m;
    col = mix(uA*0.2, uC, tend*0.3);
  } else if (k < 70.5) {
    float disc = smoothstep(0.42+p0*0.15, 0.35, d);
    float corona = exp(-abs(d-(0.4+p0*0.12))*(10.0+p1*16.0));
    a = disc*0.55 + corona*m;
    col = mix(uA*0.05, uC, corona);
  } else if (k < 71.5) {
    float pull = exp(-d*(0.8+p1));
    a = pull*0.4*m + exp(-d*6.0)*0.3;
    col = mix(uA, uC, exp(-d*4.0));
  } else if (k < 72.5) {
    float warp = fbm(p*(1.4+p0)+t*0.08);
    a = exp(-d*(0.6+p1))* (0.25+warp*0.5)*m;
    col = mix(uA, uB, warp);
  } else if (k < 73.5) {
    float segs = 4.0+floor(p2*8.0);
    float kal = abs(fract(ang/6.2831*segs)-0.5);
    a = exp(-kal*(6.0+p1))*exp(-d*0.4)*m;
    col = mix(uA, uC, kal);
  } else if (k < 74.5) {
    float shard = hash(floor(p*(5.0+p0*8.0)));
    float edge = abs(sin(ang*6.0+shard*8.0));
    a = step(0.55, shard)*exp(-d*0.3)*m*0.45 + exp(-abs(edge-0.7)*20.0)*0.3;
    col = mix(uA, uC, edge);
  } else if (k < 75.5) {
    float pix = hash(floor(uv*(12.0+p1*24.0)));
    a = step(pix, p0*0.6+uBeat*0.2)*m*0.5;
    col = mix(uA, uC, pix);
  } else if (k < 76.5) {
    float scan = exp(-abs(uv.y-fract(t*(0.25+p0)))*(18.0+p1*20.0));
    a = scan*m;
    col = mix(uA, uC, scan);
  } else if (k < 77.5) {
    float sep = p0*0.15+uBeat*0.05;
    col = vec3(uA.r, uB.g, uC.b);
    a = 0.28*m;
    col = mix(uA, col, clamp(sep*6.0,0.0,1.0));
  } else if (k < 78.5) {
    float burn = smoothstep(0.2,0.9, uv.y + fbm(uv*3.0)*0.2 - (0.3+p0*0.4));
    float hot = exp(-abs(burn-0.5)*8.0);
    a = burn*m*0.5 + hot*0.35;
    col = mix(uA, uC, hot);
  } else if (k < 79.5) {
    float star = hash(floor(uv*(30.0+p0*40.0)));
    float tw = 0.5+0.5*sin(t*(1.0+p1)+star*20.0);
    a = step(0.93, star)*tw*m;
    col = mix(uA, uC, star);
  } else if (k < 80.5) {
    float cloud = fbm(uv*(1.1+p0)+vec2(t*(0.04+p1), t*0.03));
    float layer = fbm(uv*2.2-t*0.02);
    a = cloud*0.45*m + layer*0.15;
    col = mix(mix(uA,uB,cloud), uC, layer*0.4);
  } else if (k < 81.5) {
    float mk = uUseMask > 0.5 ? texture2D(uMask, uv).r : 0.0;
    float path = fract(ang/6.2831 - t*(0.25+p0+uMid*0.4));
    vec3 rb = 0.5+0.5*cos(6.2831*path + vec3(0.0,2.094,4.188));
    float chase = exp(-abs(fract(path*(1.0+p2*3.0))-0.5)*18.0);
    float flick = 0.82+0.18*n2(vec2(t*9.0,2.0))*uHigh;
    float tube = mk;
    float bloom = mk * 0.22 * (0.5+p1);
    a = (tube*1.05 + bloom + chase*mk*0.25)*flick*m;
    col = mix(mix(uA,uB,path), rb, 0.55);
    col = mix(col, uC, tube);
    if (mk < 0.04) a = 0.0;
  } else {
    a = exp(-d*2.0)*(0.2+m);
    col = mix(uA,uB,0.5);
  }
  gl_FragColor = vec4(col, clamp(a*uInt,0.0,1.0));
}
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string, label: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) || "shader compile failed";
    console.error("APP_BOOT_FAILED stage=SHADERS_COMPILE error=" + label + " " + log);
    const numbered = src.split("\n").map((line, i) => String(i + 1).padStart(3, "0") + " | " + line).join("\n");
    console.error("SHADER_SOURCE " + label + "\n" + numbered);
    throw new Error(label + ": " + log);
  }
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
  FrostIce:61,CrystalGrowth:62,IceShimmer:63,FrozenBreath:64,Fireflies:65,
  BioluminescentSpores:66,RuneGlow:67,SigilActivation:68,ShadowTendrils:69,Eclipse:70,
  GravityWell:71,SpatialWarp:72,Kaleidoscope:73,MirrorFracture:74,PixelDissolve:75,
  ScanlinePulse:76,RgbSplit:77,FilmBurn:78,CelestialStars:79,CosmicNebula:80,SmartNeon:81
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
  private maskTex: WebGLTexture | null = null;
  private hasMask = false;
  private hasBackdrop = false;
  private sdfTex: WebGLTexture | null = null;
  private sdfKey = "";
  fps = 0;
  lastW = 0;
  lastH = 0;
  private frames = 0;
  private lastFps = performance.now();
  constructor(private canvas: HTMLCanvasElement) {
    console.log("RENDERER_INIT_BEGIN");
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: true, preserveDrawingBuffer: true })
      || canvas.getContext("webgl", { alpha: false, antialias: true, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 required");
    console.log("WEBGL2_CONTEXT_OK");
    this.gl = gl;
    console.log("SHADERS_COMPILE_BEGIN");
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS, "VS"));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS, "FS"));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
    this.prog = p;
    const bp = gl.createProgram()!;
    gl.attachShader(bp, compile(gl, gl.VERTEX_SHADER, BVS, "BVS"));
    gl.attachShader(bp, compile(gl, gl.FRAGMENT_SHADER, BFS, "BFS"));
    gl.linkProgram(bp);
    if (!gl.getProgramParameter(bp, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(bp) || "bg link");
    this.bgProg = bp;
    this.buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    this.bgBuf = gl.createBuffer()!;
    console.log("SHADERS_COMPILE_OK RENDERER_INIT_OK");
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
  setNeonMask(src: HTMLCanvasElement | null) {
    const gl = this.gl;
    if (!src) { this.hasMask = false; return; }
    if (!this.maskTex) this.maskTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    this.hasMask = true;
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
  draw(project: Project, snap: AudioSnapshot, cssW: number, cssH: number, viewCss?: { x: number; y: number; w: number; h: number }) {
    const gl = this.gl;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.floor(cssW * dpr)), h = Math.max(2, Math.floor(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.02, 0.02, 0.04, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const base = viewCss
      ? { x: viewCss.x * dpr, y: viewCss.y * dpr, w: viewCss.w * dpr, h: viewCss.h * dpr }
      : sceneViewport(w, h, project.width, project.height, project.fit);
    const vp = base;
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
      for (const e of r.effects) {
        if (!e.enabled) continue;
        const ox = vp.x + ((r.x + (e.offsetX || 0)) / project.width) * vp.w;
        const oy = vp.y + (1 - (r.y + (e.offsetY || 0)) / project.height) * vp.h;
        const rad = Math.max(8, (r.radius + (e.expansion || 0) + (e.spread || 0)) * (vp.w / project.width) * Math.max(0.05, e.fxScaleX || e.scale || r.sx || 1));
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
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
        gl.uniform1i(gl.getUniformLocation(this.prog, "uMask"), 1);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uUseMask"), (this.hasMask && e.kind==="SmartNeon") ? 1.0 : 0.0);
        const geom = (e as any).geomMode || regionGeomMode(r);
        const apply = (e as any).applyMode || "boundary";
        const useSdf = r.kind === "Trace" && r.points.length >= 2 && geom !== "point";
        gl.uniform2f(gl.getUniformLocation(this.prog, "uVpXY"), vp.x, vp.y);
        gl.uniform2f(gl.getUniformLocation(this.prog, "uVpWH"), vp.w, vp.h);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uApply"), apply === "inside" ? 0 : apply === "outside" ? 2 : 1);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uBoundW"), Number((e as any).boundaryWidth ?? 0.35));
        if (useSdf) {
          const key = fieldKey(r, project.width, project.height);
          if (!this.sdfTex) this.sdfTex = gl.createTexture();
          if (this.sdfKey !== key) {
            const field = buildPathField(r.points, !!r.pathClosed || geom === "mask", project.width, project.height, 256);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, this.sdfTex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, field.res, field.res, 0, gl.RGBA, gl.UNSIGNED_BYTE, field.data);
            this.sdfKey = key;
          } else {
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, this.sdfTex);
          }
          gl.uniform1i(gl.getUniformLocation(this.prog, "uSdf"), 2);
          gl.uniform1f(gl.getUniformLocation(this.prog, "uUseSdf"), 1);
        } else {
          gl.uniform1f(gl.getUniformLocation(this.prog, "uUseSdf"), 0);
        }
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1f(gl.getUniformLocation(this.prog, "uKind"), KIND_INDEX[e.kind] ?? 0);
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
