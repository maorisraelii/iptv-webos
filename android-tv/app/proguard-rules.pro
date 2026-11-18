# Keep WebView JavascriptInterface bridge methods if minify is ever enabled
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
