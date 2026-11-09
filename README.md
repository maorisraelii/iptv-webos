<p align="center">
  <img src="largeIcon.png" alt="Live TV Logo" width="130" height="130" style="border-radius: 28px; box-shadow: 0 12px 36px rgba(56, 189, 248, 0.3);" />
</p>

<h1 align="center">📺 Live TV for LG webOS (v4.3.0)</h1>

<p align="center">
  An ultra-fast, hardware-accelerated, remote-first <strong>IPTV Live TV &amp; Catch-Up Player</strong> engineered specifically for <strong>LG Smart TVs (webOS 4.0 – 24+)</strong>.<br />
  Features an <strong>O(1) 60fps Spatial Navigation Engine</strong>, <strong>&lt; 90ms Instant Cold Boot</strong>, <strong>Zero-Typing QR &amp; 4-Digit Cloud M3U Upload</strong>, <strong>Over-The-Air (OTA) Cloud Updates with Startup Popups</strong>, <strong>Anti-Freeze HLS Buffer Profiles (up to 120s)</strong>, <strong>7-Day Bounded Program Guide with 1-Click Start-Over</strong>, and a companion <strong>PC Web Studio</strong>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-4.3.0%20Production-0284c7?style=for-the-badge" alt="Version 4.3.0" />
  <a href="https://github.com/maorisraelii/iptv-webos/actions/workflows/build_ipk.yml"><img src="https://img.shields.io/github/actions/workflow/status/maorisraelii/iptv-webos/build_ipk.yml?branch=main&style=for-the-badge&label=Build%20%26%20Release&logo=githubactions" alt="Build Status" /></a>
  <img src="https://img.shields.io/badge/Platform-LG%20webOS%204.64%20|%205.0%2B-a50034?style=for-the-badge&logo=lg" alt="LG webOS 4.64+" />
  <img src="https://img.shields.io/badge/OTA-Cloud%20Auto--Update-8b5cf6?style=for-the-badge" alt="OTA Cloud Auto-Update" />
  <img src="https://img.shields.io/badge/QR%20Upload-Phone%20%26%20PC%20Cloud%20Sync-10b981?style=for-the-badge" alt="QR & Cloud M3U Sync" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License" /></a>
</p>

---

## 📸 Screenshots (v4.3.0)

<p align="center">
  <img src="screenshots/1-browse-live.png" alt="Live TV Main Workspace with Channel List, Live Preview, Prev/Now/Next EPG and 5-Show Strip" width="100%" />
  <br />
  <em>Main Split Workspace (v4.3.0): Right-side O(1) Channel List (OK-only channel switching) + Left-side 16:9 Live Stream Preview, Previous/Current/Next EPG with Start &amp; End times, and 5-Program Interactive Start-Over Strip.</em>
</p>

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="screenshots/2-category-rail.png" alt="7-Day Channel Program Guide Modal (Yellow Button)" />
      <p align="center"><strong>7-Day Channel Program Guide (Yellow Button)</strong><br />Bounded 7-day catch-up history organized by day tabs (<code>◀ / ▶</code>) with 1-click Start-Over.</p>
    </td>
    <td width="50%" valign="top">
      <img src="screenshots/3-settings-modal.png" alt="QR Code & 4-Digit Cloud M3U Upload in Settings" />
      <p align="center"><strong>Zero-Typing QR Code &amp; 4-Digit Cloud M3U Upload</strong><br />Scan the QR code with your phone or enter the 4-digit TV code to beam M3U URLs and <code>.m3u</code> files directly to the TV.</p>
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <img src="screenshots/4-search-modal.png" alt="PC Web Studio for Multi-M3U & Custom Channel Numbering" />
      <p align="center"><strong>PC Web Studio (<code>manager.html</code>) &amp; Mobile QR Portal (<code>remote.html</code>)</strong><br />Manage multiple M3U sources, upload local <code>.m3u</code> files, toggle channels on/off, assign custom channel numbers, and beam directly to your TV via 4-digit Cloud Code or LAN.</p>
    </td>
  </tr>
</table>

---

## 🚀 What's New in v4.3.0

1. **Zero-Typing QR Code & 4-Digit Cloud M3U Upload (`js/qr-ota.js`, `remote.html`, `manager.html`)**:
   - **Scan QR from Any Phone**: Open **Settings (הגדרות ו-M3U) ➔ מקורות שידור (M3U)** on your TV to see a crisp inline SVG QR code and a unique **4-digit TV Pairing Code**.
   - **Mobile & PC Cloud Portal (`remote.html`)**: Scanning the QR code opens the mobile-friendly upload page on your smartphone. Paste one or more M3U URLs or pick a local `.m3u` / `.m3u8` file from your phone and tap **"שלח לטלוויזיה כעת"** — the TV receives and loads your playlists within seconds over HTTPS without typing a single character on the TV remote!
   - **1-Click Cloud Push in PC Web Studio (`manager.html`)**: Enter the 4-digit TV code in `manager.html` and click **"שלח לטלוויזיה בענן (ללא שרת)"** to push merged M3U playlists and custom channel numbers directly to the TV over the cloud.
   - **Smart Short-Link & Pastebin Code Auto-Expansion (`LineupStore.normalizeM3uInput`)**: If you prefer typing on the TV, entering just an 8-character Pastebin code (e.g., `xYz123Ab`) automatically expands to `https://pastebin.com/raw/xYz123Ab`, and short links (`bit.ly/...`, `is.gd/...`, `tinyurl.com/...`) automatically prepend `https://`.
2. **Full Over-The-Air (OTA) Cloud Update Engine & Startup Popups (`js/qr-ota.js`, `ota-manifest.json`)**:
   - **Automatic Startup OTA Check**: On every launch, the app checks the public cloud OTA manifest (`ota-manifest.json`) even while the source GitHub repository remains private.
   - **"Update Available" Startup Popup (`#ota-modal`)**: When a newer version is published, a remote-navigable modal pops up on launch showing the current version vs. new version, full Hebrew changelog, download progress bar, and an **"עדכן עכשיו (OK)"** button.
   - **"Updated Successfully" Confirmation Popup**: Immediately after an OTA update finishes (and on the next app launch), a confirmation popup (**"עודכן בהצלחה ✓ — האפליקציה עודכנה בהצלחה לגרסה v4.3.0!"**) notifies the user of the new features.
   - **Manual OTA Check Button**: Check for updates anytime via **Settings ➔ אודות (About) ➔ בדוק עדכוני OTA כעת**.
3. **Version Number Display in Fullscreen Info-Bar & Header**:
   - The running app version (`v4.3.0` / `גרסה v4.3.0`) is now prominently displayed inside the **Fullscreen Info-Bar (`#fullscreen-osd`)** (both in the top status pill next to the live clock and in the Info-Bar footer), in the **Main Screen Header (`#header-version-badge`)**, and in **Settings ➔ About**.

---

## ✨ Previous Highlights (v4.2.0)

- **Pure Inline SVG Vector Icons & Smart Channel Monograms**: Crisp inline `<svg>` icons and instant monogram badges across all webOS versions.
- **OK-Only Channel Switching on Main Screen**: Navigating `▲ / ▼` in the main channel list previews the channel's EPG synopsis and 5-program timeline on the left without interrupting the active video stream; pressing **OK** switches the stream (and pressing **OK** again enters Fullscreen).
- **Previous, Current & Next Programmes with Start & End Times**: Both the Fullscreen Info-Bar and Main Screen EPG Card show `הקודמת`, `משודר כעת`, and `הבאה בתור` with full `HH:MM - HH:MM` start and end times.
- **2-Step Center Button (`OK`) Pause / Play in Fullscreen**: 1st press of `OK` brings up the Info-Bar; 2nd press of `OK` while the Info-Bar is visible toggles **Pause / Play**.
- **Anti-Freeze HLS Engine (`15s` / `35s` / `65s` / `120s`) & Smart EPG Cache TTL (`24h` / `3d` / `7d` / `Manual`)**.

---

## 🎮 Remote Control Mapping

| Remote Button | Action in Main Screen (Browse Mode) | Action in Fullscreen Mode |
| :--- | :--- | :--- |
| **D-Pad Up / Down (`▲ / ▼`)** | Highlight channel &amp; preview EPG (without switching stream) | **Info-Bar Channel Surfing** (preview other channels without interrupting stream) |
| **D-Pad Left (`◀`)** | Move focus to the **5-Show Program Strip** (Past / Live / Next) | Rewind 15 seconds (`◀◀`) |
| **D-Pad Right (`▶`)** | Navigate earlier shows in Program Strip / Return to Channel List | Fast-Forward 15 seconds (`▶▶`) |
| **OK / Center Button** | **1st press**: Switch stream to highlighted channel<br>**2nd press (on active channel)**: Enter Fullscreen<br>**On Program Strip**: Launch Start-Over for selected show | **If Info-Bar hidden**: Show Info-Bar (`#fullscreen-osd`)<br>**If Info-Bar visible**: Toggle **Pause / Play (`❚❚ / ▶`)**<br>**If Surfing**: Confirm &amp; switch to surfed channel |
| **Back (`461` / `ESC`)** | Return focus to Channel List / Enter Fullscreen | Cancel Info-Bar Surfing / Exit Fullscreen to Main Screen |
| **Red Button 🔴 (`403`)** | Start Over current programme (`סטארט אובר`) | Start Over current programme (`סטארט אובר`) |
| **Green Button 🟢 (`404`)** | Rewind 30 seconds (`◀◀`) | Rewind 30 seconds (`◀◀`) |
| **Yellow Button 🟡 (`405`)** | Open **7-Day Channel Program Guide** (`מדריך תוכניות`) | Open **7-Day Channel Program Guide** (`מדריך תוכניות`) |
| **Blue Button 🔵 (`406`)** | Fast-Forward 30 seconds (`▶▶`) | Fast-Forward 30 seconds (`▶▶`) |
| **CH+ / CH−** | Switch immediately to Next / Previous Channel | Switch immediately to Next / Previous Channel |
| **0 – 9 (Digits)** | Direct numeric channel jump (or type custom channel # in Editor) | Direct numeric channel jump |

---

## 📱 Easy M3U Upload: Phone QR Scan or PC Web Studio

### Option A: Scan QR Code with Your Smartphone (Fastest — Zero Setup)
1. On your LG TV, click **הגדרות ו-M3U** in the top header.
2. Scan the **QR Code** displayed on screen with your phone's camera.
3. Paste your M3U URL(s) or select an `.m3u` file from your phone and tap **"שלח לטלוויזיה כעת"**.
4. Your TV automatically receives the playlists within 2 seconds!

### Option B: PC Web Studio (`manager.html`) via 4-Digit Cloud Code or LAN
1. Open `manager.html` in your computer browser (or run `npm run studio` for local LAN sync).
2. Add one or more M3U URLs or upload local `.m3u` files, toggle channels on/off, and customize channel numbers.
3. Enter the **4-digit code** shown on your TV and click **"שלח לטלוויזיה בענן (ללא שרת)"**!

---

## 📦 Download &amp; Installation

### Method 1: Direct Download via GitHub Releases (Recommended)
1. Download the latest pre-built package from Releases:
   👉 **[Download `com.iptv.livetv_4.3.0_all.ipk` / `IPTV-Live-webOS.ipk`](https://github.com/maorisraelii/iptv-webos/releases/latest)**
2. Open [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) on your PC with your TV connected.
3. Click **Install App** and select `com.iptv.livetv_4.3.0_all.ipk` (or `IPTV-Live-webOS.ipk`).
4. Subsequent updates are delivered automatically via **Over-The-Air (OTA) Cloud Updates** directly inside the app!

### Method 2: 1-Click Local Build &amp; Direct TV Install (PowerShell)
```powershell
# Build .ipk package locally and sync OTA manifest
.\package_ipk.ps1

# Build and install directly to a configured LG TV device
.\package_ipk.ps1 -Device tv
```

---

## 🛠️ Troubleshooting: Resolving `-5: ipk verified failed`

If webOS Dev Manager or `ares-install` returns `-5: ipk verified failed`:
1. **TV Date &amp; Time Out of Sync (Most Common Cause)**:
   - On your LG TV, go to **Settings ➔ General ➔ Time &amp; Date** and verify the date, time, and timezone are accurate.
2. **Developer Mode Session**:
   - Ensure the **Developer Mode** app on your TV has an active session and Key Server is enabled.

---

## 👨‍💻 Author &amp; License

- **Developer**: **Maor Israeli** ([@maorisraelii](https://github.com/maorisraelii))
- **Repository**: [github.com/maorisraelii/iptv-webos](https://github.com/maorisraelii/iptv-webos)
- **License**: Released under the [MIT License](LICENSE).

*Disclaimer: This software is purely a media player client and does not bundle, host, or distribute any IPTV streams or copyrighted content.*
