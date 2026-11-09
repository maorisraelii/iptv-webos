<p align="center">
  <img src="largeIcon.png" alt="Live TV Logo" width="130" height="130" style="border-radius: 28px; box-shadow: 0 12px 36px rgba(56, 189, 248, 0.3);" />
</p>

<h1 align="center">📺 Live TV for LG webOS (v4.9.0)</h1>

<p align="center">
  An ultra-fast, hardware-accelerated, remote-first <strong>IPTV Live TV &amp; Catch-Up Player</strong> engineered specifically for <strong>LG Smart TVs (webOS 4.0 – 24+)</strong>.<br />
  Features <strong>Direct Fullscreen Boot on Launch</strong>, <strong>TV Hardware Memory Crash Guard</strong>, <strong>100% Israeli XMLTV EPG Match (`epg-il.xml`)</strong>, <strong>Numeric Jump Target Channel Preview (0–9)</strong>, <strong>Live Channel-Row Mini Progress Bars</strong>, <strong>Progressive Quality Ramp-Up (Smart ABR by Buffer)</strong>, <strong>True 16:9 (960×540 qHD) Live Preview Workspace</strong>, and <strong>Full-Runtime Over-The-Air (OTA) Cloud Updates</strong>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-4.9.0%20Production-0284c7?style=for-the-badge" alt="Version 4.9.0" />
  <a href="https://github.com/maorisraelii/iptv-webos/actions/workflows/build_ipk.yml"><img src="https://img.shields.io/github/actions/workflow/status/maorisraelii/iptv-webos/build_ipk.yml?branch=main&style=for-the-badge&label=Build%20%26%20Release&logo=githubactions" alt="Build Status" /></a>
  <img src="https://img.shields.io/badge/Platform-LG%20webOS%204.64%20|%205.0%2B-a50034?style=for-the-badge&logo=lg" alt="LG webOS 4.64+" />
  <img src="https://img.shields.io/badge/Smart%20ABR-Progressive%20Quality%20by%20Buffer-f59e0b?style=for-the-badge" alt="Progressive Quality Ramp-Up" />
  <img src="https://img.shields.io/badge/OTA-Full%20Runtime%20Bundle-8b5cf6?style=for-the-badge" alt="Full Runtime OTA" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License" /></a>
</p>

---

## 📸 Screenshots (v4.9.0)

<p align="center">
  <img src="screenshots/1-browse-live.png" alt="Live TV Main Workspace with Real-Time Israeli EPG, Channel List Mini Progress Bars, True 16:9 960x540 Live Preview, Prev/Now/Next EPG and 5-Show Strip" width="100%" />
  <br />
  <em>Main Split Workspace (v4.9.0): Right-side Wide O(1) Channel List (892px wide) with Real-Time Israeli XMLTV Programmes, Live Mini Progress Bars, Start/End Times &amp; Remaining Minutes per Channel + Left-side True 16:9 (960×540) Live Stream Preview, Previous/Current/Next EPG, and 5-Program Start-Over Strip.</em>
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

## 🚀 What's New in v4.9.0

1. **Direct Fullscreen Boot on Launch (`js/app.js`)**:
   - The application now boots directly into **FULLSCREEN** playback on the last watched channel (or Channel 1), showing the channel banner and live EPG for 4.5 seconds before fading out — delivering an authentic, instant set-top box television experience right from the power button. Pressing `Back` seamlessly reveals the main split channel guide.
2. **TV Hardware Memory Guard &amp; Crash Prevention (`js/epg.js`, `scripts/build-live-epg.js`)**:
   - Solved the severe TV panel crash and reboot issue on newer LG webOS displays caused by IPTV providers linking monolithic international XMLTV feeds (`https://epg.team/3.1.xml` at 307MB+). The app now automatically intercepts monolithic feeds and routes them to our optimized, pre-filtered Israeli feed (`DEFAULT_LIVE_EPG_URL`), enforcing a strict 15MB buffer safety limit to protect webOS WebKit memory.
3. **100% Israeli XMLTV EPG Coverage for All 103 Channels (`epg-il.xml`)**:
   - Unified live programme extractor combining `epg.team/3.1.xml.gz`, `epgshare01`, and `open-epg` with standard `chXXXX` ID mappings and `IL:` channel aliases. Verified 100% schedule match on all Israeli channels: Sport 5 / Plus / Live / Stars / Max / Gold, One 1 / 2, Discovery, Nat Geo, Yes / HOT / Cellcom / Free TV networks, Kan 11, Keshet 12, Reshet 13, and Channel 14.
4. **Cloud-Synced EPG &amp; OTA Updates**:
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
   👉 **[Download `com.iptv.livetv_4.9.0_all.ipk` / `IPTV-Live-webOS.ipk`](https://github.com/maorisraelii/iptv-webos/releases/latest)**
2. Open [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) on your PC with your TV connected.
3. Click **Install App** and select `com.iptv.livetv_4.9.0_all.ipk` (or `IPTV-Live-webOS.ipk`).
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
