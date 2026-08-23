//! Auralith Virtual Camera
//! Windows: DirectShow Softcam sender (user-mode filter DLL).
//! Other platforms: stub (virtual camera is Windows-only for this product).

use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct VcamStatus {
    pub running: bool,
    pub width: u32,
    pub height: u32,
    pub fps: f32,
    pub backend: String,
    pub device_name: String,
    pub last_error: Option<String>,
    pub dll_loaded: bool,
}

pub const DEVICE_NAME: &str = "Auralith Virtual Camera";

#[cfg(windows)]
mod win {
    use super::*;
    use std::sync::Mutex;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};

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
    }

    unsafe impl Send for VcamState {}

    static RUNNING: AtomicBool = AtomicBool::new(false);
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

    fn load_api(resource_dir: Option<PathBuf>) -> Result<SoftcamApi, String> {
        let path = find_softcam_dll(resource_dir).ok_or_else(|| {
            "softcam.dll not found. Install Auralith with the Virtual Camera component, or place softcam.dll next to the app."
                .to_string()
        })?;
        unsafe {
            let lib = libloading::Library::new(&path)
                .map_err(|e| format!("Failed to load {}: {e}", path.display()))?;
            let create = *lib
                .get::<unsafe extern "C" fn(i32, i32, f32) -> *mut std::ffi::c_void>(b"scCreateCamera\0")
                .map_err(|e| format!("scCreateCamera missing: {e}"))?;
            let delete = *lib
                .get::<unsafe extern "C" fn(*mut std::ffi::c_void)>(b"scDeleteCamera\0")
                .map_err(|e| format!("scDeleteCamera missing: {e}"))?;
            let send = *lib
                .get::<unsafe extern "C" fn(*mut std::ffi::c_void, *const std::ffi::c_void)>(b"scSendFrame\0")
                .map_err(|e| format!("scSendFrame missing: {e}"))?;
            Ok(SoftcamApi {
                _lib: lib,
                create,
                delete,
                send,
            })
        }
    }

    pub fn status() -> VcamStatus {
        let running = RUNNING.load(Ordering::Relaxed);
        let guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(s) = guard.as_ref() {
            VcamStatus {
                running,
                width: s.width,
                height: s.height,
                fps: s.fps,
                backend: "DirectShow Softcam (user-mode filter)".into(),
                device_name: DEVICE_NAME.into(),
                last_error: s.last_error.clone(),
                dll_loaded: s.api.is_some(),
            }
        } else {
            VcamStatus {
                running: false,
                width: 0,
                height: 0,
                fps: 0.0,
                backend: "DirectShow Softcam (user-mode filter)".into(),
                device_name: DEVICE_NAME.into(),
                last_error: None,
                dll_loaded: find_softcam_dll(None).is_some(),
            }
        }
    }

    pub fn start(width: u32, height: u32, fps: f32, resource_dir: Option<PathBuf>) -> Result<VcamStatus, String> {
        stop();
        let w = width.max(16) & !3;
        let h = height.max(16) & !3;
        let f = if fps > 0.0 { fps } else { 30.0 };
        let api = load_api(resource_dir)?;
        let cam = unsafe { (api.create)(w as i32, h as i32, f) };
        if cam.is_null() {
            return Err(
                "Could not create Auralith Virtual Camera. Ensure softcam.dll is registered (installer runs regsvr32), and no other instance is active."
                    .into(),
            );
        }
        let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(VcamState {
            api: Some(api),
            camera: cam,
            width: w,
            height: h,
            fps: f,
            last_error: None,
        });
        RUNNING.store(true, Ordering::Relaxed);
        Ok(status())
    }

    pub fn stop() {
        RUNNING.store(false, Ordering::Relaxed);
        let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(mut s) = guard.take() {
            if let Some(api) = s.api.take() {
                if !s.camera.is_null() {
                    unsafe { (api.delete)(s.camera) };
                }
                drop(api);
            }
        }
    }

    pub fn push_rgb24(bytes: &[u8]) -> Result<(), String> {
        if !RUNNING.load(Ordering::Relaxed) {
            return Err("Virtual camera is not running".into());
        }
        let guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
        let s = guard.as_ref().ok_or_else(|| "Virtual camera is not running".to_string())?;
        let expected = (s.width as usize) * (s.height as usize) * 3;
        if bytes.len() < expected {
            return Err(format!("Frame too small: got {} need {}", bytes.len(), expected));
        }
        let api = s.api.as_ref().ok_or_else(|| "Virtual camera API missing".to_string())?;
        unsafe {
            (api.send)(s.camera, bytes.as_ptr() as *const std::ffi::c_void);
        }
        Ok(())
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
