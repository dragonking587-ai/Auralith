package app.auralith.remote

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class MainActivity : Activity() {
  private val http = OkHttpClient.Builder()
    .callTimeout(15, TimeUnit.SECONDS)
    .connectTimeout(12, TimeUnit.SECONDS)
    .build()
  private var room = ""
  private var instanceName = ""
  private var viewerId = "v-" + System.currentTimeMillis().toString(36)
  private var hostToken: String? = null
  private var hostRole: String? = null
  private var remoteWs: WebSocket? = null
  private var relayOnline = "UNKNOWN"
  private var lastViewer = "—"
  private var lastHost = "—"
  private var roundId = ""
  private var stateVersion = 0
  private var votedRound: String? = null
  private var skipOverlay = false
  private lateinit var overlayStatus: TextView
  private lateinit var status: TextView
  private lateinit var diag: TextView

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(28, 28, 28, 28)
      setBackgroundColor(0xFF070909.toInt())
    }
    fun label(t: String) = TextView(this).apply { text = t; setTextColor(0xFFD4AF37.toInt()); textSize = 15f; setPadding(0, 10, 0, 6) }
    fun body(t: String) = TextView(this).apply { text = t; setTextColor(0xFFF4F1EA.toInt()); textSize = 14f }
    fun field(hint: String) = EditText(this).apply {
      this.hint = hint
      setTextColor(0xFFF4F1EA.toInt())
      setHintTextColor(0x88D4AF37.toInt())
      setBackgroundColor(0xFF161821.toInt())
    }
    fun btn(t: String, fn: () -> Unit) = Button(this).apply {
      text = t
      setBackgroundColor(0xFF16120C.toInt())
      setTextColor(0xFFD4AF37.toInt())
      setOnClickListener { fn() }
    }
    status = label("AURALITH REMOTE 1.0.0-remote.3")
    diag = body("Public Relay:\n${RelayConfig.ORIGIN}\nRelay Status: $relayOnline")
    overlayStatus = body(overlayLine())
    val roomField = field("Room name or viewer URL (OBSIDIAN-WOLF)")
    val pairField = field("Paste Host pairing URL from desktop QR")
    intent?.data?.toString()?.let { pairField.setText(it) }

    root.addView(status)
    root.addView(label("VIEWER MODE — PUBLIC"))
    root.addView(body("Viewer QR is public. Join a room name or full Railway URL."))
    root.addView(roomField)
    root.addView(btn("Join Room") { join(roomField.text.toString()) })
    root.addView(btn("Vote RED") { vote("red") })
    root.addView(btn("Vote GREEN") { vote("green") })
    root.addView(btn("Fireworks") { react("fireworks") })
    root.addView(btn("Lightning") { react("lightning") })

    root.addView(label("HOST MODE — PRIVATE"))
    root.addView(body("Host QR is private, short-lived, one-time, and needs desktop Approve."))
    root.addView(pairField)
    root.addView(btn("Claim Host QR") { claim(pairField.text.toString()) })
    root.addView(btn("Start Poll") { remote("poll_start") })
    root.addView(btn("End Poll") { remote("poll_end") })
    root.addView(btn("Clear Votes") { remote("poll_clear") })
    root.addView(btn("Clear + Restore") { remote("poll_clear_restore") })
    root.addView(btn("Preview Fireworks") { remote("fireworks_preview") })

    root.addView(label("FLOATING HOST CONTROL SETUP"))
    root.addView(overlayStatus)
    root.addView(body(
      "Sideloaded APKs on modern Android may need Allow restricted settings before overlay works.\n\n" +
        "1. Settings → Apps → Auralith Remote\n" +
        "2. Three-dot menu → Allow restricted settings (if shown)\n" +
        "3. Settings → Special app access → Display over other apps\n" +
        "4. Enable Auralith Remote\n" +
        "5. Return here → Check Again\n\n" +
        "Pixel / stock Android example uses that path. OEM menus vary."
    ))
    root.addView(btn("OPEN APP SETTINGS") { openAppSettings() })
    root.addView(btn("OPEN OVERLAY SETTINGS") { openOverlaySettings() })
    root.addView(btn("CHECK AGAIN") { refreshOverlay(); Toast.makeText(this, overlayLine(), Toast.LENGTH_SHORT).show() })
    root.addView(btn("ENABLE FLOATING BUBBLE") { startBubble() })
    root.addView(btn("CONTINUE WITHOUT FLOATING BUBBLE") {
      skipOverlay = true
      Toast.makeText(this, "Host Remote stays usable inside this app.", Toast.LENGTH_LONG).show()
    })

    root.addView(label("HELP"))
    root.addView(body(
      "Viewer QR = PUBLIC.\nHost QR = PRIVATE.\n" +
        "Instance name is display only.\nClear Votes starts a new round. Old votes must not return."
    ))
    root.addView(label("DIAGNOSTICS"))
    root.addView(diag)
    root.addView(btn("Test Relay Connection") { testHealth() })
    setContentView(ScrollView(this).apply { addView(root); setBackgroundColor(0xFF070909.toInt()) })
    intent?.data?.toString()?.takeIf { it.contains("/host/pair/") }?.let { claim(it) }
    testHealth()
    refreshOverlay()
  }

  override fun onResume() {
    super.onResume()
    if (::overlayStatus.isInitialized) refreshOverlay()
  }

  private fun overlayLine(): String {
    val allowed = Settings.canDrawOverlays(this)
    return "OVERLAY ACCESS: ${if (allowed) "ALLOWED" else "NOT ALLOWED"}\n" +
      "Restricted settings: Android may require Allow restricted settings before overlay can be enabled."
  }

  private fun refreshOverlay() {
    overlayStatus.text = overlayLine()
  }

  private fun openAppSettings() {
    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
  }

  private fun openOverlaySettings() {
    startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
  }

  private fun startBubble() {
    if (skipOverlay) {
      status.text = "Floating bubble skipped. Use in-app host controls."
      return
    }
    if (!Settings.canDrawOverlays(this)) {
      status.text = "Display over other apps is NOT ALLOWED. Use Open Overlay Settings."
      openOverlaySettings()
      return
    }
    if (room.isEmpty()) {
      status.text = "Join a room or pair as Host first."
      return
    }
    startService(Intent(this, OverlayService::class.java).putExtra("room", room).putExtra("vid", viewerId))
    status.text = "Floating bubble started."
  }

  private fun refreshDiag() {
    diag.text = "Public Relay:\n${RelayConfig.ORIGIN}\nRelay Status: $relayOnline\n" +
      "Instance: ${instanceName.ifBlank { "—" }}\nRoom: ${room.ifBlank { "—" }}\nRole: ${hostRole ?: "viewer"}\n" +
      "roundId: ${roundId.ifBlank { "—" }}  stateVersion: $stateVersion\n" +
      "Last Viewer Join: $lastViewer\nLast Host Pair: $lastHost"
  }

  private fun applyState(j: JSONObject) {
    instanceName = j.optString("instance_name")
    val nextRound = j.optString("round_id")
    stateVersion = j.optInt("state_version", stateVersion)
    if (nextRound.isNotEmpty() && nextRound != roundId) {
      roundId = nextRound
      votedRound = null
    }
  }

  private fun join(raw: String) {
    thread {
      try {
        if (UrlParse.isBlockedHost(raw)) {
          lastViewer = "blocked local URL"
          runOnUiThread { status.text = "That address is not a public Railway room."; refreshDiag() }
          return@thread
        }
        val code = UrlParse.normalizeRoom(raw)
        if (code == null) {
          lastViewer = "invalid room"
          runOnUiThread { status.text = "Enter a custom room name or full Railway viewer URL."; refreshDiag() }
          return@thread
        }
        val req = Request.Builder().url(RelayConfig.roomStateUrl(code)).build()
        http.newCall(req).execute().use { res ->
          if (!res.isSuccessful) {
            lastViewer = "HTTP ${res.code}"
            runOnUiThread { status.text = "Join failed: HTTP ${res.code}"; refreshDiag() }
            return@thread
          }
          val j = JSONObject(res.body?.string() ?: "{}")
          room = code
          applyState(j)
          lastViewer = "SUCCESS $code"
          runOnUiThread { status.text = "CONNECTED $code · ${instanceName.ifBlank { "room" }}"; refreshDiag() }
        }
      } catch (e: Exception) {
        lastViewer = e.javaClass.simpleName
        runOnUiThread { status.text = "Join failed: ${e.message}"; refreshDiag() }
      }
    }
  }

  private fun vote(option: String) {
    if (room.isEmpty()) { status.text = "Join a room first"; return }
    if (votedRound != null && votedRound == roundId) {
      status.text = "Already voted this round. Clear Votes starts a new round."
      return
    }
    thread {
      val body = JSONObject().put("option", option).put("viewerSessionId", viewerId).put("roundId", roundId).toString()
      val out = post(RelayConfig.voteUrl(room), body)
      val j = JSONObject(if (out.isBlank()) "{}" else out)
      if (j.optBoolean("ok", true) && !j.has("error")) votedRound = roundId
      runOnUiThread { status.text = "Voted $option · $out"; refreshDiag() }
    }
  }

  private fun react(id: String) {
    if (room.isEmpty()) { status.text = "Join a room first"; return }
    thread {
      val body = JSONObject().put("reactionId", id).put("viewerSessionId", viewerId).put("type", "reaction").toString()
      val out = post(RelayConfig.reactUrl(room), body)
      runOnUiThread { status.text = "Reaction $id · $out" }
    }
  }

  private fun claim(url: String) {
    thread {
      try {
        val parsed = UrlParse.parsePairing(url)
        if (parsed == null) {
          lastHost = "bad pairing URL"
          runOnUiThread { status.text = "Need a Host pairing URL with /host/pair/ID?code=..."; refreshDiag() }
          return@thread
        }
        if (parsed.blocked || !parsed.originOk) {
          lastHost = "tauri.localhost rejected"
          runOnUiThread {
            status.text = "This Host QR was generated with an invalid local desktop address. Generate a new Host QR from the updated Auralith Desktop."
            refreshDiag()
          }
          return@thread
        }
        runOnUiThread { status.text = "CLAIMING…" }
        val body = JSONObject().put("code", parsed.code).put("deviceName", android.os.Build.MODEL).put("platform", "android").toString()
        val claimed = post(RelayConfig.claimUrl(parsed.id), body)
        val cj = JSONObject(if (claimed.isBlank()) "{}" else claimed)
        if (cj.has("error")) {
          lastHost = cj.optString("error")
          runOnUiThread { status.text = "Claim failed: $lastHost"; refreshDiag() }
          return@thread
        }
        lastHost = "WAITING APPROVAL"
        runOnUiThread { status.text = "Waiting for desktop approval…"; refreshDiag() }
        repeat(45) {
          Thread.sleep(2000)
          val st = get(RelayConfig.statusUrl(parsed.id))
          val j = JSONObject(if (st.isBlank()) "{}" else st)
          when (j.optString("status")) {
            "denied" -> {
              lastHost = "DENIED"
              runOnUiThread { status.text = "Desktop denied pairing."; refreshDiag() }
              return@thread
            }
            "expired" -> {
              lastHost = "EXPIRED"
              runOnUiThread { status.text = "Pairing expired. Generate a new Host QR."; refreshDiag() }
              return@thread
            }
            "approved" -> {
              if (j.optString("token").isNotEmpty()) {
                hostToken = j.getString("token")
                hostRole = j.optString("role")
                room = j.optString("roomId")
                lastHost = "SUCCESS"
                runOnUiThread { status.text = "HOST REMOTE CONNECTED · $hostRole · $room"; refreshDiag() }
                openRemoteSocket(room, hostToken!!)
                join(room)
                return@thread
              }
            }
          }
        }
        lastHost = "timeout"
        runOnUiThread { status.text = "Timed out waiting for desktop Approve."; refreshDiag() }
      } catch (e: Exception) {
        lastHost = e.javaClass.simpleName
        runOnUiThread { status.text = "Pair failed: ${e.message}"; refreshDiag() }
      }
    }
  }

  private fun openRemoteSocket(roomId: String, token: String) {
    try {
      remoteWs?.cancel()
      remoteWs = http.newWebSocket(
        Request.Builder().url(RelayConfig.remoteWs(roomId, token)).build(),
        object : WebSocketListener() {}
      )
    } catch (_: Exception) { }
  }

  private fun remote(cmd: String) {
    val tok = hostToken
    if (tok == null || room.isEmpty()) { status.text = "Host remote is not connected."; return }
    thread {
      val body = JSONObject().put("cmd", cmd).toString()
      val req = Request.Builder().url(RelayConfig.remoteCmdUrl(room))
        .addHeader("authorization", "Bearer $tok")
        .post(body.toRequestBody("application/json".toMediaType())).build()
      val out = http.newCall(req).execute().use { it.body?.string().orEmpty() }
      if (cmd.contains("clear")) votedRound = null
      runOnUiThread { status.text = "Sent $cmd · $out" }
    }
  }

  private fun testHealth() {
    thread {
      try {
        val req = Request.Builder().url(RelayConfig.healthUrl()).build()
        http.newCall(req).execute().use { res ->
          relayOnline = if (res.isSuccessful) "ONLINE" else "HTTP ${res.code}"
        }
      } catch (e: Exception) {
        relayOnline = "OFFLINE ${e.javaClass.simpleName}"
      }
      runOnUiThread { refreshDiag(); status.text = "Relay $relayOnline" }
    }
  }

  private fun post(url: String, body: String): String {
    val req = Request.Builder().url(url).post(body.toRequestBody("application/json".toMediaType())).build()
    return http.newCall(req).execute().use { it.body?.string() ?: "{}" }
  }
  private fun get(url: String): String {
    val req = Request.Builder().url(url).build()
    return http.newCall(req).execute().use { it.body?.string() ?: "{}" }
  }
}
