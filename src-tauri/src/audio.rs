use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

static RUNNING: AtomicBool = AtomicBool::new(false);
static GEN: AtomicU64 = AtomicU64::new(0);
static DEVICE_ID: Mutex<Option<String>> = Mutex::new(None);

#[derive(Clone, Serialize)]
pub struct LoopbackDevice {
    pub id: String,
    pub name: String,
    #[serde(rename = "isDefault")]
    pub is_default: bool,
}

#[derive(Clone, Serialize)]
struct Bands {
    bass: f32,
    low: f32,
    mid: f32,
    high: f32,
}

pub fn list_devices() -> Result<Vec<LoopbackDevice>, String> {
    #[cfg(windows)]
    {
        list_windows_devices()
    }
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

pub fn start(app: AppHandle, device_id: Option<String>) -> Result<(), String> {
    {
        let mut guard = DEVICE_ID.lock().map_err(|e| e.to_string())?;
        *guard = device_id.filter(|s| !s.is_empty() && s != "default");
    }
    let gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
    RUNNING.store(true, Ordering::SeqCst);

    #[cfg(windows)]
    {
        std::thread::spawn(move || {
            if let Err(e) = windows_loopback(app.clone(), gen) {
                eprintln!("[auralith] loopback: {e}");
                let _ = app.emit("loopback-error", e);
            }
            if GEN.load(Ordering::SeqCst) == gen {
                RUNNING.store(false, Ordering::SeqCst);
            }
        });
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = (app, gen);
        RUNNING.store(false, Ordering::SeqCst);
        Err("System audio loopback is implemented for Windows.".into())
    }
}

pub fn stop() {
    GEN.fetch_add(1, Ordering::SeqCst);
    RUNNING.store(false, Ordering::SeqCst);
}

fn perceptual(v: f32) -> f32 {
    if v <= 0.0 {
        0.0
    } else {
        v.sqrt().min(1.0)
    }
}

fn still_running(gen: u64) -> bool {
    RUNNING.load(Ordering::Relaxed) && GEN.load(Ordering::SeqCst) == gen
}

#[cfg(windows)]
fn list_windows_devices() -> Result<Vec<LoopbackDevice>, String> {
    use wasapi::*;
    let _ = initialize_mta();
    let default_id = get_default_device(&Direction::Render)
        .ok()
        .and_then(|d| d.get_id().ok());
    let col = DeviceCollection::new(&Direction::Render).map_err(|e| format!("{e:?}"))?;
    let n = col.get_nbr_devices().map_err(|e| format!("{e:?}"))?;
    let mut out = Vec::new();
    for i in 0..n {
        let Some(dev) = col.get_device_at_index(i).ok() else {
            continue;
        };
        let id = dev.get_id().unwrap_or_default();
        let name = dev.get_friendlyname().unwrap_or_else(|_| "Output".into());
        let is_default = default_id.as_ref().is_some_and(|d| d == &id);
        out.push(LoopbackDevice {
            id,
            name,
            is_default,
        });
    }
    if out.is_empty() {
        if let Some(id) = default_id {
            out.push(LoopbackDevice {
                id,
                name: "Default output".into(),
                is_default: true,
            });
        }
    }
    Ok(out)
}

#[cfg(windows)]
fn open_render_device() -> Result<wasapi::Device, String> {
    use wasapi::*;
    let wanted = DEVICE_ID.lock().ok().and_then(|g| g.clone());
    if let Some(id) = wanted {
        let col = DeviceCollection::new(&Direction::Render).map_err(|e| format!("{e:?}"))?;
        let n = col.get_nbr_devices().map_err(|e| format!("{e:?}"))?;
        for i in 0..n {
            if let Ok(dev) = col.get_device_at_index(i) {
                if dev.get_id().ok().as_deref() == Some(id.as_str()) {
                    return Ok(dev);
                }
            }
        }
    }
    get_default_device(&Direction::Render).map_err(|e| format!("{e:?}"))
}

/// WASAPI loopback of a render (output) device.
/// Capture-on-render + shared mode sets AUDCLNT_STREAMFLAGS_LOOPBACK.
/// Polling is used because event callbacks are unreliable for loopback.
#[cfg(windows)]
fn windows_loopback(app: AppHandle, gen: u64) -> Result<(), String> {
    use realfft::RealFftPlanner;
    use std::collections::VecDeque;
    use std::time::Duration;
    use wasapi::*;

    initialize_mta().map_err(|e| format!("{e:?}"))?;
    let device = open_render_device()?;
    let mut audio_client = device.get_iaudioclient().map_err(|e| format!("{e:?}"))?;
    let sample_rate = 48000usize;
    let channels = 2usize;
    let desired = WaveFormat::new(32, 32, &SampleType::Float, sample_rate, channels, None);
    let mode = StreamMode::PollingShared {
        autoconvert: true,
        buffer_duration_hns: 1_000_000,
    };
    audio_client
        .initialize_client(&desired, &Direction::Capture, &mode)
        .map_err(|e| format!("{e:?}"))?;
    let capture = audio_client
        .get_audiocaptureclient()
        .map_err(|e| format!("{e:?}"))?;
    audio_client.start_stream().map_err(|e| format!("{e:?}"))?;

    let fft_size = 2048usize;
    let hop = fft_size / 2;
    let mut planner = RealFftPlanner::<f32>::new();
    let r2c = planner.plan_fft_forward(fft_size);
    let mut fft_in = r2c.make_input_vec();
    let mut fft_out = r2c.make_output_vec();
    let mut raw: VecDeque<u8> = VecDeque::new();
    let mut mono: Vec<f32> = Vec::new();
    let frame_bytes = 4 * channels;

    while still_running(gen) {
        let _ = capture.read_from_device_to_deque(&mut raw);
        while raw.len() >= frame_bytes {
            let mut sum = 0.0f32;
            for _ in 0..channels {
                let b0 = raw.pop_front().unwrap();
                let b1 = raw.pop_front().unwrap();
                let b2 = raw.pop_front().unwrap();
                let b3 = raw.pop_front().unwrap();
                sum += f32::from_le_bytes([b0, b1, b2, b3]);
            }
            mono.push(sum / channels as f32);
        }
        let mut i = 0usize;
        while i + fft_size <= mono.len() {
            fft_in.copy_from_slice(&mono[i..i + fft_size]);
            let _ = r2c.process(&mut fft_in, &mut fft_out);
            let bands = bins_to_bands(&fft_out, sample_rate, fft_size);
            if still_running(gen) {
                let _ = app.emit("loopback-bands", bands);
            }
            i += hop;
        }
        if i > 0 {
            mono.drain(0..i);
        }
        if mono.len() > fft_size * 8 {
            let keep = fft_size;
            mono.drain(0..mono.len() - keep);
        }
        std::thread::sleep(Duration::from_millis(8));
    }
    let _ = audio_client.stop_stream();
    Ok(())
}

#[cfg(windows)]
fn bins_to_bands(spec: &[rustfft::num_complex::Complex<f32>], sample_rate: usize, fft_size: usize) -> Bands {
    let nyquist = sample_rate as f32 / 2.0;
    let n = spec.len().saturating_sub(1).max(1);
    let hz = |bin: usize| (bin as f32 / n as f32) * nyquist;
    let band = |lo: f32, hi: f32| {
        let mut sum = 0.0;
        let mut peak = 0.0;
        let mut c = 0.0;
        for (i, v) in spec.iter().enumerate() {
            let f = hz(i);
            if f < lo || f >= hi {
                continue;
            }
            let mag = (v.re * v.re + v.im * v.im).sqrt() / (fft_size as f32);
            let nrm = (mag * 12.0).min(1.0);
            sum += nrm * nrm;
            if nrm > peak {
                peak = nrm;
            }
            c += 1.0;
        }
        if c == 0.0 {
            0.0
        } else {
            perceptual((sum / c).sqrt() * 0.55 + peak * 0.45)
        }
    };
    Bands {
        bass: band(20.0, 80.0),
        low: band(80.0, 250.0),
        mid: band(250.0, 2000.0),
        high: band(2000.0, 12000.0),
    }
}
