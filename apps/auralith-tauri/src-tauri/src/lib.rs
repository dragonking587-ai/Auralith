mod vcam;
mod poll_server;

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
        fn GetWindow(hwnd: *mut c_void, cmd: u32) -> *mut c_void;
    }
    const GW_CHILD: u32 = 5;
    const GW_HWNDNEXT: u32 = 2;
    fn patch(hwnd: *mut c_void) {
        if hwnd.is_null() || unsafe { IsWindow(hwnd) } == 0 { return; }
        unsafe {
            SetWindowDisplayAffinity(hwnd, WDA_NONE);
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let next = ex & !WS_EX_NOREDIRECTIONBITMAP & !WS_EX_LAYERED;
            if next != ex { SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next); }
            let mut child = GetWindow(hwnd, GW_CHILD);
            while !child.is_null() {
                patch(child);
                child = GetWindow(child, GW_HWNDNEXT);
            }
        }
    }
    pub fn install<R: Runtime>(app: &tauri::App<R>) {
        let Some(win) = app.get_webview_window("main") else { return; };
        let Ok(h) = win.hwnd() else { return; };
        let hwnd_bits = h.0 as usize;
        patch(hwnd_bits as *mut c_void);
        std::thread::spawn(move || {
            for ms in [300_u64, 1200] {
                std::thread::sleep(Duration::from_millis(ms));
                patch(hwnd_bits as *mut c_void);
            }
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-gpu-compositing --disable-features=msWebView2EnableDraggableRegions",
        );
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(std::sync::Arc::new(poll_server::PollServer::default()))
        .invoke_handler(tauri::generate_handler![
            vcam::vcam_status,
            vcam::vcam_install,
            vcam::vcam_start,
            vcam::vcam_stop,
            vcam::vcam_push_frame,
            poll_server::poll_server_status,
            poll_server::poll_server_start,
            poll_server::poll_server_set_hub,
            poll_server::poll_open_local,
            poll_server::poll_detach_host
        ])
        .setup(|app| {
            #[cfg(windows)]
            capture::install(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Auralith Reborn Preview");
}
