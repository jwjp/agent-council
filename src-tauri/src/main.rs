#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use council_host::{model, platform, server, updates};

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
fn open_store_updates() -> Result<(), String> {
    if platform::package_local_state().is_none() {
        return Err("Microsoft Store updates require a Windows package installation.".into());
    }
    open::that(updates::STORE_UPDATES_URI).map_err(|e| e.to_string())
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
    let mut context = tauri::generate_context!();
    let package_webview = platform::package_local_state().map(|root| root.join("webview"));
    let mut package_windows = Vec::new();
    if package_webview.is_some() {
        for config in &mut context.config_mut().app.windows {
            if config.create {
                package_windows.push(config.clone());
                config.create = false;
            }
        }
    }
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            select_folder,
            open_external,
            open_store_updates,
            install_update
        ])
        .setup(move |app| {
            if let Some(directory) = &package_webview {
                for config in &package_windows {
                    tauri::WebviewWindowBuilder::from_config(app, config)?
                        .data_directory(directory.clone())
                        .build()?;
                }
            }
            Ok(())
        })
        .run(context)
        .expect("Cannot start Agent Council");
}
