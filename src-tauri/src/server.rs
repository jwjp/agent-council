use crate::{engine::Engine, model::*};
use anyhow::Result;
use axum::{
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event as SseEvent, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, convert::Infallible, sync::Arc, time::Duration};
use tower_http::cors::CorsLayer;

#[derive(Clone, Serialize, Deserialize)]
pub struct Runtime {
    pub url: String,
    pub token: String,
    pub version: String,
    pub pid: u32,
    #[serde(default)]
    pub revision: u32,
}
#[derive(Clone)]
pub struct Server {
    pub engine: Arc<Engine>,
    pub token: String,
}
type ApiResult = std::result::Result<Json<Value>, ApiError>;
pub struct ApiError(StatusCode, String);
impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        let text = e.to_string();
        let status = if text.contains("already running") {
            StatusCode::CONFLICT
        } else {
            StatusCode::BAD_REQUEST
        };
        Self(status, text)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error":self.1}))).into_response()
    }
}
async fn auth(State(s): State<Server>, req: Request, next: Next) -> Response {
    if req
        .headers()
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        != Some(&format!("Bearer {}", s.token))
    {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"Authentication required"})),
        )
            .into_response();
    }
    next.run(req).await
}
pub fn router(s: Server) -> Router {
    let origins = [
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
        "http://127.0.0.1:1420",
    ]
    .map(|s| s.parse::<HeaderValue>().unwrap());
    Router::new()
        .route(
            "/v1/health",
            get(|| async { Json(json!({"version":VERSION,"pid":std::process::id()})) }),
        )
        .route("/v1/state", get(snapshot))
        .route("/v1/settings", axum::routing::put(settings))
        .route("/v1/draft", axum::routing::put(draft))
        .route("/v1/files/read", axum::routing::post(read_file))
        .route("/v1/jobs", axum::routing::post(start))
        .route("/v1/jobs/{id}/cancel", axum::routing::post(cancel))
        .route("/v1/events", get(events))
        .route("/v1/usage/refresh", axum::routing::post(refresh))
        .route("/v1/update", get(update))
        .route("/v1/maintenance", axum::routing::post(maintenance))
        .route_layer(middleware::from_fn_with_state(s.clone(), auth))
        .layer(DefaultBodyLimit::max(131072))
        .layer(
            CorsLayer::new()
                .allow_origin(origins)
                .allow_methods([Method::GET, Method::PUT, Method::POST])
                .allow_headers([
                    axum::http::header::AUTHORIZATION,
                    axum::http::header::CONTENT_TYPE,
                ]),
        )
        .with_state(s)
}
async fn snapshot(State(s): State<Server>) -> ApiResult {
    Ok(Json(s.engine.state()?))
}
async fn settings(State(s): State<Server>, Json(config): Json<Settings>) -> ApiResult {
    s.engine.save_settings(config)?;
    Ok(Json(s.engine.state()?))
}
#[derive(Deserialize)]
struct Maintenance {
    enabled: bool,
}
async fn maintenance(State(s): State<Server>, Json(input): Json<Maintenance>) -> ApiResult {
    s.engine.maintenance(input.enabled)?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
struct Draft {
    folder: String,
    text: String,
}
async fn draft(State(s): State<Server>, Json(draft): Json<Draft>) -> ApiResult {
    if draft.text.len() > 64000 {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Draft is too long".into(),
        ));
    }
    s.engine.store.put(
        &format!("draft:{}", folder_key(&canonical(&draft.folder)?)),
        &json!(draft.text),
    )?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
struct FileLink {
    target: String,
}
async fn read_file(State(s): State<Server>, Json(link): Json<FileLink>) -> ApiResult {
    let settings = s.engine.settings.lock().unwrap().clone();
    let preview = tokio::task::spawn_blocking(move || {
        crate::files::read(&settings.folder, &settings.references, &link.target)
    })
    .await
    .map_err(anyhow::Error::from)??;
    Ok(Json(json!(preview)))
}
#[derive(Deserialize)]
struct Start {
    request: String,
    request_id: String,
}
async fn start(State(s): State<Server>, Json(input): Json<Start>) -> ApiResult {
    Ok(Json(json!(s
        .engine
        .start(input.request, input.request_id)?)))
}
async fn cancel(State(s): State<Server>, Path(id): Path<String>) -> ApiResult {
    s.engine.cancel(&id)?;
    Ok(Json(json!({"ok":true})))
}
async fn refresh(State(s): State<Server>) -> ApiResult {
    tokio::spawn(s.engine.refresh_limits());
    Ok(Json(json!({"ok":true})))
}
async fn update() -> ApiResult {
    Ok(Json(crate::updates::available().await?))
}
async fn events(
    State(s): State<Server>,
    Query(q): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let mut after = q
        .get("after")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0)
        .max(0);
    let stream = async_stream::stream! {
        loop {match s.engine.store.events(after){Ok(events)=>{let empty=events.is_empty();for event in events {after=event.id;yield Ok::<_,Infallible>(SseEvent::default().id(after.to_string()).data(serde_json::to_string(&event).unwrap()));}if !empty{continue;}},Err(_)=>break}
            tokio::time::sleep(Duration::from_millis(180)).await;
        }
    };
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}
pub async fn serve() -> Result<()> {
    use fs2::FileExt;
    std::fs::create_dir_all(data_dir())?;
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(data_dir().join("runtime.lock"))?;
    if lock.try_lock_exclusive().is_err() {
        return Ok(());
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let runtime = Runtime {
        url: format!("http://{}", listener.local_addr()?),
        token: format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        ),
        version: VERSION.into(),
        pid: std::process::id(),
        revision: 2,
    };
    let engine = Engine::new()?;
    let path = data_dir().join("runtime.json");
    let temp = data_dir().join("runtime.json.tmp");
    std::fs::write(&temp, serde_json::to_vec(&runtime)?)?;
    std::fs::rename(temp, path)?;
    let s = Server {
        engine: engine.clone(),
        token: runtime.token,
    };
    tokio::spawn(async move {
        loop {
            engine.clone().refresh_limits().await;
            tokio::time::sleep(Duration::from_secs(300)).await;
        }
    });
    axum::serve(listener, router(s)).await?;
    drop(lock);
    Ok(())
}
pub async fn running() -> Option<Runtime> {
    let runtime: Runtime =
        serde_json::from_slice(&std::fs::read(data_dir().join("runtime.json")).ok()?).ok()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(800))
        .build()
        .ok()?;
    let response = client
        .get(format!("{}/v1/health", runtime.url))
        .bearer_auth(&runtime.token)
        .send()
        .await
        .ok()?;
    if response.status().is_success() {
        Some(runtime)
    } else {
        None
    }
}
pub async fn connect() -> Result<Runtime> {
    if let Some(runtime) = running().await {
        if runtime.version == VERSION && runtime.revision == 2 {
            return Ok(runtime);
        }
        let snapshot: Value = reqwest::Client::new()
            .get(format!("{}/v1/state", runtime.url))
            .bearer_auth(&runtime.token)
            .send()
            .await?
            .json()
            .await?;
        anyhow::ensure!(
            snapshot["running_jobs"].as_u64() == Some(0),
            "Finish or cancel the older app's running tasks before restarting."
        );
        #[cfg(windows)]
        {
            let mut stop = tokio::process::Command::new("taskkill.exe");
            stop.args(["/PID", &runtime.pid.to_string(), "/T", "/F"]);
            crate::process::hidden(&mut stop);
            stop.output().await?;
        }
        #[cfg(not(windows))]
        {
            tokio::process::Command::new("kill")
                .args(["-TERM", &runtime.pid.to_string()])
                .output()
                .await?;
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
    let mut command = tokio::process::Command::new(std::env::current_exe()?);
    command.arg("--serve");
    crate::process::hidden(&mut command);
    command.spawn()?;
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(200)).await;
        if let Some(runtime) = running().await {
            return Ok(runtime);
        }
    }
    anyhow::bail!(
        "The Rust runtime did not start. See the runtime log in the AgentCouncil data folder."
    )
}
