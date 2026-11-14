package com.iptv.webosinstaller

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var btnDiscover: MaterialButton
    private lateinit var btnCheckDevMode: MaterialButton
    private lateinit var btnCreateAccount: MaterialButton
    private lateinit var btnInstall: MaterialButton
    private lateinit var etTvIp: TextInputEditText
    private lateinit var etPassphrase: TextInputEditText
    private lateinit var tvListContainer: LinearLayout
    private lateinit var tvStatus: TextView

    private lateinit var ssapClient: SsapClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        ssapClient = SsapClient(this)

        btnDiscover = findViewById(R.id.btnDiscover)
        btnCheckDevMode = findViewById(R.id.btnCheckDevMode)
        btnCreateAccount = findViewById(R.id.btnCreateAccount)
        btnInstall = findViewById(R.id.btnInstall)
        etTvIp = findViewById(R.id.etTvIp)
        etPassphrase = findViewById(R.id.etPassphrase)
        tvListContainer = findViewById(R.id.tvListContainer)
        tvStatus = findViewById(R.id.tvStatus)

        btnDiscover.setOnClickListener {
            runDiscovery()
        }

        btnCheckDevMode.setOnClickListener {
            val ip = etTvIp.text?.toString()?.trim().orEmpty()
            if (ip.isEmpty()) {
                setStatus("נא לבחור או להזין כתובת IP של הטלוויזיה קודם.")
                return@setOnClickListener
            }
            checkDevModeOnTv(ip)
        }

        btnCreateAccount.setOnClickListener {
            val intent = Intent(
                Intent.ACTION_VIEW,
                Uri.parse("https://webostv.developer.lge.com/develop/getting-started/developer-mode-app")
            )
            startActivity(intent)
        }

        btnInstall.setOnClickListener {
            val ip = etTvIp.text?.toString()?.trim().orEmpty()
            val pass = etPassphrase.text?.toString()?.trim().orEmpty()
            if (ip.isEmpty()) {
                setStatus("נא להזין כתובת IP של הטלוויזיה.")
                return@setOnClickListener
            }
            if (pass.isEmpty()) {
                setStatus("נא להזין את ה-Passphrase (6 תווים מאפליקציית Developer Mode בטלוויזיה).")
                return@setOnClickListener
            }
            installApp(ip, pass)
        }
    }

    private fun runDiscovery() {
        setBusy(true)
        tvListContainer.removeAllViews()
        setStatus("מחפש טלוויזיות LG ברשת ה-Wi-Fi...")

        lifecycleScope.launch {
            val tvs = TvDiscovery.discoverTvs(this@MainActivity)
            setBusy(false)
            if (tvs.isEmpty()) {
                setStatus("לא נמצאו טלוויזיות אוטומטית. ודא שהטלפון והטלוויזיה על אותו Wi-Fi, או הזן IP ידנית.")
                return@launch
            }

            setStatus("נמצאו ${tvs.size} טלוויזיות! נבחר: ${tvs.first().name}")
            etTvIp.setText(tvs.first().ip)

            for (tv in tvs) {
                val btn = MaterialButton(this@MainActivity).apply {
                    text = "${tv.name} — ${tv.ip}"
                    setOnClickListener {
                        etTvIp.setText(tv.ip)
                        setStatus("נבחרה טלוויזיה: ${tv.name} (${tv.ip})")
                    }
                }
                tvListContainer.addView(btn)
            }
        }
    }

    private fun checkDevModeOnTv(ip: String) {
        setBusy(true)
        setStatus("מתחבר לטלוויזיה $ip...")

        lifecycleScope.launch {
            val result = ssapClient.connectAndCheckDevMode(ip) { msg ->
                runOnUiThread { setStatus(msg) }
            }
            setBusy(false)
            setStatus(result.message)
        }
    }

    private fun installApp(ip: String, pass: String) {
        setBusy(true)
        setStatus("מתחיל התקנה לטלוויזיה $ip...")

        lifecycleScope.launch {
            val res = WebosSshInstaller.installToTv(cacheDir, ip, pass) { progress ->
                runOnUiThread { setStatus(progress) }
            }
            setBusy(false)
            res.onSuccess { msg ->
                setStatus("✅ $msg")
            }.onFailure { err ->
                setStatus("❌ ${err.message}")
            }
        }
    }

    private fun setBusy(busy: Boolean) {
        btnDiscover.isEnabled = !busy
        btnCheckDevMode.isEnabled = !busy
        btnInstall.isEnabled = !busy
    }

    private fun setStatus(msg: String) {
        tvStatus.text = msg
    }
}
