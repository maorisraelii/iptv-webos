package com.iptv.webosinstaller

import android.content.Context
import android.net.wifi.WifiManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket
import java.net.URL

data class DiscoveredTv(
    val ip: String,
    val name: String
)

object TvDiscovery {

    suspend fun discoverTvs(context: Context): List<DiscoveredTv> = withContext(Dispatchers.IO) {
        val found = linkedMapOf<String, DiscoveredTv>()

        // 1. SSDP UDP Multicast discovery
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val lock = wifi?.createMulticastLock("iptv_ssdp_lock")
        try {
            lock?.setReferenceCounted(true)
            lock?.acquire()
            ssdpSearch(found)
        } catch (_: Exception) {
        } finally {
            try {
                if (lock?.isHeld == true) lock.release()
            } catch (_: Exception) {
            }
        }

        // 2. Fallback fast /24 TCP port-3000 scan if SSDP didn't find anything (e.g. AP isolation / multicast drop)
        if (found.isEmpty()) {
            val localIp = getLocalIpv4Address()
            if (localIp != null) {
                val prefix = localIp.substringBeforeLast('.')
                coroutineScope {
                    val jobs = (1..254).map { host ->
                        async(Dispatchers.IO) {
                            val candidate = "$prefix.$host"
                            if (candidate != localIp && isPortOpen(candidate, 3000, 280)) {
                                found.putIfAbsent(candidate, DiscoveredTv(candidate, "LG webOS TV ($candidate)"))
                            }
                        }
                    }
                    jobs.awaitAll()
                }
            }
        }

        found.values.toList()
    }

    private fun ssdpSearch(found: MutableMap<String, DiscoveredTv>) {
        val targets = listOf(
            "urn:lge-com:service:webos-second-screen:1",
            "ssdp:all"
        )
        DatagramSocket().use { socket ->
            socket.soTimeout = 1600
            val group = InetAddress.getByName("239.255.255.250")
            for (st in targets) {
                val query = "M-SEARCH * HTTP/1.1\r\n" +
                    "HOST: 239.255.255.250:1900\r\n" +
                    "MAN: \"ssdp:discover\"\r\n" +
                    "MX: 2\r\n" +
                    "ST: $st\r\n\r\n"
                val bytes = query.toByteArray(Charsets.UTF_8)
                socket.send(DatagramPacket(bytes, bytes.size, group, 1900))
            }

            val buf = ByteArray(4096)
            val deadline = System.currentTimeMillis() + 2200
            while (System.currentTimeMillis() < deadline) {
                try {
                    val pkt = DatagramPacket(buf, buf.size)
                    socket.receive(pkt)
                    val resp = String(pkt.data, 0, pkt.length, Charsets.UTF_8)
                    val ip = pkt.address?.hostAddress ?: continue
                    val lower = resp.lowercase()
                    if (lower.contains("webos") || lower.contains("lge") || lower.contains("lg ")) {
                        val location = Regex("(?im)^location:\\s*(.+)$").find(resp)?.groupValues?.get(1)?.trim()
                        val friendlyName = if (location != null) fetchFriendlyName(location) else null
                        found[ip] = DiscoveredTv(ip, friendlyName ?: "LG webOS TV ($ip)")
                    }
                } catch (_: Exception) {
                    break
                }
            }
        }
    }

    private fun fetchFriendlyName(locationUrl: String): String? {
        return try {
            val conn = URL(locationUrl).openConnection().apply {
                connectTimeout = 900
                readTimeout = 900
            }
            val xml = conn.getInputStream().bufferedReader().use { it.readText() }
            Regex("<friendlyName>(.*?)</friendlyName>", RegexOption.IGNORE_CASE)
                .find(xml)?.groupValues?.get(1)?.trim()
        } catch (_: Exception) {
            null
        }
    }

    private fun isPortOpen(ip: String, port: Int, timeoutMs: Int): Boolean {
        return try {
            Socket().use { s ->
                s.connect(InetSocketAddress(ip, port), timeoutMs)
                true
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun getLocalIpv4Address(): String? {
        return try {
            val interfaces = NetworkInterface.getNetworkInterfaces() ?: return null
            for (intf in interfaces) {
                if (!intf.isUp || intf.isLoopback) continue
                val addrs = intf.inetAddresses
                while (addrs.hasMoreElements()) {
                    val addr = addrs.nextElement()
                    if (addr is Inet4Address && !addr.isLoopbackAddress && addr.isSiteLocalAddress) {
                        return addr.hostAddress
                    }
                }
            }
            null
        } catch (_: Exception) {
            null
        }
    }
}
