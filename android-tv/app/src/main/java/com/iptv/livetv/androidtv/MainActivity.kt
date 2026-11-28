package com.iptv.livetv.androidtv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.os.SystemClock
import android.speech.RecognizerIntent
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.io.PrintWriter
import java.io.StringWriter
import java.net.HttpURLConnection
import java.net.MalformedURLException
import java.net.URL
import java.util.Locale
import kotlin.system.exitProcess

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
            try {
                isWebInputFocused = focused
            } catch (t: Throwable) {
                Log.w(TAG, "setInputFocused notice", t)
            }
        }

        @JavascriptInterface
        fun notifyAppReady() {
            try {
                Log.i(TAG, "notifyAppReady received from JS")
                if (::rootContainer.isInitialized) {
                    rootContainer.post {
                        if (!isTerminalCrashState && !pendingRecovery && webView != null) {
                            isPageLoaded = true
                            hideBootOverlayNow()
                        }
                    }
                }
            } catch (t: Throwable) {
                Log.w(TAG, "notifyAppReady notice", t)
            }
        }

        @JavascriptInterface
        fun isSafeMode(): Boolean = safeModeActive

        @JavascriptInterface
        fun setScreenSleepMode(asleep: Boolean) {
            safely("setScreenSleepMode dispatch") {
                runOnUiThread {
                    safely("setScreenSleepMode") {
                        if (isFinishing || isDestroyed) return@safely
                        isScreenSleepMode = asleep
                        if (asleep) {
                            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                            webView?.keepScreenOn = false
                        } else {
                            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                            webView?.keepScreenOn = true
                        }
                    }
                }
            }
        }

        @JavascriptInterface
        fun startVoiceCommand(lang: String?) {
            safely("startVoiceCommand dispatch") {
                runOnUiThread {
                    if (isFinishing || isDestroyed) {
                        notifyNativeVoiceError("unsupported")
                        return@runOnUiThread
                    }
                    try {
                        val resolvedLang = if (lang.isNullOrBlank()) "he-IL" else lang.trim()
                        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                            putExtra(
                                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
                            )
                            putExtra(RecognizerIntent.EXTRA_LANGUAGE, resolvedLang)
                            putExtra(RecognizerIntent.EXTRA_PROMPT, "אמור שם ערוץ או תוכנית")
                            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                        }
                        startActivityForResult(intent, REQ_VOICE_COMMAND)
                    } catch (e: ActivityNotFoundException) {
                        Log.w(TAG, "Voice recognizer unavailable on device", e)
                        notifyNativeVoiceError("unsupported")
                    } catch (t: Throwable) {
                        Log.w(TAG, "startVoiceCommand failed", t)
                        notifyNativeVoiceError("unsupported")
                    }
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
    private var recoveryButtons: LinearLayout? = null
    private var retryButton: Button? = null
    private var safeModeButton: Button? = null
    private var clearCacheButton: Button? = null
    private var hideBootOverlayRunnable: Runnable? = null
    private var bootHealthyRunnable: Runnable? = null
    private var recoveryRunnable: Runnable? = null
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    @Volatile
    private var isWebInputFocused: Boolean = false

    @Volatile
    private var isPageLoaded: Boolean = false

    @Volatile
    private var isForeground: Boolean = false

    @Volatile
    private var safeModeActive: Boolean = false

    @Volatile
    private var isScreenSleepMode: Boolean = false

    private var suppressNextKeyUpKeyCode: Int = -1
    private var renderCrashCount: Int = 0
    private var isTerminalCrashState: Boolean = false
    private var pendingRecovery: Boolean = false
    private var bootHealthy: Boolean = false

    // (elapsedRealtime, didCrash) of every recent renderer loss; used for bounded recovery.
    private val recentRenderLosses = ArrayList<Pair<Long, Boolean>>()
    private var lastJsError: String? = null

    private val transparentVideoPoster: Bitmap by lazy {
        Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888).apply {
            eraseColor(Color.TRANSPARENT)
        }
    }

    // WebViewClient installed on a WebView that is being torn down. The default
    // WebViewClient.onRenderProcessGone() returns false, which makes the OS kill the whole app
    // if a dying renderer reports in during destroy(); this one always reports "handled".
    private class DetachedWebViewClient : WebViewClient() {
        override fun onRenderProcessGone(
            view: WebView?,
            detail: RenderProcessGoneDetail?
        ): Boolean = true
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        installCrashHandler()
        evaluateBootGuard()
        Log.i(TAG, "onCreate safeMode=$safeModeActive")

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

    private inline fun safely(tag: String, block: () -> Unit) {
        try {
            block()
        } catch (t: Throwable) {
            Log.w(TAG, "$tag notice", t)
        }
    }

    private fun evaluateWebJs(script: String) {
        safely("evaluateWebJs") {
            val wv = webView ?: return@safely
            wv.evaluateJavascript(script, null)
        }
    }

    private fun notifyNativeVoiceError(errorCode: String) {
        val quoted = if (errorCode == "unsupported" || errorCode == "cancelled") {
            "'$errorCode'"
        } else {
            JSONObject.quote(errorCode)
        }
        evaluateWebJs(
            "window.app && window.app.onNativeVoiceError && window.app.onNativeVoiceError($quoted)"
        )
    }

    // ---------------------------------------------------------------------------------------
    // Crash guard: persistent crash log, consecutive startup-crash streak and Safe Mode
    // ---------------------------------------------------------------------------------------

    private fun guardPrefs(): SharedPreferences =
        getSharedPreferences(CRASH_PREFS, Context.MODE_PRIVATE)

    private fun installCrashHandler() {
        if (crashHandlerInstalled) return
        synchronized(MainActivity::class.java) {
            if (crashHandlerInstalled) return
            val appContext = applicationContext
            val previous = Thread.getDefaultUncaughtExceptionHandler()
            Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
                try {
                    persistCrashReport(
                        appContext,
                        "fatal-exception",
                        buildCrashSummary(thread, throwable),
                        fatal = true
                    )
                } catch (_: Throwable) {
                    // never let the crash recorder itself throw
                }
                if (previous != null) {
                    previous.uncaughtException(thread, throwable)
                } else {
                    Process.killProcess(Process.myPid())
                    exitProcess(10)
                }
            }
            crashHandlerInstalled = true
        }
    }

    private fun evaluateBootGuard() {
        try {
            val prefs = guardPrefs()
            var streak = prefs.getInt(KEY_STARTUP_STREAK, 0)
            val wasBootPending = prefs.getBoolean(KEY_BOOT_PENDING, false)
            val fatalAlreadyCounted = prefs.getBoolean(KEY_FATAL_COUNTED, false)
            // If the previous launch died before reaching healthy (native crash/kill) and wasn't
            // already incremented by the uncaught exception handler, count it now.
            if (wasBootPending && !fatalAlreadyCounted) {
                streak++
            }
            val forcedByIntent = try {
                intent?.getBooleanExtra(EXTRA_SAFE_MODE, false) == true
            } catch (_: Throwable) {
                false
            }
            safeModeActive = forcedByIntent || streak >= SAFE_MODE_STARTUP_CRASH_THRESHOLD
            bootHealthy = false
            prefs.edit()
                .putInt(KEY_STARTUP_STREAK, streak)
                .putBoolean(KEY_BOOT_PENDING, true)
                .putBoolean(KEY_FATAL_COUNTED, false)
                .commit()
            if (safeModeActive) {
                Log.w(TAG, "Booting in Safe Mode (consecutive startup failures=$streak)")
            }
        } catch (t: Throwable) {
            Log.w(TAG, "evaluateBootGuard notice", t)
        }
    }

    private fun scheduleBootHealthyMark() {
        if (!::rootContainer.isInitialized) return
        if (bootHealthy || bootHealthyRunnable != null) return
        val runnable = Runnable {
            bootHealthyRunnable = null
            if (webView != null && isPageLoaded && !isTerminalCrashState && !pendingRecovery) {
                markBootHealthy()
            }
        }
        bootHealthyRunnable = runnable
        rootContainer.postDelayed(runnable, BOOT_HEALTHY_DELAY_MS)
    }

    private fun cancelBootHealthyMark() {
        val runnable = bootHealthyRunnable ?: return
        bootHealthyRunnable = null
        if (::rootContainer.isInitialized) {
            rootContainer.removeCallbacks(runnable)
        }
    }

    private fun markBootHealthy() {
        bootHealthy = true
        renderCrashCount = 0
        recentRenderLosses.clear()
        safely("markBootHealthy") {
            guardPrefs().edit()
                .putInt(KEY_STARTUP_STREAK, 0)
                .putBoolean(KEY_BOOT_PENDING, false)
                .putBoolean(KEY_FATAL_COUNTED, false)
                .commit()
        }
    }

    private fun markBootAttemptStarted() {
        if (!bootHealthy) return
        bootHealthy = false
        safely("markBootAttemptStarted") {
            guardPrefs().edit()
                .putBoolean(KEY_BOOT_PENDING, true)
                .putBoolean(KEY_FATAL_COUNTED, false)
                .commit()
        }
    }

    private fun resetCrashGuard() {
        bootHealthy = false
        renderCrashCount = 0
        recentRenderLosses.clear()
        safely("resetCrashGuard") {
            guardPrefs().edit()
                .putInt(KEY_STARTUP_STREAK, 0)
                .putBoolean(KEY_BOOT_PENDING, true)
                .putBoolean(KEY_FATAL_COUNTED, false)
                .commit()
        }
    }

    private fun currentEntryUrl(): String =
        if (safeModeActive) "$ENTRY_URL?safeMode=1" else ENTRY_URL

    private fun lastCrashHeadline(): String? {
        return try {
            guardPrefs().getString(KEY_LAST_CRASH, null)
                ?.lineSequence()
                ?.firstOrNull()
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?.take(180)
        } catch (_: Throwable) {
            null
        }
    }

    // ---------------------------------------------------------------------------------------
    // WebView lifecycle
    // ---------------------------------------------------------------------------------------

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun initWebView() {
        try {
            isPageLoaded = false
            isScreenSleepMode = false
            safely("initWebView keepScreenOn") {
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
            cancelBootOverlayFallback()
            markBootAttemptStarted()
            val wv = WebView(this).apply {
                layoutParams = FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
                setBackgroundColor(BACKGROUND_COLOR)
                // Always hardware compositing: <video>/MediaCodec surfaces on Android TV 11/14
                // break (or exhaust memory) under software layer rendering.
                setLayerType(View.LAYER_TYPE_NONE, null)
                isFocusable = true
                isFocusableInTouchMode = true
                keepScreenOn = true
                isHorizontalScrollBarEnabled = false
                isVerticalScrollBarEnabled = false
                overScrollMode = View.OVER_SCROLL_NEVER

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    try {
                        // waivedWhenNotVisible = true: a backgrounded app must not keep the
                        // renderer at IMPORTANT priority (that makes the whole process an LMK target).
                        setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true)
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
                        return try {
                            val scheme = request?.url?.scheme?.lowercase(Locale.US) ?: return false
                            scheme !in ALLOWED_SCHEMES
                        } catch (t: Throwable) {
                            Log.w(TAG, "shouldOverrideUrlLoading notice", t)
                            false
                        }
                    }

                    override fun shouldInterceptRequest(
                        view: WebView?,
                        request: WebResourceRequest?
                    ): WebResourceResponse? {
                        // Runs on a Chromium background thread: nothing thrown here may escape.
                        try {
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
                        } catch (t: Throwable) {
                            Log.w(TAG, "shouldInterceptRequest failed for ${request?.url}", t)
                            return try {
                                super.shouldInterceptRequest(view, request)
                            } catch (_: Throwable) {
                                null
                            }
                        }
                    }

                    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                        try {
                            super.onPageStarted(view, url, favicon)
                            Log.i(TAG, "onPageStarted url=$url")
                            cancelBootOverlayFallback()
                        } catch (t: Throwable) {
                            Log.w(TAG, "onPageStarted notice", t)
                        }
                    }

                    override fun onPageFinished(view: WebView?, url: String?) {
                        try {
                            super.onPageFinished(view, url)
                            Log.i(TAG, "onPageFinished url=$url")
                            if (isTerminalCrashState) return
                            isPageLoaded = true
                            installWebKeyBridge()
                            if (!isWebInputFocused) {
                                (view ?: webView)?.requestFocus()
                            }
                            if (bootOverlay?.visibility != View.GONE) {
                                scheduleBootOverlayFallback(BOOT_FALLBACK_DELAY_MS)
                            }
                        } catch (t: Throwable) {
                            Log.w(TAG, "onPageFinished notice", t)
                        }
                    }

                    override fun onReceivedError(
                        view: WebView?,
                        request: WebResourceRequest?,
                        error: WebResourceError?
                    ) {
                        super.onReceivedError(view, request, error)
                        try {
                            val description = error?.description?.toString().orEmpty()
                            val code = error?.errorCode ?: 0
                            val isMain = request?.isForMainFrame == true
                            Log.w(TAG, "onReceivedError main=$isMain code=$code '$description' url=${request?.url}")
                            if (isMain && !description.contains("ERR_ABORTED")) {
                                handleMainFrameFailure(
                                    "טעינת האפליקציה נכשלה ($description)",
                                    "main-frame-error: $description"
                                )
                            }
                        } catch (t: Throwable) {
                            Log.w(TAG, "onReceivedError handler notice", t)
                        }
                    }

                    override fun onReceivedHttpError(
                        view: WebView?,
                        request: WebResourceRequest?,
                        errorResponse: WebResourceResponse?
                    ) {
                        super.onReceivedHttpError(view, request, errorResponse)
                        try {
                            val status = errorResponse?.statusCode ?: 0
                            val isMain = request?.isForMainFrame == true
                            Log.w(TAG, "onReceivedHttpError main=$isMain status=$status url=${request?.url}")
                            if (isMain && status >= 400) {
                                handleMainFrameFailure(
                                    "טעינת האפליקציה נכשלה (HTTP $status)",
                                    "main-frame-http-$status"
                                )
                            }
                        } catch (t: Throwable) {
                            Log.w(TAG, "onReceivedHttpError handler notice", t)
                        }
                    }

                    @SuppressLint("WebViewClientOnReceivedSslError")
                    override fun onReceivedSslError(
                        view: WebView?,
                        handler: SslErrorHandler?,
                        error: SslError?
                    ) {
                        try {
                            Log.w(TAG, "Proceeding past SSL error for ${error?.url}: ${error?.primaryError}")
                            handler?.proceed()
                        } catch (t: Throwable) {
                            Log.w(TAG, "onReceivedSslError notice", t)
                        }
                    }

                    override fun onRenderProcessGone(
                        view: WebView?,
                        detail: RenderProcessGoneDetail?
                    ): Boolean {
                        return handleRenderProcessGone(view, detail)
                    }
                }

                webChromeClient = object : WebChromeClient() {
                    override fun getDefaultVideoPoster(): Bitmap? {
                        return try {
                            this@MainActivity.transparentVideoPoster
                        } catch (t: Throwable) {
                            Log.w(TAG, "getDefaultVideoPoster notice", t)
                            null
                        }
                    }

                    override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                        try {
                            if (consoleMessage != null) {
                                val line = "${consoleMessage.message()} " +
                                    "(${consoleMessage.sourceId()}:${consoleMessage.lineNumber()})"
                                when (consoleMessage.messageLevel()) {
                                    ConsoleMessage.MessageLevel.ERROR -> {
                                        lastJsError = line.take(300)
                                        Log.e(TAG, "console.error: $line")
                                    }
                                    ConsoleMessage.MessageLevel.WARNING -> Log.w(TAG, "console.warn: $line")
                                    else -> {}
                                }
                            }
                        } catch (_: Throwable) {
                        }
                        return true
                    }

                    override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                        try {
                            if (view == null || customView != null || !::rootContainer.isInitialized) {
                                callback?.onCustomViewHidden()
                                return
                            }
                            (view.parent as? ViewGroup)?.removeView(view)
                            customView = view
                            customViewCallback = callback
                            rootContainer.addView(
                                view,
                                FrameLayout.LayoutParams(
                                    ViewGroup.LayoutParams.MATCH_PARENT,
                                    ViewGroup.LayoutParams.MATCH_PARENT
                                )
                            )
                        } catch (t: Throwable) {
                            Log.w(TAG, "onShowCustomView notice", t)
                            customView = null
                            customViewCallback = null
                            try {
                                callback?.onCustomViewHidden()
                            } catch (_: Throwable) {
                            }
                        }
                    }

                    override fun onHideCustomView() {
                        hideCustomViewNow()
                    }
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

            // Remove only stale WebViews (never the boot overlay) and put the new one at index 0
            // behind bootOverlay so the boot overlay keeps covering it cleanly.
            for (i in rootContainer.childCount - 1 downTo 0) {
                val child = rootContainer.getChildAt(i)
                if (child is WebView) {
                    rootContainer.removeViewAt(i)
                }
            }
            rootContainer.addView(wv, 0)
            webView = wv
            showBootOverlayLoading()
            wv.requestFocus()
            val entryUrl = currentEntryUrl()
            Log.i(TAG, "loadUrl $entryUrl")
            wv.loadUrl(entryUrl)
        } catch (t: Throwable) {
            Log.e(TAG, "WebView initialization failed", t)
            persistCrashReport(
                applicationContext,
                "webview-init-failed",
                buildCrashSummary(Thread.currentThread(), t),
                fatal = false
            )
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

    private fun handleMainFrameFailure(message: String, reason: String) {
        if (isFinishing || isDestroyed || isTerminalCrashState) return
        persistCrashReport(applicationContext, "webview-error", reason, fatal = false)
        showBootOverlayError(message)
    }

    private fun handleRenderProcessGone(
        view: WebView?,
        detail: RenderProcessGoneDetail?
    ): Boolean {
        try {
            val current = webView
            if (view != null && view !== current) {
                safely("detach stale") { (view.parent as? ViewGroup)?.removeView(view) }
                return true
            }
            val didCrash = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                detail?.didCrash() ?: true
            } else {
                true
            }
            val priorityAtExit = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                detail?.rendererPriorityAtExit() ?: -1
            } else {
                -1
            }
            Log.e(TAG, "WebView render process gone (didCrash=$didCrash priorityAtExit=$priorityAtExit)")

            isPageLoaded = false
            cancelBootOverlayFallback()
            cancelBootHealthyMark()

            // Immediately detach the dead view so a frozen/blank surface is never left attached.
            safely("detach dead view") { (view?.parent as? ViewGroup)?.removeView(view) }
            destroyWebView(rendererGone = true)

            renderCrashCount++
            val now = SystemClock.elapsedRealtime()
            recentRenderLosses.removeAll { now - it.first > RENDER_CRASH_WINDOW_MS }
            recentRenderLosses.add(now to didCrash)
            val crashesInWindow = recentRenderLosses.count { it.second }
            val lossesInWindow = maxOf(renderCrashCount, recentRenderLosses.size)
            val reason = if (didCrash) {
                "webview-renderer-crashed (count=$renderCrashCount, windowCrashes=$crashesInWindow)"
            } else {
                "webview-renderer-reclaimed (count=$renderCrashCount, windowLosses=$lossesInWindow)"
            }
            persistCrashReport(
                applicationContext,
                "webview-renderer",
                reason,
                fatal = didCrash
            )

            if (isFinishing || isDestroyed) return true

            if (lossesInWindow > MAX_RENDER_CRASH_RECOVERIES) {
                pendingRecovery = false
                showBootOverlayError(
                    "שגיאת מנוע תצוגה (WebView קרס יותר מ-3 פעמים).\nאפשר לנסות שוב, להפעיל מצב בטוח או לנקות מטמון."
                )
                return true
            }

            // If >= 2 render crashes occur in one session (or didCrash after first recovery),
            // automatically escalate into Safe Mode (?safeMode=1).
            if (renderCrashCount >= SAFE_MODE_RENDER_CRASH_THRESHOLD ||
                crashesInWindow >= SAFE_MODE_RENDER_CRASH_THRESHOLD
            ) {
                safeModeActive = true
            }

            showBootOverlayLoading()
            pendingRecovery = true
            if (isForeground) {
                scheduleRecovery(RECOVERY_DELAY_MS * lossesInWindow)
            }
        } catch (t: Throwable) {
            Log.e(TAG, "handleRenderProcessGone failed", t)
        }
        return true
    }

    private fun scheduleRecovery(delayMs: Long) {
        if (!::rootContainer.isInitialized) return
        cancelScheduledRecovery()
        val runnable = Runnable {
            recoveryRunnable = null
            performPendingRecovery()
        }
        recoveryRunnable = runnable
        rootContainer.postDelayed(runnable, delayMs)
    }

    private fun cancelScheduledRecovery() {
        val runnable = recoveryRunnable ?: return
        recoveryRunnable = null
        if (::rootContainer.isInitialized) {
            rootContainer.removeCallbacks(runnable)
        }
    }

    private fun performPendingRecovery() {
        if (!pendingRecovery || isFinishing || isDestroyed || !isForeground) return
        pendingRecovery = false
        recoverWebView()
    }

    private fun hideCustomViewNow() {
        val view = customView
        val callback = customViewCallback
        customView = null
        customViewCallback = null
        if (view != null) {
            safely("hideCustomView remove") { (view.parent as? ViewGroup)?.removeView(view) }
        }
        if (callback != null) {
            safely("hideCustomView callback") { callback.onCustomViewHidden() }
        }
    }

    private fun dp(value: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).toInt()
    }

    private fun createRecoveryButton(label: String, onClick: () -> Unit): Button {
        return Button(this).apply {
            text = label
            isAllCaps = false
            textSize = 20f
            gravity = Gravity.CENTER
            minimumWidth = dp(360)
            minimumHeight = dp(56)
            setPadding(dp(24), dp(8), dp(24), dp(8))
            isClickable = true
            isFocusable = false
            isFocusableInTouchMode = false
            val normal = GradientDrawable().apply {
                setColor(0xFF1E293B.toInt())
                cornerRadius = dp(12).toFloat()
                setStroke(dp(2), 0xFF334155.toInt())
            }
            val highlighted = GradientDrawable().apply {
                setColor(BOOT_ACCENT_COLOR)
                cornerRadius = dp(12).toFloat()
                setStroke(dp(3), Color.WHITE)
            }
            background = StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_focused), highlighted)
                addState(intArrayOf(android.R.attr.state_pressed), highlighted)
                addState(intArrayOf(), normal)
            }
            setTextColor(
                ColorStateList(
                    arrayOf(
                        intArrayOf(android.R.attr.state_focused),
                        intArrayOf(android.R.attr.state_pressed),
                        intArrayOf()
                    ),
                    intArrayOf(BACKGROUND_COLOR, BACKGROUND_COLOR, BOOT_TEXT_COLOR)
                )
            )
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(12)
            }
            setOnClickListener {
                try {
                    onClick()
                } catch (t: Throwable) {
                    Log.e(TAG, "Recovery action failed", t)
                }
            }
        }
    }

    private fun setRecoveryButtonsEnabled(enabled: Boolean) {
        recoveryButtons?.visibility = if (enabled) View.VISIBLE else View.GONE
        for (button in listOfNotNull(retryButton, safeModeButton, clearCacheButton)) {
            button.isFocusable = enabled
            if (!enabled) {
                button.clearFocus()
            }
        }
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

        val retry = createRecoveryButton("נסה שוב") { retryNormalBoot() }
        val safe = createRecoveryButton("מצב בטוח (Safe Mode)") { retrySafeModeBoot() }
        val clear = createRecoveryButton("נקה מטמון והפעל מחדש") { clearCacheAndRestart() }
        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            visibility = View.GONE
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(16)
            }
            addView(retry)
            addView(safe)
            addView(clear)
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
            addView(buttons)
        }

        bootProgressBar = progress
        bootStatusText = statusTv
        recoveryButtons = buttons
        retryButton = retry
        safeModeButton = safe
        clearCacheButton = clear
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
        setRecoveryButtonsEnabled(false)
        bootProgressBar?.visibility = View.VISIBLE
        bootStatusText?.apply {
            setTextColor(BOOT_TEXT_COLOR)
            text = BOOT_STATUS_DEFAULT
        }
        overlay.isFocusable = false
        overlay.visibility = View.VISIBLE
        overlay.bringToFront()
    }

    private fun showBootOverlayError(message: String) {
        cancelBootOverlayFallback()
        cancelBootHealthyMark()
        cancelScheduledRecovery()
        isTerminalCrashState = true
        isPageLoaded = false
        try {
            val overlay = ensureBootOverlay()
            bootProgressBar?.visibility = View.GONE
            val detail = lastCrashHeadline() ?: lastJsError
            bootStatusText?.apply {
                setTextColor(BOOT_ERROR_COLOR)
                text = if (detail.isNullOrBlank()) message else "$message\n\nסיבה אחרונה: $detail"
            }
            overlay.visibility = View.VISIBLE
            overlay.bringToFront()
            setRecoveryButtonsEnabled(true)
            retryButton?.let { button ->
                button.requestFocus()
                button.post { button.requestFocus() }
            }
        } catch (t: Throwable) {
            Log.e(TAG, "Boot overlay error UI failure", t)
        }
    }

    private fun retryNormalBoot() {
        resetCrashGuard()
        safeModeActive = false
        pendingRecovery = false
        recoverWebView()
    }

    private fun retrySafeModeBoot() {
        resetCrashGuard()
        safeModeActive = true
        pendingRecovery = false
        recoverWebView()
    }

    private fun clearCacheAndRestart() {
        val existing = webView
        safely("clear cache") {
            if (existing != null) {
                existing.clearCache(true)
                existing.clearHistory()
            } else {
                val temp = WebView(this)
                try {
                    temp.clearCache(true)
                    temp.clearHistory()
                } finally {
                    temp.destroy()
                }
            }
        }
        safely("clear web storage") { WebStorage.getInstance().deleteAllData() }
        safely("clear cookies") {
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
        }
        resetCrashGuard()
        safeModeActive = false
        pendingRecovery = false
        recoverWebView()
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
        if (isTerminalCrashState || pendingRecovery || webView == null) return
        cancelBootOverlayFallback()
        val overlay = bootOverlay
        if (overlay != null && overlay.visibility != View.GONE) {
            overlay.visibility = View.GONE
            Log.i(TAG, "Boot overlay hidden")
        }
        scheduleBootHealthyMark()
    }

    private fun handleStaticAssetRequest(rawPath: String, method: String): WebResourceResponse {
        val assetPath = normalizeAssetPath(rawPath)
            ?: return emptyStaticNotFoundResponse()

        val fullAssetPath = "www/$assetPath"
        val stream = try {
            applicationContext.assets.open(fullAssetPath)
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
        val headers = LinkedHashMap<String, String>(2).apply {
            put("Access-Control-Allow-Origin", "*")
            put("Cache-Control", "no-cache")
        }
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
        val parsedTarget: URL = try {
            URL(targetUrlRaw)
        } catch (_: MalformedURLException) {
            return proxyErrorResponse(400, "Bad Request")
        }
        val targetProtocol = parsedTarget.protocol?.lowercase(Locale.US)
        if ((targetProtocol != "http" && targetProtocol != "https") ||
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

        var currentUrl: URL = parsedTarget
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
                    candidate.setRequestProperty("Accept-Encoding", "identity")
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
            if (statusCode !in 100..599) {
                activeConn.disconnect()
                return proxyErrorResponse(502, "Bad Gateway")
            }
            if (statusCode in 300..399) {
                val (redirectMime, redirectEncoding) = parseContentType(activeConn.contentType)
                activeConn.disconnect()
                return if (statusCode == HttpURLConnection.HTTP_NOT_MODIFIED) {
                    WebResourceResponse(
                        redirectMime,
                        redirectEncoding,
                        200,
                        "OK",
                        mapOf(
                            "Access-Control-Allow-Origin" to "*",
                            "Access-Control-Allow-Methods" to "GET, HEAD, OPTIONS",
                            "Access-Control-Allow-Headers" to "*",
                            "Cache-Control" to "no-store",
                            "Content-Length" to "0"
                        ),
                        ByteArrayInputStream(ByteArray(0))
                    )
                } else {
                    proxyErrorResponse(502, "Bad Gateway")
                }
            }

            val reasonPhrase = sanitizeReasonPhrase(activeConn.responseMessage, statusCode)

            val (mimeType, encoding) = parseContentType(activeConn.contentType)
            val contentLength = activeConn.contentLengthLong
            val responseHeaders = LinkedHashMap<String, String>(6).apply {
                put("Access-Control-Allow-Origin", "*")
                put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
                put("Access-Control-Allow-Headers", "*")
                put("Cache-Control", "no-store")
            }

            val responseStream: InputStream = if (
                currentMethod == "HEAD" ||
                statusCode == HttpURLConnection.HTTP_NO_CONTENT
            ) {
                if (currentMethod == "HEAD" &&
                    statusCode != HttpURLConnection.HTTP_NO_CONTENT &&
                    contentLength > 0L &&
                    activeConn.contentEncoding.isNullOrBlank()
                ) {
                    responseHeaders["Content-Length"] = contentLength.toString()
                }
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
                    if (contentLength > 0L && activeConn.contentEncoding.isNullOrBlank()) {
                        responseHeaders["Content-Length"] = contentLength.toString()
                    }
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

    private fun sanitizeReasonPhrase(raw: String?, statusCode: Int): String {
        val cleaned = raw
            ?.let { input ->
                val sb = StringBuilder(input.length)
                for (ch in input) {
                    if (ch.code in 0x20..0x7E) {
                        sb.append(ch)
                    } else if (ch == '\r' || ch == '\n' || ch == '\t') {
                        sb.append(' ')
                    }
                }
                sb.toString().trim()
            }
            ?.takeIf { it.isNotEmpty() }
        return cleaned ?: defaultReasonPhrase(statusCode)
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
            sanitizeReasonPhrase(reasonPhrase, statusCode),
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
        isForeground = true
        applyImmersiveFullscreen()
        if (pendingRecovery && !isTerminalCrashState) {
            pendingRecovery = false
            showBootOverlayLoading()
            recoverWebView()
            return
        }
        if (isTerminalCrashState) {
            retryButton?.requestFocus()
            return
        }
        webView?.let { wv ->
            try {
                wv.onResume()
                wv.resumeTimers()
                if (!isWebInputFocused) {
                    wv.requestFocus()
                }
                Unit
            } catch (t: Throwable) {
                Log.w(TAG, "onResume notice", t)
            }
        }
    }

    override fun onPause() {
        isForeground = false
        cancelScheduledRecovery()
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
            if (isTerminalCrashState) {
                if (retryButton?.hasFocus() != true &&
                    safeModeButton?.hasFocus() != true &&
                    clearCacheButton?.hasFocus() != true
                ) {
                    retryButton?.requestFocus()
                }
                return
            }
            val wv = webView
            if (wv != null && !isWebInputFocused) {
                wv.requestFocus()
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (customView != null) {
            hideCustomViewNow()
            return
        }
        if (isPageLoaded && webView != null && !isTerminalCrashState) {
            handleAndroidBackKeyDown()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    private fun destroyWebView(rendererGone: Boolean = false) {
        cancelBootOverlayFallback()
        cancelBootHealthyMark()
        hideCustomViewNow()
        val wv = webView ?: return
        webView = null
        if (!rendererGone) {
            safely("destroyWebView stopLoading") { wv.stopLoading() }
            safely("destroyWebView loadBlank") { wv.loadUrl("about:blank") }
            safely("destroyWebView onPause") { wv.onPause() }
        }
        safely("destroyWebView clearChromeClient") { wv.webChromeClient = null }
        safely("destroyWebView clearViewClient") { wv.webViewClient = DetachedWebViewClient() }
        safely("destroyWebView removeJsInterface") { wv.removeJavascriptInterface("AndroidTvHost") }
        safely("destroyWebView removeFromParent") { (wv.parent as? ViewGroup)?.removeView(wv) }
        if (!rendererGone) {
            safely("destroyWebView removeAllViews") { wv.removeAllViews() }
        }
        safely("destroyWebView destroy") { wv.destroy() }
    }

    override fun onDestroy() {
        cancelBootOverlayFallback()
        cancelBootHealthyMark()
        cancelScheduledRecovery()
        destroyWebView()
        super.onDestroy()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_VOICE_COMMAND) return
        safely("onActivityResult voice") {
            val text = if (resultCode == Activity.RESULT_OK && data != null) {
                data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                    ?.firstOrNull()
                    ?.trim()
                    ?.takeIf { it.isNotEmpty() }
            } else {
                null
            }
            if (text != null) {
                evaluateWebJs(
                    "window.app && window.app.handleVoiceCommand && window.app.handleVoiceCommand(" +
                        JSONObject.quote(text) +
                        ")"
                )
            } else {
                notifyNativeVoiceError("cancelled")
            }
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (customView != null && event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_DOWN) {
                return true
            }
            if (event.action == KeyEvent.ACTION_UP && !event.isCanceled) {
                hideCustomViewNow()
                return true
            }
            return true
        }

        val wv = webView
        if (wv == null || !isPageLoaded || isTerminalCrashState) {
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

        if (!isWebInputFocused &&
            (androidKeyCode == KeyEvent.KEYCODE_SEARCH ||
                androidKeyCode == KeyEvent.KEYCODE_VOICE_ASSIST)
        ) {
            if (isDown && !isRepeat) {
                suppressNextKeyUpKeyCode = androidKeyCode
                evaluateWebJs(
                    "window.app && window.app.startVoiceCommand && window.app.startVoiceCommand()"
                )
            }
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
            if (isScreenSleepMode) {
                window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                window.addFlags(
                    WindowManager.LayoutParams.FLAG_FULLSCREEN
                        or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                )
            }
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
        private const val SAFE_MODE_STARTUP_CRASH_THRESHOLD = 2
        private const val SAFE_MODE_RENDER_CRASH_THRESHOLD = 2
        private const val RENDER_CRASH_WINDOW_MS = 120_000L
        private const val RECOVERY_DELAY_MS = 450L
        private const val BOOT_FALLBACK_DELAY_MS = 1200L
        private const val BOOT_HEALTHY_DELAY_MS = 8000L
        private const val BOOT_STATUS_DEFAULT = "IPTV Live • טוען שידורים..."
        private const val BACKGROUND_COLOR = 0xFF070B14.toInt()
        private const val BOOT_ACCENT_COLOR = 0xFF38BDF8.toInt()
        private const val BOOT_TEXT_COLOR = 0xFFE2E8F0.toInt()
        private const val BOOT_ERROR_COLOR = 0xFFFCA5A5.toInt()
        private const val WEB_KEY_ENTER = 13
        private const val WEB_KEY_BACK = 461
        private const val REQ_VOICE_COMMAND = 4091
        private const val CRASH_PREFS = "iptv_android_crash_guard"
        private const val KEY_STARTUP_STREAK = "consecutive_startup_crashes"
        private const val KEY_BOOT_PENDING = "boot_pending"
        private const val KEY_FATAL_COUNTED = "fatal_counted"
        private const val KEY_LAST_CRASH = "last_crash_summary"
        private const val KEY_LAST_CRASH_KIND = "last_crash_kind"
        private const val KEY_LAST_CRASH_TIME = "last_crash_timestamp_ms"
        private const val EXTRA_SAFE_MODE = "safe_mode"
        private val ALLOWED_SCHEMES = setOf("file", "http", "https", "data", "blob")
        private val PROXY_REDIRECT_CODES = setOf(301, 302, 303, 307, 308)

        @Volatile
        private var crashHandlerInstalled = false

        private fun buildCrashSummary(thread: Thread, throwable: Throwable): String {
            return try {
                val sw = StringWriter(512)
                val pw = PrintWriter(sw)
                throwable.printStackTrace(pw)
                pw.flush()
                val trace = sw.toString()
                    .lineSequence()
                    .take(12)
                    .joinToString("\n")
                "[${thread.name}] ${throwable.javaClass.name}: ${throwable.message.orEmpty()}\n$trace"
                    .take(1600)
            } catch (_: Throwable) {
                "[${thread.name}] ${throwable.javaClass.name}"
            }
        }

        private fun persistCrashReport(
            context: Context,
            kind: String,
            summary: String,
            fatal: Boolean
        ) {
            try {
                val prefs = context.getSharedPreferences(CRASH_PREFS, Context.MODE_PRIVATE)
                val editor = prefs.edit()
                    .putString(KEY_LAST_CRASH_KIND, kind)
                    .putString(KEY_LAST_CRASH, summary.take(1600))
                    .putLong(KEY_LAST_CRASH_TIME, System.currentTimeMillis())
                if (fatal) {
                    val nextStreak = prefs.getInt(KEY_STARTUP_STREAK, 0) + 1
                    editor.putInt(KEY_STARTUP_STREAK, nextStreak)
                    editor.putBoolean(KEY_BOOT_PENDING, true)
                    editor.putBoolean(KEY_FATAL_COUNTED, true)
                }
                editor.commit()
            } catch (t: Throwable) {
                Log.w(TAG, "persistCrashReport notice", t)
            }
        }

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
