# Auralith Remote — Android Companion 1.0.0-rc.45

Companion app for public viewer voting and approved Host Remote control. This build is aligned with Auralith Reborn / Host Console `1.0.0-rc.45`.

- ApplicationId: `app.auralith.remote`
- minSdk 26 / targetSdk 35
- Sideloaded APK; not published to Google Play
- Uses the production Auralith Railway relay

## Modes
- Viewer: scan viewer QR / enter room code / paste `https://obsidian-production-6e2e.up.railway.app/ROOM`
- Host: scan the private Host QR from desktop, wait for Approve, then use poll/reaction controls allowed by the assigned role

## Floating Host Control / Display Over Other Apps
The floating remote uses Android's `SYSTEM_ALERT_WINDOW` permission. Viewer and Host controls still work inside the app if floating control is not enabled.

### Android 13+ — Allow restricted settings
For a sideloaded APK, Android may block **Display over other apps** until you explicitly trust the app. Only do this for an APK downloaded from the official Auralith GitHub release.

1. Open **Android Settings**.
2. Tap **Apps**.
3. Tap **Auralith Remote**. If needed, tap **See all apps** first.
4. On the Auralith Remote App info screen, tap the **three-dot menu (⋮) in the top-right corner**.
5. Tap **Allow restricted settings** and confirm with your PIN, pattern, fingerprint, or other device authentication if Android asks.
6. Go back to **Settings → Apps → Special app access → Display over other apps**.
7. Select **Auralith Remote** and enable **Allow display over other apps**.
8. Return to Auralith Remote and tap **CHECK AGAIN**, then **ENABLE FLOATING BUBBLE**.

Pixel / stock Android follows this path. Samsung, OnePlus, Motorola, Xiaomi, and other manufacturers may rename or move the Special app access menu.

## Installing the APK
1. Download `Auralith-Remote-1.0.0-rc.45.apk` from the official Auralith `v1.0.0-rc.45` GitHub release.
2. Open the APK and allow installation from the browser or file manager if Android asks.
3. Launch **Auralith Remote**.
4. Follow the restricted-settings steps above if Android blocks the floating control permission.

This CI build is debug-signed for sideload testing. If Android refuses to install it over an older Auralith Remote APK because the signing certificate differs, uninstall the older companion APK first, then install the RC.45 APK. This does not affect the desktop Auralith installation.

## Build
Open this folder in Android Studio or run the repository Android workflow. The workflow builds an installable APK, publishes it as a workflow artifact, and attaches the versioned APK plus these installation instructions to the matching Auralith GitHub release when that release already exists.
