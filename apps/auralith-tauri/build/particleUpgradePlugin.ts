import type { Plugin } from "vite";

/**
 * Temporary test-branch shader transform.
 *
 * The production renderer still contains several legacy hash/floor particle effects that
 * resolve as glittering square cells. While the native wgpu compositor is being wired into
 * the Auralith canvas, this transform upgrades those fallback branches to smooth analytic
 * particles so the experimental desktop build no longer shows obvious square-pixel stand-ins.
 *
 * Intentional pixel effects (PixelDissolve and GlitchLight) are NOT changed.
 */
export function auralithParticleUpgradePlugin(): Plugin {
  return {
    name: "auralith-native-gpu-particle-quality",
    enforce: "pre",
    transform(code, id) {
      if (!id.replaceAll("\\", "/").endsWith("/src/render/renderer.ts")) return null;

      let next = code;
      const replaceRequired = (label: string, from: string, to: string) => {
        if (!next.includes(from)) {
          throw new Error(`[native-gpu-testing] renderer particle block not found: ${label}`);
        }
        next = next.replace(from, to);
      };

      replaceRequired(
        "EnergySparks",
`  } else if (k < 25.5) {
    float cells = hash(floor(p*(8.0+p0*20.0)+t*(2.0+uHigh*4.0)));
    float dots = step(0.82-p1*0.2, cells)*exp(-d*1.1);
    a = dots*m;
    col = mix(uA, uC, cells);
`,
`  } else if (k < 25.5) {
    // Energy Sparks: continuous charged streaks, never cell-aligned square pixels.
    float sparkField = 0.0; float sparkCore = 0.0;
    for (int i=0;i<18;i++) {
      float fi=float(i);
      float seed=hash(vec2(fi*13.17+2.4,7.31));
      float life=fract(t*(0.34+p0*0.48+uHigh*0.34)+seed);
      float ang0=seed*6.2831 + sin(t*(0.5+seed)+fi)*0.24*uMid;
      vec2 dir=vec2(cos(ang0),sin(ang0));
      vec2 side=vec2(-dir.y,dir.x);
      float reach=0.10+life*(0.42+p1*0.58+uTransient*0.18);
      vec2 pos=dir*reach + side*sin(life*8.0+fi*1.7+t*2.0)*(0.012+uMid*0.025);
      vec2 q=p-pos;
      float along=dot(q,dir);
      float across=abs(dot(q,side));
      float head=exp(-length(q)*(55.0+p2*30.0));
      float trail=exp(-across*(70.0+p2*45.0))*exp(-abs(along+0.055)*18.0)*smoothstep(0.06,-0.12,along);
      float fade=(1.0-life)*(0.35+uHigh*0.75+uTransient*0.65);
      sparkField += (head+trail*0.62)*fade;
      sparkCore += head*fade;
    }
    a = sparkField*m*0.72*exp(-d*0.35);
    col = mix(uA,uB,clamp(sparkField*0.35,0.0,1.0));
    col = mix(col,uC,clamp(sparkCore,0.0,1.0));
`);

      replaceRequired(
        "Sparks",
`  } else if (k < 33.5) {
    float id = hash(floor(p*22.0 + 4.0));
    float life = fract(id*2.7 + t*(1.6+p0+uHigh*1.4+uBeat));
    vec2 vel = vec2((id-0.5)*(1.1+p1), 0.55+id*0.7);
    vec2 sp = vel*life*0.85;
    float trail = exp(-abs(dot(p-sp, normalize(vel+1e-4)))*28.0) * exp(-length(p-sp)*10.0);
    float spark = exp(-length(p-sp)*26.0) + trail*0.45;
    a = spark*m*(1.0-life)*step(0.55,id);
    col = mix(uC, uA, 1.0-life);
`,
`  } else if (k < 33.5) {
    // Physical sparks: ballistic incandescent fragments with drag, gravity and stretched trails.
    float total=0.0; float hot=0.0;
    for (int i=0;i<20;i++) {
      float fi=float(i);
      float seed=hash(vec2(fi*9.71+4.2,fi*2.13+8.8));
      float life=fract(t*(0.42+p0*0.32+uHigh*0.18)+seed);
      float angle=mix(0.35,2.79,hash(vec2(seed,3.1)));
      float speed=(0.46+hash(vec2(seed,8.9))*0.70)*(0.72+p1*0.32+uTransient*0.50+uBeat*0.16);
      vec2 v0=vec2(cos(angle),sin(angle))*speed;
      vec2 pos=v0*life*0.72 + vec2(0.0,-0.36*life*life) + vec2((seed-0.5)*0.08,-0.48);
      vec2 vel=v0 + vec2(0.0,-0.72*life);
      vec2 dir=normalize(vel+vec2(0.0001));
      vec2 side=vec2(-dir.y,dir.x);
      vec2 q=p-pos;
      float along=dot(q,dir);
      float across=abs(dot(q,side));
      float head=exp(-length(q)*(70.0+p2*30.0));
      float trail=exp(-across*(95.0+p2*35.0))*exp(-abs(along+0.045)*24.0)*smoothstep(0.035,-0.14,along);
      float fade=pow(1.0-life,1.5)*step(0.18,seed);
      total += (head+trail*0.58)*fade;
      hot += head*fade;
    }
    a = total*m*(0.52+uHigh*0.35+uTransient*0.25);
    col = mix(uA,uB,clamp(total*0.22,0.0,1.0));
    col = mix(col,uC,clamp(hot*0.8,0.0,1.0));
`);

      replaceRequired(
        "GlitterSparkle",
`  } else if (k < 43.5) {
    float g = hash(floor(p*(14.0+p0*30.0))+floor(t*(4.0+p1*10.0+uHigh*6.0)));
    a = step(0.88,g)*exp(-d*0.3)*m;
    col = mix(uA, uC, g);
`,
`  } else if (k < 43.5) {
    // Glitter is rendered as diffraction glints with a hot core and crossing rays.
    float glints=0.0; float cores=0.0;
    for (int i=0;i<16;i++) {
      float fi=float(i);
      float sx=hash(vec2(fi*4.71,2.3))*1.7-0.85;
      float sy=hash(vec2(fi*8.17,6.9))*1.25-0.62;
      vec2 q=p-vec2(sx,sy);
      float tw=pow(max(0.0,sin(t*(2.0+p1*3.0)+fi*2.17+hash(vec2(fi,1.0))*6.2831)),5.0);
      tw*=0.30+uHigh*0.85+uTransient*0.35;
      float core=exp(-length(q)*(95.0+p2*35.0));
      float rayX=exp(-abs(q.x)*(180.0+p0*70.0))*exp(-abs(q.y)*24.0);
      float rayY=exp(-abs(q.y)*(180.0+p0*70.0))*exp(-abs(q.x)*24.0);
      glints += (core+(rayX+rayY)*0.38)*tw;
      cores += core*tw;
    }
    a = glints*m*exp(-d*0.18);
    col = mix(uA,uB,clamp(glints*0.18,0.0,1.0));
    col = mix(col,uC,clamp(cores,0.0,1.0));
`);

      replaceRequired(
        "Rain",
`  } else if (k < 50.5) {
    float drop = fract(uv.x*(40.0+p1*40.0)+hash(vec2(uv.x,0.0))*10.0 - t*(0.8+p0));
    float rain = step(0.92, drop)*smoothstep(0.0,0.15,fract(uv.y*20.0));
    a = rain*m*0.7;
    col = mix(uA, uC, rain);
`,
`  } else if (k < 50.5) {
    // Rain: anti-aliased slanted streaks with depth variation instead of stepped pixels.
    float rain=0.0; float bright=0.0;
    for (int i=0;i<18;i++) {
      float fi=float(i);
      float seed=hash(vec2(fi*7.91,2.7));
      float phase=fract(t*(0.30+p0*0.42)*(0.72+seed*0.55)+seed);
      float x=hash(vec2(fi*3.17,9.4));
      float y=1.15-phase*1.35;
      float wind=(p2-0.5)*0.18;
      vec2 q=uv-vec2(x+wind*(1.0-y),y);
      q.x += q.y*wind;
      float width=0.0014+seed*0.0018;
      float len=0.025+p1*0.055+seed*0.035;
      float streak=exp(-abs(q.x)/width)*exp(-abs(q.y)/len);
      float depth=0.45+seed*0.75;
      rain += streak*depth;
      bright += streak*step(0.72,seed);
    }
    a = rain*m*(0.35+uHigh*0.22+uTransient*0.18);
    col = mix(uA,uB,clamp(rain*0.12,0.0,1.0));
    col = mix(col,uC,clamp(bright*0.45,0.0,1.0));
`);

      replaceRequired(
        "Snow",
`  } else if (k < 52.5) {
    float flake = hash(floor(uv*(18.0+p0*20.0)+vec2(t*(0.15+p1),0.0)));
    a = step(0.9, flake)*m*0.6;
    col = mix(uA, uC, flake);
`,
`  } else if (k < 52.5) {
    // Snow: rounded, depth-scaled flakes with soft edges and lateral drift.
    float snow=0.0; float nearSnow=0.0;
    for (int i=0;i<20;i++) {
      float fi=float(i);
      float seed=hash(vec2(fi*5.13,7.2));
      float depth=0.35+hash(vec2(fi,4.4))*0.65;
      float phase=fract(t*(0.035+p0*0.055)*(0.55+depth)+seed);
      float x=hash(vec2(fi*8.41,1.7));
      x += sin(t*(0.22+seed*0.3)+fi)*0.018*(0.4+p1);
      float y=1.08-phase*1.18;
      vec2 q=uv-vec2(fract(x),y);
      float size=mix(0.0018,0.0065,depth)*(0.65+p2*0.5);
      float flake=exp(-dot(q,q)/max(size*size,0.000001));
      snow += flake*(0.42+depth*0.58);
      nearSnow += flake*depth;
    }
    a = snow*m*(0.42+uHigh*0.10);
    col = mix(uA,uB,clamp(snow*0.10,0.0,1.0));
    col = mix(col,uC,clamp(nearSnow*0.32,0.0,1.0));
`);

      replaceRequired(
        "Ash",
`  } else if (k < 53.5) {
    float ash = hash(floor(uv*(12.0+p0*16.0)+vec2(t*0.08, t*0.11)));
    float glow = step(0.93, ash)*uHigh;
    a = step(0.84, ash)*m*0.45 + glow*0.3;
    col = mix(uA, uC, glow);
`,
`  } else if (k < 53.5) {
    // Ash: irregular falling/tumbling soft flakes; occasional warm flecks respond to highs.
    float ash=0.0; float glow=0.0;
    for (int i=0;i<16;i++) {
      float fi=float(i);
      float seed=hash(vec2(fi*6.73,3.2));
      float life=fract(seed+t*(0.025+p0*0.055)*(0.7+seed*0.5));
      float x=hash(vec2(fi*2.91,8.4))+sin(t*(0.18+seed)+fi)*0.035*(0.5+p2);
      float y=1.08-life*1.22;
      vec2 q=uv-vec2(fract(x),y);
      float rot=t*(0.6+seed)+fi;
      vec2 qr=vec2(q.x*cos(rot)-q.y*sin(rot),q.x*sin(rot)+q.y*cos(rot));
      float flake=exp(-abs(qr.x)*(260.0+p1*80.0))*exp(-abs(qr.y)*(150.0+p1*45.0));
      ash += flake*(0.35+seed*0.5);
      glow += flake*step(0.82,seed)*uHigh;
    }
    a = (ash*0.62+glow*0.35)*m;
    col = mix(uA,uB,clamp(ash*0.16,0.0,1.0));
    col = mix(col,uC,clamp(glow,0.0,1.0));
`);

      replaceRequired(
        "DustMotes",
`  } else if (k < 54.5) {
    float mote = hash(floor(uv*(22.0+p1*20.0)+t*0.05));
    a = step(0.94, mote)*m*0.4;
    col = mix(uA, uC, mote);
`,
`  } else if (k < 54.5) {
    // Dust motes: soft bokeh particles floating through slow air currents.
    float motes=0.0; float bokeh=0.0;
    for (int i=0;i<18;i++) {
      float fi=float(i);
      float seed=hash(vec2(fi*9.37,5.1));
      vec2 base=vec2(hash(vec2(fi*3.11,2.0)),hash(vec2(fi*7.29,6.0)));
      vec2 pos=base+vec2(sin(t*(0.08+seed*0.08)+fi)*0.028, cos(t*(0.06+seed*0.07)+fi*1.7)*0.020);
      vec2 q=uv-fract(pos);
      q-=round(q);
      float depth=0.25+hash(vec2(fi,9.0))*0.75;
      float size=(0.0025+depth*0.006)*(0.65+p0*0.55);
      float core=exp(-dot(q,q)/max(size*size,0.000001));
      float halo=exp(-dot(q,q)/max(size*size*5.0,0.000001))*0.22;
      motes += core*(0.25+depth*0.55);
      bokeh += halo*depth;
    }
    a = (motes+bokeh)*m*(0.32+p1*0.18);
    col = mix(uA,uB,clamp(bokeh*0.16,0.0,1.0));
    col = mix(col,uC,clamp(motes*0.28,0.0,1.0));
`);

      replaceRequired(
        "BioluminescentSpores",
`  } else if (k < 66.5) {
    float spore = hash(floor(p*11.0+t*0.04));
    float glow = step(0.86, spore)*exp(-d*0.5);
    a = glow*(0.4+0.4*sin(t*(0.7+p0)+spore*10.0))*m;
    col = mix(uA, uB, spore);
`,
`  } else if (k < 66.5) {
    // Bioluminescent spores: soft living orbs with breathing cores and curl drift.
    float spores=0.0; float cores=0.0;
    for (int i=0;i<16;i++) {
      float fi=float(i);
      float seed=hash(vec2(fi*4.39,3.7));
      vec2 pos=vec2(hash(vec2(fi*8.31,1.2))*1.6-0.8,hash(vec2(fi*2.71,9.4))*1.15-0.58);
      pos += vec2(sin(t*(0.18+seed*0.12)+fi)*0.055,cos(t*(0.14+seed*0.10)+fi*1.3)*0.045)*(0.45+p2*0.45);
      vec2 q=p-pos;
      float breath=0.45+0.55*(0.5+0.5*sin(t*(0.55+p0*0.55)+seed*13.0));
      float core=exp(-length(q)*(48.0+p1*22.0));
      float halo=exp(-length(q)*(13.0+p1*5.0))*0.28;
      float energy=breath*(0.35+uMid*0.35+uHigh*0.18);
      spores += (core+halo)*energy;
      cores += core*energy;
    }
    a = spores*m*exp(-d*0.15);
    col = mix(uA,uB,clamp(spores*0.18,0.0,1.0));
    col = mix(col,uC,clamp(cores*0.65,0.0,1.0));
`);

      replaceRequired(
        "CelestialStars",
`  } else if (k < 79.5) {
    float star = hash(floor(uv*(30.0+p0*40.0)));
    float tw = 0.5+0.5*sin(t*(1.0+p1)+star*20.0);
    a = step(0.93, star)*tw*m;
    col = mix(uA, uC, star);
`,
`  } else if (k < 79.5) {
    // Celestial stars: sub-pixel point lights with real radial falloff and selective glints.
    float stars=0.0; float glint=0.0;
    for (int i=0;i<24;i++) {
      float fi=float(i);
      float seed=hash(vec2(fi*6.17,4.2));
      vec2 pos=vec2(hash(vec2(fi*2.71,1.7)),hash(vec2(fi*9.13,7.4)));
      vec2 q=uv-pos;
      float size=0.0018+hash(vec2(fi,5.0))*0.0038*(0.65+p0*0.6);
      float tw=0.42+0.58*(0.5+0.5*sin(t*(0.45+p1*0.75)+seed*23.0));
      tw*=0.65+uHigh*0.32;
      float core=exp(-dot(q,q)/max(size*size,0.0000004));
      float rayX=exp(-abs(q.x)/(size*0.28))*exp(-abs(q.y)/(size*4.5));
      float rayY=exp(-abs(q.y)/(size*0.28))*exp(-abs(q.x)/(size*4.5));
      stars += core*tw;
      glint += (rayX+rayY)*0.13*tw*step(0.72,seed);
    }
    a = (stars+glint)*m;
    col = mix(uA,uB,clamp(stars*0.16,0.0,1.0));
    col = mix(col,uC,clamp(stars*0.55+glint*0.35,0.0,1.0));
`);

      return { code: next, map: null };
    },
  };
}
