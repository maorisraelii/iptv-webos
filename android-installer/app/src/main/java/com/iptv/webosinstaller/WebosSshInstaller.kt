package com.iptv.webosinstaller

import com.jcraft.jsch.ChannelExec
import com.jcraft.jsch.ChannelSftp
import com.jcraft.jsch.JSch
import com.jcraft.jsch.Session
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayInputStream
import java.io.File
import java.util.Properties
import java.util.concurrent.TimeUnit

object WebosSshInstaller {

    private const val LATEST_IPK_URL =
        "https://github.com/maorisraelii/iptv-webos/releases/latest/download/IPTV-Live-webOS.ipk"

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    suspend fun installToTv(
        cacheDir: File,
        tvIp: String,
        passphrase: String,
        onProgress: (String) -> Unit
    ): Result<String> = withContext(Dispatchers.IO) {
        var session: Session? = null
        try {
            onProgress("מוריד מפתח SSH מהטלוויזיה (port 9991)...")
            val keyBytes = downloadBytes("http://$tvIp:9991/webos_rsa")
                ?: return@withContext Result.failure(
                    IllegalStateException("לא ניתן להוריד מפתח מהטלוויזיה. ודא ש-Key Server דלוק באפליקציית Developer Mode.")
                )

            onProgress("מוריד את הגרסה העדכנית ביותר של IPTV Live TV מ-GitHub...")
            val ipkFile = File(cacheDir, "IPTV-Live-webOS.ipk")
            val ipkBytes = downloadBytes(LATEST_IPK_URL)
                ?: return@withContext Result.failure(
                    IllegalStateException("הורדת קובץ ה-IPK מ-GitHub נכשלה. בדוק חיבור לאינטרנט.")
                )
            ipkFile.writeBytes(ipkBytes)

            onProgress("מתחבר לטלוויזיה ב-SSH (port 9922)...")
            val jsch = JSch()
            jsch.addIdentity("webos_rsa", keyBytes, null, passphrase.toByteArray(Charsets.UTF_8))

            session = jsch.getSession("prisoner", tvIp, 9922).apply {
                setConfig(Properties().apply {
                    put("StrictHostKeyChecking", "no")
                    put("PreferredAuthentications", "publickey")
                })
                timeout = 15_000
                connect(15_000)
            }

            onProgress("מעלה את האפליקציה לטלוויזיה...")
            val remotePath = "/media/developer/temp/IPTV-Live-webOS.ipk"
            val sftp = session.openChannel("sftp") as ChannelSftp
            sftp.connect(10_000)
            try {
                try {
                    sftp.mkdir("/media/developer/temp")
                } catch (_: Exception) {
                }
                ByteArrayInputStream(ipkBytes).use { input ->
                    sftp.put(input, remotePath, ChannelSftp.OVERWRITE)
                }
            } finally {
                sftp.disconnect()
            }

            onProgress("מתקין את IPTV Live TV על הטלוויזיה...")
            val installCmd =
                """luna-send -i -f luna://com.webos.appInstallService/dev/install '{"id":"com.iptv.livetv","ipkUrl":"$remotePath","subscribe":true}'"""
            val installOut = execInstallAndWait(session, installCmd)
            if (!installOut.contains("\"installed\"", ignoreCase = true) &&
                installOut.contains("errorCode", ignoreCase = true)
            ) {
                return@withContext Result.failure(
                    IllegalStateException("ההתקנה נכשלה בטלוויזיה: $installOut")
                )
            }

            onProgress("מפעיל את האפליקציה על מסך הטלוויזיה...")
            execSimple(
                session,
                """luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"com.iptv.livetv"}'"""
            )

            Result.success("האפליקציה הותקנה והופעלה בהצלחה על הטלוויזיה!")
        } catch (e: Exception) {
            val msg = e.message ?: "שגיאה לא ידועה"
            val friendly = when {
                msg.contains("USERAUTH", true) || msg.contains("Auth fail", true) || msg.contains("decrypt", true) ->
                    "ה-Passphrase שגוי או שהמפתח לא תואם. בדוק את 6 התווים ב-Developer Mode."
                msg.contains("Connection refused", true) ->
                    "החיבור נדחה (port 9922). ודא ש-Dev Mode Status דלוק בטלוויזיה."
                else -> msg
            }
            Result.failure(IllegalStateException(friendly, e))
        } finally {
            try {
                session?.disconnect()
            } catch (_: Exception) {
            }
        }
    }

    private fun downloadBytes(url: String): ByteArray? {
        return try {
            val req = Request.Builder().url(url).build()
            http.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return null
                resp.body?.bytes()
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun execInstallAndWait(session: Session, command: String): String {
        val channel = session.openChannel("exec") as ChannelExec
        channel.setCommand(command)
        channel.inputStream = null
        val reader = channel.inputStream.bufferedReader()
        channel.connect(10_000)
        val sb = StringBuilder()
        try {
            val deadline = System.currentTimeMillis() + 45_000
            while (System.currentTimeMillis() < deadline) {
                if (reader.ready()) {
                    val line = reader.readLine() ?: break
                    sb.append(line).append('\n')
                    if (line.contains("\"installed\"") || line.contains("\"install failed\"") || line.contains("errorCode")) {
                        break
                    }
                } else if (channel.isClosed) {
                    break
                } else {
                    Thread.sleep(200)
                }
            }
        } finally {
            channel.disconnect()
        }
        return sb.toString()
    }

    private fun execSimple(session: Session, command: String): String {
        val channel = session.openChannel("exec") as ChannelExec
        channel.setCommand(command)
        val reader = channel.inputStream.bufferedReader()
        channel.connect(10_000)
        return try {
            reader.readText()
        } finally {
            channel.disconnect()
        }
    }
}
