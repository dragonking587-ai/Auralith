mod audio;
mod vcam;
mod broadcast;
mod server;

use serde_json::Value;
use std::path::{Component, PathBuf};
use std::sync::atomic::{AtomicU16, Ordering};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

static PORT: AtomicU16 = AtomicU16::new(4317);

#[tauri::command]
fn local_port() -> u16 {
    PORT.load(Ordering::Relaxed)
}

#[tauri::command]
fn start_loopback(app: AppHandle, device_id: Option<String>) -> Result<(), String> {
    audio::start(app, device_id)
}

#[tauri::command]
fn stop_loopback() {
    audio::stop();
}

#[tauri::command]
fn list_loopback_devices() -> Result<Vec<audio::LoopbackDevice>, String> {
    audio::list_devices()
}

#[tauri::command]
/// LEGACY: second WebView Broadcast Output. Prefer broadcast_open (native HWND).
fn open_output(app: AppHandle, session: String, width: u32, height: u32) -> Result<(), String> {
    let port = local_port();
    // Use /index.html?view=broadcast so relative ./assets resolve from document root.
    // Path /output previously risked broken asset resolution / white empty document.
    let url = format!(
        "http://127.0.0.1:{port}/index.html?view=broadcast&session={}",
        urlencoding_encode(&session)
    );
    eprintln!("[BroadcastOutput] Creating/focusing window");
    eprintln!("[BroadcastOutput] Window label: output");
    eprintln!("[BroadcastOutput] Target URL: {url}");
    eprintln!("[BroadcastOutput] Hub port: {port}");

    // Best-effort hub readiness (do not hang forever)
    let meta = format!("http://127.0.0.1:{port}/api/auralith/meta");
    for attempt in 1..=20 {
        match std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
            std::time::Duration::from_millis(100),
        ) {
            Ok(_) => {
                eprintln!("[BroadcastOutput] Hub TCP ready (attempt {attempt})");
                break;
            }
            Err(e) => {
                if attempt == 20 {
                    eprintln!("[BroadcastOutput] Hub not reachable: {e}");
                    return Err(format!("Local hub not ready on port {port}: {e}"));
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    }
    let _ = meta;

    let w = width.max(16).min(3840) as f64;
    let h = height.max(16).min(2160) as f64;
    if let Some(win) = app.get_webview_window("output") {
        let _ = win.set_title("Auralith — Legacy Broadcast Output");
        let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize { width: w, height: h }));
        let _ = win.eval(&format!("window.location.replace({url:?})"));
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        eprintln!("[BroadcastOutput] Existing window navigated");
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        "output",
        WebviewUrl::External({
            use std::str::FromStr;
            url::Url::from_str(&url).map_err(|e| e.to_string())?
        }),
    )
    .title("Auralith — Legacy Broadcast Output")
    .inner_size(w, h)
    .decorations(true)
    .resizable(true)
    .visible(true)
    .focused(false)
    .skip_taskbar(false)
    .build()
    .map_err(|e| e.to_string())?;
    eprintln!("[BroadcastOutput] Window created");
    Ok(())
}

fn urlencoding_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
fn save_live_scene(app: AppHandle, scene: Value) -> Result<(), String> {
    let path = data_dir(&app)?.join("live-scene.json");
    std::fs::write(path, serde_json::to_vec_pretty(&scene).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_live_scene(app: AppHandle) -> Result<Option<Value>, String> {
    let path = data_dir(&app)?.join("live-scene.json");
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(Some(serde_json::from_slice(&bytes).map_err(|e| e.to_string())?))
}

fn safe_rel(name: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(name);
    if p.as_os_str().is_empty() || p.is_absolute() {
        return Err("invalid path".into());
    }
    for c in p.components() {
        match c {
            Component::Normal(s) => {
                let s = s.to_string_lossy();
                if s.is_empty()
                    || !s
                        .chars()
                        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
                {
                    return Err("invalid path".into());
                }
            }
            _ => return Err("invalid path".into()),
        }
    }
    Ok(p)
}

#[tauri::command]
fn save_app_file(app: AppHandle, name: String, data: String) -> Result<(), String> {
    let rel = safe_rel(&name)?;
    let path = data_dir(&app)?.join(rel);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_app_file(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let rel = safe_rel(&name)?;
    let path = data_dir(&app)?.join(rel);
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(std::fs::read_to_string(path).map_err(|e| e.to_string())?))
}


#[tauri::command]
fn vcam_status(app: AppHandle) -> vcam::VcamStatus {
    let res = app.path().resource_dir().ok();
    #[cfg(windows)]
    {
        return vcam::status_for(res);
    }
    #[cfg(not(windows))]
    {
        let _ = res;
        vcam::status()
    }
}

#[tauri::command]
fn vcam_install(app: AppHandle) -> Result<vcam::VcamStatus, String> {
    eprintln!("[VirtualCam] Install requested");
    eprintln!("[VirtualCam] ACL accepted");
    eprintln!("[VirtualCam] vcam_install handler entered");
    let res = app.path().resource_dir().ok();
    #[cfg(windows)]
    {
        vcam::install_filter(res)
    }
    #[cfg(not(windows))]
    {
        let _ = res;
        Err("Virtual camera is only available on Windows.".into())
    }
}

#[tauri::command]
fn vcam_uninstall(app: AppHandle) -> Result<vcam::VcamStatus, String> {
    let res = app.path().resource_dir().ok();
    #[cfg(windows)]
    {
        vcam::uninstall_filter(res)
    }
    #[cfg(not(windows))]
    {
        let _ = res;
        Err("Virtual camera is only available on Windows.".into())
    }
}

#[tauri::command]
fn vcam_start(app: AppHandle, width: u32, height: u32, fps: f32) -> Result<vcam::VcamStatus, String> {
    let res = app.path().resource_dir().ok();
    vcam::start(width, height, fps, res)
}

#[tauri::command]
fn vcam_stop() {
    vcam::stop();
}

#[tauri::command]
fn vcam_push_frame(rgba: Vec<u8>, width: u32, height: u32) -> Result<(), String> {
    // Never panic into the webview — all failures are Result::Err.
    let st = vcam::status();
    if !st.running {
        return Err("Virtual camera is not running".into());
    }
    // Softcam memcpy uses the camera's create dimensions, not the caller's claim.
    let cw = st.width as usize;
    let ch = st.height as usize;
    let need = cw.saturating_mul(ch).saturating_mul(3);
    if need == 0 {
        return Err("Virtual camera has invalid size".into());
    }
    let w = width as usize;
    let h = height as usize;
    let rgb_len = w.saturating_mul(h).saturating_mul(3);
    let rgba_len = w.saturating_mul(h).saturating_mul(4);

    // Build an RGB24 buffer matching the *camera* size (letterbox/crop if needed).
    let mut rgb = vec![0u8; need];
    if rgba.len() >= rgb_len && rgba.len() < rgba_len && w == cw && h == ch {
        rgb.copy_from_slice(&rgba[..need.min(rgba.len())]);
        return vcam::push_rgb24(&rgb);
    }
    if rgba.len() >= rgba_len && w > 0 && h > 0 {
        // Convert RGBA → RGB into a temporary full-frame, then scale-copy if sizes differ.
        let mut src = vec![0u8; rgb_len];
        for i in 0..(w * h) {
            let si = i * 4;
            let di = i * 3;
            src[di] = rgba[si];
            src[di + 1] = rgba[si + 1];
            src[di + 2] = rgba[si + 2];
        }
        if w == cw && h == ch {
            rgb.copy_from_slice(&src[..need]);
        } else {
            // Nearest-neighbor resize into camera buffer (safe, no native crash on size mismatch).
            for y in 0..ch {
                let sy = y * h / ch;
                for x in 0..cw {
                    let sx = x * w / cw;
                    let si = (sy * w + sx) * 3;
                    let di = (y * cw + x) * 3;
                    rgb[di] = src[si];
                    rgb[di + 1] = src[si + 1];
                    rgb[di + 2] = src[si + 2];
                }
            }
        }
        return vcam::push_rgb24(&rgb);
    }
    if rgba.len() >= need && w == cw && h == ch {
        rgb.copy_from_slice(&rgba[..need]);
        return vcam::push_rgb24(&rgb);
    }
    Err(format!(
        "Unsupported frame: buf={} claim={}x{} camera={}x{}",
        rgba.len(),
        width,
        height,
        st.width,
        st.height
    ))
}


#[tauri::command]
fn vcam_push_frame_b64(data: String, width: u32, height: u32) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("Invalid base64 frame: {e}"))?;
    // Prefer RGB24 length path
    let w = width as usize;
    let h = height as usize;
    let need = w.saturating_mul(h).saturating_mul(3);
    if bytes.len() < need {
        return Err(format!(
            "Decoded frame too small: {} need {} for {}x{}",
            bytes.len(),
            need,
            width,
            height
        ));
    }
    vcam::push_rgb24(&bytes[..need])
}

fn resolve_ui_dir(handle: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(res) = handle.path().resource_dir() {
        candidates.push(res.join("ui"));
        candidates.push(res);
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist-desktop");
    candidates.push(dev);
    candidates.into_iter().find(|p| p.join("index.html").exists())
}


#[tauri::command]
fn broadcast_open(width: u32, height: u32) -> Result<broadcast::BroadcastStatus, String> {
    eprintln!("[BroadcastNative] open {}x{}", width, height);
    broadcast::open(width, height)
}

#[tauri::command]
fn broadcast_close() {
    eprintln!("[BroadcastNative] close");
    broadcast::stop();
}

#[tauri::command]
fn broadcast_status() -> broadcast::BroadcastStatus {
    broadcast::status()
}

#[tauri::command]
fn broadcast_push_frame_b64(data: String, width: u32, height: u32) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("Invalid base64 frame: {e}"))?;
    broadcast::push_bgra(width, height, bytes)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let static_dir = resolve_ui_dir(&handle);
            let port = server::start(static_dir).map_err(|e| e.to_string())?;
            PORT.store(port, Ordering::Relaxed);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            local_port,
            start_loopback,
            stop_loopback,
            list_loopback_devices,
            open_output,
            save_live_scene,
            load_live_scene,
            save_app_file,
            load_app_file,
            vcam_status,
            vcam_install,
            vcam_uninstall,
            vcam_start,
            vcam_stop,
            vcam_push_frame,
            vcam_push_frame_b64,
            broadcast_open,
            broadcast_close,
            broadcast_status,
            broadcast_push_frame_b64
        ])
        .run(tauri::generate_context!())
        .expect("Auralith failed to start");
}
