import * as THREE from "three";
import { normalizePortalComponents, normalizePortalMistSpeed, portalComponents, PORTAL_MIST, type EffectInstance } from "../scene/types";

// GLSL port of the Unreal Portal Studio material. Each pass keeps its own
// color and audio envelope so the opening remains transparent over a scene.
const fragmentShader = /* glsl */`
uniform float uTime, uOpacity, uPhase, uCycle, uRimWidth, uSwirl, uRadius;
uniform float uLevels[5];
uniform vec3 uColors[5];
varying vec2 vUv;

float unit(float value) { return clamp(value, 0.0, 1.0); }

vec3 portal(vec2 UV, float Layer, vec3 Tint, float AudioLevel) {
    float Clock = uTime;
    float Speed = Layer == 3.0 ? uSwirl : 1.0;
    float AudioInfluence = 1.0;
    float Energy = Layer == 3.0 ? 0.72 : (Layer == 4.0 ? 0.74 : 1.0);
    float ColorPhase = uPhase;
    float ColorCycle = uCycle;

vec2 p = (UV-.5)*2.0;
float a = atan(p.y,p.x);
float t = Clock*Speed;
float breath = unit(AudioLevel) * unit(AudioInfluence);
float angle = a - t*.38;
float radius = length(p);
float ripple = .017*sin(7.0*angle+1.7*sin(3.0*a+t))
             + .012*cos(19.0*angle-2.0*t) + .005*sin(53.0*angle+4.0*t);
float d = radius-.64-ripple-breath*(Layer < .5 ? .024 : .045);
float n = sin(11.0*angle+sin(5.0*a+t)*1.7);
vec3 hot = mix(Tint.rgb,vec3(.78,.91,1.0),.75);
if (Layer > 3.5) {
    float inside = 1.0-smoothstep(.535,.59,radius);
    float heading = t*.19;
    float energy = 0.0;
    for (int i=0; i<6; i++) {
        float fi = float(i);
        float cycle = t*(1.1+.11*fi)+fi*.381966;
        float seed = floor(cycle);
        float age = fract(cycle);
        float progress = smoothstep(.025,.30,age);
        float strength = smoothstep(0.,.10,age)*(1.-smoothstep(.73,1.,age));
        float h = fract(sin(seed*71.3+fi*42.7+2.6)*43758.5453);
        float direction = heading + fi*1.0472 + (h-.5)*1.1;
        vec2 axis = vec2(cos(direction),sin(direction));
        float along = dot(p,axis);
        float across = dot(p,vec2(-axis.y,axis.x));
        float reach = (.34+.25*h)*(1.0+.08*progress);
        float x = unit(along/reach);
        float cells = x*12.;
        float index = floor(cells);
        float j0 = fract(sin(index*128.7+h*95.1)*43758.5453)-.5;
        float j1 = fract(sin((index+1.0)*128.7+h*95.1)*43758.5453)-.5;
        float jag = mix(j0,j1,fract(cells))*.065*smoothstep(0.,.16,x);
        float width = mix(.0017,.0042,progress)*(1.-.45*x);
        float leading = 1.0-smoothstep(progress-.08,progress+.035,x);
        float main = exp(-abs(across-jag)/width)*leading;
        float forkStart = .24+.27*h;
        float branchX = max(0.,x-forkStart);
        float branchSide = h < .5 ? -1. : 1.;
        float forkLine = jag+branchSide*branchX*(.20+.17*h)+sin(branchX*55.)*.009;
        float forkMask = smoothstep(forkStart,forkStart+.035,x)*(1.0-smoothstep(forkStart+.25,forkStart+.36,x));
        float fork = exp(-abs(across-forkLine)/(width*.72))*forkMask*leading;
        float bounds = step(0.,along)*(1.0-smoothstep(.90,1.,x));
        float current = .66+.34*sin(46.*x-t*13.+fi);
        energy += (main+.55*fork)*bounds*(.28+.72*h)*strength*current;
    }
    float coreRadius = .015+.005*sin(t*5.3);
    float core = exp(-radius/coreRadius)*.35;
    return mix(Tint.rgb,hot,.34)*Energy*inside*((energy*.78+core)*(1.+.85*breath));
}
if (Layer > 2.5) {
    float inner = smoothstep(.14,.36,radius)*(1.0-smoothstep(.49,.63,radius));
    float wind = a*3.0+radius*16.0+t*.95;
    float curl = sin(wind+sin(a*5.0-radius*31.0-t)*.65);
    float sheet = exp(-abs(curl)*4.6);
    float turbulence = .58+.26*sin(a*13.0+radius*38.0-t*2.0)+.16*cos(a*27.0-radius*51.0+t*3.0);
    float tail = pow(.5+.5*sin(a*2.0-radius*11.0+t*.53),2.6);
    float phase = ColorPhase*6.2831853;
    vec3 hue = .5+.5*cos(phase+vec3(0.0,4.18879,2.094395));
    vec3 mistColor = mix(Tint.rgb, mix(Tint.rgb*.25,hue,.75), unit(ColorCycle));
    return mistColor*Energy*inner*(sheet*turbulence*tail*.48
           + pow(unit(turbulence),3.0)*.025)*(1.0+1.35*breath);
}
if (Layer < .5) {
    float cord = exp(-abs(d)*280.0/max(.35,uRimWidth))*(0.39+0.61*pow(.5+.5*n,1.5));
    float second = exp(-abs(d-.015-.008*sin(17.0*angle))*155.0);
    float halo = exp(-abs(d)*54.0);
    float lace = exp(-abs(d+.008*sin(36.0*angle+t)+.013)*195.0);
    return Energy*(1.0+.24*breath)*(hot*cord*4.2+Tint.rgb*(second*.94+halo*.44+lace*.7));
}
if (Layer < 1.5) {
    float gate = pow(.5+.5*sin(9.0*angle+1.7*sin(4.0*angle+t)),3.0);
    float flow = sin(18.0*angle + 41.0*d + 1.8*sin(29.0*d-6.0*angle) - 2.0*t);
    float filament = exp(-abs(flow)*7.0)*exp(-abs(d)*16.0);
    float smoke = pow(.5+.5*sin(22.0*angle + d*38.0 + sin(63.0*d-5.0*a)),2.2);
    float mask = smoothstep(-.17,-.035,d)*(1.0-smoothstep(.035,.21,d));
    return Tint.rgb*Energy*(1.0+.55*breath)*mask*(filament*.40+smoke*gate*exp(-abs(d)*9.0)*.66);
}
float wedge = (angle+3.14159265)*12.732395;
float id = floor(wedge);
float h = fract(sin(id*127.1)*43758.5453);
float life = fract(t*(.48+.32*h)+h*9.17);
float dSpark = radius-(.67+life*(.08+.25*h));
float x = (fract(wedge)-.5-.25*sin(life*3.0+h*6.0))*radius*.079;
float streak=exp(-sqrt(x*x*3.5+dSpark*dSpark*.28)*695.0);
float bright=sin(life*3.14159)*step(.46,h);
return mix(Tint.rgb,hot,.55)*Energy*streak*bright*3.5*(1.+1.1*breath);

}
void main() {
    vec2 uv = (vUv - .5) / uRadius + .5;
    if (length(uv - .5) > .52) discard;
    vec3 energy = vec3(0.);
    for (int i = 0; i < 5; i++) {
        energy += portal(uv, float(i), uColors[i], uLevels[i]);
    }
    vec3 color = 1.0 - exp(-energy * uOpacity);
    if (max(color.r, max(color.g, color.b)) < .002) discard;
    gl_FragColor = vec4(color, 1.);
}
`;

export function makeCinematicPortal(vertexShader: string) {
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: {
      uTime: { value: 0 }, uOpacity: { value: 0 }, uPhase: { value: 0.58 }, uCycle: { value: 0 },
      uRimWidth: { value: 1 }, uSwirl: { value: 1 }, uRadius: { value: 1 },
      uLevels: { value: [0, 0, 0, 0, 0] },
      uColors: { value: normalizePortalComponents(undefined).map(({ color }) => new THREE.Color(color)) },
    },
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, toneMapped: false,
  });
}


export function updateCinematicPortal(material: THREE.ShaderMaterial, effect: EffectInstance,
  time: number, dt: number, opacity: number, level: (audio: string) => number, override?: string) {
  const u = material.uniforms;
  const components = portalComponents(effect);
  const influence = Math.max(0, Math.min(1, effect.audioInfluence));
  components.forEach(({color, audio}, index) => {
    u.uColors.value[index].set(index === 0 && override ? override : color);
    const target = audio === "Manual" ? 0 : Math.max(0, Math.min(1, level(audio))) * influence;
    const current = u.uLevels.value[index];
    u.uLevels.value[index] = current + (target - current) * (1 - Math.exp(-dt / (target > current ? 0.06 : 0.24)));
  });
  const speed = normalizePortalMistSpeed(effect.portalMistSpeed);
  u.uCycle.value = speed > 0 ? 0.65 : 0;
  u.uPhase.value = (u.uPhase.value + dt * u.uLevels.value[PORTAL_MIST] * speed) % 1;
  u.uOpacity.value = Math.max(0, opacity);
  u.uTime.value = time;
  u.uRadius.value = Math.max(.25, Math.min(1.6, (effect.p0 ?? .65) + .35));
  u.uRimWidth.value = Math.max(.35, Math.min(2.5, .5 + (effect.p1 ?? .5)));
  u.uSwirl.value = Math.max(.1, .6 + (effect.p2 ?? .4));
}
