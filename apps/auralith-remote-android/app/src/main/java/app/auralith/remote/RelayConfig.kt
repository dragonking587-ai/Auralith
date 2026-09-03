package app.auralith.remote

object RelayConfig {
  const val ORIGIN = "https://obsidian-production-6e2e.up.railway.app"
  fun wssOrigin(): String = ORIGIN.replace("https://", "wss://").replace("http://", "ws://")
  fun healthUrl() = "$ORIGIN/health"
  fun roomStateUrl(room: String) = "$ORIGIN/api/rooms/$room/state"
  fun voteUrl(room: String) = "$ORIGIN/api/rooms/$room/vote"
  fun reactUrl(room: String) = "$ORIGIN/api/rooms/$room/react"
  fun claimUrl(id: String) = "$ORIGIN/api/pair/$id/claim"
  fun statusUrl(id: String) = "$ORIGIN/api/pair/$id/status"
  fun remoteCmdUrl(room: String) = "$ORIGIN/api/rooms/$room/remote"
  fun viewWs(room: String) = "${wssOrigin()}/ws/view/$room"
  fun remoteWs(room: String, token: String) = "${wssOrigin()}/ws/remote/$room?token=${java.net.URLEncoder.encode(token, "UTF-8")}"
}

object UrlParse {
  private val ROOM = Regex("([A-Z0-9]{4}-[A-Z0-9]{4})", RegexOption.IGNORE_CASE)
  fun normalizeRoom(raw: String): String? {
    val t = raw.trim()
    if (t.isEmpty()) return null
    if (isBlockedHost(t)) return null
    return ROOM.find(t)?.groupValues?.get(1)?.uppercase()
  }
  fun isBlockedHost(raw: String): Boolean =
    raw.contains("tauri.localhost", true) ||
      raw.contains("://localhost") ||
      raw.contains("127.0.0.1") ||
      raw.contains("10.0.2.2")

  data class Pairing(val id: String, val code: String, val originOk: Boolean, val blocked: Boolean)

  fun parsePairing(raw: String): Pairing? {
    val t = raw.trim()
    if (t.isEmpty()) return null
    val blocked = isBlockedHost(t)
    return try {
      val u = android.net.Uri.parse(t)
      val segs = u.pathSegments
      val idx = segs.indexOf("pair")
      val id = if (idx >= 0 && idx + 1 < segs.size) segs[idx + 1] else segs.lastOrNull().orEmpty()
      val code = u.getQueryParameter("code").orEmpty()
      if (id.isEmpty()) null
      else Pairing(id, code, u.host.equals("obsidian-production-6e2e.up.railway.app", true), blocked)
    } catch (_: Exception) { null }
  }
}
