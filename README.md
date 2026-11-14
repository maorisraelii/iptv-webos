<p align="center">
  <img src="largeIcon.png" alt="Live TV Logo" width="130" height="130" style="border-radius: 28px; box-shadow: 0 12px 36px rgba(56, 189, 248, 0.3);" />
</p>

<h1 align="center">📺 Live TV for LG webOS (v4.9.6)</h1>

<p align="center">
  An ultra-fast, hardware-accelerated, remote-first <strong>IPTV Live TV &amp; Catch-Up Player</strong> engineered specifically for <strong>LG Smart TVs (webOS 4.0 – 24+)</strong>.<br />
  Features <strong>Generic In-App Active-Playlist EPG Filtering</strong>, <strong>Universal IPTV Timeshift &amp; 7-Day Start-Over</strong>, <strong>7-Day Rolling Live Israeli XMLTV EPG (`epg-il.xml`)</strong>, <strong>Hardware Audio Pipeline &amp; Auto-Unmute Guard</strong>, <strong>Zero EPG Truncation &amp; Stale-While-Revalidate Sync</strong>, <strong>Direct Fullscreen Boot on Launch</strong>, <strong>TV Hardware Memory Crash Guard</strong>, <strong>Numeric Jump Target Channel Preview (0–9)</strong>, <strong>Live Channel-Row Mini Progress Bars</strong>, <strong>Progressive Quality Ramp-Up (Smart ABR by Buffer)</strong>, <strong>True 16:9 (960×540 qHD) Live Preview Workspace</strong>, and <strong>Full-Runtime Over-The-Air (OTA) Cloud Updates</strong>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-4.9.6%20Production-0284c7?style=for-the-badge" alt="Version 4.9.6" />
  <a href="https://github.com/maorisraelii/iptv-webos/actions/workflows/build_ipk.yml"><img src="https://img.shields.io/github/actions/workflow/status/maorisraelii/iptv-webos/build_ipk.yml?branch=main&style=for-the-badge&label=Build%20%26%20Release&logo=githubactions" alt="Build Status" /></a>
  <img src="https://img.shields.io/badge/Platform-LG%20webOS%204.64%20|%205.0%2B-a50034?style=for-the-badge&logo=lg" alt="LG webOS 4.64+" />
  <img src="https://img.shields.io/badge/Start--Over-Universal%20Timeshift%20Catchup-059669?style=for-the-badge" alt="Universal Catch-Up" />
  <img src="https://img.shields.io/badge/Smart%20ABR-Progressive%20Quality%20by%20Buffer-f59e0b?style=for-the-badge" alt="Progressive Quality Ramp-Up" />
  <img src="https://img.shields.io/badge/OTA-Full%20Runtime%20Bundle-8b5cf6?style=for-the-badge" alt="Full Runtime OTA" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License" /></a>
</p>

---

## 📸 Screenshots (v4.9.6)

<p align="center">
  <img src="screenshots/1-browse-live.png" alt="Live TV Main Workspace with Real-Time Israeli EPG, Channel List Mini Progress Bars, True 16:9 960x540 Live Preview, Prev/Now/Next EPG and 5-Show Strip" width="100%" />
  <br />
  <em>Main Split Workspace (v4.9.6): Right-side Wide O(1) Channel List (892px wide) with Real-Time Israeli XMLTV Programmes, Live Mini Progress Bars, Start/End Times &amp; Remaining Minutes per Channel + Left-side True 16:9 (960×540) Live Stream Preview, Previous/Current/Next EPG, and 5-Program Start-Over Strip.</em>
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

## 🚀 What's New in v4.9.6

1. **Live Start-Over & Full Info-Bar Integration (`js/app.js`, `js/player.js`)**:
   - **Start-Over on Currently Airing Programmes**: Pressing the Red button 🔴 in fullscreen (or selecting the live show in the guide/strip) now restarts the currently airing show from `00:00` via catch-up `EVENT` stream (`liveSyncDurationCount: 99999` prevents jumping back to live edge).
   - **Unified Info Bar (`#fullscreen-osd`)**: Removed the corner catch-up badge and seek toasts. Start-Over title, time range, synopsis, live elapsed/total duration (`MM:SS / MM:SS`), and progress bar now update dynamically inside the Info Bar every second, with a dedicated `סטארט אובר` badge. Rewind/Fast-Forward (`◀`/`▶` 15s, Green/Blue 30s) and Pause/Play also update and display the Info Bar directly.

2. **Intuitive Info-Bar Navigation (`▲`/`▼` First-Press)**:
   - Pressing `▲` or `▼` while the Info Bar is hidden now reveals the Info Bar for the **current channel** first; subsequent presses surf to the next/previous channel.

3. **UI Performance & Rendering Optimization (`js/app.js`, `css/style.css`)**:
   - Added `loading="lazy" decoding="async"` to channel row logos, debounced rapid D-pad `previewChannelInfo` updates (`85ms`) for smooth 60fps scrolling, added CSS `contain: layout style paint` & `will-change: transform`, and removed heavy `box-shadow` blur layers for snappier LG webOS WebKit performance.

### Previous Releases (v4.9.5 & Earlier)

1. **Systemic In-App Dynamic EPG Engine (`js/epg.js`, `js/app.js`)**:
   - **Eliminated Hardcoded Playlist Dependencies**: Removed all hardcoded channel IDs and playlist-specific JSON lists (`user-channels.json`, `temp_user_playlist.m3u`).
   - **Active-Playlist Channel Filtering**: The XMLTV parser now filters programmes on-the-fly against the **currently loaded playlist channels**, discarding irrelevant foreign channels instantly. Even if a multi-national feed has 10,000 channels, the TV retains only programmes for the user's active channels, dropping memory usage to < 2MB.
   - **Universal Provider Independence**: If a user loads ANY M3U playlist from any provider or country, the app automatically extracts its defined EPG or user settings, without forcing hardcoded redirects.
   - **7-Day Guide Retention**: Increased in-app parser window from 2 to 7 full days of future programmes.

2. **Universal IPTV Catch-up / Timeshift Protocol Implementation (`js/m3u-parser.js`, `js/player.js`)**:
   - Full support for `catchup-source` template substitution (`${start}`, `${stop}`, `${timestamp}`, `${now}`, `${duration}`, `${offset}`, `{utc}`, `{lutc}`, `{utcend}`), Xtream Codes timeshift, and Flussonic/standard HLS archives.
   - Dynamic auto-detection of stream type rather than assuming one server layout.

3. **Permanent EPG Feed Architecture &amp; TV Safety Guard Fix (`v4.9.4`)**:
   - **Root Cause &amp; Solution for Daily EPG Disappearance**:
     1. Unfiltered supplementary feeds and duplicate programme merging in GitHub Actions caused `epg-il.xml` to swell to 20.46MB.
     2. On the TV, `MAX_SAFE_EPG_BYTES` was set to 15MB, causing the app to abort the download whenever the file exceeded 15MB.
     3. Concurrently, `loadFromLocalCache` discarded expired local data on cold boot after 24h, wiping all schedules to blank.
   - **The Permanent Fix**:
     - **Curated Israeli Feed &amp; Deduplication**: Enforced strict channel filtering and programme deduplication. `epg-il.xml` is now an ultra-compact **7.52MB** (63% size reduction) containing 31,800+ programmes across all 103 user channels and 263 Israeli channels.
     - **Committed User Channels Baseline (`scripts/user-channels.json`)**: Guaranteed that GitHub Actions on remote runners always recognizes all user channels.
     - **Safety Limit Raised to 35MB**: The TV's network fetch will never reject legitimate Israeli feeds.
     - **True Stale-While-Revalidate**: Cached schedules and channel aliases are never dumped on cold boot; they are immediately loaded into memory while background network revalidation refreshes the data.
     - **`getNowNext()` Resiliency**: Routed through `getChannelProgrammes()` so that any gap is seamlessly bridged with deterministic schedules.

2. **Full IPTV Start-Over &amp; 7-Day Timeshift Engine (`v4.9.3`)**:
   - Parses `tvg-rec="7"`, dynamically builds `&utc=...&lutc=...` query parameters, and resets playback to `0:00` of the show.
   - Fixed an issue where clicking Start-Over or selecting past programmes did not play the recorded show.
   - **Root Cause &amp; Solution**: Many modern IPTV providers use `tvg-rec="7"` rather than legacy `catchup="flussonic"`. `M3UParser` now parses `tvg-rec` and accurately maps it to 7 days of timeshift catch-up.
   - In `Player.buildCatchupUrl()`, the timeshift URL is dynamically formatted with precise UTC start and stop bounds (`&utc=${startUnix}&lutc=${stopUnix}`), and HLS playback initializes at `startPosition: 0`, guaranteeing playback begins immediately at minute 0:00 of the broadcast.

2. **7-Day Rolling Live Israeli XMLTV EPG &amp; Continuous Cloud Sync (`scripts/build-live-epg.js`, `.github/workflows/sync_epg.yml`, `js/epg.js`)**:
   - Expanded the EPG generator window from 48h to a full rolling 7-day past catch-up window and 7-day future schedule (now packing 33,500+ programmes across 290 Israeli channels in `epg-il.xml`).
   - Resolved the issue where programmes expired after 48h and left the EPG guide and mini-timeline blank.
   - Added automated Cloud Gist synchronization to the GitHub Actions workflow (`sync_epg.yml`), keeping the public XMLTV feed up-to-date every 6 hours automatically.
   - In `EPGService.getChannelProgrammes()`, if upstream network feeds have gaps or delays, past XML programmes are preserved while seamlessly generating upcoming schedules so the guide and timeline are 100% resilient and never blank.

3. **Hardware Audio Pipeline Guard &amp; Zero Audio-Drop Architecture (`v4.9.2`)**:
   - Active audio watchdog and clean hardware ALSA sink releases prevent silent audio locks during channel zapping or waking up from TV standby.
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
   👉 **[Download `com.iptv.livetv_4.9.6_all.ipk` / `IPTV-Live-webOS.ipk`](https://github.com/maorisraelii/iptv-webos/releases/latest)**
2. Open [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) on your PC with your TV connected.
3. Click **Install App** and select `com.iptv.livetv_4.9.6_all.ipk` (or `IPTV-Live-webOS.ipk`).
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
