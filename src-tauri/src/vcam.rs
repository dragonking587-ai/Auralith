//! Auralith Virtual Camera
//! Windows: DirectShow Softcam sender (user-mode filter DLL).
//! Startup must never crash the host process — all native calls are catch_unwind'd.

use serde::Serialize;
use std::sync::atomic::{AtomicU8, Ordering};

pub const DEVICE_NAME: &str = "Auralith Virtual Camera";

/// STOPPED=0 STARTING=1 RUNNING=2 STOPPING=3 ERROR=4
const ST_STOPPED: u8 = 0;
const ST_STARTING: u8 = 1;
const ST_RUNNING: u8 = 2;
const ST_STOPPING: u8 = 3;
const ST_ERROR: u8 = 4;

static PHASE: AtomicU8 = AtomicU8::new(ST_STOPPED);

#[derive(Clone, Serialize, Debug)]
pub struct VcamStatus {
    pub running: bool,
    pub width: u32,
    pub height: u32,
    pub fps: f32,
    pub backend: String,
    pub device_name: String,
    pub last_error: Option<String>,
    pub dll_loaded: bool,
    /// STOPPED | STARTING | RUNNING | STOPPING | ERROR
    pub state: String,
    pub last_stage: Option<String>,
}

fn state_name(s: u8) -> &'static str {
    match s {
        ST_STARTING => "STARTING",
        ST_RUNNING => "RUNNING",
        ST_STOPPING => "STOPPING",
        ST_ERROR => "ERROR",
        _ => "STOPPED",
    }
}

fn log_stage(stage: &str) {
    eprintln!("[VirtualCam] {stage}");
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use std::path::PathBuf;
    use std::sync::Mutex;

    struct SoftcamApi {
        _lib: libloading::Library,
        create: unsafe extern "C" fn(i32, i32, f32) -> *mut std::ffi::c_void,
        delete: unsafe extern "C" fn(*mut std::ffi::c_void),
        send: unsafe extern "C" fn(*mut std::ffi::c_void, *const std::ffi::c_void),
    }

    struct VcamState {
        api: Option<SoftcamApi>,
        camera: *mut std::ffi::c_void,
        width: u32,
        height: u32,
        fps: f32,
        last_error: Option<String>,
        last_stage: String,
        frames_ok: u64,
    }

    // Softcam camera handle is only used under STATE mutex; Send is required for static.
    unsafe impl Send for VcamState {}

    static STATE: Mutex<Option<VcamState>> = Mutex::new(None);

    fn find_softcam_dll(resource_dir: Option<PathBuf>) -> Option<PathBuf> {
        let mut candidates = Vec::new();
        if let Some(res) = resource_dir {
            candidates.push(res.join("softcam.dll"));
            candidates.push(res.join("vcam").join("softcam.dll"));
            candidates.push(res.join("ui").join("softcam.dll"));
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                candidates.push(dir.join("softcam.dll"));
                candidates.push(dir.join("vcam").join("softcam.dll"));
            }
        }
        candidates.push(PathBuf::from("softcam.dll"));
        candidates.into_iter().find(|p| p.is_file())
    }

    fn load_api(resource_dir: Option<PathBuf>) -> Result<(SoftcamApi, PathBuf), String> {
        log_stage("Loading softcam.dll");
        let path = find_softcam_dll(resource_dir).ok_or_else(|| {
            "softcam.dll not found next to the app. Reinstall Auralith or run the installer with Virtual Camera support.".to_string()
        })?;
        log_stage(&format!("softcam.dll path: {}", path.display()));
        let result = catch_unwind(AssertUnwindSafe(|| unsafe {
            let lib = libloading::Library::new(&path)
                .map_err(|e| format!("Failed to load {}: {e}", path.display()))?;
            let create = *lib
                .get::<unsafe extern "C" fn(i32, i32, f32) -> *mut std::ffi::c_void>(b"scCreateCamera\0")
                .map_err(|e| format!("scCreateCamera export missing: {e}"))?;
            let delete = *lib
                .get::<unsafe extern "C" fn(*mut std::ffi::c_void)>(b"scDeleteCamera\0")
                .map_err(|e| format!("scDeleteCamera export missing: {e}"))?;
            let send = *lib
                .get::<unsafe extern "C" fn(*mut std::ffi::c_void, *const std::ffi::c_void)>(b"scSendFrame\0")
                .map_err(|e| format!("scSendFrame export missing: {e}"))?;
            Ok::<_, String>(SoftcamApi {
                _lib: lib,
                create,
                delete,
                send,
            })
        }));
        match result {
            Ok(Ok(api)) => {
                log_stage("softcam.dll symbols resolved");
                Ok((api, path))
            }
            Ok(Err(e)) => Err(e),
            Err(_) => Err("Native panic while loading softcam.dll (missing MSVC runtime or corrupt DLL)".into()),
        }
    }

    fn status_inner() -> VcamStatus {
        let phase = PHASE.load(Ordering::SeqCst);
        let guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(s) = guard.as_ref() {
            VcamStatus {
                running: phase == ST_RUNNING,
                width: s.width,
                height: s.height,
                fps: s.fps,
                backend: "DirectShow Softcam (user-mode filter)".into(),
                device_name: DEVICE_NAME.into(),
                last_error: s.last_error.clone(),
                dll_loaded: s.api.is_some(),
                state: state_name(phase).into(),
                last_stage: Some(s.last_stage.clone()),
            }
        } else {
            VcamStatus {
                running: false,
                width: 0,
                height: 0,
                fps: 0.0,
                backend: "DirectShow Softcam (user-mode filter)".into(),
                device_name: DEVICE_NAME.into(),
                last_error: if phase == ST_ERROR {
                    Some("Virtual camera failed to start. See previous error.".into())
                } else {
                    None
                },
                dll_loaded: find_softcam_dll(None).is_some(),
                state: state_name(phase).into(),
                last_stage: None,
            }
        }
    }

    pub fn status() -> VcamStatus {
        status_inner()
    }

    /// Safe dimensions: multiple of 4, within Softcam limits, conservative default 1080p.
    fn normalize_size(width: u32, height: u32) -> (u32, u32) {
        let mut w = width.max(16).min(3840);
        let mut h = height.max(16).min(2160);
        w &= !3;
        h &= !3;
        if w < 16 {
            w = 16;
        }
        if h < 16 {
            h = 16;
        }
        (w, h)
    }

    fn fail(stage: &str, msg: String) -> Result<VcamStatus, String> {
        log_stage(&format!("FAILED at {stage}: {msg}"));
        PHASE.store(ST_ERROR, Ordering::SeqCst);
        let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(s) = guard.as_mut() {
            s.last_error = Some(msg.clone());
            s.last_stage = stage.into();
        } else {
            *guard = Some(VcamState {
                api: None,
                camera: std::ptr::null_mut(),
                width: 0,
                height: 0,
                fps: 0.0,
                last_error: Some(msg.clone()),
                last_stage: stage.into(),
                frames_ok: 0,
            });
        }
        Err(format!("[{stage}] {msg}"))
    }

    pub fn start(width: u32, height: u32, fps: f32, resource_dir: Option<PathBuf>) -> Result<VcamStatus, String> {
        log_stage("Start requested");
        let phase = PHASE.load(Ordering::SeqCst);
        if phase == ST_STARTING || phase == ST_RUNNING {
            return Err(format!(
                "Virtual camera is already {} — stop it first or wait.",
                state_name(phase)
            ));
        }
        PHASE.store(ST_STARTING, Ordering::SeqCst);

        // Always tear down any prior handle before creating a new one.
        stop_inner();

        let (w, h) = normalize_size(width, height);
        // Softcam framerate 0 = scSendFrame does not sleep (we pace in the UI).
        // Sleeping inside scSendFrame while holding our mutex deadlocks/stalls the app.
        let f = 0.0_f32;
        let report_fps = if fps > 0.0 { fps.min(60.0) } else { 30.0 };

        log_stage(&format!("Creating camera {w}x{h} (delivery paced in-app, softcam fps=0, ui target {report_fps})"));

        let (api, _path) = match load_api(resource_dir) {
            Ok(v) => v,
            Err(e) => return fail("load_dll", e),
        };

        let cam = {
            let create = api.create;
            let result = catch_unwind(AssertUnwindSafe(|| unsafe { create(w as i32, h as i32, f) }));
            match result {
                Ok(ptr) => ptr,
                Err(_) => {
                    drop(api);
                    return fail(
                        "scCreateCamera",
                        "Native panic inside scCreateCamera (DirectShow Softcam)".into(),
                    );
                }
            }
        };

        if cam.is_null() {
            drop(api);
            return fail(
                "scCreateCamera",
                "scCreateCamera returned null. Another Softcam instance may be active, or softcam.dll is not registered (run elevated: regsvr32 softcam.dll).".into(),
            );
        }
        log_stage("scCreateCamera succeeded");

        {
            let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
            *guard = Some(VcamState {
                api: Some(api),
                camera: cam,
                width: w,
                height: h,
                fps: report_fps,
                last_error: None,
                last_stage: "created".into(),
                frames_ok: 0,
            });
        }

        // Safe test frame BEFORE enabling live renderer feed.
        log_stage("Sending solid test frame");
        if let Err(e) = push_test_frame(w, h) {
            stop_inner();
            return fail("test_frame", e);
        }
        log_stage("Test frame accepted");

        PHASE.store(ST_RUNNING, Ordering::SeqCst);
        {
            let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(s) = guard.as_mut() {
                s.last_stage = "running".into();
                s.frames_ok = 1;
            }
        }
        log_stage("Running");
        Ok(status_inner())
    }

    fn push_test_frame(w: u32, h: u32) -> Result<(), String> {
        // Dark charcoal RGB24 matching Auralith bg-ish tone — proves sink accepts frames.
        let mut buf = vec![0u8; (w as usize) * (h as usize) * 3];
        for chunk in buf.chunks_exact_mut(3) {
            chunk[0] = 0x09;
            chunk[1] = 0x09;
            chunk[2] = 0x0b;
        }
        push_rgb24_inner(&buf)
    }

    fn push_rgb24_inner(bytes: &[u8]) -> Result<(), String> {
        let phase = PHASE.load(Ordering::SeqCst);
        if phase != ST_RUNNING && phase != ST_STARTING {
            return Err("Virtual camera is not running".into());
        }
        let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
        let s = guard
            .as_mut()
            .ok_or_else(|| "Virtual camera is not running".to_string())?;
        if s.camera.is_null() || s.api.is_none() {
            return Err("Virtual camera handle is null".into());
        }
        let expected = (s.width as usize)
            .saturating_mul(s.height as usize)
            .saturating_mul(3);
        if expected == 0 {
            return Err("Invalid camera dimensions".into());
        }
        // Softcam always memcpy's width*height*3 bytes — undersized buffers = hard crash.
        if bytes.len() < expected {
            return Err(format!(
                "Frame too small: got {} need {} (camera {}x{})",
                bytes.len(),
                expected,
                s.width,
                s.height
            ));
        }
        let api = s.api.as_ref().unwrap();
        let cam = s.camera;
        let send = api.send;
        let ptr = bytes.as_ptr() as *const std::ffi::c_void;
        let result = catch_unwind(AssertUnwindSafe(|| unsafe {
            send(cam, ptr);
        }));
        match result {
            Ok(()) => {
                s.frames_ok = s.frames_ok.saturating_add(1);
                s.last_stage = "frame_ok".into();
                Ok(())
            }
            Err(_) => {
                s.last_error = Some("Native panic inside scSendFrame".into());
                s.last_stage = "send_panic".into();
                PHASE.store(ST_ERROR, Ordering::SeqCst);
                Err("Native panic inside scSendFrame".into())
            }
        }
    }

    pub fn push_rgb24(bytes: &[u8]) -> Result<(), String> {
        push_rgb24_inner(bytes)
    }

    fn stop_inner() {
        let prev = PHASE.swap(ST_STOPPING, Ordering::SeqCst);
        if prev == ST_STOPPED {
            PHASE.store(ST_STOPPED, Ordering::SeqCst);
            return;
        }
        log_stage("Stopping");
        let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(mut s) = guard.take() {
            if let Some(api) = s.api.take() {
                if !s.camera.is_null() {
                    let delete = api.delete;
                    let cam = s.camera;
                    s.camera = std::ptr::null_mut();
                    let _ = catch_unwind(AssertUnwindSafe(|| unsafe {
                        delete(cam);
                    }));
                    log_stage("scDeleteCamera done");
                }
                drop(api);
            }
        }
        PHASE.store(ST_STOPPED, Ordering::SeqCst);
        log_stage("Stopped");
    }

    pub fn stop() {
        stop_inner();
    }
}

#[cfg(windows)]
pub use win::*;

#[cfg(not(windows))]
pub fn status() -> VcamStatus {
    VcamStatus {
        running: false,
        width: 0,
        height: 0,
        fps: 0.0,
        backend: "Unavailable (Windows only)".into(),
        device_name: DEVICE_NAME.into(),
        last_error: Some("Virtual camera is only available on Windows.".into()),
        dll_loaded: false,
        state: "STOPPED".into(),
        last_stage: None,
    }
}

#[cfg(not(windows))]
pub fn start(_w: u32, _h: u32, _fps: f32, _res: Option<std::path::PathBuf>) -> Result<VcamStatus, String> {
    Err("Virtual camera is only available on Windows.".into())
}

#[cfg(not(windows))]
pub fn stop() {}

#[cfg(not(windows))]
pub fn push_rgb24(_bytes: &[u8]) -> Result<(), String> {
    Err("Virtual camera is only available on Windows.".into())
}
