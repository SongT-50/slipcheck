plugins { id("com.android.application"); id("org.jetbrains.kotlin.android"); id("com.google.gms.google-services") }

android {
  namespace = "app.slipcheck"
  compileSdk = 36
  defaultConfig { applicationId = "app.slipcheck"; minSdk = 26; targetSdk = 36; versionCode = 1; versionName = "0.1" }
  compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
  sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("web"))
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

// The screens and the math are the web app's own files (repo root), copied in at build time: one engine, two platforms.
val copyWeb by tasks.registering(Copy::class) {
  from(rootDir.parentFile) {
    include("*.html", "*.js", "*.css", "*.png", "samples/**")
    exclude("sw.js", "firebase.js", "firebase-config.js")
  }
  into(layout.buildDirectory.dir("web/www"))
}
tasks.named("preBuild") { dependsOn(copyWeb) }

dependencies {
  implementation("com.google.firebase:firebase-ai:18.2.0")
  implementation("com.google.firebase:firebase-ai-ondevice:16.0.0-beta08")
  implementation("com.google.firebase:firebase-appcheck-debug:20.1.0")
  implementation("androidx.webkit:webkit:1.13.0")
  implementation("androidx.activity:activity-ktx:1.10.1")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
}
