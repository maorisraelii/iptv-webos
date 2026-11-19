plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.iptv.livetv.androidtv"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.iptv.livetv.androidtv"
        minSdk = 24
        targetSdk = 34
        versionCode = 510
        versionName = "5.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
}

val webRootDir = rootProject.projectDir.parentFile
val webAssetsDir = layout.projectDirectory.dir("src/main/assets/www").asFile

tasks.register<Copy>("syncWebAssets") {
    from(
        File(webRootDir, "index.html"),
        File(webRootDir, "manager.html"),
        File(webRootDir, "app-config.json"),
        File(webRootDir, "appinfo.json"),
        File(webRootDir, "ota-manifest.json"),
        File(webRootDir, "epg-il.xml"),
        File(webRootDir, "icon.png"),
        File(webRootDir, "largeIcon.png")
    )
    from(File(webRootDir, "css")) {
        into("css")
    }
    from(File(webRootDir, "js")) {
        into("js")
    }
    into(webAssetsDir)
    doFirst {
        if (webAssetsDir.exists()) {
            webAssetsDir.deleteRecursively()
        }
    }
}

tasks.named("preBuild") {
    dependsOn("syncWebAssets")
}
