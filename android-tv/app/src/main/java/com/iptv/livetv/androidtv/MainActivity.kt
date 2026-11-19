package com.iptv.livetv.androidtv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import org.json.JSONObject

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
    }

    private lateinit var rootContainer: FrameLayout
    private var webView: WebView? = null

    @Volatile
    private var isWebInputFocused: Boolean = false

    @Volatile
    private var isPageLoaded: Boolean = false

    private var suppressNextKeyUpKeyCode: Int = -1
    private var renderRecoveryCount: Int = 0

    private val defaultVideoPoster: Bitmap by lazy {
        Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888).apply {
            eraseColor(Color.TRANSPARENT)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        try {
            window.setBackgroundDrawable(ColorDrawable(BACKGROUND_COLOR))
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
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

        initWebView()
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun initWebView() {
        try {
            isPageLoaded = false
            val wv = WebView(this).apply {
                layoutParams = FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
                setBackgroundColor(BACKGROUND_COLOR)
                // Keep default LAYER_TYPE_NONE so window hardware acceleration handles video/MSE
                // safely on all Android TV GPU drivers (avoids GL_OUT_OF_MEMORY / Mali/Amlogic crashes).
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
                        val scheme = request?.url?.scheme?.lowercase() ?: return false
                        return scheme !in ALLOWED_SCHEMES
                    }

                    override fun onPageFinished(view: WebView?, url: String?) {
                        super.onPageFinished(view, url)
                        isPageLoaded = true
                        installWebKeyBridge()
                        requestFocus()
                    }

                    override fun onRenderProcessGone(
                        view: WebView?,
                        detail: RenderProcessGoneDetail?
                    ): Boolean {
                        Log.e(TAG, "WebView render process gone — recovering safely")
                        isPageLoaded = false
                        if (renderRecoveryCount < 3) {
                            renderRecoveryCount++
                            view?.post { recoverWebView() }
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
            wv.requestFocus()
            wv.loadUrl(ENTRY_URL)
        } catch (t: Throwable) {
            Log.e(TAG, "WebView initialization failed", t)
            showFallbackMessage("Android System WebView is unavailable or updating on this TV.")
        }
    }

    private fun recoverWebView() {
        destroyWebView()
        initWebView()
    }

    private fun showFallbackMessage(message: String) {
        try {
            rootContainer.removeAllViews()
            val tv = TextView(this).apply {
                text = message
                setTextColor(Color.WHITE)
                textSize = 20f
                gravity = Gravity.CENTER
                setPadding(48, 48, 48, 48)
            }
            rootContainer.addView(
                tv,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            )
        } catch (t: Throwable) {
            Log.e(TAG, "Fallback UI error", t)
        }
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
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                window.setDecorFitsSystemWindows(false)
                window.insetsController?.let { controller ->
                    controller.systemBarsBehavior =
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    controller.hide(WindowInsets.Type.systemBars())
                }
            } else {
                window.decorView.systemUiVisibility = (
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_FULLSCREEN
                    )
            }
        } catch (t: Throwable) {
            Log.w(TAG, "applyImmersiveFullscreen notice", t)
        }
    }

    companion object {
        private const val TAG = "IPTVAndroidTV"
        private const val ENTRY_URL = "file:///android_asset/www/index.html"
        private const val BACKGROUND_COLOR = 0xFF070B14.toInt()
        private const val WEB_KEY_ENTER = 13
        private const val WEB_KEY_BACK = 461
        private val ALLOWED_SCHEMES = setOf("file", "http", "https", "data", "blob")

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
