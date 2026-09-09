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
    pub visual_output_ready: bool,
    pub migrated_effects: Vec<&'static str>,
    pub native_compute_ready: Vec<&'static str>,
}

const NATIVE_PARTICLE_COMPUTE: &str = include_str!("native_particles.wgsl");

#[tauri::command]
pub fn native_gpu_set_audio(
    state: State<'_, Arc<NativeGpuBridge>>,
    frame: NativeAudioFrame,
) -> Result<(), String> {
    let mut audio = state
        .audio
        .lock()
        .map_err(|_| "native GPU audio bridge lock failed".to_string())?;
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

    // Force WGSL validation and compute-pipeline creation during the probe. The shader
    // is the real effect-specific particle simulation contract, not a dummy add kernel.
    // A failed driver/compiler path therefore fails here before a live scene can select it.
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("Auralith Native Particle Physics"),
        source: wgpu::ShaderSource::Wgsl(NATIVE_PARTICLE_COMPUTE.into()),
    });
    let _pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some("Auralith Native Particle Physics Pipeline"),
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
        // Offscreen/native compositing into Auralith's scene canvas is the next gate.
        // Until that is complete, the production WebGL renderer remains the visual fallback.
        visual_output_ready: false,
        migrated_effects: vec![],
        native_compute_ready: vec![
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
