package app.auralith.remote

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.zxing.integration.android.IntentIntegrator
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
  private var roundId = ""
  private var stateVersion = 0
  private var votedRound: String? = null
  private var skipOverlay = false
  private lateinit var overlayStatus: TextView
  private lateinit var status: TextView
  private lateinit var roomField: EditText
  private lateinit var pairField: EditText
  private var scanMode = "auto"

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(28, 28, 28, 28)
      setBackgroundColor(0xFF070909.toInt())
    }

    fun label(t: String) = TextView(this).apply {
      text = t
      setTextColor(0xFFD9B84B.toInt())
      textSize = 15f
      setPadding(0, 10, 0, 6)
    }

    fun body(t: String) = TextView(this).apply {
      text = t
      setTextColor(0xFFF4F1EA.toInt())
      textSize = 14f
    }

    fun field(hint: String) = EditText(this).apply {
      this.hint = hint
      setTextColor(0xFFF4F1EA.toInt())
      setHintTextColor(0x88D9B84B.toInt())
      setBackgroundColor(0xFF161821.toInt())
    }

    fun btn(t: String, fn: () -> Unit) = Button(this).apply {
      text = t
      setBackgroundColor(0xFF16120C.toInt())
      setTextColor(0xFFD9B84B.toInt())
      setOnClickListener { fn() }
    }

    status = body("Ready · Connecting to Auralith server…")
    overlayStatus = body(overlayLine())
    roomField = field("Room name or viewer URL (OBSIDIAN-WOLF)")
    pairField = field("Paste Host pairing URL from desktop QR")
    intent?.data?.toString()?.let { pairField.setText(it) }

    root.addView(label("AURALITH REMOTE ${BuildConfig.VERSION_NAME}"))
    root.addView(body("CONTROL THE MOMENT · ${BuildConfig.VERSION_NAME.uppercase()} COMPANION"))
    root.addView(status)

    root.addView(label("VIEWER MODE — PUBLIC"))
    root.addView(body("Viewer QR is public. Join a room name or full Railway URL."))
    root.addView(roomField)
    root.addView(btn("Scan Viewer QR") { startScan("viewer") })
    root.addView(btn("Join Room") { join(roomField.text.toString()) })
    root.addView(btn("Vote RED") { vote("red") })
    root.addView(btn("Vote GREEN") { vote("green") })
    root.addView(btn("Fireworks") { react("fireworks") })
    root.addView(btn("Lightning") { react("lightning") })

    root.addView(label("HOST MODE — PRIVATE"))
    root.addView(body("Host QR is private, short-lived, one-time, and needs desktop Approve."))
    root.addView(pairField)
    root.addView(btn("Scan Host QR") { startScan("host") })
    root.addView(btn("Claim Host QR") { claim(pairField.text.toString()) })
    root.addView(btn("Start Poll") { remote("poll_start") })
    root.addView(btn("End Poll") { remote("poll_end") })
    root.addView(btn("Clear Votes") { remote("poll_clear") })
    root.addView(btn("Clear + Restore") { remote("poll_clear_restore") })
    root.addView(btn("Preview Fireworks") { remote("fireworks_preview") })

    root.addView(label("FLOATING HOST CONTROL SETUP"))
    root.addView(overlayStatus)
    root.addView(body(
      "Sideloaded APKs on Android 13+ may need Allow restricted settings before Display over other apps can be enabled.\n\n" +
        "1. Open Android Settings → Apps\n" +
        "2. Tap Auralith Remote (or See all apps → Auralith Remote)\n" +
        "3. Tap ⋮ in the TOP-RIGHT corner\n" +
        "4. Tap Allow restricted settings and confirm if prompted\n" +
        "5. Go to Settings → Apps → Special app access → Display over other apps\n" +
        "6. Tap Auralith Remote → Allow display over other apps\n" +
        "7. Return here → CHECK AGAIN → ENABLE FLOATING BUBBLE\n\n" +
        "Only enable restricted settings for an APK downloaded from the official Auralith GitHub release. Pixel / stock Android uses this path; OEM menus can vary."
    ))
    root.addView(btn("OPEN APP SETTINGS") { openAppSettings() })
    root.addView(btn("OPEN OVERLAY SETTINGS") { openOverlaySettings() })
    root.addView(btn("CHECK AGAIN") {
      refreshOverlay()
      Toast.makeText(this, overlayLine(), Toast.LENGTH_SHORT).show()
    })
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

    setContentView(ScrollView(this).apply {
      addView(root)
      setBackgroundColor(0xFF070909.toInt())
    })

    intent?.data?.toString()?.takeIf { it.contains("/host/pair/") }?.let { claim(it) }
    testHealth()
    refreshOverlay()
  }

  override fun onResume() {
    super.onResume()
    if (::overlayStatus.isInitialized) refreshOverlay()
  }

  private fun startScan(mode: String) {
    scanMode = mode
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 91)
      return
    }

    IntentIntegrator(this).apply {
      setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
      setPrompt(
        if (mode == "host") "Scan Host QR (private pairing URL)"
        else if (mode == "viewer") "Scan Viewer QR (public room URL)"
        else "Scan Auralith QR"
      )
      setBeepEnabled(false)
      setOrientationLocked(true)
      setBarcodeImageEnabled(false)
      initiateScan()
    }
  }

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    if (requestCode == 91 && grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
      startScan(scanMode)
    } else {
      Toast.makeText(this, "Camera permission is required to scan QR codes.", Toast.LENGTH_LONG).show()
    }
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    val result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
    if (result == null) {
      super.onActivityResult(requestCode, resultCode, data)
      return
    }

    val text = result.contents?.trim().orEmpty()
    if (text.isEmpty()) {
      status.text = "Scan cancelled."
      return
    }
    handleScanned(text)
  }

  private fun handleScanned(text: String) {
    status.text = "QR scanned · Connecting…"

    if (text.contains("/host/pair/") || scanMode == "host") {
      if (::pairField.isInitialized) pairField.setText(text)
      if (text.contains("tauri.localhost") || text.contains("127.0.0.1")) {
        status.text = "That Host QR is local-only. Generate a new Host QR from Auralith Desktop."
        return
      }
      claim(text)
      return
    }

    val roomName = UrlParse.normalizeRoom(text)
    if (roomName != null) {
      if (::roomField.isInitialized) roomField.setText(roomName)
      join(roomName)
      return
    }

    status.text = "That QR is not a valid Auralith Viewer or Host QR."
  }

  private fun overlayLine(): String {
    val allowed = Settings.canDrawOverlays(this)
    return "OVERLAY ACCESS: ${if (allowed) "ALLOWED" else "NOT ALLOWED"}\n" +
      "If blocked: Settings → Apps → Auralith Remote → ⋮ → Allow restricted settings, then enable Display over other apps."
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
      status.text = "Floating bubble skipped · Use the in-app Host controls."
      return
    }
    if (!Settings.canDrawOverlays(this)) {
      status.text = "Overlay access is not enabled yet."
      openOverlaySettings()
      return
    }
    if (room.isEmpty()) {
      status.text = "Join a room or pair as Host first."
      return
    }

    startService(
      Intent(this, OverlayService::class.java)
        .putExtra("room", room)
        .putExtra("vid", viewerId)
    )
    status.text = "Floating Host control enabled."
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
    status.text = "Joining room…"
    thread {
      try {
        if (UrlParse.isBlockedHost(raw)) {
          runOnUiThread { status.text = "That address is not a public Auralith room." }
          return@thread
        }

        val code = UrlParse.normalizeRoom(raw)
        if (code == null) {
          runOnUiThread { status.text = "Enter a valid room name or scan the Viewer QR." }
          return@thread
        }

        val req = Request.Builder().url(RelayConfig.roomStateUrl(code)).build()
        http.newCall(req).execute().use { res ->
          if (!res.isSuccessful) {
            runOnUiThread { status.text = "Room unavailable · Check the room name and try again." }
            return@thread
          }

          val j = JSONObject(res.body?.string() ?: "{}")
          room = code
          applyState(j)
          runOnUiThread {
            status.text = "Connected · $code · ${instanceName.ifBlank { "Auralith room" }}"
          }
        }
      } catch (_: Exception) {
        runOnUiThread { status.text = "Could not join the room · Check your connection and try again." }
      }
    }
  }

  private fun vote(option: String) {
    if (room.isEmpty()) {
      status.text = "Join a room first."
      return
    }
    if (votedRound != null && votedRound == roundId) {
      status.text = "You already voted this round."
      return
    }

    thread {
      try {
        val body = JSONObject()
          .put("option", option)
          .put("viewerSessionId", viewerId)
          .put("roundId", roundId)
          .toString()
        val out = post(RelayConfig.voteUrl(room), body)
        val j = JSONObject(if (out.isBlank()) "{}" else out)
        val ok = j.optBoolean("ok", !j.has("error")) && !j.has("error")
        if (ok) votedRound = roundId
        runOnUiThread {
          status.text = if (ok) "Vote recorded · ${option.uppercase()}" else "Vote could not be recorded · Please try again."
        }
      } catch (_: Exception) {
        runOnUiThread { status.text = "Vote could not be recorded · Please try again." }
      }
    }
  }

  private fun react(id: String) {
    if (room.isEmpty()) {
      status.text = "Join a room first."
      return
    }

    thread {
      try {
        val body = JSONObject()
          .put("reactionId", id)
          .put("viewerSessionId", viewerId)
          .put("type", "reaction")
          .toString()
        val out = post(RelayConfig.reactUrl(room), body)
        val j = JSONObject(if (out.isBlank()) "{}" else out)
        val ok = j.optBoolean("ok", !j.has("error")) && !j.has("error")
        runOnUiThread {
          status.text = if (ok) "${reactionLabel(id)} sent." else "${reactionLabel(id)} is unavailable right now."
        }
      } catch (_: Exception) {
        runOnUiThread { status.text = "${reactionLabel(id)} is unavailable right now." }
      }
    }
  }

  private fun reactionLabel(id: String): String = when (id) {
    "fireworks" -> "Fireworks"
    "lightning" -> "Lightning"
    "rune_burst" -> "Rune Burst"
    "meteor_shower" -> "Meteor Shower"
    else -> "Reaction"
  }

  private fun claim(url: String) {
    thread {
      try {
        val parsed = UrlParse.parsePairing(url)
        if (parsed == null) {
          runOnUiThread { status.text = "Scan or paste a valid Host pairing QR first." }
          return@thread
        }
        if (parsed.blocked || !parsed.originOk) {
          runOnUiThread {
            status.text = "That Host QR is local-only. Generate a new Host QR from Auralith Desktop."
          }
          return@thread
        }

        runOnUiThread { status.text = "Requesting Host access…" }
        val body = JSONObject()
          .put("code", parsed.code)
          .put("deviceName", android.os.Build.MODEL)
          .put("platform", "android")
          .toString()
        val claimed = post(RelayConfig.claimUrl(parsed.id), body)
        val cj = JSONObject(if (claimed.isBlank()) "{}" else claimed)
        if (cj.has("error")) {
          runOnUiThread { status.text = "Host pairing request was not accepted." }
          return@thread
        }

        runOnUiThread { status.text = "Waiting for desktop approval…" }
        repeat(45) {
          Thread.sleep(2000)
          val st = get(RelayConfig.statusUrl(parsed.id))
          val j = JSONObject(if (st.isBlank()) "{}" else st)
          when (j.optString("status")) {
            "denied" -> {
              runOnUiThread { status.text = "Host pairing was denied on the desktop." }
              return@thread
            }
            "expired" -> {
              runOnUiThread { status.text = "Host pairing expired · Generate a new Host QR." }
              return@thread
            }
            "approved" -> {
              if (j.optString("token").isNotEmpty()) {
                hostToken = j.getString("token")
                hostRole = j.optString("role")
                room = j.optString("roomId")
                runOnUiThread { status.text = "Host Remote connected · $room" }
                openRemoteSocket(room, hostToken!!)
                join(room)
                return@thread
              }
            }
          }
        }

        runOnUiThread { status.text = "Host approval timed out · Generate a new Host QR and try again." }
      } catch (_: Exception) {
        runOnUiThread { status.text = "Host pairing failed · Please try again." }
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
    } catch (_: Exception) {
    }
  }

  private fun remote(cmd: String) {
    val tok = hostToken
    if (tok == null || room.isEmpty()) {
      status.text = "Host Remote is not connected."
      return
    }

    thread {
      try {
        val body = JSONObject().put("cmd", cmd).toString()
        val req = Request.Builder().url(RelayConfig.remoteCmdUrl(room))
          .addHeader("authorization", "Bearer $tok")
          .post(body.toRequestBody("application/json".toMediaType()))
          .build()

        val result = http.newCall(req).execute().use { res ->
          val raw = res.body?.string().orEmpty()
          val serverError = runCatching { JSONObject(if (raw.isBlank()) "{}" else raw).optString("error") }.getOrDefault("")
          res.isSuccessful && serverError.isBlank()
        }

        if (cmd.contains("clear") && result) votedRound = null
        runOnUiThread {
          status.text = if (result) "${remoteLabel(cmd)} sent." else "${remoteLabel(cmd)} could not be sent."
        }
      } catch (_: Exception) {
        runOnUiThread { status.text = "${remoteLabel(cmd)} could not be sent." }
      }
    }
  }

  private fun remoteLabel(cmd: String): String = when (cmd) {
    "poll_start" -> "Start Poll"
    "poll_end" -> "End Poll"
    "poll_clear" -> "Clear Votes"
    "poll_clear_restore" -> "Clear + Restore"
    "fireworks_preview" -> "Preview Fireworks"
    else -> "Host command"
  }

  private fun testHealth() {
    thread {
      relayOnline = try {
        val req = Request.Builder().url(RelayConfig.healthUrl()).build()
        http.newCall(req).execute().use { res -> if (res.isSuccessful) "ONLINE" else "OFFLINE" }
      } catch (_: Exception) {
        "OFFLINE"
      }

      runOnUiThread {
        if (room.isEmpty() && hostToken == null) {
          status.text = if (relayOnline == "ONLINE") {
            "Ready · Auralith server online"
          } else {
            "Auralith server unavailable · Check your connection"
          }
        }
      }
    }
  }

  private fun post(url: String, body: String): String {
    val req = Request.Builder()
      .url(url)
      .post(body.toRequestBody("application/json".toMediaType()))
      .build()
    return http.newCall(req).execute().use { it.body?.string() ?: "{}" }
  }

  private fun get(url: String): String {
    val req = Request.Builder().url(url).build()
    return http.newCall(req).execute().use { it.body?.string() ?: "{}" }
  }
}
