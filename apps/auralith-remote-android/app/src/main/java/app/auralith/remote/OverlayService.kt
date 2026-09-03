package app.auralith.remote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import kotlin.concurrent.thread

class OverlayService : Service() {
  private var wm: WindowManager? = null
  private var view: LinearLayout? = null
  private val http = OkHttpClient()
  override fun onBind(intent: Intent?): IBinder? = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val room = intent?.getStringExtra("room") ?: return START_NOT_STICKY
    val vid = intent.getStringExtra("vid") ?: "v"
    startFg(room)
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT
    )
    params.gravity = Gravity.TOP or Gravity.START
    params.x = 40; params.y = 180
    val box = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      setBackgroundColor(0xCC120C08.toInt())
      setPadding(16, 16, 16, 16)
    }
    fun add(label: String, fn: () -> Unit) {
      box.addView(Button(this).apply { text = label; setOnClickListener { fn() } })
    }
    add("RED") { vote(room, vid, "red") }
    add("GREEN") { vote(room, vid, "green") }
    add("🎆") { react(room, vid, "fireworks") }
    box.setOnTouchListener { v, e ->
      if (e.action == MotionEvent.ACTION_MOVE) {
        params.x = e.rawX.toInt() - v.width / 2
        params.y = e.rawY.toInt() - v.height / 2
        wm?.updateViewLayout(v, params)
      }
      false
    }
    wm = getSystemService(WINDOW_SERVICE) as WindowManager
    wm?.addView(box, params)
    view = box
    return START_STICKY
  }
  private fun startFg(room: String) {
    val id = "auralith_remote"
    val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel(id, "Auralith Remote", NotificationManager.IMPORTANCE_LOW))
    val n = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, id) else Notification.Builder(this)
    startForeground(7, n.setContentTitle("Auralith Remote active").setContentText("Connected to $room").setSmallIcon(android.R.drawable.ic_media_play).build())
  }
  private fun vote(room: String, vid: String, opt: String) {
    thread {
      val body = JSONObject().put("option", opt).put("viewerSessionId", vid).toString()
      http.newCall(Request.Builder().url("${RelayConfig.voteUrl(room)}").post(body.toRequestBody("application/json".toMediaType())).build()).execute().close()
    }
  }
  private fun react(room: String, vid: String, id: String) {
    thread {
      val body = JSONObject().put("reactionId", id).put("viewerSessionId", vid).put("type", "reaction").toString()
      http.newCall(Request.Builder().url("${RelayConfig.reactUrl(room)}").post(body.toRequestBody("application/json".toMediaType())).build()).execute().close()
    }
  }
  override fun onDestroy() {
    view?.let { wm?.removeView(it) }
    super.onDestroy()
  }
}
