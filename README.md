<p align="center">
  <img src="largeIcon.png" alt="Live TV Logo" width="130" height="130" style="border-radius: 28px; box-shadow: 0 12px 36px rgba(56, 189, 248, 0.3);" />
</p>

<h1 align="center">📺 Live TV for LG webOS (v4.5.0)</h1>

<p align="center">
  An ultra-fast, hardware-accelerated, remote-first <strong>IPTV Live TV &amp; Catch-Up Player</strong> engineered specifically for <strong>LG Smart TVs (webOS 4.0 – 24+)</strong>.<br />
  Features a <strong>Smart Adaptive Per-Channel Learning Buffer Engine</strong> (instant zapping on fiber + automatic deep buffering on problematic channels), <strong>True 16:9 (960×540 qHD) Live Preview Workspace</strong>, <strong>O(1) 60fps Spatial Navigation</strong>, <strong>Zero-Typing QR &amp; 4-Digit Cloud M3U Upload</strong>, and <strong>Over-The-Air (OTA) Cloud Updates</strong>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-4.5.0%20Production-0284c7?style=for-the-badge" alt="Version 4.5.0" />
  <a href="https://github.com/maorisraelii/iptv-webos/actions/workflows/build_ipk.yml"><img src="https://img.shields.io/github/actions/workflow/status/maorisraelii/iptv-webos/build_ipk.yml?branch=main&style=for-the-badge&label=Build%20%26%20Release&logo=githubactions" alt="Build Status" /></a>
  <img src="https://img.shields.io/badge/Platform-LG%20webOS%204.64%20|%205.0%2B-a50034?style=for-the-badge&logo=lg" alt="LG webOS 4.64+" />
  <img src="https://img.shields.io/badge/Smart%20Buffer-Fast%20Zap%20%2B%20Per--Channel%20Learning-f59e0b?style=for-the-badge" alt="Smart Adaptive Buffer" />
  <img src="https://img.shields.io/badge/OTA-Cloud%20Auto--Update-8b5cf6?style=for-the-badge" alt="OTA Cloud Auto-Update" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License" /></a>
</p>

---

## 📸 Screenshots (v4.5.0)

<p align="center">
  <img src="screenshots/1-browse-live.png" alt="Live TV Main Workspace with Wide Channel List, True 16:9 960x540 Live Preview, Prev/Now/Next EPG and 5-Show Strip" width="100%" />
  <br />
  <em>Main Split Workspace (v4.5.0): Right-side Wide O(1) Channel List (892px wide, OK-only channel switching) + Left-side True 16:9 (960×540) Live Stream Preview (zero wasted side bars), Previous/Current/Next EPG with Start &amp; End times, and 5-Program Interactive Start-Over Strip.</em>
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

## 🚀 What's New in v4.5.0

1. **Smart Adaptive &amp; Per-Channel Learning Buffer Engine (`js/player.js`)**:
   - **Instant Channel Zapping on Fiber (`liveSyncDurationCount: 2`)**: All healthy channels start playing immediately after just 2 HLS segments (`< 0.4s` on fiber connections) while allowing up to `90s–180s` of forward RAM buffer (`maxBufferLength: 90`, `maxMaxBufferLength: 180`).
   - **Silent Background Cushion Accumulation (`updateAdaptiveCushion`)**: Right after a channel starts playing at the live edge, the player gently glides at an imperceptible `0.97x` rate (with `preservesPitch = true`) until a `16s` safety cushion is accumulated in RAM, then locks back to `1.00x`.
   - **Automatic Per-Channel Stall Detection &amp; Persistent Memory (`zenplay_channel_health_v1`)**:
     - If a specific problematic channel stutters or experiences a buffer/fragment stall, the engine **automatically upgrades only that specific channel** (`Tier 0 ➔ Tier 1 (30s) ➔ Tier 2 (48s) ➔ Tier 3 (65s)`), dynamically deepens its live sync window on the fly, and remembers that channel in `localStorage`.
     - Healthy channels continue to zap at lightning speed (`Tier 0`), while problematic channels automatically receive extra buffering!
     - If a previously problematic channel plays smoothly for 5 consecutive minutes without any stalls, its tier automatically heals step-by-step.

---

## ✨ Highlights from v4.4.0 &amp; v4.3.0

- **True 16:9 (`960×540` qHD) Live Video Preview &amp; Expanded `892px` Channel List (`v4.4.0`)**:
  - Exact `16:9` preview window (`960px × 540px` — half of `1920×1080` Full HD) with zero wasted side pillarbox bars and **73% larger** video picture area, paired with an expanded `892px` channel list column.
- **Zero-Typing QR Code &amp; 4-Digit Cloud M3U Upload (`js/qr-ota.js`, `remote.html`, `manager.html`)**:
  - Scan the inline SVG QR code in **Settings ➔ מקורות שידור (M3U)** with your smartphone or enter the 4-digit TV Pairing Code to beam M3U URLs and local `.m3u` files directly to your TV over HTTPS.
- **Full Over-The-Air (OTA) Cloud Update Engine &amp; Startup Popups (`js/qr-ota.js`, `ota-manifest.json`)**:
  - Automatic OTA check on startup with **"Update Available" (`עדכון גרסה חדש זמין (OTA)`)** and **"Updated Successfully" (`עודכן בהצלחה ✓`)** popups.
- **Version Number Display in Fullscreen Info-Bar &amp; Header (`v4.5.0`)**.

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
   👉 **[Download `com.iptv.livetv_4.5.0_all.ipk` / `IPTV-Live-webOS.ipk`](https://github.com/maorisraelii/iptv-webos/releases/latest)**
2. Open [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) on your PC with your TV connected.
3. Click **Install App** and select `com.iptv.livetv_4.5.0_all.ipk` (or `IPTV-Live-webOS.ipk`).
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
