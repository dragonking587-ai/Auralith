plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}
android {
  namespace = "app.auralith.remote"
  compileSdk = 35
  defaultConfig {
    applicationId = "app.auralith.remote"
    minSdk = 26
    targetSdk = 35
    versionCode = 1
    versionName = "1.0.0-remote.1"
  }
  buildFeatures { compose = true }
  composeOptions { kotlinCompilerExtensionVersion = "1.5.15" }
  buildTypes { release { isMinifyEnabled = false } }
}
dependencies {
  implementation("androidx.core:core-ktx:1.15.0")
  implementation("androidx.activity:activity-compose:1.9.3")
  implementation("androidx.compose.ui:ui:1.7.6")
  implementation("androidx.compose.material3:material3:1.3.1")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
