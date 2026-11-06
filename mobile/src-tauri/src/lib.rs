//! Phone shell only. No desktop runtime, provider authentication or CLI execution.
use council_client::{Client, Decoder, Error};
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use tauri::{ipc::Channel, Manager, State};
use tauri_plugin_secure_link::SecureLinkExt;
use tokio::sync::Mutex as AsyncMutex;
use tokio_util::sync::CancellationToken;

struct Connection {
    client: Client,
    loaded: bool,
}
struct Mobile {
    connection: AsyncMutex<Connection>,
    stream: Mutex<Option<(u64, CancellationToken)>>,
    next: AtomicU64,
}
fn failure(message: impl Into<String>) -> Error {
    Error {
        status: 500,
        message: message.into(),
    }
}
fn stop(mobile: &Mobile) {
    if let Some((_, token)) = mobile.stream.lock().unwrap().take() {
        token.cancel();
    }
}
async fn load(app: &tauri::AppHandle, connection: &mut Connection) -> Result<(), Error> {
    if connection.loaded {
        return Ok(());
    }
    if let Some(saved) = app.secure_link().load().map_err(failure)? {
        // Invalid/locked storage is surfaced, never silently replaced with plaintext.
        connection.client.restore(&saved)?;
    }
    connection.loaded = true;
    Ok(())
}
fn persist(app: &tauri::AppHandle, client: &Client) -> Result<(), Error> {
    match client.storage_record() {
        Some(record) => app.secure_link().save(&record).map_err(failure),
        None => app.secure_link().clear().map_err(failure),
    }
}
#[tauri::command]
async fn mobile_request(
    app: tauri::AppHandle,
    state: State<'_, Mobile>,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value, Error> {
    let mut c = state.connection.lock().await;
    load(&app, &mut c).await?;
    let before = c.client.storage_record();
    let result = c.client.request(&method, &path, body).await;
    if before != c.client.storage_record() {
        if let Err(e) = persist(&app, &c.client) {
            c.client.forget();
            stop(&state);
            return Err(e);
        }
    }
    if path == "/logout" || result.as_ref().err().is_some_and(|e| e.status == 401) {
        stop(&state);
    }
    result
}
#[tauri::command]
async fn mobile_pair(
    app: tauri::AppHandle,
    state: State<'_, Mobile>,
    link: String,
    name: String,
) -> Result<Value, Error> {
    let mut c = state.connection.lock().await;
    load(&app, &mut c).await?;
    let value = c.client.pair(&link, &name).await?;
    stop(&state);
    // Only an approved device is persisted. Pending approval lives in memory.
    app.secure_link().clear().map_err(failure)?;
    Ok(value)
}
#[derive(Clone, Serialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
enum Frame {
    Connected,
    Event(council_client::Event),
    Error(ErrorFrame),
    Closed,
}
#[derive(Clone, Serialize)]
struct ErrorFrame {
    status: u16,
    message: String,
}
#[tauri::command]
async fn mobile_events(
    app: tauri::AppHandle,
    state: State<'_, Mobile>,
    after: i64,
    channel: Channel<Frame>,
) -> Result<u64, Error> {
    let client = {
        let mut c = state.connection.lock().await;
        load(&app, &mut c).await?;
        c.client.clone()
    };
    stop(&state);
    let id = state.next.fetch_add(1, Ordering::Relaxed);
    let token = CancellationToken::new();
    *state.stream.lock().unwrap() = Some((id, token.clone()));
    tauri::async_runtime::spawn(async move {
        let run = async {
            let response = client.events(after).await?;
            channel
                .send(Frame::Connected)
                .map_err(|_| failure("Event channel closed."))?;
            let mut stream = response.bytes_stream();
            let mut decoder = Decoder::default();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(Error::from)?;
                for event in decoder.push(&chunk)? {
                    channel
                        .send(Frame::Event(event))
                        .map_err(|_| failure("Event channel closed."))?;
                }
            }
            Ok::<(), Error>(())
        };
        tokio::select! {
            _=token.cancelled()=>{},
            result=run=>if let Err(e)=result {let _=channel.send(Frame::Error(ErrorFrame {status:e.status,message:e.message}));},
        }
        let _ = channel.send(Frame::Closed);
    });
    Ok(id)
}
#[tauri::command]
fn mobile_stop(state: State<'_, Mobile>, id: u64) {
    let mut current = state.stream.lock().unwrap();
    if current.as_ref().is_some_and(|(active, _)| *active == id) {
        if let Some((_, token)) = current.take() {
            token.cancel();
        }
    }
}
#[tauri::command]
async fn mobile_forget(app: tauri::AppHandle, state: State<'_, Mobile>) -> Result<(), Error> {
    let mut c = state.connection.lock().await;
    app.secure_link().clear().map_err(failure)?;
    c.client.forget();
    c.loaded = true;
    stop(&state);
    Ok(())
}
#[tauri::command]
fn mobile_open_web(app: tauri::AppHandle, url: String) -> Result<(), Error> {
    // Enforce HTTPS again in Swift/Kotlin, and always use the system browser.
    let parsed = reqwest_url(&url)?;
    app.secure_link().open_web(&parsed).map_err(failure)
}
fn reqwest_url(value: &str) -> Result<String, Error> {
    // Parsing via Tauri's URL type avoids shell/open commands on mobile.
    let url = tauri::Url::parse(value).map_err(|_| failure("Invalid web address."))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(failure("Only HTTPS web links are allowed."));
    }
    Ok(url.into())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_secure_link::init())
        .setup(|app| {
            let client = Client::new()
                .map_err(|_| std::io::Error::other("Cannot initialize secure transport."))?;
            app.manage(Mobile {
                connection: AsyncMutex::new(Connection {
                    client,
                    loaded: false,
                }),
                stream: Mutex::new(None),
                next: AtomicU64::new(1),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            mobile_request,
            mobile_pair,
            mobile_events,
            mobile_stop,
            mobile_forget,
            mobile_open_web
        ])
        .run(tauri::generate_context!())
        .expect("Cannot start Council Companion");
}
