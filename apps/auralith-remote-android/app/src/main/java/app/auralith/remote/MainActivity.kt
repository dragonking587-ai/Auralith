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
  private var viewerId = "v-" + System.currentTimeMillis().toString(36)
  private var hostToken: String? = null
  private var hostRole: String? = null
  private var remoteWs: WebSocket? = null
  private var relayOnline = "UNKNOWN"
  private var lastViewer = "—"
  private var lastHost = "—"

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(28, 28, 28, 28)
      setBackgroundColor(0xFF120C08.toInt())
    }
    fun label(t: String) = TextView(this).apply { text = t; setTextColor(0xFFF4E4B0.toInt()); textSize = 16f }
    fun field(hint: String) = EditText(this).apply {
      this.hint = hint
      setTextColor(0xFFF4E4B0.toInt())
      setHintTextColor(0x88F4E4B0.toInt())
    }
    fun btn(t: String, fn: () -> Unit) = Button(this).apply { text = t; setOnClickListener { fn() } }
    val status = label("AURALITH REMOTE 1.0.0-remote.2")
    val diag = label("Public Relay:\n${RelayConfig.ORIGIN}\nRelay Status: $relayOnline")
    val roomField = field("Room code or viewer URL")
    val pairField = field("Paste Host pairing URL from desktop QR")
    intent?.data?.toString()?.let { pairField.setText(it) }
    root.addView(status)
    root.addView(label("VIEWER MODE"))
    root.addView(roomField)
    root.addView(btn("Join Room") { join(roomField.text.toString(), status, diag) })
    root.addView(btn("Vote RED") { vote("red", status) })
    root.addView(btn("Vote GREEN") { vote("green", status) })
    root.addView(btn("Fireworks") { react("fireworks", status) })
    root.addView(btn("Enable Floating Remote") {
      if (!Settings.canDrawOverlays(this)) {
        startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        Toast.makeText(this, "Grant Display over other apps", Toast.LENGTH_LONG).show()
      } else {
        if (room.isEmpty()) status.text = "Join a room first"
        else startService(Intent(this, OverlayService::class.java).putExtra("room", room).putExtra("vid", viewerId))
      }
    })
    root.addView(label("HOST MODE"))
    root.addView(pairField)
    root.addView(btn("Claim Host QR") { claim(pairField.text.toString(), status, diag) })
    root.addView(btn("Start Poll") { remote("poll_start", status) })
    root.addView(btn("End Poll") { remote("poll_end", status) })
    root.addView(btn("Clear Votes") { remote("poll_clear", status) })
    root.addView(btn("Preview Fireworks") { remote("fireworks_preview", status) })
    root.addView(label("DIAGNOSTICS"))
    root.addView(diag)
    root.addView(btn("Test Relay Connection") { testHealth(diag, status) })
    setContentView(ScrollView(this).apply { addView(root) })
    intent?.data?.toString()?.takeIf { it.contains("/host/pair/") }?.let { claim(it, status, diag) }
    testHealth(diag, status)
  }

  private fun refreshDiag(diag: TextView) {
    diag.text = "Public Relay:\n${RelayConfig.ORIGIN}\nRelay Status: $relayOnline\nLast Viewer Join: $lastViewer\nLast Host Pair: $lastHost"
  }

  private fun join(raw: String, status: TextView, diag: TextView) {
    thread {
      try {
        if (UrlParse.isBlockedHost(raw)) {
          lastViewer = "blocked local URL"
          runOnUiThread { status.text = "That address is not a public Railway room."; refreshDiag(diag) }
          return@thread
        }
        val code = UrlParse.normalizeRoom(raw)
        if (code == null) {
          lastViewer = "invalid room"
          runOnUiThread { status.text = "Enter a room code like AWHB-F25F or the full Railway viewer URL."; refreshDiag(diag) }
          return@thread
        }
        val req = Request.Builder().url(RelayConfig.roomStateUrl(code)).build()
        http.newCall(req).execute().use { res ->
          if (res.code == 404) {
            lastViewer = "room_not_found"
            runOnUiThread { status.text = "Room not found or no longer active."; refreshDiag(diag) }
            return@thread
          }
          if (!res.isSuccessful) {
            lastViewer = "HTTP ${res.code}"
            runOnUiThread { status.text = "Join failed: HTTP ${res.code}"; refreshDiag(diag) }
            return@thread
          }
          room = code
          lastViewer = "SUCCESS $code"
          runOnUiThread { status.text = "CONNECTED $code"; refreshDiag(diag) }
        }
      } catch (e: Exception) {
        lastViewer = e.javaClass.simpleName
        runOnUiThread { status.text = "Join failed: ${e.message}"; refreshDiag(diag) }
      }
    }
  }

  private fun vote(option: String, status: TextView) {
    if (room.isEmpty()) { status.text = "Join a room first"; return }
    thread {
      val body = JSONObject().put("option", option).put("viewerSessionId", viewerId).toString()
      val out = post(RelayConfig.voteUrl(room), body)
      runOnUiThread { status.text = "Voted $option · $out" }
    }
  }

  private fun react(id: String, status: TextView) {
    if (room.isEmpty()) { status.text = "Join a room first"; return }
    thread {
      val body = JSONObject().put("reactionId", id).put("viewerSessionId", viewerId).put("type", "reaction").toString()
      val out = post(RelayConfig.reactUrl(room), body)
      runOnUiThread { status.text = "Reaction $id · $out" }
    }
  }

  private fun claim(url: String, status: TextView, diag: TextView) {
    thread {
      try {
        val parsed = UrlParse.parsePairing(url)
        if (parsed == null) {
          lastHost = "bad pairing URL"
          runOnUiThread { status.text = "Need a Host pairing URL with /host/pair/ID?code=..."; refreshDiag(diag) }
          return@thread
        }
        if (parsed.blocked || !parsed.originOk) {
          lastHost = "tauri.localhost rejected"
          runOnUiThread {
            status.text = "This Host QR was generated with an invalid local desktop address. Generate a new Host QR from the updated Auralith Desktop."
            refreshDiag(diag)
          }
          return@thread
        }
        if (parsed.code.isEmpty()) {
          lastHost = "missing code"
          runOnUiThread { status.text = "Pairing URL is missing ?code="; refreshDiag(diag) }
          return@thread
        }
        runOnUiThread { status.text = "CLAIMING…" }
        val body = JSONObject().put("code", parsed.code).put("deviceName", android.os.Build.MODEL).put("platform", "android").toString()
        val claimed = post(RelayConfig.claimUrl(parsed.id), body)
        val cj = JSONObject(if (claimed.isBlank()) "{}" else claimed)
        if (cj.has("error")) {
          val err = cj.optString("error")
          lastHost = err
          val msg = when (err) {
            "expired" -> "Pairing expired. Generate a new Host QR."
            "invalid_pairing" -> "Pairing not found. Generate a new Host QR."
            else -> "Claim failed: $err"
          }
          runOnUiThread { status.text = msg; refreshDiag(diag) }
          return@thread
        }
        lastHost = "WAITING APPROVAL"
        runOnUiThread { status.text = "Waiting for desktop approval…"; refreshDiag(diag) }
        repeat(30) {
          Thread.sleep(2000)
          val st = get(RelayConfig.statusUrl(parsed.id))
          val j = JSONObject(if (st.isBlank()) "{}" else st)
          when (j.optString("status")) {
            "denied" -> {
              lastHost = "DENIED"
              runOnUiThread { status.text = "Desktop denied pairing."; refreshDiag(diag) }
              return@thread
            }
            "expired" -> {
              lastHost = "EXPIRED"
              runOnUiThread { status.text = "Pairing expired. Generate a new Host QR."; refreshDiag(diag) }
              return@thread
            }
            "approved" -> {
              if (j.optString("token").isNotEmpty()) {
                hostToken = j.getString("token")
                hostRole = j.optString("role")
                room = j.optString("roomId")
                lastHost = "SUCCESS"
                runOnUiThread { status.text = "HOST REMOTE CONNECTED · $hostRole · $room"; refreshDiag(diag) }
                openRemoteSocket(room, hostToken!!)
                return@thread
              }
            }
          }
        }
        lastHost = "timeout"
        runOnUiThread { status.text = "Timed out waiting for desktop Approve."; refreshDiag(diag) }
      } catch (e: Exception) {
        lastHost = e.javaClass.simpleName
        runOnUiThread { status.text = "Pair failed: ${e.message}"; refreshDiag(diag) }
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

  private fun remote(cmd: String, status: TextView) {
    val tok = hostToken
    if (tok == null || room.isEmpty()) { status.text = "Host remote is not connected."; return }
    thread {
      val body = JSONObject().put("cmd", cmd).toString()
      val req = Request.Builder().url(RelayConfig.remoteCmdUrl(room))
        .addHeader("authorization", "Bearer $tok")
        .post(body.toRequestBody("application/json".toMediaType())).build()
      val out = http.newCall(req).execute().use { it.body?.string().orEmpty() }
      runOnUiThread { status.text = "Sent $cmd · $out" }
    }
  }

  private fun testHealth(diag: TextView, status: TextView) {
    thread {
      try {
        val req = Request.Builder().url(RelayConfig.healthUrl()).build()
        http.newCall(req).execute().use { res ->
          relayOnline = if (res.isSuccessful) "ONLINE" else "HTTP ${res.code}"
        }
      } catch (e: Exception) {
        relayOnline = "OFFLINE ${e.javaClass.simpleName}"
      }
      runOnUiThread { refreshDiag(diag); status.text = "Relay $relayOnline" }
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
