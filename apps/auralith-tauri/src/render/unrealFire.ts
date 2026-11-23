/** GLSL port of the Unreal Fire Studio material. UV.y already increases upward. */
export const unrealFire = /* glsl */`
float fireUnit(float x) { return clamp(x,0.,1.); }
float flame_hash(vec3 p) {
    p=fract(p*.3183099+vec3(.11,.27,.39))*17.;
    return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
}
float flame_value(vec3 p) {
    vec3 i=floor(p),f=fract(p);
    f=f*f*(3.-2.*f);
    return mix(mix(mix(flame_hash(i),flame_hash(i+vec3(1.0,0.0,0.0)),f.x),
                     mix(flame_hash(i+vec3(0.0,1.0,0.0)),flame_hash(i+vec3(1.0,1.0,0.0)),f.x),f.y),
                mix(mix(flame_hash(i+vec3(0.0,0.0,1.0)),flame_hash(i+vec3(1.0,0.0,1.0)),f.x),
                     mix(flame_hash(i+vec3(0.0,1.0,1.0)),flame_hash(i+1.),f.x),f.y),f.z);
}
float flame_fbm(vec3 p) {
    return flame_value(p)*.56+flame_value(p*2.07+8.4)*.27+flame_value(p*4.23-2.6)*.12+flame_value(p*8.7)*.05;
}

vec3 fireFlame(vec2 UV,float t) {
float x=(UV.x-.5)*2.; float y=UV.y;
if(y<.11 || y>.92 || abs(x)>.83) return vec3(0.);
float h=(y-.11)/.73;
float lift=smoothstep(0.,.11,h);
vec3 result=vec3(0.);
float trans=1.;
for(int i=0;i<30;i++) {
    float z=-.66+(float(i)+.5)*1.32/30.;
    vec3 p=vec3(x,z,h);
    float shift=(flame_value(vec3(3.,h*3.9-t*1.8,11.))- .49)*h*.64;
    p.x-=shift;
    p.y+=(flame_value(vec3(9.,h*3.2-t*1.4,4.))-.5)*h*.36;
    vec3 flow=p*vec3(4.3,4.3,6.4)-vec3(0.0,0.0,t*3.7);
    float turbulence=flame_fbm(flow);
    float small=flame_fbm(flow*1.4+vec3(turbulence*1.2,0.0,2.7));
    float width=(.34+.20*smoothstep(0.,.19,h))*pow(fireUnit(1.-h),.91)+.026;
    float radius=length(p.xy*vec2(1.,1.15));
    float limit=width*(.64+.72*turbulence);
    float plume=1.-smoothstep(limit*.57,limit*1.23,radius);
    float tongues=smoothstep(.38+h*.13,.66+h*.14,turbulence*.71+small*.29);
    float foot=smoothstep(.005,.085,h-(small-.48)*.12-abs(p.x)*.11);
    float folds=.28+.72*smoothstep(.08,.7,1.-abs(turbulence-.52)*5.);
    float density=plume*tongues*lift*foot*folds*(1.-smoothstep(.72,1.08,h));
    float heat=fireUnit((1.-h)*.43+small*.72+(1.-fireUnit(radius/width))*.17);
    // Light thin folds within the existing advected density field.
    float detail=flame_value(flow*3.8+vec3(small*1.8,turbulence*1.2,0.));
    float foldField=small*.74+detail*.26;
    float membrane=exp(-abs(foldField-.52)*49.);
    float filament=exp(-abs(foldField-.59)*78.);
    float edge=(membrane*.83+filament*.55)*smoothstep(.36,.63,turbulence);
    vec3 warm=mix(vec3(.76,.033,.0013),vec3(1.3,.28,.009),smoothstep(.28,.73,heat));
    vec3 gold=vec3(1.62,.64,.073);
    float alpha=1.-exp(-density*.115);
    result+=trans*alpha*(warm*(.47+heat*1.3)+gold*edge*2.65);
    trans*=1.-alpha*.72;
    if(trans<.025) break;
}
return result*1.18;
}
vec3 fireSmoke(vec2 UV,float t) {
float x=(UV.x-.5)*2.; float y=UV.y;
float h=(y-.31)/.67;
if(h<0. || h>1.) return vec3(0.);
float drift=(flame_fbm(vec3(h*2.4-t*.42,6.,5.))-.44)*(.25+1.3*h);
float w=.13+h*.31;
float envelope=exp(-pow((x-drift)/w,2.0))*smoothstep(0.,.22,h)*(1.-smoothstep(.57,1.,h));
float curl=flame_fbm(vec3(x*7.+1.2*sin(h*7.),h*7.9-t*.62,6.));
float folds=smoothstep(.38,.70,curl);
return vec3(.52,.43,.37)*envelope*folds*.047;
}
vec3 fireEmbers(vec2 UV,float t) {
float x=(UV.x-.5)*2.; float y=UV.y;
float result=0.;
for(int i=0;i<24;i++) {
    float id=float(i);
    float seed=flame_hash(vec3(id,1.,7.));
    float age=fract(t*(.30+seed*.37)+seed*12.6);
    float turn=flame_hash(vec3(id,9.,31.));
    float height=.13+age*(.36+turn*.47);
    float side=(seed-.5)*(.70+age*.69)+sin(age*3.2+id)*age*.18;
    vec2 delta=vec2(x-side,(y-height)*2.0);
    delta.x-=delta.y*(seed-.5)*.9;
    float dist=length(delta*vec2(1.8,.62));
    float spark=exp(-dist*(430.+turn*440.));
    result+=spark*smoothstep(0.,.05,age)*(1.-smoothstep(.44,1.,age));
}
return vec3(1.,.25,.018)*result*2.8;
}
`;
