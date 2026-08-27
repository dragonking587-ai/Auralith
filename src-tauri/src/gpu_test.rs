//! Phase 1 — standalone Native GPU diagnostic output.
//! Does NOT consume Auralith scene / renderer / audio / hub.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const WINDOW_TITLE: &str = "Auralith — Native GPU Test Output";

const ST_CLOSED: u8 = 0;
const ST_STARTING: u8 = 1;
const ST_RUNNING: u8 = 2;
const ST_RECONFIG: u8 = 3;
const ST_STOPPING: u8 = 4;
const ST_ERROR: u8 = 5;

static PHASE: AtomicU8 = AtomicU8::new(ST_CLOSED);
static PRESENTED: AtomicU64 = AtomicU64::new(0);
static DROPPED: AtomicU64 = AtomicU64::new(0);
static ACTUAL_FPS: AtomicU32 = AtomicU32::new(0);
static TARGET_FPS: AtomicU32 = AtomicU32::new(30);
static LOG_W: AtomicU32 = AtomicU32::new(1920);
static LOG_H: AtomicU32 = AtomicU32::new(1080);

#[derive(Clone, Serialize)]
pub struct GpuTestStatus {
    pub state: String,
    pub width: u32,
    pub height: u32,
    pub target_fps: u32,
    pub actual_fps: u32,
    pub frames_presented: u64,
    pub frames_dropped: u64,
    pub adapter: String,
    pub feature_level: String,
    pub backend: String,
    pub format: String,
    pub hwnd: u64,
    pub last_error: Option<String>,
}

struct Shared {
    stop: AtomicBool,
    hwnd: AtomicU64,
    last_error: Mutex<Option<String>>,
    adapter: Mutex<String>,
    feature_level: Mutex<String>,
}

static SHARED: once_cell::sync::OnceCell<Arc<Shared>> = once_cell::sync::OnceCell::new();

fn shared() -> Arc<Shared> {
    SHARED
        .get_or_init(|| {
            Arc::new(Shared {
                stop: AtomicBool::new(false),
                hwnd: AtomicU64::new(0),
                last_error: Mutex::new(None),
                adapter: Mutex::new(String::new()),
                feature_level: Mutex::new(String::new()),
            })
        })
        .clone()
}

fn state_name(p: u8) -> &'static str {
    match p {
        ST_STARTING => "STARTING",
        ST_RUNNING => "RUNNING",
        ST_RECONFIG => "RECONFIGURING",
        ST_STOPPING => "STOPPING",
        ST_ERROR => "ERROR",
        _ => "CLOSED",
    }
}

pub fn status() -> GpuTestStatus {
    let s = shared();
    let state = state_name(PHASE.load(Ordering::SeqCst));
    eprintln!("[NativeGpuTest Status] returning {state}");
    GpuTestStatus {
        state: state.into(),
        width: LOG_W.load(Ordering::SeqCst),
        height: LOG_H.load(Ordering::SeqCst),
        target_fps: TARGET_FPS.load(Ordering::SeqCst),
        actual_fps: ACTUAL_FPS.load(Ordering::SeqCst),
        frames_presented: PRESENTED.load(Ordering::Relaxed),
        frames_dropped: DROPPED.load(Ordering::Relaxed),
        adapter: s.adapter.lock().map(|g| g.clone()).unwrap_or_default(),
        feature_level: s.feature_level.lock().map(|g| g.clone()).unwrap_or_default(),
        backend: "D3D11 + DXGI HWND swap chain (no DirectComposition in Phase 1)".into(),
        format: "DXGI_FORMAT_B8G8R8A8_UNORM".into(),
        hwnd: s.hwnd.load(Ordering::SeqCst),
        last_error: s.last_error.lock().ok().and_then(|g| g.clone()),
    }
}

pub fn close() {
    let p = PHASE.load(Ordering::SeqCst);
    if p == ST_CLOSED || p == ST_STOPPING {
        return;
    }
    PHASE.store(ST_STOPPING, Ordering::SeqCst);
    eprintln!("[NativeGpuTest] Closing");
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

pub fn open(width: u32, height: u32, fps: u32) -> Result<GpuTestStatus, String> {
    let w = width.clamp(16, 3840);
    let h = height.clamp(16, 2160);
    let fps = if fps >= 45 { 60 } else { 30 };
    let phase = PHASE.load(Ordering::SeqCst);
    if phase == ST_RUNNING || phase == ST_STARTING {
        LOG_W.store(w, Ordering::SeqCst);
        LOG_H.store(h, Ordering::SeqCst);
        TARGET_FPS.store(fps, Ordering::SeqCst);
        eprintln!("[NativeGpuTest] Already running — focusing / updating logical {}x{} @{}", w, h, fps);
        #[cfg(windows)]
        {
            let hwnd = shared().hwnd.load(Ordering::SeqCst);
            if hwnd != 0 {
                unsafe {
                    let h = windows::Win32::Foundation::HWND(hwnd as *mut core::ffi::c_void);
                    let _ = windows::Win32::UI::WindowsAndMessaging::ShowWindow(
                        h,
                        windows::Win32::UI::WindowsAndMessaging::SW_RESTORE,
                    );
                    let _ = windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow(h);
                }
            }
        }
        return Ok(status());
    }

    eprintln!("[NativeGpuTest] Open requested {}x{} @{}", w, h, fps);
    eprintln!("[NativeGpuTest] Current state: {}", state_name(phase));
    eprintln!("[NativeGpuTest] Transition {} -> STARTING", state_name(phase));
    PHASE.store(ST_STARTING, Ordering::SeqCst);
    LOG_W.store(w, Ordering::SeqCst);
    LOG_H.store(h, Ordering::SeqCst);
    TARGET_FPS.store(fps, Ordering::SeqCst);
    PRESENTED.store(0, Ordering::Relaxed);
    DROPPED.store(0, Ordering::Relaxed);
    ACTUAL_FPS.store(0, Ordering::Relaxed);
    let s = shared();
    s.stop.store(false, Ordering::SeqCst);
    *s.last_error.lock().unwrap_or_else(|e| e.into_inner()) = None;

    #[cfg(not(windows))]
    {
        PHASE.store(ST_ERROR, Ordering::SeqCst);
        return Err("Native GPU Test Output requires Windows".into());
    }

    #[cfg(windows)]
    {
        let shared = s.clone();
        std::thread::Builder::new()
            .name("auralith-gpu-test".into())
            .spawn(move || {
                eprintln!("[NativeGpuTest] Native thread started");
                if let Err(e) = windows_run(shared.clone(), w, h, fps) {
                    eprintln!("[NativeGpuTest] thread error: {e}");
                    *shared.last_error.lock().unwrap_or_else(|e| e.into_inner()) = Some(e);
                    PHASE.store(ST_ERROR, Ordering::SeqCst);
                } else {
                    PHASE.store(ST_CLOSED, Ordering::SeqCst);
                    eprintln!("[NativeGpuTest] Closed");
                }
                shared.hwnd.store(0, Ordering::SeqCst);
            })
            .map_err(|e| format!("Failed to start Native GPU Test thread: {e}"))?;

        for _ in 0..80 {
            if s.hwnd.load(Ordering::SeqCst) != 0 || PHASE.load(Ordering::SeqCst) == ST_ERROR {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        if PHASE.load(Ordering::SeqCst) == ST_ERROR {
            return Err(s
                .last_error
                .lock()
                .ok()
                .and_then(|g| g.clone())
                .unwrap_or_else(|| "Native GPU Test Output failed to start".into()));
        }
        if s.hwnd.load(Ordering::SeqCst) == 0 {
            let msg = "Stage: HWND Creation — native window did not appear within timeout".to_string();
            *s.last_error.lock().unwrap_or_else(|e| e.into_inner()) = Some(msg.clone());
            PHASE.store(ST_ERROR, Ordering::SeqCst);
            s.stop.store(true, Ordering::SeqCst);
            eprintln!("[NativeGpuTest] {msg}");
            return Err(msg);
        }
        PHASE.store(ST_RUNNING, Ordering::SeqCst);
        eprintln!("[NativeGpuTest] Transition STARTING -> RUNNING hwnd={}", s.hwnd.load(Ordering::SeqCst));
        Ok(status())
    }
}

fn draw_diagnostic(buf: &mut [u8], w: u32, h: u32, frame: u64, elapsed: f32, fps_actual: u32, target: u32) {
    let w = w as usize;
    let h = h as usize;
    // Obsidian fill
    for px in buf.chunks_exact_mut(4) {
        px[0] = 12; // B
        px[1] = 10;
        px[2] = 8;
        px[3] = 255;
    }
    // Gold border 6px
    let border = 6usize;
    for y in 0..h {
        for x in 0..w {
            if y < border || y >= h.saturating_sub(border) || x < border || x >= w.saturating_sub(border) {
                let i = (y * w + x) * 4;
                if i + 3 < buf.len() {
                    buf[i] = 30;
                    buf[i + 1] = 175;
                    buf[i + 2] = 212;
                    buf[i + 3] = 255;
                }
            }
        }
    }
    // Moving gold orb
    let t = elapsed;
    let cx = ((w as f32 * 0.5) + (w as f32 * 0.32) * (t * 1.4).sin()) as i32;
    let cy = (h as f32 * 0.58) as i32;
    let radius = (h.min(w) as f32 * 0.06).max(18.0) as i32;
    for dy in -radius..=radius {
        for dx in -radius..=radius {
            if dx * dx + dy * dy <= radius * radius {
                let x = cx + dx;
                let y = cy + dy;
                if x >= 0 && y >= 0 && (x as usize) < w && (y as usize) < h {
                    let i = (y as usize * w + x as usize) * 4;
                    buf[i] = 40;
                    buf[i + 1] = 190;
                    buf[i + 2] = 220;
                    buf[i + 3] = 255;
                }
            }
        }
    }
    // Energy band
    let band_y = (h as f32 * (0.78 + 0.04 * (t * 3.0).sin())) as usize;
    if band_y < h {
        for x in border..w.saturating_sub(border) {
            let pulse = (((x as f32 / w as f32) * 12.0 + t * 4.0).sin() * 80.0 + 80.0) as u8;
            let i = (band_y * w + x) * 4;
            if i + 3 < buf.len() {
                buf[i] = pulse;
                buf[i + 1] = 80;
                buf[i + 2] = 180;
                buf[i + 3] = 255;
            }
        }
    }
    let _ = (frame, fps_actual, target);
}

#[cfg(windows)]
fn windows_run(shared: Arc<Shared>, init_w: u32, init_h: u32, init_fps: u32) -> Result<(), String> {
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL, D3D_FEATURE_LEVEL_10_0, D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_11_1};
    use windows::Win32::Graphics::Direct3D11::{
        D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_BIND_SHADER_RESOURCE,
        D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION, D3D11_SUBRESOURCE_DATA, D3D11_TEXTURE2D_DESC,
        D3D11_USAGE_DEFAULT,
    };
    use windows::Win32::Graphics::Dxgi::Common::{
        DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC,
    };
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIAdapter, IDXGIDevice, IDXGIFactory2, IDXGISwapChain1, DXGI_ADAPTER_DESC,
        DXGI_SWAP_CHAIN_DESC1, DXGI_SWAP_EFFECT_FLIP_DISCARD, DXGI_USAGE_RENDER_TARGET_OUTPUT,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect, LoadCursorW,
        PeekMessageW, PostQuitMessage, RegisterClassW, ShowWindow, TranslateMessage, CS_HREDRAW, CS_VREDRAW,
        CW_USEDEFAULT, IDC_ARROW, MSG, PM_REMOVE, SW_SHOW, WM_CLOSE, WM_DESTROY, WM_DPICHANGED, WM_PAINT,
        WM_QUIT, WM_SIZE, WNDCLASSW, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
    };

    unsafe {
        eprintln!("[NativeGpuTest] Creating native window");
        let class_name = windows::core::w!("AuralithNativeGpuTest");
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
        let title: Vec<u16> = WINDOW_TITLE.encode_utf16().chain(std::iter::once(0)).collect();
        let hwnd = CreateWindowExW(
            Default::default(),
            class_name,
            PCWSTR(title.as_ptr()),
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            (init_w.min(1600) + 16) as i32,
            (init_h.min(900) + 48) as i32,
            None,
            None,
            hinst,
            None,
        )
        .map_err(|e| format!("CreateWindowEx failed: {e}"))?;
        shared.hwnd.store(hwnd.0 as usize as u64, Ordering::SeqCst);
        eprintln!("[NativeGpuTest] HWND created {:?}", hwnd);
        let _ = ShowWindow(hwnd, SW_SHOW);

        eprintln!("[NativeGpuTest] Selecting GPU adapter / Creating D3D11 device");
        let mut device: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;
        let mut fl = D3D_FEATURE_LEVEL_11_0;
        let levels = [D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_10_0];
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            None,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            Some(&levels),
            D3D11_SDK_VERSION,
            Some(&mut device),
            Some(&mut fl),
            Some(&mut context),
        )
        .map_err(|e| format!("Subsystem: D3D11  Stage: device creation  HRESULT: {e}"))?;
        let device = device.ok_or_else(|| "D3D11 device was null".to_string())?;
        let context = context.ok_or_else(|| "D3D11 context was null".to_string())?;
        let fl_s = match fl {
            D3D_FEATURE_LEVEL_11_1 => "11.1",
            D3D_FEATURE_LEVEL_11_0 => "11.0",
            D3D_FEATURE_LEVEL_10_1 => "10.1",
            D3D_FEATURE_LEVEL_10_0 => "10.0",
            _ => "other",
        };
        *shared.feature_level.lock().unwrap_or_else(|e| e.into_inner()) = fl_s.into();
        eprintln!("[NativeGpuTest] Feature level: {fl_s}");
        eprintln!("[NativeGpuTest] D3D11 device ready");

        let dxgi_dev: IDXGIDevice = device.cast().map_err(|e| format!("IDXGIDevice cast: {e}"))?;
        let adapter: IDXGIAdapter = dxgi_dev.GetAdapter().map_err(|e| format!("GetAdapter: {e}"))?;
        let desc = adapter
            .GetDesc()
            .map_err(|e| format!("GetDesc: {e}"))?;
        let adapter_name = String::from_utf16_lossy(
            &desc.Description.iter().copied().take_while(|&c| c != 0).collect::<Vec<_>>(),
        );
        *shared.adapter.lock().unwrap_or_else(|e| e.into_inner()) = adapter_name.clone();
        eprintln!("[NativeGpuTest] Adapter: {adapter_name}");

        let factory: IDXGIFactory2 = CreateDXGIFactory1::<IDXGIFactory2>().map_err(|e| format!("CreateDXGIFactory1: {e}"))?;

        let mut logical_w = LOG_W.load(Ordering::SeqCst).max(16);
        let mut logical_h = LOG_H.load(Ordering::SeqCst).max(16);

        let mk_desc = |cw: u32, ch: u32| {
            // Default() supplies DXGI_SCALING / DXGI_ALPHA_MODE values that are
            // not always exported as named constants in windows-rs 0.58 Common.
            let mut d = DXGI_SWAP_CHAIN_DESC1::default();
            d.Width = cw;
            d.Height = ch;
            d.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
            d.SampleDesc = DXGI_SAMPLE_DESC { Count: 1, Quality: 0 };
            d.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
            d.BufferCount = 2;
            d.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
            d.Flags = 0;
            d
        };

        let mut rc = windows::Win32::Foundation::RECT::default();
        let _ = GetClientRect(hwnd, &mut rc);
        let mut cw = (rc.right - rc.left).max(1) as u32;
        let mut ch = (rc.bottom - rc.top).max(1) as u32;

        let mut swap: IDXGISwapChain1 = factory
            .CreateSwapChainForHwnd(&device, hwnd, &mk_desc(cw, ch), None, None)
            .map_err(|e| format!("Subsystem: DXGI  Stage: Swap Chain Creation  HRESULT: {e}"))?;
        eprintln!("[NativeGpuTest] Swap chain created {cw}x{ch} B8G8R8A8_UNORM FLIP_DISCARD");

        let mut gpu_tex: ID3D11Texture2D = create_tex(&device, logical_w, logical_h)?;
        eprintln!("[NativeGpuTest] Render target ready");
        eprintln!("[NativeGpuTest] Running");

        let mut msg = MSG::default();
        let start = Instant::now();
        let mut last_present = Instant::now();
        let mut fps_window = Instant::now();
        let mut fps_count = 0u32;
        let mut frame = 0u64;
        let mut pixels = vec![0u8; (logical_w as usize) * (logical_h as usize) * 4];

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

            let target = TARGET_FPS.load(Ordering::SeqCst).max(1);
            let frame_dt = Duration::from_micros(1_000_000 / target as u64);
            let now = Instant::now();
            if now.duration_since(last_present) < frame_dt {
                std::thread::sleep(Duration::from_millis(1));
                continue;
            }
            // drop-stale: if we overslept more than 2 frames, skip catch-up
            if now.duration_since(last_present) > frame_dt * 2 {
                DROPPED.fetch_add(1, Ordering::Relaxed);
            }
            last_present = now;

            let new_w = LOG_W.load(Ordering::SeqCst).max(16);
            let new_h = LOG_H.load(Ordering::SeqCst).max(16);
            if new_w != logical_w || new_h != logical_h {
                PHASE.store(ST_RECONFIG, Ordering::SeqCst);
                eprintln!("[NativeGpuTest] Resize requested logical {new_w}x{new_h}");
                logical_w = new_w;
                logical_h = new_h;
                gpu_tex = create_tex(&device, logical_w, logical_h)?;
                pixels = vec![0u8; (logical_w as usize) * (logical_h as usize) * 4];
                PHASE.store(ST_RUNNING, Ordering::SeqCst);
            }

            let mut rc2 = windows::Win32::Foundation::RECT::default();
            let _ = GetClientRect(hwnd, &mut rc2);
            let ncw = (rc2.right - rc2.left).max(1) as u32;
            let nch = (rc2.bottom - rc2.top).max(1) as u32;
            if ncw != cw || nch != ch {
                PHASE.store(ST_RECONFIG, Ordering::SeqCst);
                eprintln!("[NativeGpuTest] Resize requested client {ncw}x{nch}");
                let _ = swap.ResizeBuffers(0, ncw, nch, DXGI_FORMAT_B8G8R8A8_UNORM, windows::Win32::Graphics::Dxgi::DXGI_SWAP_CHAIN_FLAG(0));
                cw = ncw;
                ch = nch;
                eprintln!("[NativeGpuTest] Swap chain buffers resized");
                PHASE.store(ST_RUNNING, Ordering::SeqCst);
            }

            frame += 1;
            let elapsed = start.elapsed().as_secs_f32();
            draw_diagnostic(&mut pixels, logical_w, logical_h, frame, elapsed, ACTUAL_FPS.load(Ordering::Relaxed), target);

            let data = D3D11_SUBRESOURCE_DATA {
                pSysMem: pixels.as_ptr() as *const _,
                SysMemPitch: logical_w * 4,
                SysMemSlicePitch: 0,
            };
            context.UpdateSubresource(&gpu_tex, 0, None, data.pSysMem, data.SysMemPitch, 0);

            let back: ID3D11Texture2D = swap.GetBuffer(0).map_err(|e| format!("GetBuffer: {e}"))?;
            // If sizes differ, CopyResource may fail; recreate tex to client size when needed
            if cw == logical_w && ch == logical_h {
                context.CopyResource(&back, &gpu_tex);
            } else {
                // Stretch via CPU into client-sized scratch then upload
                let mut stretched = vec![0u8; cw as usize * ch as usize * 4];
                nearest_scale(&pixels, logical_w, logical_h, &mut stretched, cw, ch);
                let scratch = create_tex(&device, cw, ch)?;
                context.UpdateSubresource(
                    &scratch,
                    0,
                    None,
                    stretched.as_ptr() as *const _,
                    cw * 4,
                    0,
                );
                context.CopyResource(&back, &scratch);
            }

            // windows-rs 0.58: Present returns HRESULT, flags are DXGI_PRESENT
            let hr = swap.Present(1, windows::Win32::Graphics::Dxgi::DXGI_PRESENT(0));
            if hr.is_ok() {
                PRESENTED.fetch_add(1, Ordering::Relaxed);
                fps_count += 1;
            } else {
                eprintln!("[NativeGpuTest] Present error HRESULT=0x{:08X}", hr.0 as u32);
                DROPPED.fetch_add(1, Ordering::Relaxed);
                // DXGI_ERROR_DEVICE_REMOVED = 0x887A0005, DEVICE_RESET = 0x887A0007
                if hr.0 == -2005270523 || hr.0 == -2005270521 {
                    eprintln!("[NativeGpuTest] Device lost HRESULT=0x{:08X}", hr.0 as u32);
                    *shared.last_error.lock().unwrap_or_else(|e| e.into_inner()) =
                        Some(format!("Device lost HRESULT=0x{:08X}", hr.0 as u32));
                    PHASE.store(ST_ERROR, Ordering::SeqCst);
                    break;
                }
            }

            if fps_window.elapsed() >= Duration::from_secs(1) {
                ACTUAL_FPS.store(fps_count, Ordering::Relaxed);
                fps_count = 0;
                fps_window = Instant::now();
            }
        }

        eprintln!("[NativeGpuTest] Resources released");
        let _ = DestroyWindow(hwnd);
        Ok(())
    }
}

#[cfg(windows)]
fn create_tex(
    device: &windows::Win32::Graphics::Direct3D11::ID3D11Device,
    w: u32,
    h: u32,
) -> Result<windows::Win32::Graphics::Direct3D11::ID3D11Texture2D, String> {
    use windows::Win32::Graphics::Direct3D11::{D3D11_BIND_SHADER_RESOURCE, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT};
    use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
    let desc = D3D11_TEXTURE2D_DESC {
        Width: w,
        Height: h,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
        CPUAccessFlags: 0,
        MiscFlags: 0,
    };
    let mut tex = None;
    unsafe {
        device
            .CreateTexture2D(&desc, None, Some(&mut tex))
            .map_err(|e| format!("CreateTexture2D: {e}"))?;
    }
    tex.ok_or_else(|| "CreateTexture2D returned null".into())
}

fn nearest_scale(src: &[u8], sw: u32, sh: u32, dst: &mut [u8], dw: u32, dh: u32) {
    let sw = sw as usize;
    let sh = sh as usize;
    let dw = dw as usize;
    let dh = dh as usize;
    for y in 0..dh {
        let sy = y * sh / dh;
        for x in 0..dw {
            let sx = x * sw / dw;
            let si = (sy * sw + sx) * 4;
            let di = (y * dw + x) * 4;
            if si + 3 < src.len() && di + 3 < dst.len() {
                dst[di..di + 4].copy_from_slice(&src[si..si + 4]);
            }
        }
    }
}

#[cfg(windows)]
unsafe extern "system" fn wnd_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::WindowsAndMessaging::{DefWindowProcW, DestroyWindow, PostQuitMessage, WM_CLOSE, WM_DESTROY, WM_DPICHANGED, WM_SIZE};
    match msg {
        WM_SIZE => {
            eprintln!("[NativeGpuTest] Resize WM_SIZE");
            windows::Win32::Foundation::LRESULT(0)
        }
        WM_DPICHANGED => {
            eprintln!("[NativeGpuTest] WM_DPICHANGED");
            windows::Win32::Foundation::LRESULT(0)
        }
        WM_CLOSE => {
            shared().stop.store(true, Ordering::SeqCst);
            let _ = DestroyWindow(hwnd);
            windows::Win32::Foundation::LRESULT(0)
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            windows::Win32::Foundation::LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}
