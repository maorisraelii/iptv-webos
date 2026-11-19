package com.iptv.livetv.androidtv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.MalformedURLException
import java.net.URL
import java.util.Locale

class MainActivity : Activity() {

    private data class MappedWebKey(
        val keyCode: Int,
        val key: String,
        val allowRepeat: Boolean,
        val sendKeyUp: Boolean
    )

    private inner class AndroidTvHostInterface {
        @JavascriptInterface
        fun setInputFocused(focused: Boolean) {
            isWebInputFocused = focused
        }

        @JavascriptInterface
        fun notifyAppReady() {
            if (::rootContainer.isInitialized) {
                rootContainer.post {
                    hideBootOverlayNow()
                }
            }
        }
    }

    private class ConnectionManagedInputStream(
        delegate: InputStream,
        private val connection: HttpURLConnection
    ) : FilterInputStream(delegate) {
        @Volatile
        private var closed = false

        override fun close() {
            if (closed) return
            closed = true
            try {
                super.close()
            } finally {
                try {
                    connection.disconnect()
                } catch (_: Throwable) {
                }
            }
        }
    }

    private lateinit var rootContainer: FrameLayout
    private var webView: WebView? = null
    private var bootOverlay: LinearLayout? = null
    private var bootProgressBar: ProgressBar? = null
    private var bootStatusText: TextView? = null
    private var hideBootOverlayRunnable: Runnable? = null

    @Volatile
    private var isWebInputFocused: Boolean = false

    @Volatile
    private var isPageLoaded: Boolean = false

    private var suppressNextKeyUpKeyCode: Int = -1
    private var renderCrashCount: Int = 0
    private var useSoftwareLayer: Boolean = false
    private var isTerminalCrashState: Boolean = false

    private val defaultVideoPoster: Bitmap by lazy {
        Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888).apply {
            eraseColor(Color.TRANSPARENT)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        try {
            window.setBackgroundDrawable(ColorDrawable(BACKGROUND_COLOR))
            window.addFlags(
                WindowManager.LayoutParams.FLAG_FULLSCREEN
                    or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        } catch (t: Throwable) {
            Log.w(TAG, "Window setup notice", t)
        }

        rootContainer = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(BACKGROUND_COLOR)
        }
        setContentView(rootContainer)

        // Apply fullscreen flags strictly after setContentView to avoid AppCompat/decor crashes
        applyImmersiveFullscreen()
        showBootOverlayLoading()

        initWebView()
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun initWebView() {
        try {
            isPageLoaded = false
            cancelBootOverlayFallback()
            val wv = WebView(this).apply {
                layoutParams = FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
                setBackgroundColor(BACKGROUND_COLOR)
                // Use hardware layer initially; switch to software layer after render crash
                // to avoid Android TV 11 GPU WebView black-screen crash loops.
                setLayerType(
                    if (useSoftwareLayer) View.LAYER_TYPE_SOFTWARE else View.LAYER_TYPE_NONE,
                    null
                )
                isFocusable = true
                isFocusableInTouchMode = true
                keepScreenOn = true
                isHorizontalScrollBarEnabled = false
                isVerticalScrollBarEnabled = false
                overScrollMode = View.OVER_SCROLL_NEVER

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    try {
                        setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
                    } catch (t: Throwable) {
                        Log.w(TAG, "setRendererPriorityPolicy skipped", t)
                    }
                }

                configureWebSettings(settings)

                addJavascriptInterface(AndroidTvHostInterface(), "AndroidTvHost")

                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(
                        view: WebView?,
                        request: WebResourceRequest?
                    ): Boolean {
                        val scheme = request?.url?.scheme?.lowercase(Locale.US) ?: return false
                        return scheme !in ALLOWED_SCHEMES
                    }

                    override fun shouldInterceptRequest(
                        view: WebView?,
                        request: WebResourceRequest?
                    ): WebResourceResponse? {
                        val uri = request?.url ?: return super.shouldInterceptRequest(view, request)
                        if (uri.isOpaque ||
                            !uri.scheme.equals("https", ignoreCase = true) ||
                            !uri.host.equals(APP_HOST, ignoreCase = true) ||
                            (uri.port != -1 && uri.port != 443)
                        ) {
                            return super.shouldInterceptRequest(view, request)
                        }

                        val method = request.method?.uppercase(Locale.US) ?: "GET"
                        val rawPath = uri.path ?: "/"
                        val cleanPath = rawPath.trimStart('/')
                        if (cleanPath == PROXY_PATH || cleanPath.startsWith("$PROXY_PATH/")) {
                            return handleProxyRequest(uri, method, request.requestHeaders)
                        }
                        return handleStaticAssetRequest(rawPath, method)
                    }

                    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                        super.onPageStarted(view, url, favicon)
                        cancelBootOverlayFallback()
                    }

                    override fun onPageFinished(view: WebView?, url: String?) {
                        super.onPageFinished(view, url)
                        isPageLoaded = true
                        installWebKeyBridge()
                        if (!isWebInputFocused) {
                            (view ?: webView)?.requestFocus()
                        }
                        if (!isTerminalCrashState && bootOverlay?.visibility != View.GONE) {
                            scheduleBootOverlayFallback(BOOT_FALLBACK_DELAY_MS)
                        }
                    }

                    @SuppressLint("WebViewClientOnReceivedSslError")
                    override fun onReceivedSslError(
                        view: WebView?,
                        handler: SslErrorHandler?,
                        error: SslError?
                    ) {
                        Log.w(TAG, "Proceeding past SSL error for ${error?.url}: ${error?.primaryError}")
                        handler?.proceed()
                    }

                    override fun onRenderProcessGone(
                        view: WebView?,
                        detail: RenderProcessGoneDetail?
                    ): Boolean {
                        if (view != null && view !== webView) {
                            return true
                        }
                        val didCrash = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            detail?.didCrash() ?: true
                        } else {
                            true
                        }
                        Log.e(TAG, "WebView render process gone (didCrash=$didCrash) — scheduling recovery")
                        isPageLoaded = false
                        cancelBootOverlayFallback()
                        rootContainer.post {
                            if (isFinishing || isDestroyed) return@post
                            if (view != null && view !== webView) return@post
                            renderCrashCount++
                            if (renderCrashCount <= MAX_RENDER_CRASH_RECOVERIES) {
                                useSoftwareLayer = true
                                showBootOverlayLoading()
                                recoverWebView()
                            } else {
                                destroyWebView()
                                showBootOverlayError(
                                    "שגיאת מנוע תצוגה (WebView קרס יותר מ-3 פעמים).\nנא להפעיל מחדש את האפליקציה או לעדכן את Android System WebView במכשיר."
                                )
                            }
                        }
                        return true
                    }
                }

                webChromeClient = object : WebChromeClient() {
                    override fun getDefaultVideoPoster(): Bitmap = defaultVideoPoster
                }
            }

            try {
                CookieManager.getInstance().apply {
                    setAcceptCookie(true)
                    setAcceptThirdPartyCookies(wv, true)
                }
            } catch (t: Throwable) {
                Log.w(TAG, "CookieManager notice", t)
            }

            rootContainer.removeAllViews()
            rootContainer.addView(wv)
            webView = wv
            showBootOverlayLoading()
            wv.requestFocus()
            wv.loadUrl(ENTRY_URL)
        } catch (t: Throwable) {
            Log.e(TAG, "WebView initialization failed", t)
            destroyWebView()
            showBootOverlayError(
                "שגיאה באתחול מנוע התצוגה (Android System WebView אינו זמין או מתעדכן כעת בטלוויזיה)."
            )
        }
    }

    private fun recoverWebView() {
        destroyWebView()
        initWebView()
    }

    private fun dp(value: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).toInt()
    }

    private fun ensureBootOverlay(): LinearLayout {
        bootOverlay?.let { existing ->
            if (existing.parent !== rootContainer) {
                (existing.parent as? ViewGroup)?.removeView(existing)
                rootContainer.addView(
                    existing,
                    FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                )
            } else {
                existing.bringToFront()
            }
            return existing
        }

        val progress = ProgressBar(this, null, android.R.attr.progressBarStyleLarge).apply {
            isIndeterminate = true
            indeterminateTintList = ColorStateList.valueOf(BOOT_ACCENT_COLOR)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(20)
            }
        }

        val statusTv = TextView(this).apply {
            text = BOOT_STATUS_DEFAULT
            setTextColor(BOOT_TEXT_COLOR)
            textSize = 22f
            gravity = Gravity.CENTER
            setPadding(dp(40), dp(8), dp(40), dp(8))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        val overlay = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(BACKGROUND_COLOR)
            isClickable = false
            isFocusable = false
            visibility = View.VISIBLE
            addView(progress)
            addView(statusTv)
        }

        bootProgressBar = progress
        bootStatusText = statusTv
        bootOverlay = overlay

        rootContainer.addView(
            overlay,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        return overlay
    }

    private fun showBootOverlayLoading() {
        isTerminalCrashState = false
        val overlay = ensureBootOverlay()
        bootProgressBar?.visibility = View.VISIBLE
        bootStatusText?.apply {
            setTextColor(BOOT_TEXT_COLOR)
            text = BOOT_STATUS_DEFAULT
        }
        overlay.visibility = View.VISIBLE
        overlay.bringToFront()
    }

    private fun showBootOverlayError(message: String) {
        cancelBootOverlayFallback()
        isTerminalCrashState = true
        try {
            val overlay = ensureBootOverlay()
            bootProgressBar?.visibility = View.GONE
            bootStatusText?.apply {
                setTextColor(BOOT_ERROR_COLOR)
                text = message
            }
            overlay.visibility = View.VISIBLE
            overlay.bringToFront()
        } catch (t: Throwable) {
            Log.e(TAG, "Boot overlay error UI failure", t)
        }
    }

    private fun cancelBootOverlayFallback() {
        val runnable = hideBootOverlayRunnable ?: return
        hideBootOverlayRunnable = null
        if (::rootContainer.isInitialized) {
            rootContainer.removeCallbacks(runnable)
        }
    }

    private fun scheduleBootOverlayFallback(delayMs: Long) {
        cancelBootOverlayFallback()
        if (isTerminalCrashState || !::rootContainer.isInitialized) return
        val overlay = bootOverlay ?: return
        if (overlay.visibility == View.GONE) return
        val runnable = Runnable {
            hideBootOverlayRunnable = null
            hideBootOverlayNow()
        }
        hideBootOverlayRunnable = runnable
        rootContainer.postDelayed(runnable, delayMs)
    }

    private fun hideBootOverlayNow() {
        if (isTerminalCrashState) return
        cancelBootOverlayFallback()
        val overlay = bootOverlay ?: return
        if (overlay.visibility != View.GONE) {
            overlay.visibility = View.GONE
        }
    }

    private fun handleStaticAssetRequest(rawPath: String, method: String): WebResourceResponse {
        val assetPath = normalizeAssetPath(rawPath)
            ?: return emptyStaticNotFoundResponse()

        val stream = try {
            applicationContext.assets.open("www/$assetPath")
        } catch (_: Throwable) {
            return emptyStaticNotFoundResponse()
        }

        val responseStream: InputStream = if (method == "HEAD") {
            try {
                stream.close()
            } catch (_: Throwable) {
            }
            ByteArrayInputStream(ByteArray(0))
        } else {
            stream
        }

        val (mimeType, encoding) = resolveAssetMimeAndEncoding(assetPath)
        val headers = mapOf(
            "Access-Control-Allow-Origin" to "*",
            "Cache-Control" to "no-cache"
        )
        return WebResourceResponse(
            mimeType,
            encoding,
            200,
            "OK",
            headers,
            responseStream
        )
    }

    private fun normalizeAssetPath(rawPath: String?): String? {
        val trimmed = (rawPath ?: "").trim('/')
        if (trimmed.isEmpty()) return "index.html"
        if (trimmed.contains('\\') || trimmed.contains("..")) return null
        val segments = trimmed.split('/')
        val cleaned = ArrayList<String>(segments.size)
        for (segment in segments) {
            if (segment.isEmpty() || segment == ".") continue
            if (segment == ".." || segment.contains("..")) return null
            cleaned.add(segment)
        }
        return if (cleaned.isEmpty()) "index.html" else cleaned.joinToString("/")
    }

    private fun resolveAssetMimeAndEncoding(assetPath: String): Pair<String, String?> {
        val fileName = assetPath.substringAfterLast('/')
        val ext = if (fileName.contains('.')) {
            fileName.substringAfterLast('.').lowercase(Locale.US)
        } else {
            ""
        }
        return when (ext) {
            "html", "htm" -> "text/html" to "utf-8"
            "js", "mjs" -> "application/javascript" to "utf-8"
            "css" -> "text/css" to "utf-8"
            "json" -> "application/json" to "utf-8"
            "xml" -> "application/xml" to "utf-8"
            "svg" -> "image/svg+xml" to "utf-8"
            "png" -> "image/png" to null
            "jpg", "jpeg" -> "image/jpeg" to null
            "webp" -> "image/webp" to null
            "gif" -> "image/gif" to null
            "woff" -> "font/woff" to null
            "woff2" -> "font/woff2" to null
            else -> "application/octet-stream" to null
        }
    }

    private fun emptyStaticNotFoundResponse(): WebResourceResponse {
        return WebResourceResponse(
            "text/plain",
            "utf-8",
            404,
            "Not Found",
            mapOf(
                "Access-Control-Allow-Origin" to "*",
                "Cache-Control" to "no-store"
            ),
            ByteArrayInputStream(ByteArray(0))
        )
    }

    private fun handleProxyRequest(
        uri: Uri,
        method: String,
        requestHeaders: Map<String, String>?
    ): WebResourceResponse {
        if (method == "OPTIONS") {
            return WebResourceResponse(
                "text/plain",
                "utf-8",
                204,
                "No Content",
                mapOf(
                    "Access-Control-Allow-Origin" to "*",
                    "Access-Control-Allow-Methods" to "GET, HEAD, OPTIONS",
                    "Access-Control-Allow-Headers" to "*",
                    "Cache-Control" to "no-store"
                ),
                ByteArrayInputStream(ByteArray(0))
            )
        }

        val targetUrlRaw = uri.getQueryParameter("url")?.trim()
        if (targetUrlRaw.isNullOrEmpty()) {
            return proxyErrorResponse(400, "Bad Request")
        }
        val parsedTarget = try {
            URL(targetUrlRaw)
        } catch (_: MalformedURLException) {
            null
        }
        val targetProtocol = parsedTarget?.protocol?.lowercase(Locale.US)
        if (parsedTarget == null ||
            (targetProtocol != "http" && targetProtocol != "https") ||
            parsedTarget.host.isNullOrBlank()
        ) {
            return proxyErrorResponse(400, "Bad Request")
        }

        if (method != "GET" && method != "HEAD") {
            return proxyErrorResponse(405, "Method Not Allowed")
        }

        val incomingUa = requestHeaders?.entries
            ?.firstOrNull { it.key.equals("User-Agent", ignoreCase = true) }
            ?.value
            ?.replace(Regex("[\\r\\n]+"), " ")
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
        val userAgent = incomingUa ?: PROXY_USER_AGENT

        var currentUrl = parsedTarget
        var currentMethod = method
        var conn: HttpURLConnection? = null
        var statusCode = -1
        var redirects = 0

        try {
            while (true) {
                val candidate = (currentUrl.openConnection() as? HttpURLConnection)
                    ?: throw IOException("Unsupported connection type")
                var handedOff = false
                try {
                    candidate.instanceFollowRedirects = false
                    candidate.connectTimeout = PROXY_CONNECT_TIMEOUT_MS
                    candidate.readTimeout = PROXY_READ_TIMEOUT_MS
                    candidate.useCaches = false
                    candidate.requestMethod = currentMethod
                    candidate.setRequestProperty("User-Agent", userAgent)
                    requestHeaders?.forEach { (key, value) ->
                        if (key.equals("Accept", ignoreCase = true) ||
                            key.equals("Range", ignoreCase = true)
                        ) {
                            val safeVal = value.replace(Regex("[\\r\\n]+"), " ").trim()
                            if (safeVal.isNotEmpty()) {
                                candidate.setRequestProperty(key, safeVal)
                            }
                        }
                    }

                    val code = candidate.responseCode
                    if (code in PROXY_REDIRECT_CODES) {
                        val location = candidate.getHeaderField("Location")
                        candidate.disconnect()
                        if (location.isNullOrBlank() || redirects >= PROXY_MAX_REDIRECTS) {
                            throw IOException("Redirect limit exceeded or missing Location ($code)")
                        }
                        val nextUrl = URL(currentUrl, location.trim())
                        val nextProtocol = nextUrl.protocol.lowercase(Locale.US)
                        if (nextProtocol != "http" && nextProtocol != "https") {
                            throw IOException("Unsupported redirect scheme: $nextProtocol")
                        }
                        if (code == HttpURLConnection.HTTP_SEE_OTHER && currentMethod != "HEAD") {
                            currentMethod = "GET"
                        }
                        currentUrl = nextUrl
                        redirects++
                        continue
                    }

                    conn = candidate
                    statusCode = code
                    handedOff = true
                    break
                } finally {
                    if (!handedOff) {
                        try {
                            candidate.disconnect()
                        } catch (_: Throwable) {
                        }
                    }
                }
            }

            val activeConn = conn ?: throw IOException("Missing proxy connection")
            if (statusCode !in 100..299 && statusCode !in 400..599) {
                activeConn.disconnect()
                return proxyErrorResponse(502, "Bad Gateway")
            }

            val reasonPhrase = activeConn.responseMessage
                ?.replace(Regex("[\\r\\n]+"), " ")
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?: defaultReasonPhrase(statusCode)

            val (mimeType, encoding) = parseContentType(activeConn.contentType)
            val responseHeaders = mapOf(
                "Access-Control-Allow-Origin" to "*",
                "Access-Control-Allow-Methods" to "GET, HEAD, OPTIONS",
                "Cache-Control" to "no-store"
            )

            val responseStream: InputStream = if (currentMethod == "HEAD") {
                activeConn.disconnect()
                ByteArrayInputStream(ByteArray(0))
            } else {
                val upstreamStream = try {
                    if (statusCode >= 400) activeConn.errorStream else activeConn.inputStream
                } catch (_: IOException) {
                    activeConn.errorStream
                }
                if (upstreamStream == null) {
                    activeConn.disconnect()
                    ByteArrayInputStream(ByteArray(0))
                } else {
                    ConnectionManagedInputStream(upstreamStream, activeConn)
                }
            }

            return WebResourceResponse(
                mimeType,
                encoding,
                statusCode,
                reasonPhrase,
                responseHeaders,
                responseStream
            )
        } catch (e: IOException) {
            Log.w(TAG, "Proxy IOException for $targetUrlRaw: ${e.message}")
            try {
                conn?.disconnect()
            } catch (_: Throwable) {
            }
            return proxyErrorResponse(502, "Bad Gateway")
        } catch (t: Throwable) {
            Log.w(TAG, "Proxy error for $targetUrlRaw", t)
            try {
                conn?.disconnect()
            } catch (_: Throwable) {
            }
            return proxyErrorResponse(502, "Bad Gateway")
        }
    }

    private fun parseContentType(rawContentType: String?): Pair<String, String?> {
        if (rawContentType.isNullOrBlank()) {
            return "application/octet-stream" to null
        }
        val parts = rawContentType.split(';')
        val mimeType = parts.firstOrNull()?.trim()?.lowercase(Locale.US)
            ?.takeIf { it.isNotEmpty() } ?: "application/octet-stream"
        var charset: String? = null
        for (i in 1 until parts.size) {
            val param = parts[i].trim()
            if (param.startsWith("charset=", ignoreCase = true)) {
                val value = param.substringAfter('=')
                    .trim()
                    .trim('"', '\'')
                if (value.isNotEmpty()) {
                    charset = value
                    break
                }
            }
        }
        return mimeType to charset
    }

    private fun defaultReasonPhrase(statusCode: Int): String {
        return when (statusCode) {
            200 -> "OK"
            201 -> "Created"
            204 -> "No Content"
            206 -> "Partial Content"
            400 -> "Bad Request"
            401 -> "Unauthorized"
            403 -> "Forbidden"
            404 -> "Not Found"
            405 -> "Method Not Allowed"
            500 -> "Internal Server Error"
            502 -> "Bad Gateway"
            503 -> "Service Unavailable"
            504 -> "Gateway Timeout"
            else -> if (statusCode < 400) "OK" else "Error"
        }
    }

    private fun proxyErrorResponse(statusCode: Int, reasonPhrase: String): WebResourceResponse {
        return WebResourceResponse(
            "text/plain",
            "utf-8",
            statusCode,
            reasonPhrase,
            mapOf(
                "Access-Control-Allow-Origin" to "*",
                "Access-Control-Allow-Methods" to "GET, HEAD, OPTIONS",
                "Cache-Control" to "no-store"
            ),
            ByteArrayInputStream(ByteArray(0))
        )
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Suppress("DEPRECATION")
    private fun configureWebSettings(settings: WebSettings) {
        try {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            settings.allowFileAccessFromFileURLs = true
            settings.allowUniversalAccessFromFileURLs = true
            settings.builtInZoomControls = false
            settings.displayZoomControls = false
            settings.setSupportZoom(false)
            settings.cacheMode = WebSettings.LOAD_DEFAULT
        } catch (t: Throwable) {
            Log.w(TAG, "configureWebSettings notice", t)
        }
    }

    override fun onResume() {
        super.onResume()
        applyImmersiveFullscreen()
        webView?.let { wv ->
            try {
                wv.onResume()
                wv.resumeTimers()
                wv.requestFocus()
            } catch (t: Throwable) {
                Log.w(TAG, "onResume notice", t)
            }
        }
    }

    override fun onPause() {
        webView?.let { wv ->
            try {
                wv.onPause()
            } catch (t: Throwable) {
                Log.w(TAG, "onPause notice", t)
            }
        }
        super.onPause()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            applyImmersiveFullscreen()
            val wv = webView
            if (wv != null && !isWebInputFocused) {
                wv.requestFocus()
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (isPageLoaded && webView != null) {
            handleAndroidBackKeyDown()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    private fun destroyWebView() {
        cancelBootOverlayFallback()
        val wv = webView ?: return
        webView = null
        try {
            wv.removeJavascriptInterface("AndroidTvHost")
            (wv.parent as? ViewGroup)?.removeView(wv)
            wv.stopLoading()
            wv.destroy()
        } catch (t: Throwable) {
            Log.w(TAG, "destroyWebView notice", t)
        }
    }

    override fun onDestroy() {
        cancelBootOverlayFallback()
        destroyWebView()
        super.onDestroy()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val wv = webView
        if (wv == null || !isPageLoaded) {
            return super.dispatchKeyEvent(event)
        }

        if (event.action != KeyEvent.ACTION_DOWN && event.action != KeyEvent.ACTION_UP) {
            return super.dispatchKeyEvent(event)
        }

        val androidKeyCode = event.keyCode
        val isDown = event.action == KeyEvent.ACTION_DOWN
        val isRepeat = isDown && event.repeatCount > 0

        if (!isDown && suppressNextKeyUpKeyCode == androidKeyCode) {
            suppressNextKeyUpKeyCode = -1
            return true
        }

        if (isWebInputFocused) {
            when (androidKeyCode) {
                KeyEvent.KEYCODE_BACK,
                KeyEvent.KEYCODE_ESCAPE -> {
                    if (isDown && !isRepeat) {
                        suppressNextKeyUpKeyCode = androidKeyCode
                        blurActiveWebInput()
                    }
                    return true
                }

                KeyEvent.KEYCODE_DPAD_UP,
                KeyEvent.KEYCODE_DPAD_DOWN -> {
                    if (isDown && !isRepeat) {
                        blurActiveWebInput()
                    }
                    val mapped = mapKeyEvent(androidKeyCode) ?: return true
                    val type = if (isDown) "keydown" else "keyup"
                    dispatchWebKey(type, mapped.keyCode, mapped.key, isRepeat)
                    return true
                }

                KeyEvent.KEYCODE_DPAD_CENTER,
                KeyEvent.KEYCODE_ENTER,
                KeyEvent.KEYCODE_NUMPAD_ENTER -> {
                    if (isDown && !isRepeat) {
                        suppressNextKeyUpKeyCode = androidKeyCode
                        blurActiveWebInput()
                    }
                    return true
                }

                KeyEvent.KEYCODE_DPAD_LEFT,
                KeyEvent.KEYCODE_DPAD_RIGHT,
                in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9,
                in KeyEvent.KEYCODE_NUMPAD_0..KeyEvent.KEYCODE_NUMPAD_9 -> {
                    return super.dispatchKeyEvent(event)
                }
            }
        }

        val mapped = mapKeyEvent(androidKeyCode) ?: return super.dispatchKeyEvent(event)

        if (!wv.hasFocus()) {
            wv.requestFocus()
        }

        if (isDown) {
            if (isRepeat && !mapped.allowRepeat) {
                return true
            }
            if (mapped.keyCode == WEB_KEY_BACK) {
                handleAndroidBackKeyDown()
            } else {
                dispatchWebKey("keydown", mapped.keyCode, mapped.key, isRepeat)
            }
            return true
        }

        if (!mapped.sendKeyUp) {
            return true
        }
        if (event.isCanceled && mapped.keyCode == WEB_KEY_ENTER) {
            return true
        }
        dispatchWebKey("keyup", mapped.keyCode, mapped.key, false)
        return true
    }

    private fun handleAndroidBackKeyDown() {
        if (isWebInputFocused) {
            blurActiveWebInput()
            return
        }
        dispatchWebKey("keydown", WEB_KEY_BACK, "Back", false)
    }

    private fun blurActiveWebInput() {
        isWebInputFocused = false
        hideSoftKeyboard()
        val wv = webView ?: return
        try {
            wv.evaluateJavascript(
                """
                (function() {
                  if (typeof window.__blurActiveAndroidTvInput === 'function') {
                    window.__blurActiveAndroidTvInput();
                    return;
                  }
                  try {
                    var el = document.activeElement;
                    if (el && el.tagName && (el.tagName.toUpperCase() === 'INPUT' || el.tagName.toUpperCase() === 'TEXTAREA')) {
                      el.blur();
                    }
                    if (document.body) document.body.focus();
                  } catch (e) {}
                })();
                """.trimIndent(),
                null
            )
        } catch (t: Throwable) {
            Log.w(TAG, "blurActiveWebInput notice", t)
        }
    }

    private fun hideSoftKeyboard() {
        val wv = webView ?: return
        try {
            val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager ?: return
            imm.hideSoftInputFromWindow(wv.windowToken, 0)
        } catch (t: Throwable) {
            Log.w(TAG, "hideSoftKeyboard notice", t)
        }
    }

    private fun mapKeyEvent(androidKeyCode: Int): MappedWebKey? {
        return when (androidKeyCode) {
            KeyEvent.KEYCODE_DPAD_UP -> MappedWebKey(38, "ArrowUp", allowRepeat = true, sendKeyUp = true)
            KeyEvent.KEYCODE_DPAD_DOWN -> MappedWebKey(40, "ArrowDown", allowRepeat = true, sendKeyUp = true)
            KeyEvent.KEYCODE_DPAD_LEFT -> MappedWebKey(37, "ArrowLeft", allowRepeat = true, sendKeyUp = true)
            KeyEvent.KEYCODE_DPAD_RIGHT -> MappedWebKey(39, "ArrowRight", allowRepeat = true, sendKeyUp = true)

            KeyEvent.KEYCODE_DPAD_CENTER,
            KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_NUMPAD_ENTER -> MappedWebKey(WEB_KEY_ENTER, "Enter", allowRepeat = true, sendKeyUp = true)

            KeyEvent.KEYCODE_BACK,
            KeyEvent.KEYCODE_ESCAPE -> MappedWebKey(WEB_KEY_BACK, "Back", allowRepeat = false, sendKeyUp = false)

            KeyEvent.KEYCODE_CHANNEL_UP,
            KeyEvent.KEYCODE_PAGE_UP -> MappedWebKey(427, "ChannelUp", allowRepeat = true, sendKeyUp = true)

            KeyEvent.KEYCODE_CHANNEL_DOWN,
            KeyEvent.KEYCODE_PAGE_DOWN -> MappedWebKey(428, "ChannelDown", allowRepeat = true, sendKeyUp = true)

            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> MappedWebKey(179, "MediaPlayPause", allowRepeat = false, sendKeyUp = true)
            KeyEvent.KEYCODE_MEDIA_PLAY -> MappedWebKey(415, "Play", allowRepeat = false, sendKeyUp = true)
            KeyEvent.KEYCODE_MEDIA_PAUSE -> MappedWebKey(19, "Pause", allowRepeat = false, sendKeyUp = true)
            KeyEvent.KEYCODE_MEDIA_STOP -> MappedWebKey(413, "MediaStop", allowRepeat = false, sendKeyUp = true)

            KeyEvent.KEYCODE_MEDIA_REWIND,
            KeyEvent.KEYCODE_MEDIA_PREVIOUS -> MappedWebKey(412, "MediaRewind", allowRepeat = true, sendKeyUp = true)

            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
            KeyEvent.KEYCODE_MEDIA_NEXT -> MappedWebKey(417, "MediaFastForward", allowRepeat = true, sendKeyUp = true)

            KeyEvent.KEYCODE_PROG_RED -> MappedWebKey(403, "ColorF0Red", allowRepeat = false, sendKeyUp = true)
            KeyEvent.KEYCODE_PROG_GREEN -> MappedWebKey(404, "ColorF1Green", allowRepeat = true, sendKeyUp = true)
            KeyEvent.KEYCODE_PROG_YELLOW,
            KeyEvent.KEYCODE_MENU -> MappedWebKey(405, "ColorF2Yellow", allowRepeat = false, sendKeyUp = true)
            KeyEvent.KEYCODE_PROG_BLUE -> MappedWebKey(406, "ColorF3Blue", allowRepeat = true, sendKeyUp = true)

            KeyEvent.KEYCODE_GUIDE -> MappedWebKey(458, "Guide", allowRepeat = false, sendKeyUp = true)
            KeyEvent.KEYCODE_INFO -> MappedWebKey(457, "Info", allowRepeat = false, sendKeyUp = true)

            in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> {
                val digit = androidKeyCode - KeyEvent.KEYCODE_0
                MappedWebKey(48 + digit, digit.toString(), allowRepeat = false, sendKeyUp = true)
            }

            in KeyEvent.KEYCODE_NUMPAD_0..KeyEvent.KEYCODE_NUMPAD_9 -> {
                val digit = androidKeyCode - KeyEvent.KEYCODE_NUMPAD_0
                MappedWebKey(48 + digit, digit.toString(), allowRepeat = false, sendKeyUp = true)
            }

            else -> null
        }
    }

    private fun installWebKeyBridge() {
        val wv = webView ?: return
        try {
            wv.evaluateJavascript(BRIDGE_BOOTSTRAP_JS, null)
        } catch (t: Throwable) {
            Log.w(TAG, "installWebKeyBridge notice", t)
        }
    }

    private fun dispatchWebKey(type: String, keyCode: Int, key: String, isRepeat: Boolean) {
        val wv = webView ?: return
        val safeType = if (type == "keyup") "keyup" else "keydown"
        val escapedKey = JSONObject.quote(key)
        val js = """
            (function() {
              if (typeof window.__dispatchAndroidTvKey !== 'function') {
                $BRIDGE_BOOTSTRAP_JS
              }
              if (typeof window.__dispatchAndroidTvKey === 'function') {
                window.__dispatchAndroidTvKey('$safeType', $keyCode, $escapedKey, $isRepeat);
              }
            })();
        """.trimIndent()
        try {
            wv.evaluateJavascript(js, null)
        } catch (t: Throwable) {
            Log.w(TAG, "dispatchWebKey notice", t)
        }
    }

    @Suppress("DEPRECATION")
    private fun applyImmersiveFullscreen() {
        try {
            window.addFlags(
                WindowManager.LayoutParams.FLAG_FULLSCREEN
                    or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                )
        } catch (t: Throwable) {
            Log.w(TAG, "applyImmersiveFullscreen notice", t)
        }
    }

    companion object {
        private const val TAG = "IPTVAndroidTV"
        private const val APP_HOST = "appassets.androidplatform.net"
        private const val PROXY_PATH = "__proxy__"
        private const val ENTRY_URL = "https://appassets.androidplatform.net/index.html"
        private const val PROXY_USER_AGENT = "VLC/3.0.18 LibVLC/3.0.18"
        private const val PROXY_CONNECT_TIMEOUT_MS = 10_000
        private const val PROXY_READ_TIMEOUT_MS = 15_000
        private const val PROXY_MAX_REDIRECTS = 5
        private const val MAX_RENDER_CRASH_RECOVERIES = 3
        private const val BOOT_FALLBACK_DELAY_MS = 1200L
        private const val BOOT_STATUS_DEFAULT = "IPTV Live • טוען שידורים..."
        private const val BACKGROUND_COLOR = 0xFF070B14.toInt()
        private const val BOOT_ACCENT_COLOR = 0xFF38BDF8.toInt()
        private const val BOOT_TEXT_COLOR = 0xFFE2E8F0.toInt()
        private const val BOOT_ERROR_COLOR = 0xFFFCA5A5.toInt()
        private const val WEB_KEY_ENTER = 13
        private const val WEB_KEY_BACK = 461
        private val ALLOWED_SCHEMES = setOf("file", "http", "https", "data", "blob")
        private val PROXY_REDIRECT_CODES = setOf(301, 302, 303, 307, 308)

        private val BRIDGE_BOOTSTRAP_JS = """
            (function() {
              function isEditableElement(el) {
                if (!el || !el.tagName) return false;
                var tag = el.tagName.toUpperCase();
                if (tag === 'INPUT' || tag === 'TEXTAREA') {
                  return el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0;
                }
                return Boolean(el.isContentEditable);
              }

              function syncInputFocusState() {
                var active = document.activeElement;
                var focused = isEditableElement(active);
                if (!focused && active && active.tagName) {
                  var t = active.tagName.toUpperCase();
                  if (t === 'INPUT' || t === 'TEXTAREA') {
                    try { active.blur(); } catch (e) {}
                  }
                }
                if (window.AndroidTvHost && typeof window.AndroidTvHost.setInputFocused === 'function') {
                  window.AndroidTvHost.setInputFocused(focused);
                }
              }

              if (!window.__androidTvModalObserverInstalled && typeof MutationObserver === 'function') {
                var modalIds = ['settings-modal', 'search-modal', 'guide-modal', 'ota-modal'];
                var obs = new MutationObserver(syncInputFocusState);
                var attached = 0;
                modalIds.forEach(function(id) {
                  var modal = document.getElementById(id);
                  if (modal) {
                    obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
                    attached++;
                  }
                });
                if (attached > 0) {
                  window.__androidTvModalObserverInstalled = true;
                }
              }

              if (window.__androidTvHookInstalled) {
                syncInputFocusState();
                return;
              }
              window.__androidTvHookInstalled = true;

              document.addEventListener('focusin', syncInputFocusState, true);
              document.addEventListener('focusout', function() {
                setTimeout(syncInputFocusState, 0);
              }, true);

              window.__blurActiveAndroidTvInput = function() {
                try {
                  var active = document.activeElement;
                  if (active && active.tagName) {
                    var t = active.tagName.toUpperCase();
                    if (t === 'INPUT' || t === 'TEXTAREA') {
                      active.blur();
                    }
                  }
                  if (document.body) document.body.focus();
                } catch (e) {}
                syncInputFocusState();
              };

              window.__dispatchAndroidTvKey = function(type, keyCode, key, isRepeat) {
                try {
                  var ev = new KeyboardEvent(type, {
                    key: key,
                    keyCode: keyCode,
                    which: keyCode,
                    repeat: Boolean(isRepeat),
                    bubbles: true,
                    cancelable: true
                  });
                  try {
                    if (ev.keyCode !== keyCode) {
                      Object.defineProperty(ev, 'keyCode', { get: function() { return keyCode; } });
                    }
                    if (ev.which !== keyCode) {
                      Object.defineProperty(ev, 'which', { get: function() { return keyCode; } });
                    }
                  } catch (err) {}
                  var target = document.body || document.documentElement || window;
                  target.dispatchEvent(ev);
                  return;
                } catch (e) {}

                if (type === 'keydown' && window.AndroidTVBridge && typeof window.AndroidTVBridge.dispatchKey === 'function') {
                  var map = {
                    13: 'ok', 37: 'left', 38: 'up', 39: 'right', 40: 'down',
                    461: 'back', 27: 'back', 403: 'red', 404: 'green', 405: 'yellow', 406: 'blue',
                    427: 'ch_up', 428: 'ch_down', 179: 'play_pause', 415: 'play_pause', 19: 'play_pause',
                    412: 'rewind', 417: 'fast_forward', 457: 'info', 458: 'yellow'
                  };
                  var action = map[keyCode];
                  if (action) window.AndroidTVBridge.dispatchKey(action);
                }
              };

              syncInputFocusState();
            })();
        """.trimIndent()
    }
}
