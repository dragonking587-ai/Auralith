export function landingHtml() {
  return `<!doctype html><html><body style="font-family:Georgia;background:#120c08;color:#f4e4b0;padding:24px">
<h1>Auralith Audience Relay</h1>
<p>Open a room URL from Auralith. This service is poll transport only.</p>
<p>Local/LAN mode in the desktop app remains available if this relay is offline.</p>
</body></html>`;
}

export function viewerHtml(room: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auralith Poll ${room}</title>
<style>
body{margin:0;min-height:100vh;background:#120c08;color:#f4e4b0;font-family:Georgia,serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px}
button{min-width:120px;min-height:48px;padding:14px 18px;border:0;border-radius:12px;font-size:18px;color:#fff}
#r{background:#e23a3a}#g{background:#2fbf5a}
.bubble{width:min(360px,92vw);background:rgba(18,12,8,.88);border:1px solid #d4af37;border-radius:22px;padding:16px}
body.mini{justify-content:flex-end}
body.mini .full-only{display:none}
.modes button{background:#2a2114;color:#f4e4b0;min-width:auto;font-size:13px}
</style></head><body>
<p class="full-only">AURALITH PUBLIC POLL · ${room} · web page, not a system overlay</p>
<div class="modes"><button id="full">Full Page</button><button id="mini">Mini Bubble</button></div>
<div id="card">
<h1 id="q">Connecting…</h1>
<p id="st">Waiting for host...</p>
<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center"><button id="r">RED</button><button id="g">GREEN</button></div>
<p id="msg"></p><p id="tally"></p>
</div>
<script>
const room = ${JSON.stringify(room)};
const proto = location.protocol === "https:" ? "wss:" : "ws:";
let round = "";
const vid = localStorage.getItem("vid") || (localStorage.setItem("vid","v-"+Math.random().toString(36).slice(2,10)), localStorage.getItem("vid"));
function apply(s){
  round = s.round_id || round;
  document.getElementById("q").textContent = s.question || "Which color?";
  document.getElementById("r").textContent = s.red_label || "RED";
  document.getElementById("g").textContent = s.green_label || "GREEN";
  document.getElementById("st").textContent = s.running_poll ? "Voting open" : (s.host_online === false ? "Host temporarily disconnected. Waiting for host..." : "No active poll. Waiting for host...");
  document.getElementById("tally").textContent = (s.red_label||"RED")+" "+(s.red||0)+" · "+(s.green_label||"GREEN")+" "+(s.green||0);
  document.getElementById("r").disabled = !s.running_poll;
  document.getElementById("g").disabled = !s.running_poll;
}
async function vote(option){
  const r = await fetch("/api/rooms/"+room+"/vote",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({option,viewerSessionId:vid,roundId:round})});
  const j = await r.json().catch(()=>({}));
  document.getElementById("msg").textContent = r.ok && j.ok ? "Vote received ✓" : (j.error || "Vote failed");
  if (j.red != null) apply(j);
}
document.getElementById("r").onclick=()=>vote("red");
document.getElementById("g").onclick=()=>vote("green");
function mode(m){ const mini=m==="mini"; document.body.classList.toggle("mini",mini); document.getElementById("card").classList.toggle("bubble",mini); }
document.getElementById("full").onclick=()=>mode("full");
document.getElementById("mini").onclick=()=>mode("mini");
if (new URLSearchParams(location.search).get("mode")==="bubble") mode("mini");
try {
  const ws = new WebSocket(proto+"//"+location.host+"/ws/view/"+room);
  ws.onmessage = (e)=>{ try{ apply(JSON.parse(e.data)); }catch(err){} };
  ws.onclose = ()=> setTimeout(()=>location.reload(), 2500);
} catch(e) {}
fetch("/api/rooms/"+room+"/state").then(r=>r.json()).then(apply).catch(()=>{});
</script></body></html>`;
}
