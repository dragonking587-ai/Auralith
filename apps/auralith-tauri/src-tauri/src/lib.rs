#[cfg(windows)]
mod capture {
    use std::ffi::c_void;
    use std::time::Duration;
    use tauri::{Manager, Runtime};

    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_NOREDIRECTIONBITMAP: isize = 0x0020_0000;
    const WS_EX_LAYERED: isize = 0x0008_0000;
    const WDA_NONE: u32 = 0;

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowDisplayAffinity(hwnd: *mut c_void, affinity: u32) -> i32;
        fn GetWindowLongPtrW(hwnd: *mut c_void, index: i32) -> isize;
        fn SetWindowLongPtrW(hwnd: *mut c_void, index: i32, value: isize) -> isize;
        fn IsWindow(hwnd: *mut c_void) -> i32;
        fn IsWindowVisible(hwnd: *mut c_void) -> i32;
        fn GetWindow(hwnd: *mut c_void, cmd: u32) -> *mut c_void;
        fn GetWindowThreadProcessId(hwnd: *mut c_void, pid: *mut u32) -> u32;
    }
    const GW_CHILD: u32 = 5;
    const GW_HWNDNEXT: u32 = 2;

    fn patch(hwnd: *mut c_void) {
        if hwnd.is_null() || unsafe { IsWindow(hwnd) } == 0 {
            return;
        }
        unsafe {
            SetWindowDisplayAffinity(hwnd, WDA_NONE);
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let mut next = ex & !WS_EX_NOREDIRECTIONBITMAP;
            // Layered parent with empty bitmap reads as blank in BitBlt.
            next &= !WS_EX_LAYERED;
            if next != ex {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
            }
        }
        let visible = unsafe { IsWindowVisible(hwnd) } != 0;
        eprintln!(
            "[Capture] OUTPUT_HWND hwnd={hwnd:?} visible={visible} CAPTURE_EXCLUSION_DISABLED WGC_COMPATIBLE attempted"
        );
        let mut child = unsafe { GetWindow(hwnd, GW_CHILD) };
        while !child.is_null() {
            patch(child);
            child = unsafe { GetWindow(child, GW_HWNDNEXT) };
        }
    }

    pub fn install<R: Runtime>(app: &tauri::App<R>) {
        let Some(win) = app.get_webview_window("main") else {
            eprintln!("[Capture] OUTPUT_HWND_CREATED missing main window");
            return;
        };
        let hwnd = match win.hwnd() {
            Ok(h) => h.0 as *mut c_void,
            Err(e) => {
                eprintln!("[Capture] hwnd error: {e}");
                return;
            }
        };
        eprintln!("[Capture] OUTPUT_HWND_CREATED {hwnd:?}");
        patch(hwnd);
        std::thread::spawn(move || {
            for ms in [300_u64, 1000, 2500] {
                std::thread::sleep(Duration::from_millis(ms));
                patch(hwnd);
                eprintln!("[Capture] OUTPUT_HWND_VISIBLE patched after {ms}ms");
            }
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    {
        // Keep WebGL; stop Visual/DComp-only presentation so OBS can see the HWND.
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-gpu-compositing --disable-features=msWebView2EnableDraggableRegions",
        );
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            #[cfg(windows)]
            capture::install(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Auralith Reborn Preview");
}
