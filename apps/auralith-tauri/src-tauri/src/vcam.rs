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

const CLSID: &str = r"{8F3C1A90-7B2E-4D61-9C4A-B7E21F0A4C01}";
const CAT_VIDEO: &str = r"{860BB310-5D01-11d0-BD3B-00A0C911CE86}";
const FRIENDLY: &str = "Auralith Reborn Camera";

fn log_vcam(line: &str) {
    eprintln!("{line}");
    if let Some(base) = std::env::var_os("LOCALAPPDATA") {
        let dir = std::path::PathBuf::from(base).join("Auralith").join("Logs");
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("virtual-camera.log")) {
            use std::io::Write;
            let _ = writeln!(f, "{}", line);
        }
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

fn stable_dll() -> Result<std::path::PathBuf, String> {
    let src = dll_path();
    if !src.exists() {
        return Err(format!("VCAM MEDIA SOURCE NOT FOUND path={}", src.display()));
    }
    let dest_dir = std::path::PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default())
        .join("Auralith")
        .join("vcam");
    std::fs::create_dir_all(&dest_dir).map_err(|e| format!("VCAM COPY FAILED {e}"))?;
    let dest = dest_dir.join("auralith_reborn_vcam.dll");
    if src != dest {
        std::fs::copy(&src, &dest).map_err(|e| format!("VCAM COPY FAILED {e}"))?;
    }
    Ok(dest)
}

#[cfg(windows)]
mod reg {
    use super::*;
    use std::ffi::c_void;
    use std::ptr;
    const KEY_READ: u32 = 0x20019;
    const KEY_WRITE: u32 = 0x20006;
    const REG_SZ: u32 = 1;
    #[link(name = "advapi32")]
    extern "system" {
        fn RegCreateKeyExW(h: isize, sub: *const u16, r: u32, c: *mut u16, opt: u32, sam: u32, sec: *mut c_void, out: *mut isize, disp: *mut u32) -> i32;
        fn RegSetValueExW(h: isize, name: *const u16, r: u32, ty: u32, data: *const u8, cb: u32) -> i32;
        fn RegOpenKeyExW(h: isize, sub: *const u16, opt: u32, sam: u32, out: *mut isize) -> i32;
        fn RegCloseKey(h: isize) -> i32;
    }
    fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() }
    fn set_sz(root: isize, path: &str, name: Option<&str>, val: &str) -> Result<(), String> {
        let p = wide(path);
        let mut key = 0isize;
        let e = unsafe { RegCreateKeyExW(root, p.as_ptr(), 0, ptr::null_mut(), 0, KEY_WRITE, ptr::null_mut(), &mut key, ptr::null_mut()) };
        if e != 0 { return Err(format!("RegCreateKeyEx 0x{:08X} {path}", e as u32)); }
        let n = name.map(wide);
        let v = wide(val);
        let e = unsafe {
            RegSetValueExW(key, n.as_ref().map(|x| x.as_ptr()).unwrap_or(ptr::null()), 0, REG_SZ, v.as_ptr() as *const u8, (v.len() * 2) as u32)
        };
        unsafe { RegCloseKey(key); }
        if e != 0 { return Err(format!("RegSetValueEx 0x{:08X} {path}", e as u32)); }
        Ok(())
    }
    pub fn key_exists(root: isize, path: &str) -> bool {
        let p = wide(path);
        let mut key = 0isize;
        let e = unsafe { RegOpenKeyExW(root, p.as_ptr(), 0, KEY_READ, &mut key) };
        if e == 0 { unsafe { RegCloseKey(key); } true } else { false }
    }
    pub fn write_camera_keys(root: isize, prefix: &str, dll: &str) -> Result<(), String> {
        let clsid = format!("{prefix}CLSID\\{CLSID}");
        let inproc = format!("{clsid}\\InprocServer32");
        let inst = format!("{prefix}CLSID\\{CAT_VIDEO}\\Instance\\{CLSID}");
        set_sz(root, &clsid, None, FRIENDLY)?;
        set_sz(root, &inproc, None, dll)?;
        set_sz(root, &inproc, Some("ThreadingModel"), "Both")?;
        set_sz(root, &inst, Some("FriendlyName"), FRIENDLY)?;
        set_sz(root, &inst, Some("CLSID"), CLSID)?;
        Ok(())
    }
}

fn is_registered() -> bool {
    #[cfg(windows)]
    {
        const HKCR: isize = 0x80000000u32 as i32 as isize;
        const HKCU: isize = 0x80000001u32 as i32 as isize;
        const HKLM: isize = 0x80000002u32 as i32 as isize;
        let paths = [
            (HKCR, format!(r"CLSID\{CLSID}")),
            (HKCU, format!(r"Software\Classes\CLSID\{CLSID}")),
            (HKLM, format!(r"Software\Classes\CLSID\{CLSID}")),
        ];
        return paths.iter().any(|(r, p)| reg::key_exists(*r, p));
    }
    #[cfg(not(windows))]
    false
}

#[tauri::command]
pub fn vcam_status() -> VcamStatus {
    #[cfg(windows)]
    {
        let mut g = SHM.lock().unwrap();
        if g.view.is_none() {
            if let Ok((v, h)) = win::open_shm() {
                g.view = Some(v);
                g.map = Some(h);
            }
        }
    }
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
    log_vcam("VCAM_INSTALL_BEGIN architecture=DirectShow (not MFCreateVirtualCamera)");
    log_vcam(&format!("CLSID={CLSID} name={FRIENDLY}"));
    let dll = stable_dll()?;
    log_vcam(&format!("Media Source DLL: FOUND {}", dll.display()));

    #[cfg(windows)]
    {
        const HKCU: isize = 0x80000001u32 as i32 as isize;
        const HKLM: isize = 0x80000002u32 as i32 as isize;
        let dll_s = dll.to_string_lossy().to_string();

        match reg::write_camera_keys(HKCU, r"Software\Classes\", &dll_s) {
            Ok(()) => log_vcam("COM CLSID: REGISTERED HKCU\\Software\\Classes"),
            Err(e) => {
                log_vcam(&format!("VCAM CREATE FAILED HKCU {e}"));
                return Err(format!("VCAM CREATE FAILED {e}"));
            }
        }

        match reg::write_camera_keys(HKLM, r"Software\Classes\", &dll_s) {
            Ok(()) => log_vcam("COM CLSID: REGISTERED HKLM (all users)"),
            Err(e) => log_vcam(&format!("HKLM write skipped (elevation may be required): {e}")),
        }

        let sys_regsvr = r"C:\Windows\System32\regsvr32.exe";
        let st = std::process::Command::new(sys_regsvr)
            .args(["/s", &dll_s])
            .status();
        log_vcam(&format!("regsvr32 System32 status={st:?}"));
        if !st.map(|s| s.success()).unwrap_or(false) {
            let arg = format!(
                "Start-Process -FilePath '{}' -ArgumentList '/s','{}' -Verb RunAs -Wait",
                sys_regsvr.replace('\'', "''"),
                dll_s.replace('\'', "''")
            );
            let _ = std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &arg])
                .status();
            log_vcam("regsvr32 elevated retry issued");
        }

        if !is_registered() {
            let msg = "VCAM STARTED BUT NOT ENUMERATED CLSID key missing after HKCU/HKLM/regsvr32";
            log_vcam(msg);
            return Err(msg.into());
        }
        log_vcam("VCAM_INSTALL_OK VCAM_REGISTERED VCAM READY");
        return Ok("READY".into());
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
        std::ptr::write_unaligned(v.add(16) as *mut u32, 2); // RGBA
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
            let mut n = s.read(&mut buf).unwrap_or(0);
            if n < 16 { let _=s.write_all(b"HTTP/1.1 400 OK\r\nContent-Length:0\r\n\r\n"); continue; }
            let head = match buf[..n].windows(4).position(|w| w==b"\r\n\r\n") {
                Some(i) => i+4,
                None => { let _=s.write_all(b"HTTP/1.1 400 OK\r\nContent-Length:0\r\n\r\n"); continue; }
            };
            let header = String::from_utf8_lossy(&buf[..head]);
            let mut w = 1280u32; let mut h = 720u32;
            let mut clen: Option<usize> = None;
            for line in header.split("\r\n") {
                let low = line.to_ascii_lowercase();
                if let Some(v) = low.strip_prefix("content-length:") {
                    clen = v.trim().parse().ok();
                }
            }
            if let Some(q) = header.split("?").nth(1) {
                for part in q.split(&[' ','&'][..]) {
                    if let Some(v) = part.strip_prefix("w=") { w = v.parse().unwrap_or(w); }
                    if let Some(v) = part.strip_prefix("h=") { h = v.parse().unwrap_or(h); }
                }
            }
            let need = clen.unwrap_or((w as usize) * (h as usize) * 4);
            while n - head < need && n < buf.len() {
                match s.read(&mut buf[n..]) {
                    Ok(0) => break,
                    Ok(k) => n += k,
                    Err(_) => break,
                }
            }
            let body = buf[head..n].to_vec();
            let _ = vcam_push_frame(w, h, body);
            let _ = s.write_all(b"HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\n\r\n");
        }
    });
}
