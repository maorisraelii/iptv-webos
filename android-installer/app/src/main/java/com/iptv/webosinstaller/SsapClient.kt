package com.iptv.webosinstaller

import android.content.Context
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

data class DevModeCheckResult(
    val paired: Boolean,
    val devModeInstalled: Boolean,
    val message: String
)

class SsapClient(private val context: Context) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private val prefs = context.getSharedPreferences("lg_ssap_keys", Context.MODE_PRIVATE)

    suspend fun connectAndCheckDevMode(
        ip: String,
        onStatus: (String) -> Unit
    ): DevModeCheckResult {
        val savedKey = prefs.getString("key_$ip", null)
        val reqIdGen = AtomicInteger(1)
        val pending = ConcurrentHashMap<String, CompletableDeferred<JSONObject>>()
        val registerDeferred = CompletableDeferred<Boolean>()
        var wsRef: WebSocket? = null

        val request = Request.Builder().url("ws://$ip:3000").build()
        val ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                wsRef = webSocket
                onStatus("ממתין לאישור על מסך הטלוויזיה (לחץ 'אישור' בשלט)...")
                val manifest = JSONObject().apply {
                    put("manifestVersion", 1)
                    put("permissions", JSONArray(listOf("LAUNCH", "READ_INSTALLED_APPS")))
                }
                val payload = JSONObject().apply {
                    put("forcePairing", false)
                    put("pairingType", "PROMPT")
                    if (!savedKey.isNullOrBlank()) {
                        put("client-key", savedKey)
                    }
                    put("manifest", manifest)
                }
                val regMsg = JSONObject().apply {
                    put("type", "register")
                    put("id", "reg_0")
                    put("payload", payload)
                }
                webSocket.send(regMsg.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    val type = json.optString("type")
                    val id = json.optString("id")
                    if (id == "reg_0") {
                        when (type) {
                            "registered" -> {
                                val key = json.optJSONObject("payload")?.optString("client-key")
                                if (!key.isNullOrBlank()) {
                                    prefs.edit().putString("key_$ip", key).apply()
                                }
                                registerDeferred.complete(true)
                            }
                            "error" -> {
                                registerDeferred.complete(false)
                            }
                        }
                    } else if (id.isNotBlank()) {
                        pending.remove(id)?.complete(json)
                    }
                } catch (_: Exception) {
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (!registerDeferred.isCompleted) {
                    registerDeferred.complete(false)
                }
                pending.values.forEach { it.completeExceptionally(t) }
                pending.clear()
            }
        })

        return try {
            val paired = withTimeout(35_000) { registerDeferred.await() }
            if (!paired) {
                ws.close(1000, "pair_failed")
                return DevModeCheckResult(false, false, "החיבור נדחה או שפג הזמן לאישור בטלוויזיה.")
            }

            // Query installed apps to check if Developer Mode (com.palmdts.devmode) is installed
            val listId = "req_${reqIdGen.incrementAndGet()}"
            val listDef = CompletableDeferred<JSONObject>()
            pending[listId] = listDef
            wsRef?.send(JSONObject().apply {
                put("type", "request")
                put("id", listId)
                put("uri", "ssap://com.webos.applicationManager/listLaunchPoints")
            }.toString())

            val appsResp = withTimeout(8_000) { listDef.await() }
            val launchPoints = appsResp.optJSONObject("payload")?.optJSONArray("launchPoints") ?: JSONArray()
            var hasDevMode = false
            for (i in 0 until launchPoints.length()) {
                val appId = launchPoints.optJSONObject(i)?.optString("id") ?: ""
                if (appId == "com.palmdts.devmode") {
                    hasDevMode = true
                    break
                }
            }

            // Launch Developer Mode if installed, or LG Store search for Developer Mode if missing
            val launchId = "req_${reqIdGen.incrementAndGet()}"
            val launchDef = CompletableDeferred<JSONObject>()
            pending[launchId] = launchDef
            val launchPayload = if (hasDevMode) {
                JSONObject().apply { put("id", "com.palmdts.devmode") }
            } else {
                JSONObject().apply {
                    put("id", "com.webos.app.discovery")
                    put("params", JSONObject().apply {
                        put("query", "Developer Mode")
                    })
                }
            }
            wsRef?.send(JSONObject().apply {
                put("type", "request")
                put("id", launchId)
                put("uri", "ssap://system.launcher/launch")
                put("payload", launchPayload)
            }.toString())
            withTimeout(6_000) { launchDef.await() }

            ws.close(1000, "done")
            if (hasDevMode) {
                DevModeCheckResult(true, true, "Developer Mode כבר מותקנת ונפתחה על מסך הטלוויזיה!")
            } else {
                DevModeCheckResult(true, false, "Developer Mode לא נמצאה — נפתחה חנות LG בטלוויזיה כדי שתלחץ 'התקן'.")
            }
        } catch (e: Exception) {
            ws.close(1000, "error")
            DevModeCheckResult(false, false, "שגיאה בחיבור לטלוויזיה ($ip): ${e.message ?: "בדוק שהטלוויזיה דלוקה ובאותו Wi-Fi"}")
        }
    }
}
