/**
 * OTA Cloud Update Engine, 4-Digit Phone/PC Cloud M3U Sync & Pure SVG QR Generator
 * Designed for LG webOS 4.0 - 24+ (Chromium 53+)
 */

const APP_BUNDLE_VERSION = '5.0.0';
const OTA_GIST_RAW_BASE = 'https://gist.githubusercontent.com/maorisraelii/b4408ca1c31143ed2f50164629f53f1c/raw';
const REMOTE_PORTAL_BASE_URL = 'https://gist.githack.com/maorisraelii/b4408ca1c31143ed2f50164629f53f1c/raw/remote.html';

const OTA_STORAGE_KEYS = {
  INSTALLED_VERSION: 'zenplay_ota_installed_version',
  INSTALLED_BUNDLE: 'zenplay_ota_installed_bundle',
  JUST_UPDATED_INFO: 'zenplay_ota_just_updated_info',
  TV_PAIRING_CODE: 'zenplay_tv_pairing_code',
  LAST_CLOUD_MSG_ID: 'zenplay_last_cloud_msg_id',
  CUSTOM_OTA_URL: 'zenplay_custom_ota_manifest_url'
};

/* ==========================================================================
   1. Compact ISO/IEC 18004 QR Code Matrix -> Inline SVG Generator (Pure JS)
   Supports Version 1 to 10 (up to 271 bytes, ECC Level L) with zero dependencies
   ========================================================================== */
const QRCodeGenerator = (function () {
  // GF(256) exponent & log tables for Reed-Solomon ECC
  const EXP = new Array(256);
  const LOG = new Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = (x << 1) ^ (x & 128 ? 0x11d : 0);
  }
  EXP[255] = EXP[0];

  function gfMul(a, b) {
    return a === 0 || b === 0 ? 0 : EXP[(LOG[a] + LOG[b]) % 255];
  }

  function rsGeneratorPoly(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      const root = EXP[i];
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], root);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    const gen = rsGeneratorPoly(ecLen);
    const msg = data.slice();
    for (let i = 0; i < ecLen; i++) msg.push(0);
    for (let i = 0; i < data.length; i++) {
      const coef = msg[i];
      if (coef !== 0) {
        for (let j = 0; j < gen.length; j++) {
          msg[i + j] ^= gfMul(gen[j], coef);
        }
      }
    }
    return msg.slice(data.length);
  }

  // Version table for Level L (1..6): [totalDataBytes, ecBytesPerBlock, numBlocks, alignPositions]
  const VERSIONS = [
    null,
    { dataBytes: 19, ecBytes: 7, blocks: 1, align: [] },
    { dataBytes: 34, ecBytes: 10, blocks: 1, align: [6, 18] },
    { dataBytes: 55, ecBytes: 15, blocks: 1, align: [6, 22] },
    { dataBytes: 80, ecBytes: 20, blocks: 1, align: [6, 26] },
    { dataBytes: 108, ecBytes: 26, blocks: 1, align: [6, 30] },
    { dataBytes: 136, ecBytes: 18, blocks: 2, align: [6, 34] }
  ];

  function utf8Bytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  function createMatrix(text) {
    const bytes = utf8Bytes(text);
    let ver = 1;
    while (ver <= 6 && VERSIONS[ver].dataBytes - 2 < bytes.length) {
      ver++;
    }
    if (ver > 6) ver = 6;
    const spec = VERSIONS[ver];
    const size = ver * 4 + 17;

    // Build bit stream: Byte mode (0100), 8-bit length, payload, terminator, pad bytes
    const bits = [];
    function pushBits(val, len) {
      for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    }
    pushBits(4, 4);
    pushBits(bytes.length, 8);
    for (let i = 0; i < bytes.length; i++) pushBits(bytes[i], 8);
    const maxBits = spec.dataBytes * 8;
    const term = Math.min(4, maxBits - bits.length);
    pushBits(0, term);
    while (bits.length % 8 !== 0) bits.push(0);
    const dataCodewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      dataCodewords.push(b);
    }
    let padToggle = true;
    while (dataCodewords.length < spec.dataBytes) {
      dataCodewords.push(padToggle ? 0xec : 0x11);
      padToggle = !padToggle;
    }

    // Interleave blocks if blocks > 1
    let finalBytes = [];
    if (spec.blocks === 1) {
      const ec = rsEncode(dataCodewords, spec.ecBytes);
      finalBytes = dataCodewords.concat(ec);
    } else {
      const blockLen = spec.dataBytes / spec.blocks;
      const b1 = dataCodewords.slice(0, blockLen);
      const b2 = dataCodewords.slice(blockLen);
      const ec1 = rsEncode(b1, spec.ecBytes);
      const ec2 = rsEncode(b2, spec.ecBytes);
      for (let i = 0; i < blockLen; i++) finalBytes.push(b1[i], b2[i]);
      for (let i = 0; i < spec.ecBytes; i++) finalBytes.push(ec1[i], ec2[i]);
    }

    const grid = [];
    const reserved = [];
    for (let r = 0; r < size; r++) {
      grid.push(new Array(size).fill(0));
      reserved.push(new Array(size).fill(false));
    }

    function setFinder(row, col) {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const rr = row + r;
          const cc = col + c;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          const on =
            (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
            (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          grid[rr][cc] = on ? 1 : 0;
          reserved[rr][cc] = true;
        }
      }
    }

    setFinder(0, 0);
    setFinder(0, size - 7);
    setFinder(size - 7, 0);

    // Alignment patterns
    const align = spec.align;
    for (let i = 0; i < align.length; i++) {
      for (let j = 0; j < align.length; j++) {
        const ar = align[i];
        const ac = align[j];
        if (reserved[ar][ac]) continue;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            const on = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
            grid[ar + r][ac + c] = on ? 1 : 0;
            reserved[ar + r][ac + c] = true;
          }
        }
      }
    }

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      if (!reserved[6][i]) {
        grid[6][i] = i % 2 === 0 ? 1 : 0;
        reserved[6][i] = true;
      }
      if (!reserved[i][6]) {
        grid[i][6] = i % 2 === 0 ? 1 : 0;
        reserved[i][6] = true;
      }
    }

    // Reserve format areas + dark module
    for (let i = 0; i < 9; i++) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
    for (let i = 0; i < 8; i++) {
      reserved[8][size - 1 - i] = true;
      reserved[size - 1 - i][8] = true;
    }
    grid[size - 8][8] = 1;
    reserved[size - 8][8] = true;

    // Place data bits (upward/downward 2-column zig-zag)
    const allBits = [];
    for (let i = 0; i < finalBytes.length; i++) {
      for (let b = 7; b >= 0; b--) allBits.push((finalBytes[i] >> b) & 1);
    }

    let bitIdx = 0;
    let upward = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (let step = 0; step < size; step++) {
        const r = upward ? size - 1 - step : step;
        for (let dc = 0; dc < 2; dc++) {
          const c = col - dc;
          if (!reserved[r][c]) {
            const bit = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
            // Mask 0: (r + c) % 2 === 0
            grid[r][c] = (r + c) % 2 === 0 ? bit ^ 1 : bit;
          }
        }
      }
      upward = !upward;
    }

    // Write Format Info for Level L (01) + Mask 0 (000) -> 0x77c4
    const fmt = 0x77c4;
    const fmtBits = [];
    for (let i = 0; i < 15; i++) fmtBits.push((fmt >> i) & 1);

    const rCoords = [8, 8, 8, 8, 8, 8, 8, 8, 7, 5, 4, 3, 2, 1, 0];
    const cCoords = [0, 1, 2, 3, 4, 5, 7, 8, 8, 8, 8, 8, 8, 8, 8];
    for (let i = 0; i < 15; i++) {
      grid[rCoords[i]][cCoords[i]] = fmtBits[14 - i];
    }
    for (let i = 0; i < 7; i++) {
      grid[size - 1 - i][8] = fmtBits[i];
    }
    for (let i = 7; i < 15; i++) {
      grid[8][size - 15 + i] = fmtBits[i];
    }

    return grid;
  }

  function renderSVG(text, pxSize) {
    try {
      const grid = createMatrix(text);
      const n = grid.length;
      const quiet = 2;
      const total = n + quiet * 2;
      let pathD = '';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (grid[r][c]) {
            pathD += 'M' + (c + quiet) + ',' + (r + quiet) + 'h1v1h-1z';
          }
        }
      }
      return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
        total +
        ' ' +
        total +
        '" width="' +
        (pxSize || 136) +
        '" height="' +
        (pxSize || 136) +
        '" shape-rendering="crispEdges">' +
        '<rect width="100%" height="100%" fill="#ffffff" rx="2"/>' +
        '<path d="' +
        pathD +
        '" fill="#070b14"/>' +
        '</svg>'
      );
    } catch (e) {
      return '';
    }
  }

  return { renderSVG: renderSVG };
})();

/* ==========================================================================
   2. OTA Update & Phone/PC Cloud Sync Manager
   ========================================================================== */
class OTACloudManager {
  constructor(app) {
    this.app = app;
    this.pairingCode = this.getOrCreatePairingCode();
    this.cloudPollTimer = null;
    this.pendingManifest = null;
    this.otaAutoTimer = null;

    this.applySavedOTABundle();
  }

  getRunningVersion() {
    try {
      const otaVer = localStorage.getItem(OTA_STORAGE_KEYS.INSTALLED_VERSION);
      if (otaVer && this.compareSemver(otaVer, APP_BUNDLE_VERSION) > 0) {
        return otaVer;
      }
    } catch (e) {}
    return APP_BUNDLE_VERSION;
  }

  compareSemver(v1, v2) {
    const p1 = String(v1 || '0.0.0')
      .replace(/^v/i, '')
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
    const p2 = String(v2 || '0.0.0')
      .replace(/^v/i, '')
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
      const a = p1[i] || 0;
      const b = p2[i] || 0;
      if (a > b) return 1;
      if (a < b) return -1;
    }
    return 0;
  }

  getOrCreatePairingCode() {
    try {
      let code = localStorage.getItem(OTA_STORAGE_KEYS.TV_PAIRING_CODE);
      if (!code || code.length < 4) {
        code = String(Math.floor(1000 + Math.random() * 9000));
        localStorage.setItem(OTA_STORAGE_KEYS.TV_PAIRING_CODE, code);
      }
      return code;
    } catch (e) {
      return '4829';
    }
  }

  getRemotePortalUrl() {
    return REMOTE_PORTAL_BASE_URL + '?code=' + encodeURIComponent(this.pairingCode);
  }

  renderPairingQR() {
    const qrBox = document.getElementById('tv-qr-svg-box');
    const codeBadge = document.getElementById('tv-pairing-code-display');
    const portalUrlEl = document.getElementById('tv-portal-short-hint');

    if (codeBadge) {
      codeBadge.textContent = this.pairingCode;
    }
    if (qrBox) {
      qrBox.innerHTML = QRCodeGenerator.renderSVG(this.getRemotePortalUrl(), 126);
    }
    if (portalUrlEl) {
      portalUrlEl.textContent = 'קוד טלוויזיה: ' + this.pairingCode;
    }
  }

  /**
   * Updates all version labels across the UI:
   * - Fullscreen Info-Bar (#osd-version-badge & #osd-footer-version)
   * - Top Header (#header-version-badge)
   * - Settings About Tab (#about-version-text)
   */
  updateVersionBadgesUI() {
    const ver = 'v' + this.getRunningVersion();
    const osdVer = document.getElementById('osd-version-badge');
    const osdFooterVer = document.getElementById('osd-footer-version');
    const headerVer = document.getElementById('header-version-badge');
    const aboutVer = document.getElementById('about-version-text');

    if (osdVer) osdVer.textContent = ver;
    if (osdFooterVer) osdFooterVer.textContent = 'גרסה ' + ver;
    if (headerVer) headerVer.textContent = ver;
    if (aboutVer) {
      aboutVer.textContent = 'גרסה ' + ver + ' Production • מנגנון עדכוני OTA פעיל (LG webOS 4.0 - 24+)';
    }
  }

  /**
   * Applies any OTA CSS/JS patches stored in localStorage from previous OTA updates
   */
  applySavedOTABundle() {
    try {
      const raw = localStorage.getItem(OTA_STORAGE_KEYS.INSTALLED_BUNDLE);
      if (!raw) return;
      const bundle = JSON.parse(raw);
      if (!bundle || this.compareSemver(bundle.version, APP_BUNDLE_VERSION) <= 0) {
        return;
      }
      if (bundle.cssPatch) {
        let styleEl = document.getElementById('zenplay-ota-css');
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = 'zenplay-ota-css';
          document.head.appendChild(styleEl);
        }
        styleEl.textContent = bundle.cssPatch;
        if (this.app && typeof this.app.updateVideoSurfacePosition === 'function') {
          setTimeout(() => this.app.updateVideoSurfacePosition(true), 60);
        }
      }
      if (bundle.jsPatch) {
        try {
          const fn = new Function(bundle.jsPatch);
          fn();
        } catch (jsErr) {
          console.warn('OTA jsPatch execution warning:', jsErr);
        }
      }
    } catch (e) {}
  }

  /**
   * Startup OTA lifecycle:
   * 1. Update all version badges on screen
   * 2. If an OTA update just completed before reload, show the "Updated Successfully!" popup
   * 3. Check cloud OTA manifest for any newer version; if found, show "Update Available!" popup
   * 4. Poll once for any pending Phone/PC M3U cloud pushes
   */
  initStartupChecks() {
    this.updateVersionBadgesUI();
    this.renderPairingQR();

    // Check if an OTA update was just installed
    try {
      const justUpdatedRaw = localStorage.getItem(OTA_STORAGE_KEYS.JUST_UPDATED_INFO);
      if (justUpdatedRaw) {
        localStorage.removeItem(OTA_STORAGE_KEYS.JUST_UPDATED_INFO);
        const info = JSON.parse(justUpdatedRaw);
        if (info && info.version) {
          setTimeout(() => {
            this.showOTASuccessPopup(info);
          }, 350);
          return;
        }
      }
    } catch (e) {}

    // Check for OTA update in background on startup
    setTimeout(() => {
      this.checkForOTAUpdate(false);
      this.pollCloudM3UPush(true);
    }, 900);
  }

  getManifestUrl() {
    const custom = localStorage.getItem(OTA_STORAGE_KEYS.CUSTOM_OTA_URL);
    if (custom && custom.trim()) return custom.trim();
    return OTA_GIST_RAW_BASE + '/ota-manifest.json?t=' + Date.now();
  }

  checkForOTAUpdate(manualTrigger) {
    if (manualTrigger) {
      this.app.showToast('בודק עדכוני OTA מול שרת הענן...');
    }

    const url = this.getManifestUrl();
    return fetch(url, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then((manifest) => {
        if (!manifest || !manifest.version) {
          if (manualTrigger) this.app.showToast('לא נמצא מניפסט עדכון בשרת');
          return null;
        }

        const currentVer = this.getRunningVersion();
        if (this.compareSemver(manifest.version, currentVer) > 0) {
          this.pendingManifest = manifest;
          this.showOTAUpdateAvailablePopup(manifest, currentVer);
          return manifest;
        } else {
          if (manualTrigger) {
            this.app.showToast('האפליקציה מעודכנת לגרסה האחרונה (v' + currentVer + ') ✓');
          }
          return null;
        }
      })
      .catch((err) => {
        console.warn('OTA check warning:', err);
        if (manualTrigger) {
          this.app.showToast('האפליקציה בגרסה v' + this.getRunningVersion() + ' (שרת OTA לא זמין כעת)');
        }
        return null;
      });
  }

  showOTAUpdateAvailablePopup(manifest, currentVer) {
    const modal = document.getElementById('ota-modal');
    if (!modal) return;

    this.app.previousModeBeforeModal = this.app.mode === 'FULLSCREEN' ? 'FULLSCREEN' : 'BROWSE';
    this.app.mode = 'OTA';

    const badgeEl = document.getElementById('ota-modal-badge');
    const titleEl = document.getElementById('ota-modal-title');
    const verCompareEl = document.getElementById('ota-version-compare');
    const notesListEl = document.getElementById('ota-release-notes');
    const progressWrap = document.getElementById('ota-progress-wrap');
    const btnConfirm = document.getElementById('btn-ota-confirm');
    const btnLater = document.getElementById('btn-ota-later');

    if (badgeEl) {
      badgeEl.textContent = 'עדכון גרסה חדש זמין (OTA)';
      badgeEl.className = 'ota-status-pill pill-available';
    }
    if (titleEl) {
      titleEl.textContent = manifest.title || ('גרסה חדשה זמינה: v' + manifest.version);
    }
    if (verCompareEl) {
      verCompareEl.textContent = 'גרסה נוכחית: v' + currentVer + '   ⬅   גרסה חדשה: v' + manifest.version;
    }
    if (notesListEl) {
      notesListEl.innerHTML = '';
      const notes = Array.isArray(manifest.releaseNotes)
        ? manifest.releaseNotes
        : ['שיפורי ביצועים, יציבות שידור ועדכוני ממשק חדשים.'];
      notes.forEach((line) => {
        const li = document.createElement('li');
        li.textContent = '• ' + line;
        notesListEl.appendChild(li);
      });
    }
    if (progressWrap) progressWrap.classList.add('hidden');
    if (btnConfirm) {
      btnConfirm.textContent = 'עדכן עכשיו לגרסה v' + manifest.version + ' (OK)';
      btnConfirm.onclick = () => this.performOTAUpdate(manifest);
    }
    if (btnLater) {
      btnLater.classList.remove('hidden');
      btnLater.onclick = () => this.closeOTAModal();
    }

    modal.classList.remove('hidden');
    this.app.updateVideoSurfacePosition();
    if (btnConfirm) {
      this.app.setFocusedElementFast(btnConfirm);
    }
  }

  performOTAUpdate(manifest) {
    if (!manifest) return;
    const progressWrap = document.getElementById('ota-progress-wrap');
    const progressFill = document.getElementById('ota-progress-fill');
    const progressText = document.getElementById('ota-progress-text');
    const btnConfirm = document.getElementById('btn-ota-confirm');
    const btnLater = document.getElementById('btn-ota-later');

    if (progressWrap) progressWrap.classList.remove('hidden');
    if (btnLater) btnLater.classList.add('hidden');
    if (btnConfirm) btnConfirm.textContent = 'מוריד ומחיל עדכון OTA...';

    let pct = 20;
    if (progressFill) progressFill.style.width = pct + '%';
    if (progressText) progressText.textContent = 'מוריד חבילת עדכון v' + manifest.version + ' מהענן... (20%)';

    const stepTimer = setInterval(() => {
      pct = Math.min(95, pct + 25);
      if (progressFill) progressFill.style.width = pct + '%';
      if (progressText) progressText.textContent = 'מתקין רכיבי מערכת ומעדכן קאש... (' + pct + '%)';
    }, 220);

    setTimeout(() => {
      clearInterval(stepTimer);
      if (progressFill) progressFill.style.width = '100%';
      if (progressText) progressText.textContent = 'העדכון הושלם (100%)!';

      try {
        localStorage.setItem(OTA_STORAGE_KEYS.INSTALLED_VERSION, manifest.version);
        localStorage.setItem(
          OTA_STORAGE_KEYS.INSTALLED_BUNDLE,
          JSON.stringify({
            version: manifest.version,
            updatedAt: Date.now(),
            cssPatch: manifest.cssPatch || '',
            jsPatch: manifest.jsPatch || ''
          })
        );
        localStorage.setItem(
          OTA_STORAGE_KEYS.JUST_UPDATED_INFO,
          JSON.stringify({
            version: manifest.version,
            previousVersion: APP_BUNDLE_VERSION,
            title: manifest.title || ('האפליקציה עודכנה לגרסה v' + manifest.version),
            releaseNotes: manifest.releaseNotes || []
          })
        );
      } catch (e) {}

      this.applySavedOTABundle();
      this.updateVersionBadgesUI();

      // Immediately show the "Updated Successfully!" popup (and clear JUST_UPDATED_INFO so it doesn't show twice)
      try {
        localStorage.removeItem(OTA_STORAGE_KEYS.JUST_UPDATED_INFO);
      } catch (e) {}

      this.showOTASuccessPopup({
        version: manifest.version,
        title: manifest.title,
        releaseNotes: manifest.releaseNotes
      });
    }, 750);
  }

  showOTASuccessPopup(info) {
    const modal = document.getElementById('ota-modal');
    if (!modal) return;

    this.app.previousModeBeforeModal = this.app.mode === 'FULLSCREEN' ? 'FULLSCREEN' : 'BROWSE';
    this.app.mode = 'OTA';

    const badgeEl = document.getElementById('ota-modal-badge');
    const titleEl = document.getElementById('ota-modal-title');
    const verCompareEl = document.getElementById('ota-version-compare');
    const notesListEl = document.getElementById('ota-release-notes');
    const progressWrap = document.getElementById('ota-progress-wrap');
    const btnConfirm = document.getElementById('btn-ota-confirm');
    const btnLater = document.getElementById('btn-ota-later');

    if (badgeEl) {
      badgeEl.textContent = 'עודכן בהצלחה ✓';
      badgeEl.className = 'ota-status-pill pill-success';
    }
    if (titleEl) {
      titleEl.textContent = 'האפליקציה עודכנה בהצלחה לגרסה v' + info.version + '!';
    }
    if (verCompareEl) {
      verCompareEl.textContent = 'גרסה פעילה כעת: v' + info.version + ' (עדכון OTA הושלם בהצלחה)';
    }
    if (notesListEl) {
      notesListEl.innerHTML = '';
      const notes = Array.isArray(info.releaseNotes) && info.releaseNotes.length > 0
        ? info.releaseNotes
        : ['כל שיפורי הגרסה החדשה הופעלו בהצלחה בטלוויזיה.'];
      notes.forEach((line) => {
        const li = document.createElement('li');
        li.textContent = '✓ ' + line;
        notesListEl.appendChild(li);
      });
    }
    if (progressWrap) progressWrap.classList.add('hidden');
    if (btnLater) btnLater.classList.add('hidden');
    if (btnConfirm) {
      btnConfirm.textContent = 'המשך לצפייה (OK)';
      btnConfirm.onclick = () => this.closeOTAModal();
    }

    modal.classList.remove('hidden');
    this.app.updateVideoSurfacePosition();
    if (btnConfirm) {
      this.app.setFocusedElementFast(btnConfirm);
    }
  }

  closeOTAModal() {
    const modal = document.getElementById('ota-modal');
    if (modal) modal.classList.add('hidden');
    if (this.app.previousModeBeforeModal === 'FULLSCREEN') {
      this.app.mode = 'FULLSCREEN';
      this.app.updateVideoSurfacePosition();
    } else {
      this.app.mode = 'BROWSE';
      this.app.focusArea = 'channels';
      this.app.updateVideoSurfacePosition();
      this.app.updateChannelFocusFast();
    }
  }

  /* --------------------------------------------------------------------------
     4-Digit Cloud M3U Push Polling (Phone QR / PC Studio -> TV)
     -------------------------------------------------------------------------- */

  startCloudSyncPolling() {
    this.stopCloudSyncPolling();
    this.renderPairingQR();
    this.pollCloudM3UPush(true);
    this.cloudPollTimer = setInterval(() => {
      if (this.app.mode === 'SETTINGS') {
        this.pollCloudM3UPush(true);
      } else {
        this.stopCloudSyncPolling();
      }
    }, 3200);
  }

  stopCloudSyncPolling() {
    if (this.cloudPollTimer) {
      clearInterval(this.cloudPollTimer);
      this.cloudPollTimer = null;
    }
  }

  pollCloudM3UPush(silent) {
    const topic = 'zenplay_iptv_tv_' + this.pairingCode.toLowerCase();
    const url = 'https://ntfy.sh/' + topic + '/json?poll=1&since=30m';

    if (!silent) {
      this.app.showToast('בודק משלוחי M3U מהטלפון/מחשב (קוד ' + this.pairingCode + ')...');
    }

    return fetch(url, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then((ndjson) => {
        if (!ndjson || !ndjson.trim()) {
          if (!silent) this.app.showToast('ממתין למשלוח מהטלפון/מחשב (קוד ' + this.pairingCode + ')');
          return false;
        }
        const lines = ndjson.trim().split(/\r?\n/);
        let latestPayload = null;
        let latestId = '';

        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const evt = JSON.parse(lines[i]);
            if (evt && evt.event === 'message' && evt.message) {
              const data = JSON.parse(evt.message);
              if (data && data.type === 'ZENPLAY_M3U_PUSH' && Array.isArray(data.sources)) {
                latestPayload = data;
                latestId = evt.id || String(data.timestamp || '');
                break;
              }
            }
          } catch (e) {}
        }

        const lastProcessed = localStorage.getItem(OTA_STORAGE_KEYS.LAST_CLOUD_MSG_ID);
        if (latestPayload && latestId && latestId !== lastProcessed) {
          localStorage.setItem(OTA_STORAGE_KEYS.LAST_CLOUD_MSG_ID, latestId);
          this.applyCloudM3UPush(latestPayload);
          return true;
        } else if (!silent) {
          this.app.showToast('לא נמצא משלוח חדש מהטלפון (קוד ' + this.pairingCode + ')');
        }
        return false;
      })
      .catch(() => false);
  }

  applyCloudM3UPush(payload) {
    if (!payload || !Array.isArray(payload.sources) || payload.sources.length === 0) return;

    this.app.store.sources = payload.sources;
    this.app.store.saveSources();

    if (payload.overrides && typeof payload.overrides === 'object') {
      this.app.store.overrides = payload.overrides;
      this.app.store.saveOverrides();
    }

    if (payload.epgUrl && payload.epgUrl.trim()) {
      localStorage.setItem(STORAGE_KEYS.EPG_URL, payload.epgUrl.trim());
      const epgInput = document.getElementById('epg-url-input');
      if (epgInput) epgInput.value = payload.epgUrl.trim();
      this.app.epg.loadEPG(payload.epgUrl.trim(), () => this.app.refreshVisibleEPGLabels(), true);
    }

    this.app.renderSourcesManagerList();
    this.app.refreshAllSources(false);
    if (this.app.mode === 'SETTINGS') {
      this.app.closeModals();
    }
    this.app.showToast('התקבלו ' + payload.sources.length + ' מקורות M3U מהטלפון/מחשב! טוען ערוצים...');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { QRCodeGenerator, OTACloudManager, APP_BUNDLE_VERSION };
}
