#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use council_host::{model, server, updates};

#[tauri::command]
async fn bootstrap() -> Result<server::Runtime, String> {
    server::connect().await.map_err(|e| e.to_string())
}
#[tauri::command]
async fn select_folder(window: tauri::Window) -> Option<String> {
    rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .pick_folder()
        .await
        .map(|p| p.path().to_string_lossy().into())
}
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Only HTTP links are allowed".into());
    }
    open::that(url).map_err(|e| e.to_string())
}
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    updates::install().await.map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}
fn main() {
    match council_host::run_cli_mode() {
        Ok(true) => return,
        Ok(false) => {}
        Err(error) => {
            let _ = std::fs::write(
                model::data_dir().join("runtime-error.log"),
                error.to_string(),
            );
            std::process::exit(1);
        }
    }
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            select_folder,
            open_external,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("Cannot start Agent Council");
}
