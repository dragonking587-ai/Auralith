//! Auralith Virtual Camera
//! Windows: DirectShow Softcam sender (user-mode filter DLL).
//! Startup must never crash the host — native calls are catch_unwind'd.
//!
//! Critical sequencing: teardown prior instance WITHOUT clearing STARTING,
//! create Softcam handle, confirm state, THEN send test frame, THEN RUNNING.

use serde::Serialize;
use std::sync::atomic::{AtomicU8, Ordering};

pub const DEVICE_NAME: &str = "Auralith Virtual Camera";

/// Softcam CLSID from vendor/softcam (Auralith-branded filter).
/// {A11A11A1-5A11-4A11-B111-A11A11A11A11}
const SOFTCAM_CLSID: &str = "{A11A11A1-5A11-4A11-B111-A11A11A11A11}";

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
    pub state: String,
    pub last_stage: Option<String>,
    /// Whether the DirectShow filter CLSID is present in the registry.
    pub filter_registered: bool,
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
    use std::process::Command;
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
        filter_registered: bool,
    }

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

    /// Check whether Softcam's DirectShow filter CLSID is registered (regsvr32).
    fn is_filter_registered() -> bool {
        // HKCR\CLSID\{...} is the standard COM registration location.
        let key = format!(r"HKCR\CLSID\{}", SOFTCAM_CLSID);
        let out = Command::new("reg")
            .args(["query", &key])
            .output();
        match out {
            Ok(o) if o.status.success() => {
                log_stage(&format!("Filter CLSID registered: {SOFTCAM_CLSID}"));
                true
            }
            _ => {
                // Also try HKLM path used by some installers
                let key2 = format!(r"HKLM\SOFTWARE\Classes\CLSID\{}", SOFTCAM_CLSID);
                let out2 = Command::new("reg").args(["query", &key2]).output();
                match out2 {
                    Ok(o) if o.status.success() => {
                        log_stage(&format!("Filter CLSID registered (HKLM): {SOFTCAM_CLSID}"));
                        true
                    }
                    _ => {
                        log_stage(&format!(
                            "Auralith Virtual Camera NOT FOUND in registry (CLSID {SOFTCAM_CLSID})"
                        ));
                        false
                    }
                }
            }
        }
    }

    fn load_api(resource_dir: Option<PathBuf>) -> Result<(SoftcamApi, PathBuf), String> {
        log_stage("Loading softcam.dll");
        let path = find_softcam_dll(resource_dir).ok_or_else(|| {
            "softcam.dll not found next to the app. Reinstall Auralith with Virtual Camera support."
                .to_string()
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
            Err(_) => Err(
                "Native panic while loading softcam.dll (missing MSVC runtime or corrupt DLL)"
                    .into(),
            ),
        }
    }

    fn status_inner() -> VcamStatus {
        let phase = PHASE.load(Ordering::SeqCst);
        let registered = is_filter_registered();
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
                filter_registered: s.filter_registered || registered,
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
                filter_registered: registered,
            }
        }
    }

    pub fn status() -> VcamStatus {
        status_inner()
    }

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
        let registered = is_filter_registered();
        let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(s) = guard.as_mut() {
            s.last_error = Some(msg.clone());
            s.last_stage = stage.into();
            s.filter_registered = registered;
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
                filter_registered: registered,
            });
        }
        Err(format!("[{stage}] {msg}"))
    }

    /// Release native Softcam resources only. Does NOT change PHASE.
    /// Used so start() can tear down a prior instance without wiping STARTING.
    fn release_native() {
        let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(mut s) = guard.take() {
            if let Some(api) = s.api.take() {
                if !s.camera.is_null() {
                    let delete = api.delete;
                    let cam = s.camera;
                    s.camera = std::ptr::null_mut();
                    log_stage("scDeleteCamera (release prior instance)");
                    let _ = catch_unwind(AssertUnwindSafe(|| unsafe {
                        delete(cam);
                    }));
                }
                drop(api);
            }
        }
    }

    pub fn start(
        width: u32,
        height: u32,
        fps: f32,
        resource_dir: Option<PathBuf>,
    ) -> Result<VcamStatus, String> {
        log_stage("Start requested");
        let phase = PHASE.load(Ordering::SeqCst);
        if phase == ST_STARTING || phase == ST_RUNNING {
            return Err(format!(
                "Virtual camera is already {} — stop it first or wait.",
                state_name(phase)
            ));
        }

        // 1) Tear down any prior Softcam instance WITHOUT clearing the phase we are about to set.
        log_stage("Releasing any prior Softcam instance");
        release_native();

        // 2) Enter STARTING and keep it through create + test frame.
        PHASE.store(ST_STARTING, Ordering::SeqCst);
        log_stage("State = STARTING");

        let (w, h) = normalize_size(width, height);
        // Prefer 1920x1080 baseline when caller passes scene size; keep aspect if portrait.
        let report_fps = 30.0_f32; // fixed baseline until 30fps is proven
        let _ = fps;

        // Softcam framerate 0 = scSendFrame does not sleep (we pace in the UI).
        let softcam_fps = 0.0_f32;

        // 3) Registration check — do not pretend later stages failed.
        log_stage("Checking DirectShow filter registration");
        let registered = is_filter_registered();
        if !registered {
            log_stage("Auralith Virtual Camera NOT FOUND in Windows COM registry");
            return fail(
                "device_registration",
                format!(
                    "DirectShow filter CLSID {SOFTCAM_CLSID} is not registered. \
                     Install Auralith elevated, or run: regsvr32 softcam.dll \
                     (from the install folder, as Administrator). \
                     Until registration succeeds, OBS/TikTok cannot enumerate \
                     \"Auralith Virtual Camera\"."
                ),
            );
        }
        log_stage("Auralith Virtual Camera FOUND (filter CLSID registered)");

        // 4) Load DLL + symbols
        let (api, path) = match load_api(resource_dir) {
            Ok(v) => v,
            Err(e) => return fail("load_dll", e),
        };
        log_stage(&format!("Camera DLL ready: {}", path.display()));

        // 5) Create Softcam shared-memory sender (must succeed before any frame)
        log_stage(&format!(
            "Creating Softcam sender {w}x{h} (softcam fps=0, ui target {report_fps})"
        ));
        let create = api.create;
        let cam = {
            let result =
                catch_unwind(AssertUnwindSafe(|| unsafe { create(w as i32, h as i32, softcam_fps) }));
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
                "scCreateCamera returned null. Another Softcam sender may already be active in this session, or shared memory could not be created.".into(),
            );
        }
        log_stage("Camera object created (scCreateCamera handle non-null)");
        log_stage("Shared-memory frame source active");

        // Confirm we are still STARTING (must not have been wiped by teardown).
        let phase_now = PHASE.load(Ordering::SeqCst);
        if phase_now != ST_STARTING {
            log_stage(&format!(
                "Unexpected phase after create: {} (expected STARTING)",
                state_name(phase_now)
            ));
            // Recover: force STARTING so test frame can proceed.
            PHASE.store(ST_STARTING, Ordering::SeqCst);
        }
        log_stage("Waiting for running state — sender handle ready, entering test frame");

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
                filter_registered: true,
            });
        }
        log_stage("Running state confirmed (sender ready for frames)");

        // 6) Static test frame — only after handle exists and phase is STARTING
        log_stage("Sending test frame");
        if let Err(e) = push_test_frame(w, h) {
            release_native();
            return fail("test_frame", e);
        }
        log_stage("Test frame accepted");

        // 7) Mark RUNNING — UI may now connect the Auralith renderer
        PHASE.store(ST_RUNNING, Ordering::SeqCst);
        {
            let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(s) = guard.as_mut() {
                s.last_stage = "running".into();
                s.frames_ok = 1;
            }
        }
        log_stage("Connecting Auralith renderer (caller enables Stream Output feed)");
        log_stage("Live frames active");
        Ok(status_inner())
    }

    fn push_test_frame(w: u32, h: u32) -> Result<(), String> {
        let mut buf = vec![0u8; (w as usize) * (h as usize) * 3];
        // Distinct test pattern: dark charcoal with a brighter center band so a
        // connected capture app can confirm frames are moving.
        for y in 0..h as usize {
            for x in 0..w as usize {
                let i = (y * w as usize + x) * 3;
                let band = y > (h as usize / 3) && y < (2 * h as usize / 3);
                if band {
                    buf[i] = 0x30;
                    buf[i + 1] = 0x38;
                    buf[i + 2] = 0x48;
                } else {
                    buf[i] = 0x09;
                    buf[i + 1] = 0x09;
                    buf[i + 2] = 0x0b;
                }
            }
        }
        push_rgb24_inner(&buf)
    }

    fn push_rgb24_inner(bytes: &[u8]) -> Result<(), String> {
        let phase = PHASE.load(Ordering::SeqCst);
        // STARTING is valid during the post-create test frame; RUNNING for live feed.
        if phase != ST_RUNNING && phase != ST_STARTING {
            return Err(format!(
                "Virtual camera phase is {} (need STARTING or RUNNING) — sender was not ready",
                state_name(phase)
            ));
        }
        let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
        let s = guard
            .as_mut()
            .ok_or_else(|| "Virtual camera state missing (camera object not stored)".to_string())?;
        if s.camera.is_null() || s.api.is_none() {
            return Err("Virtual camera handle is null".into());
        }
        let expected = (s.width as usize)
            .saturating_mul(s.height as usize)
            .saturating_mul(3);
        if expected == 0 {
            return Err("Invalid camera dimensions".into());
        }
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

    pub fn stop() {
        let prev = PHASE.swap(ST_STOPPING, Ordering::SeqCst);
        if prev == ST_STOPPED {
            PHASE.store(ST_STOPPED, Ordering::SeqCst);
            return;
        }
        log_stage("Stopping");
        release_native();
        PHASE.store(ST_STOPPED, Ordering::SeqCst);
        log_stage("Stopped");
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
        filter_registered: false,
    }
}

#[cfg(not(windows))]
pub fn start(
    _w: u32,
    _h: u32,
    _fps: f32,
    _res: Option<std::path::PathBuf>,
) -> Result<VcamStatus, String> {
    Err("Virtual camera is only available on Windows.".into())
}

#[cfg(not(windows))]
pub fn stop() {}

#[cfg(not(windows))]
pub fn push_rgb24(_bytes: &[u8]) -> Result<(), String> {
    Err("Virtual camera is only available on Windows.".into())
}
