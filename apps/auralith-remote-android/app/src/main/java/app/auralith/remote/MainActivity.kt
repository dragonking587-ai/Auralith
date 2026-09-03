package app.auralith.remote

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
import android.app.Activity
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import kotlin.concurrent.thread

class MainActivity : Activity() {
  private val http = OkHttpClient()
  private val origin = "https://obsidian-production-6e2e.up.railway.app"
  private var room = ""
  private var viewerId = "v-" + System.currentTimeMillis().toString(36)
  private var hostToken: String? = null
  private var hostRole: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(28, 28, 28, 28); setBackgroundColor(0xFF120C08.toInt()) }
    fun label(t: String) = TextView(this).apply { text = t; setTextColor(0xFFF4E4B0.toInt()); textSize = 16f }
    fun field(hint: String) = EditText(this).apply { this.hint = hint; setTextColor(0xFFF4E4B0.toInt()); setHintTextColor(0x88F4E4B0.toInt()) }
    fun btn(t: String, fn: () -> Unit) = Button(this).apply { text = t; setOnClickListener { fn() } }
    val status = label("AURALITH REMOTE")
    val roomField = field("Room code or viewer URL")
    root.addView(status)
    root.addView(label("VIEWER MODE"))
    root.addView(roomField)
    root.addView(btn("Join Room") {
      room = parseRoom(roomField.text.toString())
      status.text = "Viewer joined $room"
    })
    root.addView(btn("Vote RED") { vote("red"); status.text = "Voted RED" })
    root.addView(btn("Vote GREEN") { vote("green"); status.text = "Voted GREEN" })
    root.addView(btn("Fireworks") { react("fireworks"); status.text = "Fireworks sent" })
    root.addView(btn("Enable Floating Remote") {
      if (!Settings.canDrawOverlays(this)) {
        startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        Toast.makeText(this, "Grant Display over other apps", Toast.LENGTH_LONG).show()
      } else {
        startService(Intent(this, OverlayService::class.java).putExtra("room", room).putExtra("vid", viewerId))
      }
    })
    root.addView(label("HOST MODE"))
    val pairField = field("Paste Host pairing URL from desktop QR")
    intent?.data?.toString()?.let { pairField.setText(it) }
    root.addView(pairField)
    root.addView(btn("Claim Host QR") { claim(pairField.text.toString(), status) })
    intent?.data?.toString()?.takeIf { it.contains("/host/pair/") }?.let { claim(it, status) }
    root.addView(btn("Start Poll") { remote("poll_start") })
    root.addView(btn("End Poll") { remote("poll_end") })
    root.addView(btn("Clear Votes") { remote("poll_clear") })
    root.addView(btn("Preview Fireworks") { remote("fireworks_preview") })
    setContentView(ScrollView(this).apply { addView(root) })
  }

  private fun parseRoom(raw: String): String {
    val t = raw.trim()
    val m = Regex("([A-Z0-9]{4}-[A-Z0-9]{4})", RegexOption.IGNORE_CASE).find(t)
    return (m?.groupValues?.get(1) ?: t).uppercase()
  }

  private fun vote(option: String) {
    thread {
      val body = JSONObject().put("option", option).put("viewerSessionId", viewerId).toString()
      post("$origin/api/rooms/$room/vote", body)
    }
  }
  private fun react(id: String) {
    thread {
      val body = JSONObject().put("reactionId", id).put("viewerSessionId", viewerId).put("type", "reaction").toString()
      post("$origin/api/rooms/$room/react", body)
    }
  }
  private fun claim(url: String, status: TextView) {
    thread {
      try {
        val raw = url.trim()
        if (raw.isEmpty()) {
          runOnUiThread { status.text = "Paste the Host QR URL first (not the viewer room URL)." }
          return@thread
        }
        val uri = Uri.parse(raw)
        val segs = uri.pathSegments
        val id = if (segs.size >= 2 && segs[segs.size - 2] == "pair") segs.last() else segs.lastOrNull() ?: ""
        val code = uri.getQueryParameter("code") ?: ""
        if (id.isEmpty() || code.isEmpty()) {
          runOnUiThread { status.text = "Need a Host pairing URL with /host/pair/ID?code=..." }
          return@thread
        }
        val body = JSONObject().put("code", code).put("deviceName", android.os.Build.MODEL).put("platform", "android").toString()
        val claimed = post("$origin/api/pair/$id/claim", body)
        val cj = JSONObject(if (claimed.isBlank()) "{}" else claimed)
        if (cj.has("error")) {
          runOnUiThread { status.text = "Claim failed: " + cj.optString("error") }
          return@thread
        }
        runOnUiThread { status.text = "Waiting for desktop Approve…" }
        repeat(30) {
          Thread.sleep(2000)
          val st = get("$origin/api/pair/$id/status")
          val j = JSONObject(if (st.isBlank()) "{}" else st)
          if (j.optString("error").isNotEmpty()) {
            runOnUiThread { status.text = "Pair status: " + j.optString("error") }
            return@thread
          }
          if (j.optString("status") == "denied") {
            runOnUiThread { status.text = "Desktop denied pairing." }
            return@thread
          }
          if (j.optString("status") == "approved" && j.optString("token").isNotEmpty()) {
            hostToken = j.getString("token")
            hostRole = j.optString("role")
            room = j.optString("roomId")
            runOnUiThread { status.text = "HOST REMOTE connected · $hostRole · $room" }
            return@thread
          }
        }
        runOnUiThread { status.text = "Timed out waiting for desktop Approve." }
      } catch (e: Exception) {
        runOnUiThread { status.text = "Pair failed: ${e.message}" }
      }
    }
  }
  private fun remote(cmd: String) {
    val tok = hostToken ?: return
    thread {
      val body = JSONObject().put("cmd", cmd).toString()
      val req = Request.Builder().url("$origin/api/rooms/$room/remote")
        .addHeader("authorization", "Bearer $tok")
        .post(body.toRequestBody("application/json".toMediaType())).build()
      http.newCall(req).execute().close()
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
