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
    versionCode = 4
    versionName = "1.0.0-remote.4"
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = "17" }
  buildTypes { release { isMinifyEnabled = false } }
}
kotlin {
  jvmToolchain(17)
}
dependencies {
  implementation("androidx.core:core-ktx:1.15.0")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
