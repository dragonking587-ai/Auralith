use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::{header, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

const APP_VERSION: &str = "1.0.0-desktop-test.1";

#[derive(Clone)]
struct Session {
    scene: Option<Value>,
    scene_rev: u64,
    image: Option<String>,
    image_rev: u64,
    bands: Option<Value>,
    tx: broadcast::Sender<String>,
}

impl Default for Session {
    fn default() -> Self {
        let (tx, _) = broadcast::channel(64);
        Self {
            scene: None,
            scene_rev: 0,
            image: None,
            image_rev: 0,
            bands: None,
            tx,
        }
    }
}

#[derive(Clone)]
struct AppState {
    sessions: Arc<Mutex<HashMap<String, Session>>>,
}

#[derive(Deserialize)]
struct SessionQ {
    session: Option<String>,
}

pub fn start(static_dir: Option<PathBuf>) -> Result<u16, String> {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        rt.block_on(async move {
            match bind_and_serve(static_dir).await {
                Ok(port) => {
                    let _ = tx.send(Ok(port));
                    std::future::pending::<()>().await;
                }
                Err(e) => {
                    let _ = tx.send(Err(e));
                }
            }
        });
    });
    rx.recv().map_err(|e| e.to_string())?
}

async fn bind_and_serve(static_dir: Option<PathBuf>) -> Result<u16, String> {
    let state = AppState {
        sessions: Arc::new(Mutex::new(HashMap::new())),
    };
    let mut app = Router::new()
        .route("/api/auralith/live", get(get_live).post(post_live))
        .route("/api/auralith/image", get(get_image).post(post_image))
        .route("/api/auralith/meta", get(get_meta))
        .route("/ws/auralith", get(ws_upgrade))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
                .allow_headers(Any),
        )
        .with_state(state);

    if let Some(dir) = static_dir {
        let index = dir.join("index.html");
        app = app.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index)));
    } else {
        app = app.fallback(get(missing_static));
    }

    for port in 4317u16..=4327 {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        match TcpListener::bind(addr).await {
            Ok(listener) => {
                tokio::spawn(async move {
                    let _ = axum::serve(listener, app).await;
                });
                return Ok(port);
            }
            Err(_) => continue,
        }
    }
    Err("Could not bind 127.0.0.1:4317-4327".into())
}

async fn missing_static() -> impl IntoResponse {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        "Auralith UI assets are not bundled. Run npm run desktop:build.",
    )
}

async fn get_meta() -> impl IntoResponse {
    axum::Json(json!({
        "app": "auralith-desktop",
        "version": APP_VERSION,
        "bind": "127.0.0.1",
    }))
}

fn session_id(q: &SessionQ, body_session: Option<&str>) -> String {
    body_session
        .filter(|s| !s.is_empty())
        .or(q.session.as_deref())
        .unwrap_or("")
        .to_string()
}

fn emit(s: &Session, msg: Value) {
    let _ = s.tx.send(msg.to_string());
}

async fn get_live(Query(q): Query<SessionQ>, State(st): State<AppState>) -> impl IntoResponse {
    let id = q.session.unwrap_or_default();
    let map = st.sessions.lock().unwrap();
    let s = map.get(&id).cloned().unwrap_or_default();
    axum::Json(json!({
        "scene": s.scene,
        "sceneRev": s.scene_rev,
        "imageRev": s.image_rev,
        "bands": s.bands,
    }))
}

#[derive(Deserialize)]
struct LivePost {
    session: Option<String>,
    scene: Option<Value>,
    rev: Option<u64>,
    bands: Option<Value>,
}

async fn post_live(
    Query(q): Query<SessionQ>,
    State(st): State<AppState>,
    axum::Json(body): axum::Json<LivePost>,
) -> impl IntoResponse {
    let id = session_id(&q, body.session.as_deref());
    if id.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(json!({ "error": "session required" })),
        );
    }
    let mut map = st.sessions.lock().unwrap();
    let s = map.entry(id).or_default();
    if let Some(scene) = body.scene {
        s.scene = Some(scene.clone());
        s.scene_rev = body.rev.unwrap_or(s.scene_rev + 1);
        emit(
            s,
            json!({ "op": "scene", "scene": scene, "rev": s.scene_rev, "imageRev": s.image_rev }),
        );
    }
    if let Some(bands) = body.bands {
        s.bands = Some(bands.clone());
        let mut msg = match bands {
            Value::Object(map) => Value::Object(map),
            other => json!({ "value": other }),
        };
        if let Some(obj) = msg.as_object_mut() {
            obj.insert("op".into(), json!("bands"));
        }
        emit(s, msg);
    }
    let scene_rev = s.scene_rev;
    let image_rev = s.image_rev;
    (
        StatusCode::OK,
        axum::Json(json!({ "ok": true, "sceneRev": scene_rev, "imageRev": image_rev })),
    )
}

async fn get_image(Query(q): Query<SessionQ>, State(st): State<AppState>) -> Response {
    let id = q.session.unwrap_or_default();
    let map = st.sessions.lock().unwrap();
    match map.get(&id).and_then(|s| s.image.clone()) {
        Some(img) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .header(header::CACHE_CONTROL, "no-store, no-cache, must-revalidate")
            .body(Body::from(img))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
        None => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

async fn post_image(
    Query(q): Query<SessionQ>,
    State(st): State<AppState>,
    body: String,
) -> impl IntoResponse {
    let id = q.session.unwrap_or_default();
    if id.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(json!({ "error": "session required" })),
        );
    }
    let mut map = st.sessions.lock().unwrap();
    let s = map.entry(id).or_default();
    s.image = Some(body);
    s.image_rev += 1;
    let image_rev = s.image_rev;
    emit(s, json!({ "op": "image", "imageRev": image_rev }));
    (StatusCode::OK, axum::Json(json!({ "ok": true, "imageRev": image_rev })))
}

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    Query(q): Query<HashMap<String, String>>,
    State(st): State<AppState>,
) -> impl IntoResponse {
    let session = q.get("session").cloned().unwrap_or_default();
    let role = q.get("role").cloned().unwrap_or_default();
    ws.on_upgrade(move |socket| ws_session(socket, session, role, st))
}

fn ws_text(v: Value) -> Message {
    Message::Text(v.to_string().into())
}

async fn ws_session(socket: WebSocket, session: String, role: String, st: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let (snapshot, mut rx) = {
        let mut map = st.sessions.lock().unwrap();
        let s = map.entry(session.clone()).or_default();
        let mut msgs: Vec<Value> = Vec::new();
        if let Some(scene) = &s.scene {
            msgs.push(json!({
                "op": "scene",
                "scene": scene,
                "rev": s.scene_rev,
                "imageRev": s.image_rev
            }));
        }
        if let Some(bands) = &s.bands {
            let mut msg = bands.clone();
            if let Some(obj) = msg.as_object_mut() {
                obj.insert("op".into(), json!("bands"));
            }
            msgs.push(msg);
        }
        if s.image_rev > 0 {
            msgs.push(json!({ "op": "image", "imageRev": s.image_rev }));
        }
        (msgs, s.tx.subscribe())
    };
    for msg in snapshot {
        if sender.send(ws_text(msg)).await.is_err() {
            return;
        }
    }

    loop {
        tokio::select! {
            incoming = receiver.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if role == "view" {
                            continue;
                        }
                        if let Ok(v) = serde_json::from_str::<Value>(&text) {
                            apply_ws_message(&st, &session, v);
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            out = rx.recv() => {
                match out {
                    Ok(msg) => {
                        if sender.send(Message::Text(msg.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

fn apply_ws_message(st: &AppState, session: &str, v: Value) {
    let op = v.get("op").and_then(|x| x.as_str()).unwrap_or("");
    let mut map = st.sessions.lock().unwrap();
    let s = map.entry(session.to_string()).or_default();
    if op == "scene" {
        if let Some(scene) = v.get("scene").cloned() {
            s.scene = Some(scene);
            s.scene_rev = v.get("rev").and_then(|r| r.as_u64()).unwrap_or(s.scene_rev + 1);
            emit(s, v);
        }
        return;
    }
    if op == "bands" {
        s.bands = Some(v.clone());
        emit(s, v);
        return;
    }
    if op == "image" {
        emit(s, v);
    }
}
