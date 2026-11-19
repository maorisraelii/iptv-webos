<div align="center">
  <img src="https://files.catbox.moe/f4jrx8.png" alt="IPTV Live TV App Icon" width="128" height="128" />
</div>

<h1 align="center">📺 Live TV for LG webOS &amp; Android TV (v5.0.2)</h1>

<p align="center">
  <strong>Smart, ultra-fast, native-feeling Live TV &amp; Catch-Up IPTV player built for LG webOS Smart TVs (webOS 4.0 – webOS 24+) and Android TV / Google TV, complete with an Android One-Click webOS Installer Wizard!</strong>
</p>

<p align="center">
  <a href="#-english-documentation">English</a> •
  <a href="#-תיעוד-והתקנה-בעברית">עברית (Hebrew)</a> •
  <a href="https://github.com/maorisraelii/iptv-webos/releases/latest">Download Latest Release</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-5.0.2%20Production-0284c7?style=for-the-badge" alt="Version 5.0.2" />
  <img src="https://img.shields.io/badge/Platform-LG%20webOS%20TV-a50034?style=for-the-badge&logo=lg" alt="LG webOS" />
  <img src="https://img.shields.io/badge/Platform-Android%20TV%20%2F%20Google%20TV-16a34a?style=for-the-badge&logo=android" alt="Android TV" />
  <img src="https://img.shields.io/badge/Downloader%20Code-2606856-f97316?style=for-the-badge" alt="Downloader Code 2606856" />
  <img src="https://img.shields.io/badge/Installer-Android%20APK-0ea5e9?style=for-the-badge&logo=android" alt="Android Installer APK" />
  <img src="https://img.shields.io/badge/Language-RTL%20Hebrew%20%2F%20All%20Feeds-0284c7?style=for-the-badge" alt="RTL Hebrew" />
</p>

> ✨ **New Apple Liquid Glass UI Beta (`v5.1.0-beta`):** Want to try the new Apple tvOS / visionOS frosted glass redesign? Check out the **[`beta` branch](https://github.com/maorisraelii/iptv-webos/tree/beta)**, **[Beta Release v5.1.0](https://github.com/maorisraelii/iptv-webos/releases/tag/v5.1.0)**, or Android TV Beta APK (`da.gd/iptvil510` / [Direct Mirror](https://files.catbox.moe/hpx4ox.apk)). The `main` branch and Downloader code **`2606856`** stay on Stable **`v5.0.2`**.
>
> ✨ **גרסת בטא בעיצוב Apple Liquid Glass (`v5.1.0-beta`):** רוצים לנסות את העיצוב החדש בסגנון זכוכית חלבית של אפל? עברו ל**[ענף ה-`beta`](https://github.com/maorisraelii/iptv-webos/tree/beta)**, ל**[שחרור הבטא v5.1.0](https://github.com/maorisraelii/iptv-webos/releases/tag/v5.1.0)**, או הורידו את גרסת הבטא ל-Android TV (`da.gd/iptvil510` / [הורדה ישירה](https://files.catbox.moe/hpx4ox.apk)). הענף הראשי (`main`) וקוד ה-Downloader **`2606856`** נשארים על הגרסה היציבה **`v5.0.2`**.

---

## 📸 Screenshots (v5.0.2)

<p align="center">
  <img src="https://files.catbox.moe/fzplkt.png" alt="Live TV Main Split Workspace" width="90%" />
  <br />
  <em>Main Split Workspace: Right-side O(1) Channel List with Real-Time EPG, Mini Progress Bars, Start/End Times &amp; Remaining Minutes + Left-side 16:9 Live Preview &amp; 5-Program Start-Over Strip.</em>
</p>

<p align="center">
  <img src="https://files.catbox.moe/wnosf1.png" alt="Live TV Fullscreen Info Bar OSD" width="90%" />
  <br />
  <em>Fullscreen Unified Info Bar (OSD): Live &amp; Start-Over programme details, elapsed/total progress, previous &amp; next shows, seek speed multiplier badge, and instant remote shortcuts.</em>
</p>

<p align="center">
  <img src="https://files.catbox.moe/57jh6j.png" alt="7-Day Channel Program Guide Modal" width="90%" />
  <br />
  <em>7-Day Channel Program Guide (Yellow / Menu / Guide): Instant day-by-day zapping and 1-click Start-Over on past or live broadcasts.</em>
</p>

<p align="center">
  <img src="https://files.catbox.moe/lxrrei.png" alt="Multi-M3U & Phone QR Sync Settings" width="90%" />
  <br />
  <em>Settings &amp; QR Phone Sync: Push M3U playlists and XMLTV feeds directly from your phone without typing on the TV remote.</em>
</p>

---

<a id="-english-documentation"></a>
## 🇬🇧 English Documentation

### 🚀 What's New in v5.0.2

1. **Android TV 11 (API 30) Black Screen Fix &amp; Safe Browse Boot (`android-tv/`, `js/app.js`, `js/loader.js`)**:
   - Serves bundled web assets from a virtual HTTPS origin (`https://appassets.androidplatform.net/`) with a built-in native CORS proxy (`/__proxy__`), Chromium 83 layout compatibility (`top/right/bottom/left` + `zoom` scaling for 720p/1080p), native boot overlay until `notifyAppReady()`, and reliable startup directly into the split Browse workspace.
2. **Native Android TV / Google TV Edition (`IPTV-Live-AndroidTV.apk`)**:
   - Full native Android TV launcher app (`android-tv/`, Leanback TV banner + `LAUNCHER` / `LEANBACK_LAUNCHER` support, `1920px` responsive viewport, immersive fullscreen, keep-screen-on, hardware-accelerated WebView, and zero gray default video poster).
   - Seamless D-Pad &amp; TV remote bridge forwarding `DPAD`, `CH+/CH-`, `Play/Pause`, `Rewind/Fast-Forward`, `Guide/Info/Menu`, `Color` buttons, and `0–9` digits — including **long-press `OK` (550ms)** in fullscreen to toggle Start-Over ON/OFF on remotes without color buttons!
3. **Channel List EPG Sync Fix (`js/app.js`, `js/epg.js`)**:
   - Loads cached EPG synchronously before channel filtering/rendering on cold boot, purges synthetic `gen_*` fallback entries whenever real XMLTV data is present, clears stale match caches, and refreshes **all** rendered channel rows (including offscreen rows and `timeRange`) so the channel list is never out of sync with the OSD.
4. **Continuous Live Start-Over Playback (`js/player.js`)**:
   - Fixed live Start-Over archive URLs (`buildCatchupUrl`) so `stopUnix` is never truncated at `nowUnix` — watching a currently airing show from the beginning now plays continuously to the end without freezing at the moment you pressed Start-Over.
   - Catchup seeking (`seekCatchup`) seeks smoothly inside the existing HLS buffer when available and debounces (`220ms`) seamless stream reloads when jumping outside the buffer.
5. **Seamless Auto-Advance &amp; Red Button Start-Over Toggle (`js/player.js`, `js/app.js`)**:
   - When a Start-Over programme finishes, `handleCatchupStreamBoundary` automatically transitions `player.currentProgramme` and the OSD Info Bar (including true Previous/Next adjacent programmes) to the next show — or exits cleanly back to Live when catching up to real time.
   - Pressing **Red** 🔴 (or long-pressing **OK**) while Start-Over is active toggles it **OFF** and returns immediately to Live broadcast via `exitStartOverToLive()`.
6. **Hebrew RTL Seek Direction Swap (`js/app.js`)**:
   - In Fullscreen RTL mode, pressing **Left (`◄`)** now seeks **Forward (`+15s`)** and pressing **Right (`►`)** seeks **Backward (`-15s`)** to match the RTL progress bar visually.
7. **Accelerated Long-Press Seeking (`js/app.js`, `js/remote.js`)**:
   - Holding `◄` / `►` (or Green/Blue / Rewind/Fast-Forward) continuously ramps seek speed smoothly through progressive tiers: **`15s → 30s (×2) → 60s (×4) → 180s (×8) → 300s (×16)`** with a live speed badge inside `#osd-live-badge`.

---

### 🤖 Option 1: Install on Android TV / Google TV (`IPTV-Live-AndroidTV.apk`)

Compatible with NVIDIA Shield TV, Chromecast with Google TV, Xiaomi Mi Box / TV Stick, Sony Bravia, TCL, Philips, and any Android TV / Google TV box:

#### Method A (Easiest — Direct on TV using Downloader)
1. Install the free **Downloader by AFTVnews** app from Google Play Store on your Android TV.
2. Enable **"Install unknown apps"** for **Downloader**:
   - Open TV **Settings → Apps → Security &amp; restrictions** (or **Special app access → Install unknown apps**) and turn ON permission for **Downloader**.
3. Open **Downloader** and enter the official Downloader numeric code into the box:
   ```text
   2606856
   ```
   *(Resolves via `https://aftv.news/2606856` — Backups: `da.gd/iptvil502` / `https://files.catbox.moe/s54sh0.apk` / `https://github.com/maorisraelii/iptv-webos/releases/latest/download/IPTV-Live-AndroidTV.apk`)*
4. Press **Go** — Downloader automatically fetches `IPTV-Live-AndroidTV.apk`. When prompted, select **Install**, then **Open**.

#### Method B (Wi-Fi Transfer from Phone via Send Files to TV)
1. Install **Send Files to TV** on both your Android TV and your smartphone (Google Play Store).
2. Download `IPTV-Live-AndroidTV.apk` on your phone ([Direct Mirror](https://files.catbox.moe/s54sh0.apk) • [GitHub Releases](https://github.com/maorisraelii/iptv-webos/releases/latest/download/IPTV-Live-AndroidTV.apk)).
3. Open **Send Files to TV** and tap **Receive** on the TV and **Send** on your phone, select `IPTV-Live-AndroidTV.apk`, then open and install it from the TV notification/file manager.

#### Method C (USB Flash Drive or PC `adb`)
- **USB**: Copy [`IPTV-Live-AndroidTV.apk`](https://github.com/maorisraelii/iptv-webos/releases/latest/download/IPTV-Live-AndroidTV.apk) to a USB drive, plug it into your TV, and install via any TV File Manager.
- **ADB from PC**:
  ```bash
  adb connect <TV_IP>:5555
  adb install -r IPTV-Live-AndroidTV.apk
  ```

#### First-Time Setup &amp; Android TV Remote Tips
- Open **IPTV Live TV** from your Android TV Home Screen (Apps / Leanback Launcher), open **הגדרות ו-M3U**, and scan the **QR code** with your phone to send your M3U playlists &amp; EPG links effortlessly without typing with the TV remote.
- **Remote Shortcut**: On minimalist Android TV remotes without colored buttons, **hold `OK` (Center button) for 0.5s** in fullscreen to toggle **Start-Over** ON/OFF, press **Menu / Guide** for the 7-Day Program Guide, and hold **◄ / ►** to accelerate seeking (`×2` to `×16`)!

---

### 📱 Option 2 (LG webOS — Easiest): Install via the Android Installer Wizard APK

No PC, no CLI, no IP typing, and no manual file transfers! Install directly from your Android phone on the same Wi-Fi as your LG TV:

1. Download and install the Android Wizard APK on your phone:
   👉 **[Download `IPTV-webOS-Installer.apk`](https://github.com/maorisraelii/iptv-webos/releases/latest/download/IPTV-webOS-Installer.apk)**
2. Open **מתקין IPTV ל-LG** on your phone (make sure phone and TV are on the same Wi-Fi) and follow the **1–2–3 visual progress wizard**:
   - **Step 1 — Auto-Discover TV**: Tap **"חפש טלוויזיות LG ברשת"** — the app automatically finds your LG TV via SSDP / LAN scan (or remembers your last IP).
   - **Step 2 — Pair &amp; Check Developer Mode**: Tap **"התחבר לטלוויזיה ופתח Developer Mode"** and accept the pairing prompt on the TV with your remote.
     - If **Developer Mode** is not installed yet, the app automatically opens the LG Content Store directly to Developer Mode on your TV so you only click **Install**.
     - If you don't have an LG Developer account yet, tap **"אין לי חשבון LG Developer"** to open the official registration page.
   - **Step 3 — One-Click Readiness Check &amp; Install**:
     - On the TV inside Developer Mode, log in with your LG account, turn ON **Dev Mode Status** (TV restarts once), and turn ON **Key Server**.
     - Need a quick reminder? Tap **"הוראות הפעלת Key Server"** for built-in step-by-step troubleshooting, or tap **"בדוק Key Server"** to verify Key Server, Dev Mode, and your 6-character **Passphrase** before installing.
     - Enter the 6-character **Passphrase** into the Android app, and tap **"התקן / עדכן IPTV Live TV לטלוויזיה!"** (with 1-tap retry/recovery if anything isn't ready yet).
   - The app automatically fetches the TV's SSH key (`port 9991`), downloads the latest `IPTV-Live-webOS.ipk` from GitHub Releases, installs it (`port 9922`), and launches **Live TV** on your TV!

### 💻 Option 3 (LG webOS — PC): Install via webOS Dev Manager

1. Install **Developer Mode** on your LG TV from the LG Apps Store and turn ON **Dev Mode Status** + **Key Server**.
2. Download the latest `.ipk` from GitHub Releases:
   👉 **[Download `com.iptv.livetv_5.0.2_all.ipk`](https://github.com/maorisraelii/iptv-webos/releases/latest/download/com.iptv.livetv_5.0.2_all.ipk)** / **[`IPTV-Live-webOS.ipk`](https://github.com/maorisraelii/iptv-webos/releases/latest/download/IPTV-Live-webOS.ipk)**
3. Open **webOS Dev Manager**, connect to your TV, click **Install App**, and select the downloaded `.ipk`.

---

<a id="-תיעוד-והתקנה-בעברית"></a>
## 🇮🇱 תיעוד והתקנה בעברית

### מה חדש בגרסה v5.0.2?

1. **תיקון מסך שחור ב-Android TV 11 (API 30) ועלייה בטוחה למסך הערוצים**:
   - טעינת ממשק ה-Web על גבי Virtual HTTPS Origin (`https://appassets.androidplatform.net/`) עם CORS Proxy מובנה (`/__proxy__`), התאמת Chromium 83 וסקיילינג אוטומטי למכשירי 720p/1080p, שכבת טעינה מקורית עד עליית האפליקציה, ופתיחה מיידית ובטוחה למסך רשימת הערוצים המפוצל (Browse Mode).
2. **מהדורת Android TV / Google TV מלאה (`IPTV-Live-AndroidTV.apk`)**:
   - אפליקציית Android TV מקורית עם באנר Leanback, תצוגת Fullscreen מותאמת למסכי טלוויזיה (`1920px`), מניעת כיבוי מסך והאצת חומרה.
   - תמיכה מלאה בשלטי Android TV / Google TV / Mi Box / Shield כולל **לחיצה ארוכה על `OK` (כ-0.5 שנייה)** במסך מלא להפעלה וכיבוי של **סטארט אובר** (גם בשלטים ללא כפתור אדום) וכפתור **Menu / Guide** למדריך 7 ימים!
3. **תיקון סנכרון לוח השידורים (EPG) ברשימת הערוצים**:
   - טעינה סינכרונית של המטמון מיד בעליית האפליקציה לפני רינדור הרשימה, ניקוי רשומות דמה (`gen_*`) כשיש EPG אמיתי, ועדכון מלא של כל השורות וטווח השעות (`timeRange`) כדי שרשימת הערוצים ופס המידע יהיו מסונכרנים תמיד.
4. **סטארט אובר חי רציף ללא קפיאות**:
   - תיקון בניית כתובת ה-Catchup לתוכנית שמשודרת כעת (ללא קטיעה של זמן הסיום לזמן הנוכחי) כך שהתוכנית מתנגנת ברצף מ-`00:00` ועד סופה בלי לקפוא.
   - הרצה חכמה בתוך הבאפר הקיים או טעינה מחודשת חלקה (`220ms` debounce) בקפיצות מחוץ לבאפר.
5. **מעבר אוטומטי לתוכנית הבאה בסטארט אובר + כיבוי באדום 🔴**:
   - כשמסיימים לצפות בתוכנית בסטארט אובר, הנגן ופס המידע ממשיכים אוטומטית לתוכנית הבאה ברצף (וחוזרים אוטומטית לשידור חי כשמדביקים את זמן האמת).
   - לחיצה חוזרת על הכפתור האדום 🔴 (או לחיצה ארוכה על `OK`) מכבה את הסטארט אובר ומחזירה מיד לשידור החי.
6. **התאמת כיווני הרצה לעברית (RTL)**:
   - במסך מלא, חץ **שמאלה (`◄`)** מריץ **קדימה** (+15 שניות) וחץ **ימינה (`►`)** מריץ **אחורה** (-15 שניות) בהתאמה מלאה לכיוון ציר הזמן בעברית.
7. **האצת הרצה בלחיצה ארוכה (`×2` עד `×16`)**:
   - החזקה רציפה של `◄` / `►` (או ירוק/כחול) מאיצה את קפיצות ההרצה בהדרגה: **`15 שניות ← ×2 (30 ש') ← ×4 (דקה) ← ×8 (3 דק') ← ×16 (5 דק')`** עם חיווי מהירות ברור בפס המידע.

---

### 🤖 התקנה על Android TV / Google TV (`IPTV-Live-AndroidTV.apk`) — מדריך מלא שלב-אחר-שלב

מתאים לכל טלוויזיה חכמה או סטרימר מבוסס Android TV / Google TV (Xiaomi Mi Box / Stick, NVIDIA Shield, Chromecast with Google TV, Sony, TCL, Philips ועוד):

#### שיטה 1 (הכי קלה — ישירות מהטלוויזיה עם אפליקציית Downloader)
1. התקן מחנות Google Play בטלוויזיה את האפליקציה החינמית **Downloader by AFTVnews** (סמל כתום).
2. אפשר הרשאת התקנת אפליקציות חיצוניות עבור Downloader בטלוויזיה:
   - היכנס ל**הגדרות (Settings) ← אפליקציות (Apps) ← אבטחה והגבלות / גישה מיוחדת (Security &amp; restrictions / Special app access) ← התקנת אפליקציות לא ידועות (Install unknown apps)** והדלק את ההרשאה ל-**Downloader**.
3. פתח את אפליקציית **Downloader** והקלד בשורת החיפוש/כתובת את **קוד ה-Downloader המספרי**:
   ```text
   2606856
   ```
   *(מקושר ל-`https://aftv.news/2606856` — קישורי גיבוי: `da.gd/iptvil502` / `https://files.catbox.moe/s54sh0.apk` / `https://github.com/maorisraelii/iptv-webos/releases/latest/download/IPTV-Live-AndroidTV.apk`)*
4. לחץ **Go** — האפליקציה תוריד אוטומטית את `IPTV-Live-AndroidTV.apk`. כשיקפוץ חלון ההתקנה, לחץ **התקן (Install)** ובסיום **פתח (Open)**.

#### שיטה 2 (העברה אלחוטית מהטלפון עם Send Files to TV)
1. התקן את **Send Files to TV** מחנות Google Play גם בטלפון וגם בטלוויזיה (ודא ששניהם על אותו Wi-Fi).
2. הורד בטלפון את קובץ ה-APK ([הורדה ישירה ממראה ציבורית](https://files.catbox.moe/s54sh0.apk) • [GitHub Releases](https://github.com/maorisraelii/iptv-webos/releases/latest/download/IPTV-Live-AndroidTV.apk)):
3. פתח את **Send Files to TV** ולחץ על **Receive** בטלוויזיה ועל **Send** בטלפון, בחר את הקובץ שהורדת, ובסיום לחץ עליו בטלוויזיה כדי להתקין.

#### שיטה 3 (דיסק-און-קי USB או ADB מהמחשב)
- **דיסק-און-קי (USB):** העתק את [`IPTV-Live-AndroidTV.apk`](https://github.com/maorisraelii/iptv-webos/releases/latest/download/IPTV-Live-AndroidTV.apk) ל-USB, חבר לטלוויזיה, ופתח עם סייר הקבצים בטלוויזיה להתקנה.
- **דרך ADB מהמחשב:**
  ```bash
  adb connect <TV_IP>:5555
  adb install -r IPTV-Live-AndroidTV.apk
  ```

#### הגדרה ראשונית וטיפים לשלט Android TV
- פתח את **IPTV Live TV** ממסך הבית של הטלוויזיה, היכנס ל-**הגדרות ו-M3U**, וסרוק עם הטלפון את **קוד ה-QR** כדי לשלוח פלייליסטים ו-EPG ישירות מהנייד בלי להקליד עם השלט!
- **קיצורי שלט מותאמים ל-Android TV:** בשלטים בלי כפתורים צבעוניים (כמו Xiaomi / Chromecast), **החזקה ארוכה על `OK` (כחצי שנייה)** במסך מלא מפעילה ומכבה **סטארט אובר**, כפתור **Menu / Guide** פותח את מדריך 7 הימים, והחזקה של **◄ / ►** מריצה קדימה/אחורה בהאצה מדורגת (`×2` עד `×16`).

---

### 📱 התקנה על LG webOS דרך אשף האנדרואיד מהטלפון (מומלץ!)

בלי מחשב, בלי שורת פקודה ובלי להקליד כתובות IP ידנית:

1. הורד והתקן בטלפון האנדרואיד שלך את אשף ההתקנה:
   👉 **[הורד את האשף לאנדרואיד (`IPTV-webOS-Installer.apk`)](https://github.com/maorisraelii/iptv-webos/releases/latest/download/IPTV-webOS-Installer.apk)**
2. פתח את האפליקציה **"מתקין IPTV ל-LG"** (ודא שהטלפון והטלוויזיה על אותו Wi-Fi) ועקוב אחר **מד ההתקדמות 1–2–3**:
   - **שלב 1 — איתור אוטומטי**: לחץ על **"חפש טלוויזיות LG ברשת"**. האפליקציה תמצא אוטומטית את הטלוויזיה שלך (וזוכרת את כתובת ה-IP האחרונה).
   - **שלב 2 — חיבור ופתיחת Developer Mode**: לחץ על **"התחבר לטלוויזיה ופתח Developer Mode"** ואשר עם השלט את בקשת החיבור על מסך הטלוויזיה.
     - אם אפליקציית **Developer Mode** עדיין לא מותקנת בטלוויזיה, האשף יפתח לך אוטומטית את חנות LG ישר עליה — תצטרך רק ללחוץ **"התקן"**.
     - אם כבר מותקנת, האשף יפתח אותה אוטומטית על המסך.
     - אין לך עדיין חשבון LG Developer? לחץ על הכפתור **"אין לי חשבון LG Developer"** לפתיחת עמוד ההרשמה הרשמי.
   - **שלב 3 — בדיקת מוכנות והתקנה בלחיצה אחת**:
     1. באפליקציית Developer Mode בטלוויזיה: התחבר לחשבון LG, הדלק **Dev Mode Status** (הטלוויזיה תבצע הפעלה מחדש פעם אחת) ולאחר מכן הדלק את **Key Server**.
     2. ניתן ללחוץ על **"הוראות הפעלת Key Server"** להסבר מהיר ופתרון תקלות, או על **"בדוק Key Server"** כדי לוודא בלחיצה ש-Key Server, Dev Mode וה-Passphrase מוכנים.
     3. הקלד באשף בטלפון את ה-**Passphrase** (6 התווים שמופיעים על מסך הטלוויזיה).
     4. לחץ על **"התקן / עדכן IPTV Live TV לטלוויזיה!"** (בכל תקלה יופיע כפתור **"בדוק שוב"** בלחיצה אחת).
     - האשף ימשוך אוטומטית את מפתח ה-SSH מהטלוויזיה, יוריד את הגרסה האחרונה מ-GitHub, יתקין אותה לטלוויזיה ויפעיל את האפליקציה מיד!

### 💻 התקנה על LG webOS ממחשב (Windows / Mac / Linux)

1. התקן **Developer Mode** מחנות LG בטלוויזיה, התחבר לחשבון LG, והפעל **Dev Mode Status** + **Key Server**.
2. הורד את קובץ ההתקנה העדכני:
   👉 **[הורד `com.iptv.livetv_5.0.2_all.ipk`](https://github.com/maorisraelii/iptv-webos/releases/latest/download/com.iptv.livetv_5.0.2_all.ipk)** / **[`IPTV-Live-webOS.ipk`](https://github.com/maorisraelii/iptv-webos/releases/latest/download/IPTV-Live-webOS.ipk)**
3. התקן בעזרת **webOS Dev Manager** (לחיצה על **Install App** ובחירת קובץ ה-`.ipk`).

---

### 🎮 שלט הטלוויזיה (LG webOS &amp; Android TV Remote Controls)

| כפתור בשלט / Button | מצב רשימה (Browse) | מצב מסך מלא (Fullscreen) |
| :--- | :--- | :--- |
| **▲ / ▼** או **CH+ / CH-** | דפדוף ברשימת הערוצים | לחיצה 1: פתיחת פס מידע נוכחי • לחיצה 2+: זפזופ |
| **◄ (שמאל)** | מעבר לסטריפ 5 התוכניות | **הרצה קדימה 15 שניות** (החזקה רציפה מאיצה `×2 → ×16`) |
| **► (ימין)** | חזרה לרשימת הערוצים | **הרצה אחורה 15 שניות** (החזקה רציפה מאיצה `×2 → ×16`) |
| **OK (לחיצה קצרה)** | נגינה / מסך מלא / הפעלת סטארט אובר | השהיה / המשך (`Play/Pause`) או אישור זפזופ |
| **OK (לחיצה ארוכה 0.5 ש')** | — | **הפעלה / כיבוי של סטארט אובר** (שימושי במיוחד ב-Android TV!) |
| **0–9** | מעבר מהיר לערוץ עם תצוגת שם הערוץ | מעבר מהיר לערוץ עם תצוגת שם הערוץ |
| **אדום 🔴** | יציאה מסטארט אובר חזרה לחי | **סטארט אובר** לתוכנית החיה (`00:00`) / לחיצה נוספת לחזרה לחי |
| **ירוק 🟢 / Rewind ⏪** | — | הרצה אחורה 30 שניות (החזקה מאיצה עד `×16`) |
| **כחול 🔵 / Fast-Forward ⏩** | — | הרצה קדימה 30 שניות (החזקה מאיצה עד `×16`) |
| **צהוב 🟡 / Menu / Guide** | פתיחת מדריך תוכניות (7 ימים) | פתיחת מדריך תוכניות (7 ימים) |
| **Back / Return** | חזרה למסך מלא | חזרה לרשימת הערוצים (או יציאה מתיבת קלט) |
