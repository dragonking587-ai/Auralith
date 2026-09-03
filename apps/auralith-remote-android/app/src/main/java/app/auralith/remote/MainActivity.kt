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
    val pairField = field("Host pairing URL from desktop QR")
    root.addView(pairField)
    root.addView(btn("Claim Host QR") { claim(pairField.text.toString(), status) })
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
        val uri = Uri.parse(url)
        val id = uri.pathSegments.last()
        val code = uri.getQueryParameter("code") ?: ""
        val body = JSONObject().put("code", code).put("deviceName", "Pixel").put("platform", "android").toString()
        post("$origin/api/pair/$id/claim", body)
        runOnUiThread { status.text = "Waiting for desktop approval…" }
        repeat(20) {
          Thread.sleep(2000)
          val st = get("$origin/api/pair/$id/status")
          val j = JSONObject(st)
          if (j.optString("status") == "approved" && j.has("token")) {
            hostToken = j.getString("token")
            hostRole = j.optString("role")
            room = j.optString("roomId")
            runOnUiThread { status.text = "HOST REMOTE connected · $hostRole" }
            return@thread
          }
        }
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
  private fun post(url: String, body: String) {
    val req = Request.Builder().url(url).post(body.toRequestBody("application/json".toMediaType())).build()
    http.newCall(req).execute().close()
  }
  private fun get(url: String): String {
    val req = Request.Builder().url(url).build()
    return http.newCall(req).execute().use { it.body?.string() ?: "{}" }
  }
}
