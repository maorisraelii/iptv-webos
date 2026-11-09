<p align="center">
  <img src="largeIcon.png" alt="Live TV Logo" width="130" height="130" style="border-radius: 28px; box-shadow: 0 12px 36px rgba(56, 189, 248, 0.3);" />
</p>

<h1 align="center">📺 Live TV for LG webOS (v4.2.0)</h1>

<p align="center">
  An ultra-fast, hardware-accelerated, remote-first <strong>IPTV Live TV &amp; Catch-Up Player</strong> engineered specifically for <strong>LG Smart TVs (webOS 4.0 – 24+)</strong>.<br />
  Features an <strong>O(1) 60fps Spatial Navigation Engine</strong>, <strong>&lt; 90ms Instant Cold Boot</strong>, <strong>Anti-Freeze HLS Buffer Profiles (up to 120s)</strong>, <strong>7-Day Bounded Program Guide with 1-Click Start-Over</strong>, <strong>Multi-M3U Lineup Merger</strong>, and a companion <strong>PC Web Studio</strong> for effortless playlist and channel management from your computer.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-4.2.0%20Production-0284c7?style=for-the-badge" alt="Version 4.2.0" />
  <a href="https://github.com/maorisraelii/iptv-webos/actions/workflows/build_ipk.yml"><img src="https://img.shields.io/github/actions/workflow/status/maorisraelii/iptv-webos/build_ipk.yml?branch=main&style=for-the-badge&label=Build%20%26%20Release&logo=githubactions" alt="Build Status" /></a>
  <img src="https://img.shields.io/badge/Platform-LG%20webOS%204.64%20|%205.0%2B-a50034?style=for-the-badge&logo=lg" alt="LG webOS 4.64+" />
  <img src="https://img.shields.io/badge/Engine-O(1)%2060fps%20Hardware%20UI-10b981?style=for-the-badge" alt="60fps Hardware UI" />
  <img src="https://img.shields.io/badge/Anti--Freeze-Up%20to%20120s%20Buffer-f59e0b?style=for-the-badge" alt="Anti-Freeze Buffer" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License" /></a>
</p>

---

## 📸 Screenshots (v4.2.0)

<p align="center">
  <img src="screenshots/1-browse-live.png" alt="Live TV Main Workspace with Channel List, Live Preview, Prev/Now/Next EPG and 5-Show Strip" width="100%" />
  <br />
  <em>Main Split Workspace: Right-side O(1) Channel List (OK-only channel switching) + Left-side 16:9 Live Stream Preview, Previous/Current/Next EPG with Start &amp; End times, and 5-Program Interactive Start-Over Strip.</em>
</p>

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="screenshots/2-category-rail.png" alt="7-Day Channel Program Guide Modal (Yellow Button)" />
      <p align="center"><strong>7-Day Channel Program Guide (Yellow Button)</strong><br />Bounded 7-day catch-up history organized by day tabs (<code>◀ / ▶</code>) with 1-click Start-Over.</p>
    </td>
    <td width="50%" valign="top">
      <img src="screenshots/3-settings-modal.png" alt="Anti-Freeze Buffer & Smart EPG Cache Settings" />
      <p align="center"><strong>Anti-Freeze Buffer &amp; Smart Cache Settings</strong><br />Configurable HLS Live Buffer (15s / 35s / 65s / 120s) and EPG/Lineup Cache TTL (24h / 3d / 7d / Manual).</p>
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <img src="screenshots/4-search-modal.png" alt="PC Web Studio for Multi-M3U & Custom Channel Numbering" />
      <p align="center"><strong>PC Web Studio (<code>manager.html</code>)</strong><br />Manage multiple M3U sources, toggle channels on/off, assign custom channel numbers, and sync to your LG TV in 1 click over LAN.</p>
    </td>
  </tr>
</table>

---

## 🚀 What's New in v4.2.0

1. **Pure Inline SVG Vector Icons & Smart Channel Monograms**:
   - Replaced all system emoji glyphs with crisp inline `<svg>` vector icons and geometric CSS badges so every icon renders sharply across all LG webOS firmware versions (including webOS 4.x / Chromium 53).
   - Smart channel logo loader with instant monogram badges (`11`, `12`, `13`, `14`, `i24`, etc.) that seamlessly swap to the channel logo image only after verifying `naturalWidth > 2`.
2. **OK-Only Channel Switching on Main Screen**:
   - Navigating `▲ / ▼` in the main channel list highlights channels and previews their EPG synopsis and 5-program timeline on the left **without interrupting the currently playing video stream**.
   - Pressing **OK** once on a highlighted channel switches the live stream to that channel; pressing **OK** on the already-playing channel enters **Fullscreen**.
3. **Previous, Current & Next Programmes with Start & End Times in Info-Bar**:
   - Both the Fullscreen Info-Bar (`#fullscreen-osd`) and the Main Screen EPG Card display:
     - **Previous Programme (`הקודמת`)** with full `Start - End` time (`HH:MM - HH:MM`).
     - **Current Live Programme (`משודר כעת`)** with `Start - End` time, progress bar, and full synopsis.
     - **Next Programme (`הבאה בתור`)** with full `Start - End` time (`HH:MM - HH:MM`).
4. **2-Step Center Button (`OK`) Pause / Play in Fullscreen**:
   - **1st press of `OK`** (when the Fullscreen Info-Bar is hidden): Brings up the Info-Bar overlay without pausing playback.
   - **2nd press of `OK`** (while the Info-Bar is visible): Toggles **Pause / Play** (`❚❚ מושהה` / `▶ המשך ניגון`).
   - *(If surfing channels in the Info-Bar with `▲ / ▼`, pressing `OK` switches to the surfed channel).*

---

## ✨ Core Architecture & Performance Highlights

- ⚡ **Instant Cold Boot (`< 90ms`) & O(1) Focus Engine**:
  - Boots directly into `index.html` and renders the compiled channel lineup from `localStorage` cache in under 90ms.
  - Zero-reflow O(1) focus navigation (`3.1ms` per step) using pre-cached DOM row references and integer `offsetTop` math — no `backdrop-filter`, heavy box-shadows, or layout thrashing on older TV CPUs.
- 🛡️ **Anti-Freeze HLS Engine & Stall Watchdog (`js/player.js`)**:
  - User-selectable live buffer profiles in **Settings ➔ באפר וקאש (נגד תקיעות)**:
    - **Fast (`15s`)**: Ultra-fast channel zapping for stable fiber connections.
    - **Balanced (`35s`)**: Balanced zapping speed and stream stability.
    - **Deep Anti-Freeze (`65s` — Default)**: Absorbs ISP/CDN micro-drops and prevents periodic freezes.
    - **Extreme (`120s`)**: Maximum 2-minute RAM/buffer cushion for congested IPTV servers or Wi-Fi.
  - Built-in **Stall Watchdog** automatically nudges playback across TS timestamp gaps (`maxBufferHole: 0.8`) and seamlessly recovers from network or media stalls.
- 🗓️ **Smart EPG & Lineup Cache TTL (`js/epg.js`, `js/lineup-store.js`)**:
  - Configurable refresh intervals: **Every 24 Hours (Default)**, **Every 3 Days (72h)**, **Once a Week (168h)**, or **Manual Only**, preventing heavy XMLTV/M3U downloads from slowing down app startup.
- 📅 **7-Day Channel Program Guide & 1-Click Start-Over (Catch-Up)**:
  - Press the **Yellow Button** (`405`) anywhere to open the 7-Day Channel Guide organized by day tabs (`היום`, `אתמול`, up to 7 days back) for lag-free day-by-day zapping (`◀ / ▶`).
  - Select any past programme in the 7-Day Guide or the 5-show Mini Program Strip on the main screen and press **OK** to launch **Start-Over / Catch-Up** playback (`timeshift` / `utc` / `catchup-source` / HLS live-window seek).
- 💻 **Multi-M3U Lineup Merger & PC Web Studio (`manager.html` + `sync-server.js`)**:
  - Combine multiple M3U playlists into one unified channel list.
  - Enable/disable specific channels from each playlist and assign custom channel numbers (`#1`, `#11`, `#12`, etc.) either directly on the TV or from your PC browser via `manager.html`.

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

## 💻 Managing Playlists from Your PC (PC Web Studio)

Instead of typing long M3U URLs with the TV remote, you can manage all your M3U sources and channel numbers from your computer:

1. Start the local PC Studio server on your computer:
   ```bash
   npm run studio
   ```
2. Open the printed URL in your PC browser (e.g., `http://localhost:8765/manager.html`).
3. Add one or more M3U URLs, click **טען ומזג ערוצים**, check/uncheck the channels you want, and customize their channel numbers.
4. On your LG TV, open **הגדרות ו-M3U**, enter your PC's LAN IP address shown in the terminal (e.g., `192.168.1.100:8765`), and click **סנכרן מהמחשב כעת**!

---

## 📦 Download &amp; Installation

### Method 1: Direct Download via GitHub Releases (Recommended)
1. Download the latest pre-built package from Releases:
   👉 **[Download `com.iptv.livetv_4.2.0_all.ipk` / `IPTV-Live-webOS.ipk`](https://github.com/maorisraelii/iptv-webos/releases/latest)**
2. Open [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) on your PC with your TV connected.
3. Click **Install App** and select `com.iptv.livetv_4.2.0_all.ipk` (or `IPTV-Live-webOS.ipk`).

### Method 2: 1-Click Local Build &amp; Direct TV Install (PowerShell)
```powershell
# Build .ipk package locally
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
