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
        versionCode = 561
        versionName = "5.6.1"
    }

    signingConfigs {
        create("release") {
            storeFile = file("keystore/iptv.keystore")
            storePassword = "iptvlivekeystore"
            keyAlias = "iptv"
            keyPassword = "iptvlivekeystore"
            enableV1Signing = true
            enableV2Signing = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isDebuggable = false
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            signingConfig = signingConfigs.getByName("release")
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
    // 100% pure Android SDK Activity / WebView (zero androidx overhead)
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
