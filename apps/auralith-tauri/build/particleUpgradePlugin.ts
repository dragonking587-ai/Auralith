import type { Plugin } from "vite";

/**
 * Native-GPU test-branch fallback quality pass.
 *
 * The rc.49 hotfix rewrites renderer.ts before Vite runs, and Windows checkouts may
 * restore CRLF. Match effect branches structurally instead of matching the old source
 * byte-for-byte. This keeps the test build strict while allowing the official hotfix to
 * run first.
 *
 * Physical/luminous particles must not be represented by square hash cells. Intentional
 * digital effects (PixelDissolve, GlitchLight) are deliberately excluded.
 */
export function auralithParticleUpgradePlugin(): Plugin {
  return {
    name: "auralith-native-gpu-particle-quality",
    enforce: "pre",
    transform(code, id) {
      if (!id.replaceAll("\\", "/").endsWith("/src/render/renderer.ts")) return null;

      let next = code.replace(/\r\n/g, "\n");

      const replaceBranch = (label: string, current: number, following: number, body: string) => {
        const cur = String(current).replace(".", "\\.");
        const fol = String(following).replace(".", "\\.");
        const re = new RegExp(`  } else if \\(k < ${cur}\\) \\{[\\s\\S]*?(?=\\n  } else if \\(k < ${fol}\\))`);
        if (!re.test(next)) {
          throw new Error(`[native-gpu-testing] renderer particle branch not found after rc.49 hotfix: ${label}`);
        }
        next = next.replace(re, `  } else if (k < ${current}) {\n${body}`);
      };

      replaceBranch("EnergySparks", 25.5, 26.5, `    // Charged streaks with curved field motion; never cell-aligned square pixels.
    float sparkField=0.0; float sparkCore=0.0;
    for(int i=0;i<18;i++){
      float fi=float(i), seed=hash(vec2(fi*13.17+2.4,7.31));
      float life=fract(t*(0.34+p0*0.48+uHigh*0.34)+seed);
      float ang0=seed*6.2831+sin(t*(0.5+seed)+fi)*0.24*uMid;
      vec2 dir=vec2(cos(ang0),sin(ang0)), side=vec2(-dir.y,dir.x);
      float reach=0.10+life*(0.42+p1*0.58+uTransient*0.18);
      vec2 pos=dir*reach+side*sin(life*8.0+fi*1.7+t*2.0)*(0.012+uMid*0.025);
      vec2 q=p-pos; float along=dot(q,dir), across=abs(dot(q,side));
      float head=exp(-length(q)*(55.0+p2*30.0));
      float trail=exp(-across*(70.0+p2*45.0))*exp(-abs(along+0.055)*18.0)*smoothstep(0.06,-0.12,along);
      float fade=(1.0-life)*(0.35+uHigh*0.75+uTransient*0.65);
      sparkField+=(head+trail*0.62)*fade; sparkCore+=head*fade;
    }
    a=sparkField*m*0.72*exp(-d*0.35);
    col=mix(uA,uB,clamp(sparkField*0.35,0.0,1.0)); col=mix(col,uC,clamp(sparkCore,0.0,1.0));`);

      replaceBranch("Sparks", 33.5, 34.5, `    // Ballistic incandescent fragments with gravity, drag and stretched trails.
    float total=0.0; float hot=0.0;
    for(int i=0;i<20;i++){
      float fi=float(i), seed=hash(vec2(fi*9.71+4.2,fi*2.13+8.8));
      float life=fract(t*(0.42+p0*0.32+uHigh*0.18)+seed);
      float angle=mix(0.35,2.79,hash(vec2(seed,3.1)));
      float speed=(0.46+hash(vec2(seed,8.9))*0.70)*(0.72+p1*0.32+uTransient*0.50+uBeat*0.16);
      vec2 v0=vec2(cos(angle),sin(angle))*speed;
      vec2 pos=v0*life*0.72+vec2(0.0,-0.36*life*life)+vec2((seed-0.5)*0.08,-0.48);
      vec2 vel=v0+vec2(0.0,-0.72*life), dir=normalize(vel+vec2(0.0001)), side=vec2(-dir.y,dir.x);
      vec2 q=p-pos; float along=dot(q,dir), across=abs(dot(q,side));
      float head=exp(-length(q)*(70.0+p2*30.0));
      float trail=exp(-across*(95.0+p2*35.0))*exp(-abs(along+0.045)*24.0)*smoothstep(0.035,-0.14,along);
      float fade=pow(1.0-life,1.5)*step(0.18,seed);
      total+=(head+trail*0.58)*fade; hot+=head*fade;
    }
    a=total*m*(0.52+uHigh*0.35+uTransient*0.25);
    col=mix(uA,uB,clamp(total*0.22,0.0,1.0)); col=mix(col,uC,clamp(hot*0.8,0.0,1.0));`);

      replaceBranch("GlitterSparkle", 43.5, 44.5, `    // Diffraction glints: hot point core plus crossing rays, not block cells.
    float glints=0.0; float cores=0.0;
    for(int i=0;i<16;i++){
      float fi=float(i), sx=hash(vec2(fi*4.71,2.3))*1.7-0.85, sy=hash(vec2(fi*8.17,6.9))*1.25-0.62;
      vec2 q=p-vec2(sx,sy);
      float tw=pow(max(0.0,sin(t*(2.0+p1*3.0)+fi*2.17+hash(vec2(fi,1.0))*6.2831)),5.0)*(0.30+uHigh*0.85+uTransient*0.35);
      float core=exp(-length(q)*(95.0+p2*35.0));
      float rayX=exp(-abs(q.x)*(180.0+p0*70.0))*exp(-abs(q.y)*24.0);
      float rayY=exp(-abs(q.y)*(180.0+p0*70.0))*exp(-abs(q.x)*24.0);
      glints+=(core+(rayX+rayY)*0.38)*tw; cores+=core*tw;
    }
    a=glints*m*exp(-d*0.18); col=mix(uA,uB,clamp(glints*0.18,0.0,1.0)); col=mix(col,uC,clamp(cores,0.0,1.0));`);

      replaceBranch("Rain", 50.5, 51.5, `    // Anti-aliased slanted rain streaks with depth variation.
    float rain=0.0; float bright=0.0;
    for(int i=0;i<18;i++){
      float fi=float(i), seed=hash(vec2(fi*7.91,2.7));
      float phase=fract(t*(0.30+p0*0.42)*(0.72+seed*0.55)+seed);
      float x=hash(vec2(fi*3.17,9.4)), y=1.15-phase*1.35, wind=(p2-0.5)*0.18;
      vec2 q=uv-vec2(x+wind*(1.0-y),y); q.x+=q.y*wind;
      float width=0.0014+seed*0.0018, len=0.025+p1*0.055+seed*0.035;
      float streak=exp(-abs(q.x)/width)*exp(-abs(q.y)/len), depth=0.45+seed*0.75;
      rain+=streak*depth; bright+=streak*step(0.72,seed);
    }
    a=rain*m*(0.35+uHigh*0.22+uTransient*0.18); col=mix(uA,uB,clamp(rain*0.12,0.0,1.0)); col=mix(col,uC,clamp(bright*0.45,0.0,1.0));`);

      replaceBranch("Snow", 52.5, 53.5, `    // Rounded depth-scaled flakes with soft falloff and lateral drift.
    float snow=0.0; float nearSnow=0.0;
    for(int i=0;i<20;i++){
      float fi=float(i), seed=hash(vec2(fi*5.13,7.2)), depth=0.35+hash(vec2(fi,4.4))*0.65;
      float phase=fract(t*(0.035+p0*0.055)*(0.55+depth)+seed);
      float x=hash(vec2(fi*8.41,1.7))+sin(t*(0.22+seed*0.3)+fi)*0.018*(0.4+p1), y=1.08-phase*1.18;
      vec2 q=uv-vec2(fract(x),y); float size=mix(0.0018,0.0065,depth)*(0.65+p2*0.5);
      float flake=exp(-dot(q,q)/max(size*size,0.000001)); snow+=flake*(0.42+depth*0.58); nearSnow+=flake*depth;
    }
    a=snow*m*(0.42+uHigh*0.10); col=mix(uA,uB,clamp(snow*0.10,0.0,1.0)); col=mix(col,uC,clamp(nearSnow*0.32,0.0,1.0));`);

      replaceBranch("Ash", 53.5, 54.5, `    // Tumbling irregular ash flakes; occasional hot flecks respond to highs.
    float ash=0.0; float glow=0.0;
    for(int i=0;i<16;i++){
      float fi=float(i), seed=hash(vec2(fi*6.73,3.2)), life=fract(seed+t*(0.025+p0*0.055)*(0.7+seed*0.5));
      float x=hash(vec2(fi*2.91,8.4))+sin(t*(0.18+seed)+fi)*0.035*(0.5+p2), y=1.08-life*1.22;
      vec2 q=uv-vec2(fract(x),y); float rot=t*(0.6+seed)+fi;
      vec2 qr=vec2(q.x*cos(rot)-q.y*sin(rot),q.x*sin(rot)+q.y*cos(rot));
      float flake=exp(-abs(qr.x)*(260.0+p1*80.0))*exp(-abs(qr.y)*(150.0+p1*45.0));
      ash+=flake*(0.35+seed*0.5); glow+=flake*step(0.82,seed)*uHigh;
    }
    a=(ash*0.62+glow*0.35)*m; col=mix(uA,uB,clamp(ash*0.16,0.0,1.0)); col=mix(col,uC,clamp(glow,0.0,1.0));`);

      replaceBranch("DustMotes", 54.5, 55.5, `    // Soft bokeh motes floating through slow room currents.
    float motes=0.0; float bokeh=0.0;
    for(int i=0;i<18;i++){
      float fi=float(i), seed=hash(vec2(fi*9.37,5.1));
      vec2 base=vec2(hash(vec2(fi*3.11,2.0)),hash(vec2(fi*7.29,6.0)));
      vec2 pos=base+vec2(sin(t*(0.08+seed*0.08)+fi)*0.028,cos(t*(0.06+seed*0.07)+fi*1.7)*0.020);
      vec2 q=uv-fract(pos); q-=floor(q+vec2(0.5));
      float depth=0.25+hash(vec2(fi,9.0))*0.75, size=(0.0025+depth*0.006)*(0.65+p0*0.55);
      float core=exp(-dot(q,q)/max(size*size,0.000001)); float halo=exp(-dot(q,q)/max(size*size*5.0,0.000001))*0.22;
      motes+=core*(0.25+depth*0.55); bokeh+=halo*depth;
    }
    a=(motes+bokeh)*m*(0.32+p1*0.18); col=mix(uA,uB,clamp(bokeh*0.16,0.0,1.0)); col=mix(col,uC,clamp(motes*0.28,0.0,1.0));`);

      replaceBranch("BioluminescentSpores", 66.5, 67.5, `    // Soft living orbs with breathing cores and curl-like drift.
    float spores=0.0; float cores=0.0;
    for(int i=0;i<16;i++){
      float fi=float(i), seed=hash(vec2(fi*4.39,3.7));
      vec2 pos=vec2(hash(vec2(fi*8.31,1.2))*1.6-0.8,hash(vec2(fi*2.71,9.4))*1.15-0.58);
      pos+=vec2(sin(t*(0.18+seed*0.12)+fi)*0.055,cos(t*(0.14+seed*0.10)+fi*1.3)*0.045)*(0.45+p2*0.45);
      vec2 q=p-pos; float breath=0.45+0.55*(0.5+0.5*sin(t*(0.55+p0*0.55)+seed*13.0));
      float core=exp(-length(q)*(48.0+p1*22.0)), halo=exp(-length(q)*(13.0+p1*5.0))*0.28;
      float energy=breath*(0.35+uMid*0.35+uHigh*0.18); spores+=(core+halo)*energy; cores+=core*energy;
    }
    a=spores*m*exp(-d*0.15); col=mix(uA,uB,clamp(spores*0.18,0.0,1.0)); col=mix(col,uC,clamp(cores*0.65,0.0,1.0));`);

      replaceBranch("CelestialStars", 79.5, 80.5, `    // Sub-pixel stars with radial falloff and selective diffraction glints.
    float stars=0.0; float glint=0.0;
    for(int i=0;i<24;i++){
      float fi=float(i), seed=hash(vec2(fi*6.17,4.2));
      vec2 pos=vec2(hash(vec2(fi*2.71,1.7)),hash(vec2(fi*9.13,7.4))), q=uv-pos;
      float size=0.0018+hash(vec2(fi,5.0))*0.0038*(0.65+p0*0.6);
      float tw=(0.42+0.58*(0.5+0.5*sin(t*(0.45+p1*0.75)+seed*23.0)))*(0.65+uHigh*0.32);
      float core=exp(-dot(q,q)/max(size*size,0.0000004));
      float rayX=exp(-abs(q.x)/(size*0.28))*exp(-abs(q.y)/(size*4.5));
      float rayY=exp(-abs(q.y)/(size*0.28))*exp(-abs(q.x)/(size*4.5));
      stars+=core*tw; glint+=(rayX+rayY)*0.13*tw*step(0.72,seed);
    }
    a=(stars+glint)*m; col=mix(uA,uB,clamp(stars*0.16,0.0,1.0)); col=mix(col,uC,clamp(stars*0.55+glint*0.35,0.0,1.0));`);

      return { code: next, map: null };
    },
  };
}
