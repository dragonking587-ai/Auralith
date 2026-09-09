import type { Plugin } from "vite";

/** Second audit pass for non-digital effects that still used cell hashes. */
export function auralithParticleUpgradePhase2Plugin(): Plugin {
  return {
    name: "auralith-native-gpu-particle-quality-phase2",
    enforce: "pre",
    transform(code, id) {
      if (!id.replaceAll("\\", "/").endsWith("/src/render/renderer.ts")) return null;
      let next = code.replace(/\r\n/g, "\n");

      const branch = (label: string, current: number, following: number, body: string) => {
        const cur = String(current).replace(".", "\\.");
        const fol = String(following).replace(".", "\\.");
        const re = new RegExp(`  } else if \\(k < ${cur}\\) \\{[\\s\\S]*?(?=\\n  } else if \\(k < ${fol}\\))`);
        if (!re.test(next)) throw new Error(`[native-gpu-testing] phase2 branch not found: ${label}`);
        next = next.replace(re, `  } else if (k < ${current}) {\n${body}`);
      };

      branch("Plasma", 20.5, 21.5, `    vec2 fp=p;
    fp+=vec2(n2(p+t*0.07),n2(p.yx-t*0.06)-0.5)*(0.15+p2*0.4+uBass*0.2);
    float field=fbm(fp*(1.2+p0*3.2)+vec2(t*(0.16+p1),t*0.11));
    float fil=smoothstep(0.32,0.72,field)*smoothstep(0.88,0.52,field);
    fil=pow(fil,0.65+p2*0.4);
    // High-frequency plasma detail is made from continuous micro-arcs, not square cells.
    float micro=0.0;
    for(int i=0;i<8;i++){
      float fi=float(i), seed=hash(vec2(fi*5.9,3.4));
      float ph=fract(t*(0.45+uHigh*0.65)+seed);
      float aa=seed*6.2831+sin(t+fi)*0.3;
      vec2 dir=vec2(cos(aa),sin(aa)), q=fp-dir*(0.18+ph*0.62);
      float arc=exp(-abs(dot(q,vec2(-dir.y,dir.x)))*(70.0+p2*35.0))*exp(-abs(dot(q,dir))*8.0);
      micro+=arc*(1.0-ph)*uHigh*(0.25+uTransient*0.5);
    }
    a=(fil*0.95+field*0.18+micro*0.18)*mix(0.55,1.0,m);
    col=mix(mix(uA,uB,field),uC,clamp(fil*0.7+micro*0.35,0.0,1.0));
    col=hueShift(col,t*0.03+uMid*0.05);`);

      branch("Embers", 32.5, 33.5, `    // Individual buoyant embers with cooling glow and turbulent drift.
    float embers=0.0; float emberHot=0.0;
    for(int i=0;i<18;i++){
      float fi=float(i), seed=hash(vec2(fi*7.31,2.9));
      float life=fract(seed+t*(0.055+p1*0.085+uBeat*0.015));
      float rise=life*(0.72+p0*0.46+uLow*0.14);
      float x=(hash(vec2(fi*3.77,9.1))-0.5)*(0.62+p2*0.45);
      x+=sin(t*(0.55+seed*0.4)+life*7.0+fi)*0.045*(0.45+uMid*0.6);
      vec2 pos=vec2(x,-0.58+rise), q=p-pos;
      float sz=0.012+hash(vec2(fi,6.2))*0.026;
      float core=exp(-length(q)/sz), halo=exp(-length(q)/(sz*2.8))*0.18;
      float cool=pow(1.0-life,1.35)*(0.52+uHigh*0.30+uTransient*0.25);
      embers+=(core+halo)*cool; emberHot+=core*cool;
    }
    a=embers*m; col=mix(uB,uA,clamp(embers*0.22,0.0,1.0)); col=mix(col,uC,clamp(emberHot*0.75,0.0,1.0));`);

      branch("Fireflies", 65.5, 66.5, `    // Independent soft fireflies with wandering paths and asynchronous organic blinking.
    float flies=0.0; float flyCore=0.0;
    for(int i=0;i<14;i++){
      float fi=float(i), seed=hash(vec2(fi*8.13,4.6));
      vec2 home=vec2(hash(vec2(fi*3.17,1.2))*1.35-0.68,hash(vec2(fi*6.91,7.8))*0.95-0.46);
      vec2 wander=vec2(sin(t*(0.19+seed*0.13)+fi*1.7),cos(t*(0.16+seed*0.11)+fi*2.3))*(0.055+p1*0.055);
      wander+=vec2(sin(t*0.07+fi),sin(t*0.09+fi*0.6))*0.035*p0;
      vec2 q=p-(home+wander);
      float pulse=pow(max(0.0,0.5+0.5*sin(t*(0.85+p2*0.8)+seed*19.0)),3.0);
      float core=exp(-length(q)*58.0), halo=exp(-length(q)*17.0)*0.30;
      float energy=pulse*(0.42+uMid*0.18+uHigh*0.16);
      flies+=(core+halo)*energy; flyCore+=core*energy;
    }
    a=flies*m; col=mix(uA,uB,clamp(flies*0.15,0.0,1.0)); col=mix(col,uC,clamp(flyCore*0.8,0.0,1.0));`);

      branch("MirrorFracture", 74.5, 75.5, `    // Angular fracture lines and shard facets generated continuously, not a square cell grid.
    float cracks=0.0; float facets=0.0;
    for(int i=0;i<9;i++){
      float fi=float(i), seed=hash(vec2(fi*4.73,2.5));
      float aa=seed*6.2831+(p2-0.5)*0.35;
      vec2 n=vec2(cos(aa),sin(aa));
      float offset=(hash(vec2(fi,8.2))-0.5)*(0.35+p0*0.30);
      float line=exp(-abs(dot(p,n)-offset)*(65.0+p1*55.0));
      float radial=exp(-abs(d-(0.18+seed*0.78))*28.0);
      cracks+=line*(0.35+radial*0.65);
      facets+=smoothstep(0.18,0.85,abs(sin(ang*(3.0+fi*0.33)+seed*5.0+d*(2.0+p0*2.0))))*0.08;
    }
    float rim=exp(-abs(d-(0.48+p0*0.08))*(12.0+p1*10.0));
    a=(cracks*0.48+facets+rim*0.22)*m; col=mix(uA,uB,clamp(facets,0.0,1.0)); col=mix(col,uC,clamp(cracks*0.55+rim,0.0,1.0));`);

      return { code: next, map: null };
    },
  };
}
