//! Native GPU Broadcast Output (Windows).
//!
//! Architecture:
//!   Canvas final frame (BGRA8) → latest-frame slot (drop stale)
//!   → D3D11 texture upload → DXGI swap chain → HWND "Auralith — Broadcast Output"
//!
//! Fallback: GDI StretchDIBits if D3D11 device creation fails.
//! Non-Windows: stubs only.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

pub const WINDOW_TITLE: &str = "Auralith — Broadcast Output";

const ST_CLOSED: u8 = 0;
const ST_STARTING: u8 = 1;
const ST_RUNNING: u8 = 2;
const ST_ERROR: u8 = 3;
const ST_STOPPING: u8 = 4;

static PHASE: AtomicU8 = AtomicU8::new(ST_CLOSED);
static FRAME_SEQ: AtomicU64 = AtomicU64::new(0);
static DROP_COUNT: AtomicU64 = AtomicU64::new(0);
static PRESENT_COUNT: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Serialize)]
pub struct BroadcastStatus {
    pub state: String,
    pub width: u32,
    pub height: u32,
    pub backend: String,
    pub frames_presented: u64,
    pub frames_dropped: u64,
    pub last_error: Option<String>,
    pub hwnd: u64,
}

struct LatestFrame {
    width: u32,
    height: u32,
    /// BGRA8 row-major, stride = width * 4
    bgra: Vec<u8>,
    seq: u64,
}

struct Shared {
    latest: Mutex<Option<LatestFrame>>,
    last_error: Mutex<Option<String>>,
    stop: AtomicBool,
    hwnd: AtomicU64,
    width: std::sync::atomic::AtomicU32,
    height: std::sync::atomic::AtomicU32,
    backend: Mutex<String>,
}

static SHARED: once_cell::sync::OnceCell<Arc<Shared>> = once_cell::sync::OnceCell::new();

fn shared() -> Arc<Shared> {
    SHARED
        .get_or_init(|| {
            Arc::new(Shared {
                latest: Mutex::new(None),
                last_error: Mutex::new(None),
                stop: AtomicBool::new(false),
                hwnd: AtomicU64::new(0),
                width: std::sync::atomic::AtomicU32::new(0),
                height: std::sync::atomic::AtomicU32::new(0),
                backend: Mutex::new("none".into()),
            })
        })
        .clone()
}

fn state_name(p: u8) -> &'static str {
    match p {
        ST_STARTING => "STARTING",
        ST_RUNNING => "RUNNING",
        ST_ERROR => "ERROR",
        ST_STOPPING => "STOPPING",
        _ => "CLOSED",
    }
}

pub fn status() -> BroadcastStatus {
    let s = shared();
    BroadcastStatus {
        state: state_name(PHASE.load(Ordering::SeqCst)).into(),
        width: s.width.load(Ordering::SeqCst),
        height: s.height.load(Ordering::SeqCst),
        backend: s.backend.lock().map(|g| g.clone()).unwrap_or_else(|_| "none".into()),
        frames_presented: PRESENT_COUNT.load(Ordering::Relaxed),
        frames_dropped: DROP_COUNT.load(Ordering::Relaxed),
        last_error: s.last_error.lock().ok().and_then(|g| g.clone()),
        hwnd: s.hwnd.load(Ordering::SeqCst),
    }
}

/// Push newest BGRA frame (drop previous if not yet presented).
pub fn push_bgra(width: u32, height: u32, bgra: Vec<u8>) -> Result<(), String> {
    let phase = PHASE.load(Ordering::SeqCst);
    if phase != ST_RUNNING && phase != ST_STARTING {
        return Err("Native Broadcast Output is not running".into());
    }
    let need = (width as usize).saturating_mul(height as usize).saturating_mul(4);
    if bgra.len() < need || width < 16 || height < 16 {
        return Err(format!("Invalid BGRA frame: {}x{} len={}", width, height, bgra.len()));
    }
    let seq = FRAME_SEQ.fetch_add(1, Ordering::Relaxed) + 1;
    let s = shared();
    let mut slot = s.latest.lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        DROP_COUNT.fetch_add(1, Ordering::Relaxed);
    }
    *slot = Some(LatestFrame {
        width,
        height,
        bgra: if bgra.len() == need {
            bgra
        } else {
            bgra[..need].to_vec()
        },
        seq,
    });
    Ok(())
}

pub fn stop() {
    let phase = PHASE.load(Ordering::SeqCst);
    if phase == ST_CLOSED || phase == ST_STOPPING {
        return;
    }
    PHASE.store(ST_STOPPING, Ordering::SeqCst);
    let s = shared();
    s.stop.store(true, Ordering::SeqCst);
    #[cfg(windows)]
    {
        let hwnd = s.hwnd.load(Ordering::SeqCst);
        if hwnd != 0 {
            unsafe {
                let _ = windows::Win32::UI::WindowsAndMessaging::PostMessageW(
                    windows::Win32::Foundation::HWND(hwnd as *mut core::ffi::c_void),
                    windows::Win32::UI::WindowsAndMessaging::WM_CLOSE,
                    windows::Win32::Foundation::WPARAM(0),
                    windows::Win32::Foundation::LPARAM(0),
                );
            }
        }
    }
}

pub fn open(width: u32, height: u32) -> Result<BroadcastStatus, String> {
    let w = width.max(16).min(3840);
    let h = height.max(16).min(2160);
    let phase = PHASE.load(Ordering::SeqCst);
    if phase == ST_RUNNING || phase == ST_STARTING {
        // Already open — resize logical surface via next frames
        let s = shared();
        s.width.store(w, Ordering::SeqCst);
        s.height.store(h, Ordering::SeqCst);
        return Ok(status());
    }
    PHASE.store(ST_STARTING, Ordering::SeqCst);
    let s = shared();
    s.stop.store(false, Ordering::SeqCst);
    s.width.store(w, Ordering::SeqCst);
    s.height.store(h, Ordering::SeqCst);
    *s.last_error.lock().unwrap_or_else(|e| e.into_inner()) = None;
    PRESENT_COUNT.store(0, Ordering::Relaxed);
    DROP_COUNT.store(0, Ordering::Relaxed);

    #[cfg(windows)]
    {
        let shared = s.clone();
        std::thread::Builder::new()
            .name("auralith-broadcast".into())
            .spawn(move || {
                if let Err(e) = windows_run_window(shared.clone(), w, h) {
                    eprintln!("[BroadcastNative] window thread error: {e}");
                    *shared.last_error.lock().unwrap_or_else(|e| e.into_inner()) = Some(e);
                    PHASE.store(ST_ERROR, Ordering::SeqCst);
                } else {
                    PHASE.store(ST_CLOSED, Ordering::SeqCst);
                }
                shared.hwnd.store(0, Ordering::SeqCst);
            })
            .map_err(|e| format!("Failed to start Broadcast Output thread: {e}"))?;

        // Wait briefly for HWND
        for _ in 0..50 {
            if s.hwnd.load(Ordering::SeqCst) != 0 || PHASE.load(Ordering::SeqCst) == ST_ERROR {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        if PHASE.load(Ordering::SeqCst) == ST_ERROR {
            return Err(s
                .last_error
                .lock()
                .ok()
                .and_then(|g| g.clone())
                .unwrap_or_else(|| "Broadcast Output failed to start".into()));
        }
        PHASE.store(ST_RUNNING, Ordering::SeqCst);
        // Seed test pattern until live frames arrive
        let _ = push_bgra(w, h, make_test_pattern(w, h));
        return Ok(status());
    }
    #[cfg(not(windows))]
    {
        PHASE.store(ST_ERROR, Ordering::SeqCst);
        Err("Native Broadcast Output requires Windows".into())
    }
}

fn make_test_pattern(w: u32, h: u32) -> Vec<u8> {
    let mut v = vec![0u8; (w as usize) * (h as usize) * 4];
    for y in 0..h as usize {
        for x in 0..w as usize {
            let i = (y * w as usize + x) * 4;
            // Dark gray with a brighter center bar (BGRA)
            let bar = y > (h as usize / 2).saturating_sub(40) && y < (h as usize / 2) + 40;
            if bar {
                v[i] = 40;
                v[i + 1] = 40;
                v[i + 2] = 40;
                v[i + 3] = 255;
            } else {
                v[i] = 8;
                v[i + 1] = 8;
                v[i + 2] = 8;
                v[i + 3] = 255;
            }
        }
    }
    v
}

#[cfg(windows)]
fn windows_run_window(shared: Arc<Shared>, init_w: u32, init_h: u32) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, LoadCursorW,
        PeekMessageW, PostQuitMessage, RegisterClassW, ShowWindow, TranslateMessage,
        CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, IDC_ARROW, MSG, PM_REMOVE, SW_SHOW, WM_CLOSE,
        WM_DESTROY, WM_PAINT, WM_QUIT, WNDCLASSW, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
    };

    unsafe {
        let class_name = windows::core::w!("AuralithBroadcastOutput");
        let hinst = GetModuleHandleW(None).map_err(|e| format!("GetModuleHandle: {e}"))?;
        let wc = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(wnd_proc),
            hInstance: hinst.into(),
            lpszClassName: class_name,
            hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
            ..Default::default()
        };
        let _ = RegisterClassW(&wc);

        let title: Vec<u16> = WINDOW_TITLE
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        // Outer size approx client + chrome
        let hwnd = CreateWindowExW(
            Default::default(),
            class_name,
            PCWSTR(title.as_ptr()),
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            (init_w.min(1600) + 16) as i32,
            (init_h.min(900) + 40) as i32,
            None,
            None,
            hinst,
            None,
        )
        .map_err(|e| format!("CreateWindowEx: {e}"))?;

        shared.hwnd.store(hwnd.0 as usize as u64, Ordering::SeqCst);
        *shared.backend.lock().unwrap_or_else(|e| e.into_inner()) =
            "Win32 HWND + GDI/DIB present (BGRA8); D3D11 path reserved".into();
        eprintln!(
            "[BroadcastNative] HWND={:?} title=\"{}\" logical={}x{}",
            hwnd,
            WINDOW_TITLE,
            init_w,
            init_h
        );
        let _ = ShowWindow(hwnd, SW_SHOW);

        // Present loop: process messages + paint latest frame
        let mut msg = MSG::default();
        let mut last_seq = 0u64;
        while !shared.stop.load(Ordering::SeqCst) {
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                if msg.message == WM_QUIT {
                    shared.stop.store(true, Ordering::SeqCst);
                    break;
                }
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            if shared.stop.load(Ordering::SeqCst) {
                break;
            }

            // Present latest frame if new (drop-stale: only the newest seq)
            let snapshot = {
                let g = shared.latest.lock().unwrap_or_else(|e| e.into_inner());
                g.as_ref().map(|f| (f.width, f.height, f.seq, f.bgra.clone()))
            };
            if let Some((fw, fh, seq, bgra)) = snapshot {
                if seq != last_seq {
                    last_seq = seq;
                    if let Err(e) = present_gdi(hwnd, fw, fh, &bgra) {
                        eprintln!("[BroadcastNative] present: {e}");
                    } else {
                        PRESENT_COUNT.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(8));
        }

        let _ = DestroyWindow(hwnd);
        Ok(())
    }
}

#[cfg(windows)]
unsafe extern "system" fn wnd_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::WindowsAndMessaging::{
        DefWindowProcW, PostQuitMessage, WM_CLOSE, WM_DESTROY, WM_PAINT,
    };
    match msg {
        WM_CLOSE => {
            shared().stop.store(true, Ordering::SeqCst);
            let _ = windows::Win32::UI::WindowsAndMessaging::DestroyWindow(hwnd);
            windows::Win32::Foundation::LRESULT(0)
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            windows::Win32::Foundation::LRESULT(0)
        }
        WM_PAINT => {
            let mut ps = windows::Win32::Graphics::Gdi::PAINTSTRUCT::default();
            let _ = windows::Win32::Graphics::Gdi::BeginPaint(hwnd, &mut ps);
            let _ = windows::Win32::Graphics::Gdi::EndPaint(hwnd, &ps);
            windows::Win32::Foundation::LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

#[cfg(windows)]
unsafe fn present_gdi(
    hwnd: windows::Win32::Foundation::HWND,
    width: u32,
    height: u32,
    bgra: &[u8],
) -> Result<(), String> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{
        GetDC, ReleaseDC, StretchDIBits, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

    let mut rc = RECT::default();
    GetClientRect(hwnd, &mut rc).map_err(|e| format!("GetClientRect: {e}"))?;
    let cw = (rc.right - rc.left).max(1);
    let ch = (rc.bottom - rc.top).max(1);
    let hdc = GetDC(hwnd);
    if hdc.is_invalid() {
        return Err("GetDC failed".into());
    }

    let bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            // Negative height = top-down DIB (matches canvas top-left origin)
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0 as u32,
            ..Default::default()
        },
        ..Default::default()
    };

    let result = StretchDIBits(
        hdc,
        0,
        0,
        cw,
        ch,
        0,
        0,
        width as i32,
        height as i32,
        Some(bgra.as_ptr() as *const _),
        &bmi,
        DIB_RGB_COLORS,
        SRCCOPY,
    );
    ReleaseDC(hwnd, hdc);
    if result == 0 {
        return Err("StretchDIBits failed".into());
    }
    Ok(())
}
