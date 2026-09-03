use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

#[derive(Clone, Serialize)]
pub struct ServerStatus {
    pub state: String,
    pub port: u16,
    pub local_url: String,
    pub lan_url: String,
    pub lan_ip: String,
    pub health: String,
    pub error: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
pub struct Hub {
    pub running_poll: bool,
    pub question: String,
    pub red_label: String,
    pub green_label: String,
    pub red: u32,
    pub green: u32,
    pub round_id: String,
}

pub struct PollServer {
    pub status: Mutex<ServerStatus>,
    pub hub: Mutex<Hub>,
}

impl Default for PollServer {
    fn default() -> Self {
        Self {
            status: Mutex::new(ServerStatus {
                state: "STOPPED".into(),
                port: 0,
                local_url: String::new(),
                lan_url: String::new(),
                lan_ip: String::new(),
                health: "STOPPED".into(),
                error: String::new(),
            }),
            hub: Mutex::new(Hub {
                question: "Which color?".into(),
                red_label: "RED".into(),
                green_label: "GREEN".into(),
                ..Default::default()
            }),
        }
    }
}

fn lan_ip() -> String {
    if let Ok(s) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if s.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = s.local_addr() {
                let ip = addr.ip();
                let t = ip.to_string();
                if !ip.is_loopback() && !t.starts_with("169.254.") {
                    return t;
                }
            }
        }
    }
    String::new()
}

fn bind_port() -> Result<(TcpListener, u16), String> {
    for port in 8765u16..8780 {
        if let Ok(l) = TcpListener::bind(("0.0.0.0", port)) {
            let _ = l.set_nonblocking(false);
            return Ok((l, port));
        }
    }
    Err("No free poll port in 8765-8779".into())
}

fn http_ok(stream: &mut TcpStream, ctype: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        ctype,
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
}

fn http_opt(stream: &mut TcpStream) {
    let head = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: GET,POST,OPTIONS\r\nConnection: close\r\n\r\n";
    let _ = stream.write_all(head.as_bytes());
}

fn poll_html() -> String {
    r#"<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auralith Poll</title>
<style>
body{margin:0;min-height:100vh;background:#120c08;color:#f4e4b0;font-family:Georgia,serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px}
button{min-width:120px;min-height:48px;padding:14px 18px;border:0;border-radius:12px;font-size:18px;color:#fff}
#r{background:#e23a3a}#g{background:#2fbf5a}p{opacity:.8}
.bubble{width:min(360px,92vw);background:rgba(18,12,8,.88);border:1px solid #d4af37;border-radius:22px;padding:16px;box-shadow:0 8px 24px #0008}
.modes{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.modes button{background:#2a2114;color:#f4e4b0;min-width:auto;font-size:13px}
body.mini{justify-content:flex-end;padding:12px}
body.mini .full-only{display:none}
</style></head>
<body>
<p class="full-only">AURALITH · TEST / LAN MODE · compact web page, not a system overlay</p>
<div class="modes"><button id="full">Full Page</button><button id="mini">Mini Bubble</button></div>
<div id="card">
<h1 id="q">Waiting for host...</h1>
<p id="st">No active poll.</p>
<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button id="r">RED</button> <button id="g">GREEN</button></div>
<p id="msg"></p>
<p id="tally"></p>
</div>
<script>
const host = location.host;
async function state(){
  try{
    const s = await (await fetch('/state')).json();
    document.getElementById('q').textContent = s.question || 'Which color?';
    document.getElementById('r').textContent = s.red_label || 'RED';
    document.getElementById('g').textContent = s.green_label || 'GREEN';
    document.getElementById('st').textContent = s.running_poll ? 'Voting open' : 'No active poll. Waiting for host...';
    document.getElementById('tally').textContent = (s.red_label||'RED')+' '+(s.red||0)+' · '+(s.green_label||'GREEN')+' '+(s.green||0);
    document.getElementById('r').disabled = !s.running_poll;
    document.getElementById('g').disabled = !s.running_poll;
  }catch(e){ document.getElementById('st').textContent = 'Waiting for host...'; }
}
async function vote(option){
  const viewerId = localStorage.getItem('vid') || (localStorage.setItem('vid','v-'+Math.random().toString(36).slice(2,10)), localStorage.getItem('vid'));
  const r = await fetch('/vote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({option,viewerId})});
  document.getElementById('msg').textContent = r.ok ? 'Vote received ✓' : 'Vote failed';
  state();
}
document.getElementById('r').onclick=()=>vote('red');
document.getElementById('g').onclick=()=>vote('green');
function applyMode(m){
  const mini = m==='bubble' || m==='mini';
  document.body.classList.toggle('mini', mini);
  document.getElementById('card').classList.toggle('bubble', mini);
  localStorage.setItem('amode', mini?'mini':'full');
}
document.getElementById('full').onclick=()=>applyMode('full');
document.getElementById('mini').onclick=()=>applyMode('mini');
applyMode(new URLSearchParams(location.search).get('mode') || localStorage.getItem('amode') || 'full');
state();
setInterval(state, 400);
try{ const es = new EventSource((location.protocol==='https:'?'https:':'http:')+'//'+location.host+'/events'); es.onmessage=()=>state(); }catch(e){}
</script></body></html>"#.into()
}

#[tauri::command]
pub fn poll_detach_host(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("poll-host") {
        let _ = w.close();
    }
    // Use the same packaged index.html as the main window.
    // host.html can 404 in some production asset layouts and render a blank white WebView.
    WebviewWindowBuilder::new(&app, "poll-host", WebviewUrl::App("index.html".into()))
        .title("AUDIENCE POLL — HOST")
        .inner_size(440.0, 760.0)
        .min_inner_size(360.0, 480.0)
        .resizable(true)
        .visible(true)
        .initialization_script("window.__AURALITH_HOST__=true;try{location.hash='#host'}catch(e){}")
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn open_host_console() -> Result<(), String> {
    let candidates = [
        r"C:\Program Files\Auralith Host Console\Auralith Host Console.exe",
        r"C:\Program Files\Auralith Host Console\AuralithHostConsole.exe",
    ];
    for p in candidates {
        if std::path::Path::new(p).exists() {
            std::process::Command::new(p).spawn().map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err("host_console_not_installed".into())
}

#[tauri::command]
pub fn open_host_console() -> Result<(), String> {
    let candidates = [
        r"C:\Program Files\Auralith Host Console\Auralith Host Console.exe",
        r"C:\Program Files\Auralith Host Console\AuralithHostConsole.exe",
    ];
    for p in candidates {
        if std::path::Path::new(p).exists() {
            std::process::Command::new(p).spawn().map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err("host_console_not_installed".into())
}

fn handle(mut stream: TcpStream, state: Arc<PollServer>, app: AppHandle) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let mut buf = [0u8; 4096];
    let n = match stream.read(&mut buf) { Ok(n) => n, Err(_) => return };
    let req = String::from_utf8_lossy(&buf[..n]);
    let first = req.lines().next().unwrap_or("");
    if first.starts_with("OPTIONS") { http_opt(&mut stream); return; }
    if first.starts_with("GET /health") {
        http_ok(&mut stream, "application/json", br#"{"status":"ok"}"#);
        return;
    }
    if first.starts_with("GET /poll") || first.starts_with("GET / ") {
        let html = poll_html();
        http_ok(&mut stream, "text/html; charset=utf-8", html.as_bytes());
        return;
    }
    if first.starts_with("GET /state") || first.starts_with("GET /events") {
        let hub = state.hub.lock().unwrap().clone();
        let body = serde_json::to_vec(&hub).unwrap_or_else(|_| b"{}".to_vec());
        if first.contains("/events") {
            let payload = format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\ndata: {}\n\n", String::from_utf8_lossy(&body));
            let _ = stream.write_all(payload.as_bytes());
        } else {
            http_ok(&mut stream, "application/json", &body);
        }
        return;
    }
    if first.starts_with("POST /vote") {
        let body = req.split("\r\n\r\n").nth(1).unwrap_or("{}");
        let v: serde_json::Value = serde_json::from_str(body.trim_end_matches('\0')).unwrap_or(serde_json::json!({}));
        let option = v.get("option").and_then(|x| x.as_str()).unwrap_or("");
        let viewer = v.get("viewerId").and_then(|x| x.as_str()).unwrap_or("anon");
        if option == "red" || option == "green" {
            let _ = app.emit("poll-vote", serde_json::json!({"option": option, "viewerId": viewer}));
            http_ok(&mut stream, "application/json", br#"{"ok":true}"#);
        } else {
            http_ok(&mut stream, "application/json", br#"{"ok":false}"#);
        }
        return;
    }
    let msg = b"not found";
    let head = format!("HTTP/1.1 404 Not Found\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", msg.len());
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(msg);
}

#[tauri::command]
pub fn poll_server_status(state: State<Arc<PollServer>>) -> ServerStatus {
    state.status.lock().unwrap().clone()
}

#[tauri::command]
pub fn poll_server_set_hub(state: State<Arc<PollServer>>, hub: Hub) {
    *state.hub.lock().unwrap() = hub;
}

#[tauri::command]
pub fn poll_server_start(app: AppHandle, state: State<Arc<PollServer>>) -> Result<ServerStatus, String> {
    {
        let st = state.status.lock().unwrap();
        if st.state == "RUNNING" && st.port > 0 {
            return Ok(st.clone());
        }
    }
    {
        let mut st = state.status.lock().unwrap();
        st.state = "STARTING".into();
        st.error.clear();
    }
    let (listener, port) = match bind_port() {
        Ok(v) => v,
        Err(e) => {
            let mut st = state.status.lock().unwrap();
            st.state = "ERROR".into();
            st.health = "ERROR".into();
            st.error = e.clone();
            return Err(e);
        }
    };
    let lan = lan_ip();
    {
        let mut st = state.status.lock().unwrap();
        st.state = "RUNNING".into();
        st.health = "OK".into();
        st.port = port;
        st.lan_ip = lan.clone();
        st.local_url = format!("http://127.0.0.1:{}/poll", port);
        st.lan_url = if lan.is_empty() { String::new() } else { format!("http://{}:{}/poll", lan, port) };
        st.error.clear();
    }
    let shared = state.inner().clone();
    thread::spawn(move || {
        for incoming in listener.incoming() {
            if let Ok(stream) = incoming {
                let s = shared.clone();
                let a = app.clone();
                thread::spawn(move || handle(stream, s, a));
            }
        }
    });
    Ok(state.status.lock().unwrap().clone())
}

#[cfg(windows)]
fn open_browser(url: &str) -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn open_browser(url: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn poll_open_local(app: AppHandle, state: State<Arc<PollServer>>) -> Result<ServerStatus, String> {
    let st = poll_server_start(app, state)?;
    if st.local_url.is_empty() {
        return Err("Viewer server has no local URL".into());
    }
    // Confirm health by connecting to ourselves.
    if let Ok(mut s) = TcpStream::connect(("127.0.0.1", st.port)) {
        let _ = s.write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
        let mut buf = [0u8; 128];
        let _ = s.read(&mut buf);
        if !String::from_utf8_lossy(&buf).contains("200") && !String::from_utf8_lossy(&buf).contains("ok") {
            return Err("Health check failed".into());
        }
    }
    open_browser(&st.local_url)?;
    Ok(st)
}
