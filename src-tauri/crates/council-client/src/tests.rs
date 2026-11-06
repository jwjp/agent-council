use super::*;
use axum::{
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Router,
};

fn event(id: i64, text: &str) -> String {
    json!({"id":id,"job":"fixture","folder":"/project","agent":"claude","kind":"note","text":text,"stage":"work","time":"","data":null}).to_string()
}
#[test]
fn links_allow_only_complete_https_challenges() {
    let token = "a".repeat(64);
    let (url, code) =
        pairing_link(&format!("https://pc.example:8443/companion/#pair={token}")).unwrap();
    assert_eq!(url.as_str(), "https://pc.example:8443/");
    assert_eq!(code, token);
    for bad in [
        format!("http://pc.example/companion/#pair={token}"),
        format!("https://user:secret@pc.example/companion/#pair={token}"),
        format!("https://pc.example/v1/#pair={token}"),
        format!("https://pc.example/companion/?other=1#pair={token}"),
        "https://pc.example/companion/#pair=short".into(),
    ] {
        assert!(pairing_link(&bad).is_err());
    }
}
#[test]
fn routes_never_expose_administration_or_arbitrary_urls() {
    for bad in [
        "/settings",
        "/../state",
        "//example.com",
        "/state?admin=true",
        "/events?after=1",
        "https://example.com",
        "/jobs/../../settings/cancel",
    ] {
        assert!(!allowed("POST", bad));
        assert!(!allowed("GET", bad));
    }
    assert!(allowed("POST", "/jobs/fixture-123/cancel"));
    assert!(!allowed("DELETE", "/jobs"));
}
#[test]
fn fragmented_unicode_mixed_newlines_replay_and_frame_bounds() {
    let wire = format!(
        ": heartbeat\r\n\r\ndata: {}\r\n\r\ndata: {}\n\n",
        event(7, "한글 🐋"),
        event(8, "next")
    );
    let mut decoder = Decoder::default();
    let mut out = Vec::new();
    for byte in wire.as_bytes() {
        out.extend(decoder.push(&[*byte]).unwrap());
    }
    assert_eq!(out.iter().map(|e| e.id).collect::<Vec<_>>(), [7, 8]);
    assert_eq!(out[0].text, "한글 🐋");
    assert!(Decoder::default()
        .push(&vec![b'x'; 1024 * 1024 + 1])
        .is_err());
}
#[test]
fn saved_connection_validation_is_atomic() {
    let mut c = Client::new().unwrap();
    let valid =
        json!({"origin":"https://pc.example","device":"d".repeat(64),"expires":9999999999_i64})
            .to_string();
    c.restore(&valid).unwrap();
    assert!(c.storage_record().is_some());
    for invalid in [
        json!({"origin":"http://pc.example","device":"d".repeat(64),"expires":1}).to_string(),
        json!({"origin":"https://pc.example","device":"short","expires":1}).to_string(),
    ] {
        assert!(c.restore(&invalid).is_err());
        assert_eq!(
            serde_json::from_str::<Value>(&c.storage_record().unwrap()).unwrap(),
            serde_json::from_str::<Value>(&valid).unwrap()
        );
    }
    c.forget();
    assert!(c.storage_record().is_none());
}
#[tokio::test]
async fn native_cookie_approval_revocation_redirect_and_sse_contract() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let app = Router::new()
        .route(
            "/companion/v1/pair/complete",
            post(|headers: HeaderMap| async move {
                assert!(headers["cookie"].to_str().unwrap().contains("CouncilPair="));
                let cookie = format!(
                    "CouncilDevice={}; Path=/companion; Secure; HttpOnly; SameSite=Strict",
                    "d".repeat(64)
                );
                (
                    [("set-cookie", cookie)],
                    axum::Json(
                        json!({"protocol":"companion-v1","expires":9999999999_i64,"id":"fixture"}),
                    ),
                )
            }),
        )
        .route(
            "/companion/v1/state",
            get(|| async {
                (
                    StatusCode::FOUND,
                    [("location", "https://unrelated.example")],
                )
            }),
        )
        .route(
            "/companion/v1/session",
            get(|| async {
                (
                    StatusCode::UNAUTHORIZED,
                    axum::Json(json!({"error":"Device revoked"})),
                )
            }),
        )
        .route(
            "/companion/v1/events",
            get(|| async {
                (
                    [("content-type", "text/event-stream")],
                    format!("data: {}\n\n", event(9, "fixture")),
                )
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    // Test-only loopback HTTP transport. Production has no insecure constructor/flag.
    let mut c = Client {
        http: reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap(),
        origin: Some(Url::parse(&format!("http://{address}/")).unwrap()),
        pending: Some("p".repeat(64)),
        device: None,
        expires: 0,
    };
    assert_eq!(
        c.request("POST", "/pair/complete", Some(json!({})))
            .await
            .unwrap()["id"],
        "fixture"
    );
    assert!(c.storage_record().is_some());
    let response = c.events(0).await.unwrap();
    assert_eq!(
        Decoder::default()
            .push(&response.bytes().await.unwrap())
            .unwrap()[0]
            .id,
        9
    );
    assert_eq!(
        c.request("GET", "/state", None).await.unwrap_err().status,
        502
    );
    assert_eq!(
        c.request("POST", "/settings", None)
            .await
            .unwrap_err()
            .status,
        400
    );
    assert_eq!(
        c.request("GET", "/session", None).await.unwrap_err().status,
        401
    );
    assert!(c.storage_record().is_none());
    server.abort();
}

#[tokio::test]
async fn unsafe_cookies_and_incomplete_approval_never_become_saved_credentials() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let app = Router::new()
        .route(
            "/companion/v1/session",
            get(|| async {
                (
                    [(
                        "set-cookie",
                        format!(
                            "CouncilDevice={}; Secure; HttpOnly; SameSite=Strict",
                            "b".repeat(64)
                        ),
                    )],
                    axum::Json(json!({"id":"unsafe"})),
                )
            }),
        )
        .route(
            "/companion/v1/pair/complete",
            post(|| async {
                (
                    [(
                        "set-cookie",
                        format!(
                            "CouncilDevice={}; Path=/companion; Secure; HttpOnly; SameSite=Strict",
                            "b".repeat(64)
                        ),
                    )],
                    axum::Json(json!({"protocol":"companion-v1"})),
                )
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let mut client = Client {
        http: reqwest::Client::builder().build().unwrap(),
        origin: Some(Url::parse(&format!("http://{address}/")).unwrap()),
        pending: Some("a".repeat(64)),
        device: None,
        expires: 0,
    };
    assert_eq!(
        client
            .request("GET", "/session", None)
            .await
            .unwrap_err()
            .status,
        502
    );
    assert!(client.storage_record().is_none());
    assert!(client.device.is_none());
    assert_eq!(
        client
            .request("POST", "/pair/complete", Some(json!({})))
            .await
            .unwrap_err()
            .status,
        502
    );
    assert!(client.storage_record().is_none());
    assert!(client.device.is_none());
    server.abort();
}
