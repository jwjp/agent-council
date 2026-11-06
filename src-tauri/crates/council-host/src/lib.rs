//! Desktop execution host; deliberately independent of Tauri and native UI libraries.
pub mod engine;
pub mod files;
pub mod model;
pub mod platform;
pub mod process;
pub mod quota;
pub mod server;
pub mod store;
pub mod updates;

/// Shared by the desktop executable and the headless host executable.
/// Returns true if a host-mode argument was handled.
pub fn run_cli_mode() -> anyhow::Result<bool> {
    let args: Vec<_> = std::env::args().collect();
    let ensure = args.iter().any(|a| a == "--ensure-server");
    let serve = args.iter().any(|a| a == "--serve");
    if !ensure && !serve {
        return Ok(false);
    }
    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(async {
        if ensure {
            server::connect().await.map(|_| ())
        } else {
            server::serve().await
        }
    })?;
    Ok(true)
}
