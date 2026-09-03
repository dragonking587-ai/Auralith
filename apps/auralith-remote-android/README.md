# Auralith Remote (Android V1)

Companion app for public viewer voting and approved Host Remote control.

- ApplicationId: `app.auralith.remote`
- minSdk 26 / targetSdk 35
- Not published to Play Store

## Modes
- Viewer: scan viewer QR / enter room code / paste `https://obsidian-production-6e2e.up.railway.app/ROOM`
- Host: scan private Host QR from desktop, wait for Approve, then poll/reaction controls by role

## Overlay
Enable Floating Remote requests `SYSTEM_ALERT_WINDOW`. Viewer still works in-app if denied.

## Build
Open this folder in Android Studio and assemble Debug/Release APK. This repo does not auto-publish Play Store builds.
