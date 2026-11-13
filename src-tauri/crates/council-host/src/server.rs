use crate::{engine::Engine, model::*};
use anyhow::Result;
use axum::{
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{header, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event as SseEvent, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::get,
    Json, Router,
};
pub use council_core::Runtime;
use council_core::RUNTIME_REVISION;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::HashMap, convert::Infallible, sync::Arc, time::Duration};
use tower_http::cors::CorsLayer;

#[derive(Clone)]
pub struct Server {
    pub engine: Arc<Engine>,
    pub token: String,
    pub companion: Arc<crate::companion::Companion>,
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
        .route("/v1/{provider}/accounts", get(agent_accounts))
        .route(
            "/v1/{provider}/accounts/check",
            axum::routing::post(check_agent_account),
        )
        .route(
            "/v1/{provider}/accounts/prepare",
            axum::routing::post(prepare_agent_account),
        )
        .route("/v1/draft", axum::routing::put(draft))
        .route("/v1/files/read", axum::routing::post(read_file))
        .route("/v1/jobs", axum::routing::post(start))
        .route("/v1/jobs/{id}/changes", get(job_changes))
        .route("/v1/jobs/{id}/cancel", axum::routing::post(cancel))
        .route("/v1/events", get(events))
        .route("/v1/usage/refresh", axum::routing::post(refresh))
        .route("/v1/update", get(update))
        .route("/v1/maintenance", axum::routing::post(maintenance))
        .route(
            "/v1/companion",
            get(crate::companion::status).put(crate::companion::configure),
        )
        .route(
            "/v1/companion/invitations",
            axum::routing::post(crate::companion::invite),
        )
        .route(
            "/v1/companion/invitations/{id}/approve",
            axum::routing::post(crate::companion::approve),
        )
        .route(
            "/v1/companion/invitations/{id}",
            axum::routing::delete(crate::companion::reject),
        )
        .route(
            "/v1/companion/devices/{id}",
            axum::routing::delete(crate::companion::revoke),
        )
        .route_layer(middleware::from_fn_with_state(s.clone(), auth))
        .layer(DefaultBodyLimit::max(131072))
        .layer(
            CorsLayer::new()
                .allow_origin(origins)
                .allow_methods([Method::GET, Method::PUT, Method::POST, Method::DELETE])
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
async fn job_changes(
    State(s): State<Server>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let id = uuid::Uuid::parse_str(&id)
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "Invalid job ID.".into()))?;
    let changes = s.engine.store.get(&format!("changes:{id}"))?;
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(changes)).into_response())
}
async fn settings(State(s): State<Server>, Json(config): Json<Settings>) -> ApiResult {
    s.engine.save_settings(config)?;
    Ok(Json(s.engine.state()?))
}
fn account_reply(value: impl serde::Serialize) -> Response {
    ([(header::CACHE_CONTROL, "no-store")], Json(value)).into_response()
}
fn account_provider(provider: &str) -> Result<&str, ApiError> {
    if crate::agent_accounts::PROVIDERS.contains(&provider) {
        Ok(provider)
    } else {
        Err(ApiError(
            StatusCode::NOT_FOUND,
            "Account profiles are unavailable for this provider.".into(),
        ))
    }
}
async fn agent_accounts(
    State(s): State<Server>,
    Path(provider): Path<String>,
) -> Result<Response, ApiError> {
    let settings = s.engine.settings.lock().unwrap().clone();
    Ok(account_reply(
        crate::agent_accounts::discover(account_provider(&provider)?, settings).await,
    ))
}
#[derive(Deserialize)]
struct AgentAccountFolder {
    config_dir: String,
}
async fn check_agent_account(
    Path(provider): Path<String>,
    Json(input): Json<AgentAccountFolder>,
) -> Result<Response, ApiError> {
    Ok(account_reply(
        crate::agent_accounts::check(account_provider(&provider)?, &input.config_dir).await?,
    ))
}
#[derive(Deserialize)]
struct AgentAccountPreparation {
    request_id: Option<String>,
}
async fn prepare_agent_account(
    Path(provider): Path<String>,
    input: Option<Json<AgentAccountPreparation>>,
) -> Result<Response, ApiError> {
    let id = input.as_ref().and_then(|input| input.request_id.as_deref());
    Ok(account_reply(crate::agent_accounts::prepare(
        account_provider(&provider)?,
        id,
    )?))
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
        crate::files::read(
            &settings.folder,
            &settings.references,
            &settings.agent_profiles,
            &link.target,
        )
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
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(data_dir(), std::fs::Permissions::from_mode(0o700))?;
    }
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
        revision: RUNTIME_REVISION,
    };
    let engine = Engine::new()?;
    let companion = crate::companion::Companion::new(engine.clone())?;
    tokio::spawn(companion.clone().run());
    let path = data_dir().join("runtime.json");
    let temp = data_dir().join("runtime.json.tmp");
    {
        use std::io::Write;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options
            .open(&temp)?
            .write_all(&serde_json::to_vec(&runtime)?)?;
    }
    std::fs::rename(temp, path)?;
    let s = Server {
        engine: engine.clone(),
        token: runtime.token,
        companion,
    };
    #[cfg(unix)]
    let shutdown_engine = engine.clone();
    tokio::spawn(async move {
        loop {
            engine.clone().refresh_limits().await;
            tokio::time::sleep(Duration::from_secs(300)).await;
        }
    });
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut terminate = signal(SignalKind::terminate())?;
        tokio::select! {
            result = async { axum::serve(listener, router(s)).await } => result?,
            _ = async { tokio::select! { _ = terminate.recv() => {}, _ = tokio::signal::ctrl_c() => {} } } => {
                shutdown_engine.shutdown().await;
            }
        }
    }
    #[cfg(not(unix))]
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
        if runtime.version == VERSION && runtime.revision == RUNTIME_REVISION {
            return Ok(runtime);
        }
        anyhow::ensure!(
            runtime.revision <= RUNTIME_REVISION,
            "A newer Agent Council engine is running. Open the newer app to reconnect."
        );
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
    command
        .arg("--serve")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    crate::process::hidden(&mut command);
    command.spawn()?;
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(200)).await;
        if let Some(runtime) = running().await {
            if runtime.version == VERSION && runtime.revision == RUNTIME_REVISION {
                return Ok(runtime);
            }
        }
    }
    anyhow::bail!(
        "The Rust runtime did not start. See the runtime log in the AgentCouncil data folder."
    )
}
