<p align="center">
  <img src="largeIcon.png" alt="Live TV Logo" width="130" height="130" style="border-radius: 28px; box-shadow: 0 12px 36px rgba(56, 189, 248, 0.3);" />
</p>

<h1 align="center">📺 Live TV for LG webOS (v4.9.2)</h1>

<p align="center">
  An ultra-fast, hardware-accelerated, remote-first <strong>IPTV Live TV &amp; Catch-Up Player</strong> engineered specifically for <strong>LG Smart TVs (webOS 4.0 – 24+)</strong>.<br />
  Features <strong>Hardware Audio Pipeline &amp; Auto-Unmute Guard</strong>, <strong>Zero EPG Truncation &amp; Stale-While-Revalidate Sync</strong>, <strong>Direct Fullscreen Boot on Launch</strong>, <strong>TV Hardware Memory Crash Guard</strong>, <strong>100% Israeli XMLTV EPG Match (`epg-il.xml`)</strong>, <strong>Numeric Jump Target Channel Preview (0–9)</strong>, <strong>Live Channel-Row Mini Progress Bars</strong>, <strong>Progressive Quality Ramp-Up (Smart ABR by Buffer)</strong>, <strong>True 16:9 (960×540 qHD) Live Preview Workspace</strong>, and <strong>Full-Runtime Over-The-Air (OTA) Cloud Updates</strong>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-4.9.2%20Production-0284c7?style=for-the-badge" alt="Version 4.9.2" />
  <a href="https://github.com/maorisraelii/iptv-webos/actions/workflows/build_ipk.yml"><img src="https://img.shields.io/github/actions/workflow/status/maorisraelii/iptv-webos/build_ipk.yml?branch=main&style=for-the-badge&label=Build%20%26%20Release&logo=githubactions" alt="Build Status" /></a>
  <img src="https://img.shields.io/badge/Platform-LG%20webOS%204.64%20|%205.0%2B-a50034?style=for-the-badge&logo=lg" alt="LG webOS 4.64+" />
  <img src="https://img.shields.io/badge/Smart%20ABR-Progressive%20Quality%20by%20Buffer-f59e0b?style=for-the-badge" alt="Progressive Quality Ramp-Up" />
  <img src="https://img.shields.io/badge/OTA-Full%20Runtime%20Bundle-8b5cf6?style=for-the-badge" alt="Full Runtime OTA" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License" /></a>
</p>

---

## 📸 Screenshots (v4.9.2)

<p align="center">
  <img src="screenshots/1-browse-live.png" alt="Live TV Main Workspace with Real-Time Israeli EPG, Channel List Mini Progress Bars, True 16:9 960x540 Live Preview, Prev/Now/Next EPG and 5-Show Strip" width="100%" />
  <br />
  <em>Main Split Workspace (v4.9.2): Right-side Wide O(1) Channel List (892px wide) with Real-Time Israeli XMLTV Programmes, Live Mini Progress Bars, Start/End Times &amp; Remaining Minutes per Channel + Left-side True 16:9 (960×540) Live Stream Preview, Previous/Current/Next EPG, and 5-Program Start-Over Strip.</em>
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

## 🚀 What's New in v4.9.2

1. **Hardware Audio Pipeline Guard &amp; Zero Audio-Drop Architecture (`js/player.js`, `js/remote.js`, `js/app.js`)**:
   - Fixed an issue on LG webOS Smart TVs where sound could intermittently vanish, requiring an app reboot.
   - **Root Cause &amp; Solution**: WebOS hardware ALSA audio decoders can enter a locked state when channels switch without an explicit hardware sink flush (`video.load()`), or when WebKit's autoplay restrictions trigger silent muting on boot without user gestures.
   - The app now cleanly releases the hardware audio sink on every stream teardown, automatically monitors audio health every 2 seconds via an active audio watchdog, un-mutes on any remote interaction, and listens to `webOSRelaunch` and `visibilitychange` to restore audio instantly when waking up from TV standby or switching back from HDMI inputs.
2. **Zero-Truncation EPG Local Cache (`v4.9.1`)**:
   - The local cache preserves **100% of all 285 channels and 896 aliases** by saving the active viewing window in an ultra-compact ~890KB format that stays safely within browser storage limits.
3. **Direct Fullscreen Boot &amp; TV Hardware Memory Crash Guard (`v4.9.0`)**:
   - Immediate fullscreen playback on the last watched channel upon launching, with 15MB hardware memory limits preventing WebKit crashes on newer webOS displays.
   - `epg-il.xml` and `ota-manifest.json` continuously synced via GitHub Actions and Cloud Gist for instantaneous zero-effort client updates without reinstalling IPK files.

---

## ✨ Highlights from v4.8.0, v4.7.0 &amp; v4.6.0

- **Numeric Jump Target Channel Preview (`v4.8.0`)**:
  - Typing digits (`0–9`) on the remote immediately previews the target channel's **Name**, **Logo**, and **Current Live Programme** inside the jump overlay before switching.
- **Zero Redundant Bottom Toasts on Channel Switch (`v4.8.0`)**.
- **Live Mini Progress Bar &amp; Remaining-Time Indicator Inside Every Channel List Row (`v4.7.0`)**:
  - Shows start/end times (`HH:MM - HH:MM`), a live visual progress bar (`0% – 100%`), and remaining minutes directly inside each channel row.
- **Progressive Quality Ramp-Up by Buffer (`Smart ABR` in `v4.6.0`)**.
- **True 16:9 (`960×540` qHD) Live Video Preview &amp; Expanded `892px` Channel List (`v4.4.0`)**.
- **Zero-Typing QR Code &amp; 4-Digit Cloud M3U Upload (`js/qr-ota.js`, `remote.html`, `manager.html`)**.

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

## 📦 Download &amp; Installation

### Method 1: Direct Download via GitHub Releases (Recommended)
1. Download the latest pre-built package from Releases:
   👉 **[Download `com.iptv.livetv_4.9.2_all.ipk` / `IPTV-Live-webOS.ipk`](https://github.com/maorisraelii/iptv-webos/releases/latest)**
2. Open [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) on your PC with your TV connected.
3. Click **Install App** and select `com.iptv.livetv_4.9.2_all.ipk` (or `IPTV-Live-webOS.ipk`).
4. Subsequent updates are delivered automatically via **Over-The-Air (OTA) Cloud Updates** directly inside the app!

### Method 2: 1-Click Local Build &amp; Direct TV Install (PowerShell)
```powershell
# Build .ipk package locally and sync OTA manifest
.\package_ipk.ps1

# Build and install directly to a configured LG TV device
.\package_ipk.ps1 -Device tv
```

---

## 👨‍💻 Author &amp; License

- **Developer**: **Maor Israeli** ([@maorisraelii](https://github.com/maorisraelii))
- **Repository**: [github.com/maorisraelii/iptv-webos](https://github.com/maorisraelii/iptv-webos)
- **License**: Released under the [MIT License](LICENSE).

*Disclaimer: This software is purely a media player client and does not bundle, host, or distribute any IPTV streams or copyrighted content.*
