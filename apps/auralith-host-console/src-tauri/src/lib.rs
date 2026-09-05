use serde_json::{json, Value};
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

const APPROVED_THEME_CSS: &str = include_str!("../../web/approved-theme.css");

#[tauri::command]
async fn check_console_update(app: tauri::AppHandle) -> Result<Value, String> {
    let updater = app.updater_builder().build().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(json!({
            "available": true,
            "version": update.version,
            "notes": update.body.unwrap_or_default(),
        })),
        Ok(None) => Ok(json!({ "available": false })),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn install_console_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater_builder().build().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Err("No Host Console update is available.".into());
    };
    if update.version.contains("Reborn") {
        return Err("Refusing to install Main Auralith into Host Console.".into());
    }
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let css_json = serde_json::to_string(APPROVED_THEME_CSS)
                    .expect("Host Console theme should serialize");
                let script = [
                    "(()=>{const css=",
                    &css_json,
                    ";const apply=()=>{if(document.getElementById('auralith-approved-theme'))return;const s=document.createElement('style');s.id='auralith-approved-theme';s.textContent=css;(document.head||document.documentElement).appendChild(s);};if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',apply,{once:true});}else{apply();}})();",
                ]
                .concat();
                let _ = window.eval(&script);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![check_console_update, install_console_update])
        .run(tauri::generate_context!())
        .expect("error while running Auralith Host Console");
}
