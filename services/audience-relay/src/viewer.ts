export function landingHtml() {
  return `<!doctype html><html><body style="font-family:Georgia;background:#120c08;color:#f4e4b0;padding:24px;max-width:40rem">
<h1>Auralith Audience Relay</h1>
<p>This is the service homepage, not a poll.</p>
<p>Open the Viewer URL from Auralith. It looks like:</p>
<pre>https://obsidian-production-6e2e.up.railway.app/ABCD-1234</pre>
<p>Do not open the bare domain.</p>
</body></html>`;
}

export function viewerHtml(room: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auralith Poll ${room}</title>
<style>
body{margin:0;min-height:100vh;background:#120c08;color:#f4e4b0;font-family:Georgia,serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px}
button{min-width:140px;min-height:52px;padding:14px 18px;border:0;border-radius:12px;font-size:18px;color:#fff}
#r{background:#e23a3a}#g{background:#2fbf5a}
.bubble{width:min(360px,92vw);background:rgba(18,12,8,.88);border:1px solid #d4af37;border-radius:22px;padding:16px}
body.mini{justify-content:flex-end}
body.mini .full-only{display:none}
.modes button{background:#2a2114;color:#f4e4b0;min-width:auto;font-size:13px;min-height:36px}
#rx h2{font-size:14px;letter-spacing:.08em;margin:12px 0 8px}
#rx button{background:#3a2a12;width:100%;max-width:280px}
#rx button:disabled{opacity:.55}
</style></head><body>
<p class="full-only">AURALITH PUBLIC POLL · ${room} · web page, not a system overlay</p>
<div class="modes"><button id="full">Full Page</button><button id="mini">Mini Bubble</button></div>
<div id="card">
<h1 id="q">Connecting…</h1>
<p id="st">Waiting for host...</p>
<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center"><button id="r">RED</button><button id="g">GREEN</button></div>
<p id="msg"></p><p id="tally"></p>
<div id="rx"></div>
<p id="rxmsg">Fireworks ready</p>
</div>
<script>
const room = ${JSON.stringify(room)};
const proto = location.protocol === "https:" ? "wss:" : "ws:";
let round = "";
const vid = localStorage.getItem("vid") || (localStorage.setItem("vid","v-"+Math.random().toString(36).slice(2,10)), localStorage.getItem("vid"));
const coolUntil = {};
let tick = null;
function labelFor(id){ return id==="fireworks" ? "Fireworks" : id; }
function setRxMsg(t){ document.getElementById("rxmsg").textContent = t; }
function renderRx(list){
  const box=document.getElementById("rx");
  if(!list||!list.length){ box.innerHTML=""; setRxMsg(""); return; }
  box.innerHTML="<h2>AUDIENCE REACTIONS</h2>"+list.map(r=>{
    const icon = r.id==="fireworks" ? "🎆" : "✦";
    return "<button type=button data-rx=\\""+r.id+"\\">"+icon+" "+(r.label||labelFor(r.id))+"</button>";
  }).join("");
  box.querySelectorAll("button").forEach(b=>b.onclick=()=>react(b.getAttribute("data-rx")));
  refreshCool();
}
function refreshCool(){
  const now=Date.now();
  const box=document.getElementById("rx");
  let soon=0;
  box.querySelectorAll("button").forEach(b=>{
    const id=b.getAttribute("data-rx");
    const until=coolUntil[id]||0;
    if(until>now){
      const sec=Math.max(1,Math.ceil((until-now)/1000));
      b.disabled=true;
      if(id==="fireworks") setRxMsg("Fireworks ready in "+sec+"s");
      else setRxMsg(labelFor(id)+" ready in "+sec+"s");
      soon=Math.max(soon,until);
    } else {
      b.disabled=false;
    }
  });
  if(soon){
    if(!tick) tick=setInterval(refreshCool,250);
  } else {
    if(tick){ clearInterval(tick); tick=null; }
    if(box.querySelector("[data-rx=fireworks]")) setRxMsg("Fireworks ready");
  }
}
function apply(s){
  if(!s || s.type && s.type!=="state" && !s.room) return;
  round = s.round_id || round;
  document.getElementById("q").textContent = s.question || "Which color?";
  document.getElementById("r").textContent = s.red_label || "RED";
  document.getElementById("g").textContent = s.green_label || "GREEN";
  document.getElementById("st").textContent = s.running_poll ? "Voting open" : (s.host_online === false ? "Host temporarily disconnected. Waiting for host..." : "No active poll. Waiting for host...");
  document.getElementById("tally").textContent = (s.red_label||"RED")+" "+(s.red||0)+" · "+(s.green_label||"GREEN")+" "+(s.green||0);
  document.getElementById("r").disabled = !s.running_poll;
  document.getElementById("g").disabled = !s.running_poll;
  renderRx(s.allowed_reactions||[]);
}
async function react(id){
  const now=Date.now();
  if(coolUntil[id] && coolUntil[id]>now){ refreshCool(); return; }
  coolUntil[id]=now+5000;
  refreshCool();
  const payload={type:"reaction",roomId:room,viewerSessionId:vid,reactionId:id};
  const r=await fetch("/api/rooms/"+room+"/react",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
  const j=await r.json().catch(()=>({}));
  if(r.ok && j.ok){
    setRxMsg(id==="fireworks" ? "Fireworks sent ✓" : labelFor(id)+" sent ✓");
    if(j.retryMs) coolUntil[id]=Date.now()+j.retryMs;
  } else {
    if(j.retryMs) coolUntil[id]=Date.now()+j.retryMs;
    else delete coolUntil[id];
    if(j.error==="reactions_disabled" || j.error==="reaction_not_allowed") setRxMsg("Reaction unavailable");
    else if(j.error==="viewer_cooldown" || j.error==="global_cooldown") refreshCool();
    else setRxMsg("Reaction unavailable");
  }
  refreshCool();
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
