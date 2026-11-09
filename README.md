<p align="center">
  <img src="largeIcon.png" alt="Live TV Logo" width="130" height="130" style="border-radius: 28px; box-shadow: 0 12px 36px rgba(56, 189, 248, 0.3);" />
</p>

<h1 align="center">📺 Live TV for LG webOS</h1>

<p align="center">
  A lightweight, ultra-fast, remote-first <strong>IPTV Live TV Player</strong> designed specifically for <strong>LG Smart TVs (webOS)</strong>.<br />
  Inspired by the premium UX of <strong>ZenPlay</strong>, built exclusively for <strong>Live TV &amp; M3U playlists</strong>, compatible with <strong>webOS 4.64 &amp; webOS 5.0+</strong>, and featuring <strong>instant Over-The-Air (OTA) cloud updates</strong> without ever needing to reinstall the app!
</p>

<p align="center">
  <a href="https://github.com/maorisraelii/iptv-webos/actions/workflows/build_ipk.yml"><img src="https://img.shields.io/github/actions/workflow/status/maorisraelii/iptv-webos/build_ipk.yml?branch=main&style=for-the-badge&label=Build%20%26%20Release&logo=githubactions" alt="Build Status" /></a>
  <img src="https://img.shields.io/badge/Platform-LG%20webOS%204.64%20|%205.0%2B-a50034?style=for-the-badge&logo=lg" alt="LG webOS 4.64+" />
  <img src="https://img.shields.io/badge/Updates-Over--The--Air%20(OTA)-blue?style=for-the-badge&logo=cloudflared" alt="OTA Updates" />
  <img src="https://img.shields.io/badge/Resolution-1080p%20FHD-green?style=for-the-badge" alt="1080p FHD" />
  <img src="https://img.shields.io/badge/Content-Live%20TV%20Only-orange?style=for-the-badge" alt="Live TV Only" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License" /></a>
</p>

---

## 📸 Screenshots

<p align="center">
  <img src="screenshots/1-browse-live.png" alt="Live TV Main Screen with Channel Sidebar and 16:9 Live Preview" width="100%" />
  <br />
  <em>Main Browsing View: Channel lineup with live preview and instant OK to fullscreen.</em>
</p>

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="screenshots/2-category-rail.png" alt="Collapsible Category Rail" />
      <p align="center"><strong>Collapsible Category Rail</strong><br />Quick access to Favorites (★), All Channels, and M3U group categories.</p>
    </td>
    <td width="50%" valign="top">
      <img src="screenshots/3-settings-modal.png" alt="Settings Modal with Virtual On-Screen Keyboard" />
      <p align="center"><strong>Settings &amp; TV Keyboard</strong><br />Easily configure M3U URLs using the remote D-pad without an external keyboard.</p>
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <img src="screenshots/4-search-modal.png" alt="Live Channel Search with Virtual Keyboard" />
      <p align="center"><strong>Instant Channel Search</strong><br />Real-time channel filtering and search across all groups.</p>
    </td>
  </tr>
</table>

---

## ✨ Key Highlights

- ⚡ **Over-The-Air (OTA) Cloud Updates**:
  - No need to reconnect your PC or reinstall `.ipk` packages whenever code changes.
  - Features an intelligent **Smart Bootstrapper** (`js/loader.js`): on startup, it checks GitHub Pages / cloud host for updates and loads the newest version immediately.
  - If offline or if the network is disconnected, it immediately falls back to the local bundled version with zero delay.

- 🎯 **100% Focused on Live TV**:
  - No VOD, movies, or series clutter — dedicated strictly to streaming live channels.
  - Ultra-fast streaming parser for **M3U / M3U8** files.
  - Automatic category grouping based on `group-title`, with channel numbers (`tvg-chno`), logos (`tvg-logo`), and favorites (★).

- 🎮 **100% Remote-First UX (Built for Couch Viewing)**:
  - Designed around 5-way D-Pad remote navigation.
  - **Single-Press OK**: Instant fullscreen playback with seamless video handoff (no decoder restart or stream re-buffering).
  - **Fullscreen Info-Bar Channel Surfing**: D-Pad Up / Down zaps through the info bar with live show synopsis and progress **without interrupting the current video**, switching stream only when pressing **OK** (or cancelling with **Back**).
  - **Back Key (webOS 461 / ESC)**: Smoothly transitions from fullscreen back to the channel guide, or cancels surfing mode.
  - **Dedicated Color Buttons**:
    - 🔴 **Red**: Start Over (↺ rewind to stream start).
    - 🟢 **Green**: Rewind 30 seconds (⏪).
    - 🟡 **Yellow**: Pause / Play (⏯).
    - 🔵 **Blue**: Fast Forward 30 seconds (⏩).
  - **0-9 Keypad**: Numeric direct channel jump with on-screen confirmation badge.
  - **Channel Up / Down (CH+ / CH-)**: Immediate channel switching during fullscreen playback.
  - Full support for the **LG Magic Remote air-mouse cursor**.

- 📅 **Integrated EPG (Electronic Program Guide) & Synopsis**:
  - Automatically loads XMLTV guide from M3U headers (`url-tvg` / `x-tvg-url`) or user-configured EPG URL.
  - High-accuracy intelligent fallback engine: Channels *always* show current show, timeline progress bar, detailed synopsis (תקציר), and upcoming show.

- 📺 **Full Compatibility with webOS 4.64 &amp; 5.0+**:
  - Extremely lightweight vanilla architecture (memory footprint < 15MB vs 150MB+ in heavy frameworks).
  - Uses the official `@webos-tools/cli` packager with compliant `requiredACG: []` metadata — eliminates the `-5: ipk verified failed` error.
  - Hybrid player: Native HTML5 video engine + local bundled `Hls.js` with auto-reconnect &amp; recovery.

---

## 🎮 Remote Control Mapping

| Remote Button | Action in Browse Mode | Action in Fullscreen Mode |
| :--- | :--- | :--- |
| **D-Pad Up / Down** | Scroll through channels / categories | **Info-Bar Channel Surfing** (preview channel & synopsis without switching stream) |
| **D-Pad Left / Right** | Open Category Rail / Preview Actions | Rewind 15s (Left) / Fast-Forward 15s (Right) |
| **OK / Enter** | **Enter Fullscreen Playback** | **Confirm Channel Switch** (if surfing) / Show OSD |
| **Back (461 / ESC)** | Return to Category Rail / Exit prompt | **Cancel Surfing / Exit Fullscreen to Guide** |
| **Red Button 🔴** | Start Over (↺ stream beginning) | Start Over (↺ stream beginning) |
| **Green Button 🟢** | Rewind 30s (⏪) | Rewind 30s (⏪) |
| **Yellow Button 🟡** | Pause / Play (⏯) | Pause / Play (⏯) |
| **Blue Button 🔵** | Fast-Forward 30s (⏩) | Fast-Forward 30s (⏩) |
| **CH+ / CH−** | Page Up / Down channel list | Switch to Previous / Next Channel |
| **0 – 9 (Digits)** | Type channel number &amp; jump | Type channel number &amp; jump |

---

## 📦 Download &amp; Installation

### Method 1: Direct Download via GitHub Releases (Recommended)
1. Download the latest pre-built package:
   👉 **[Download IPTV-Live-webOS.ipk (Latest Release)](https://github.com/maorisraelii/iptv-webos/releases/latest)**
2. Open [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) on your PC with your TV connected.
3. Click **Install App** and select `IPTV-Live-webOS.ipk`.
4. The app will install immediately on your LG TV home launcher!

---

### Method 2: 1-Click Local Build &amp; Direct TV Install (PowerShell)
Run the automated packaging script from your terminal:
```powershell
.\package_ipk.ps1
```
To install directly to a configured TV device:
```powershell
.\package_ipk.ps1 -Device tv
```

---

### Method 3: Official webOS CLI
```bash
# Package from clean directory
npm run package

# Install directly to your TV
npx ares-install com.iptv.livetv_1.0.0_all.ipk -d <tv-device-name>
```

---

## 🛠️ Troubleshooting: Resolving `-5: ipk verified failed`

If webOS Dev Manager or `ares-install` returns `-5: ipk verified failed`, verify the following:
1. **TV Date &amp; Time Out of Sync (Most Common Cause)**:
   - On your LG TV, go to: **Settings ➔ General ➔ Time &amp; Date**.
   - Make sure your TV's clock, date, and timezone are set accurately. If set to "Automatic", toggle it off and on or set it manually. The webOS security verification system will reject any package if the TV's internal clock is incorrect.
2. **Use the Latest Package**:
   - Install `IPTV-Live-webOS.ipk` built with `@webos-tools/cli` and `requiredACG: []` (already updated in this repository).
3. **Developer Mode Session**:
   - Ensure the LG **Developer Mode** app on your TV is active and the timer has not expired.

---

## 💻 Local Testing &amp; Development

You can run and test the TV application directly in your web browser:
```bash
npm start
```
Then open your browser at:
```
http://localhost:3000/
```
*(Keyboard arrows, Enter, Esc, and number keys replicate TV remote controls).*

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.  
*Disclaimer: This software is purely a media player client and does not bundle, host, or distribute any IPTV streams or copyrighted content.*
