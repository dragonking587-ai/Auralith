use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::State;

/// Audio data is pushed from the existing low-latency analyzer into Rust. The native
/// renderer consumes the same normalized bands as the WebGL fallback, so effects can
/// migrate one at a time without changing scene files or audio routing.
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioFrame {
    pub raw: f32,
    pub rms: f32,
    pub bass: f32,
    pub low: f32,
    pub mid: f32,
    pub high: f32,
    pub full_mix: f32,
    pub beat: f32,
    pub transient: f32,
}

#[derive(Default)]
pub struct NativeGpuBridge {
    audio: Mutex<NativeAudioFrame>,
}

impl NativeGpuBridge {
    pub fn latest_audio(&self) -> NativeAudioFrame {
        self.audio.lock().map(|v| *v).unwrap_or_default()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeGpuInfo {
    pub available: bool,
    pub adapter: String,
    pub backend: String,
    pub device_type: String,
    pub driver: String,
    pub driver_info: String,
    pub compute_pipeline_ok: bool,
    pub migrated_effects: Vec<&'static str>,
    pub next_particle_upgrades: Vec<&'static str>,
}

// This small compute kernel is intentionally effect-shaped instead of a meaningless
// arithmetic smoke test. It is the common particle-state contract for Sparks, Embers,
// Energy Sparks, Dust Motes, Ash, Snow, Fireflies, Spores and Celestial Stars. Each
// migrated effect will use its own forces/material/render pass rather than a generic
// square sprite emitter.
const PARTICLE_COMPUTE_SMOKE_TEST: &str = r#"
struct AudioFrame {
    bands: vec4<f32>,
    impulses: vec4<f32>,
};

struct Particle {
    position_life: vec4<f32>,
    velocity_heat: vec4<f32>,
};

@group(0) @binding(0) var<uniform> audio: AudioFrame;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

fn hash11(v: f32) -> f32 {
    return fract(sin(v * 91.3458 + 17.173) * 47453.5453);
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= arrayLength(&particles)) { return; }

    var p = particles[i];
    let seed = f32(i) + 1.0;
    let dt = 1.0 / 60.0;
    let bass = clamp(audio.bands.x, 0.0, 1.0);
    let high = clamp(audio.bands.w, 0.0, 1.0);
    let beat = clamp(audio.impulses.x, 0.0, 1.0);
    let transient = clamp(audio.impulses.y, 0.0, 1.0);

    p.velocity_heat.y += (0.22 + bass * 0.38) * dt;
    p.velocity_heat.x += (hash11(seed * 3.7) - 0.5) * (0.08 + high * 0.12) * dt;
    p.position_life.xy += p.velocity_heat.xy * dt;
    p.position_life.w -= dt * (0.35 + hash11(seed) * 0.28);
    p.velocity_heat.w = max(0.0, p.velocity_heat.w - dt * 0.30);

    if (p.position_life.w <= 0.0 || beat > 0.92 || transient > 0.94) {
        let side = hash11(seed * 5.3) - 0.5;
        p.position_life = vec4<f32>(side * 0.35, -0.55, 0.0, 0.65 + hash11(seed * 7.1) * 0.55);
        p.velocity_heat = vec4<f32>(side * (0.16 + high * 0.20), 0.45 + bass * 0.65, 0.0, 0.75 + transient * 0.25);
    }
    particles[i] = p;
}
"#;

#[tauri::command]
pub fn native_gpu_set_audio(
    state: State<'_, Arc<NativeGpuBridge>>,
    frame: NativeAudioFrame,
) -> Result<(), String> {
    let mut audio = state.audio.lock().map_err(|_| "native GPU audio bridge lock failed".to_string())?;
    *audio = NativeAudioFrame {
        raw: frame.raw.clamp(0.0, 1.0),
        rms: frame.rms.clamp(0.0, 1.0),
        bass: frame.bass.clamp(0.0, 1.0),
        low: frame.low.clamp(0.0, 1.0),
        mid: frame.mid.clamp(0.0, 1.0),
        high: frame.high.clamp(0.0, 1.0),
        full_mix: frame.full_mix.clamp(0.0, 1.0),
        beat: frame.beat.clamp(0.0, 1.0),
        transient: frame.transient.clamp(0.0, 1.0),
    };
    Ok(())
}

#[tauri::command]
pub fn native_gpu_latest_audio(state: State<'_, Arc<NativeGpuBridge>>) -> NativeAudioFrame {
    state.latest_audio()
}

/// Probe on demand. Nothing in Auralith startup depends on this succeeding: a missing
/// adapter, old driver or pipeline failure returns an error and the existing renderer
/// remains available.
#[tauri::command]
pub async fn native_gpu_probe() -> Result<NativeGpuInfo, String> {
    let instance = wgpu::Instance::default();
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: None,
            force_fallback_adapter: false,
        })
        .await
        .ok_or_else(|| "No compatible high-performance native GPU adapter was found.".to_string())?;

    let info = adapter.get_info();
    let (device, _queue) = adapter
        .request_device(
            &wgpu::DeviceDescriptor {
                label: Some("Auralith Native GPU Experimental Device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
            },
            None,
        )
        .await
        .map_err(|e| format!("Native GPU device creation failed: {e}"))?;

    // Force WGSL validation and compute-pipeline creation during the probe. This catches
    // unsupported shader/compiler paths before an effect is selected live.
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("Auralith Native Particle Compute Smoke Test"),
        source: wgpu::ShaderSource::Wgsl(PARTICLE_COMPUTE_SMOKE_TEST.into()),
    });
    let _pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some("Auralith Native Particle Compute Smoke Test Pipeline"),
        layout: None,
        module: &shader,
        entry_point: "cs_main",
    });

    Ok(NativeGpuInfo {
        available: true,
        adapter: info.name,
        backend: format!("{:?}", info.backend),
        device_type: format!("{:?}", info.device_type),
        driver: info.driver,
        driver_info: info.driver_info,
        compute_pipeline_ok: true,
        migrated_effects: vec!["RealisticFlame"],
        next_particle_upgrades: vec![
            "Sparks",
            "EnergySparks",
            "Embers",
            "GlitterSparkle",
            "DustMotes",
            "Ash",
            "Snow",
            "BioluminescentSpores",
            "CelestialStars",
        ],
    })
}
