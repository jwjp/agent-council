#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod engine;
mod model;
mod process;
mod quota;
mod server;
mod store;
mod updates;

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
    if std::env::args().any(|a| a == "--ensure-server") {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        if runtime.block_on(server::connect()).is_err() {
            std::process::exit(1);
        }
        return;
    }
    if std::env::args().any(|a| a == "--serve") {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        if let Err(error) = runtime.block_on(server::serve()) {
            let _ = std::fs::write(
                model::data_dir().join("runtime-error.log"),
                error.to_string(),
            );
        }
        return;
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
