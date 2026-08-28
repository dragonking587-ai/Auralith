use serde::Serialize;
use std::sync::Mutex;

const SHM_NAME: &str = "Local\\AuralithRebornCam_SHM";
const MAGIC: u32 = 0x4152434D;
const MAX_W: u32 = 1920;
const MAX_H: u32 = 1920;
const HEADER: usize = 40;
fn shm_bytes() -> usize { HEADER + (MAX_W * MAX_H * 4) as usize }

#[derive(Default)]
struct Shm {
    map: Option<isize>,
    view: Option<*mut u8>,
    running: bool,
    seq: u32,
    last_err: String,
}
unsafe impl Send for Shm {}

static SHM: Mutex<Shm> = Mutex::new(Shm {
    map: None,
    view: None,
    running: false,
    seq: 0,
    last_err: String::new(),
});

#[derive(Serialize)]
pub struct VcamStatus {
    pub state: String,
    pub installed: bool,
    pub running: bool,
    pub seq: u32,
    pub error: String,
    pub device: String,
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::ffi::c_void;
    use std::ptr;
    const PAGE_READWRITE: u32 = 0x04;
    const FILE_MAP_ALL_ACCESS: u32 = 0x000F001F;
    const INVALID_HANDLE_VALUE: isize = -1;
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateFileMappingW(h: isize, a: *mut c_void, prot: u32, hi: u32, lo: u32, name: *const u16) -> isize;
        fn MapViewOfFile(h: isize, acc: u32, hi: u32, lo: u32, n: usize) -> *mut c_void;
        fn UnmapViewOfFile(p: *mut c_void) -> i32;
        fn CloseHandle(h: isize) -> i32;
    }
    fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() }
    pub fn open_shm() -> Result<(*mut u8, isize), String> {
        let n = wide(SHM_NAME);
        unsafe {
            let h = CreateFileMappingW(INVALID_HANDLE_VALUE, ptr::null_mut(), PAGE_READWRITE, 0, shm_bytes() as u32, n.as_ptr());
            if h == 0 { return Err("CreateFileMapping failed".into()); }
            let v = MapViewOfFile(h, FILE_MAP_ALL_ACCESS, 0, 0, shm_bytes());
            if v.is_null() { CloseHandle(h); return Err("MapViewOfFile failed".into()); }
            Ok((v as *mut u8, h))
        }
    }
    pub fn close_shm(view: *mut u8, h: isize) {
        unsafe { UnmapViewOfFile(view as *mut c_void); CloseHandle(h); }
    }
}

fn dll_path() -> std::path::PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    let dir = exe.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    for c in [
        dir.join("auralith_reborn_vcam.dll"),
        dir.join("resources").join("auralith_reborn_vcam.dll"),
        dir.join("vcam").join("auralith_reborn_vcam.dll"),
    ] {
        if c.exists() { return c; }
    }
    dir.join("auralith_reborn_vcam.dll")
}

fn is_registered() -> bool {
    #[cfg(windows)]
    {
        use std::process::Command;
        let out = Command::new("reg")
            .args(["query", r"HKCR\CLSID\{8F3C1A90-7B2E-4D61-9C4A-B7E21F0A4C01}", "/ve"])
            .output();
        return out.map(|o| o.status.success()).unwrap_or(false);
    }
    #[cfg(not(windows))]
    false
}

#[tauri::command]
pub fn vcam_status() -> VcamStatus {
    let g = SHM.lock().unwrap();
    VcamStatus {
        state: if g.running { "LIVE".into() } else if is_registered() { "READY".into() } else { "NOT INSTALLED".into() },
        installed: is_registered(),
        running: g.running,
        seq: g.seq,
        error: g.last_err.clone(),
        device: "Auralith Reborn Camera".into(),
    }
}

#[tauri::command]
pub fn vcam_install() -> Result<String, String> {
    eprintln!("VCAM_INSTALL_BEGIN");
    let dll = dll_path();
    if !dll.exists() {
        let msg = format!("VCAM_INSTALL_FAILED missing {}", dll.display());
        eprintln!("{msg}");
        return Err(msg);
    }
    #[cfg(windows)]
    {
        let status = std::process::Command::new("regsvr32")
            .args(["/s", dll.to_str().unwrap_or("")])
            .status()
            .map_err(|e| format!("VCAM_INSTALL_FAILED {e}"))?;
        if !status.success() {
            // retry elevated
            let _ = std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command",
                    &format!("Start-Process regsvr32 -ArgumentList '/s','{}' -Verb RunAs -Wait", dll.display())])
                .status();
        }
        if is_registered() {
            eprintln!("VCAM_INSTALL_OK VCAM_REGISTERED VCAM_ENUMERATION_READY");
            return Ok("installed".into());
        }
        return Err("VCAM_INSTALL_FAILED registration not visible".into());
    }
    #[cfg(not(windows))]
    Err("Windows only".into())
}

#[tauri::command]
pub fn vcam_start() -> Result<String, String> {
    eprintln!("VCAM_START_BEGIN");
    let mut g = SHM.lock().unwrap();
    #[cfg(windows)]
    {
        if g.view.is_none() {
            match win::open_shm() {
                Ok((v, h)) => { g.view = Some(v); g.map = Some(h); }
                Err(e) => { g.last_err = e.clone(); eprintln!("VCAM_START_FAILED {e}"); return Err(e); }
            }
        }
        unsafe {
            if let Some(v) = g.view {
                std::ptr::write_unaligned(v as *mut u32, MAGIC);
                std::ptr::write_unaligned(v.add(24) as *mut u32, 1); // running
            }
        }
        g.running = true;
        start_ingest();
        eprintln!("VCAM_START_OK");
        return Ok("LIVE".into());
    }
    #[cfg(not(windows))]
    Err("Windows only".into())
}

#[tauri::command]
pub fn vcam_stop() -> Result<String, String> {
    eprintln!("VCAM_STOP_BEGIN");
    let mut g = SHM.lock().unwrap();
    g.running = false;
    #[cfg(windows)]
    unsafe {
        if let Some(v) = g.view {
            std::ptr::write_unaligned(v.add(24) as *mut u32, 0);
        }
    }
    eprintln!("VCAM_STOP_OK");
    Ok("STOPPED".into())
}

#[tauri::command]
pub fn vcam_push_frame(width: u32, height: u32, pixels: Vec<u8>) -> Result<u32, String> {
    let mut g = SHM.lock().unwrap();
    if !g.running { return Err("not running".into()); }
    if width == 0 || height == 0 || width > MAX_W || height > MAX_H {
        return Err("bad size".into());
    }
    let stride = width * 4;
    let need = (stride * height) as usize;
    if pixels.len() < need { return Err("short buffer".into()); }
    #[cfg(windows)]
    unsafe {
        let Some(v) = g.view else { return Err("no shm".into()); };
        g.seq = g.seq.wrapping_add(1);
        std::ptr::write_unaligned(v as *mut u32, MAGIC);
        std::ptr::write_unaligned(v.add(4) as *mut u32, width);
        std::ptr::write_unaligned(v.add(8) as *mut u32, height);
        std::ptr::write_unaligned(v.add(12) as *mut u32, stride);
        std::ptr::write_unaligned(v.add(16) as *mut u32, 1);
        std::ptr::write_unaligned(v.add(20) as *mut u32, g.seq);
        std::ptr::write_unaligned(v.add(24) as *mut u32, 1);
        std::ptr::copy_nonoverlapping(pixels.as_ptr(), v.add(HEADER), need);
        if g.seq % 120 == 1 {
            eprintln!("FRAME_PRODUCED seq={} size={}x{} format=BGRA FRAME_SHARED VCAM_FRAME_DELIVERED", g.seq, width, height);
        }
        return Ok(g.seq);
    }
    #[cfg(not(windows))]
    Err("Windows only".into())
}


#[cfg(windows)]
fn start_ingest() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    std::thread::spawn(|| {
        let Ok(listener) = TcpListener::bind("127.0.0.1:17331") else { return; };
        eprintln!("[Vcam] ingest http://127.0.0.1:17331");
        for stream in listener.incoming() {
            let Ok(mut s) = stream else { continue; };
            let mut buf = vec![0u8; 16 * 1024 * 1024];
            let n = s.read(&mut buf).unwrap_or(0);
            if n < 64 { let _=s.write_all(b"HTTP/1.1 400 OK\r\nContent-Length:0\r\n\r\n"); continue; }
            let head = match buf[..n].windows(4).position(|w| w==b"\r\n\r\n") {
                Some(i) => i+4,
                None => { let _=s.write_all(b"HTTP/1.1 400 OK\r\nContent-Length:0\r\n\r\n"); continue; }
            };
            let header = String::from_utf8_lossy(&buf[..head]);
            let mut w = 1280u32; let mut h = 720u32;
            if let Some(q) = header.split("?").nth(1) {
                for part in q.split(&[' ','&'][..]) {
                    if let Some(v) = part.strip_prefix("w=") { w = v.parse().unwrap_or(w); }
                    if let Some(v) = part.strip_prefix("h=") { h = v.parse().unwrap_or(h); }
                }
            }
            let body = buf[head..n].to_vec();
            let _ = vcam_push_frame(w, h, body);
            let _ = s.write_all(b"HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\n\r\n");
        }
    });
}
