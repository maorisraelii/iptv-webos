package com.iptv.webosinstaller

import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.widget.doAfterTextChanged
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.android.material.card.MaterialCardView
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.textfield.TextInputEditText
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private enum class StepState { PENDING, ACTIVE, WARNING, DONE, ERROR }
    private enum class StatusTone { INFO, BUSY, SUCCESS, WARNING, ERROR }
    private enum class RetryAction { NONE, DISCOVER, CHECK_DEV_MODE, CHECK_KEY_SERVER, INSTALL }

    private lateinit var mainScrollView: ScrollView
    private lateinit var btnDiscover: MaterialButton
    private lateinit var btnCheckDevMode: MaterialButton
    private lateinit var btnCreateAccount: MaterialButton
    private lateinit var btnCheckKeyServer: MaterialButton
    private lateinit var btnKeyServerHelp: MaterialButton
    private lateinit var btnInstall: MaterialButton
    private lateinit var btnExtendDevMode: MaterialButton
    private lateinit var btnQuickRetry: MaterialButton
    private lateinit var btnStatusHelp: MaterialButton
    private lateinit var etTvIp: TextInputEditText
    private lateinit var etPassphrase: TextInputEditText
    private lateinit var tvListContainer: LinearLayout
    private lateinit var tvStatus: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var cardStatus: MaterialCardView

    // Stepper & card progress views
    private lateinit var tvStepper1Circle: TextView
    private lateinit var tvStepper1Label: TextView
    private lateinit var tvStepper2Circle: TextView
    private lateinit var tvStepper2Label: TextView
    private lateinit var tvStepper3Circle: TextView
    private lateinit var tvStepper3Label: TextView
    private lateinit var stepperLine12: View
    private lateinit var stepperLine23: View

    private lateinit var cardStep1: MaterialCardView
    private lateinit var cardStep2: MaterialCardView
    private lateinit var cardStep3: MaterialCardView
    private lateinit var tvStep1Badge: TextView
    private lateinit var tvStep2Badge: TextView
    private lateinit var tvStep3Badge: TextView
    private lateinit var tvStep1Pill: TextView
    private lateinit var tvStep2Pill: TextView
    private lateinit var tvStep3Pill: TextView

    private lateinit var ssapClient: SsapClient
    private var currentRetryAction: RetryAction = RetryAction.NONE
    private val discoveredButtons = mutableListOf<Pair<String, MaterialButton>>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        ssapClient = SsapClient(this)
        val prefs = getSharedPreferences("installer_prefs", MODE_PRIVATE)

        bindViews()

        val savedIp = prefs.getString("last_ip", null)?.trim().orEmpty()
        val savedPass = prefs.getString("last_pass", null)?.trim().orEmpty()
        if (savedIp.isNotEmpty()) etTvIp.setText(savedIp)
        if (savedPass.isNotEmpty()) etPassphrase.setText(savedPass)

        if (savedIp.isNotEmpty()) {
            updateStepUi(1, StepState.DONE, "IP שמור ✓")
            updateStepUi(2, StepState.ACTIVE, "מוכן לבדיקה")
            updateStepUi(3, if (savedPass.length == 6) StepState.ACTIVE else StepState.PENDING, if (savedPass.length == 6) "מוכן" else "ממתין")
            setStatus("נטענה כתובת IP שמורה ($savedIp). תוכל להמשיך לשלב 2 או להתקין ישירות בשלב 3.", StatusTone.INFO)
        } else {
            updateStepUi(1, StepState.ACTIVE, "התחל כאן")
            updateStepUi(2, StepState.PENDING, "ממתין")
            updateStepUi(3, StepState.PENDING, "ממתין")
            setStatus("מוכן. התחל בשלב 1 למציאת הטלוויזיה.", StatusTone.INFO)
        }

        etTvIp.doAfterTextChanged { text ->
            val ip = text?.toString()?.trim().orEmpty()
            if (ip.isEmpty()) {
                updateStepUi(1, StepState.ACTIVE, "התחל כאן")
            } else if (ip.count { it == '.' } == 3) {
                updateStepUi(1, StepState.DONE, "IP הוזן ✓")
            }
        }

        btnDiscover.setOnClickListener { runDiscovery() }

        btnCheckDevMode.setOnClickListener {
            val ip = etTvIp.text?.toString()?.trim().orEmpty()
            if (ip.isEmpty()) {
                updateStepUi(1, StepState.WARNING, "חסר IP")
                setStatus(
                    "נא לבחור או להזין כתובת IP של הטלוויזיה בשלב 1 קודם.",
                    StatusTone.WARNING,
                    RetryAction.DISCOVER
                )
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

        btnCheckKeyServer.setOnClickListener {
            val ip = etTvIp.text?.toString()?.trim().orEmpty()
            if (ip.isEmpty()) {
                setStatus(
                    "נא להזין כתובת IP של הטלוויזיה בשלב 1 לפני בדיקת Key Server.",
                    StatusTone.WARNING,
                    RetryAction.DISCOVER
                )
                return@setOnClickListener
            }
            val pass = etPassphrase.text?.toString()?.trim().orEmpty()
            checkKeyServer(ip, pass)
        }

        btnKeyServerHelp.setOnClickListener { showKeyServerHelpDialog() }
        btnStatusHelp.setOnClickListener { showKeyServerHelpDialog() }

        btnQuickRetry.setOnClickListener {
            val ip = etTvIp.text?.toString()?.trim().orEmpty()
            val pass = etPassphrase.text?.toString()?.trim().orEmpty()
            when (currentRetryAction) {
                RetryAction.DISCOVER -> runDiscovery()
                RetryAction.CHECK_DEV_MODE -> if (ip.isNotEmpty()) checkDevModeOnTv(ip) else runDiscovery()
                RetryAction.CHECK_KEY_SERVER -> if (ip.isNotEmpty()) checkKeyServer(ip, pass) else runDiscovery()
                RetryAction.INSTALL -> if (ip.isNotEmpty() && pass.isNotEmpty()) installApp(ip, pass) else checkKeyServer(ip, pass)
                RetryAction.NONE -> Unit
            }
        }

        btnInstall.setOnClickListener {
            val ip = etTvIp.text?.toString()?.trim().orEmpty()
            val pass = etPassphrase.text?.toString()?.trim().orEmpty()
            if (ip.isEmpty()) {
                updateStepUi(1, StepState.WARNING, "חסר IP")
                setStatus("נא להזין כתובת IP של הטלוויזיה בשלב 1.", StatusTone.WARNING, RetryAction.DISCOVER)
                return@setOnClickListener
            }
            if (pass.isEmpty()) {
                updateStepUi(3, StepState.WARNING, "חסר Passphrase")
                setStatus(
                    "נא להזין את ה-Passphrase (6 תווים מאפליקציית Developer Mode בטלוויזיה).",
                    StatusTone.WARNING,
                    showHelpButton = true
                )
                return@setOnClickListener
            }
            prefs.edit()
                .putString("last_ip", ip)
                .putString("last_pass", pass)
                .apply()
            installApp(ip, pass)
        }

        btnExtendDevMode.setOnClickListener {
            val ip = etTvIp.text?.toString()?.trim().orEmpty()
            val pass = etPassphrase.text?.toString()?.trim().orEmpty()
            if (ip.isEmpty() || pass.isEmpty()) {
                setStatus(
                    "נא למלא IP ו-Passphrase כדי להאריך את Developer Mode.",
                    StatusTone.WARNING,
                    showHelpButton = true
                )
                return@setOnClickListener
            }
            extendDevMode(ip, pass)
        }
    }

    private fun bindViews() {
        mainScrollView = findViewById(R.id.mainScrollView)
        btnDiscover = findViewById(R.id.btnDiscover)
        btnCheckDevMode = findViewById(R.id.btnCheckDevMode)
        btnCreateAccount = findViewById(R.id.btnCreateAccount)
        btnCheckKeyServer = findViewById(R.id.btnCheckKeyServer)
        btnKeyServerHelp = findViewById(R.id.btnKeyServerHelp)
        btnInstall = findViewById(R.id.btnInstall)
        btnExtendDevMode = findViewById(R.id.btnExtendDevMode)
        btnQuickRetry = findViewById(R.id.btnQuickRetry)
        btnStatusHelp = findViewById(R.id.btnStatusHelp)
        etTvIp = findViewById(R.id.etTvIp)
        etPassphrase = findViewById(R.id.etPassphrase)
        tvListContainer = findViewById(R.id.tvListContainer)
        tvStatus = findViewById(R.id.tvStatus)
        progressBar = findViewById(R.id.progressBar)
        cardStatus = findViewById(R.id.cardStatus)

        tvStepper1Circle = findViewById(R.id.tvStepper1Circle)
        tvStepper1Label = findViewById(R.id.tvStepper1Label)
        tvStepper2Circle = findViewById(R.id.tvStepper2Circle)
        tvStepper2Label = findViewById(R.id.tvStepper2Label)
        tvStepper3Circle = findViewById(R.id.tvStepper3Circle)
        tvStepper3Label = findViewById(R.id.tvStepper3Label)
        stepperLine12 = findViewById(R.id.stepperLine12)
        stepperLine23 = findViewById(R.id.stepperLine23)

        cardStep1 = findViewById(R.id.cardStep1)
        cardStep2 = findViewById(R.id.cardStep2)
        cardStep3 = findViewById(R.id.cardStep3)
        tvStep1Badge = findViewById(R.id.tvStep1Badge)
        tvStep2Badge = findViewById(R.id.tvStep2Badge)
        tvStep3Badge = findViewById(R.id.tvStep3Badge)
        tvStep1Pill = findViewById(R.id.tvStep1Pill)
        tvStep2Pill = findViewById(R.id.tvStep2Pill)
        tvStep3Pill = findViewById(R.id.tvStep3Pill)
    }

    private fun runDiscovery() {
        setBusy(true)
        tvListContainer.removeAllViews()
        discoveredButtons.clear()
        updateStepUi(1, StepState.ACTIVE, "סורק רשת...")
        setStatus("מחפש טלוויזיות LG ברשת ה-Wi-Fi...", StatusTone.BUSY)

        lifecycleScope.launch {
            val tvs = TvDiscovery.discoverTvs(this@MainActivity)
            setBusy(false)
            if (tvs.isEmpty()) {
                updateStepUi(1, StepState.WARNING, "לא נמצאו")
                setStatus(
                    "לא נמצאו טלוויזיות אוטומטית. ודא שהטלפון והטלוויזיה על אותו Wi-Fi (לא רשת אורחים), או הזן IP ידנית.",
                    StatusTone.WARNING,
                    RetryAction.DISCOVER
                )
                return@launch
            }

            val selectedIp = tvs.first().ip
            etTvIp.setText(selectedIp)
            getSharedPreferences("installer_prefs", MODE_PRIVATE).edit()
                .putString("last_ip", selectedIp)
                .apply()

            updateStepUi(1, StepState.DONE, "נמצאה ✓")
            updateStepUi(2, StepState.ACTIVE, "הבא בתור")
            setStatus("נמצאו ${tvs.size} טלוויזיות! נבחרה: ${tvs.first().name}. המשך לשלב 2.", StatusTone.SUCCESS)

            for (tv in tvs) {
                val btn = MaterialButton(
                    this@MainActivity,
                    null,
                    com.google.android.material.R.attr.materialButtonOutlinedStyle
                ).apply {
                    text = "${tv.name} — ${tv.ip}"
                    cornerRadius = dp(10)
                    setOnClickListener {
                        etTvIp.setText(tv.ip)
                        highlightSelectedTv(tv.ip)
                        updateStepUi(1, StepState.DONE, "נבחרה ✓")
                        setStatus("נבחרה טלוויזיה: ${tv.name} (${tv.ip}). המשך לשלב 2.", StatusTone.INFO)
                    }
                }
                discoveredButtons.add(tv.ip to btn)
                tvListContainer.addView(btn)
            }
            highlightSelectedTv(selectedIp)
        }
    }

    private fun highlightSelectedTv(selectedIp: String) {
        for ((ip, btn) in discoveredButtons) {
            val selected = ip == selectedIp
            btn.strokeColor = ColorStateList.valueOf(Color.parseColor(if (selected) "#22C55E" else "#334155"))
            btn.strokeWidth = dp(if (selected) 2 else 1)
            btn.setTextColor(Color.parseColor(if (selected) "#86EFAC" else "#E2E8F0"))
            btn.setBackgroundColor(Color.parseColor(if (selected) "#052E16" else "#0F172A"))
        }
    }

    private fun checkDevModeOnTv(ip: String) {
        setBusy(true)
        updateStepUi(2, StepState.ACTIVE, "מתחבר...")
        setStatus("מתחבר לטלוויזיה $ip...", StatusTone.BUSY)

        lifecycleScope.launch {
            val result = ssapClient.connectAndCheckDevMode(ip) { msg ->
                runOnUiThread { setStatus(msg, StatusTone.BUSY) }
            }
            setBusy(false)
            when {
                result.paired && result.devModeInstalled -> {
                    updateStepUi(1, StepState.DONE, "מחובר ✓")
                    updateStepUi(2, StepState.DONE, "מותקן ✓")
                    updateStepUi(3, StepState.ACTIVE, "הבא בתור")
                    setStatus(
                        "✅ ${result.message}\nכעת בטלוויזיה: הדלק Dev Mode Status ו-Key Server, הזן Passphrase והתקן בשלב 3.",
                        StatusTone.SUCCESS,
                        showHelpButton = true
                    )
                }
                result.paired && !result.devModeInstalled -> {
                    updateStepUi(2, StepState.WARNING, "התקן בחנות")
                    setStatus(
                        "⚠️ ${result.message}\nלאחר שתלחץ 'התקן' בטלוויזיה, לחץ כאן למטה על 'בדוק Developer Mode שוב'.",
                        StatusTone.WARNING,
                        RetryAction.CHECK_DEV_MODE
                    )
                }
                else -> {
                    updateStepUi(2, StepState.ERROR, "נדרש אישור")
                    setStatus(
                        "❌ ${result.message}\nודא שהטלוויזיה דלוקה ובאותו Wi-Fi, ואשר את בקשת החיבור עם השלט.",
                        StatusTone.ERROR,
                        RetryAction.CHECK_DEV_MODE
                    )
                }
            }
        }
    }

    private fun checkKeyServer(ip: String, pass: String) {
        setBusy(true)
        updateStepUi(3, StepState.ACTIVE, "בודק מוכנות...")
        setStatus("בודק אם Key Server ו-Dev Mode מוכנים בטלוויזיה ($ip)...", StatusTone.BUSY)

        lifecycleScope.launch {
            val res = WebosSshInstaller.checkKeyServerReady(ip, pass.ifBlank { null })
            setBusy(false)
            if (res.ready) {
                updateStepUi(3, StepState.ACTIVE, "מוכן להתקנה ✓")
                setStatus("✅ ${res.message}", StatusTone.SUCCESS)
            } else {
                updateStepUi(3, StepState.WARNING, if (!res.keyServerOn) "Key Server כבוי" else "נדרש תיקון")
                setStatus(
                    "⚠️ ${res.message}",
                    StatusTone.WARNING,
                    RetryAction.CHECK_KEY_SERVER,
                    showHelpButton = true
                )
            }
        }
    }

    private fun installApp(ip: String, pass: String) {
        setBusy(true)
        updateStepUi(3, StepState.ACTIVE, "מתקין...")
        setStatus("מתחיל התקנה לטלוויזיה $ip...", StatusTone.BUSY)

        lifecycleScope.launch {
            val res = WebosSshInstaller.installToTv(cacheDir, ip, pass) { progress ->
                runOnUiThread { setStatus(progress, StatusTone.BUSY) }
            }
            setBusy(false)
            res.onSuccess { msg ->
                updateStepUi(1, StepState.DONE, "מחובר ✓")
                updateStepUi(2, StepState.DONE, "מוכן ✓")
                updateStepUi(3, StepState.DONE, "הותקן ✓")
                setStatus("✅ $msg", StatusTone.SUCCESS)
            }.onFailure { err ->
                updateStepUi(3, StepState.ERROR, "נכשל")
                val errMsg = err.message ?: "שגיאה לא ידועה"
                val needsKeyServerCheck = errMsg.contains("Key Server", true) ||
                    errMsg.contains("9991", true) ||
                    errMsg.contains("9922", true) ||
                    errMsg.contains("Passphrase", true)
                setStatus(
                    "❌ $errMsg",
                    StatusTone.ERROR,
                    if (needsKeyServerCheck) RetryAction.CHECK_KEY_SERVER else RetryAction.INSTALL,
                    showHelpButton = needsKeyServerCheck
                )
            }
        }
    }

    private fun extendDevMode(ip: String, pass: String) {
        setBusy(true)
        setStatus("מאריך טיימר Developer Mode...", StatusTone.BUSY)
        lifecycleScope.launch {
            val res = WebosSshInstaller.extendDevModeSession(ip, pass) { progress ->
                runOnUiThread { setStatus(progress, StatusTone.BUSY) }
            }
            setBusy(false)
            res.onSuccess { msg ->
                setStatus("✅ $msg", StatusTone.SUCCESS)
            }.onFailure { err ->
                setStatus(
                    "❌ ${err.message}",
                    StatusTone.ERROR,
                    RetryAction.CHECK_KEY_SERVER,
                    showHelpButton = true
                )
            }
        }
    }

    private fun showKeyServerHelpDialog() {
        val message = """
            כדי שהטלפון יוכל להתקין את האפליקציה בטלוויזיה:

            1. בטלוויזיה, פתח את אפליקציית Developer Mode (אפשר לפתוח אוטומטית משלב 2).
            2. התחבר עם חשבון LG Developer שלך.
            3. הדלק את המתג Dev Mode Status ל-ON (הטלוויזיה תבצע הפעלה מחדש פעם אחת — זה תקין).
            4. אחרי ההפעלה מחדש, פתח שוב את Developer Mode בטלוויזיה והדלק את המתג Key Server ל-ON.
            5. הזן את ה-Passphrase (6 תווים) שמופיע על מסך הטלוויזיה כאן באפליקציה.

            פתרון תקלות נפוצות:
            • Key Server לא מתחבר? ודא ש-Key Server דלוק כרגע (לפעמים הוא נכבה אחרי הפעלה מחדש).
            • שגיאת Passphrase? שים לב לאותיות גדולות וקטנות (Case-sensitive).
            • לא מוצא טלוויזיה? ודא שהטלפון והטלוויזיה על אותו Wi-Fi (ולא ברשת אורחים).
        """.trimIndent()

        MaterialAlertDialogBuilder(this)
            .setTitle("הוראות הפעלת Key Server ופתרון תקלות")
            .setMessage(message)
            .setPositiveButton("בדוק Key Server עכשיו") { _, _ ->
                val ip = etTvIp.text?.toString()?.trim().orEmpty()
                val pass = etPassphrase.text?.toString()?.trim().orEmpty()
                if (ip.isNotEmpty()) {
                    checkKeyServer(ip, pass)
                } else {
                    setStatus("נא להזין כתובת IP של הטלוויזיה בשלב 1 קודם.", StatusTone.WARNING, RetryAction.DISCOVER)
                }
            }
            .setNegativeButton("סגור", null)
            .show()
    }

    private fun updateStepUi(step: Int, state: StepState, pillText: String) {
        val stepperCircle = when (step) {
            1 -> tvStepper1Circle
            2 -> tvStepper2Circle
            else -> tvStepper3Circle
        }
        val stepperLabel = when (step) {
            1 -> tvStepper1Label
            2 -> tvStepper2Label
            else -> tvStepper3Label
        }
        val card = when (step) {
            1 -> cardStep1
            2 -> cardStep2
            else -> cardStep3
        }
        val badge = when (step) {
            1 -> tvStep1Badge
            2 -> tvStep2Badge
            else -> tvStep3Badge
        }
        val pill = when (step) {
            1 -> tvStep1Pill
            2 -> tvStep2Pill
            else -> tvStep3Pill
        }

        val (circleBg, circleText, borderCol, labelCol, pillBg, pillTextCol) = when (state) {
            StepState.PENDING -> StepPalette("#1E293B", "#94A3B8", "#1E293B", "#94A3B8", "#1E293B", "#94A3B8")
            StepState.ACTIVE -> StepPalette("#0284C7", "#FFFFFF", "#0284C7", "#38BDF8", "#0C4A6E", "#38BDF8")
            StepState.WARNING -> StepPalette("#D97706", "#FFFFFF", "#D97706", "#FBBF24", "#451A03", "#FBBF24")
            StepState.DONE -> StepPalette("#16A34A", "#FFFFFF", "#16A34A", "#4ADE80", "#052E16", "#4ADE80")
            StepState.ERROR -> StepPalette("#DC2626", "#FFFFFF", "#DC2626", "#FCA5A5", "#450A0A", "#FCA5A5")
        }

        val badgeSymbol = if (state == StepState.DONE) "✓" else step.toString()
        stepperCircle.text = badgeSymbol
        stepperCircle.setTextColor(Color.parseColor(circleText))
        stepperCircle.background = circleDrawable(circleBg)
        stepperLabel.setTextColor(Color.parseColor(labelCol))

        badge.text = badgeSymbol
        badge.setTextColor(Color.parseColor(circleText))
        badge.background = circleDrawable(circleBg)

        pill.text = pillText
        pill.setTextColor(Color.parseColor(pillTextCol))
        pill.background = pillDrawable(pillBg)

        card.strokeColor = Color.parseColor(borderCol)
        card.strokeWidth = dp(if (state == StepState.PENDING) 1 else 2)

        if (step == 1) {
            stepperLine12.setBackgroundColor(Color.parseColor(if (state == StepState.DONE) "#16A34A" else "#334155"))
        } else if (step == 2) {
            stepperLine23.setBackgroundColor(Color.parseColor(if (state == StepState.DONE) "#16A34A" else "#334155"))
        }
    }

    private fun circleDrawable(hexColor: String): GradientDrawable = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor(hexColor))
    }

    private fun pillDrawable(hexColor: String): GradientDrawable = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = dp(999).toFloat()
        setColor(Color.parseColor(hexColor))
    }

    private fun setBusy(busy: Boolean) {
        btnDiscover.isEnabled = !busy
        btnCheckDevMode.isEnabled = !busy
        btnCheckKeyServer.isEnabled = !busy
        btnInstall.isEnabled = !busy
        btnExtendDevMode.isEnabled = !busy
        btnQuickRetry.isEnabled = !busy
        progressBar.visibility = if (busy) View.VISIBLE else View.GONE
    }

    private fun setStatus(
        msg: String,
        tone: StatusTone = StatusTone.INFO,
        retryAction: RetryAction = RetryAction.NONE,
        showHelpButton: Boolean = false
    ) {
        tvStatus.text = msg
        currentRetryAction = retryAction

        val (bgHex, strokeHex, textHex) = when (tone) {
            StatusTone.INFO -> Triple("#0F172A", "#1E293B", "#E2E8F0")
            StatusTone.BUSY -> Triple("#0C192C", "#0284C7", "#BAE6FD")
            StatusTone.SUCCESS -> Triple("#052E16", "#16A34A", "#BBF7D0")
            StatusTone.WARNING -> Triple("#271605", "#D97706", "#FDE68A")
            StatusTone.ERROR -> Triple("#2A0909", "#DC2626", "#FECACA")
        }
        cardStatus.setCardBackgroundColor(Color.parseColor(bgHex))
        cardStatus.strokeColor = Color.parseColor(strokeHex)
        cardStatus.strokeWidth = dp(if (tone == StatusTone.INFO) 1 else 2)
        tvStatus.setTextColor(Color.parseColor(textHex))

        if (retryAction != RetryAction.NONE) {
            btnQuickRetry.visibility = View.VISIBLE
            btnQuickRetry.text = when (retryAction) {
                RetryAction.DISCOVER -> "חפש טלוויזיות שוב"
                RetryAction.CHECK_DEV_MODE -> "בדוק Developer Mode שוב"
                RetryAction.CHECK_KEY_SERVER -> "בדוק Key Server שוב"
                RetryAction.INSTALL -> "נסה התקנה שוב"
                RetryAction.NONE -> ""
            }
        } else {
            btnQuickRetry.visibility = View.GONE
        }

        btnStatusHelp.visibility = if (showHelpButton) View.VISIBLE else View.GONE

        if (tone == StatusTone.ERROR || tone == StatusTone.WARNING || tone == StatusTone.SUCCESS) {
            mainScrollView.post {
                mainScrollView.smoothScrollTo(0, cardStatus.bottom)
            }
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private data class StepPalette(
        val circleBg: String,
        val circleText: String,
        val border: String,
        val label: String,
        val pillBg: String,
        val pillText: String
    )
}
