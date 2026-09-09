// Auralith native particle simulation foundation.
//
// This file intentionally contains effect-specific physics. The goal is to avoid the
// old "random square pixels" look by evolving real particle state that the native
// renderer can draw as incandescent streaks, soft discs, bokeh motes, flakes or star
// glints depending on the selected effect.

struct AudioFrame {
    bands: vec4<f32>,      // bass, low, mid, high
    impulses: vec4<f32>,   // beat, transient, fullMix, rms
};

struct SimParams {
    dt_time: vec4<f32>,    // dt, time, quality, effect_kind
    controls: vec4<f32>,   // amount, speed, spread, size
    origin_extent: vec4<f32>, // origin x/y, extent x/y
};

struct Particle {
    position_life: vec4<f32>, // x, y, depth, life
    velocity_size: vec4<f32>, // vx, vy, vz, size
    material: vec4<f32>,      // heat, alpha, stretch, seed
};

@group(0) @binding(0) var<uniform> audio: AudioFrame;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<uniform> sim: SimParams;

fn hash11(v: f32) -> f32 {
    return fract(sin(v * 91.3458 + 17.173) * 47453.5453);
}

fn hash21(v: f32) -> vec2<f32> {
    return vec2<f32>(hash11(v * 1.37 + 2.1), hash11(v * 2.71 + 8.7));
}

fn curlish(p: vec2<f32>, t: f32, seed: f32) -> vec2<f32> {
    let a = sin(p.y * 3.7 + t * 1.17 + seed * 5.1);
    let b = cos(p.x * 4.3 - t * 0.93 + seed * 3.2);
    return vec2<f32>(a + b * 0.45, b - a * 0.35);
}

fn respawn(i: u32, kind: u32, t: f32) -> Particle {
    let seed = f32(i) + floor(t * 7.0) * 0.03125;
    let r = hash21(seed);
    let r2 = hash21(seed * 3.17 + 11.0);
    let bass = clamp(audio.bands.x, 0.0, 1.0);
    let low = clamp(audio.bands.y, 0.0, 1.0);
    let mid = clamp(audio.bands.z, 0.0, 1.0);
    let high = clamp(audio.bands.w, 0.0, 1.0);
    let beat = clamp(audio.impulses.x, 0.0, 1.0);
    let transient = clamp(audio.impulses.y, 0.0, 1.0);
    let spread = 0.18 + sim.controls.z * 0.65;
    let amount = 0.2 + sim.controls.x * 0.8;

    var p: Particle;
    p.position_life = vec4<f32>(0.0, 0.0, r2.x * 2.0 - 1.0, 1.0);
    p.velocity_size = vec4<f32>(0.0, 0.0, 0.0, 0.012 + r2.y * 0.026);
    p.material = vec4<f32>(0.5, amount, 1.0, r.x);

    // 0 Sparks: ballistic metal sparks with gravity, drag and long hot streaks.
    if (kind == 0u) {
        let angle = mix(0.38, 2.76, r.x);
        let speed = (0.75 + r.y * 1.35) * (0.8 + transient * 0.85 + beat * 0.25);
        p.position_life.xy = vec2<f32>((r2.x - 0.5) * 0.08, -0.28 + r2.y * 0.06);
        p.velocity_size.xyz = vec3<f32>(cos(angle) * speed * spread, sin(angle) * speed, (r2.x - 0.5) * 0.18);
        p.velocity_size.w = 0.006 + r2.y * 0.013;
        p.position_life.w = 0.34 + r.y * 0.52;
        p.material = vec4<f32>(0.95, 1.0, 2.8 + r.x * 5.5, r.x);
    }
    // 1 Energy Sparks: charged particles accelerate away from a field source and arc.
    else if (kind == 1u) {
        let angle = r.x * 6.2831853;
        let speed = 0.28 + high * 0.62 + transient * 0.55 + r.y * 0.25;
        p.position_life.xy = vec2<f32>(cos(angle), sin(angle)) * (0.03 + r2.x * 0.09);
        p.velocity_size.xyz = vec3<f32>(cos(angle) * speed, sin(angle) * speed, (r2.y - 0.5) * 0.22);
        p.velocity_size.w = 0.004 + r2.y * 0.010;
        p.position_life.w = 0.22 + r.y * 0.38;
        p.material = vec4<f32>(1.0, 1.0, 3.5 + high * 5.0, r.x);
    }
    // 2 Embers: buoyant, heat-cooling particles with lateral air drift.
    else if (kind == 2u) {
        p.position_life.xy = vec2<f32>((r.x - 0.5) * 0.45, -0.35 + r2.y * 0.08);
        p.velocity_size.xyz = vec3<f32>((r2.x - 0.5) * 0.14, 0.24 + low * 0.38 + r.y * 0.18, (r2.y - 0.5) * 0.12);
        p.velocity_size.w = 0.008 + r2.x * 0.022;
        p.position_life.w = 0.75 + r.y * 0.95;
        p.material = vec4<f32>(0.92, 0.85, 1.4, r.x);
    }
    // 3 Glitter: stationary/micro-drifting diffraction glints, not square cells.
    else if (kind == 3u) {
        p.position_life.xy = (r * 2.0 - 1.0) * vec2<f32>(0.72, 0.48);
        p.velocity_size.xyz = vec3<f32>((r2.x - 0.5) * 0.012, (r2.y - 0.5) * 0.010, 0.0);
        p.velocity_size.w = 0.006 + r2.x * 0.015;
        p.position_life.w = 0.32 + r.y * 0.82;
        p.material = vec4<f32>(0.78 + high * 0.22, 0.35 + high * 0.65, 4.0 + r.x * 5.0, r.y);
    }
    // 4 Dust: soft bokeh motes following slow turbulent room currents.
    else if (kind == 4u) {
        p.position_life.xy = (r * 2.0 - 1.0) * vec2<f32>(0.82, 0.55);
        p.velocity_size.xyz = vec3<f32>((r2.x - 0.5) * 0.025, 0.010 + r2.y * 0.025, (r2.x - 0.5) * 0.025);
        p.velocity_size.w = 0.018 + r2.y * 0.042;
        p.position_life.w = 2.5 + r.y * 3.5;
        p.material = vec4<f32>(0.12, 0.18 + amount * 0.34, 0.35, r.x);
    }
    // 5 Ash: tumbling flakes with gravity, lift pockets and irregular lateral drift.
    else if (kind == 5u) {
        p.position_life.xy = vec2<f32>((r.x - 0.5) * 1.55, 0.62 + r2.y * 0.12);
        p.velocity_size.xyz = vec3<f32>((r2.x - 0.5) * 0.06, -(0.08 + r.y * 0.12), (r2.y - 0.5) * 0.10);
        p.velocity_size.w = 0.012 + r2.x * 0.032;
        p.position_life.w = 2.0 + r.y * 2.6;
        p.material = vec4<f32>(high * 0.35, 0.32 + amount * 0.35, 0.7 + r.y * 1.2, r.x);
    }
    // 6 Snow: rounded flakes with depth-scaled fall speed and sinusoidal drift.
    else if (kind == 6u) {
        p.position_life.xy = vec2<f32>((r.x - 0.5) * 1.75, 0.72 + r2.y * 0.10);
        p.velocity_size.xyz = vec3<f32>((r2.x - 0.5) * 0.025, -(0.09 + r.y * 0.14), (r2.y - 0.5) * 0.05);
        p.velocity_size.w = 0.014 + r2.x * 0.035;
        p.position_life.w = 3.0 + r.y * 3.0;
        p.material = vec4<f32>(0.0, 0.65 + amount * 0.28, 0.35 + r.x * 0.55, r.y);
    }
    // 7 Bioluminescent spores: buoyant glowing organisms with slow curl motion.
    else if (kind == 7u) {
        p.position_life.xy = (r * 2.0 - 1.0) * vec2<f32>(0.66, 0.46);
        p.velocity_size.xyz = vec3<f32>((r2.x - 0.5) * 0.035, 0.018 + r2.y * 0.042, (r2.y - 0.5) * 0.04);
        p.velocity_size.w = 0.012 + r2.x * 0.028;
        p.position_life.w = 1.8 + r.y * 3.0;
        p.material = vec4<f32>(0.18 + mid * 0.35, 0.45 + amount * 0.45, 0.55, r.x);
    }
    // 8 Celestial stars: depth-layered point lights with diffraction/glint material data.
    else {
        p.position_life.xy = (r * 2.0 - 1.0) * vec2<f32>(0.96, 0.72);
        p.velocity_size.xyz = vec3<f32>(0.0, 0.0, 0.0);
        p.velocity_size.w = 0.003 + pow(r2.x, 3.0) * 0.018;
        p.position_life.w = 2.0 + r.y * 5.0;
        p.material = vec4<f32>(0.65 + high * 0.35, 0.45 + amount * 0.5, 2.0 + r.x * 5.0, r.y);
    }
    return p;
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= arrayLength(&particles)) { return; }

    let dt = clamp(sim.dt_time.x, 0.001, 0.05);
    let t = sim.dt_time.y;
    let kind = u32(clamp(sim.dt_time.w, 0.0, 8.0));
    let bass = clamp(audio.bands.x, 0.0, 1.0);
    let low = clamp(audio.bands.y, 0.0, 1.0);
    let mid = clamp(audio.bands.z, 0.0, 1.0);
    let high = clamp(audio.bands.w, 0.0, 1.0);
    let beat = clamp(audio.impulses.x, 0.0, 1.0);
    let transient = clamp(audio.impulses.y, 0.0, 1.0);

    var p = particles[i];
    let seed = p.material.w + f32(i) * 0.0137;

    if (p.position_life.w <= 0.0) {
        particles[i] = respawn(i, kind, t);
        return;
    }

    var force = vec2<f32>(0.0, 0.0);
    let curl = curlish(p.position_life.xy, t, seed);

    if (kind == 0u) {
        // Sparks: gravity + drag; transient creates fresh energetic trajectories.
        force += vec2<f32>(curl.x * 0.025 * high, -0.92);
        p.velocity_size.xy *= exp(-dt * 0.85);
        p.material.x = max(0.0, p.material.x - dt * (0.9 + high * 0.25));
        p.position_life.w -= dt * (1.0 + transient * 0.18);
    } else if (kind == 1u) {
        // Energy Sparks: outward electromagnetic pressure with curved field motion.
        let radial = normalize(p.position_life.xy + vec2<f32>(0.0001, 0.0001));
        force += radial * (0.38 + high * 0.65 + transient * 0.85) + curl * (0.16 + mid * 0.24);
        p.velocity_size.xy *= exp(-dt * 1.4);
        p.position_life.w -= dt * (1.55 + high * 0.45);
        p.material.x = 0.65 + high * 0.35;
    } else if (kind == 2u) {
        // Embers: buoyancy from retained heat, turbulence from mids, gentle drag.
        force += vec2<f32>(curl.x * (0.045 + mid * 0.07), 0.10 + p.material.x * (0.18 + low * 0.15));
        p.velocity_size.xy *= exp(-dt * 0.42);
        p.material.x = max(0.0, p.material.x - dt * 0.22);
        p.position_life.w -= dt * 0.55;
    } else if (kind == 3u) {
        force += curl * (0.002 + high * 0.005);
        p.velocity_size.xy *= exp(-dt * 1.7);
        p.position_life.w -= dt * (0.75 + high * 0.45);
        p.material.y = clamp(0.18 + high * 0.72 + transient * 0.28, 0.0, 1.0);
    } else if (kind == 4u) {
        force += curl * (0.008 + mid * 0.012) + vec2<f32>(0.0, 0.003 + low * 0.006);
        p.velocity_size.xy *= exp(-dt * 0.18);
        p.position_life.w -= dt * 0.28;
    } else if (kind == 5u) {
        force += curl * (0.022 + mid * 0.035) + vec2<f32>(0.0, -0.035 + low * 0.025);
        p.velocity_size.xy *= exp(-dt * 0.28);
        p.position_life.w -= dt * 0.38;
        p.material.z = 0.55 + abs(sin(t * (1.2 + seed) + seed * 8.0)) * 1.4;
    } else if (kind == 6u) {
        force += vec2<f32>(sin(t * (0.55 + seed) + seed * 11.0) * (0.008 + mid * 0.006), -0.012);
        p.velocity_size.xy *= exp(-dt * 0.08);
        p.position_life.w -= dt * 0.25;
    } else if (kind == 7u) {
        force += curl * (0.012 + mid * 0.018) + vec2<f32>(0.0, 0.008 + low * 0.009);
        p.velocity_size.xy *= exp(-dt * 0.16);
        p.position_life.w -= dt * 0.30;
        p.material.y = 0.35 + 0.55 * (0.5 + 0.5 * sin(t * (1.1 + seed) + seed * 15.0));
    } else {
        // Stars hold position; high-frequency energy controls real glint intensity rather
        // than spawning blocky cells.
        p.velocity_size.xy = vec2<f32>(0.0, 0.0);
        p.position_life.w -= dt * 0.16;
        p.material.y = clamp(0.32 + high * 0.35 + 0.38 * (0.5 + 0.5 * sin(t * (0.8 + seed) + seed * 31.0)), 0.0, 1.0);
    }

    p.velocity_size.xy += force * dt;
    p.position_life.xy += p.velocity_size.xy * dt;

    let outOfBounds = abs(p.position_life.x) > 1.15 || abs(p.position_life.y) > 0.95;
    let impulseRespawn = (kind <= 2u) && (beat > 0.985 || transient > 0.985) && hash11(seed + t) > 0.84;
    if (outOfBounds || impulseRespawn) {
        p = respawn(i, kind, t);
    }

    particles[i] = p;
}
