/**
 * Main IPTV Live TV Application Controller (v3.0 High-Performance Engine)
 * Optimized for LG webOS 4.64 (Chromium 53) & webOS 5.0+
 * - O(1) DOM focus & scroll engine (zero layout thrashing)
 * - < 20ms Instant Cold Boot from localStorage cache + silent background refresh
 * - Center Button (OK) = Pause/Play in Fullscreen | Yellow Button = 7-Day Channel Program Guide
 * - Interactive Program Strip (Prev/Now/Next) with 1-click Start-Over
 * - Multi-M3U Sources + Per-Channel Selection & Custom Channel Numbering + PC Studio Sync
 */

const STORAGE_KEYS = {
  EPG_URL: 'zenplay_iptv_epg_url',
  REMOTE_URL: 'zenplay_iptv_remote_url',
  FAVORITES: 'zenplay_iptv_favorites',
  LAST_CHANNEL: 'zenplay_iptv_last_channel',
  UI_THEME: 'zenplay_ui_theme',
  UI_PREFS: 'zenplay_ui_prefs_v1',
  AV_PREFS: 'zenplay_av_prefs_v1',
  DISCLAIMER_ACCEPTED: 'zenplay_disclaimer_accepted_v1'
};

const DEFAULT_UI_PREFS = {
  preset: 'clean',
  density: 'balanced',
  fontScale: 'md',
  accent: 'sky',
  showColorBar: true,
  showListHints: false,
  showRowEpgBar: true,
  showRowLogos: true,
  showProgramStrip: true,
  showHeaderMeta: false,
  osdStyle: 'clean',
  osdTimeoutSec: 5,
  animations: 'reduced',
  visualEffects: 'light',
  previewAutoplay: 'delayed',
  startupMode: 'browse',
  layoutSide: 'right',
  listWidth: 'balanced',
  cornerRadius: 'rounded',
  bgTone: 'midnight',
  focusStyle: 'glow',
  osdOpacity: 'balanced',
  showClock: true,
  showSynopsis: true,
  showPrevNext: true,
  showChannelNumbers: true,
  showToasts: true,
  wrapNavigation: true,
  seekStepSec: 30,
  numericJumpMs: 1200,
  singleClickFullscreen: false,
  zapDebounceMs: 120,
  autoFullscreenSec: 8,
  backHidesOsdFirst: true,
  sleepTimeoutHours: 4,
  voiceLang: 'he-IL'
};

const DEFAULT_AV_PREFS = {
  audioNormMode: 'off',
  audioVoiceBoost: false,
  audioZapFade: true,
  videoQualityMode: 'smart',
  streamLatencyMode: 'standard',
  memorySaverMode: 'auto',
  picturePreset: 'original',
  picBrightness: 100,
  picContrast: 100,
  picSaturation: 100,
  picCrispRendering: 'auto',
  videoAspectMode: 'contain',
  showStreamStats: false
};

const PICTURE_PRESETS = {
  original: { picBrightness: 100, picContrast: 100, picSaturation: 100, picCrispRendering: 'auto' },
  vivid: { picBrightness: 108, picContrast: 108, picSaturation: 125, picCrispRendering: 'crisp' },
  cinema: { picBrightness: 92, picContrast: 108, picSaturation: 90, picCrispRendering: 'auto' },
  crisp: { picBrightness: 100, picContrast: 108, picSaturation: 100, picCrispRendering: 'crisp' },
  soft: { picBrightness: 100, picContrast: 94, picSaturation: 90, picCrispRendering: 'auto' }
};

const UI_PRESETS = {
  clean: {
    preset: 'clean',
    density: 'balanced',
    fontScale: 'md',
    showColorBar: true,
    showListHints: false,
    showRowEpgBar: true,
    showRowLogos: true,
    showProgramStrip: true,
    showHeaderMeta: false,
    osdStyle: 'clean',
    animations: 'reduced',
    visualEffects: 'light',
    previewAutoplay: 'delayed'
  },
  minimal: {
    preset: 'minimal',
    density: 'compact',
    fontScale: 'md',
    showColorBar: false,
    showListHints: false,
    showRowEpgBar: false,
    showRowLogos: false,
    showProgramStrip: false,
    showHeaderMeta: false,
    osdStyle: 'minimal',
    animations: 'off',
    visualEffects: 'flat',
    previewAutoplay: 'off'
  },
  full: {
    preset: 'full',
    density: 'comfortable',
    fontScale: 'md',
    showColorBar: true,
    showListHints: true,
    showRowEpgBar: true,
    showRowLogos: true,
    showProgramStrip: true,
    showHeaderMeta: true,
    osdStyle: 'full',
    animations: 'normal',
    visualEffects: 'full',
    previewAutoplay: 'instant'
  }
};

class IPTVApp {
  constructor() {
    this.mode = 'BROWSE'; // 'BROWSE', 'FULLSCREEN', 'GUIDE', 'SETTINGS', 'SEARCH'
    this.focusArea = 'channels'; // 'channels', 'timeline', 'header', 'modal'

    this.parser = new M3UParser();
    this.store = new LineupStore(this.parser);
    this.epg = new EPGService();
    this.player = null;
    this.remote = null;
    this.otaManager = null;

    this.allChannels = [];
    this.favorites = new Set();
    this.onlyFavorites = false;

    this.visibleChannels = [];
    this.selectedChannel = null;

    // Fast O(1) DOM node caches & zero-reflow geometry caches
    this.channelRowNodes = [];
    this._channelRowEls = this.channelRowNodes;
    this._channelIndexById = Object.create(null);
    this.timelineItemNodes = [];
    this.timelineProgrammes = [];
    this.currentFocusedEl = null;
    this._focusedChannelEl = null;
    this.currentActiveRowEl = null;
    this._channelListEl = null;
    this._cachedRowHeight = 0;
    this._cachedRowBoxHeight = 0;
    this._cachedListHeight = 0;
    this._cachedListPaddingTop = 14;
    this._cachedListScrollTop = 0;
    this._epgRefreshEpoch = 0;
    this._visibleEpgSyncTimer = null;
    this._focusFlushRafId = null;
    this._focusFlushPending = false;
    this._miniTimelineTimer = null;
    this._pendingMiniTimelineChannel = null;
    this._lastMiniTimelineSig = '';
    this._previewHeaderCache = Object.create(null);
    this._osdLastCache = Object.create(null);
    this._osdEls = null;
    this._lastClockStr = '';
    this._lastClockMinute = -1;
    this._clockEls = null;
    this._lastVideoSurfaceKey = '';
    this._fullscreenRafId = null;
    this._resizeDebounceTimer = null;
    this._rowTemplate = null;

    this.focusedChannelIndex = 0;
    this.focusedTimelineIndex = 0;
    this.focusedHeaderIndex = 0;
    this.focusedModalIndex = 0;
    this.activeSettingsInputId = 'm3u-url-input';
    this.activeSettingsTab = 'sources'; // 'sources' | 'channels' | 'performance' | 'appearance' | 'av' | 'about'
    this._appliedUiPrefs = null;
    this._appliedAvPrefs = null;
    this._streamStatsTimer = null;
    this._lastStreamStatsText = '';
    this._renderingShowRowLogos = null;
    this.editorSourceFilter = 'ALL';
    this.editorNumberBuffer = '';
    this.editorNumberTimer = null;

    // 7-Day Guide & Global VOD Modal state
    this.guideChannel = null;
    this.guideScope = 'channel'; // 'channel' | 'vod'
    this.vodOnlyPast = false;
    this.vodSearchQuery = '';
    this.vodResults = [];
    this._vodSearchDebounceTimer = null;
    this.guideDays = [];
    this.guideDayIndex = 0; // 0 = Today, 1 = Yesterday, ... up to 7
    this.guideProgIndex = 0;
    this.guideProgNodes = [];
    this.guideDayTabNodes = [];

    // Power-Saving Sleep Timer & Blackout Mode state
    this.isPowerSaveMode = false;
    this._sleepWarningActive = false;
    this._sleepWarningTimer = null;
    this._sleepWarningRemainingSec = 60;
    this._sleepWarningTotalSec = 60;
    this._sleepCheckInterval = null;
    this._lastUserActivityMs = Date.now();
    this._lastActivityNoteMs = 0;
    this._channelBeforePowerSave = null;
    this._modeBeforePowerSave = 'BROWSE';
    this._modeBeforeSleepWarning = 'BROWSE';

    // Direct 1-Press Voice Command & Focus Restoration state
    this._activeSpeechRecognition = null;
    this._savedFocusContext = null;
    this._lastToastMsg = '';
    this._lastToastTime = 0;
    this._lastToastCritical = false;
    this._pendingToastTimer = null;

    // Fullscreen Info-Bar Surfing state
    this.isSurfing = false;
    this.surfingIndex = 0;

    this.previewDebounceTimer = null;
    this.initialPreviewTimer = null;
    this._pendingInitialPreviewChannel = null;
    this._deferredEpgTimer = null;
    this._bootSplashSafetyTimer = null;
    this._appReadyNotified = false;
    this._disclaimerFromSettings = false;
    this._autoFullscreenTimer = null;
    this._clockTimer = null;
    this.osdTimer = null;
    this.osdTickTimer = null;
    this.toastTimer = null;
    this.jumpTimer = null;

    this._seekHoldDir = 0;
    this._seekHoldStartMs = 0;
    this._seekHoldLastEventMs = 0;
    this._seekHoldTicks = 0;
    this._activeSeekSpeedLabel = '';
    this._seekBadgeClearTimer = null;

    this.ensureRuntimeState();
    this.init();
  }

  /**
   * Idempotently initializes any runtime fields or caches added in newer app versions
   * so an older base IPTVApp instance upgraded live via OTA can never throw on undefined properties.
   */
  ensureRuntimeState() {
    if (!Array.isArray(this.allChannels)) this.allChannels = [];
    if (!Array.isArray(this.visibleChannels)) this.visibleChannels = [];
    if (!this.favorites || typeof this.favorites.has !== 'function') this.favorites = new Set();
    if (!Array.isArray(this.channelRowNodes)) this.channelRowNodes = [];
    if (!Array.isArray(this._channelRowEls)) this._channelRowEls = this.channelRowNodes;
    if (!this._channelIndexById || typeof this._channelIndexById !== 'object') {
      this._channelIndexById = Object.create(null);
    }
    if (!Array.isArray(this.timelineItemNodes)) this.timelineItemNodes = [];
    if (!Array.isArray(this.timelineProgrammes)) this.timelineProgrammes = [];
    if (!this._previewHeaderCache || typeof this._previewHeaderCache !== 'object') {
      this._previewHeaderCache = Object.create(null);
    }
    if (!this._osdLastCache || typeof this._osdLastCache !== 'object') {
      this._osdLastCache = Object.create(null);
    }
    if (typeof this._cachedRowHeight !== 'number') this._cachedRowHeight = 0;
    if (typeof this._cachedRowBoxHeight !== 'number') this._cachedRowBoxHeight = 0;
    if (typeof this._cachedListHeight !== 'number') this._cachedListHeight = 0;
    if (typeof this._cachedListPaddingTop !== 'number') this._cachedListPaddingTop = 14;
    if (typeof this._cachedListScrollTop !== 'number') this._cachedListScrollTop = 0;
    if (typeof this._epgRefreshEpoch !== 'number') this._epgRefreshEpoch = 0;
    if (typeof this._lastMiniTimelineSig !== 'string') this._lastMiniTimelineSig = '';
    if (typeof this._lastVideoSurfaceKey !== 'string') this._lastVideoSurfaceKey = '';
    if (typeof this._lastClockStr !== 'string') this._lastClockStr = '';
    if (typeof this._lastClockMinute !== 'number') this._lastClockMinute = -1;
    if (typeof this.focusedChannelIndex !== 'number') this.focusedChannelIndex = 0;
    if (typeof this._appliedUiPrefs === 'undefined') this._appliedUiPrefs = null;
    if (typeof this._appliedAvPrefs === 'undefined') this._appliedAvPrefs = null;
    if (typeof this._streamStatsTimer === 'undefined') this._streamStatsTimer = null;
    if (typeof this._lastStreamStatsText !== 'string') this._lastStreamStatsText = '';
    if (typeof this._renderingShowRowLogos === 'undefined') this._renderingShowRowLogos = null;
    if (typeof this._disclaimerFromSettings !== 'boolean') this._disclaimerFromSettings = false;
    if (typeof this._autoFullscreenTimer === 'undefined') this._autoFullscreenTimer = null;
    if (typeof this._clockTimer === 'undefined') this._clockTimer = null;
    if (this.guideScope !== 'vod' && this.guideScope !== 'channel') this.guideScope = 'channel';
    if (typeof this.vodOnlyPast !== 'boolean') this.vodOnlyPast = false;
    if (typeof this.vodSearchQuery !== 'string') this.vodSearchQuery = '';
    if (!Array.isArray(this.vodResults)) this.vodResults = [];
    if (typeof this.isPowerSaveMode !== 'boolean') this.isPowerSaveMode = false;
    if (typeof this._sleepWarningActive !== 'boolean') this._sleepWarningActive = false;
    if (typeof this._sleepWarningRemainingSec !== 'number') this._sleepWarningRemainingSec = 60;
    if (typeof this._sleepWarningTotalSec !== 'number') this._sleepWarningTotalSec = 60;
    if (typeof this._lastUserActivityMs !== 'number') this._lastUserActivityMs = Date.now();
    if (typeof this._lastActivityNoteMs !== 'number') this._lastActivityNoteMs = 0;
    if (typeof this._lastToastMsg !== 'string') this._lastToastMsg = '';
    if (typeof this._lastToastTime !== 'number') this._lastToastTime = 0;
    if (typeof this._lastToastCritical !== 'boolean') this._lastToastCritical = false;
  }

  isSafeMode() {
    if (typeof window === 'undefined') return false;
    try {
      if (window.__IPTV_SAFE_MODE === true) return true;
      const search = window.location && window.location.search ? window.location.search : '';
      if (/[?&]safeMode=1(?:&|#|$)/.test(search)) {
        window.__IPTV_SAFE_MODE = true;
        return true;
      }
    } catch (e) {}
    return false;
  }

  isAndroidTvWebView() {
    if (typeof window === 'undefined') return false;
    try {
      return (
        Boolean(window.__IPTV_ANDROID_TV) ||
        Boolean(window.__IPTV_IS_ANDROID_TV) ||
        (window.location && window.location.hostname === 'appassets.androidplatform.net') ||
        Boolean(window.AndroidTvHost)
      );
    } catch (e) {
      return false;
    }
  }

  isWebOSPlatform() {
    if (typeof window === 'undefined') return false;
    try {
      if (window.__IPTV_IS_WEBOS === true) return true;
      const doc = document.documentElement;
      if (doc && doc.classList && doc.classList.contains('platform-webos')) return true;
      const ua = navigator && navigator.userAgent ? navigator.userAgent : '';
      return Boolean(window.webOSSystem || window.PalmSystem || window.webOS) || /Web0S|webOS|LG NetCast/i.test(ua);
    } catch (e) {
      return false;
    }
  }

  isTvPlatform() {
    if (typeof window === 'undefined') return false;
    try {
      if (window.__IPTV_IS_TV === true) return true;
      const doc = document.documentElement;
      if (doc && doc.classList && doc.classList.contains('tv-platform')) return true;
      return this.isWebOSPlatform() || this.isAndroidTvWebView();
    } catch (e) {
      return false;
    }
  }

  getTheme() {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.UI_THEME);
      if (saved === 'glass' || saved === 'classic') {
        return saved;
      }
      if (typeof window !== 'undefined' && (window.__IPTV_THEME === 'glass' || window.__IPTV_THEME === 'classic')) {
        return window.__IPTV_THEME;
      }
    } catch (e) {}
    return 'classic';
  }

  ensureThemeControlsDOM() {
    if (typeof document === 'undefined') return;

    const perfTabBtn = document.getElementById('tab-btn-performance');
    if (perfTabBtn) {
      perfTabBtn.textContent = 'נושא ובאפר';
    }

    const perfPanel = document.getElementById('settings-tab-performance');
    if (perfPanel && !document.getElementById('theme-mode-options')) {
      const card = document.createElement('div');
      card.id = 'ui-theme-card';
      card.className = 'perf-section-card';
      card.innerHTML =
        '<h3>ערכת נושא ועיצוב ממשק (Theme)</h3>' +
        '<p class="perf-desc">החלף מיידית בין הממשק הקלאסי המהיר לבין עיצוב <strong>Apple Liquid Glass</strong> (מותאם ל-60fps ב-webOS וב-Android TV) — ללא הפעלה מחדש:</p>' +
        '<div class="perf-options-grid" id="theme-mode-options">' +
          '<button id="btn-theme-classic" class="perf-option-btn focusable" data-ui-theme="classic">' +
            '<span class="perf-opt-title">קלאסי (Classic Broadcast)</span>' +
            '<span class="perf-opt-sub">ממשק כהה, חד ומהיר במיוחד • ברירת מחדל</span>' +
          '</button>' +
          '<button id="btn-theme-glass" class="perf-option-btn focusable" data-ui-theme="glass">' +
            '<span class="perf-opt-title">Apple Liquid Glass (זכוכית)</span>' +
            '<span class="perf-opt-sub">עיצוב זכוכית יוקרתי בסגנון אפל • 60fps מותאם לטלוויזיות</span>' +
          '</button>' +
        '</div>';
      if (perfPanel.firstChild) {
        perfPanel.insertBefore(card, perfPanel.firstChild);
      } else {
        perfPanel.appendChild(card);
      }
    }

    const themeBtns = document.querySelectorAll('#theme-mode-options .perf-option-btn');
    for (let i = 0; i < themeBtns.length; i++) {
      const btn = themeBtns[i];
      if (btn && btn.dataset && btn.dataset.themeBound !== '1') {
        btn.dataset.themeBound = '1';
        btn.addEventListener('click', () => {
          const targetTheme = btn.dataset.uiTheme === 'glass' ? 'glass' : 'classic';
          this.applyTheme(targetTheme, false);
        });
      }
    }
  }

  applyTheme(theme, silent) {
    const target = theme === 'glass' ? 'glass' : 'classic';
    try {
      localStorage.setItem(STORAGE_KEYS.UI_THEME, target);
    } catch (e) {}
    if (typeof window !== 'undefined') {
      window.__IPTV_THEME = target;
    }
    if (typeof document !== 'undefined' && document.documentElement && document.documentElement.classList) {
      document.documentElement.classList.toggle('theme-glass', target === 'glass');
      document.documentElement.classList.toggle('theme-classic', target !== 'glass');
    }

    const usingOtaCss = Boolean(
      this.otaManager &&
      typeof this.otaManager.hasActiveOtaCss === 'function' &&
      this.otaManager.hasActiveOtaCss() &&
      typeof this.otaManager.applyThemeStylesheet === 'function'
    );
    if (usingOtaCss) {
      this.otaManager.applyThemeStylesheet(target);
    } else if (typeof document !== 'undefined') {
      const classicLink = document.getElementById('theme-css-classic');
      const glassLink = document.getElementById('theme-css-glass');
      if (!classicLink && !glassLink && typeof window !== 'undefined') {
        const inlineFallbackCss = target === 'glass' ? window.__ZENPLAY_OTA_GLASS_CSS : window.__ZENPLAY_OTA_CLASSIC_CSS;
        if (inlineFallbackCss) {
          let styleEl = document.getElementById('zenplay-ota-css');
          if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'zenplay-ota-css';
            document.head.appendChild(styleEl);
          }
          styleEl.textContent = inlineFallbackCss;
        }
      }
      if (classicLink) {
        try {
          classicLink.removeAttribute('disabled');
        } catch (e) {}
        classicLink.disabled = false;
        classicLink.media = target === 'glass' ? 'not all' : 'all';
      }
      if (glassLink) {
        try {
          glassLink.removeAttribute('disabled');
        } catch (e) {}
        glassLink.disabled = false;
        glassLink.media = target === 'glass' ? 'all' : 'not all';
      }
      const targetLink = target === 'glass' ? glassLink : classicLink;
      if (targetLink && !targetLink.sheet) {
        targetLink.onload = () => {
          this._lastVideoSurfaceKey = '';
          this.cachedPreviewRect = null;
          this.invalidateChannelListMetrics();
          if (this._channelListEl) this.measureChannelListMetrics(this._channelListEl);
          this.updateVideoSurfacePosition(true);
        };
      }
    }

    this.ensureThemeControlsDOM();
    this._lastVideoSurfaceKey = '';
    this.cachedPreviewRect = null;
    this.invalidateChannelListMetrics();
    if (this._channelListEl) {
      this.measureChannelListMetrics(this._channelListEl);
    }
    this.updateVideoSurfacePosition(true);
    this.renderPerformanceTab();

    if (!silent) {
      this.showToast(
        target === 'glass'
          ? 'ערכת הנושא הוחלפה ל-Apple Liquid Glass ✓'
          : 'ערכת הנושא הוחלפה לעיצוב קלאסי ✓'
      );
    }
  }

  _normalizeUiPrefs(raw) {
    const out = {};
    for (let k in DEFAULT_UI_PREFS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_UI_PREFS, k)) {
        out[k] = DEFAULT_UI_PREFS[k];
      }
    }
    if (!raw || typeof raw !== 'object') {
      return out;
    }
    const enumMaps = {
      preset: { clean: 1, minimal: 1, full: 1, custom: 1 },
      density: { comfortable: 1, balanced: 1, compact: 1 },
      fontScale: { sm: 1, md: 1, lg: 1 },
      accent: { sky: 1, indigo: 1, emerald: 1, amber: 1, mono: 1 },
      osdStyle: { clean: 1, minimal: 1, full: 1 },
      animations: { normal: 1, reduced: 1, off: 1 },
      visualEffects: { full: 1, light: 1, flat: 1 },
      previewAutoplay: { instant: 1, delayed: 1, off: 1 },
      startupMode: { browse: 1, fullscreen: 1 },
      layoutSide: { right: 1, left: 1 },
      listWidth: { narrow: 1, balanced: 1, wide: 1 },
      cornerRadius: { sharp: 1, rounded: 1, pill: 1 },
      bgTone: { midnight: 1, oled: 1, slate: 1, deepblue: 1 },
      focusStyle: { glow: 1, border: 1, solid: 1 },
      osdOpacity: { solid: 1, balanced: 1, light: 1 },
      voiceLang: { 'he-IL': 1, 'en-US': 1 }
    };
    const intMaps = {
      osdTimeoutSec: { 3: 1, 5: 1, 8: 1, 12: 1 },
      seekStepSec: { 10: 1, 15: 1, 30: 1, 60: 1 },
      numericJumpMs: { 700: 1, 1200: 1, 2000: 1 },
      zapDebounceMs: { 0: 1, 120: 1, 280: 1 },
      autoFullscreenSec: { 0: 1, 5: 1, 8: 1, 12: 1, 20: 1 },
      sleepTimeoutHours: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 6: 1, 8: 1 }
    };
    for (let k in DEFAULT_UI_PREFS) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_UI_PREFS, k)) continue;
      if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
      const val = raw[k];
      if (typeof DEFAULT_UI_PREFS[k] === 'boolean') {
        if (typeof val === 'boolean') out[k] = val;
      } else if (intMaps[k]) {
        const num = parseInt(val, 10);
        if (intMaps[k][num]) {
          out[k] = num;
        }
      } else if (enumMaps[k] && enumMaps[k][val]) {
        out[k] = val;
      }
    }
    return out;
  }

  _detectMatchingUiPreset(prefs) {
    const names = ['clean', 'minimal', 'full'];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const presetObj = UI_PRESETS[name];
      let matches = true;
      for (let k in presetObj) {
        if (!Object.prototype.hasOwnProperty.call(presetObj, k) || k === 'preset') continue;
        if (prefs[k] !== presetObj[k]) {
          matches = false;
          break;
        }
      }
      if (matches) return name;
    }
    return 'custom';
  }

  getUiPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.UI_PREFS);
      if (raw) {
        return this._normalizeUiPrefs(JSON.parse(raw));
      }
    } catch (e) {}
    return this._normalizeUiPrefs(null);
  }

  saveUiPrefs(prefs) {
    const normalized = this._normalizeUiPrefs(prefs);
    normalized.preset = this._detectMatchingUiPreset(normalized);
    try {
      localStorage.setItem(STORAGE_KEYS.UI_PREFS, JSON.stringify(normalized));
    } catch (e) {}
    return normalized;
  }

  setUiPref(key, value, silent) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_UI_PREFS, key)) {
      return this.getUiPrefs();
    }
    const prefs = this.getUiPrefs();
    const candidate = {};
    for (let k in prefs) {
      if (Object.prototype.hasOwnProperty.call(prefs, k)) {
        candidate[k] = prefs[k];
      }
    }
    const isIntKey =
      key === 'osdTimeoutSec' ||
      key === 'seekStepSec' ||
      key === 'numericJumpMs' ||
      key === 'zapDebounceMs' ||
      key === 'autoFullscreenSec' ||
      key === 'sleepTimeoutHours';
    candidate[key] = typeof DEFAULT_UI_PREFS[key] === 'boolean'
      ? Boolean(value)
      : (isIntKey ? parseInt(value, 10) : value);
    const validated = this._normalizeUiPrefs(candidate);
    if (validated[key] !== candidate[key]) {
      return prefs;
    }
    this.saveUiPrefs(validated);
    return this.applyUiPrefs(Boolean(silent));
  }

  toggleUiPref(key, silent) {
    if (typeof DEFAULT_UI_PREFS[key] !== 'boolean') {
      return this.getUiPrefs();
    }
    const prefs = this.getUiPrefs();
    return this.setUiPref(key, !prefs[key], silent);
  }

  applyUiPreset(presetName, silent) {
    const presetObj = UI_PRESETS[presetName];
    if (!presetObj) return this.getUiPrefs();
    const prefs = this.getUiPrefs();
    for (let k in presetObj) {
      if (Object.prototype.hasOwnProperty.call(presetObj, k)) {
        prefs[k] = presetObj[k];
      }
    }
    prefs.preset = presetName;
    this.saveUiPrefs(prefs);
    const applied = this.applyUiPrefs(true);
    if (!silent) {
      const label =
        presetName === 'minimal'
          ? 'מינימליסטי וקל'
          : presetName === 'full'
          ? 'מלא ומפורט'
          : 'נקי ומאוזן';
      this.showToast('הוחל מצב עיצוב: ' + label + ' ✓');
    }
    return applied;
  }

  resetUiPrefs(silent) {
    const fresh = this._normalizeUiPrefs(null);
    this.saveUiPrefs(fresh);
    const applied = this.applyUiPrefs(true);
    if (!silent) {
      this.showToast('הגדרות העיצוב אופסו לברירת המחדל ✓');
    }
    return applied;
  }

  getOsdTimeoutMs() {
    const prefs = this.getUiPrefs();
    const sec = prefs && typeof prefs.osdTimeoutSec === 'number' ? prefs.osdTimeoutSec : 5;
    return sec * 1000;
  }

  getSeekStepSec() {
    const prefs = this.getUiPrefs();
    return prefs && typeof prefs.seekStepSec === 'number' ? prefs.seekStepSec : 30;
  }

  getNumericJumpMs() {
    const prefs = this.getUiPrefs();
    return prefs && typeof prefs.numericJumpMs === 'number' ? prefs.numericJumpMs : 1200;
  }

  getZapDebounceMs() {
    const prefs = this.getUiPrefs();
    return prefs && typeof prefs.zapDebounceMs === 'number' ? prefs.zapDebounceMs : 120;
  }

  _normalizeAvPrefs(raw) {
    const out = {};
    for (let k in DEFAULT_AV_PREFS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_AV_PREFS, k)) {
        out[k] = DEFAULT_AV_PREFS[k];
      }
    }
    if (!raw || typeof raw !== 'object') {
      return out;
    }
    const enumMaps = {
      audioNormMode: { off: 1, gentle: 1, broadcast: 1, night: 1 },
      videoQualityMode: { smart: 1, max: 1, hd1080: 1, hd720: 1 },
      streamLatencyMode: { standard: 1, low: 1 },
      memorySaverMode: { auto: 1, aggressive: 1, off: 1 },
      picturePreset: { original: 1, vivid: 1, cinema: 1, crisp: 1, soft: 1, custom: 1 },
      picCrispRendering: { auto: 1, crisp: 1 },
      videoAspectMode: { contain: 1, cover: 1, fill: 1, zoom: 1 }
    };
    const intMaps = {
      picBrightness: { 85: 1, 92: 1, 100: 1, 108: 1, 116: 1 },
      picContrast: { 88: 1, 94: 1, 100: 1, 108: 1, 116: 1 },
      picSaturation: { 80: 1, 90: 1, 100: 1, 112: 1, 125: 1 }
    };
    for (let k in DEFAULT_AV_PREFS) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_AV_PREFS, k)) continue;
      if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
      const val = raw[k];
      if (typeof DEFAULT_AV_PREFS[k] === 'boolean') {
        if (typeof val === 'boolean') out[k] = val;
      } else if (intMaps[k]) {
        const num = parseInt(val, 10);
        if (intMaps[k][num]) out[k] = num;
      } else if (enumMaps[k] && enumMaps[k][val]) {
        out[k] = val;
      }
    }
    return out;
  }

  _detectMatchingPicturePreset(prefs) {
    const names = ['original', 'vivid', 'cinema', 'crisp', 'soft'];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const p = PICTURE_PRESETS[name];
      if (
        prefs.picBrightness === p.picBrightness &&
        prefs.picContrast === p.picContrast &&
        prefs.picSaturation === p.picSaturation &&
        prefs.picCrispRendering === p.picCrispRendering
      ) {
        return name;
      }
    }
    return 'custom';
  }

  getAvPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.AV_PREFS);
      if (raw) {
        return this._normalizeAvPrefs(JSON.parse(raw));
      }
    } catch (e) {}
    return this._normalizeAvPrefs(null);
  }

  saveAvPrefs(prefs) {
    const normalized = this._normalizeAvPrefs(prefs);
    normalized.picturePreset = this._detectMatchingPicturePreset(normalized);
    try {
      localStorage.setItem(STORAGE_KEYS.AV_PREFS, JSON.stringify(normalized));
    } catch (e) {}
    return normalized;
  }

  applyPicturePreset(presetName, silent) {
    const presetObj = PICTURE_PRESETS[presetName];
    if (!presetObj) return this.getAvPrefs();
    const prefs = this.getAvPrefs();
    for (let k in presetObj) {
      if (Object.prototype.hasOwnProperty.call(presetObj, k)) {
        prefs[k] = presetObj[k];
      }
    }
    prefs.picturePreset = presetName;
    this.saveAvPrefs(prefs);
    const applied = this.applyAvPrefs(true);
    if (!silent) {
      const labelMap = {
        original: 'מקורי',
        vivid: 'חי ועשיר',
        cinema: 'קולנוע',
        crisp: 'חד',
        soft: 'רך'
      };
      this.showToast('הוחל מצב תמונה: ' + (labelMap[presetName] || presetName) + ' ✓');
    }
    return applied;
  }

  setAvPref(key, value, silent) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_AV_PREFS, key)) {
      return this.getAvPrefs();
    }
    if (key === 'picturePreset' && PICTURE_PRESETS[value]) {
      return this.applyPicturePreset(value, silent);
    }
    const prefs = this.getAvPrefs();
    const candidate = {};
    for (let k in prefs) {
      if (Object.prototype.hasOwnProperty.call(prefs, k)) {
        candidate[k] = prefs[k];
      }
    }
    const isIntKey = key === 'picBrightness' || key === 'picContrast' || key === 'picSaturation';
    candidate[key] = typeof DEFAULT_AV_PREFS[key] === 'boolean'
      ? Boolean(value)
      : (isIntKey ? parseInt(value, 10) : value);
    const validated = this._normalizeAvPrefs(candidate);
    if (validated[key] !== candidate[key]) {
      return prefs;
    }
    this.saveAvPrefs(validated);
    return this.applyAvPrefs(Boolean(silent));
  }

  toggleAvPref(key, silent) {
    if (typeof DEFAULT_AV_PREFS[key] !== 'boolean') {
      return this.getAvPrefs();
    }
    const prefs = this.getAvPrefs();
    return this.setAvPref(key, !prefs[key], silent);
  }

  resetAvPrefs(silent) {
    const fresh = this._normalizeAvPrefs(null);
    this.saveAvPrefs(fresh);
    const applied = this.applyAvPrefs(true);
    if (!silent) {
      this.showToast('הגדרות תמונה וסאונד אופסו לברירת המחדל ✓');
    }
    return applied;
  }

  setChannelTrimPref(trimDb, silent) {
    const ch = this.selectedChannel || this.previewedChannel || (this.player && this.player.currentChannel);
    if (!ch) {
      if (!silent) this.showToast('יש לבחור ערוץ פעיל לכיוון עוצמת השמע');
      return;
    }
    const val = parseInt(trimDb, 10);
    if (isNaN(val)) return;
    if (this.player && typeof this.player.setChannelVolumeTrim === 'function') {
      this.player.setChannelVolumeTrim(ch.id, val);
    } else {
      try {
        const raw = localStorage.getItem('zenplay_channel_loudness_v1');
        const parsed = raw ? JSON.parse(raw) : { trim: {}, learned: {} };
        if (!parsed.trim || typeof parsed.trim !== 'object') parsed.trim = {};
        if (!parsed.learned || typeof parsed.learned !== 'object') parsed.learned = {};
        parsed.trim[ch.id] = val;
        localStorage.setItem('zenplay_channel_loudness_v1', JSON.stringify(parsed));
      } catch (e) {}
    }
    this.renderAvTab();
    if (this.mode === 'FULLSCREEN') {
      this._renderStreamStatsOnce();
    }
    if (!silent) {
      this.showToast('כיוון עוצמה לערוץ ' + ch.name + ': ' + (val > 0 ? '+' + val : val) + ' dB ✓');
    }
  }

  resetChannelLoudnessMemory(silent) {
    if (this.player && typeof this.player.resetLoudnessMemory === 'function') {
      this.player.resetLoudnessMemory();
    } else {
      try {
        localStorage.removeItem('zenplay_channel_loudness_v1');
      } catch (e) {}
    }
    this.renderAvTab();
    if (this.mode === 'FULLSCREEN') {
      this._renderStreamStatsOnce();
    }
    if (!silent) {
      this.showToast('זיכרון עוצמת השמע לערוצים אופס בהצלחה ✓');
    }
  }

  _renderStreamStatsOnce() {
    if (typeof document === 'undefined') return;
    const badge = document.getElementById('stream-stats-badge');
    if (!badge) return;
    const avPrefs = this.getAvPrefs();
    if (this.mode !== 'FULLSCREEN' || !avPrefs.showStreamStats) {
      if (!badge.classList.contains('hidden')) badge.classList.add('hidden');
      return;
    }
    let stats = null;
    if (this.player && typeof this.player.getStreamStats === 'function') {
      stats = this.player.getStreamStats();
    }
    const videoEl = document.getElementById('tv-video') || (this.player && this.player.video);
    const w = stats && stats.width ? stats.width : (videoEl && videoEl.videoWidth ? videoEl.videoWidth : 0);
    const h = stats && stats.height ? stats.height : (videoEl && videoEl.videoHeight ? videoEl.videoHeight : 0);
    const parts = [];
    parts.push(w > 0 && h > 0 ? (w + 'x' + h) : '--x--');
    if (stats && typeof stats.bitrateKbps === 'number' && stats.bitrateKbps > 0) {
      parts.push(
        stats.bitrateKbps >= 1000
          ? (stats.bitrateKbps / 1000).toFixed(1) + ' Mbps'
          : Math.round(stats.bitrateKbps) + ' kbps'
      );
    }
    if (stats && typeof stats.bufferSec === 'number') {
      parts.push('BUF ' + stats.bufferSec.toFixed(1) + 's');
    } else if (this.player && typeof this.player.getForwardBufferSeconds === 'function') {
      parts.push('BUF ' + this.player.getForwardBufferSeconds().toFixed(1) + 's');
    }
    const normMode = (stats && stats.audioNormMode) || avPrefs.audioNormMode || 'off';
    const gainDb = stats && typeof stats.appliedGainDb === 'number' ? stats.appliedGainDb : 0;
    const trimDb = stats && typeof stats.channelTrimDb === 'number' ? stats.channelTrimDb : 0;
    let audLabel = 'AUD ' + normMode.toUpperCase();
    if (gainDb !== 0) {
      audLabel += ' ' + (gainDb > 0 ? '+' : '') + gainDb.toFixed(1) + 'dB';
    }
    if (trimDb !== 0) {
      audLabel += ' (Trim ' + (trimDb > 0 ? '+' : '') + trimDb + 'dB)';
    }
    parts.push(audLabel);
    const text = parts.join(' • ');
    if (this._lastStreamStatsText !== text) {
      this._lastStreamStatsText = text;
      badge.textContent = text;
    }
    if (badge.classList.contains('hidden')) {
      badge.classList.remove('hidden');
    }
  }

  updateStreamStatsOverlay() {
    const avPrefs = this.getAvPrefs();
    const shouldPoll = this.mode === 'FULLSCREEN' && avPrefs.showStreamStats === true;
    if (!shouldPoll) {
      if (this._streamStatsTimer) {
        clearInterval(this._streamStatsTimer);
        this._streamStatsTimer = null;
      }
      if (typeof document !== 'undefined') {
        const badge = document.getElementById('stream-stats-badge');
        if (badge && !badge.classList.contains('hidden')) {
          badge.classList.add('hidden');
        }
      }
      return;
    }
    this._renderStreamStatsOnce();
    if (!this._streamStatsTimer) {
      this._streamStatsTimer = setInterval(() => {
        if (this.mode !== 'FULLSCREEN' || !this.getAvPrefs().showStreamStats) {
          this.updateStreamStatsOverlay();
          return;
        }
        this._renderStreamStatsOnce();
      }, 1000);
    }
  }

  applyAvPrefs(silent) {
    const prefs = this.getAvPrefs();
    this._appliedAvPrefs = prefs;

    if (typeof window !== 'undefined') {
      window.__IPTV_AV_PREFS = prefs;
    }

    if (typeof document !== 'undefined' && document.documentElement && document.documentElement.classList) {
      const cls = document.documentElement.classList;
      cls.remove('video-aspect-contain', 'video-aspect-cover', 'video-aspect-fill', 'video-aspect-zoom');
      cls.add('video-aspect-' + prefs.videoAspectMode);
      if (prefs.picCrispRendering === 'crisp') {
        cls.add('video-crisp');
      } else {
        cls.remove('video-crisp');
      }
    }

    if (typeof document !== 'undefined') {
      const videoEl = document.getElementById('tv-video') || (this.player && this.player.video);
      if (videoEl && videoEl.style) {
        const b = prefs.picBrightness;
        const c = prefs.picContrast;
        const s = prefs.picSaturation;
        if (b === 100 && c === 100 && s === 100) {
          videoEl.style.filter = '';
          videoEl.style.webkitFilter = '';
        } else {
          const filterVal = 'brightness(' + (b / 100) + ') contrast(' + (c / 100) + ') saturate(' + (s / 100) + ')';
          videoEl.style.filter = filterVal;
          videoEl.style.webkitFilter = filterVal;
        }
      }
    }

    if (this.player && typeof this.player.setAvPrefs === 'function') {
      this.player.setAvPrefs(prefs);
    }

    this.ensureUiCustomizationDOM();
    this.updateStreamStatsOverlay();
    this.renderAvTab();

    if (!silent) {
      this.showToast('הגדרות תמונה וסאונד עודכנו ✓');
    }
    return prefs;
  }

  _getAppearanceTabHTML() {
    return (
      '<div class="perf-section-card ui-pref-card">' +
        '<h3>מצב עיצוב מהיר (Presets)</h3>' +
        '<p class="perf-desc">בחר בלחיצה אחת את רמת הניקיון והפירוט של הממשק — ניתן להתאים אישית כל רכיב בהמשך:</p>' +
        '<div class="perf-options-grid ui-grid-3" id="ui-preset-options">' +
          '<button id="btn-preset-clean" class="perf-option-btn focusable" data-ui-preset="clean">' +
            '<span class="perf-opt-title">נקי ומאוזן (ברירת מחדל)</span>' +
            '<span class="perf-opt-sub">רשימה מאוזנת, כותרת שקטה ואנימציות מופחתות</span>' +
          '</button>' +
          '<button id="btn-preset-minimal" class="perf-option-btn focusable" data-ui-preset="minimal">' +
            '<span class="perf-opt-title">מינימליסטי וקל (Minimal)</span>' +
            '<span class="perf-opt-sub">שורות דחוסות, מונוגרמה, ללא תוספות וניגון מקדים כבוי</span>' +
          '</button>' +
          '<button id="btn-preset-full" class="perf-option-btn focusable" data-ui-preset="full">' +
            '<span class="perf-opt-title">מלא ומפורט (Full)</span>' +
            '<span class="perf-opt-sub">רשימה מרווחת, כל הרמזים, אנימציות וניגון מקדים מיידי</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="perf-section-card ui-pref-card">' +
        '<h3>הצגה והסתרה של רכיבי ממשק (Declutter)</h3>' +
        '<p class="perf-desc">הפעל או הסתר רכיבים במסך הראשי ובכרטיס הערוץ כדי לשמור על מראה נקי לפי הטעם שלך:</p>' +
        '<div class="perf-options-grid" id="ui-visibility-options">' +
          '<button id="btn-pref-showColorBar" class="perf-option-btn ui-toggle-btn focusable" data-ui-toggle="showColorBar">' +
            '<span class="ui-toggle-text" style="display:flex;flex-direction:column;min-width:0;margin-left:12px;">' +
              '<span class="perf-opt-title">סרגל כפתורי צבע בתחתית</span>' +
              '<span class="perf-opt-sub">מציג את מקרא הכפתורים בתחתית המסך</span>' +
            '</span>' +
            '<span class="ui-toggle-pill">מוצג ✓</span>' +
          '</button>' +
          '<button id="btn-pref-showListHints" class="perf-option-btn ui-toggle-btn focusable" data-ui-toggle="showListHints">' +
            '<span class="ui-toggle-text" style="display:flex;flex-direction:column;min-width:0;margin-left:12px;">' +
              '<span class="perf-opt-title">רמזי מקשים ברשימה ובנגן</span>' +
              '<span class="perf-opt-sub">שורת ההדרכה ותגיות לחץ OK</span>' +
            '</span>' +
            '<span class="ui-toggle-pill">מוסתר</span>' +
          '</button>' +
          '<button id="btn-pref-showRowEpgBar" class="perf-option-btn ui-toggle-btn focusable" data-ui-toggle="showRowEpgBar">' +
            '<span class="ui-toggle-text" style="display:flex;flex-direction:column;min-width:0;margin-left:12px;">' +
              '<span class="perf-opt-title">פס התקדמות תוכנית בשורה</span>' +
              '<span class="perf-opt-sub">שעות, בר התקדמות ודקות שנותרו בכל שורה</span>' +
            '</span>' +
            '<span class="ui-toggle-pill">מוצג ✓</span>' +
          '</button>' +
          '<button id="btn-pref-showRowLogos" class="perf-option-btn ui-toggle-btn focusable" data-ui-toggle="showRowLogos">' +
            '<span class="ui-toggle-text" style="display:flex;flex-direction:column;min-width:0;margin-left:12px;">' +
              '<span class="perf-opt-title">לוגואים של ערוצים (תמונות)</span>' +
              '<span class="perf-opt-sub">בכיבוי מוצגים תגי מונוגרמה קלים ומהירים</span>' +
            '</span>' +
            '<span class="ui-toggle-pill">מוצג ✓</span>' +
          '</button>' +
          '<button id="btn-pref-showProgramStrip" class="perf-option-btn ui-toggle-btn focusable" data-ui-toggle="showProgramStrip">' +
            '<span class="ui-toggle-text" style="display:flex;flex-direction:column;min-width:0;margin-left:12px;">' +
              '<span class="perf-opt-title">רצועת לוח תוכניות בכרטיס</span>' +
              '<span class="perf-opt-sub">בכיבוי מתרחב מקום התקציר בכרטיס הפרטים</span>' +
            '</span>' +
            '<span class="ui-toggle-pill">מוצג ✓</span>' +
          '</button>' +
          '<button id="btn-pref-showHeaderMeta" class="perf-option-btn ui-toggle-btn focusable" data-ui-toggle="showHeaderMeta">' +
            '<span class="ui-toggle-text" style="display:flex;flex-direction:column;min-width:0;margin-left:12px;">' +
              '<span class="perf-opt-title">תגיות גרסה ומקור פלייליסט</span>' +
              '<span class="perf-opt-sub">מציג תגי גרסה ושם מקור בכותרת וב-OSD</span>' +
            '</span>' +
            '<span class="ui-toggle-pill">מוסתר</span>' +
          '</button>' +
          '<button id="btn-pref-showClock" class="perf-option-btn ui-toggle-btn focusable" data-ui-toggle="showClock">' +
            '<span class="ui-toggle-text" style="display:flex;flex-direction:column;min-width:0;margin-left:12px;">' +
              '<span class="perf-opt-title">שעון בכותרת וב-OSD</span>' +
              '<span class="perf-opt-sub">מציג את השעה הנוכחית בסרגל העליון ובמסך המלא</span>' +
            '</span>' +
            '<span class="ui-toggle-pill">מוצג ✓</span>' +
          '</button>' +
          '<button id="btn-pref-showSynopsis" class="perf-option-btn ui-toggle-btn focusable" data-ui-toggle="showSynopsis">' +
            '<span class="ui-toggle-text" style="display:flex;flex-direction:column;min-width:0;margin-left:12px;">' +
              '<span class="perf-opt-title">תקציר תוכנית בכרטיס וב-OSD</span>' +
              '<span class="perf-opt-sub">בכיבוי הממשק הופך קומפקטי יותר</span>' +
            '</span>' +
            '<span class="ui-toggle-pill">מוצג ✓</span>' +
          '</button>' +
          '<button id="btn-pref-showPrevNext" class="perf-option-btn ui-toggle-btn focusable" data-ui-toggle="showPrevNext">' +
            '<span class="ui-toggle-text" style="display:flex;flex-direction:column;min-width:0;margin-left:12px;">' +
              '<span class="perf-opt-title">שורה קודמת והבאה</span>' +
              '<span class="perf-opt-sub">מציג את התוכנית הקודמת והבאה בתור</span>' +
            '</span>' +
            '<span class="ui-toggle-pill">מוצג ✓</span>' +
          '</button>' +
          '<button id="btn-pref-showChannelNumbers" class="perf-option-btn ui-toggle-btn focusable" data-ui-toggle="showChannelNumbers">' +
            '<span class="ui-toggle-text" style="display:flex;flex-direction:column;min-width:0;margin-left:12px;">' +
              '<span class="perf-opt-title">מספרי ערוצים ברשימה וב-OSD</span>' +
              '<span class="perf-opt-sub">מציג מספור מספרי בכל ערוץ</span>' +
            '</span>' +
            '<span class="ui-toggle-pill">מוצג ✓</span>' +
          '</button>' +
          '<button id="btn-pref-showToasts" class="perf-option-btn ui-toggle-btn focusable" data-ui-toggle="showToasts">' +
            '<span class="ui-toggle-text" style="display:flex;flex-direction:column;min-width:0;margin-left:12px;">' +
              '<span class="perf-opt-title">התראות קופצות (Toasts)</span>' +
              '<span class="perf-opt-sub">הודעות חיווי בתחתית המסך בעת שינויים</span>' +
            '</span>' +
            '<span class="ui-toggle-pill">מוצג ✓</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="perf-section-card ui-pref-card">' +
        '<h3>צפיפות רשימה, גודל טקסט וצבע דגש</h3>' +
        '<p class="perf-desc">צפיפות שורות הערוצים:</p>' +
        '<div class="perf-options-grid ui-grid-3" id="ui-density-options">' +
          '<button id="btn-density-comfortable" class="perf-option-btn focusable" data-ui-pref="density" data-ui-value="comfortable">' +
            '<span class="perf-opt-title">מרווח (Comfortable)</span>' +
            '<span class="perf-opt-sub">שורות גבוהות עם ריווח נדיב</span>' +
          '</button>' +
          '<button id="btn-density-balanced" class="perf-option-btn focusable" data-ui-pref="density" data-ui-value="balanced">' +
            '<span class="perf-opt-title">מאוזן (Balanced)</span>' +
            '<span class="perf-opt-sub">שילוב מיטבי של קריאות וכמות ערוצים</span>' +
          '</button>' +
          '<button id="btn-density-compact" class="perf-option-btn focusable" data-ui-pref="density" data-ui-value="compact">' +
            '<span class="perf-opt-title">דחוס (Compact)</span>' +
            '<span class="perf-opt-sub">מציג יותר ערוצים בו-זמנית על המסך</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">גודל גופן וטקסט:</p>' +
        '<div class="perf-options-grid ui-grid-3" id="ui-scale-options">' +
          '<button id="btn-scale-sm" class="perf-option-btn focusable" data-ui-pref="fontScale" data-ui-value="sm">' +
            '<span class="perf-opt-title">קומפקטי (קטן)</span>' +
            '<span class="perf-opt-sub">טקסט עדין ומאופק</span>' +
          '</button>' +
          '<button id="btn-scale-md" class="perf-option-btn focusable" data-ui-pref="fontScale" data-ui-value="md">' +
            '<span class="perf-opt-title">רגיל (ברירת מחדל)</span>' +
            '<span class="perf-opt-sub">מאוזן למרחק צפייה בסלון</span>' +
          '</button>' +
          '<button id="btn-scale-lg" class="perf-option-btn focusable" data-ui-pref="fontScale" data-ui-value="lg">' +
            '<span class="perf-opt-title">מוגדל (קריא במיוחד)</span>' +
            '<span class="perf-opt-sub">נוח לקריאה מרחוק</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">צבע הדגשה ראשי (Accent):</p>' +
        '<div class="perf-options-grid ui-grid-5" id="ui-accent-options">' +
          '<button id="btn-accent-sky" class="perf-option-btn focusable" data-ui-pref="accent" data-ui-value="sky">' +
            '<span class="perf-opt-title"><span class="ui-accent-dot dot-sky"></span>תכלת (Sky)</span>' +
            '<span class="perf-opt-sub">ברירת מחדל</span>' +
          '</button>' +
          '<button id="btn-accent-indigo" class="perf-option-btn focusable" data-ui-pref="accent" data-ui-value="indigo">' +
            '<span class="perf-opt-title"><span class="ui-accent-dot dot-indigo"></span>אינדיגו</span>' +
            '<span class="perf-opt-sub">כחול עמוק</span>' +
          '</button>' +
          '<button id="btn-accent-emerald" class="perf-option-btn focusable" data-ui-pref="accent" data-ui-value="emerald">' +
            '<span class="perf-opt-title"><span class="ui-accent-dot dot-emerald"></span>אזמרגד</span>' +
            '<span class="perf-opt-sub">ירוק חי</span>' +
          '</button>' +
          '<button id="btn-accent-amber" class="perf-option-btn focusable" data-ui-pref="accent" data-ui-value="amber">' +
            '<span class="perf-opt-title"><span class="ui-accent-dot dot-amber"></span>ענבר</span>' +
            '<span class="perf-opt-sub">זהב חם</span>' +
          '</button>' +
          '<button id="btn-accent-mono" class="perf-option-btn focusable" data-ui-pref="accent" data-ui-value="mono">' +
            '<span class="perf-opt-title"><span class="ui-accent-dot dot-mono"></span>מונוכרום</span>' +
            '<span class="perf-opt-sub">אפור נקי</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="perf-section-card ui-pref-card">' +
        '<h3>קלילות, אנימציות ותצוגה מקדימה</h3>' +
        '<p class="perf-desc">רמת אנימציות ומעברים:</p>' +
        '<div class="perf-options-grid ui-grid-3" id="ui-anim-options">' +
          '<button id="btn-anim-normal" class="perf-option-btn focusable" data-ui-pref="animations" data-ui-value="normal">' +
            '<span class="perf-opt-title">מלאות</span>' +
            '<span class="perf-opt-sub">אנימציות ומעברים מלאים</span>' +
          '</button>' +
          '<button id="btn-anim-reduced" class="perf-option-btn focusable" data-ui-pref="animations" data-ui-value="reduced">' +
            '<span class="perf-opt-title">מופחתות (מומלץ)</span>' +
            '<span class="perf-opt-sub">מהיר, חלק וללא הבהובים</span>' +
          '</button>' +
          '<button id="btn-anim-off" class="perf-option-btn focusable" data-ui-pref="animations" data-ui-value="off">' +
            '<span class="perf-opt-title">ללא אנימציות</span>' +
            '<span class="perf-opt-sub">תגובה מיידית של 0ms</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">אפקטים חזותיים והצללות:</p>' +
        '<div class="perf-options-grid ui-grid-3" id="ui-fx-options">' +
          '<button id="btn-fx-full" class="perf-option-btn focusable" data-ui-pref="visualEffects" data-ui-value="full">' +
            '<span class="perf-opt-title">מלא (Full FX)</span>' +
            '<span class="perf-opt-sub">עומק, הילות וזכוכית מלאה</span>' +
          '</button>' +
          '<button id="btn-fx-light" class="perf-option-btn focusable" data-ui-pref="visualEffects" data-ui-value="light">' +
            '<span class="perf-opt-title">קל (Light)</span>' +
            '<span class="perf-opt-sub">משטחים נקיים ועומס GPU נמוך</span>' +
          '</button>' +
          '<button id="btn-fx-flat" class="perf-option-btn focusable" data-ui-pref="visualEffects" data-ui-value="flat">' +
            '<span class="perf-opt-title">שטוח (Flat)</span>' +
            '<span class="perf-opt-sub">ללא צללים וגרדיאנטים למהירות שיא</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">ניגון תצוגה מקדימה ברשימת הערוצים:</p>' +
        '<div class="perf-options-grid ui-grid-3" id="ui-autoplay-options">' +
          '<button id="btn-autoplay-instant" class="perf-option-btn focusable" data-ui-pref="previewAutoplay" data-ui-value="instant">' +
            '<span class="perf-opt-title">מיידי (Instant)</span>' +
            '<span class="perf-opt-sub">פותח את התצוגה המקדימה מיד ב-OK</span>' +
          '</button>' +
          '<button id="btn-autoplay-delayed" class="perf-option-btn focusable" data-ui-pref="previewAutoplay" data-ui-value="delayed">' +
            '<span class="perf-opt-title">מושהה חכם (מומלץ)</span>' +
            '<span class="perf-opt-sub">השהיה קלה למניעת טעינה בזפזופ</span>' +
          '</button>' +
          '<button id="btn-autoplay-off" class="perf-option-btn focusable" data-ui-pref="previewAutoplay" data-ui-value="off">' +
            '<span class="perf-opt-title">כבוי (חיסכון מלא)</span>' +
            '<span class="perf-opt-sub">לחיצה על ערוץ פותחת ישר מסך מלא</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="perf-section-card ui-pref-card">' +
        '<h3>סרגל מידע במסך מלא (OSD) ומצב פתיחה</h3>' +
        '<p class="perf-desc">סגנון סרגל המידע (OSD):</p>' +
        '<div class="perf-options-grid ui-grid-3" id="ui-osd-style-options">' +
          '<button id="btn-osd-clean" class="perf-option-btn focusable" data-ui-pref="osdStyle" data-ui-value="clean">' +
            '<span class="perf-opt-title">נקי (Clean)</span>' +
            '<span class="perf-opt-sub">תוכנית נוכחית, הבאה ותקציר ללא עומס</span>' +
          '</button>' +
          '<button id="btn-osd-minimal" class="perf-option-btn focusable" data-ui-pref="osdStyle" data-ui-value="minimal">' +
            '<span class="perf-opt-title">מינימליסטי (Minimal)</span>' +
            '<span class="perf-opt-sub">פס תחתון דק עם ערוץ, תוכנית ושעה בלבד</span>' +
          '</button>' +
          '<button id="btn-osd-full" class="perf-option-btn focusable" data-ui-pref="osdStyle" data-ui-value="full">' +
            '<span class="perf-opt-title">מלא (Full)</span>' +
            '<span class="perf-opt-sub">כולל מקרא כפתורים מלא וגרסה</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">משך הצגת סרגל המידע (שניות):</p>' +
        '<div class="perf-options-grid ui-grid-4" id="ui-osd-timeout-options">' +
          '<button id="btn-osd-sec-3" class="perf-option-btn focusable" data-ui-pref="osdTimeoutSec" data-ui-value="3">' +
            '<span class="perf-opt-title">3 שניות</span>' +
            '<span class="perf-opt-sub">היעלמות מהירה</span>' +
          '</button>' +
          '<button id="btn-osd-sec-5" class="perf-option-btn focusable" data-ui-pref="osdTimeoutSec" data-ui-value="5">' +
            '<span class="perf-opt-title">5 שניות</span>' +
            '<span class="perf-opt-sub">ברירת מחדל</span>' +
          '</button>' +
          '<button id="btn-osd-sec-8" class="perf-option-btn focusable" data-ui-pref="osdTimeoutSec" data-ui-value="8">' +
            '<span class="perf-opt-title">8 שניות</span>' +
            '<span class="perf-opt-sub">קריאה נוחה</span>' +
          '</button>' +
          '<button id="btn-osd-sec-12" class="perf-option-btn focusable" data-ui-pref="osdTimeoutSec" data-ui-value="12">' +
            '<span class="perf-opt-title">12 שניות</span>' +
            '<span class="perf-opt-sub">זמן ממושך</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">מסך פתיחה בעליית האפליקציה:</p>' +
        '<div class="perf-options-grid" id="ui-startup-options">' +
          '<button id="btn-startup-browse" class="perf-option-btn focusable" data-ui-pref="startupMode" data-ui-value="browse">' +
            '<span class="perf-opt-title">רשימת ערוצים (Browse)</span>' +
            '<span class="perf-opt-sub">פתיחה במסך הדפדוף והתצוגה המקדימה</span>' +
          '</button>' +
          '<button id="btn-startup-fullscreen" class="perf-option-btn focusable" data-ui-pref="startupMode" data-ui-value="fullscreen">' +
            '<span class="perf-opt-title">מסך מלא ישיר (Fullscreen)</span>' +
            '<span class="perf-opt-sub">פתיחה ישירה של הערוץ האחרון במסך מלא</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="perf-section-card ui-pref-card">' +
        '<h3>פריסה, רקע ופוקוס</h3>' +
        '<p class="perf-desc">מיקום רשימת הערוצים:</p>' +
        '<div class="perf-options-grid" id="ui-layout-options">' +
          '<button id="btn-layout-right" class="perf-option-btn focusable" data-ui-pref="layoutSide" data-ui-value="right">' +
            '<span class="perf-opt-title">רשימה בימין (ברירת מחדל)</span>' +
            '<span class="perf-opt-sub">רשימת ערוצים בצד ימין, תצוגה מקדימה בשמאל</span>' +
          '</button>' +
          '<button id="btn-layout-left" class="perf-option-btn focusable" data-ui-pref="layoutSide" data-ui-value="left">' +
            '<span class="perf-opt-title">רשימה בשמאל (Left)</span>' +
            '<span class="perf-opt-sub">רשימת ערוצים בצד שמאל, תצוגה מקדימה בימין</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">רוחב רשימת הערוצים וחלון התצוגה:</p>' +
        '<div class="perf-options-grid ui-grid-3" id="ui-list-width-options">' +
          '<button id="btn-listwidth-narrow" class="perf-option-btn focusable" data-ui-pref="listWidth" data-ui-value="narrow">' +
            '<span class="perf-opt-title">רשימה צרה</span>' +
            '<span class="perf-opt-sub">תצוגה מקדימה רחבה (1020px)</span>' +
          '</button>' +
          '<button id="btn-listwidth-balanced" class="perf-option-btn focusable" data-ui-pref="listWidth" data-ui-value="balanced">' +
            '<span class="perf-opt-title">מאוזנת (ברירת מחדל)</span>' +
            '<span class="perf-opt-sub">חלוקה שווה 16:9 (960px)</span>' +
          '</button>' +
          '<button id="btn-listwidth-wide" class="perf-option-btn focusable" data-ui-pref="listWidth" data-ui-value="wide">' +
            '<span class="perf-opt-title">רשימה רחבה</span>' +
            '<span class="perf-opt-sub">מקום מורחב לשמות ותוכניות</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">עגוליות פינות (Corner Radius):</p>' +
        '<div class="perf-options-grid ui-grid-3" id="ui-radius-options">' +
          '<button id="btn-radius-sharp" class="perf-option-btn focusable" data-ui-pref="cornerRadius" data-ui-value="sharp">' +
            '<span class="perf-opt-title">חד (Sharp)</span>' +
            '<span class="perf-opt-sub">פינות ישרות ונקיות</span>' +
          '</button>' +
          '<button id="btn-radius-rounded" class="perf-option-btn focusable" data-ui-pref="cornerRadius" data-ui-value="rounded">' +
            '<span class="perf-opt-title">מעוגל (ברירת מחדל)</span>' +
            '<span class="perf-opt-sub">פינות מעוגלות מודרניות</span>' +
          '</button>' +
          '<button id="btn-radius-pill" class="perf-option-btn focusable" data-ui-pref="cornerRadius" data-ui-value="pill">' +
            '<span class="perf-opt-title">גלולה (Pill)</span>' +
            '<span class="perf-opt-sub">פינות עגולות ורכות במיוחד</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">גוון רקע ראשי (Background Tone):</p>' +
        '<div class="perf-options-grid ui-grid-4" id="ui-bgtone-options">' +
          '<button id="btn-bgtone-midnight" class="perf-option-btn focusable" data-ui-pref="bgTone" data-ui-value="midnight">' +
            '<span class="perf-opt-title">חצות (Midnight)</span>' +
            '<span class="perf-opt-sub">רקע כהה מאוזן</span>' +
          '</button>' +
          '<button id="btn-bgtone-oled" class="perf-option-btn focusable" data-ui-pref="bgTone" data-ui-value="oled">' +
            '<span class="perf-opt-title">שחור OLED טהור</span>' +
            '<span class="perf-opt-sub">שחור מוחלט #000</span>' +
          '</button>' +
          '<button id="btn-bgtone-slate" class="perf-option-btn focusable" data-ui-pref="bgTone" data-ui-value="slate">' +
            '<span class="perf-opt-title">צפחה (Slate)</span>' +
            '<span class="perf-opt-sub">אפור פחם מאט</span>' +
          '</button>' +
          '<button id="btn-bgtone-deepblue" class="perf-option-btn focusable" data-ui-pref="bgTone" data-ui-value="deepblue">' +
            '<span class="perf-opt-title">כחול עמוק</span>' +
            '<span class="perf-opt-sub">כחול Broadcast</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">סגנון הדגשת פוקוס בשלט:</p>' +
        '<div class="perf-options-grid ui-grid-3" id="ui-focusstyle-options">' +
          '<button id="btn-focusstyle-glow" class="perf-option-btn focusable" data-ui-pref="focusStyle" data-ui-value="glow">' +
            '<span class="perf-opt-title">הילה (Glow)</span>' +
            '<span class="perf-opt-sub">מסגרת זוהרת עדינה</span>' +
          '</button>' +
          '<button id="btn-focusstyle-border" class="perf-option-btn focusable" data-ui-pref="focusStyle" data-ui-value="border">' +
            '<span class="perf-opt-title">מסגרת חדה (Border)</span>' +
            '<span class="perf-opt-sub">גבול ניגודי ברור</span>' +
          '</button>' +
          '<button id="btn-focusstyle-solid" class="perf-option-btn focusable" data-ui-pref="focusStyle" data-ui-value="solid">' +
            '<span class="perf-opt-title">מלא (Solid)</span>' +
            '<span class="perf-opt-sub">הדגשה מלאה בצבע הדגש</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">שקיפות סרגל המידע (OSD Opacity):</p>' +
        '<div class="perf-options-grid ui-grid-3" id="ui-osd-opacity-options">' +
          '<button id="btn-osdop-solid" class="perf-option-btn focusable" data-ui-pref="osdOpacity" data-ui-value="solid">' +
            '<span class="perf-opt-title">אטום וחד (Solid)</span>' +
            '<span class="perf-opt-sub">קריאות מקסימלית</span>' +
          '</button>' +
          '<button id="btn-osdop-balanced" class="perf-option-btn focusable" data-ui-pref="osdOpacity" data-ui-value="balanced">' +
            '<span class="perf-opt-title">מאוזן (ברירת מחדל)</span>' +
            '<span class="perf-opt-sub">שקיפות עדינה</span>' +
          '</button>' +
          '<button id="btn-osdop-light" class="perf-option-btn focusable" data-ui-pref="osdOpacity" data-ui-value="light">' +
            '<span class="perf-opt-title">שקוף וקל (Light)</span>' +
            '<span class="perf-opt-sub">מראה אוורירי על גבי השידור</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="perf-section-card ui-pref-card">' +
        '<h3>ניווט ושלט רחוק</h3>' +
        '<div class="perf-options-grid" id="ui-nav-toggles">' +
          '<button id="btn-pref-wrapNavigation" class="perf-option-btn ui-toggle-btn focusable" data-ui-toggle="wrapNavigation">' +
            '<span class="ui-toggle-text" style="display:flex;flex-direction:column;min-width:0;margin-left:12px;">' +
              '<span class="perf-opt-title">גלילה מעגלית ברשימה</span>' +
              '<span class="perf-opt-sub">מעבר מהערוץ האחרון לראשון ולהיפך</span>' +
            '</span>' +
            '<span class="ui-toggle-pill">מופעל ✓</span>' +
          '</button>' +
          '<button id="btn-pref-singleClickFullscreen" class="perf-option-btn ui-toggle-btn focusable" data-ui-toggle="singleClickFullscreen">' +
            '<span class="ui-toggle-text" style="display:flex;flex-direction:column;min-width:0;margin-left:12px;">' +
              '<span class="perf-opt-title">מסך מלא בלחיצת OK אחת</span>' +
              '<span class="perf-opt-sub">בחירת ערוץ ברשימה נכנסת מיד למסך מלא</span>' +
            '</span>' +
            '<span class="ui-toggle-pill">כבוי</span>' +
          '</button>' +
          '<button id="btn-pref-backHidesOsdFirst" class="perf-option-btn ui-toggle-btn focusable" data-ui-toggle="backHidesOsdFirst">' +
            '<span class="ui-toggle-text" style="display:flex;flex-direction:column;min-width:0;margin-left:12px;">' +
              '<span class="perf-opt-title">חזור ראשון מסתיר פס מידע</span>' +
              '<span class="perf-opt-sub">במסך מלא: לחיצה ראשונה תסתיר OSD, שנייה תחזור לרשימה</span>' +
            '</span>' +
            '<span class="ui-toggle-pill">מופעל ✓</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">כניסה אוטומטית למסך מלא בעמידה על ערוץ:</p>' +
        '<div class="perf-options-grid ui-grid-5" id="ui-autofullscreen-options">' +
          '<button id="btn-autofs-0" class="perf-option-btn focusable" data-ui-pref="autoFullscreenSec" data-ui-value="0">' +
            '<span class="perf-opt-title">כבוי</span>' +
            '<span class="perf-opt-sub">ללא מעבר אוטומטי</span>' +
          '</button>' +
          '<button id="btn-autofs-5" class="perf-option-btn focusable" data-ui-pref="autoFullscreenSec" data-ui-value="5">' +
            '<span class="perf-opt-title">5 שניות</span>' +
            '<span class="perf-opt-sub">מעבר מהיר</span>' +
          '</button>' +
          '<button id="btn-autofs-8" class="perf-option-btn focusable" data-ui-pref="autoFullscreenSec" data-ui-value="8">' +
            '<span class="perf-opt-title">8 שניות</span>' +
            '<span class="perf-opt-sub">ברירת מחדל</span>' +
          '</button>' +
          '<button id="btn-autofs-12" class="perf-option-btn focusable" data-ui-pref="autoFullscreenSec" data-ui-value="12">' +
            '<span class="perf-opt-title">12 שניות</span>' +
            '<span class="perf-opt-sub">המתנה נוחה</span>' +
          '</button>' +
          '<button id="btn-autofs-20" class="perf-option-btn focusable" data-ui-pref="autoFullscreenSec" data-ui-value="20">' +
            '<span class="perf-opt-title">20 שניות</span>' +
            '<span class="perf-opt-sub">המתנה ארוכה</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">צעד הרצה קדימה/אחורה במסך מלא (שניות):</p>' +
        '<div class="perf-options-grid ui-grid-4" id="ui-seekstep-options">' +
          '<button id="btn-seekstep-10" class="perf-option-btn focusable" data-ui-pref="seekStepSec" data-ui-value="10">' +
            '<span class="perf-opt-title">10 שניות</span>' +
            '<span class="perf-opt-sub">דילוג מדויק</span>' +
          '</button>' +
          '<button id="btn-seekstep-15" class="perf-option-btn focusable" data-ui-pref="seekStepSec" data-ui-value="15">' +
            '<span class="perf-opt-title">15 שניות</span>' +
            '<span class="perf-opt-sub">דילוג קצר</span>' +
          '</button>' +
          '<button id="btn-seekstep-30" class="perf-option-btn focusable" data-ui-pref="seekStepSec" data-ui-value="30">' +
            '<span class="perf-opt-title">30 שניות</span>' +
            '<span class="perf-opt-sub">ברירת מחדל</span>' +
          '</button>' +
          '<button id="btn-seekstep-60" class="perf-option-btn focusable" data-ui-pref="seekStepSec" data-ui-value="60">' +
            '<span class="perf-opt-title">60 שניות</span>' +
            '<span class="perf-opt-sub">דילוג מהיר</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">השהיית מעבר לאחר הקלדת מספר ערוץ בשלט:</p>' +
        '<div class="perf-options-grid ui-grid-3" id="ui-jumpms-options">' +
          '<button id="btn-jumpms-700" class="perf-option-btn focusable" data-ui-pref="numericJumpMs" data-ui-value="700">' +
            '<span class="perf-opt-title">מהיר (700ms)</span>' +
            '<span class="perf-opt-sub">מעבר זריז</span>' +
          '</button>' +
          '<button id="btn-jumpms-1200" class="perf-option-btn focusable" data-ui-pref="numericJumpMs" data-ui-value="1200">' +
            '<span class="perf-opt-title">מאוזן (1200ms)</span>' +
            '<span class="perf-opt-sub">ברירת מחדל</span>' +
          '</button>' +
          '<button id="btn-jumpms-2000" class="perf-option-btn focusable" data-ui-pref="numericJumpMs" data-ui-value="2000">' +
            '<span class="perf-opt-title">נינוח (2000ms)</span>' +
            '<span class="perf-opt-sub">נוח לערוצים תלת-ספרתיים</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">השהיית טעינת תצוגה בזפזופ (Zap Debounce):</p>' +
        '<div class="perf-options-grid ui-grid-3" id="ui-zapdebounce-options">' +
          '<button id="btn-zapdebounce-0" class="perf-option-btn focusable" data-ui-pref="zapDebounceMs" data-ui-value="0">' +
            '<span class="perf-opt-title">מיידי (0ms)</span>' +
            '<span class="perf-opt-sub">תגובה מיידית</span>' +
          '</button>' +
          '<button id="btn-zapdebounce-120" class="perf-option-btn focusable" data-ui-pref="zapDebounceMs" data-ui-value="120">' +
            '<span class="perf-opt-title">מאוזן (120ms)</span>' +
            '<span class="perf-opt-sub">ברירת מחדל</span>' +
          '</button>' +
          '<button id="btn-zapdebounce-280" class="perf-option-btn focusable" data-ui-pref="zapDebounceMs" data-ui-value="280">' +
            '<span class="perf-opt-title">חסכוני (280ms)</span>' +
            '<span class="perf-opt-sub">זפזופ חלק בלי עומס</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="perf-section-card ui-pref-card" id="ui-power-voice-card">' +
        '<h3>כיבוי מסך אוטומטי (חיסכון בחשמל) ושפת פקודות קוליות</h3>' +
        '<p class="perf-desc">טיימר כיבוי מסך אוטומטי בחוסר פעילות (ברירת מחדל: 4 שעות):</p>' +
        '<div class="perf-options-grid ui-grid-4" id="ui-sleep-options">' +
          '<button id="btn-sleep-0" class="perf-option-btn focusable" type="button" data-sleep-hours="0">' +
            '<span class="perf-opt-title">כבוי</span>' +
            '<span class="perf-opt-sub">ללא כיבוי אוטומטי</span>' +
          '</button>' +
          '<button id="btn-sleep-1" class="perf-option-btn focusable" type="button" data-sleep-hours="1">' +
            '<span class="perf-opt-title">1 שעה</span>' +
            '<span class="perf-opt-sub">חיסכון מהיר</span>' +
          '</button>' +
          '<button id="btn-sleep-2" class="perf-option-btn focusable" type="button" data-sleep-hours="2">' +
            '<span class="perf-opt-title">2 שעות</span>' +
            '<span class="perf-opt-sub">צפייה קצרה</span>' +
          '</button>' +
          '<button id="btn-sleep-3" class="perf-option-btn focusable" type="button" data-sleep-hours="3">' +
            '<span class="perf-opt-title">3 שעות</span>' +
            '<span class="perf-opt-sub">מאוזן</span>' +
          '</button>' +
          '<button id="btn-sleep-4" class="perf-option-btn focusable" type="button" data-sleep-hours="4">' +
            '<span class="perf-opt-title">4 שעות</span>' +
            '<span class="perf-opt-sub">ברירת מחדל</span>' +
          '</button>' +
          '<button id="btn-sleep-6" class="perf-option-btn focusable" type="button" data-sleep-hours="6">' +
            '<span class="perf-opt-title">6 שעות</span>' +
            '<span class="perf-opt-sub">צפייה ממושכת</span>' +
          '</button>' +
          '<button id="btn-sleep-8" class="perf-option-btn focusable" type="button" data-sleep-hours="8">' +
            '<span class="perf-opt-title">8 שעות</span>' +
            '<span class="perf-opt-sub">לילה ארוך</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">שפת זיהוי פקודות קוליות (Voice Language):</p>' +
        '<div class="perf-options-grid" id="ui-voice-lang-options">' +
          '<button id="btn-voicelang-he" class="perf-option-btn focusable" type="button" data-voice-lang="he-IL">' +
            '<span class="perf-opt-title">עברית (he-IL)</span>' +
            '<span class="perf-opt-sub">ברירת מחדל</span>' +
          '</button>' +
          '<button id="btn-voicelang-en" class="perf-option-btn focusable" type="button" data-voice-lang="en-US">' +
            '<span class="perf-opt-title">English (en-US)</span>' +
            '<span class="perf-opt-sub">פקודות באנגלית</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="perf-actions-bar">' +
        '<div id="ui-prefs-status" class="perf-cache-status">מצב: נקי ומאוזן • צפיפות: מאוזנת • אנימציות: מופחתות</div>' +
        '<div class="perf-action-btns">' +
          '<button id="btn-reset-ui-prefs" class="btn-tv-secondary focusable">איפוס הגדרות עיצוב לברירת מחדל</button>' +
        '</div>' +
      '</div>'
    );
  }

  _getAvTabHTML() {
    return (
      '<div class="perf-section-card ui-pref-card">' +
        '<h3>סאונד ונרמול עוצמת שמע (Audio Normalization)</h3>' +
        '<p class="perf-desc">השוואת עוצמת הקול בין ערוצים למניעת קפיצות ווליום או לחישות שקטות:</p>' +
        '<div class="perf-options-grid ui-grid-4" id="av-audio-norm-options">' +
          '<button id="btn-av-norm-off" class="perf-option-btn focusable" data-av-pref="audioNormMode" data-av-value="off">' +
            '<span class="perf-opt-title">כבוי (Passthrough)</span>' +
            '<span class="perf-opt-sub">שמע מקורי ללא עיבוד</span>' +
          '</button>' +
          '<button id="btn-av-norm-gentle" class="perf-option-btn focusable" data-av-pref="audioNormMode" data-av-value="gentle">' +
            '<span class="perf-opt-title">עדין (Gentle)</span>' +
            '<span class="perf-opt-sub">השוואת עוצמה רכה (-18 dBFS)</span>' +
          '</button>' +
          '<button id="btn-av-norm-broadcast" class="perf-option-btn focusable" data-av-pref="audioNormMode" data-av-value="broadcast">' +
            '<span class="perf-opt-title">שידור אחיד (Broadcast)</span>' +
            '<span class="perf-opt-sub">נרמול אחיד וצלול (-16 dBFS)</span>' +
          '</button>' +
          '<button id="btn-av-norm-night" class="perf-option-btn focusable" data-av-pref="audioNormMode" data-av-value="night">' +
            '<span class="perf-opt-title">לילה (Night Mode)</span>' +
            '<span class="perf-opt-sub">דחיסה עמוקה לשמירה על שקט</span>' +
          '</button>' +
        '</div>' +
        '<div class="perf-options-grid" id="av-audio-toggles">' +
          '<button id="btn-av-audioVoiceBoost" class="perf-option-btn ui-toggle-btn focusable" data-av-toggle="audioVoiceBoost">' +
            '<span class="ui-toggle-text" style="display:flex;flex-direction:column;min-width:0;margin-left:12px;">' +
              '<span class="perf-opt-title">הדגשת דיבור (Voice Boost)</span>' +
              '<span class="perf-opt-sub">חידוד תדרי קול אנושי (2.4kHz) לדיאלוג ברור</span>' +
            '</span>' +
            '<span class="ui-toggle-pill">כבוי</span>' +
          '</button>' +
          '<button id="btn-av-audioZapFade" class="perf-option-btn ui-toggle-btn focusable" data-av-toggle="audioZapFade">' +
            '<span class="ui-toggle-text" style="display:flex;flex-direction:column;min-width:0;margin-left:12px;">' +
              '<span class="perf-opt-title">כניסת שמע רכה בזפזופ (Zap Fade)</span>' +
              '<span class="perf-opt-sub">עמעום הדרגתי וחלק של 280ms במעבר ערוץ</span>' +
            '</span>' +
            '<span class="ui-toggle-pill">מופעל ✓</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc" id="av-channel-trim-label">כיוון עוצמה אישי לערוץ הנוכחי (Volume Trim):</p>' +
        '<div class="perf-options-grid ui-grid-5" id="av-channel-trim-options">' +
          '<button id="btn-av-trim--6" class="perf-option-btn focusable" data-av-trim="-6">' +
            '<span class="perf-opt-title">-6 dB</span>' +
            '<span class="perf-opt-sub">הנמכה חזקה</span>' +
          '</button>' +
          '<button id="btn-av-trim--3" class="perf-option-btn focusable" data-av-trim="-3">' +
            '<span class="perf-opt-title">-3 dB</span>' +
            '<span class="perf-opt-sub">הנמכה עדינה</span>' +
          '</button>' +
          '<button id="btn-av-trim-0" class="perf-option-btn focusable" data-av-trim="0">' +
            '<span class="perf-opt-title">0 dB</span>' +
            '<span class="perf-opt-sub">ברירת מחדל</span>' +
          '</button>' +
          '<button id="btn-av-trim-3" class="perf-option-btn focusable" data-av-trim="3">' +
            '<span class="perf-opt-title">+3 dB</span>' +
            '<span class="perf-opt-sub">הגברה קלה</span>' +
          '</button>' +
          '<button id="btn-av-trim-6" class="perf-option-btn focusable" data-av-trim="6">' +
            '<span class="perf-opt-title">+6 dB</span>' +
            '<span class="perf-opt-sub">הגברה חזקה</span>' +
          '</button>' +
        '</div>' +
        '<div class="perf-action-btns" style="margin-top:6px;">' +
          '<button id="btn-reset-loudness-memory" class="btn-tv-secondary focusable">איפוס זיכרון עוצמת שמע לערוצים</button>' +
        '</div>' +
      '</div>' +
      '<div class="perf-section-card ui-pref-card">' +
        '<h3>איכות וידאו, שיהוי נמוך וחיסכון בזיכרון</h3>' +
        '<p class="perf-desc">בחירת פרופיל איכות וידאו (ABR):</p>' +
        '<div class="perf-options-grid ui-grid-4" id="av-quality-options">' +
          '<button id="btn-av-quality-smart" class="perf-option-btn focusable" data-av-pref="videoQualityMode" data-av-value="smart">' +
            '<span class="perf-opt-title">חכם מדורג (Smart)</span>' +
            '<span class="perf-opt-sub">פתיחה מהירה ועלייה ל-HD</span>' +
          '</button>' +
          '<button id="btn-av-quality-max" class="perf-option-btn focusable" data-av-pref="videoQualityMode" data-av-value="max">' +
            '<span class="perf-opt-title">איכות שיא (Max)</span>' +
            '<span class="perf-opt-sub">התחלה מיידית באיכות מרבית</span>' +
          '</button>' +
          '<button id="btn-av-quality-hd1080" class="perf-option-btn focusable" data-av-pref="videoQualityMode" data-av-value="hd1080">' +
            '<span class="perf-opt-title">עד 1080p</span>' +
            '<span class="perf-opt-sub">מגביל רזולוציה ל-Full HD</span>' +
          '</button>' +
          '<button id="btn-av-quality-hd720" class="perf-option-btn focusable" data-av-pref="videoQualityMode" data-av-value="hd720">' +
            '<span class="perf-opt-title">עד 720p (חיסכון)</span>' +
            '<span class="perf-opt-sub">מונע עומס בטלוויזיות חלשות</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">מצב שיהוי שידור (Latency):</p>' +
        '<div class="perf-options-grid" id="av-latency-options">' +
          '<button id="btn-av-latency-standard" class="perf-option-btn focusable" data-av-pref="streamLatencyMode" data-av-value="standard">' +
            '<span class="perf-opt-title">יציב רגיל (Standard)</span>' +
            '<span class="perf-opt-sub">שמירה על רציפות השידור נגד תקיעות</span>' +
          '</button>' +
          '<button id="btn-av-latency-low" class="perf-option-btn focusable" data-av-pref="streamLatencyMode" data-av-value="low">' +
            '<span class="perf-opt-title">שיהוי נמוך (Low Latency)</span>' +
            '<span class="perf-opt-sub">קרוב יותר לזמן האמת (לשידורי ספורט)</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">ניהול זיכרון באפר (Memory Saver):</p>' +
        '<div class="perf-options-grid ui-grid-3" id="av-memsaver-options">' +
          '<button id="btn-av-memsaver-auto" class="perf-option-btn focusable" data-av-pref="memorySaverMode" data-av-value="auto">' +
            '<span class="perf-opt-title">אוטומטי (Auto)</span>' +
            '<span class="perf-opt-sub">מותאם לחומרת המכשיר</span>' +
          '</button>' +
          '<button id="btn-av-memsaver-aggressive" class="perf-option-btn focusable" data-av-pref="memorySaverMode" data-av-value="aggressive">' +
            '<span class="perf-opt-title">אגרסיבי (Aggressive)</span>' +
            '<span class="perf-opt-sub">צריכת RAM מינימלית (20MB)</span>' +
          '</button>' +
          '<button id="btn-av-memsaver-off" class="perf-option-btn focusable" data-av-pref="memorySaverMode" data-av-value="off">' +
            '<span class="perf-opt-title">כבוי (Full)</span>' +
            '<span class="perf-opt-sub">ניצול מלוא פרופיל הבאפר</span>' +
          '</button>' +
        '</div>' +
        '<div class="perf-options-grid" id="av-stats-toggle">' +
          '<button id="btn-av-showStreamStats" class="perf-option-btn ui-toggle-btn focusable" data-av-toggle="showStreamStats">' +
            '<span class="ui-toggle-text" style="display:flex;flex-direction:column;min-width:0;margin-left:12px;">' +
              '<span class="perf-opt-title">מד נתוני שידור חי (Stream Stats)</span>' +
              '<span class="perf-opt-sub">מציג רזולוציה, קצב ביטים, באפר ו-Audio Gain במסך מלא</span>' +
            '</span>' +
            '<span class="ui-toggle-pill">כבוי</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="perf-section-card ui-pref-card">' +
        '<h3>כיול תמונה ויחס מסך (Picture Calibration &amp; Aspect)</h3>' +
        '<p class="perf-desc">מצב תמונה מהיר (Picture Preset):</p>' +
        '<div class="perf-options-grid ui-grid-5" id="av-pic-preset-options">' +
          '<button id="btn-av-pic-original" class="perf-option-btn focusable" data-av-pic-preset="original">' +
            '<span class="perf-opt-title">מקורי</span>' +
            '<span class="perf-opt-sub">ללא פילטר GPU</span>' +
          '</button>' +
          '<button id="btn-av-pic-vivid" class="perf-option-btn focusable" data-av-pic-preset="vivid">' +
            '<span class="perf-opt-title">חי (Vivid)</span>' +
            '<span class="perf-opt-sub">צבעים עזים</span>' +
          '</button>' +
          '<button id="btn-av-pic-cinema" class="perf-option-btn focusable" data-av-pic-preset="cinema">' +
            '<span class="perf-opt-title">קולנוע</span>' +
            '<span class="perf-opt-sub">מאוזן לחדר חשוך</span>' +
          '</button>' +
          '<button id="btn-av-pic-crisp" class="perf-option-btn focusable" data-av-pic-preset="crisp">' +
            '<span class="perf-opt-title">חד (Crisp)</span>' +
            '<span class="perf-opt-sub">חידוד וניגודיות</span>' +
          '</button>' +
          '<button id="btn-av-pic-soft" class="perf-option-btn focusable" data-av-pic-preset="soft">' +
            '<span class="perf-opt-title">רך (Soft)</span>' +
            '<span class="perf-opt-sub">רגוע לעיניים</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">בהירות (Brightness):</p>' +
        '<div class="perf-options-grid ui-grid-5" id="av-brightness-options">' +
          '<button id="btn-av-bright-85" class="perf-option-btn focusable" data-av-pref="picBrightness" data-av-value="85">' +
            '<span class="perf-opt-title">85%</span>' +
            '<span class="perf-opt-sub">כהה</span>' +
          '</button>' +
          '<button id="btn-av-bright-92" class="perf-option-btn focusable" data-av-pref="picBrightness" data-av-value="92">' +
            '<span class="perf-opt-title">92%</span>' +
            '<span class="perf-opt-sub">רגוע</span>' +
          '</button>' +
          '<button id="btn-av-bright-100" class="perf-option-btn focusable" data-av-pref="picBrightness" data-av-value="100">' +
            '<span class="perf-opt-title">100%</span>' +
            '<span class="perf-opt-sub">טבעי</span>' +
          '</button>' +
          '<button id="btn-av-bright-108" class="perf-option-btn focusable" data-av-pref="picBrightness" data-av-value="108">' +
            '<span class="perf-opt-title">108%</span>' +
            '<span class="perf-opt-sub">מואר</span>' +
          '</button>' +
          '<button id="btn-av-bright-116" class="perf-option-btn focusable" data-av-pref="picBrightness" data-av-value="116">' +
            '<span class="perf-opt-title">116%</span>' +
            '<span class="perf-opt-sub">בהיר</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">ניגודיות (Contrast):</p>' +
        '<div class="perf-options-grid ui-grid-5" id="av-contrast-options">' +
          '<button id="btn-av-contrast-88" class="perf-option-btn focusable" data-av-pref="picContrast" data-av-value="88">' +
            '<span class="perf-opt-title">88%</span>' +
            '<span class="perf-opt-sub">עדין</span>' +
          '</button>' +
          '<button id="btn-av-contrast-94" class="perf-option-btn focusable" data-av-pref="picContrast" data-av-value="94">' +
            '<span class="perf-opt-title">94%</span>' +
            '<span class="perf-opt-sub">רך</span>' +
          '</button>' +
          '<button id="btn-av-contrast-100" class="perf-option-btn focusable" data-av-pref="picContrast" data-av-value="100">' +
            '<span class="perf-opt-title">100%</span>' +
            '<span class="perf-opt-sub">טבעי</span>' +
          '</button>' +
          '<button id="btn-av-contrast-108" class="perf-option-btn focusable" data-av-pref="picContrast" data-av-value="108">' +
            '<span class="perf-opt-title">108%</span>' +
            '<span class="perf-opt-sub">חד</span>' +
          '</button>' +
          '<button id="btn-av-contrast-116" class="perf-option-btn focusable" data-av-pref="picContrast" data-av-value="116">' +
            '<span class="perf-opt-title">116%</span>' +
            '<span class="perf-opt-sub">עמוק</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">רוויית צבע (Saturation):</p>' +
        '<div class="perf-options-grid ui-grid-5" id="av-saturation-options">' +
          '<button id="btn-av-sat-80" class="perf-option-btn focusable" data-av-pref="picSaturation" data-av-value="80">' +
            '<span class="perf-opt-title">80%</span>' +
            '<span class="perf-opt-sub">מאופק</span>' +
          '</button>' +
          '<button id="btn-av-sat-90" class="perf-option-btn focusable" data-av-pref="picSaturation" data-av-value="90">' +
            '<span class="perf-opt-title">90%</span>' +
            '<span class="perf-opt-sub">רך</span>' +
          '</button>' +
          '<button id="btn-av-sat-100" class="perf-option-btn focusable" data-av-pref="picSaturation" data-av-value="100">' +
            '<span class="perf-opt-title">100%</span>' +
            '<span class="perf-opt-sub">טבעי</span>' +
          '</button>' +
          '<button id="btn-av-sat-112" class="perf-option-btn focusable" data-av-pref="picSaturation" data-av-value="112">' +
            '<span class="perf-opt-title">112%</span>' +
            '<span class="perf-opt-sub">עשיר</span>' +
          '</button>' +
          '<button id="btn-av-sat-125" class="perf-option-btn focusable" data-av-pref="picSaturation" data-av-value="125">' +
            '<span class="perf-opt-title">125%</span>' +
            '<span class="perf-opt-sub">עוצמתי</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">יחס מסך ומתיחת וידאו (Aspect Ratio):</p>' +
        '<div class="perf-options-grid ui-grid-4" id="av-aspect-options">' +
          '<button id="btn-av-aspect-contain" class="perf-option-btn focusable" data-av-pref="videoAspectMode" data-av-value="contain">' +
            '<span class="perf-opt-title">מותאם (Contain)</span>' +
            '<span class="perf-opt-sub">ללא חיתוך</span>' +
          '</button>' +
          '<button id="btn-av-aspect-cover" class="perf-option-btn focusable" data-av-pref="videoAspectMode" data-av-value="cover">' +
            '<span class="perf-opt-title">מילוי (Cover)</span>' +
            '<span class="perf-opt-sub">ממלא מסך</span>' +
          '</button>' +
          '<button id="btn-av-aspect-fill" class="perf-option-btn focusable" data-av-pref="videoAspectMode" data-av-value="fill">' +
            '<span class="perf-opt-title">מתיחה (Fill)</span>' +
            '<span class="perf-opt-sub">100% רוחב וגובה</span>' +
          '</button>' +
          '<button id="btn-av-aspect-zoom" class="perf-option-btn focusable" data-av-pref="videoAspectMode" data-av-value="zoom">' +
            '<span class="perf-opt-title">זום 12%</span>' +
            '<span class="perf-opt-sub">חיתוך שוליים</span>' +
          '</button>' +
        '</div>' +
        '<p class="perf-desc">חידוד קצוות תמונה (Rendering):</p>' +
        '<div class="perf-options-grid" id="av-crisp-options">' +
          '<button id="btn-av-crisp-auto" class="perf-option-btn focusable" data-av-pref="picCrispRendering" data-av-value="auto">' +
            '<span class="perf-opt-title">החלקה רגילה (Auto)</span>' +
            '<span class="perf-opt-sub">ברירת מחדל של המערכת</span>' +
          '</button>' +
          '<button id="btn-av-crisp-crisp" class="perf-option-btn focusable" data-av-pref="picCrispRendering" data-av-value="crisp">' +
            '<span class="perf-opt-title">חידוד תמונה (Crisp)</span>' +
            '<span class="perf-opt-sub">חידוד מוגברת לשידורי HD/SD</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="perf-actions-bar">' +
        '<div id="av-prefs-status" class="perf-cache-status">נרמול: כבוי • איכות: חכם • תמונה: מקורי • יחס: מותאם</div>' +
        '<div class="perf-action-btns">' +
          '<button id="btn-reset-av-prefs" class="btn-tv-secondary focusable">איפוס תמונה וסאונד לברירת מחדל</button>' +
        '</div>' +
      '</div>'
    );
  }

  ensureUiCustomizationDOM() {
    if (typeof document === 'undefined') return;

    const videoSurface = document.getElementById('video-surface');
    if (videoSurface && !document.getElementById('preview-autoplay-off-badge')) {
      const badge = document.createElement('div');
      badge.id = 'preview-autoplay-off-badge';
      badge.className = 'preview-autoplay-off-badge hidden';
      badge.innerHTML = '<span>תצוגה מקדימה כבויה (מצב קל) — לחץ OK לצפייה במסך מלא</span>';
      videoSurface.appendChild(badge);
    }
    if (videoSurface && !document.getElementById('stream-stats-badge')) {
      const statsBadge = document.createElement('div');
      statsBadge.id = 'stream-stats-badge';
      statsBadge.className = 'stream-stats-badge hidden';
      statsBadge.setAttribute('dir', 'ltr');
      videoSurface.appendChild(statsBadge);
    }

    const tabsBar = document.querySelector('#settings-modal .settings-tabs-bar');
    const tabSources = document.getElementById('tab-btn-sources');
    const tabChannels = document.getElementById('tab-btn-channels');
    const tabPerf = document.getElementById('tab-btn-performance');
    const tabAbout = document.getElementById('tab-btn-about');
    if (tabSources) tabSources.textContent = 'מקורות';
    if (tabChannels) tabChannels.textContent = 'ערוצים';
    if (tabPerf) tabPerf.textContent = 'נושא ובאפר';
    if (tabAbout) tabAbout.textContent = 'אודות';

    let appTabBtn = document.getElementById('tab-btn-appearance');
    if (tabsBar && !appTabBtn) {
      appTabBtn = document.createElement('button');
      appTabBtn.id = 'tab-btn-appearance';
      appTabBtn.className = 'settings-tab-btn focusable';
      appTabBtn.setAttribute('data-settings-tab', 'appearance');
      appTabBtn.textContent = 'עיצוב וממשק';
      if (tabAbout && tabAbout.parentNode === tabsBar) {
        tabsBar.insertBefore(appTabBtn, tabAbout);
      } else if (tabPerf && tabPerf.parentNode === tabsBar) {
        tabsBar.insertBefore(appTabBtn, tabPerf.nextSibling);
      } else {
        tabsBar.appendChild(appTabBtn);
      }
    }
    if (appTabBtn) {
      appTabBtn.textContent = 'עיצוב וממשק';
      if (appTabBtn.dataset && appTabBtn.dataset.uiBound !== '1') {
        appTabBtn.dataset.uiBound = '1';
        appTabBtn.addEventListener('click', () => this.switchSettingsTab('appearance'));
      }
    }

    let avTabBtn = document.getElementById('tab-btn-av');
    if (tabsBar && !avTabBtn) {
      avTabBtn = document.createElement('button');
      avTabBtn.id = 'tab-btn-av';
      avTabBtn.className = 'settings-tab-btn focusable';
      avTabBtn.setAttribute('data-settings-tab', 'av');
      avTabBtn.textContent = 'תמונה וסאונד';
      if (tabAbout && tabAbout.parentNode === tabsBar) {
        tabsBar.insertBefore(avTabBtn, tabAbout);
      } else if (appTabBtn && appTabBtn.parentNode === tabsBar) {
        tabsBar.insertBefore(avTabBtn, appTabBtn.nextSibling);
      } else {
        tabsBar.appendChild(avTabBtn);
      }
    }
    if (avTabBtn) {
      avTabBtn.textContent = 'תמונה וסאונד';
      if (avTabBtn.dataset && avTabBtn.dataset.avBound !== '1') {
        avTabBtn.dataset.avBound = '1';
        avTabBtn.addEventListener('click', () => this.switchSettingsTab('av'));
      }
    }

    const settingsCard =
      document.querySelector('#settings-modal .modal-settings-card') ||
      document.querySelector('#settings-modal .modal-card');
    const perfPanel = document.getElementById('settings-tab-performance');
    const aboutPanel = document.getElementById('settings-tab-about');
    let appPanel = document.getElementById('settings-tab-appearance');
    if (settingsCard && !appPanel) {
      appPanel = document.createElement('div');
      appPanel.id = 'settings-tab-appearance';
      appPanel.className = 'modal-body settings-tab-content hidden';
      appPanel.innerHTML = this._getAppearanceTabHTML();
      if (aboutPanel && aboutPanel.parentNode === settingsCard) {
        settingsCard.insertBefore(appPanel, aboutPanel);
      } else if (perfPanel && perfPanel.parentNode === settingsCard) {
        settingsCard.insertBefore(appPanel, perfPanel.nextSibling);
      } else {
        settingsCard.appendChild(appPanel);
      }
    } else if (
      appPanel &&
      (
        !document.getElementById('ui-layout-options') ||
        !document.getElementById('btn-pref-showClock') ||
        !document.getElementById('btn-pref-backHidesOsdFirst') ||
        !document.getElementById('ui-autofullscreen-options') ||
        !document.getElementById('ui-sleep-options') ||
        !document.getElementById('ui-voice-lang-options')
      )
    ) {
      appPanel.innerHTML = this._getAppearanceTabHTML();
    }

    if (appPanel) {
      const presetBtns = appPanel.querySelectorAll('[data-ui-preset]');
      for (let i = 0; i < presetBtns.length; i++) {
        const btn = presetBtns[i];
        if (btn && btn.dataset && btn.dataset.uiBound !== '1') {
          btn.dataset.uiBound = '1';
          btn.addEventListener('click', () => {
            const presetName = btn.dataset.uiPreset;
            if (presetName) this.applyUiPreset(presetName, false);
          });
        }
      }

      const toggleBtns = appPanel.querySelectorAll('[data-ui-toggle]');
      for (let i = 0; i < toggleBtns.length; i++) {
        const btn = toggleBtns[i];
        if (btn && btn.dataset && btn.dataset.uiBound !== '1') {
          btn.dataset.uiBound = '1';
          btn.addEventListener('click', () => {
            const key = btn.dataset.uiToggle;
            if (key) this.toggleUiPref(key, false);
          });
        }
      }

      const prefBtns = appPanel.querySelectorAll('[data-ui-pref]');
      for (let i = 0; i < prefBtns.length; i++) {
        const btn = prefBtns[i];
        if (btn && btn.dataset && btn.dataset.uiBound !== '1') {
          btn.dataset.uiBound = '1';
          btn.addEventListener('click', () => {
            const key = btn.dataset.uiPref;
            const val = btn.dataset.uiValue;
            if (key && typeof val !== 'undefined') {
              const isInt =
                key === 'osdTimeoutSec' ||
                key === 'seekStepSec' ||
                key === 'numericJumpMs' ||
                key === 'zapDebounceMs' ||
                key === 'autoFullscreenSec' ||
                key === 'sleepTimeoutHours';
              this.setUiPref(key, isInt ? parseInt(val, 10) : val, false);
            }
          });
        }
      }

      const sleepBtns = appPanel.querySelectorAll('[data-sleep-hours]');
      for (let i = 0; i < sleepBtns.length; i++) {
        const btn = sleepBtns[i];
        if (btn && btn.dataset && btn.dataset.sleepBound !== '1') {
          btn.dataset.sleepBound = '1';
          btn.addEventListener('click', () => {
            const hrs = parseInt(btn.dataset.sleepHours, 10);
            if (!isNaN(hrs)) {
              this.setUiPref('sleepTimeoutHours', hrs, false);
            }
          });
        }
      }

      const voiceLangBtns = appPanel.querySelectorAll('[data-voice-lang]');
      for (let i = 0; i < voiceLangBtns.length; i++) {
        const btn = voiceLangBtns[i];
        if (btn && btn.dataset && btn.dataset.voiceLangBound !== '1') {
          btn.dataset.voiceLangBound = '1';
          btn.addEventListener('click', () => {
            const lang = btn.dataset.voiceLang;
            if (lang) {
              this.setUiPref('voiceLang', lang, false);
            }
          });
        }
      }

      const resetBtn = document.getElementById('btn-reset-ui-prefs');
      if (resetBtn && resetBtn.dataset && resetBtn.dataset.uiBound !== '1') {
        resetBtn.dataset.uiBound = '1';
        resetBtn.addEventListener('click', () => {
          this.resetUiPrefs(false);
        });
      }
    }

    let avPanel = document.getElementById('settings-tab-av');
    if (settingsCard && !avPanel) {
      avPanel = document.createElement('div');
      avPanel.id = 'settings-tab-av';
      avPanel.className = 'modal-body settings-tab-content hidden';
      avPanel.innerHTML = this._getAvTabHTML();
      if (aboutPanel && aboutPanel.parentNode === settingsCard) {
        settingsCard.insertBefore(avPanel, aboutPanel);
      } else if (appPanel && appPanel.parentNode === settingsCard) {
        settingsCard.insertBefore(avPanel, appPanel.nextSibling);
      } else {
        settingsCard.appendChild(avPanel);
      }
    } else if (avPanel && !document.getElementById('av-audio-norm-options')) {
      avPanel.innerHTML = this._getAvTabHTML();
    }

    if (avPanel) {
      const avPrefBtns = avPanel.querySelectorAll('[data-av-pref]');
      for (let i = 0; i < avPrefBtns.length; i++) {
        const btn = avPrefBtns[i];
        if (btn && btn.dataset && btn.dataset.avBound !== '1') {
          btn.dataset.avBound = '1';
          btn.addEventListener('click', () => {
            const key = btn.dataset.avPref;
            const val = btn.dataset.avValue;
            if (key && typeof val !== 'undefined') {
              const isInt = key === 'picBrightness' || key === 'picContrast' || key === 'picSaturation';
              this.setAvPref(key, isInt ? parseInt(val, 10) : val, false);
            }
          });
        }
      }

      const avToggleBtns = avPanel.querySelectorAll('[data-av-toggle]');
      for (let i = 0; i < avToggleBtns.length; i++) {
        const btn = avToggleBtns[i];
        if (btn && btn.dataset && btn.dataset.avBound !== '1') {
          btn.dataset.avBound = '1';
          btn.addEventListener('click', () => {
            const key = btn.dataset.avToggle;
            if (key) this.toggleAvPref(key, false);
          });
        }
      }

      const avPicBtns = avPanel.querySelectorAll('[data-av-pic-preset]');
      for (let i = 0; i < avPicBtns.length; i++) {
        const btn = avPicBtns[i];
        if (btn && btn.dataset && btn.dataset.avBound !== '1') {
          btn.dataset.avBound = '1';
          btn.addEventListener('click', () => {
            const presetName = btn.dataset.avPicPreset;
            if (presetName) this.applyPicturePreset(presetName, false);
          });
        }
      }

      const avTrimBtns = avPanel.querySelectorAll('[data-av-trim]');
      for (let i = 0; i < avTrimBtns.length; i++) {
        const btn = avTrimBtns[i];
        if (btn && btn.dataset && btn.dataset.avBound !== '1') {
          btn.dataset.avBound = '1';
          btn.addEventListener('click', () => {
            const trimDb = parseInt(btn.dataset.avTrim, 10);
            if (!isNaN(trimDb)) this.setChannelTrimPref(trimDb, false);
          });
        }
      }

      const resetLoudnessBtn = document.getElementById('btn-reset-loudness-memory');
      if (resetLoudnessBtn && resetLoudnessBtn.dataset && resetLoudnessBtn.dataset.avBound !== '1') {
        resetLoudnessBtn.dataset.avBound = '1';
        resetLoudnessBtn.addEventListener('click', () => {
          this.resetChannelLoudnessMemory(false);
        });
      }

      const resetAvBtn = document.getElementById('btn-reset-av-prefs');
      if (resetAvBtn && resetAvBtn.dataset && resetAvBtn.dataset.avBound !== '1') {
        resetAvBtn.dataset.avBound = '1';
        resetAvBtn.addEventListener('click', () => {
          this.resetAvPrefs(false);
        });
      }
    }

    this.ensureIssueReporterDOM();
    this.ensureDisclaimerDOM();
    this.ensureVodHeaderBtnDOM();
    this.ensurePowerSaveDOM();
    this.ensureVoiceDOM();
    this.ensureAppendDefaultBtnDOM();
  }

  ensureIssueReporterDOM() {
    if (typeof document === 'undefined') return;

    const aboutHeader = document.querySelector('#settings-tab-about .about-header-row');
    const btnCheckOta = document.getElementById('btn-check-ota-now');
    if (aboutHeader && !document.getElementById('btn-open-issue-report')) {
      const btnIssue = document.createElement('button');
      btnIssue.id = 'btn-open-issue-report';
      btnIssue.className = 'btn-tv-secondary focusable';
      btnIssue.style.marginLeft = '10px';
      btnIssue.textContent = 'דווח על תקלה (שלח לוג)';
      if (btnCheckOta && btnCheckOta.parentNode) {
        btnCheckOta.parentNode.insertBefore(btnIssue, btnCheckOta);
      } else {
        aboutHeader.appendChild(btnIssue);
      }
    }

    if (!document.getElementById('issue-modal') && document.body) {
      const modal = document.createElement('div');
      modal.id = 'issue-modal';
      modal.className = 'modal-backdrop hidden';
      modal.innerHTML =
        '<div class="modal-card modal-issue-card">' +
          '<div class="modal-header">' +
            '<h2>דיווח על תקלה וצירוף לוג אוטומטי</h2>' +
            '<button class="modal-close-btn focusable" data-action="close-modal">✕ סגור</button>' +
          '</div>' +
          '<div class="modal-body issue-modal-body">' +
            '<div class="issue-presets-row" id="issue-presets-row">' +
              '<button class="btn-tv-secondary issue-preset-btn focusable" data-issue-preset="ערוץ לא נטען או נתקע">ערוץ נתקע / לא נטען</button>' +
              '<button class="btn-tv-secondary issue-preset-btn focusable" data-issue-preset="בעיית סאונד או עוצמה">בעיית סאונד / עוצמה</button>' +
              '<button class="btn-tv-secondary issue-preset-btn focusable" data-issue-preset="לוח שידורים (EPG) חסר">בעיה בלוח שידורים</button>' +
              '<button class="btn-tv-secondary issue-preset-btn focusable" data-issue-preset="באג בממשק או בשלט">באג בממשק / בשלט</button>' +
            '</div>' +
            '<div class="issue-layout">' +
              '<div class="issue-form-col">' +
                '<label for="issue-title-input" class="input-label">כותרת קצרה לתקלה:</label>' +
                '<input type="text" id="issue-title-input" class="tv-input focusable" placeholder="לדוגמה: ערוץ נתקע בזפזופ מהיר" dir="rtl">' +
                '<label for="issue-desc-input" class="input-label" style="margin-top:10px;display:block;">תיאור נוסף (אופציונלי):</label>' +
                '<textarea id="issue-desc-input" class="tv-input issue-textarea focusable" rows="3" placeholder="מה קרה לפני התקלה? (פרטי המערכת והלוגים מצורפים אוטומטית)" dir="rtl"></textarea>' +
                '<div id="issue-logs-summary" class="issue-logs-summary">מצורפים אוטומטית לוגים מסוננים (ללא קישורי M3U פרטיים)</div>' +
                '<pre id="issue-logs-preview" class="issue-logs-preview" dir="ltr"></pre>' +
              '</div>' +
              '<div class="issue-qr-col">' +
                '<div id="issue-qr-box" class="issue-qr-box"></div>' +
                '<div class="issue-qr-caption">סרוק בטלפון לפתיחת Issue מוכן ב-GitHub עם הלוגים</div>' +
              '</div>' +
            '</div>' +
            '<div class="issue-actions-row">' +
              '<button id="btn-submit-issue" class="btn-tv-primary focusable">שלח דיווח + לוג אוטומטי</button>' +
              '<button id="btn-open-issue-github" class="btn-tv-secondary focusable">פתח ב-GitHub (בדפדפן)</button>' +
              '<button id="btn-copy-issue-report" class="btn-tv-secondary focusable">העתק דוח + לוגים</button>' +
            '</div>' +
            '<div id="issue-submit-status" class="settings-status-box issue-status-box">' +
              '<span id="issue-submit-status-text">מוכן לשליחה — קישורי M3U וטוקנים פרטיים מסוננים אוטומטית לפני השליחה.</span>' +
            '</div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(modal);
    }

    const openBtn = document.getElementById('btn-open-issue-report');
    if (openBtn && openBtn.dataset && openBtn.dataset.issueBound !== '1') {
      openBtn.dataset.issueBound = '1';
      openBtn.addEventListener('click', () => this.openIssueModal());
    }

    const issueModal = document.getElementById('issue-modal');
    if (issueModal) {
      const closeBtn = issueModal.querySelector('[data-action="close-modal"]');
      if (closeBtn && closeBtn.dataset && closeBtn.dataset.issueBound !== '1') {
        closeBtn.dataset.issueBound = '1';
        closeBtn.addEventListener('click', () => this.closeModals());
      }

      const presetBtns = issueModal.querySelectorAll('[data-issue-preset]');
      for (let i = 0; i < presetBtns.length; i++) {
        const pBtn = presetBtns[i];
        if (pBtn && pBtn.dataset && pBtn.dataset.issueBound !== '1') {
          pBtn.dataset.issueBound = '1';
          pBtn.addEventListener('click', () => {
            const titleIn = document.getElementById('issue-title-input');
            if (titleIn) titleIn.value = pBtn.dataset.issuePreset || '';
            this.refreshIssueModalPreview();
          });
        }
      }

      const titleIn = document.getElementById('issue-title-input');
      if (titleIn && titleIn.dataset && titleIn.dataset.issueBound !== '1') {
        titleIn.dataset.issueBound = '1';
        titleIn.addEventListener('input', () => this.refreshIssueModalPreview());
      }

      const descIn = document.getElementById('issue-desc-input');
      if (descIn && descIn.dataset && descIn.dataset.issueBound !== '1') {
        descIn.dataset.issueBound = '1';
        descIn.addEventListener('input', () => this.refreshIssueModalPreview());
      }

      const submitBtn = document.getElementById('btn-submit-issue');
      if (submitBtn && submitBtn.dataset && submitBtn.dataset.issueBound !== '1') {
        submitBtn.dataset.issueBound = '1';
        submitBtn.addEventListener('click', () => this.submitIssueReport());
      }

      const openGhBtn = document.getElementById('btn-open-issue-github');
      if (openGhBtn && openGhBtn.dataset && openGhBtn.dataset.issueBound !== '1') {
        openGhBtn.dataset.issueBound = '1';
        openGhBtn.addEventListener('click', () => {
          const titleVal = (document.getElementById('issue-title-input') || {}).value || '';
          const descVal = (document.getElementById('issue-desc-input') || {}).value || '';
          if (typeof DiagnosticLogger !== 'undefined') {
            const rep = DiagnosticLogger.buildReport(titleVal, descVal, this);
            const ghUrl = DiagnosticLogger.buildGitHubNewIssueUrl(rep, 1800);
            try {
              window.open(ghUrl, '_blank', 'noopener');
            } catch (e) {}
            const statusText = document.getElementById('issue-submit-status-text');
            if (statusText) statusText.textContent = 'נפתח דף יצירת Issue ב-GitHub עם הלוגים המסוננים.';
          }
        });
      }

      const copyBtn = document.getElementById('btn-copy-issue-report');
      if (copyBtn && copyBtn.dataset && copyBtn.dataset.issueBound !== '1') {
        copyBtn.dataset.issueBound = '1';
        copyBtn.addEventListener('click', () => this.copyIssueReport());
      }
    }
  }

  _getDisclaimerModalHTML() {
    return (
      '<div class="modal-card modal-disclaimer-card">' +
        '<div class="disclaimer-header">' +
          '<span class="disclaimer-badge">הצהרה משפטית ותנאי שימוש</span>' +
          '<h2 class="disclaimer-title">תנאי שימוש והסרת אחריות — IPTV Live TV</h2>' +
        '</div>' +
        '<div class="disclaimer-body">' +
          '<ul class="disclaimer-points">' +
            '<li>האפליקציה הינה נגן מדיה טכנולוגי בלבד לקבצי M3U / XMLTV שמזין המשתמש.</li>' +
            '<li>המפתח והפרויקט אינם מארחים, משדרים, מוכרים, מפיצים או מקדמים שידורי טלוויזיה, תכנים מוגנים בזכויות יוצרים או רשימות פרטיות כלשהן.</li>' +
            '<li>המשתמש בלבד אחראי באופן בלעדי על חוקיות המקורות והקישורים שהוא טוען ועל עמידה בדיני זכויות היוצרים במדינתו.</li>' +
            '<li>רשימת ההדגמה הראשונית מבוססת על מאגר פתוח וציבורי (<code>iptv-org</code>) וניתנת להחלפה או הסרה בכל עת בהגדרות.</li>' +
            '<li>השירות והתוכנה מסופקים "כמות שהם" (AS-IS) ללא אחריות מכל סוג; המפתח אינו נושא באחריות לנזק ישיר או עקיף או לזמינות זרמים חיצוניים.</li>' +
          '</ul>' +
          '<div class="disclaimer-sub-en" dir="ltr">Media player software only — provides no media content or streams. Users are solely responsible for their own playlists and local copyright compliance. Provided AS-IS.</div>' +
        '</div>' +
        '<div class="disclaimer-actions">' +
          '<button id="btn-disclaimer-accept" class="btn-tv-primary ota-btn-main focusable">אני מאשר/ת את התנאים וממשיך/ה (OK)</button>' +
        '</div>' +
      '</div>'
    );
  }

  ensureDisclaimerDOM() {
    if (typeof document === 'undefined') return;

    if (!document.getElementById('disclaimer-modal') && document.body) {
      const modal = document.createElement('div');
      modal.id = 'disclaimer-modal';
      modal.className = 'modal-backdrop hidden';
      modal.innerHTML = this._getDisclaimerModalHTML();
      document.body.appendChild(modal);
    }

    const aboutCard = document.querySelector('#settings-tab-about .about-card');
    if (aboutCard) {
      if (!document.getElementById('btn-toggle-auto-ota')) {
        const otaRow = document.createElement('div');
        otaRow.className = 'about-ota-row';
        otaRow.innerHTML =
          '<button id="btn-toggle-auto-ota" class="perf-option-btn ui-toggle-btn focusable">' +
            '<span class="ui-toggle-text" style="display:flex;flex-direction:column;min-width:0;margin-left:12px;">' +
              '<span class="perf-opt-title">עדכון אוטומטי שקט (ללא לחיצות)</span>' +
              '<span class="perf-opt-sub">מתקין עדכוני מערכת ברקע אוטומטית ומציג רק את פירוט החידושים</span>' +
            '</span>' +
            '<span class="ui-toggle-pill">מופעל ✓</span>' +
          '</button>';
        const headerRow = aboutCard.querySelector('.about-header-row');
        if (headerRow && headerRow.parentNode === aboutCard) {
          aboutCard.insertBefore(otaRow, headerRow.nextSibling);
        } else {
          aboutCard.insertBefore(otaRow, aboutCard.firstChild);
        }
      }

      if (!document.getElementById('btn-open-disclaimer')) {
        const legalBox = document.createElement('div');
        legalBox.className = 'about-legal-box';
        legalBox.innerHTML =
          '<h3>הצהרה משפטית ותנאי שימוש</h3>' +
          '<p class="about-legal-summary">האפליקציה הינה נגן מדיה טכנולוגי בלבד לקבצי M3U / XMLTV שמזין המשתמש, ואינה מארחת, משדרת או מפיצה תכנים מוגנים. התוכנה מסופקת "כמות שהיא" (AS-IS) והאחריות הבלעדית על חוקיות המקורות חלה על המשתמש בלבד.</p>' +
          '<div class="about-legal-actions">' +
            '<button id="btn-open-disclaimer" class="btn-tv-secondary focusable">הצג הצהרה משפטית מלאה</button>' +
          '</div>';
        const featBox = aboutCard.querySelector('.about-features-box');
        if (featBox && featBox.parentNode === aboutCard) {
          aboutCard.insertBefore(legalBox, featBox.nextSibling);
        } else {
          aboutCard.appendChild(legalBox);
        }
      }
    }

    const acceptBtn = document.getElementById('btn-disclaimer-accept');
    if (acceptBtn && acceptBtn.dataset && acceptBtn.dataset.disclaimerBound !== '1') {
      acceptBtn.dataset.disclaimerBound = '1';
      acceptBtn.addEventListener('click', () => this.acceptDisclaimer());
    }

    const openLegalBtn = document.getElementById('btn-open-disclaimer');
    if (openLegalBtn && openLegalBtn.dataset && openLegalBtn.dataset.disclaimerBound !== '1') {
      openLegalBtn.dataset.disclaimerBound = '1';
      openLegalBtn.addEventListener('click', () => this.openDisclaimerModal(true));
    }

    const autoOtaBtn = document.getElementById('btn-toggle-auto-ota');
    if (autoOtaBtn && autoOtaBtn.dataset && autoOtaBtn.dataset.disclaimerBound !== '1') {
      autoOtaBtn.dataset.disclaimerBound = '1';
      autoOtaBtn.addEventListener('click', () => {
        let nextEnabled = false;
        if (
          this.otaManager &&
          typeof this.otaManager.isAutoOtaEnabled === 'function' &&
          typeof this.otaManager.setAutoOtaEnabled === 'function'
        ) {
          nextEnabled = !this.otaManager.isAutoOtaEnabled();
          this.otaManager.setAutoOtaEnabled(nextEnabled);
        } else {
          try {
            const cur = localStorage.getItem('zenplay_ota_auto_update_v1') !== '0';
            nextEnabled = !cur;
            localStorage.setItem('zenplay_ota_auto_update_v1', nextEnabled ? '1' : '0');
          } catch (e) {}
        }
        this.updateAutoOtaButtonUI();
        this.showToast(nextEnabled ? 'עדכון אוטומטי שקט הופעל ✓' : 'עדכון אוטומטי שקט כובה');
      });
    }

    const previewEpgTitle = document.getElementById('preview-epg-title');
    if (previewEpgTitle && previewEpgTitle.dataset && previewEpgTitle.dataset.guideBound !== '1') {
      previewEpgTitle.dataset.guideBound = '1';
      previewEpgTitle.title = 'לחץ לפתיחת מדריך תוכניות 7 ימים';
      previewEpgTitle.addEventListener('click', (e) => {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        this.openGuideModal(this.previewedChannel || this.selectedChannel);
      });
    }

    this.updateAutoOtaButtonUI();
  }

  ensureVodHeaderBtnDOM() {
    if (typeof document === 'undefined') return;
    const headerLeft = document.querySelector('#top-header .header-left');
    if (headerLeft && !document.getElementById('btn-open-vod')) {
      const btn = document.createElement('button');
      btn.id = 'btn-open-vod';
      btn.className = 'top-nav-btn top-nav-btn-vod focusable';
      btn.setAttribute('data-action', 'open-vod');
      btn.innerHTML = '<span>🎬 VOD 7 ימים</span>';
      const guideBtn = document.getElementById('btn-open-guide');
      if (guideBtn && guideBtn.parentNode === headerLeft) {
        headerLeft.insertBefore(btn, guideBtn.nextSibling);
      } else {
        headerLeft.appendChild(btn);
      }
    }
    const vodBtn = document.getElementById('btn-open-vod');
    if (vodBtn && vodBtn.dataset && vodBtn.dataset.vodBound !== '1') {
      vodBtn.dataset.vodBound = '1';
      vodBtn.addEventListener('click', () => this.openGuideModal('vod'));
    }

    const guideCard = document.querySelector('#guide-modal .modal-guide-card') || document.querySelector('#guide-modal .modal-card');
    if (guideCard && !document.getElementById('guide-scope-bar')) {
      const daysBar = document.getElementById('guide-days-bar');
      const scopeBar = document.createElement('div');
      scopeBar.id = 'guide-scope-bar';
      scopeBar.className = 'guide-scope-bar';
      scopeBar.innerHTML =
        '<button id="btn-guide-scope-channel" class="guide-scope-btn active focusable" type="button" data-guide-scope="channel">הערוץ הנוכחי</button>' +
        '<button id="btn-guide-scope-vod" class="guide-scope-btn focusable" type="button" data-guide-scope="vod">VOD כל הערוצים — 7 ימים</button>';

      const searchBar = document.createElement('div');
      searchBar.id = 'vod-search-bar';
      searchBar.className = 'vod-search-bar hidden';
      searchBar.innerHTML =
        '<input type="text" id="vod-search-input" class="tv-input vod-search-input focusable" placeholder="חפש תוכנית מ-7 הימים האחרונים..." dir="rtl">' +
        '<button id="btn-vod-only-past" class="vod-filter-btn focusable" type="button">רק שידורים מוקלטים</button>';

      if (daysBar && daysBar.parentNode === guideCard) {
        guideCard.insertBefore(scopeBar, daysBar);
        guideCard.insertBefore(searchBar, daysBar);
      } else {
        guideCard.appendChild(scopeBar);
        guideCard.appendChild(searchBar);
      }
    }

    const scopeChannelBtn = document.getElementById('btn-guide-scope-channel');
    if (scopeChannelBtn && scopeChannelBtn.dataset && scopeChannelBtn.dataset.vodBound !== '1') {
      scopeChannelBtn.dataset.vodBound = '1';
      scopeChannelBtn.addEventListener('click', () => this.setGuideScope('channel'));
    }
    const scopeVodBtn = document.getElementById('btn-guide-scope-vod');
    if (scopeVodBtn && scopeVodBtn.dataset && scopeVodBtn.dataset.vodBound !== '1') {
      scopeVodBtn.dataset.vodBound = '1';
      scopeVodBtn.addEventListener('click', () => this.setGuideScope('vod'));
    }
    const onlyPastBtn = document.getElementById('btn-vod-only-past');
    if (onlyPastBtn && onlyPastBtn.dataset && onlyPastBtn.dataset.vodBound !== '1') {
      onlyPastBtn.dataset.vodBound = '1';
      onlyPastBtn.addEventListener('click', () => this.toggleVodOnlyPast());
    }
    const vodInput = document.getElementById('vod-search-input');
    if (vodInput && vodInput.dataset && vodInput.dataset.vodBound !== '1') {
      vodInput.dataset.vodBound = '1';
      vodInput.addEventListener('input', (e) => {
        this.vodSearchQuery = e && e.target ? e.target.value : '';
        clearTimeout(this._vodSearchDebounceTimer);
        this._vodSearchDebounceTimer = setTimeout(() => {
          this._vodSearchDebounceTimer = null;
          if (this.mode === 'GUIDE' && this.guideScope === 'vod') {
            this.renderVodProgrammes();
          }
        }, 120);
      });
    }

    const osdHeaderLine = document.querySelector('#fullscreen-osd .osd-header-line');
    if (osdHeaderLine && !document.getElementById('osd-vod-badge')) {
      const osdVod = document.createElement('span');
      osdVod.id = 'osd-vod-badge';
      osdVod.className = 'channel-vod-badge hidden';
      osdVod.textContent = 'VOD 7d';
      const osdVer = document.getElementById('osd-version-badge');
      if (osdVer && osdVer.parentNode === osdHeaderLine) {
        osdHeaderLine.insertBefore(osdVod, osdVer);
      } else {
        osdHeaderLine.appendChild(osdVod);
      }
    }
  }

  ensurePowerSaveDOM() {
    if (typeof document === 'undefined' || !document.body) return;

    if (!document.getElementById('sleep-warning-modal')) {
      const modal = document.createElement('div');
      modal.id = 'sleep-warning-modal';
      modal.className = 'modal-backdrop hidden';
      modal.setAttribute('aria-hidden', 'true');
      modal.innerHTML =
        '<div id="sleep-warning-card" class="modal-card sleep-warning-card">' +
          '<div class="sleep-warning-badge">מצב חיסכון בחשמל</div>' +
          '<h2 class="sleep-warning-title">המסך ייכבה בקרוב עקב חוסר פעילות</h2>' +
          '<p class="sleep-warning-desc">המערכת עומדת לעבור למצב חיסכון בחשמל ולהפסיק את השידור כדי לחסוך באנרגיה ולמנוע צריבת מסך.</p>' +
          '<div class="sleep-countdown-row">' +
            '<span id="sleep-countdown-sec" class="sleep-countdown-sec">60</span>' +
            '<span class="sleep-countdown-unit">שניות לכיבוי</span>' +
          '</div>' +
          '<div id="sleep-countdown-bar-track" class="sleep-countdown-bar-track" dir="ltr">' +
            '<div id="sleep-countdown-bar" class="sleep-countdown-bar" style="width:100%;"></div>' +
          '</div>' +
          '<div class="sleep-warning-actions">' +
            '<button id="btn-sleep-stay-awake" class="btn-tv-primary focusable" type="button">אני עדיין צופה — בטל כיבוי (OK)</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(modal);
    }

    if (!document.getElementById('power-save-screen')) {
      const blk = document.createElement('div');
      blk.id = 'power-save-screen';
      blk.className = 'power-save-screen hidden';
      blk.setAttribute('aria-hidden', 'true');
      blk.innerHTML = '<div class="power-save-hint">מצב חיסכון בחשמל פעיל — לחץ על כל מקש לחזרה לצפייה</div>';
      document.body.appendChild(blk);
    }

    const stayBtn = document.getElementById('btn-sleep-stay-awake');
    if (stayBtn && stayBtn.dataset && stayBtn.dataset.sleepBound !== '1') {
      stayBtn.dataset.sleepBound = '1';
      stayBtn.addEventListener('click', (e) => {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        this.cancelSleepWarning();
      });
    }

    const warnModal = document.getElementById('sleep-warning-modal');
    if (warnModal && warnModal.dataset && warnModal.dataset.sleepBound !== '1') {
      warnModal.dataset.sleepBound = '1';
      warnModal.addEventListener('click', (e) => {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        this.cancelSleepWarning();
      });
    }

    const blkScreen = document.getElementById('power-save-screen');
    if (blkScreen && blkScreen.dataset && blkScreen.dataset.sleepBound !== '1') {
      blkScreen.dataset.sleepBound = '1';
      blkScreen.addEventListener('click', (e) => {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        this.exitPowerSaveMode();
      });
    }
  }

  ensureVoiceDOM() {
    if (typeof document === 'undefined') return;
    const headerLeft = document.querySelector('#top-header .header-left');
    if (headerLeft && !document.getElementById('btn-voice-command')) {
      const btn = document.createElement('button');
      btn.id = 'btn-voice-command';
      btn.className = 'top-nav-btn top-nav-btn-voice focusable';
      btn.setAttribute('data-action', 'voice-command');
      btn.title = 'פקודה קולית (V)';
      btn.innerHTML = '<span>🎤 פקודה קולית</span>';
      const settingsBtn = document.getElementById('btn-open-settings');
      if (settingsBtn && settingsBtn.parentNode === headerLeft) {
        headerLeft.insertBefore(btn, settingsBtn);
      } else {
        headerLeft.appendChild(btn);
      }
    }
    const voiceBtn = document.getElementById('btn-voice-command');
    if (voiceBtn && voiceBtn.dataset && voiceBtn.dataset.voiceBound !== '1') {
      voiceBtn.dataset.voiceBound = '1';
      voiceBtn.addEventListener('click', () => this.startVoiceCommand());
    }

    if (document.body && !document.getElementById('voice-overlay')) {
      const overlay = document.createElement('div');
      overlay.id = 'voice-overlay';
      overlay.className = 'modal-backdrop hidden';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.innerHTML =
        '<div class="modal-card voice-card">' +
          '<div class="voice-header">' +
            '<div id="voice-mic-ring" class="voice-mic-ring">🎤</div>' +
            '<div class="voice-title-col">' +
              '<h2 id="voice-status-text">מקשיב... אמור שם ערוץ, מספר או תוכנית</h2>' +
              '<div id="voice-transcript-text" class="voice-transcript-text">דוגמה: "קשת 12", "ערוץ 11", "מסך מלא", "חדשות"</div>' +
            '</div>' +
          '</div>' +
          '<div class="voice-actions">' +
            '<button id="btn-voice-fallback-search" class="btn-tv-primary focusable hidden" type="button">פתח חיפוש מהיר (ערוצים / VOD)</button>' +
            '<button id="btn-voice-cancel" class="btn-tv-secondary focusable" type="button">✕ ביטול (BACK)</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
    }

    const cancelBtn = document.getElementById('btn-voice-cancel');
    if (cancelBtn && cancelBtn.dataset && cancelBtn.dataset.voiceBound !== '1') {
      cancelBtn.dataset.voiceBound = '1';
      cancelBtn.addEventListener('click', () => this.closeVoiceOverlay());
    }

    const fallbackBtn = document.getElementById('btn-voice-fallback-search');
    if (fallbackBtn && fallbackBtn.dataset && fallbackBtn.dataset.voiceBound !== '1') {
      fallbackBtn.dataset.voiceBound = '1';
      fallbackBtn.addEventListener('click', () => {
        this.closeVoiceOverlay(true);
        this.openGuideModal('vod');
      });
    }
  }

  ensureAppendDefaultBtnDOM() {
    if (typeof document === 'undefined') return;
    const actionsCol = document.querySelector('#settings-tab-sources .epg-actions-col');
    if (actionsCol && !document.getElementById('btn-append-default-source')) {
      const btn = document.createElement('button');
      btn.id = 'btn-append-default-source';
      btn.className = 'btn-tv-secondary focusable';
      btn.type = 'button';
      btn.setAttribute('data-action', 'append-default-source');
      btn.textContent = '+ הוסף מקור ברירת מחדל (ללא מחיקה)';
      const loadSampleBtn = document.getElementById('btn-load-sample');
      if (loadSampleBtn && loadSampleBtn.parentNode === actionsCol) {
        actionsCol.insertBefore(btn, loadSampleBtn.nextSibling);
      } else {
        actionsCol.appendChild(btn);
      }
    }
    const appendBtn = document.getElementById('btn-append-default-source');
    if (appendBtn && appendBtn.dataset && appendBtn.dataset.appendDefaultBound !== '1') {
      appendBtn.dataset.appendDefaultBound = '1';
      appendBtn.addEventListener('click', () => this.appendDefaultSource());
    }
  }

  /* --------------------------------------------------------------------------
     Smart Modal Focus Restoration (Iteration 7)
     -------------------------------------------------------------------------- */

  _saveFocusBeforeModal() {
    if (this._savedFocusContext) return;
    this._savedFocusContext = {
      focusArea: this.focusArea || 'channels',
      focusedEl: this.currentFocusedEl || null,
      focusedHeaderIndex: typeof this.focusedHeaderIndex === 'number' ? this.focusedHeaderIndex : 0,
      focusedTimelineIndex: typeof this.focusedTimelineIndex === 'number' ? this.focusedTimelineIndex : 0,
      focusedChannelIndex: typeof this.focusedChannelIndex === 'number' ? this.focusedChannelIndex : 0
    };
  }

  _restoreFocusAfterModal() {
    const saved = this._savedFocusContext;
    this._savedFocusContext = null;
    if (!saved) {
      this.focusArea = 'channels';
      this.updateChannelFocusFast();
      return;
    }

    if (saved.focusArea === 'header') {
      const buttons = this.getHeaderButtons();
      this.focusArea = 'header';
      this.focusedHeaderIndex = Math.min(saved.focusedHeaderIndex || 0, Math.max(0, buttons.length - 1));
      const target =
        saved.focusedEl && typeof document !== 'undefined' && document.body && document.body.contains(saved.focusedEl)
          ? saved.focusedEl
          : buttons[this.focusedHeaderIndex];
      if (target) {
        const idx = buttons.indexOf(target);
        if (idx !== -1) this.focusedHeaderIndex = idx;
        this._focusedChannelEl = null;
        this.setFocusedElementFast(target);
        return;
      }
    } else if (saved.focusArea === 'timeline' && Array.isArray(this.timelineItemNodes) && this.timelineItemNodes.length > 0) {
      this.focusArea = 'timeline';
      this.focusedTimelineIndex = Math.min(saved.focusedTimelineIndex || 0, this.timelineItemNodes.length - 1);
      this.updateTimelineFocusFast();
      return;
    }

    this.focusArea = 'channels';
    if (typeof saved.focusedChannelIndex === 'number' && saved.focusedChannelIndex >= 0 && saved.focusedChannelIndex < this.visibleChannels.length) {
      this.focusedChannelIndex = saved.focusedChannelIndex;
    }
    this.updateChannelFocusFast();
  }

  /* --------------------------------------------------------------------------
     Power-Saving Auto Screen-Off / Sleep Timer (Default 4h + 60s Warning)
     -------------------------------------------------------------------------- */

  noteUserActivity(force) {
    const now = Date.now();
    if (!force && this._lastActivityNoteMs && (now - this._lastActivityNoteMs) < 1000) {
      return;
    }
    this._lastActivityNoteMs = now;
    this._lastUserActivityMs = now;
  }

  _bindGlobalActivityListeners() {
    if (typeof document === 'undefined' || this._activityListenersBound) return;
    this._activityListenersBound = true;

    const onActivity = () => this.noteUserActivity(false);
    const onWakeOrCancelKey = (e) => {
      this.noteUserActivity(false);
      if (this.isPowerSaveMode) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        this.exitPowerSaveMode();
        return;
      }
      if (this._sleepWarningActive) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        this.cancelSleepWarning();
      }
    };
    const onWakeOrCancelClick = (e) => {
      this.noteUserActivity(false);
      if (this.isPowerSaveMode) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        this.exitPowerSaveMode();
        return;
      }
      if (this._sleepWarningActive) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        this.cancelSleepWarning();
      }
    };

    try {
      window.addEventListener('keydown', onWakeOrCancelKey, true);
      window.addEventListener('click', onWakeOrCancelClick, true);
      document.addEventListener('mousemove', onActivity, { passive: true });
      document.addEventListener('wheel', onActivity, { passive: true });
      document.addEventListener('touchstart', onActivity, { passive: true });
    } catch (e) {
      document.addEventListener('mousemove', onActivity, false);
      document.addEventListener('wheel', onActivity, false);
      document.addEventListener('touchstart', onActivity, false);
    }
  }

  _startSleepMonitor() {
    clearInterval(this._sleepCheckInterval);
    this._sleepCheckInterval = setInterval(() => this._checkIdleSleepTimer(), 30000);
  }

  _checkIdleSleepTimer() {
    if (this.isPowerSaveMode || this._sleepWarningActive || this.isSafeMode()) return;
    if (this.mode === 'DISCLAIMER') return;
    const hours = Number(this.getUiPrefs().sleepTimeoutHours);
    if (!hours || hours <= 0 || isNaN(hours)) return;
    const idleMs = Date.now() - (this._lastUserActivityMs || Date.now());
    if (idleMs >= hours * 3600000) {
      this.triggerSleepWarning(60);
    }
  }

  triggerSleepWarning(seconds) {
    this.ensurePowerSaveDOM();
    if (this.isPowerSaveMode) return;
    const totalSec = typeof seconds === 'number' && seconds > 0 ? Math.max(1, Math.round(seconds)) : 60;
    clearInterval(this._sleepWarningTimer);
    this._sleepWarningTotalSec = totalSec;
    this._sleepWarningRemainingSec = totalSec;
    this._sleepWarningActive = true;
    this._modeBeforeSleepWarning = this.mode;
    this.cancelAutoFullscreen();
    if (!this.isModalOpen()) {
      this._saveFocusBeforeModal();
    }

    const modal = document.getElementById('sleep-warning-modal');
    const secEl = document.getElementById('sleep-countdown-sec');
    const barEl = document.getElementById('sleep-countdown-bar');
    const stayBtn = document.getElementById('btn-sleep-stay-awake');

    if (secEl) secEl.textContent = String(totalSec);
    if (barEl) barEl.style.width = '100%';
    if (modal) {
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
    }
    this.updateVideoSurfacePosition();
    if (stayBtn) {
      this.setFocusedElementFast(stayBtn);
      try {
        stayBtn.focus();
      } catch (e) {}
    }

    this._sleepWarningTimer = setInterval(() => {
      if (!this._sleepWarningActive) {
        clearInterval(this._sleepWarningTimer);
        this._sleepWarningTimer = null;
        return;
      }
      this._sleepWarningRemainingSec = Math.max(0, this._sleepWarningRemainingSec - 1);
      const rem = this._sleepWarningRemainingSec;
      const sEl = document.getElementById('sleep-countdown-sec');
      const bEl = document.getElementById('sleep-countdown-bar');
      if (sEl) sEl.textContent = String(rem);
      if (bEl) {
        const pct = Math.max(0, Math.min(100, Math.round((rem / Math.max(1, this._sleepWarningTotalSec)) * 100)));
        bEl.style.width = pct + '%';
      }
      if (rem <= 0) {
        clearInterval(this._sleepWarningTimer);
        this._sleepWarningTimer = null;
        this._sleepWarningActive = false;
        const mEl = document.getElementById('sleep-warning-modal');
        if (mEl) {
          mEl.classList.add('hidden');
          mEl.setAttribute('aria-hidden', 'true');
        }
        this.enterPowerSaveMode();
      }
    }, 1000);
  }

  cancelSleepWarning(silent) {
    clearInterval(this._sleepWarningTimer);
    this._sleepWarningTimer = null;
    const wasActive = Boolean(this._sleepWarningActive);
    this._sleepWarningActive = false;

    const modal = document.getElementById('sleep-warning-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }
    this.noteUserActivity(true);
    if (wasActive && !this.isModalOpen()) {
      this.updateVideoSurfacePosition();
      if (this.mode === 'BROWSE') {
        this._restoreFocusAfterModal();
        if (this.focusArea === 'channels') {
          this.scheduleAutoFullscreen();
        }
      }
    }
    if (wasActive && !silent) {
      this.showToast('כיבוי המסך בוטל — ממשיכים לצפות ✓', true);
    }
  }

  enterPowerSaveMode() {
    this.ensurePowerSaveDOM();
    clearInterval(this._sleepWarningTimer);
    this._sleepWarningTimer = null;
    this._sleepWarningActive = false;
    this.cancelAutoFullscreen();
    this.cancelPendingPreviewPlayback();

    const warnModal = document.getElementById('sleep-warning-modal');
    if (warnModal) {
      warnModal.classList.add('hidden');
      warnModal.setAttribute('aria-hidden', 'true');
    }

    this._channelBeforePowerSave =
      this.selectedChannel ||
      (Array.isArray(this.visibleChannels) && this.visibleChannels[this.focusedChannelIndex]) ||
      null;
    this._modeBeforePowerSave =
      this._modeBeforeSleepWarning === 'FULLSCREEN' || this.mode === 'FULLSCREEN' ? 'FULLSCREEN' : 'BROWSE';

    if (this.player && typeof this.player.stop === 'function') {
      this.player.stop();
    }

    this.isPowerSaveMode = true;
    const blkScreen = document.getElementById('power-save-screen');
    if (blkScreen) {
      blkScreen.classList.remove('hidden');
      blkScreen.setAttribute('aria-hidden', 'false');
    }

    try {
      if (typeof window !== 'undefined' && window.AndroidTvHost && typeof window.AndroidTvHost.setScreenSleepMode === 'function') {
        window.AndroidTvHost.setScreenSleepMode(true);
      }
    } catch (e) {}

    try {
      if (
        typeof window !== 'undefined' &&
        window.webOS &&
        window.webOS.service &&
        typeof window.webOS.service.request === 'function'
      ) {
        window.webOS.service.request('luna://com.webos.service.tvpower', {
          method: 'power/turnOffScreen',
          parameters: { standbyMode: 'active' },
          onSuccess: function () {},
          onFailure: function () {}
        });
      }
    } catch (e) {}
  }

  exitPowerSaveMode() {
    if (!this.isPowerSaveMode) return;
    this.isPowerSaveMode = false;

    const blkScreen = document.getElementById('power-save-screen');
    if (blkScreen) {
      blkScreen.classList.add('hidden');
      blkScreen.setAttribute('aria-hidden', 'true');
    }

    try {
      if (typeof window !== 'undefined' && window.AndroidTvHost && typeof window.AndroidTvHost.setScreenSleepMode === 'function') {
        window.AndroidTvHost.setScreenSleepMode(false);
      }
    } catch (e) {}

    try {
      if (
        typeof window !== 'undefined' &&
        window.webOS &&
        window.webOS.service &&
        typeof window.webOS.service.request === 'function'
      ) {
        window.webOS.service.request('luna://com.webos.service.tvpower', {
          method: 'power/turnOnScreen',
          parameters: {},
          onSuccess: function () {},
          onFailure: function () {}
        });
      }
    } catch (e) {}

    this.noteUserActivity(true);
    const resumeCh =
      this._channelBeforePowerSave ||
      this.selectedChannel ||
      (Array.isArray(this.visibleChannels) && this.visibleChannels[this.focusedChannelIndex]) ||
      (Array.isArray(this.allChannels) && this.allChannels[0]) ||
      null;

    if (resumeCh) {
      this.highlightChannel(resumeCh, true);
      if (this._modeBeforePowerSave === 'FULLSCREEN') {
        this.enterFullscreen();
      } else if (this.mode === 'BROWSE') {
        this.updateChannelFocusFast();
        if (this.focusArea === 'channels') {
          this.scheduleAutoFullscreen();
        }
      }
    }
    this.showToast('המסך חזר לפעילות ✓', true);
  }

  /* --------------------------------------------------------------------------
     Direct 1-Press Voice Command Engine
     -------------------------------------------------------------------------- */

  _stopActiveSpeechRecognition() {
    if (this._activeSpeechRecognition) {
      try {
        this._activeSpeechRecognition.onresult = null;
        this._activeSpeechRecognition.onerror = null;
        this._activeSpeechRecognition.onend = null;
        this._activeSpeechRecognition.abort();
      } catch (e) {}
      this._activeSpeechRecognition = null;
    }
  }

  startVoiceCommand() {
    if (this.mode === 'DISCLAIMER') return;
    this.ensureVoiceDOM();
    this.cancelAutoFullscreen();
    this.noteUserActivity(true);
    this._stopActiveSpeechRecognition();

    const voiceLang = (this.getUiPrefs && this.getUiPrefs().voiceLang) || 'he-IL';

    // Priority a) Native Android TV Bridge
    if (
      typeof window !== 'undefined' &&
      window.AndroidTvHost &&
      typeof window.AndroidTvHost.startVoiceCommand === 'function'
    ) {
      this.showToast('מפעיל פקודה קולית...', true);
      try {
        window.AndroidTvHost.startVoiceCommand(voiceLang);
        return;
      } catch (e) {}
    }

    if (!this.isModalOpen()) {
      this._saveFocusBeforeModal();
    }
    if (this.mode !== 'VOICE') {
      this.previousModeBeforeModal = this.mode === 'FULLSCREEN' ? 'FULLSCREEN' : 'BROWSE';
    }
    this.mode = 'VOICE';

    const overlay = document.getElementById('voice-overlay');
    const statusEl = document.getElementById('voice-status-text');
    const transcriptEl = document.getElementById('voice-transcript-text');
    const micRing = document.getElementById('voice-mic-ring');
    const fallbackBtn = document.getElementById('btn-voice-fallback-search');
    const cancelBtn = document.getElementById('btn-voice-cancel');

    const SpeechRec =
      typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

    // Priority b) Web Speech API
    if (SpeechRec) {
      if (statusEl) statusEl.textContent = 'מקשיב... אמור שם ערוץ, מספר או תוכנית';
      if (transcriptEl) transcriptEl.textContent = 'מדבר כעת...';
      if (micRing) micRing.classList.add('listening');
      if (fallbackBtn) fallbackBtn.classList.add('hidden');
      if (overlay) {
        overlay.classList.remove('hidden');
        overlay.setAttribute('aria-hidden', 'false');
      }
      this.updateVideoSurfacePosition();
      if (cancelBtn) this.setFocusedElementFast(cancelBtn);

      try {
        const rec = new SpeechRec();
        this._activeSpeechRecognition = rec;
        rec.lang = voiceLang;
        rec.interimResults = true;
        rec.maxAlternatives = 3;
        rec.continuous = false;

        let handledFinal = false;
        let lastInterim = '';

        rec.onresult = (evt) => {
          if (!evt || !evt.results) return;
          let interim = '';
          let finalText = '';
          for (let i = evt.resultIndex || 0; i < evt.results.length; i++) {
            const res = evt.results[i];
            if (!res || !res[0]) continue;
            const t = String(res[0].transcript || '').trim();
            if (res.isFinal) {
              finalText += (finalText ? ' ' : '') + t;
            } else {
              interim += (interim ? ' ' : '') + t;
            }
          }
          if (interim) {
            lastInterim = interim;
            if (transcriptEl) transcriptEl.textContent = interim;
          }
          if (finalText && !handledFinal) {
            handledFinal = true;
            if (transcriptEl) transcriptEl.textContent = finalText;
            this._stopActiveSpeechRecognition();
            this.closeVoiceOverlay(true);
            this.handleVoiceCommand(finalText);
          }
        };

        rec.onerror = (evt) => {
          const code = evt && evt.error ? evt.error : 'error';
          this._stopActiveSpeechRecognition();
          if (code === 'aborted') return;
          this.onNativeVoiceError(code);
        };

        rec.onend = () => {
          this._activeSpeechRecognition = null;
          if (micRing) micRing.classList.remove('listening');
          if (!handledFinal && this.mode === 'VOICE') {
            if (lastInterim) {
              handledFinal = true;
              this.closeVoiceOverlay(true);
              this.handleVoiceCommand(lastInterim);
            } else {
              this.closeVoiceOverlay();
            }
          }
        };

        rec.start();
        return;
      } catch (recErr) {
        this._stopActiveSpeechRecognition();
      }
    }

    // Priority c) Unsupported Speech API (e.g., LG webOS ThinQ OS-locked mic / TV browsers without Web Speech)
    this.onNativeVoiceError('unsupported');
  }

  closeVoiceOverlay(skipFocusRestore) {
    this._stopActiveSpeechRecognition();
    const overlay = document.getElementById('voice-overlay');
    const micRing = document.getElementById('voice-mic-ring');
    if (micRing) micRing.classList.remove('listening');
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
    }
    if (this.mode === 'VOICE') {
      if (this.previousModeBeforeModal === 'FULLSCREEN') {
        this.mode = 'FULLSCREEN';
      } else {
        this.mode = 'BROWSE';
      }
      if (!skipFocusRestore) {
        this.updateVideoSurfacePosition();
        if (this.mode === 'BROWSE') {
          this._restoreFocusAfterModal();
          if (this.focusArea === 'channels') {
            this.scheduleAutoFullscreen();
          }
        }
      }
    }
  }

  onNativeVoiceError(err) {
    const code = err ? String(err) : 'unsupported';
    if (code === 'cancelled' || code === 'canceled' || code === 'aborted') {
      this.closeVoiceOverlay();
      this.showToast('הפקודה הקולית בוטלה', true);
      return;
    }

    this.ensureVoiceDOM();
    if (!this.isModalOpen()) {
      this._saveFocusBeforeModal();
    }
    if (this.mode !== 'VOICE') {
      this.previousModeBeforeModal = this.mode === 'FULLSCREEN' ? 'FULLSCREEN' : 'BROWSE';
    }
    this.mode = 'VOICE';

    const overlay = document.getElementById('voice-overlay');
    const statusEl = document.getElementById('voice-status-text');
    const transcriptEl = document.getElementById('voice-transcript-text');
    const micRing = document.getElementById('voice-mic-ring');
    const fallbackBtn = document.getElementById('btn-voice-fallback-search');

    if (micRing) micRing.classList.remove('listening');
    if (statusEl) {
      statusEl.textContent =
        code === 'no-speech'
          ? 'לא זוהה דיבור — נסה שנית או פתח חיפוש'
          : 'זיהוי קולי ישיר אינו זמין בגרסת מערכת זו';
    }
    if (transcriptEl) {
      transcriptEl.textContent = this.isWebOSPlatform()
        ? 'מיקרופון השלט ב-LG webOS שמור למערכת LG ThinQ AI בלבד. ניתן לעבור ישירות לחיפוש מהיר או ל-VOD.'
        : 'שירות זיהוי הדיבור של הדפדפן או המכשיר אינו זמין כעת. השתמש בחיפוש המהיר לערוצים ול-VOD 7 ימים.';
    }
    if (fallbackBtn) fallbackBtn.classList.remove('hidden');
    if (overlay) {
      overlay.classList.remove('hidden');
      overlay.setAttribute('aria-hidden', 'false');
    }
    this.updateVideoSurfacePosition();
    if (fallbackBtn) {
      this.setFocusedElementFast(fallbackBtn);
    }
    this.showToast('זיהוי קולי לא זמין במכשיר זה — נפתח קיצור חיפוש', true);
  }

  _normalizeVoiceText(text) {
    if (!text) return '';
    return String(text)
      .toLowerCase()
      .replace(/[\u0591-\u05C7]/g, '')
      .replace(/["'״׳.,!?():;\-_/\\]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _parseVoiceChannelNumber(normText) {
    if (!normText) return NaN;
    const stripped = normText
      .replace(/^(?:עבור ל|תעביר ל|העבר ל|שים |פתח |תפתח |נגן |צפה ב|channel |ערוץ )+/g, '')
      .replace(/^מספר\s+/, '')
      .trim();
    if (!stripped) return NaN;

    if (/^\d{1,4}$/.test(stripped)) {
      return parseInt(stripped, 10);
    }

    const hebrewNumMap = {
      'אחד': 1, 'אחת': 1, 'שתיים': 2, 'שניים': 2, 'שתי': 2, 'שני': 2,
      'שלוש': 3, 'שלושה': 3, 'ארבע': 4, 'ארבעה': 4, 'חמש': 5, 'חמישה': 5,
      'שש': 6, 'שישה': 6, 'שבע': 7, 'שבעה': 7, 'שמונה': 8, 'תשע': 9, 'תשעה': 9,
      'עשר': 10, 'עשרה': 10,
      'אחת עשרה': 11, 'אחד עשר': 11, 'אחד עשרה': 11,
      'שתים עשרה': 12, 'שתיים עשרה': 12, 'שנים עשר': 12, 'שניים עשר': 12,
      'שלוש עשרה': 13, 'שלושה עשר': 13,
      'ארבע עשרה': 14, 'ארבעה עשר': 14,
      'חמש עשרה': 15, 'חמישה עשר': 15,
      'שש עשרה': 16, 'שישה עשר': 16,
      'שבע עשרה': 17, 'שבעה עשר': 17,
      'שמונה עשרה': 18, 'שמונה עשר': 18,
      'תשע עשרה': 19, 'תשעה עשר': 19,
      'עשרים': 20
    };
    if (Object.prototype.hasOwnProperty.call(hebrewNumMap, stripped)) {
      return hebrewNumMap[stripped];
    }
    return NaN;
  }

  _findVoiceChannelMatch(cleanQuery) {
    if (!cleanQuery || !Array.isArray(this.allChannels) || this.allChannels.length === 0) return null;
    const qTokens = cleanQuery.split(' ').filter(Boolean);
    if (qTokens.length === 0) return null;

    let bestCh = null;
    let bestScore = 0;

    for (let i = 0; i < this.allChannels.length; i++) {
      const ch = this.allChannels[i];
      if (!ch) continue;
      const chNorm = this._normalizeVoiceText(ch.name || '');
      const tvgNorm = this._normalizeVoiceText(ch.tvgName || '');
      const candidates = [chNorm, tvgNorm].filter(Boolean);
      let score = 0;

      for (let c = 0; c < candidates.length; c++) {
        const cand = candidates[c];
        if (cand === cleanQuery) {
          score = Math.max(score, 100);
        } else if (cand.indexOf(cleanQuery) !== -1) {
          score = Math.max(score, 82);
        } else if (cleanQuery.indexOf(cand) !== -1 && cand.length >= 2) {
          score = Math.max(score, 74);
        } else {
          let hits = 0;
          for (let t = 0; t < qTokens.length; t++) {
            if (cand.indexOf(qTokens[t]) !== -1) hits++;
          }
          if (hits > 0 && hits === qTokens.length) {
            score = Math.max(score, 68 + hits * 4);
          } else if (hits > 0 && qTokens.length > 1) {
            score = Math.max(score, Math.round((hits / qTokens.length) * 55));
          }
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestCh = ch;
      }
    }

    return bestScore >= 50 ? bestCh : null;
  }

  handleVoiceCommand(transcript) {
    this.closeVoiceOverlay(true);
    const raw = String(transcript || '').trim();
    if (!raw) return { action: 'empty' };

    const norm = this._normalizeVoiceText(raw);
    if (!norm) return { action: 'empty' };

    // 1. Direct playback & navigation commands
    if (norm === 'מסך מלא' || norm === 'fullscreen' || norm === 'full screen' || norm.indexOf('מסך מלא') !== -1) {
      this.enterFullscreen();
      this.showToast('פקודה קולית: מסך מלא ✓', true);
      return { action: 'fullscreen' };
    }
    if (
      norm === 'רשימה' ||
      norm === 'יציאה' ||
      norm === 'חזור' ||
      norm === 'חזור לרשימה' ||
      norm === 'exit' ||
      norm === 'back'
    ) {
      if (this.isModalOpen()) {
        this.closeModals();
      } else if (this.mode === 'FULLSCREEN') {
        this.exitFullscreen();
      }
      this.showToast('פקודה קולית: חזרה לרשימה ✓', true);
      return { action: 'exit' };
    }
    if (norm === 'הגדרות' || norm === 'settings') {
      this.openSettingsModal();
      this.showToast('פקודה קולית: הגדרות ✓', true);
      return { action: 'settings' };
    }
    if (
      norm.indexOf('סטארט אובר') !== -1 ||
      norm.indexOf('התחל מחדש') !== -1 ||
      norm.indexOf('מההתחלה') !== -1 ||
      norm.indexOf('start over') !== -1 ||
      norm === 'startover'
    ) {
      this.onRedButton();
      this.showToast('פקודה קולית: סטארט אובר ✓', true);
      return { action: 'startover' };
    }
    if (
      norm.indexOf('בטל השתקה') !== -1 ||
      norm.indexOf('בטל שקט') !== -1 ||
      norm.indexOf('הפעל קול') !== -1 ||
      norm.indexOf('unmute') !== -1
    ) {
      if (this.player && this.player.video) {
        this.player.video.muted = false;
        if (typeof this.player.applyEffectiveVolume === 'function') {
          this.player.applyEffectiveVolume();
        }
      }
      this.showToast('פקודה קולית: השמע הופעל ✓', true);
      return { action: 'unmute' };
    }
    if (norm === 'השתק' || norm === 'שקט' || norm === 'mute') {
      if (this.player && this.player.video) {
        this.player.video.muted = true;
      }
      this.showToast('פקודה קולית: השמע הושתק ✓', true);
      return { action: 'mute' };
    }
    if (norm === 'עצור' || norm === 'stop') {
      this.stopPlayback();
      this.showToast('פקודה קולית: השידור נעצר ✓', true);
      return { action: 'stop' };
    }
    if (norm === 'מדריך' || norm === 'guide') {
      this.openGuideModal('channel');
      this.showToast('פקודה קולית: מדריך תוכניות ✓', true);
      return { action: 'guide' };
    }
    if (norm === 'vod' || norm === 'וי או די' || norm === 'וי או די 7 ימים') {
      this.openGuideModal('vod');
      this.showToast('פקודה קולית: VOD 7 ימים ✓', true);
      return { action: 'vod' };
    }

    // 2. Channel number match (e.g. "ערוץ 12", "11", "שתים עשרה")
    const parsedNum = this._parseVoiceChannelNumber(norm);
    if (!isNaN(parsedNum) && parsedNum > 0) {
      const exactNumCh = this.allChannels.find((c) => c.number === parsedNum);
      if (exactNumCh) {
        this.jumpToChannelNumber(parsedNum);
        this.showToast('מעבר לערוץ ' + exactNumCh.number + ' • ' + exactNumCh.name, true);
        return { action: 'channel-number', channel: exactNumCh };
      }
    }

    // 3. Fuzzy channel name match
    const cleanQuery = norm
      .replace(/^(?:עבור ל|תעביר ל|העבר ל|שים |פתח |תפתח |נגן |צפה ב|חפש |ערוץ )+/g, '')
      .trim() || norm;

    const matchedCh = this._findVoiceChannelMatch(cleanQuery);
    if (matchedCh) {
      if (this.onlyFavorites && !this.favorites.has(matchedCh.id)) {
        this.onlyFavorites = false;
        this.applyChannelFilter();
      }
      const idx = this.visibleChannels.findIndex((c) => c.id === matchedCh.id);
      if (idx !== -1) this.focusedChannelIndex = idx;
      this.highlightChannel(matchedCh, true);
      if (this.mode === 'FULLSCREEN') {
        this.showOSD();
      } else {
        this.updateChannelFocusFast();
      }
      this.showToast('מעבר לערוץ: ' + matchedCh.name, true);
      return { action: 'channel-name', channel: matchedCh };
    }

    if (!isNaN(parsedNum) && parsedNum > 0) {
      this.showToast('ערוץ מספר ' + parsedNum + ' לא נמצא', true);
      return { action: 'channel-not-found', number: parsedNum };
    }

    // 4. Live & 7-day VOD programme search
    if (this.epg && typeof this.epg.searchAllVodProgrammes === 'function') {
      const lookup = this._buildEpgChannelLookup();
      const vodMatches = this.epg.searchAllVodProgrammes(cleanQuery, {
        maxDays: 7,
        pastOnly: false,
        limit: 15,
        channelMap: lookup.channelMap
      });
      if (Array.isArray(vodMatches) && vodMatches.length > 0) {
        const liveMatch = vodMatches.find((item) => item && item.isLive && this._resolveChannelForEpgId(item.epgChannelId, lookup));
        if (liveMatch) {
          this.playVodItem(liveMatch);
          return { action: 'vod-live', item: liveMatch };
        }
        if (vodMatches.length === 1) {
          this.playVodItem(vodMatches[0]);
          return { action: 'vod-single', item: vodMatches[0] };
        }
        this.openGuideModal('vod', cleanQuery);
        this.showToast('נמצאו ' + vodMatches.length + ' תוצאות עבור "' + cleanQuery + '"', true);
        return { action: 'vod-list', query: cleanQuery, count: vodMatches.length };
      }
    }

    this.showToast('לא נמצא ערוץ או תוכנית עבור "' + raw + '"', true);
    return { action: 'no-match', query: raw };
  }

  /* --------------------------------------------------------------------------
     Non-Destructive Append Default Source
     -------------------------------------------------------------------------- */

  appendDefaultSource() {
    if (!this.store) return null;
    let res = null;
    if (typeof this.store.appendDefaultSource === 'function') {
      res = this.store.appendDefaultSource();
    } else {
      const defUrl = typeof DEFAULT_SAMPLE_M3U === 'string' ? DEFAULT_SAMPLE_M3U : 'https://iptv-org.github.io/iptv/countries/il.m3u';
      const existing = this.store.sources.find((s) => s && s.url === defUrl);
      if (existing) {
        existing.enabled = true;
        this.store.saveSources();
        res = { added: false, reenabled: true, source: existing };
      } else {
        let newId = 'default-il';
        if (this.store.sources.some((s) => s && s.id === newId)) {
          newId = 'default-il-' + Date.now().toString(36);
        }
        const newSrc = { id: newId, name: 'ברירת מחדל — ערוצי ישראל', url: defUrl, enabled: true };
        this.store.sources.push(newSrc);
        this.store.saveSources();
        res = { added: true, reenabled: false, source: newSrc };
      }
    }

    this.renderSourcesManagerList();
    this.refreshAllSources(false, { keepModalOpen: true });

    if (res && res.added) {
      this.showToast('מקור ברירת המחדל נוסף לרשימה ללא מחיקת מקורות קיימים ✓', true);
    } else if (res && res.reenabled) {
      this.showToast('מקור ברירת המחדל הופעל מחדש ללא מחיקת מקורות קיימים ✓', true);
    } else {
      this.showToast('מקור ברירת המחדל כבר קיים ופעיל ✓', true);
    }
    return res;
  }

  /* --------------------------------------------------------------------------
     VOD & Catchup Channel Resolution Helpers
     -------------------------------------------------------------------------- */

  hasCatchupSupport(channel) {
    return Boolean(channel && (channel.catchupType || channel.catchupSource));
  }

  _buildEpgChannelLookup() {
    const byEpgId = Object.create(null);
    const channelMap = Object.create(null);
    const channels = Array.isArray(this.allChannels) ? this.allChannels : [];

    const registerKey = (key, ch) => {
      if (!key || typeof key !== 'string' || !ch) return;
      const trimmed = key.trim();
      if (!trimmed) return;
      if (!byEpgId[trimmed]) byEpgId[trimmed] = ch;
      const lower = trimmed.toLowerCase();
      if (!byEpgId[lower]) byEpgId[lower] = ch;
      if (this.epg && typeof this.epg.normalizeChannelKey === 'function') {
        const norm = this.epg.normalizeChannelKey(trimmed);
        if (norm && !byEpgId[norm]) byEpgId[norm] = ch;
      }
    };

    for (let i = 0; i < channels.length; i++) {
      const ch = channels[i];
      if (!ch) continue;
      registerKey(ch.epgId, ch);
      registerKey(ch.id, ch);
      registerKey(ch.uid, ch);
      registerKey(ch.tvgName, ch);
      registerKey(ch.rawName, ch);
      registerKey(ch.name, ch);
      if (this.epg && this.epg.channelAliasMap) {
        const keys = [ch.epgId, ch.tvgName, ch.rawName, ch.name, ch.id];
        for (let k = 0; k < keys.length; k++) {
          const val = keys[k];
          if (!val) continue;
          const t = String(val).trim();
          const l = t.toLowerCase();
          const n = typeof this.epg.normalizeChannelKey === 'function' ? this.epg.normalizeChannelKey(t) : '';
          const mappedId =
            this.epg.channelAliasMap.get(t) ||
            this.epg.channelAliasMap.get(l) ||
            (n ? this.epg.channelAliasMap.get(n) : '');
          if (mappedId) {
            registerKey(mappedId, ch);
            if (!channelMap[mappedId]) channelMap[mappedId] = ch.name;
          }
          if (this.epg.channelAliasCandidates) {
            const cands =
              this.epg.channelAliasCandidates.get(t) ||
              this.epg.channelAliasCandidates.get(l) ||
              (n ? this.epg.channelAliasCandidates.get(n) : null);
            if (Array.isArray(cands)) {
              for (let c = 0; c < cands.length; c++) {
                registerKey(cands[c], ch);
                if (!channelMap[cands[c]]) channelMap[cands[c]] = ch.name;
              }
            }
          }
        }
      }
    }

    return { byEpgId: byEpgId, channelMap: channelMap };
  }

  _resolveChannelForEpgId(epgChannelId, lookupOpt) {
    if (!epgChannelId) return null;
    const lookup = lookupOpt || this._buildEpgChannelLookup();
    const byId = lookup.byEpgId;
    const key = String(epgChannelId).trim();
    if (byId[key]) return byId[key];
    const lower = key.toLowerCase();
    if (byId[lower]) return byId[lower];
    if (this.epg && typeof this.epg.normalizeChannelKey === 'function') {
      const norm = this.epg.normalizeChannelKey(key);
      if (norm && byId[norm]) return byId[norm];
    }
    return null;
  }

  _formatVodDayLabel(startMs) {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const d = new Date(startMs);
    const targetMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
    const diffDays = Math.round((todayMidnight - targetMidnight) / 86400000);
    if (diffDays === 0) return 'היום';
    if (diffDays === 1) return 'אתמול';
    if (diffDays > 1 && diffDays <= 7) return 'לפני ' + diffDays + ' ימים';
    if (diffDays < 0) return 'בהמשך';
    const dd = ('0' + d.getDate()).slice(-2);
    const mm = ('0' + (d.getMonth() + 1)).slice(-2);
    return dd + '/' + mm;
  }

  playCatchup(channel, prog) {
    if (!channel || !prog) return false;
    if (this.onlyFavorites && !this.favorites.has(channel.id)) {
      this.onlyFavorites = false;
      this.applyChannelFilter();
    }
    const idx = this.visibleChannels.findIndex((c) => c.id === channel.id);
    if (idx !== -1) {
      this.focusedChannelIndex = idx;
    }

    const now = Date.now();
    const startMs = typeof prog.startMs === 'number'
      ? prog.startMs
      : (typeof prog.start === 'number' ? prog.start : (prog.start ? new Date(prog.start).getTime() : now));
    const stopMs = typeof prog.stopMs === 'number'
      ? prog.stopMs
      : (typeof prog.stop === 'number' ? prog.stop : (prog.stop ? new Date(prog.stop).getTime() : startMs + 3600000));

    const normalizedProg = {
      id: prog.id || (channel.id + '_' + startMs),
      title: prog.title || 'שידור חי',
      desc: prog.desc || '',
      startMs: startMs,
      stopMs: stopMs,
      start: new Date(startMs),
      stop: new Date(stopMs),
      startStr: prog.startStr || (this.epg ? this.epg.formatTime(startMs) : ''),
      stopStr: prog.stopStr || (this.epg ? this.epg.formatTime(stopMs) : ''),
      status: stopMs <= now ? 'past' : (startMs <= now ? 'live' : 'upcoming')
    };

    if (normalizedProg.status === 'live') {
      this.highlightChannel(channel, true);
      this.enterFullscreen();
      this.showToast('מעבר לשידור החי: ' + channel.name + ' — ' + normalizedProg.title, true);
      return true;
    }

    if (this.hasCatchupSupport(channel)) {
      this.startProgrammeCatchup(channel, normalizedProg);
      this.showToast('מנגן VOD / סטארט אובר: ' + normalizedProg.title, true);
      return true;
    }

    // Stream source does not provide catchup URLs -> tune smoothly to channel and inform user clearly
    this.highlightChannel(channel, true);
    this.enterFullscreen();
    this.showToast('מקור הערוץ (' + channel.name + ') אינו מספק קישורי Catchup/VOD — מנגן שידור חי', true);
    return false;
  }

  playVodItem(vodItem) {
    if (!vodItem) return false;
    const ch = vodItem.channel || this._resolveChannelForEpgId(vodItem.epgChannelId);
    if (!ch) {
      this.showToast('הערוץ של תוכנית זו אינו מופיע ברשימת הערוצים הפעילה', true);
      return false;
    }
    if (this.mode === 'GUIDE' || this.isModalOpen()) {
      this.closeModals();
    }
    return this.playCatchup(ch, vodItem);
  }

  updateAutoOtaButtonUI() {
    if (typeof document === 'undefined') return;
    const btn = document.getElementById('btn-toggle-auto-ota');
    if (!btn) return;
    let enabled = true;
    if (this.otaManager && typeof this.otaManager.isAutoOtaEnabled === 'function') {
      enabled = Boolean(this.otaManager.isAutoOtaEnabled());
    } else {
      try {
        enabled = localStorage.getItem('zenplay_ota_auto_update_v1') !== '0';
      } catch (e) {}
    }
    if (enabled) {
      btn.classList.add('active-option');
    } else {
      btn.classList.remove('active-option');
    }
    const pill = btn.querySelector('.ui-toggle-pill');
    if (pill) {
      pill.textContent = enabled ? 'מופעל ✓' : 'כבוי';
      if (enabled) {
        pill.classList.add('is-on');
        pill.classList.remove('is-off');
      } else {
        pill.classList.remove('is-on');
        pill.classList.add('is-off');
      }
    }
  }

  shouldShowFirstRunDisclaimer() {
    if (this.isSafeMode()) return false;
    try {
      return localStorage.getItem(STORAGE_KEYS.DISCLAIMER_ACCEPTED) !== '1';
    } catch (e) {
      return true;
    }
  }

  openDisclaimerModal(fromSettings) {
    this.ensureDisclaimerDOM();
    this.cancelAutoFullscreen();
    const modal = document.getElementById('disclaimer-modal');
    if (!modal) return;

    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal && !settingsModal.classList.contains('hidden')) {
      settingsModal.classList.add('hidden');
      if (this.otaManager) this.otaManager.stopCloudSyncPolling();
    }

    this._disclaimerFromSettings = Boolean(fromSettings);
    this.previousModeBeforeModal = this._disclaimerFromSettings ? 'SETTINGS' : 'BROWSE';
    this.mode = 'DISCLAIMER';

    const body = modal.querySelector('.disclaimer-body');
    if (body) body.scrollTop = 0;

    modal.classList.remove('hidden');
    this.updateVideoSurfacePosition();

    const acceptBtn = document.getElementById('btn-disclaimer-accept');
    if (acceptBtn) {
      this.setFocusedElementFast(acceptBtn);
    } else {
      this.setupModalFocus('#disclaimer-modal');
    }
  }

  closeDisclaimerModal() {
    const modal = document.getElementById('disclaimer-modal');
    if (modal) modal.classList.add('hidden');

    const fromSettings = Boolean(this._disclaimerFromSettings);
    this._disclaimerFromSettings = false;

    if (fromSettings) {
      this.previousModeBeforeModal = 'BROWSE';
      this.mode = 'SETTINGS';
      const settingsModal = document.getElementById('settings-modal');
      if (settingsModal) settingsModal.classList.remove('hidden');
      this.switchSettingsTab('about');
      if (this.otaManager) {
        this.otaManager.startCloudSyncPolling();
        this.otaManager.updateVersionBadgesUI();
      }
      this.updateVideoSurfacePosition();
      const openBtn = document.getElementById('btn-open-disclaimer');
      if (openBtn) {
        this.setFocusedElementFast(openBtn);
        this.scrollModalTargetIntoView(openBtn);
      } else {
        this.setupModalFocus('#settings-modal');
      }
    } else {
      this.previousModeBeforeModal = 'BROWSE';
      this.mode = 'BROWSE';
      this.focusArea = 'channels';
      this.updateVideoSurfacePosition(true);
      this.updateChannelFocusFast();
      this.scheduleAutoFullscreen();
    }
  }

  acceptDisclaimer() {
    try {
      localStorage.setItem(STORAGE_KEYS.DISCLAIMER_ACCEPTED, '1');
    } catch (e) {}

    const modal = document.getElementById('disclaimer-modal');
    if (modal) modal.classList.add('hidden');

    if (this._disclaimerFromSettings) {
      this.closeDisclaimerModal();
      return;
    }

    this._disclaimerFromSettings = false;
    this.previousModeBeforeModal = 'BROWSE';
    this.mode = 'BROWSE';
    this.focusArea = 'channels';
    this.updateVideoSurfacePosition(true);
    this.updateChannelFocusFast();
    this.scheduleAutoFullscreen();

    if (this.otaManager && typeof this.otaManager.flushPendingChangelog === 'function') {
      this.otaManager.flushPendingChangelog();
    }
  }

  cancelAutoFullscreen() {
    if (this._autoFullscreenTimer) {
      clearTimeout(this._autoFullscreenTimer);
      this._autoFullscreenTimer = null;
    }
  }

  scheduleAutoFullscreen() {
    this.cancelAutoFullscreen();
    if (this.mode !== 'BROWSE' || this.focusArea !== 'channels') return;
    if (this.isModalOpen() || this.isSafeMode()) return;
    if (!Array.isArray(this.visibleChannels) || this.visibleChannels.length === 0) return;

    const prefs = this.getUiPrefs();
    const sec = Number(prefs.autoFullscreenSec);
    if (!sec || sec <= 0 || isNaN(sec)) return;

    this._autoFullscreenTimer = setTimeout(() => {
      this._autoFullscreenTimer = null;
      if (this.mode !== 'BROWSE' || this.focusArea !== 'channels') return;
      if (this.isModalOpen() || this.isSafeMode()) return;
      if (!Array.isArray(this.visibleChannels) || this.visibleChannels.length === 0) return;

      const ch = this.visibleChannels[this.focusedChannelIndex] || this.selectedChannel;
      if (!ch) return;
      if (!this.selectedChannel || this.selectedChannel.id !== ch.id) {
        this.highlightChannel(ch, true);
      }
      this.enterFullscreen();
    }, sec * 1000);
  }

  destroy() {
    this.cancelAutoFullscreen();
    this.cancelPendingPreviewPlayback();
    this._stopActiveSpeechRecognition();
    clearInterval(this._sleepCheckInterval);
    this._sleepCheckInterval = null;
    clearInterval(this._sleepWarningTimer);
    this._sleepWarningTimer = null;
    clearTimeout(this._vodSearchDebounceTimer);
    clearTimeout(this._pendingToastTimer);
    clearTimeout(this.previewTimer);
    clearTimeout(this._visibleEpgSyncTimer);
    clearTimeout(this._miniTimelineTimer);
    clearTimeout(this._deferredEpgTimer);
    clearTimeout(this._bootSplashSafetyTimer);
    clearTimeout(this._resizeDebounceTimer);
    clearTimeout(this.osdTimer);
    clearInterval(this.osdTickTimer);
    clearInterval(this._clockTimer);
    clearTimeout(this.toastTimer);
    clearTimeout(this.jumpTimer);
    clearTimeout(this._seekBadgeClearTimer);
    clearTimeout(this.editorNumberTimer);
    this._cancelFullscreenRaf();
    if (this._streamStatsTimer) {
      clearInterval(this._streamStatsTimer);
      this._streamStatsTimer = null;
    }
    if (this.otaManager && typeof this.otaManager.stopCloudSyncPolling === 'function') {
      this.otaManager.stopCloudSyncPolling();
    }
    if (this.player && typeof this.player.destroy === 'function') {
      this.player.destroy();
    }
  }

  openIssueModal() {
    this.cancelAutoFullscreen();
    if (!this.isModalOpen()) {
      this._saveFocusBeforeModal();
    }
    this.ensureIssueReporterDOM();
    const modal = document.getElementById('issue-modal');
    if (!modal) return;

    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal && !settingsModal.classList.contains('hidden')) {
      settingsModal.classList.add('hidden');
      if (this.otaManager) this.otaManager.stopCloudSyncPolling();
    }

    this.previousModeBeforeModal = 'BROWSE';
    this.mode = 'ISSUE';
    const statusText = document.getElementById('issue-submit-status-text');
    if (statusText) {
      statusText.textContent = 'מוכן לשליחה — קישורי M3U וטוקנים פרטיים מסוננים אוטומטית לפני השליחה.';
    }
    this.refreshIssueModalPreview();
    modal.classList.remove('hidden');
    this.updateVideoSurfacePosition();
    this.setupModalFocus('#issue-modal');
  }

  refreshIssueModalPreview() {
    if (typeof DiagnosticLogger === 'undefined') return;
    const titleIn = document.getElementById('issue-title-input');
    const descIn = document.getElementById('issue-desc-input');
    const summaryEl = document.getElementById('issue-logs-summary');
    const previewEl = document.getElementById('issue-logs-preview');
    const qrBox = document.getElementById('issue-qr-box');

    const titleVal = titleIn ? titleIn.value : '';
    const descVal = descIn ? descIn.value : '';
    const report = DiagnosticLogger.buildReport(titleVal, descVal, this);

    if (summaryEl) {
      summaryEl.textContent =
        'יצורפו אוטומטית ' +
        report.logs.length +
        ' שורות לוג מסוננות • v' +
        report.meta.version +
        ' • ' +
        report.meta.platform;
    }
    if (previewEl) {
      previewEl.textContent =
        report.logs.length > 0
          ? report.logs.slice(-16).join('\n')
          : '(אין שגיאות רשומות — יצורפו פרטי מערכת ומצב נגן אוטומטית)';
    }
    if (qrBox && typeof QRCodeGenerator !== 'undefined' && typeof QRCodeGenerator.renderSVG === 'function') {
      const qrUrl = DiagnosticLogger.buildGitHubNewIssueUrl(report, 750);
      qrBox.innerHTML = QRCodeGenerator.renderSVG(qrUrl, 148);
    }
  }

  submitIssueReport() {
    if (typeof DiagnosticLogger === 'undefined') return Promise.resolve(null);
    const titleIn = document.getElementById('issue-title-input');
    const descIn = document.getElementById('issue-desc-input');
    const statusText = document.getElementById('issue-submit-status-text');
    const titleVal = titleIn ? titleIn.value : '';
    const descVal = descIn ? descIn.value : '';

    if (statusText) statusText.textContent = 'שולח דיווח ולוגים מסוננים...';

    return DiagnosticLogger.submitIssue(titleVal, descVal, this).then((res) => {
      if (res && res.ok) {
        const msg = res.issueNumber
          ? 'התקלה דווחה בהצלחה ב-GitHub (Issue #' + res.issueNumber + ')!'
          : 'התקלה דווחה בהצלחה ב-GitHub!';
        if (statusText) statusText.textContent = msg;
        this.showToast(msg, true);
      } else {
        const fallbackMsg =
          'אין שרת דיווח אוטומטי מוגדר — סרוק את קוד ה-QR מהטלפון לפתיחת Issue מוכן עם הלוגים (או לחץ "פתח ב-GitHub").';
        if (statusText) statusText.textContent = fallbackMsg;
        this.showToast('סרוק את ה-QR בטלפון לפתיחת Issue עם הלוגים', true);
      }
      return res;
    });
  }

  copyIssueReport() {
    if (typeof DiagnosticLogger === 'undefined') return;
    const titleIn = document.getElementById('issue-title-input');
    const descIn = document.getElementById('issue-desc-input');
    const statusText = document.getElementById('issue-submit-status-text');
    const report = DiagnosticLogger.buildReport(titleIn ? titleIn.value : '', descIn ? descIn.value : '', this);
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard
        .writeText(report.markdown)
        .then(() => {
          if (statusText) statusText.textContent = 'הדוח והלוגים הועתקו ללוח בהצלחה.';
          this.showToast('הדוח והלוגים הועתקו ללוח ✓', true);
        })
        .catch(() => {
          if (statusText) statusText.textContent = 'לא ניתן להעתיק אוטומטית במכשיר זה — השתמש בסריקת QR.';
        });
    } else if (statusText) {
      statusText.textContent = 'העתקה אוטומטית אינה נתמכת בדפדפן הטלוויזיה — סרוק את ה-QR.';
    }
  }

  updateAutoplayOffBadge(forceHide) {
    if (typeof document === 'undefined') return;
    const badge = document.getElementById('preview-autoplay-off-badge');
    if (!badge) return;
    const prefs = this.getUiPrefs();
    const shouldShow = !forceHide && prefs.previewAutoplay === 'off' && this.mode !== 'FULLSCREEN';
    if (shouldShow) {
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  renderAppearanceTab() {
    this.ensureUiCustomizationDOM();
    if (typeof document === 'undefined') return;
    const appPanel = document.getElementById('settings-tab-appearance');
    if (!appPanel) return;

    const prefs = this.getUiPrefs();

    const presetBtns = appPanel.querySelectorAll('[data-ui-preset]');
    for (let i = 0; i < presetBtns.length; i++) {
      const btn = presetBtns[i];
      if (btn.dataset.uiPreset === prefs.preset) {
        btn.classList.add('active-option');
      } else {
        btn.classList.remove('active-option');
      }
    }

    const toggleBtns = appPanel.querySelectorAll('[data-ui-toggle]');
    for (let i = 0; i < toggleBtns.length; i++) {
      const btn = toggleBtns[i];
      const key = btn.dataset.uiToggle;
      const isOn = Boolean(prefs[key]);
      if (isOn) {
        btn.classList.add('active-option');
      } else {
        btn.classList.remove('active-option');
      }
      const pill = btn.querySelector('.ui-toggle-pill');
      if (pill) {
        const isActionToggle =
          key === 'wrapNavigation' ||
          key === 'singleClickFullscreen' ||
          key === 'backHidesOsdFirst';
        pill.textContent = isActionToggle ? (isOn ? 'מופעל ✓' : 'כבוי') : (isOn ? 'מוצג ✓' : 'מוסתר');
        if (isOn) {
          pill.classList.add('is-on');
          pill.classList.remove('is-off');
        } else {
          pill.classList.remove('is-on');
          pill.classList.add('is-off');
        }
      }
    }

    const prefBtns = appPanel.querySelectorAll('[data-ui-pref]');
    for (let i = 0; i < prefBtns.length; i++) {
      const btn = prefBtns[i];
      const key = btn.dataset.uiPref;
      const rawVal = btn.dataset.uiValue;
      const isInt =
        key === 'osdTimeoutSec' ||
        key === 'seekStepSec' ||
        key === 'numericJumpMs' ||
        key === 'zapDebounceMs' ||
        key === 'autoFullscreenSec';
      const targetVal = isInt ? parseInt(rawVal, 10) : rawVal;
      if (prefs[key] === targetVal) {
        btn.classList.add('active-option');
      } else {
        btn.classList.remove('active-option');
      }
    }

    const sleepBtns = appPanel.querySelectorAll('[data-sleep-hours]');
    for (let i = 0; i < sleepBtns.length; i++) {
      const btn = sleepBtns[i];
      const hrs = parseInt(btn.dataset.sleepHours, 10);
      if (!isNaN(hrs) && prefs.sleepTimeoutHours === hrs) {
        btn.classList.add('active-option');
      } else {
        btn.classList.remove('active-option');
      }
    }

    const voiceLangBtns = appPanel.querySelectorAll('[data-voice-lang]');
    for (let i = 0; i < voiceLangBtns.length; i++) {
      const btn = voiceLangBtns[i];
      if (btn.dataset.voiceLang === prefs.voiceLang) {
        btn.classList.add('active-option');
      } else {
        btn.classList.remove('active-option');
      }
    }

    const statusEl = document.getElementById('ui-prefs-status');
    if (statusEl) {
      const presetMap = { clean: 'נקי ומאוזן', minimal: 'מינימליסטי וקל', full: 'מלא ומפורט', custom: 'מותאם אישית' };
      const densityMap = { comfortable: 'מרווחת', balanced: 'מאוזנת', compact: 'דחוסה' };
      const bgMap = { midnight: 'חצות', oled: 'OLED', slate: 'צפחה', deepblue: 'כחול עמוק' };
      const layoutLabel = prefs.layoutSide === 'left' ? 'שמאל' : 'ימין';
      statusEl.textContent =
        'מצב: ' + (presetMap[prefs.preset] || prefs.preset) +
        ' | צפיפות: ' + (densityMap[prefs.density] || prefs.density) +
        ' | פריסה: ' + layoutLabel +
        ' | רקע: ' + (bgMap[prefs.bgTone] || prefs.bgTone);
    }
  }

  renderAvTab() {
    this.ensureUiCustomizationDOM();
    if (typeof document === 'undefined') return;
    const avPanel = document.getElementById('settings-tab-av');
    if (!avPanel) return;

    const prefs = this.getAvPrefs();

    const avPrefBtns = avPanel.querySelectorAll('[data-av-pref]');
    for (let i = 0; i < avPrefBtns.length; i++) {
      const btn = avPrefBtns[i];
      const key = btn.dataset.avPref;
      const rawVal = btn.dataset.avValue;
      const isInt = key === 'picBrightness' || key === 'picContrast' || key === 'picSaturation';
      const targetVal = isInt ? parseInt(rawVal, 10) : rawVal;
      if (prefs[key] === targetVal) {
        btn.classList.add('active-option');
      } else {
        btn.classList.remove('active-option');
      }
    }

    const avToggleBtns = avPanel.querySelectorAll('[data-av-toggle]');
    for (let i = 0; i < avToggleBtns.length; i++) {
      const btn = avToggleBtns[i];
      const key = btn.dataset.avToggle;
      const isOn = Boolean(prefs[key]);
      if (isOn) {
        btn.classList.add('active-option');
      } else {
        btn.classList.remove('active-option');
      }
      const pill = btn.querySelector('.ui-toggle-pill');
      if (pill) {
        pill.textContent = isOn ? 'מופעל ✓' : 'כבוי';
        if (isOn) {
          pill.classList.add('is-on');
          pill.classList.remove('is-off');
        } else {
          pill.classList.remove('is-on');
          pill.classList.add('is-off');
        }
      }
    }

    const picPresetBtns = avPanel.querySelectorAll('[data-av-pic-preset]');
    for (let i = 0; i < picPresetBtns.length; i++) {
      const btn = picPresetBtns[i];
      if (btn.dataset.avPicPreset === prefs.picturePreset) {
        btn.classList.add('active-option');
      } else {
        btn.classList.remove('active-option');
      }
    }

    const activeCh = this.selectedChannel || this.previewedChannel || (this.player && this.player.currentChannel);
    let currentTrim = 0;
    if (activeCh && this.player && typeof this.player.getChannelVolumeTrim === 'function') {
      currentTrim = this.player.getChannelVolumeTrim(activeCh.id);
    } else if (activeCh) {
      try {
        const rawLoud = localStorage.getItem('zenplay_channel_loudness_v1');
        if (rawLoud) {
          const parsedLoud = JSON.parse(rawLoud);
          if (parsedLoud && parsedLoud.trim && typeof parsedLoud.trim[activeCh.id] === 'number') {
            currentTrim = parsedLoud.trim[activeCh.id];
          }
        }
      } catch (e) {}
    }

    const trimLabel = document.getElementById('av-channel-trim-label');
    if (trimLabel) {
      const trimStr = (currentTrim > 0 ? '+' : '') + currentTrim + ' dB';
      trimLabel.textContent = activeCh
        ? 'כיוון עוצמה אישי לערוץ ' + activeCh.name + ' (נוכחי: ' + trimStr + '):'
        : 'כיוון עוצמה אישי לערוץ הנוכחי (Volume Trim):';
    }

    const trimBtns = avPanel.querySelectorAll('[data-av-trim]');
    for (let i = 0; i < trimBtns.length; i++) {
      const btn = trimBtns[i];
      const val = parseInt(btn.dataset.avTrim, 10);
      if (val === currentTrim) {
        btn.classList.add('active-option');
      } else {
        btn.classList.remove('active-option');
      }
    }

    const statusEl = document.getElementById('av-prefs-status');
    if (statusEl) {
      const normMap = { off: 'כבוי', gentle: 'עדין', broadcast: 'שידור אחיד', night: 'לילה' };
      const qualMap = { smart: 'חכם', max: 'מקסימלית', hd1080: '1080p', hd720: '720p' };
      const picMap = { original: 'מקורי', vivid: 'חי', cinema: 'קולנוע', crisp: 'חד', soft: 'רך', custom: 'מותאם' };
      const aspectMap = { contain: 'מותאם', cover: 'מילוי', fill: 'מתיחה', zoom: 'זום' };
      statusEl.textContent =
        'נרמול: ' + (normMap[prefs.audioNormMode] || prefs.audioNormMode) +
        ' • איכות: ' + (qualMap[prefs.videoQualityMode] || prefs.videoQualityMode) +
        ' • תמונה: ' + (picMap[prefs.picturePreset] || prefs.picturePreset) +
        ' • יחס: ' + (aspectMap[prefs.videoAspectMode] || prefs.videoAspectMode);
    }
  }

  applyUiPrefs(silent) {
    const prefs = this.getUiPrefs();
    const prev = this._appliedUiPrefs || null;
    this._appliedUiPrefs = prefs;

    if (typeof window !== 'undefined') {
      window.__IPTV_UI_PREFS = prefs;
    }

    if (typeof document !== 'undefined' && document.documentElement && document.documentElement.classList) {
      const cls = document.documentElement.classList;
      cls.remove('ui-density-comfortable', 'ui-density-balanced', 'ui-density-compact');
      cls.add('ui-density-' + prefs.density);

      cls.remove('ui-scale-sm', 'ui-scale-md', 'ui-scale-lg');
      cls.add('ui-scale-' + prefs.fontScale);

      cls.remove('ui-accent-sky', 'ui-accent-indigo', 'ui-accent-emerald', 'ui-accent-amber', 'ui-accent-mono');
      cls.add('ui-accent-' + prefs.accent);

      cls.remove('ui-osd-clean', 'ui-osd-minimal', 'ui-osd-full');
      cls.add('ui-osd-' + prefs.osdStyle);

      cls.remove('ui-anim-normal', 'ui-anim-reduced', 'ui-anim-off');
      cls.add('ui-anim-' + prefs.animations);

      cls.remove('ui-fx-full', 'ui-fx-light', 'ui-fx-flat');
      cls.add('ui-fx-' + prefs.visualEffects);

      cls.remove('ui-list-narrow', 'ui-list-balanced', 'ui-list-wide');
      cls.add('ui-list-' + prefs.listWidth);

      cls.remove('ui-radius-sharp', 'ui-radius-rounded', 'ui-radius-pill');
      cls.add('ui-radius-' + prefs.cornerRadius);

      cls.remove('ui-bg-midnight', 'ui-bg-oled', 'ui-bg-slate', 'ui-bg-deepblue');
      cls.add('ui-bg-' + prefs.bgTone);

      cls.remove('ui-focus-glow', 'ui-focus-border', 'ui-focus-solid');
      cls.add('ui-focus-' + prefs.focusStyle);

      cls.remove('ui-osd-op-solid', 'ui-osd-op-balanced', 'ui-osd-op-light');
      cls.add('ui-osd-op-' + prefs.osdOpacity);

      const setFlagClass = (name, flag) => {
        if (flag) cls.add(name);
        else cls.remove(name);
      };
      setFlagClass('ui-layout-left', prefs.layoutSide === 'left');
      setFlagClass('ui-hide-color-bar', !prefs.showColorBar);
      setFlagClass('ui-hide-list-hints', !prefs.showListHints);
      setFlagClass('ui-hide-row-epg', !prefs.showRowEpgBar);
      setFlagClass('ui-monogram-logos', !prefs.showRowLogos);
      setFlagClass('ui-hide-program-strip', !prefs.showProgramStrip);
      setFlagClass('ui-clean-header', !prefs.showHeaderMeta);
      setFlagClass('ui-hide-clock', !prefs.showClock);
      setFlagClass('ui-hide-synopsis', !prefs.showSynopsis);
      setFlagClass('ui-hide-prev-next', !prefs.showPrevNext);
      setFlagClass('ui-hide-ch-num', !prefs.showChannelNumbers);
    }

    if (typeof document !== 'undefined') {
      const greenLabel = document.getElementById('hint-green-label') || document.querySelector('#hint-green span:last-child');
      const blueLabel = document.getElementById('hint-blue-label') || document.querySelector('#hint-blue span:last-child');
      const stepSec = prefs.seekStepSec || 30;
      if (greenLabel) greenLabel.textContent = stepSec + ' שניות אחורה ▶▶';
      if (blueLabel) blueLabel.textContent = stepSec + ' שניות קדימה ◀◀';
    }

    this.ensureUiCustomizationDOM();

    const logosChanged = Boolean(prev && prev.showRowLogos !== prefs.showRowLogos);
    if (logosChanged) {
      if (Array.isArray(this.visibleChannels) && this.visibleChannels.length > 0 && this._channelListEl) {
        const modalFocusEl = this.isModalOpen() ? this.currentFocusedEl : null;
        this.renderChannelList();
        this.updateChannelFocusFast();
        if (modalFocusEl) {
          this.setFocusedElementFast(modalFocusEl);
        }
      }
      const previewCh = this.previewedChannel || this.selectedChannel;
      if (previewCh) {
        this.previewChannelInfo(previewCh, true);
      }
    }

    const layoutKeys = [
      'density',
      'fontScale',
      'showColorBar',
      'showListHints',
      'showRowEpgBar',
      'showProgramStrip',
      'showHeaderMeta',
      'layoutSide',
      'listWidth',
      'cornerRadius',
      'showClock',
      'showSynopsis',
      'showPrevNext',
      'showChannelNumbers'
    ];
    let layoutChanged = !prev;
    if (prev) {
      for (let i = 0; i < layoutKeys.length; i++) {
        const lk = layoutKeys[i];
        if (prev[lk] !== prefs[lk]) {
          layoutChanged = true;
          break;
        }
      }
    }

    if (layoutChanged) {
      this.invalidateChannelListMetrics();
      if (this._channelListEl) {
        this.measureChannelListMetrics(this._channelListEl);
      }
      const rows = this._channelRowEls || this.channelRowNodes || [];
      if (rows.length > 0 && !logosChanged) {
        const modalFocusEl = this.isModalOpen() ? this.currentFocusedEl : null;
        this.updateChannelFocusFast();
        if (modalFocusEl) {
          this.setFocusedElementFast(modalFocusEl);
        }
      }
      this.cachedPreviewRect = null;
      this._lastVideoSurfaceKey = '';
      this.updateVideoSurfacePosition(true);
    }

    if (prefs.previewAutoplay === 'off') {
      this.cancelPendingPreviewPlayback();
      if (this.mode !== 'FULLSCREEN' && this.player) {
        if (typeof this.player.stop === 'function') {
          this.player.stop();
        }
        const loader = document.getElementById('video-loader');
        const errBadge = document.getElementById('video-error-badge');
        const pauseBadge = document.getElementById('video-pause-indicator');
        if (loader) loader.classList.add('hidden');
        if (errBadge) errBadge.classList.add('hidden');
        if (pauseBadge) pauseBadge.classList.add('hidden');
      }
      this.updateAutoplayOffBadge();
    } else {
      this.updateAutoplayOffBadge(true);
      if (prev && prev.previewAutoplay === 'off' && !this.isSafeMode() && this.mode !== 'FULLSCREEN') {
        const targetCh = this.selectedChannel || this.visibleChannels[this.focusedChannelIndex];
        if (targetCh && this.player && !this.player.hls && !this.player._isNativePlayback && !this.player._isPlaying) {
          this.highlightChannel(targetCh, prefs.previewAutoplay === 'instant');
        }
      }
    }

    if (Number(prefs.autoFullscreenSec) <= 0) {
      this.cancelAutoFullscreen();
    } else if (
      prev &&
      prev.autoFullscreenSec !== prefs.autoFullscreenSec &&
      this.mode === 'BROWSE' &&
      this.focusArea === 'channels' &&
      !this.isModalOpen()
    ) {
      this.scheduleAutoFullscreen();
    }

    if (prev && prev.sleepTimeoutHours !== prefs.sleepTimeoutHours) {
      this.noteUserActivity(true);
    }

    this.renderAppearanceTab();

    if (!silent) {
      this.showToast('הגדרות העיצוב עודכנו ✓');
    }
    return prefs;
  }

  cancelPendingPreviewPlayback() {
    if (this.previewDebounceTimer) {
      clearTimeout(this.previewDebounceTimer);
      this.previewDebounceTimer = null;
    }
    this.cancelInitialPreviewTimer();
  }

  cancelInitialPreviewTimer() {
    this._pendingInitialPreviewChannel = null;
    if (this.initialPreviewTimer) {
      clearTimeout(this.initialPreviewTimer);
      this.initialPreviewTimer = null;
    }
  }

  scheduleInitialPreviewPlayback(channel, delayMs) {
    this.cancelInitialPreviewTimer();
    if (!channel || this.isSafeMode()) return;
    if (this.getUiPrefs().previewAutoplay === 'off' && this.mode !== 'FULLSCREEN') {
      this.updateAutoplayOffBadge();
      return;
    }
    const waitMs = typeof delayMs === 'number' && delayMs >= 0 ? delayMs : 1800;
    this.initialPreviewTimer = setTimeout(() => {
      this.initialPreviewTimer = null;
      if (this.isSafeMode() || !this.player) return;
      if (this.player.currentChannel) return;
      const target = this.selectedChannel || channel;
      if (target) {
        try {
          localStorage.setItem(STORAGE_KEYS.LAST_CHANNEL, target.id);
        } catch (e) {}
        this.player.play(target);
      }
    }, waitMs);
  }

  scheduleBootEPGLoad(forceRefresh) {
    if (this.isSafeMode()) return;
    if (this._deferredEpgTimer) {
      clearTimeout(this._deferredEpgTimer);
      this._deferredEpgTimer = null;
    }
    if (this.isAndroidTvWebView()) {
      this._deferredEpgTimer = setTimeout(() => {
        this._deferredEpgTimer = null;
        if (!this.isSafeMode()) {
          this.loadActiveEPGSources(Boolean(forceRefresh));
        }
      }, 2500);
    } else {
      this.loadActiveEPGSources(Boolean(forceRefresh));
    }
  }

  init() {
    window.app = this;
    try {
      this.ensureRuntimeState();
      this.ensureVodHeaderBtnDOM();
      this.ensurePowerSaveDOM();
      this.ensureVoiceDOM();
      this.ensureAppendDefaultBtnDOM();
      this.applyUiPrefs(true);
      this.loadFavorites();
      this.initPlayer();
      this.initRemote();
      this.initClock();
      this.bindDOMEvents();
      this._bindGlobalActivityListeners();
      this._startSleepMonitor();
      this.applyTheme(this.getTheme(), true);

      if (typeof OTACloudManager !== 'undefined') {
        this.otaManager = new OTACloudManager(this);
        this.otaManager.initStartupChecks();
      }

      try {
        window.focus();
        if (document.body) document.body.focus();
      } catch (e) {}

      // Populate PC Sync input if saved
      const savedPcHost = localStorage.getItem(LINEUP_KEYS.PC_SYNC_HOST);
      if (savedPcHost) {
        const pcInput = document.getElementById('pc-sync-input');
        if (pcInput) pcInput.value = savedPcHost;
      }

      // INSTANT COLD BOOT: Render immediately from cached lineup if available (< 20ms)
      const cached = this.store.loadCachedLineup();

      if (cached && cached.length > 0) {
        this.allChannels = cached;
        if (!this.isSafeMode() && !this.isAndroidTvWebView()) {
          this.loadActiveEPGSources(false);
        }
        this.applyChannelFilter();
        const startupFullscreen =
          !this.isSafeMode() &&
          !this.shouldShowFirstRunDisclaimer() &&
          this.getUiPrefs().startupMode === 'fullscreen';
        this.restoreLastWatchedChannel(startupFullscreen);
        this.updateVideoSurfacePosition(true);
        this.hideBootSplash();
        if (!this.isSafeMode() && this.isAndroidTvWebView()) {
          this.scheduleBootEPGLoad(false);
        }

        // Only refresh M3U in background if the cache TTL (24h / 3d / 7d) has expired!
        const ttlHours = this.epg.getCacheTtlHours();
        if (!this.store.isLineupCacheFresh(ttlHours)) {
          setTimeout(() => this.refreshAllSources(true), 1800);
        }
      } else {
        const splashText = document.getElementById('boot-splash-text');
        if (splashText) splashText.textContent = 'טוען רשימת ערוצים ראשונית...';
        this.refreshAllSources(false);
        this._bootSplashSafetyTimer = setTimeout(() => this.hideBootSplash(), 4500);
      }

      this.updateVideoSurfacePosition(true);
      setTimeout(() => this.updateVideoSurfacePosition(true), 150);
      window.addEventListener('resize', () => {
        if (this._resizeDebounceTimer) {
          clearTimeout(this._resizeDebounceTimer);
        }
        this._resizeDebounceTimer = setTimeout(() => {
          this._resizeDebounceTimer = null;
          this.cachedPreviewRect = null;
          this._lastVideoSurfaceKey = '';
          this.invalidateChannelListMetrics();
          this.updateVideoSurfacePosition(true);
        }, 120);
      });

      // Restore hardware audio pipeline on resume from standby, sleep, or HDMI input switch
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && this.player) {
          this.player.recoverAudioSink();
        }
      });
      document.addEventListener('webOSRelaunch', () => {
        if (this.player) {
          this.player.recoverAudioSink();
        }
      });

      if (this.otaManager && typeof this.otaManager.applySavedOTABundle === 'function') {
        this.otaManager.applySavedOTABundle();
      }
    } catch (initErr) {
      console.error('IPTVApp init error:', initErr);
      this.hideBootSplash();
    }
  }

  hideBootSplash() {
    if (this._bootSplashHidden) return;
    this._bootSplashHidden = true;
    if (this._bootSplashSafetyTimer) {
      clearTimeout(this._bootSplashSafetyTimer);
      this._bootSplashSafetyTimer = null;
    }
    if (window.dismissBootSplash) {
      window.dismissBootSplash();
    } else {
      const splash = document.getElementById('boot-splash');
      if (splash) {
        splash.classList.add('fade-out');
        splash.classList.add('hidden');
      }
    }
    if (!this._appReadyNotified && !window.__IPTV_APP_READY_NOTIFIED && window.AndroidTvHost && typeof window.AndroidTvHost.notifyAppReady === 'function') {
      this._appReadyNotified = true;
      window.__IPTV_APP_READY_NOTIFIED = true;
      try {
        window.AndroidTvHost.notifyAppReady();
      } catch (e) {}
    } else if (window.__IPTV_APP_READY_NOTIFIED) {
      this._appReadyNotified = true;
    }
    if (this._pendingInitialPreviewChannel && !this.isSafeMode() && this.isAndroidTvWebView()) {
      const pendingCh = this._pendingInitialPreviewChannel;
      this._pendingInitialPreviewChannel = null;
      if (!this.player || !this.player.currentChannel) {
        const prefs = this.getUiPrefs();
        if (prefs.previewAutoplay !== 'off' || this.mode === 'FULLSCREEN') {
          this.scheduleInitialPreviewPlayback(pendingCh, prefs.previewAutoplay === 'instant' ? 0 : 1800);
        }
      }
    }

    if (this.shouldShowFirstRunDisclaimer()) {
      this.openDisclaimerModal(false);
    } else if (this.mode === 'BROWSE' && this.focusArea === 'channels' && !this.isModalOpen()) {
      this.scheduleAutoFullscreen();
    }
  }

  /**
   * Collects both manually configured EPG URL(s) and EPG URLs auto-discovered
   * inside M3U headers (`url-tvg` / `x-tvg-url` / `tvg-url` / Xtream `xmltv.php`)
   * and loads them into EPGService.
   */
  loadActiveEPGSources(forceRefresh) {
    if (this.isSafeMode() && !forceRefresh) {
      return;
    }
    const urls = [];
    const savedEpgUrl = localStorage.getItem(STORAGE_KEYS.EPG_URL);
    if (savedEpgUrl && savedEpgUrl.trim()) {
      savedEpgUrl
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean)
        .forEach((u) => {
          if (urls.indexOf(u) === -1) urls.push(u);
        });
    }

    if (this.store && Array.isArray(this.store.discoveredEpgUrls)) {
      this.store.discoveredEpgUrls.forEach((u) => {
        if (u && urls.indexOf(u) === -1) urls.push(u);
      });
    }

    const defaultLiveEpg =
      (this.epg && this.epg.DEFAULT_LIVE_EPG_URL) ||
      'https://raw.githubusercontent.com/maorisraelii/iptv-webos/main/epg-il.xml';
    const defaultLiveEpgList =
      this.epg && Array.isArray(this.epg.DEFAULT_LIVE_EPG_URLS) && this.epg.DEFAULT_LIVE_EPG_URLS.length > 0
        ? this.epg.DEFAULT_LIVE_EPG_URLS
        : [defaultLiveEpg];

    // If no EPG URLs were discovered from playlists or custom settings, supply default fallback feeds
    if (urls.length === 0) {
      for (let i = 0; i < defaultLiveEpgList.length; i++) {
        if (defaultLiveEpgList[i] && urls.indexOf(defaultLiveEpgList[i]) === -1) {
          urls.push(defaultLiveEpgList[i]);
        }
      }
    }

    const epgInput = document.getElementById('epg-url-input');
    if (epgInput) {
      if (savedEpgUrl && savedEpgUrl.trim()) {
        epgInput.value = savedEpgUrl.trim();
      } else if (urls.length > 0 && !epgInput.value) {
        epgInput.placeholder = 'לוח שידורים פעיל אוטומטית (XMLTV)';
      }
    }

    // Safety guard: rewrite monolithic global EPG feeds (like epg.team/3.1.xml which is 307MB)
    // to lightweight curated XMLTV feed to prevent WebKit OOM crash on Smart TV hardware
    const safeUrls = [];
    for (let i = 0; i < urls.length; i++) {
      const u = urls[i];
      if (u && (u.indexOf('epg.team') !== -1 || u.indexOf('epg_ripper_ALL') !== -1)) {
        for (let j = 0; j < defaultLiveEpgList.length; j++) {
          if (defaultLiveEpgList[j]) safeUrls.push(defaultLiveEpgList[j]);
        }
      } else if (u) {
        safeUrls.push(u);
      }
    }
    const uniqueUrls = Array.from(new Set(safeUrls));

    if (uniqueUrls.length > 0 && this.epg) {
      this.epg.loadEPG(
        uniqueUrls,
        () => {
          this.refreshVisibleEPGLabels();
        },
        Boolean(forceRefresh),
        this.allChannels
      );
    }
  }

  /* --------------------------------------------------------------------------
     Player & Video Surface Management
     -------------------------------------------------------------------------- */

  initPlayer() {
    const video = document.getElementById('tv-video');
    this.player = new VideoPlayer(video, {
      onStateChange: (state) => {
        const loader = document.getElementById('video-loader');
        const errBadge = document.getElementById('video-error-badge');
        const pauseBadge = document.getElementById('video-pause-indicator');
        if (!loader || !errBadge) return;

        if (state === 'loading' || state === 'buffering' || state === 'retrying') {
          if (
            this.mode !== 'FULLSCREEN' &&
            this.getUiPrefs().previewAutoplay === 'off' &&
            (!this.player || (!this.player.hls && !this.player._isNativePlayback))
          ) {
            loader.classList.add('hidden');
            errBadge.classList.add('hidden');
            if (pauseBadge) pauseBadge.classList.add('hidden');
            return;
          }
          loader.classList.remove('hidden');
          errBadge.classList.add('hidden');
          if (pauseBadge) pauseBadge.classList.add('hidden');
        } else if (state === 'playing') {
          loader.classList.add('hidden');
          errBadge.classList.add('hidden');
          if (pauseBadge) pauseBadge.classList.add('hidden');
        } else if (state === 'paused') {
          loader.classList.add('hidden');
          if (pauseBadge) pauseBadge.classList.remove('hidden');
        } else if (state === 'error') {
          loader.classList.add('hidden');
          errBadge.classList.remove('hidden');
          if (pauseBadge) pauseBadge.classList.add('hidden');
        }
      },
      onError: (msg) => {
        this.showToast(msg, true);
      },
      getNextProgramme: (channel, currentProg, afterMs) =>
        this.epg && typeof this.epg.getNextProgrammeForChannel === 'function'
          ? this.epg.getNextProgrammeForChannel(channel, afterMs)
          : null,
      onProgrammeChanged: (channel) => {
        this.refreshVisibleEPGLabels();
        if (this.selectedChannel && channel && this.selectedChannel.id === channel.id) {
          this.updateOSD(channel, false);
          if (this.mode === 'FULLSCREEN') this.showOSD();
        }
      }
    });
    this.applyAvPrefs(true);
  }

  initRemote() {
    this.remote = new RemoteController(this);
  }

  initClock() {
    this._clockEls = {
      header: document.getElementById('clock'),
      osd: document.getElementById('osd-clock')
    };
    this.updateClock();
    clearInterval(this._clockTimer);
    this._clockTimer = setInterval(() => this.updateClock(), 15000);
  }

  updateClock() {
    const now = new Date();
    const hours = ('0' + now.getHours()).slice(-2);
    const minNum = now.getMinutes();
    const minutes = ('0' + minNum).slice(-2);
    const timeStr = hours + ':' + minutes;

    if (timeStr !== this._lastClockStr) {
      this._lastClockStr = timeStr;
      if (!this._clockEls) {
        this._clockEls = {
          header: document.getElementById('clock'),
          osd: document.getElementById('osd-clock')
        };
      }
      if (this._clockEls.header) this._clockEls.header.textContent = timeStr;
      if (this._clockEls.osd) this._clockEls.osd.textContent = timeStr;
    }

    if (minNum !== this._lastClockMinute && this._lastClockMinute !== -1) {
      this.refreshVisibleEPGLabels();
    }
    this._lastClockMinute = minNum;
  }

  updateVideoSurfacePosition(forceRecalc) {
    if (this.mode === 'FULLSCREEN' || this.isModalOpen()) {
      this.cancelAutoFullscreen();
    }
    const surface = this._videoSurfaceEl || (this._videoSurfaceEl = document.getElementById('video-surface'));
    if (!surface) return;

    const rawZoom =
      typeof document !== 'undefined' && document.documentElement && document.documentElement.style
        ? parseFloat(document.documentElement.style.zoom)
        : NaN;
    const docZoom = rawZoom > 0 ? rawZoom : 1;

    if (this.mode === 'FULLSCREEN') {
      const hasZoomDim = docZoom !== 1 && typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0;
      const wVal = hasZoomDim ? Math.ceil(window.innerWidth / docZoom) + 'px' : '100vw';
      const hVal = hasZoomDim ? Math.ceil(window.innerHeight / docZoom) + 'px' : '100vh';
      const key = 'FS|' + wVal + '|' + hVal;
      if (this._lastVideoSurfaceKey === key) return;
      this._lastVideoSurfaceKey = key;

      if (surface.classList.contains('preview-mode')) surface.classList.remove('preview-mode');
      if (!surface.classList.contains('fullscreen-mode')) surface.classList.add('fullscreen-mode');
      surface.style.left = '0px';
      surface.style.top = '0px';
      if (hasZoomDim) {
        surface.style.setProperty('width', wVal, 'important');
        surface.style.setProperty('height', hVal, 'important');
      } else {
        surface.style.removeProperty('width');
        surface.style.removeProperty('height');
        surface.style.width = '100vw';
        surface.style.height = '100vh';
      }
      surface.style.borderRadius = '0px';
      surface.style.zIndex = '100';
      return;
    }

    // READ-FIRST phase: measure #preview-frame BEFORE any class/style writes to avoid forced synchronous layout
    if (forceRecalc || !this.cachedPreviewRect) {
      const frame = this._previewFrameEl || (this._previewFrameEl = document.getElementById('preview-frame'));
      if (frame) {
        const rect = frame.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const offsetW = frame.offsetWidth;
          const scale = offsetW > 0 ? rect.width / offsetW : docZoom;
          const factor = scale > 0 ? scale : 1;
          this.cachedPreviewRect = {
            left: Math.round(rect.left / factor) + 'px',
            top: Math.round(rect.top / factor) + 'px',
            width: Math.round(rect.width / factor) + 'px',
            height: Math.round(rect.height / factor) + 'px'
          };
        }
      }
    }

    const zIndexVal = this.isModalOpen() ? '5' : '30';
    const r = this.cachedPreviewRect;
    const key = r
      ? 'PV|' + zIndexVal + '|' + r.left + '|' + r.top + '|' + r.width + '|' + r.height
      : 'PV|' + zIndexVal + '|none';
    if (this._lastVideoSurfaceKey === key) return;
    this._lastVideoSurfaceKey = key;

    // WRITE-ONLY phase
    if (surface.classList.contains('fullscreen-mode')) surface.classList.remove('fullscreen-mode');
    if (!surface.classList.contains('preview-mode')) surface.classList.add('preview-mode');
    surface.style.zIndex = zIndexVal;

    if (r) {
      surface.style.left = r.left;
      surface.style.top = r.top;
      surface.style.width = r.width;
      surface.style.height = r.height;
      surface.style.removeProperty('border-radius');
    } else {
      surface.style.removeProperty('width');
      surface.style.removeProperty('height');
    }
  }

  /* --------------------------------------------------------------------------
     Multi-M3U Loading & Lineup Compilation
     -------------------------------------------------------------------------- */

  refreshAllSources(silentBackground, opts) {
    const keepModalOpen = Boolean(opts && opts.keepModalOpen);
    const statusText = document.getElementById('settings-status-text');
    if (!silentBackground) {
      if (statusText) statusText.textContent = 'מוריד וממזג רשימות ערוצים...';
    }

    this.store
      .fetchAllSources()
      .then((res) => {
        if (!res.compiledChannels || res.compiledChannels.length === 0) {
          if (res.hadSourceError && Array.isArray(this.allChannels) && this.allChannels.length > 0) {
            if (!silentBackground) {
              this.showToast('שגיאה ברענון מקורות M3U — נשמרה רשימת הערוצים השמורה');
              if (statusText) statusText.textContent = 'שגיאה בטעינה — נשמרה הרשימה הקיימת.';
              this.hideBootSplash();
            }
            this.scheduleBootEPGLoad(false);
            return;
          }
          if (!silentBackground) {
            this.allChannels = [];
            this.applyChannelFilter();
            this.showToast('לא נמצאו ערוצים פעילים במקורות ה-M3U');
            if (statusText) statusText.textContent = 'לא נמצאו ערוצים פעילים.';
            this.hideBootSplash();
          }
          this.scheduleBootEPGLoad(false);
          return;
        }

        this.allChannels = res.compiledChannels;
        if (statusText) {
          statusText.textContent =
            'נטענו בהצלחה ' +
            this.allChannels.length +
            ' ערוצים מתוך ' +
            this.store.sources.length +
            ' מקורות M3U.';
        }

        if (!silentBackground && !keepModalOpen) {
          this.onlyFavorites = false;
          this.applyChannelFilter();
          const shouldFullscreen =
            !this.isSafeMode() &&
            !this.shouldShowFirstRunDisclaimer() &&
            this.getUiPrefs().startupMode === 'fullscreen';
          this.restoreLastWatchedChannel(shouldFullscreen);
          this.updateVideoSurfacePosition();
          this.hideBootSplash();
          // Load EPG after initial channel list paints (skipped in Safe Mode, deferred 2500ms on Android TV)
          this.scheduleBootEPGLoad(false);
        } else {
          if (!this.isSafeMode()) {
            this.loadActiveEPGSources(false);
          }
          // Silent/in-modal update: preserve current channel & focus index
          const curId = this.selectedChannel ? this.selectedChannel.id : null;
          this.applyChannelFilter();
          if (curId) {
            const idx = this.visibleChannels.findIndex((c) => c.id === curId);
            if (idx !== -1) {
              this.focusedChannelIndex = idx;
              if (this.focusArea === 'channels' && !this.isModalOpen()) {
                this.updateChannelFocusFast();
              }
            }
          }
        }
      })
      .catch((err) => {
        console.warn('refreshAllSources error:', err);
        if (!silentBackground) {
          this.applyChannelFilter();
          this.hideBootSplash();
          this.showToast('שגיאה בטעינת מקורות M3U. בדוק את ההגדרות.');
          if (statusText) statusText.textContent = 'שגיאה: ' + err.message;
        }
      });
  }

  restoreLastWatchedChannel(openFullscreen = false) {
    const lastChId = localStorage.getItem(STORAGE_KEYS.LAST_CHANNEL);
    const startIdx = this.visibleChannels.findIndex((c) => c.id === lastChId);
    this.focusedChannelIndex = startIdx !== -1 ? startIdx : 0;

    if (!this.isModalOpen()) {
      this.updateChannelFocusFast();
    }
    const startCh = this.visibleChannels[this.focusedChannelIndex];
    if (startCh) {
      const prefs = this.getUiPrefs();
      if (this.isSafeMode()) {
        this.cancelInitialPreviewTimer();
        this.highlightChannel(startCh, false, true);
        this.updateAutoplayOffBadge();
        return;
      }
      if (prefs.previewAutoplay === 'off' && !openFullscreen) {
        this.cancelPendingPreviewPlayback();
        this.highlightChannel(startCh, false, true);
        this.updateAutoplayOffBadge();
        if (this._bootSplashHidden && this.mode === 'BROWSE' && this.focusArea === 'channels' && !this.isModalOpen()) {
          this.scheduleAutoFullscreen();
        }
        return;
      }
      if (this.isAndroidTvWebView() && !openFullscreen) {
        this.highlightChannel(startCh, false, true);
        if (this._bootSplashHidden) {
          this.scheduleInitialPreviewPlayback(startCh, prefs.previewAutoplay === 'instant' ? 0 : 1800);
        } else {
          this._pendingInitialPreviewChannel = startCh;
        }
      } else {
        this.highlightChannel(startCh, Boolean(openFullscreen) || prefs.previewAutoplay === 'instant');
      }
      if (openFullscreen) {
        this.enterFullscreen();
      } else if (this._bootSplashHidden && this.mode === 'BROWSE' && this.focusArea === 'channels' && !this.isModalOpen()) {
        this.scheduleAutoFullscreen();
      }
    }
    this.updateAutoplayOffBadge();
  }

  /* --------------------------------------------------------------------------
     Channel List Filtering & Fast O(1) Rendering
     -------------------------------------------------------------------------- */

  getChannelMonogram(channel) {
    if (!channel) return 'TV';
    const name = channel.name || '';
    const numMatch = name.match(/\b(11|12|13|14|15|24|9)\b/);
    if (numMatch) return numMatch[1];
    if (name.indexOf('כאן') !== -1) return '11';
    if (name.indexOf('קשת') !== -1) return '12';
    if (name.indexOf('רשת') !== -1) return '13';
    if (name.indexOf('עכשיו') !== -1) return '14';
    if (name.toLowerCase().indexOf('i24') !== -1) return 'i24';
    return String(channel.number || 'TV');
  }

  toggleFavoritesFilter() {
    this.onlyFavorites = !this.onlyFavorites;
    this.applyChannelFilter();
  }

  applyChannelFilter() {
    const titleEl = document.getElementById('active-category-title');
    const countEl = document.getElementById('channel-list-count');
    const filterBtn = document.getElementById('btn-filter-favs');
    const filterLabel = document.getElementById('filter-favs-label');

    if (this.onlyFavorites) {
      this.visibleChannels = this.allChannels.filter((c) => this.favorites.has(c.id));
      if (titleEl) titleEl.textContent = 'ערוצים מועדפים ★';
      if (filterBtn) filterBtn.classList.add('active-filter');
      if (filterLabel) filterLabel.textContent = 'כל הערוצים';
    } else {
      this.visibleChannels = this.allChannels.slice();
      if (titleEl) titleEl.textContent = 'כל הערוצים';
      if (filterBtn) filterBtn.classList.remove('active-filter');
      if (filterLabel) filterLabel.textContent = 'מועדפים';
    }

    if (countEl) {
      countEl.textContent = this.visibleChannels.length + ' ערוצים';
    }

    this.focusedChannelIndex = 0;
    if (this.selectedChannel) {
      const idx = this.visibleChannels.findIndex((c) => c.id === this.selectedChannel.id);
      if (idx !== -1) this.focusedChannelIndex = idx;
    }

    this.renderChannelList();
    if (this.visibleChannels.length === 0) {
      this.cancelAutoFullscreen();
    }
    if (this.focusArea === 'channels' && !this.isModalOpen()) {
      this.updateChannelFocusFast();
    }
  }

  getChannelRowEPGMetrics(ch) {
    const epgInfo = this.epg ? this.epg.getNowNext(ch) : null;
    const cur = epgInfo && epgInfo.current ? epgInfo.current : null;
    const title = cur ? cur.title : 'שידור ישיר';
    let timeRange = '';
    let pct = 0;
    let remText = '';
    let isEndingSoon = false;

    if (cur) {
      if (cur.startStr && cur.stopStr) {
        timeRange = cur.startStr + ' - ' + cur.stopStr;
      } else if (cur.start && (cur.stop || cur.end) && this.epg) {
        timeRange = this.epg.formatTime(cur.start) + ' - ' + this.epg.formatTime(cur.stop || cur.end);
      }

      pct =
        typeof cur.progressPercent === 'number'
          ? cur.progressPercent
          : cur.startMs && cur.stopMs
          ? Math.max(
              0,
              Math.min(100, Math.round(((Date.now() - cur.startMs) / Math.max(60000, cur.stopMs - cur.startMs)) * 100))
            )
          : 0;

      const remMin =
        typeof cur.remainingMin === 'number'
          ? cur.remainingMin
          : cur.stopMs
          ? Math.max(1, Math.ceil((cur.stopMs - Date.now()) / 60000))
          : 15;

      isEndingSoon = pct >= 85 || (remMin > 0 && remMin <= 5);
      if (remMin <= 1) {
        remText = 'דקה אחרונה!';
      } else if (isEndingSoon) {
        remText = 'מסתיים בקרוב • ' + remMin + ' דק׳';
      } else {
        remText = 'נותרו ' + remMin + ' דק׳';
      }
    }
    return {
      title: title,
      timeRange: timeRange,
      pct: pct,
      remText: remText,
      isEndingSoon: isEndingSoon
    };
  }

  _handleRowLogoLoad() {
    if (this.naturalWidth > 2) {
      this.style.display = 'block';
      if (this.nextElementSibling) this.nextElementSibling.style.display = 'none';
    }
  }

  _handleRowLogoError() {
    this.style.display = 'none';
    if (this.nextElementSibling) this.nextElementSibling.style.display = 'block';
  }

  _getChannelRowTemplate() {
    if (this._rowTemplate) return this._rowTemplate;
    const tpl = document.createElement('div');
    tpl.className = 'channel-item focusable';
    tpl.innerHTML =
      '<span class="channel-number"></span>' +
      '<div class="channel-logo-thumb">' +
        '<span class="channel-thumb-placeholder"></span>' +
      '</div>' +
      '<div class="channel-text-col">' +
        '<div class="channel-row-top">' +
          '<span class="channel-title"></span>' +
          '<span class="channel-epg-sub"></span>' +
        '</div>' +
        '<div class="channel-mini-bar-row">' +
          '<span class="channel-mini-time"></span>' +
          '<div class="channel-mini-progress-track">' +
            '<div class="channel-mini-progress-fill"></div>' +
          '</div>' +
          '<span class="channel-mini-rem-badge"></span>' +
        '</div>' +
      '</div>' +
      '<span class="channel-ok-pill">לחץ OK למעבר</span>';
    this._rowTemplate = tpl;
    return tpl;
  }

  _getSharedPlayingBadge() {
    if (!this._sharedPlayingBadgeEl) {
      const badge = document.createElement('span');
      badge.className = 'channel-playing-badge';
      badge.textContent = 'מתנגן ▶';
      this._sharedPlayingBadgeEl = badge;
    }
    return this._sharedPlayingBadgeEl;
  }

  createChannelRowElement(ch, idx) {
    const item = this._getChannelRowTemplate().cloneNode(true);
    const isSelected = Boolean(this.selectedChannel && this.selectedChannel.id === ch.id);
    if (isSelected) {
      item.className = 'channel-item focusable active';
      this.currentActiveRowEl = item;
    }
    item.dataset.index = idx;
    item.dataset.channelId = ch.id;

    const isFav = this.favorites.has(ch.id);
    const epgMetrics = this.getChannelRowEPGMetrics(ch);
    const monogram = this.getChannelMonogram(ch);

    const children = item.children;
    const numEl = children[0];
    const logoWrap = children[1];
    const textCol = children[2];
    const okPill = children[3];

    numEl.textContent = ch.number;

    const placeholderEl = logoWrap.firstChild;
    placeholderEl.textContent = monogram;
    const showLogos =
      typeof this._renderingShowRowLogos === 'boolean'
        ? this._renderingShowRowLogos
        : this.getUiPrefs().showRowLogos !== false;
    if (ch.logo && showLogos) {
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.style.display = 'none';
      img.onload = this._handleRowLogoLoad;
      img.onerror = this._handleRowLogoError;
      img.src = ch.logo;
      logoWrap.insertBefore(img, placeholderEl);
    }

    const rowTop = textCol.children[0];
    const titleEl = rowTop.children[0];
    const epgSubEl = rowTop.children[1];
    titleEl.textContent = ch.name;
    epgSubEl.textContent = epgMetrics.title;

    const barRow = textCol.children[1];
    const epgTimeEl = barRow.children[0];
    const epgFillEl = barRow.children[1].firstChild;
    const epgRemEl = barRow.children[2];

    epgTimeEl.textContent = epgMetrics.timeRange;
    epgFillEl.style.width = epgMetrics.pct + '%';
    epgRemEl.textContent = epgMetrics.remText;
    if (epgMetrics.isEndingSoon) {
      epgFillEl.className = 'channel-mini-progress-fill ending-soon';
      epgRemEl.className = 'channel-mini-rem-badge ending-soon';
    }

    if (this.hasCatchupSupport(ch)) {
      const vodBadge = document.createElement('span');
      vodBadge.className = 'channel-vod-badge';
      const days = typeof ch.catchupDays === 'number' && ch.catchupDays > 0 ? ch.catchupDays : 7;
      vodBadge.textContent = 'VOD ' + days + 'd';
      item.insertBefore(vodBadge, okPill);
    }

    if (isFav) {
      const starEl = document.createElement('span');
      starEl.className = 'channel-fav-star';
      starEl.textContent = '★';
      item.insertBefore(starEl, okPill);
    }

    if (isSelected) {
      item.insertBefore(this._getSharedPlayingBadge(), okPill);
      okPill.textContent = 'מתנגן • OK למסך מלא ▶';
    }

    // Cache direct child references (zero querySelector calls on ticks or focus/active toggles)
    item._epgSub = epgSubEl;
    item._epgTime = epgTimeEl;
    item._epgFill = epgFillEl;
    item._epgRem = epgRemEl;
    item._okPill = okPill;
    item._lastEpgTitle = epgMetrics.title;
    item._lastEpgTime = epgMetrics.timeRange;
    item._lastEpgPct = epgMetrics.pct;
    item._lastEpgRem = epgMetrics.remText;
    item._lastEpgEnding = epgMetrics.isEndingSoon;
    item._epgEpoch = this._epgRefreshEpoch || 0;

    return item;
  }

  invalidateChannelListMetrics() {
    this._cachedRowHeight = 0;
    this._cachedRowBoxHeight = 0;
    this._cachedListHeight = 0;
  }

  measureChannelListMetrics(listEl) {
    const container = listEl || this._channelListEl || document.getElementById('channel-list');
    if (!container) return;
    this._channelListEl = container;
    const h = container.clientHeight;
    if (h > 0) {
      this._cachedListHeight = h;
    }
    const rows = this._channelRowEls || this.channelRowNodes || [];
    if (rows && rows.length > 0) {
      const firstRow = rows[0];
      const firstTop = firstRow.offsetTop;
      const firstBoxH = firstRow.offsetHeight;
      if (firstBoxH > 0) {
        this._cachedRowBoxHeight = firstBoxH;
        this._cachedListPaddingTop = firstTop;
        if (rows.length > 1) {
          const pitch = rows[1].offsetTop - firstTop;
          this._cachedRowHeight = pitch > 0 ? pitch : firstBoxH + 10;
        } else {
          this._cachedRowHeight = firstBoxH + 10;
        }
      }
    }
  }

  getVisibleChannelIndexRange(bufferRows) {
    const rows = this._channelRowEls || this.channelRowNodes || [];
    const total = rows.length;
    if (total === 0) return { start: 0, end: -1 };
    const buf = typeof bufferRows === 'number' ? bufferRows : 4;
    const rowPitch = this._cachedRowHeight > 0 ? this._cachedRowHeight : 108;
    const viewHeight = this._cachedListHeight > 0 ? this._cachedListHeight : 820;
    const padTop = this._cachedListPaddingTop >= 0 ? this._cachedListPaddingTop : 14;
    const scrollTop = this._cachedListScrollTop >= 0 ? this._cachedListScrollTop : 0;
    const firstVisible = Math.floor(Math.max(0, scrollTop - padTop) / rowPitch);
    const visibleCount = Math.ceil(viewHeight / rowPitch) + 1;
    return {
      start: Math.max(0, firstVisible - buf),
      end: Math.min(total - 1, firstVisible + visibleCount + buf)
    };
  }

  _scheduleVisibleEpgWindowSync() {
    if (this._visibleEpgSyncTimer) {
      clearTimeout(this._visibleEpgSyncTimer);
    }
    this._visibleEpgSyncTimer = setTimeout(() => {
      this._visibleEpgSyncTimer = null;
      this.syncStaleVisibleEPGRows();
    }, 140);
  }

  syncStaleVisibleEPGRows() {
    const rows = this._channelRowEls || this.channelRowNodes || [];
    const total = rows.length;
    if (total === 0 || !Array.isArray(this.visibleChannels)) return;
    const epoch = this._epgRefreshEpoch || 0;
    const range = this.getVisibleChannelIndexRange(4);
    for (let i = range.start; i <= range.end; i++) {
      const row = rows[i];
      if (row && row._epgEpoch !== epoch) {
        this.updateRowEPGDom(row, this.visibleChannels[i]);
      }
    }
  }

  renderChannelList() {
    const listEl = this._channelListEl || (this._channelListEl = document.getElementById('channel-list'));
    if (!listEl) return;
    if (this._focusFlushRafId && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(this._focusFlushRafId);
      this._focusFlushRafId = null;
      this._focusFlushPending = false;
    }
    this._renderJobId = (this._renderJobId || 0) + 1;
    listEl.innerHTML = '';
    this.channelRowNodes = [];
    this._channelRowEls = this.channelRowNodes;
    this._channelIndexById = Object.create(null);
    this.currentActiveRowEl = null;
    this._focusedChannelEl = null;
    this._cachedListScrollTop = 0;
    listEl.scrollTop = 0;
    this.invalidateChannelListMetrics();

    if (this.visibleChannels.length === 0) {
      listEl.innerHTML =
        '<div class="empty-state-card">' +
          '<div class="empty-state-icon">' + (this.onlyFavorites ? '★' : '📺') + '</div>' +
          '<div class="empty-state-title">' +
            (this.onlyFavorites ? 'רשימת המועדפים ריקה כעת' : 'אין ערוצים להצגה') +
          '</div>' +
          '<div class="empty-state-desc">' +
            (this.onlyFavorites
              ? 'בחר ערוץ ולחץ על "הוסף למועדפים" בסרגל העליון כדי לשמור אותו כאן.'
              : 'לחץ על "הגדרות ו-M3U" בסרגל העליון להוספת פלייליסט או סנכרון מהטלפון.') +
          '</div>' +
        '</div>';
      return;
    }

    const total = this.visibleChannels.length;
    this._renderingShowRowLogos = this.getUiPrefs().showRowLogos !== false;
    const frag = document.createDocumentFragment();
    try {
      for (let idx = 0; idx < total; idx++) {
        const ch = this.visibleChannels[idx];
        const item = this.createChannelRowElement(ch, idx);
        this._channelRowEls.push(item);
        this._channelIndexById[ch.id] = idx;
        frag.appendChild(item);
      }
    } finally {
      this._renderingShowRowLogos = null;
    }
    // Single DocumentFragment DOM append (1 layout instead of N chunked appends)
    listEl.appendChild(frag);
    this.measureChannelListMetrics(listEl);
  }

  updateRowEPGDom(row, ch) {
    if (!row || !ch) return;
    row._epgEpoch = this._epgRefreshEpoch || 0;
    const epgMetrics = this.getChannelRowEPGMetrics(ch);

    if (row._epgSub && row._lastEpgTitle !== epgMetrics.title) {
      row._lastEpgTitle = epgMetrics.title;
      row._epgSub.textContent = epgMetrics.title;
    }
    if (row._epgTime && row._lastEpgTime !== epgMetrics.timeRange) {
      row._lastEpgTime = epgMetrics.timeRange;
      row._epgTime.textContent = epgMetrics.timeRange;
    }
    if (row._epgFill && row._lastEpgPct !== epgMetrics.pct) {
      row._lastEpgPct = epgMetrics.pct;
      row._epgFill.style.width = epgMetrics.pct + '%';
    }
    if (row._epgRem && row._lastEpgRem !== epgMetrics.remText) {
      row._lastEpgRem = epgMetrics.remText;
      row._epgRem.textContent = epgMetrics.remText;
    }
    if (row._lastEpgEnding !== epgMetrics.isEndingSoon) {
      row._lastEpgEnding = epgMetrics.isEndingSoon;
      if (row._epgFill) row._epgFill.classList.toggle('ending-soon', epgMetrics.isEndingSoon);
      if (row._epgRem) row._epgRem.classList.toggle('ending-soon', epgMetrics.isEndingSoon);
    }
  }

  refreshVisibleEPGLabels() {
    const rows = this._channelRowEls || this.channelRowNodes || [];
    const total = rows.length;
    this._epgRefreshEpoch = (this._epgRefreshEpoch || 0) + 1;
    if (total > 0 && Array.isArray(this.visibleChannels)) {
      if (!(this._cachedRowHeight > 0) || !(this._cachedListHeight > 0)) {
        this.measureChannelListMetrics();
      }
      const range = this.getVisibleChannelIndexRange(4);
      for (let i = range.start; i <= range.end; i++) {
        this.updateRowEPGDom(rows[i], this.visibleChannels[i]);
      }
    }
    const visible = Array.isArray(this.visibleChannels) ? this.visibleChannels : [];
    const previewCh = visible[this.focusedChannelIndex] || this.selectedChannel;
    if (previewCh) {
      this.updateEPGUI(previewCh, false);
    }
  }

  /* --------------------------------------------------------------------------
     Channel Selection (Only on OK) & Info Preview (On Up/Down Navigation)
     -------------------------------------------------------------------------- */

  /**
   * Updates the left-side Channel Details & EPG Synopsis card when navigating Up/Down
   * WITHOUT switching the playing video stream.
   */
  schedulePreviewChannelInfo(channel) {
    if (!channel) return;
    clearTimeout(this.previewTimer);
    if (this._miniTimelineTimer) {
      clearTimeout(this._miniTimelineTimer);
      this._miniTimelineTimer = null;
    }
    const prefDebounce = this.getZapDebounceMs();
    if (prefDebounce === 0) {
      this.previewTimer = null;
      this.previewChannelInfo(channel, false);
      return;
    }
    const delayMs = prefDebounce > 0 ? prefDebounce : (this.isTvPlatform() ? 120 : 85);
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      this.previewChannelInfo(channel, true);
    }, delayMs);
  }

  _setPreviewText(key, el, val) {
    if (!this._previewHeaderCache) this._previewHeaderCache = Object.create(null);
    const str = val == null ? '' : String(val);
    if (el && this._previewHeaderCache[key] !== str) {
      this._previewHeaderCache[key] = str;
      el.textContent = str;
    }
  }

  previewChannelInfo(channel, deferTimeline) {
    if (!channel) return;
    if (!this._previewHeaderCache) this._previewHeaderCache = Object.create(null);
    clearTimeout(this.previewTimer);
    this.previewTimer = null;
    this.previewedChannel = channel;

    const numEl = document.getElementById('preview-channel-num');
    const nameEl = document.getElementById('preview-channel-name');
    const catEl = document.getElementById('preview-channel-category');
    const srcEl = document.getElementById('preview-channel-source');
    this._setPreviewText('num', numEl, 'ערוץ ' + channel.number);
    this._setPreviewText('name', nameEl, channel.name);
    this._setPreviewText('cat', catEl, channel.group || 'טלוויזיה חיה');
    this._setPreviewText('src', srcEl, channel.sourceName || 'פלייליסט ראשי');

    const playStatusEl = document.getElementById('preview-playing-status');
    if (playStatusEl) {
      const isCatchupHere = Boolean(
        this.player &&
        this.player.currentProgramme &&
        this.player.currentChannel &&
        this.player.currentChannel.id === channel.id
      );
      if (this._previewHeaderCache.isCatchup !== isCatchupHere) {
        this._previewHeaderCache.isCatchup = isCatchupHere;
        playStatusEl.textContent = isCatchupHere ? 'סטארט אובר' : 'שידור חי';
        playStatusEl.classList.toggle('catchup-mode', isCatchupHere);
      }
    }

    const logoImg = document.getElementById('preview-channel-logo');
    const logoPlaceholder = document.getElementById('preview-channel-placeholder');
    if (logoImg && logoPlaceholder) {
      const showLogos = this.getUiPrefs().showRowLogos !== false;
      const nextLogo = showLogos ? (channel.logo || '') : '';
      const nextKey = (showLogos ? '1|' : '0|') + nextLogo;
      if (logoImg.dataset.loadedSrc !== nextKey) {
        logoImg.dataset.loadedSrc = nextKey;
        logoPlaceholder.textContent = this.getChannelMonogram(channel);
        logoImg.classList.add('hidden');
        logoPlaceholder.classList.remove('hidden');
        if (nextLogo) {
          logoImg.onload = () => {
            if (logoImg.naturalWidth > 2) {
              logoImg.classList.remove('hidden');
              logoPlaceholder.classList.add('hidden');
            }
          };
          logoImg.onerror = () => {
            logoImg.classList.add('hidden');
            logoPlaceholder.classList.remove('hidden');
          };
          logoImg.src = nextLogo;
        } else {
          logoImg.onload = null;
          logoImg.onerror = null;
          logoImg.removeAttribute('src');
        }
      }
    }

    this.updateFavoriteButtonUI(channel);
    this.updateEPGUI(channel, Boolean(deferTimeline));
  }

  /**
   * Switches the active playing video stream to `channel` (triggered on OK press or initial boot).
   */
  highlightChannel(channel, immediatePlay, skipPlayback) {
    if (!channel) return;
    this.selectedChannel = channel;
    this.previewedChannel = channel;

    // Update previous active row pill & class (O(1), zero querySelector)
    if (this.currentActiveRowEl) {
      this.currentActiveRowEl.classList.remove('active');
      const oldPill = this.currentActiveRowEl._okPill || this.currentActiveRowEl.querySelector('.channel-ok-pill');
      if (oldPill) oldPill.textContent = 'לחץ OK למעבר';
    }

    const rows = this._channelRowEls || this.channelRowNodes || [];
    const indexMap = this._channelIndexById || (this._channelIndexById = Object.create(null));
    let newActiveRow = rows[this.focusedChannelIndex];
    if (!newActiveRow || newActiveRow.dataset.channelId !== channel.id) {
      const mappedIdx = indexMap[channel.id];
      if (typeof mappedIdx === 'number') {
        newActiveRow = rows[mappedIdx];
      }
    }
    if (newActiveRow) {
      newActiveRow.classList.add('active');
      const newPill = newActiveRow._okPill || newActiveRow.querySelector('.channel-ok-pill');
      const sharedBadge = this._getSharedPlayingBadge();
      if (sharedBadge.parentNode !== newActiveRow) {
        newActiveRow.insertBefore(sharedBadge, newPill || null);
      }
      if (newPill) newPill.textContent = 'מתנגן • OK למסך מלא ▶';
      this.currentActiveRowEl = newActiveRow;
    }

    this.previewChannelInfo(channel, false);

    this.endSeekHold();
    this._activeSeekSpeedLabel = '';
    clearTimeout(this._seekBadgeClearTimer);

    const catchupBadge = document.getElementById('video-catchup-badge');
    if (catchupBadge) catchupBadge.classList.add('hidden');

    const hintRedLabel = document.getElementById('hint-red-label') || document.querySelector('#hint-red span:last-child');
    if (hintRedLabel) {
      hintRedLabel.textContent = 'סטארט אובר (מההתחלה)';
    }

    if (this.mode === 'FULLSCREEN') {
      this.updateOSD(channel, false);
    } else if (this.mode === 'SETTINGS' && this.activeSettingsTab === 'av') {
      this.renderAvTab();
    }

    const prefs = this.getUiPrefs();
    const autoplayMode = prefs.previewAutoplay || 'delayed';

    this.cancelPendingPreviewPlayback();
    if (skipPlayback === true) {
      this.updateAutoplayOffBadge();
      return;
    }
    if (autoplayMode === 'off' && this.mode !== 'FULLSCREEN' && immediatePlay !== true) {
      if (this.player && typeof this.player.stop === 'function') {
        this.player.stop();
      }
      const loader = document.getElementById('video-loader');
      const errBadge = document.getElementById('video-error-badge');
      const pauseBadge = document.getElementById('video-pause-indicator');
      if (loader) loader.classList.add('hidden');
      if (errBadge) errBadge.classList.add('hidden');
      if (pauseBadge) pauseBadge.classList.add('hidden');
      this.updateAutoplayOffBadge();
      return;
    }
    if (immediatePlay === true) {
      try {
        localStorage.setItem(STORAGE_KEYS.LAST_CHANNEL, channel.id);
      } catch (e) {}
      this.updateAutoplayOffBadge(true);
      this.player.play(channel);
    } else if (!this.isSafeMode()) {
      const prefDebounce = typeof prefs.zapDebounceMs === 'number' ? prefs.zapDebounceMs : 120;
      const debounceMs = autoplayMode === 'instant' ? 0 : prefDebounce;
      if (debounceMs === 0) {
        try {
          localStorage.setItem(STORAGE_KEYS.LAST_CHANNEL, channel.id);
        } catch (e) {}
        this.updateAutoplayOffBadge(true);
        this.player.play(channel);
      } else {
        this.previewDebounceTimer = setTimeout(() => {
          this.previewDebounceTimer = null;
          try {
            localStorage.setItem(STORAGE_KEYS.LAST_CHANNEL, channel.id);
          } catch (e) {}
          this.updateAutoplayOffBadge(true);
          this.player.play(channel);
        }, debounceMs);
      }
    }
    this.updateAutoplayOffBadge();
  }

  updateEPGUI(channel, deferTimeline) {
    if (!channel || !this.epg) return;
    const epgData = this.epg.getNowNext(channel);
    if (epgData && epgData.current) {
      this.displaySynopsisForProgramme(epgData.current);
    }

    // Populate Previous & Next programme with Start & End times in Main EPG Box (dirty-checked)
    const prevTitleEl = document.getElementById('preview-epg-prev-title');
    const prevTimeEl = document.getElementById('preview-epg-prev-time');
    const nextTitleEl = document.getElementById('preview-epg-next-title');
    const nextTimeEl = document.getElementById('preview-epg-next-time');

    if (epgData && epgData.previous) {
      this._setPreviewText('prevTitle', prevTitleEl, epgData.previous.title);
      this._setPreviewText('prevTime', prevTimeEl, epgData.previous.startStr + ' - ' + epgData.previous.stopStr);
    }
    if (epgData && epgData.next) {
      this._setPreviewText('nextTitle', nextTitleEl, epgData.next.title);
      this._setPreviewText('nextTime', nextTimeEl, epgData.next.startStr + ' - ' + epgData.next.stopStr);
    }

    // Debounce Mini Timeline Strip DOM re-renders (~120ms) during rapid channel scrolling
    if (deferTimeline === true) {
      this.scheduleMiniTimelineRender(channel);
    } else {
      if (this._miniTimelineTimer) {
        clearTimeout(this._miniTimelineTimer);
        this._miniTimelineTimer = null;
      }
      this._pendingMiniTimelineChannel = null;
      this.renderMiniTimelineStrip(channel);
    }
  }

  scheduleMiniTimelineRender(channel) {
    if (!channel) return;
    const prefDebounce = this.getZapDebounceMs();
    if (prefDebounce === 0) {
      if (this._miniTimelineTimer) {
        clearTimeout(this._miniTimelineTimer);
        this._miniTimelineTimer = null;
      }
      this._pendingMiniTimelineChannel = null;
      this.renderMiniTimelineStrip(channel);
      return;
    }
    this._pendingMiniTimelineChannel = channel;
    if (this._miniTimelineTimer) {
      clearTimeout(this._miniTimelineTimer);
    }
    this._miniTimelineTimer = setTimeout(() => {
      this._miniTimelineTimer = null;
      const target = this._pendingMiniTimelineChannel;
      this._pendingMiniTimelineChannel = null;
      if (target) {
        this.renderMiniTimelineStrip(target);
      }
    }, prefDebounce);
  }

  flushPendingMiniTimeline() {
    if (this._miniTimelineTimer) {
      clearTimeout(this._miniTimelineTimer);
      this._miniTimelineTimer = null;
    }
    const target = this._pendingMiniTimelineChannel;
    this._pendingMiniTimelineChannel = null;
    if (target) {
      this.renderMiniTimelineStrip(target);
    }
  }

  displaySynopsisForProgramme(prog) {
    if (!prog) return;
    if (!this._previewHeaderCache) this._previewHeaderCache = Object.create(null);
    const badgeEl = document.getElementById('preview-epg-badge');
    const titleEl = document.getElementById('preview-epg-title');
    const timeEl = document.getElementById('preview-epg-time');
    const progressEl = document.getElementById('preview-epg-progress');
    const descEl = document.getElementById('preview-epg-desc');

    if (badgeEl) {
      const nextStatus = prog.status || 'live';
      if (this._previewHeaderCache.synBadgeStatus !== nextStatus) {
        this._previewHeaderCache.synBadgeStatus = nextStatus;
        if (nextStatus === 'past') {
          badgeEl.textContent = 'שודר קודם • לחץ OK לסטארט אובר';
          badgeEl.classList.add('past-mode');
        } else if (nextStatus === 'upcoming') {
          badgeEl.textContent = 'ישודר בהמשך';
          badgeEl.classList.remove('past-mode');
        } else {
          badgeEl.textContent = 'משודר כעת';
          badgeEl.classList.remove('past-mode');
        }
      }
    }
    this._setPreviewText('synTitle', titleEl, prog.title);
    this._setPreviewText('synTime', timeEl, prog.startStr + ' - ' + prog.stopStr);
    if (progressEl) {
      const pctStr =
        (typeof prog.progressPercent === 'number' ? prog.progressPercent : (prog.status === 'past' ? 100 : 0)) + '%';
      if (this._previewHeaderCache.synPct !== pctStr) {
        this._previewHeaderCache.synPct = pctStr;
        progressEl.style.width = pctStr;
      }
    }
    this._setPreviewText('synDesc', descEl, prog.desc || 'שידור ישיר בערוץ.');
  }

  renderMiniTimelineStrip(channel) {
    const stripEl = document.getElementById('channel-program-strip');
    if (!stripEl || !this.epg) return;
    this.timelineProgrammes = this.epg.getMiniTimeline(channel);

    let liveIdx = 0;
    let sig = channel ? String(channel.id) : '';
    for (let i = 0; i < this.timelineProgrammes.length; i++) {
      const p = this.timelineProgrammes[i];
      if (p) {
        if (p.status === 'live') liveIdx = i;
        sig += '|' + p.status + ':' + p.startStr + '-' + p.stopStr + ':' + p.title;
      } else {
        sig += '|none';
      }
    }
    this.focusedTimelineIndex = liveIdx;

    if (this.timelineItemNodes.length === 5 && this._lastMiniTimelineSig === sig) {
      return;
    }
    this._lastMiniTimelineSig = sig;

    if (this.timelineItemNodes.length !== 5) {
      stripEl.innerHTML = '';
      this.timelineItemNodes = [];
      const frag = document.createDocumentFragment();
      for (let i = 0; i < 5; i++) {
        const card = document.createElement('div');
        card.className = 'program-strip-item';
        card.dataset.index = i;
        card.innerHTML =
          '<div class="strip-item-top">' +
            '<span class="strip-item-time"></span>' +
            '<span class="strip-item-tag"></span>' +
          '</div>' +
          '<div class="strip-item-title"></div>';

        card.addEventListener('click', () => {
          const p = this.timelineProgrammes[i];
          if (!p) return;
          this.focusArea = 'timeline';
          this.focusedTimelineIndex = i;
          this.updateTimelineFocusFast();
          this.activateTimelineProgramme(p);
        });

        this.timelineItemNodes.push(card);
        frag.appendChild(card);
      }
      stripEl.appendChild(frag);
    }

    for (let i = 0; i < 5; i++) {
      const card = this.timelineItemNodes[i];
      const p = this.timelineProgrammes[i];
      if (!p) {
        if (card.style.display !== 'none') card.style.display = 'none';
        continue;
      }
      if (card.style.display !== '') card.style.display = '';
      const nextCardClass = 'program-strip-item status-' + p.status;
      if (card.className !== nextCardClass) card.className = nextCardClass;

      const timeNode = card.firstChild.firstChild;
      const tagNode = card.firstChild.lastChild;
      const titleNode = card.lastChild;

      timeNode.textContent = p.startStr + ' - ' + p.stopStr;
      titleNode.textContent = p.title;

      if (p.status === 'past') {
        tagNode.className = 'strip-item-tag tag-past';
        tagNode.textContent = 'סטארט אובר';
      } else if (p.status === 'live') {
        tagNode.className = 'strip-item-tag tag-live';
        tagNode.textContent = '• כעת';
      } else {
        tagNode.className = 'strip-item-tag tag-upcoming';
        tagNode.textContent = 'הבא';
      }
    }
  }

  activateTimelineProgramme(prog) {
    const ch = this.previewedChannel || this.selectedChannel;
    if (!prog || !ch) return;
    if (prog.status === 'past' || prog.status === 'live') {
      this.startProgrammeCatchup(ch, prog);
    } else {
      this.showToast('תוכנית עתידית (' + prog.startStr + ' - ' + prog.stopStr + '): ' + prog.title);
    }
  }

  formatDurationSeconds(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
  }

  startProgrammeCatchup(channel, prog) {
    if (!channel || !prog) return;
    this.selectedChannel = channel;
    this.isSurfing = false;
    this.endSeekHold();
    this._activeSeekSpeedLabel = '';
    clearTimeout(this._seekBadgeClearTimer);
    this.player.playProgrammeStartOver(channel, prog);

    const catchupBadge = document.getElementById('video-catchup-badge');
    if (catchupBadge) {
      catchupBadge.textContent = '';
      catchupBadge.classList.add('hidden');
    }

    this.enterFullscreen();
  }

  /* --------------------------------------------------------------------------
     Fullscreen OSD Updates (Dirty-Checked 60fps Cache — Zero Redundant Writes)
     -------------------------------------------------------------------------- */

  _getOsdEls() {
    if (this._osdEls) return this._osdEls;
    this._osdEls = {
      osd: document.getElementById('fullscreen-osd'),
      num: document.getElementById('osd-channel-number'),
      name: document.getElementById('osd-channel-name'),
      cat: document.getElementById('osd-channel-category'),
      vodBadge: document.getElementById('osd-vod-badge'),
      logo: document.getElementById('osd-channel-logo'),
      placeholder: document.getElementById('osd-logo-placeholder'),
      liveBadge: document.getElementById('osd-live-badge'),
      hintRedLabel: document.getElementById('hint-red-label') || document.querySelector('#hint-red span:last-child'),
      title: document.getElementById('osd-epg-title'),
      time: document.getElementById('osd-epg-time'),
      prog: document.getElementById('osd-epg-progress'),
      desc: document.getElementById('osd-epg-desc'),
      prevTitle: document.getElementById('osd-epg-prev-title'),
      prevTime: document.getElementById('osd-epg-prev-time'),
      nextTitle: document.getElementById('osd-epg-next-title'),
      nextTime: document.getElementById('osd-epg-next-time'),
      surfPrompt: document.getElementById('osd-surf-prompt')
    };
    return this._osdEls;
  }

  _setOsdText(key, el, val) {
    if (!this._osdLastCache) this._osdLastCache = Object.create(null);
    const str = val == null ? '' : String(val);
    if (el && this._osdLastCache[key] !== str) {
      this._osdLastCache[key] = str;
      el.textContent = str;
    }
  }

  updateOSD(channel, isSurfing) {
    if (!channel) return;
    const els = this._getOsdEls();
    const cache = this._osdLastCache || (this._osdLastCache = Object.create(null));

    this._setOsdText('num', els.num, channel.number);
    this._setOsdText('name', els.name, channel.name);
    this._setOsdText('cat', els.cat, channel.group || 'HD');

    const vodBadgeEl = els.vodBadge || document.getElementById('osd-vod-badge');
    if (vodBadgeEl) {
      const hasVod = this.hasCatchupSupport(channel);
      if (cache.hasVodBadge !== hasVod) {
        cache.hasVodBadge = hasVod;
        if (hasVod) {
          const days = typeof channel.catchupDays === 'number' && channel.catchupDays > 0 ? channel.catchupDays : 7;
          vodBadgeEl.textContent = 'VOD ' + days + 'd';
          vodBadgeEl.classList.remove('hidden');
        } else {
          vodBadgeEl.classList.add('hidden');
        }
      }
    }

    const osdLogo = els.logo;
    const osdPlaceholder = els.placeholder;
    if (osdLogo && osdPlaceholder) {
      const nextLogo = channel.logo || '';
      const nextMono = this.getChannelMonogram(channel);
      if (osdLogo.dataset.loadedSrc !== nextLogo || cache.monogram !== nextMono) {
        cache.monogram = nextMono;
        osdLogo.dataset.loadedSrc = nextLogo;
        osdPlaceholder.textContent = nextMono;
        osdLogo.classList.add('hidden');
        osdPlaceholder.classList.remove('hidden');
        if (nextLogo) {
          osdLogo.onload = () => {
            if (osdLogo.naturalWidth > 2) {
              osdLogo.classList.remove('hidden');
              osdPlaceholder.classList.add('hidden');
            }
          };
          osdLogo.onerror = () => {
            osdLogo.classList.add('hidden');
            osdPlaceholder.classList.remove('hidden');
          };
          osdLogo.src = nextLogo;
        }
      }
    }

    const playback =
      this.player && typeof this.player.getPlaybackInfo === 'function' ? this.player.getPlaybackInfo() : null;
    const activeCatchupProg =
      !isSurfing &&
      playback &&
      playback.isCatchup &&
      playback.programme &&
      this.player.currentChannel &&
      this.player.currentChannel.id === channel.id
        ? playback.programme
        : null;

    if (els.liveBadge) {
      let badgeMode = 'live';
      let badgeText = 'שידור חי';
      if (this._activeSeekSpeedLabel && !isSurfing) {
        badgeMode = 'seeking';
        badgeText = this._activeSeekSpeedLabel;
      } else if (playback && playback.isPaused && !isSurfing) {
        badgeMode = 'paused';
        badgeText = '❚❚ מושהה';
      } else if (activeCatchupProg) {
        badgeMode = 'catchup';
        badgeText = 'סטארט אובר';
      }
      if (cache.liveBadgeText !== badgeText) {
        cache.liveBadgeText = badgeText;
        els.liveBadge.textContent = badgeText;
      }
      if (cache.liveBadgeMode !== badgeMode) {
        cache.liveBadgeMode = badgeMode;
        els.liveBadge.classList.toggle('seeking-mode', badgeMode === 'seeking');
        els.liveBadge.classList.toggle('catchup-mode', badgeMode === 'catchup');
        els.liveBadge.classList.toggle('paused-mode', badgeMode === 'paused');
      }
    }

    this._setOsdText(
      'hintRed',
      els.hintRedLabel,
      activeCatchupProg ? 'יציאה מסטארט אובר (לחי)' : 'סטארט אובר (מההתחלה)'
    );

    const epgData = this.epg ? this.epg.getNowNext(channel) : null;

    if (activeCatchupProg) {
      const elapsed = playback.currentTime || 0;
      const total = playback.duration || 0;
      const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((elapsed / total) * 100))) : 0;
      const elapsedStr = total > 0 ? '  •  ' + this.formatDurationSeconds(elapsed) + ' / ' + this.formatDurationSeconds(total) : '';
      const startStr =
        activeCatchupProg.startStr ||
        (this.epg && activeCatchupProg.startMs ? this.epg.formatTime(activeCatchupProg.startMs) : '--:--');
      const stopStr =
        activeCatchupProg.stopStr ||
        (this.epg && activeCatchupProg.stopMs ? this.epg.formatTime(activeCatchupProg.stopMs) : '--:--');

      this._setOsdText('title', els.title, activeCatchupProg.title);
      this._setOsdText('time', els.time, startStr + ' - ' + stopStr + elapsedStr);
      const pctStr = pct + '%';
      if (els.prog && cache.pct !== pctStr) {
        cache.pct = pctStr;
        els.prog.style.width = pctStr;
      }
      this._setOsdText('desc', els.desc, activeCatchupProg.desc || (epgData && epgData.current ? epgData.current.desc : ''));
    } else if (epgData && epgData.current) {
      this._setOsdText('title', els.title, epgData.current.title);
      this._setOsdText('time', els.time, epgData.current.startStr + ' - ' + epgData.current.stopStr);
      const pctStr = epgData.current.progressPercent + '%';
      if (els.prog && cache.pct !== pctStr) {
        cache.pct = pctStr;
        els.prog.style.width = pctStr;
      }
      this._setOsdText('desc', els.desc, epgData.current.desc);
    }

    const adj =
      activeCatchupProg && this.epg && typeof this.epg.getAdjacentProgrammesForProgramme === 'function'
        ? this.epg.getAdjacentProgrammesForProgramme(channel, activeCatchupProg)
        : null;
    const schedSource = adj
      ? {
          previous: adj.previous || (epgData ? epgData.previous : null),
          next: adj.next || (epgData ? epgData.next : null)
        }
      : epgData;

    if (schedSource) {
      this._setOsdText('prevTitle', els.prevTitle, schedSource.previous ? schedSource.previous.title : 'שידור קודם');
      this._setOsdText(
        'prevTime',
        els.prevTime,
        schedSource.previous ? schedSource.previous.startStr + ' - ' + schedSource.previous.stopStr : ''
      );
      this._setOsdText('nextTitle', els.nextTitle, schedSource.next ? schedSource.next.title : 'שידור המשך');
      this._setOsdText(
        'nextTime',
        els.nextTime,
        schedSource.next ? schedSource.next.startStr + ' - ' + schedSource.next.stopStr : ''
      );
    }

    const surfingBool = Boolean(isSurfing);
    if (els.surfPrompt && cache.isSurfing !== surfingBool) {
      cache.isSurfing = surfingBool;
      if (surfingBool) {
        els.surfPrompt.classList.remove('hidden');
      } else {
        els.surfPrompt.classList.add('hidden');
      }
    }

    if (this.otaManager) {
      const verKey =
        (typeof this.otaManager.getRunningVersion === 'function' ? this.otaManager.getRunningVersion() : '') +
        '|' +
        (typeof this.otaManager.getRunningChannel === 'function' ? this.otaManager.getRunningChannel() : '');
      if (cache.otaVersionKey !== verKey) {
        cache.otaVersionKey = verKey;
        this.otaManager.updateVersionBadgesUI();
      }
    }
  }

  showOSD(duration) {
    const waitMs = typeof duration === 'number' && duration > 0 ? duration : this.getOsdTimeoutMs();
    const osd = this._getOsdEls().osd;
    if (!osd) return;
    if (osd.classList.contains('hidden')) {
      osd.classList.remove('hidden');
    }
    clearTimeout(this.osdTimer);
    clearInterval(this.osdTickTimer);

    this.osdTickTimer = setInterval(() => {
      if (this.mode !== 'FULLSCREEN' || osd.classList.contains('hidden')) {
        clearInterval(this.osdTickTimer);
        return;
      }
      if (!this.isSurfing && this.selectedChannel) {
        this.updateOSD(this.selectedChannel, false);
      }
    }, 1000);

    this.osdTimer = setTimeout(() => {
      if (!osd.classList.contains('hidden')) {
        osd.classList.add('hidden');
      }
      clearInterval(this.osdTickTimer);
      if (this.isSurfing) {
        this.isSurfing = false;
        if (this.selectedChannel) {
          this.updateOSD(this.selectedChannel, false);
        }
      }
    }, waitMs);
  }

  hideOSD() {
    clearTimeout(this.osdTimer);
    this.osdTimer = null;
    clearInterval(this.osdTickTimer);
    this.osdTickTimer = null;
    const osd = this._getOsdEls().osd || document.getElementById('fullscreen-osd');
    if (osd && !osd.classList.contains('hidden')) {
      osd.classList.add('hidden');
    }
    if (this.isSurfing) {
      this.isSurfing = false;
      const curChannel = this.selectedChannel || this.visibleChannels[this.focusedChannelIndex];
      if (curChannel) {
        this.updateOSD(curChannel, false);
      }
    }
  }

  /* --------------------------------------------------------------------------
     Favorites Management
     -------------------------------------------------------------------------- */

  loadFavorites() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.FAVORITES);
      if (data) {
        this.favorites = new Set(JSON.parse(data));
      }
    } catch (e) {
      this.favorites = new Set();
    }
  }

  saveFavorites() {
    localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(Array.from(this.favorites)));
  }

  toggleFavorite() {
    const targetCh = this.previewedChannel || this.selectedChannel;
    if (!targetCh) return;
    const id = targetCh.id;

    if (this.favorites.has(id)) {
      this.favorites.delete(id);
      this.showToast('הוסר מהמועדפים: ' + targetCh.name);
    } else {
      this.favorites.add(id);
      this.showToast('נוסף למועדפים ★: ' + targetCh.name);
    }

    this.saveFavorites();
    this.updateFavoriteButtonUI(targetCh);

    if (this.onlyFavorites) {
      this.applyChannelFilter();
    } else {
      // O(1) DOM update for the toggled channel row without rebuilding the whole list
      const nowFav = this.favorites.has(id);
      const indexMap = this._channelIndexById || (this._channelIndexById = Object.create(null));
      const rows = this._channelRowEls || this.channelRowNodes || [];
      const mappedIdx = indexMap[id];
      const row = typeof mappedIdx === 'number' ? rows[mappedIdx] : null;
      if (row) {
        let starEl = row.querySelector('.channel-fav-star');
        if (nowFav && !starEl) {
          starEl = document.createElement('span');
          starEl.className = 'channel-fav-star';
          starEl.textContent = '★';
          const playingBadge = row.querySelector('.channel-playing-badge');
          row.insertBefore(starEl, playingBadge || row._okPill || null);
        } else if (!nowFav && starEl) {
          starEl.remove();
        }
      }
    }
  }

  updateFavoriteButtonUI(channelOverride) {
    const ch = channelOverride || this.previewedChannel || this.selectedChannel;
    if (!ch) return;
    const isFav = this.favorites.has(ch.id);
    const label = document.getElementById('fav-btn-label');
    const icon = document.getElementById('fav-icon');

    if (label) {
      label.textContent = isFav ? 'במועדפים (הסר)' : 'הוסף למועדפים';
    }
    if (icon) {
      icon.textContent = isFav ? '★' : '☆';
      icon.style.color = isFav ? '#f59e0b' : '';
    }
  }

  /* --------------------------------------------------------------------------
     Zero-Reflow O(1) Spatial Navigation & Focus Engine
     -------------------------------------------------------------------------- */

  getHeaderButtons() {
    return [
      document.getElementById('btn-filter-favs'),
      document.getElementById('btn-toggle-favorite'),
      document.getElementById('btn-open-guide'),
      document.getElementById('btn-open-vod'),
      document.getElementById('btn-search-trigger'),
      document.getElementById('btn-voice-command'),
      document.getElementById('btn-open-settings')
    ].filter(Boolean);
  }

  setFocusedElementFast(el) {
    if (this.currentFocusedEl && this.currentFocusedEl !== el) {
      this.currentFocusedEl.classList.remove('focused');
    }
    this.currentFocusedEl = el;
    if (el) {
      el.classList.add('focused');
    }
  }

  /**
   * Pure O(1) integer scroll math using cached row height & viewport height — ZERO layout reflow!
   */
  scrollChannelIntoView(index, listEl) {
    const container = listEl || this._channelListEl || document.getElementById('channel-list');
    if (!container) return;
    this._channelListEl = container;

    const rowPitch = this._cachedRowHeight > 0 ? this._cachedRowHeight : 108;
    const rowBox = this._cachedRowBoxHeight > 0 ? this._cachedRowBoxHeight : 98;
    const viewHeight = this._cachedListHeight > 0 ? this._cachedListHeight : 820;
    const padTop = this._cachedListPaddingTop >= 0 ? this._cachedListPaddingTop : 14;
    const itemTop = padTop + index * rowPitch;
    const itemBottom = itemTop + rowBox;
    const viewTop = this._cachedListScrollTop >= 0 ? this._cachedListScrollTop : 0;
    const viewBottom = viewTop + viewHeight;
    const pad = 16;

    let targetScrollTop = viewTop;
    if (itemTop < viewTop + pad) {
      targetScrollTop = Math.max(0, itemTop - pad);
    } else if (itemBottom > viewBottom - pad) {
      targetScrollTop = Math.max(0, itemBottom - viewHeight + pad);
    }

    if (targetScrollTop !== viewTop) {
      this._cachedListScrollTop = targetScrollTop;
      this._lastProgrammaticScrollMs = Date.now();
      container.scrollTop = targetScrollTop;
      this._scheduleVisibleEpgWindowSync();
    }
  }

  updateChannelFocusFast() {
    const listEl = this._channelListEl || (this._channelListEl = document.getElementById('channel-list'));
    const idx = this.focusedChannelIndex;
    const rows = this._channelRowEls || this.channelRowNodes || [];
    const targetItem = rows[idx];
    if (!targetItem || !listEl) return;

    // Measure list geometry ONCE lazily BEFORE any DOM class/text writes (zero read-after-write!)
    if (!(this._cachedRowHeight > 0) || !(this._cachedListHeight > 0)) {
      this.measureChannelListMetrics(listEl);
    }

    // Strict O(1) focus swap on ONLY 2 elements via exact DOM reference
    if (this._focusedChannelEl && this._focusedChannelEl !== targetItem) {
      this._focusedChannelEl.classList.remove('focused');
    }
    if (this.currentFocusedEl && this.currentFocusedEl !== targetItem && this.currentFocusedEl !== this._focusedChannelEl) {
      this.currentFocusedEl.classList.remove('focused');
    }
    this._focusedChannelEl = targetItem;
    this.currentFocusedEl = targetItem;
    if (!targetItem.classList.contains('focused')) {
      targetItem.classList.add('focused');
    }

    // Zero-reflow integer arithmetic scrollTop write (ONLY when row exits visible window)
    this.scrollChannelIntoView(idx, listEl);

    // Only refresh row EPG if stale since last EPG epoch
    if (targetItem._epgEpoch !== (this._epgRefreshEpoch || 0)) {
      this.updateRowEPGDom(targetItem, this.visibleChannels[idx]);
    }
  }

  _scheduleFocusVisualFlush() {
    this._focusFlushPending = true;
    if (this._focusFlushRafId) return;
    const flush = () => {
      this._focusFlushRafId = null;
      if (!this._focusFlushPending) return;
      this._focusFlushPending = false;
      if (this.mode !== 'BROWSE' || this.focusArea !== 'channels') return;
      this.updateChannelFocusFast();
      const ch = this.visibleChannels[this.focusedChannelIndex];
      if (ch) {
        this.schedulePreviewChannelInfo(ch);
      }
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      this._focusFlushRafId = window.requestAnimationFrame(flush);
    } else {
      this._focusFlushRafId = setTimeout(flush, 16);
    }
  }

  _flushFocusVisualsNow() {
    if (!this._focusFlushPending && !this._focusFlushRafId) return;
    if (this._focusFlushRafId) {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(this._focusFlushRafId);
      } else {
        clearTimeout(this._focusFlushRafId);
      }
      this._focusFlushRafId = null;
    }
    this._focusFlushPending = false;
    if (this.mode === 'BROWSE' && this.focusArea === 'channels') {
      this.updateChannelFocusFast();
    }
  }

  updateTimelineFocusFast() {
    this.cancelAutoFullscreen();
    const target = this.timelineItemNodes[this.focusedTimelineIndex];
    if (target) {
      this._focusedChannelEl = null;
      this.setFocusedElementFast(target);
      const prog = this.timelineProgrammes[this.focusedTimelineIndex];
      if (prog) {
        this.displaySynopsisForProgramme(prog);
      }
    }
  }

  updateHeaderFocusFast() {
    this.cancelAutoFullscreen();
    const buttons = this.getHeaderButtons();
    const target = buttons[this.focusedHeaderIndex];
    if (target) {
      this._focusedChannelEl = null;
      this.setFocusedElementFast(target);
    }
  }

  /**
   * Pure integer offsetTop scroll calculation for modal lists — zero getBoundingClientRect() layout reflow!
   */
  scrollContainerFast(containerEl, itemEl) {
    if (!containerEl || !itemEl) return;
    const itemTop = itemEl.offsetTop;
    const itemBottom = itemTop + itemEl.offsetHeight;
    const viewTop = containerEl.scrollTop;
    const viewHeight = containerEl.clientHeight;
    const viewBottom = viewTop + viewHeight;
    const pad = 16;

    if (itemTop < viewTop + pad) {
      containerEl.scrollTop = Math.max(0, itemTop - pad);
    } else if (itemBottom > viewBottom - pad) {
      containerEl.scrollTop = itemBottom - viewHeight + pad;
    }
  }

  navigate(direction) {
    // 1. FULLSCREEN MODE: Info-Bar Channel Surfing (Up = +1, Down = -1)
    if (this.mode === 'FULLSCREEN') {
      if (direction === 'up' || direction === 'down') {
        if (this.visibleChannels.length === 0) return;
        this.endSeekHold();
        this._activeSeekSpeedLabel = '';

        const osd = this._getOsdEls().osd;
        const isOsdVisible = osd && !osd.classList.contains('hidden');

        // First press while Info Bar is hidden: only reveal Info Bar for the current channel
        if (!isOsdVisible) {
          this.isSurfing = false;
          this.surfingIndex = this.focusedChannelIndex;
          const currentCh = this.selectedChannel || this.visibleChannels[this.focusedChannelIndex];
          if (currentCh) {
            this.updateOSD(currentCh, false);
          }
          this.showOSD();
          return;
        }

        if (!this.isSurfing) {
          this.isSurfing = true;
          this.surfingIndex = this.focusedChannelIndex;
        }

        if (direction === 'up') {
          this.surfingIndex = (this.surfingIndex + 1) % this.visibleChannels.length;
        } else {
          this.surfingIndex = (this.surfingIndex - 1 + this.visibleChannels.length) % this.visibleChannels.length;
        }

        const surfTarget = this.visibleChannels[this.surfingIndex];
        this.updateOSD(surfTarget, true);
        this.showOSD(Math.max(7000, this.getOsdTimeoutMs()));
        return;
      } else if (direction === 'left') {
        // In Hebrew RTL, Left arrow moves Forward along the progress bar
        this.handleSeekKeyHold(1, this.getSeekStepSec());
        return;
      } else if (direction === 'right') {
        // In Hebrew RTL, Right arrow moves Backward along the progress bar
        this.handleSeekKeyHold(-1, this.getSeekStepSec());
        return;
      }
      return;
    }

    // 2. 7-DAY GUIDE MODAL MODE (Left/Right = Zapping between Days, Up/Down = Programmes in Day)
    if (this.mode === 'GUIDE') {
      this.navigateGuideModal(direction);
      return;
    }

    // 2b. LEGAL DISCLAIMER MODAL MODE
    if (this.mode === 'DISCLAIMER') {
      if (direction === 'up') {
        this.scrollActiveModalBy(-160);
      } else if (direction === 'down') {
        this.scrollActiveModalBy(160);
      }
      const acceptBtn = document.getElementById('btn-disclaimer-accept');
      if (acceptBtn) {
        this.setFocusedElementFast(acceptBtn);
      }
      return;
    }

    // 3. SETTINGS / SEARCH / OTA / ISSUE / VOICE MODAL MODE
    if (this.mode === 'SETTINGS' || this.mode === 'SEARCH' || this.mode === 'OTA' || this.mode === 'ISSUE' || this.mode === 'VOICE') {
      this.navigateModal(direction);
      return;
    }

    // 4. BROWSE MODE (Channels List, Program Timeline Strip, Top Header Toolbar)
    const prefs = this.getUiPrefs();
    const wrap = prefs.wrapNavigation !== false;
    const isLeftLayout = prefs.layoutSide === 'left';

    if (this.focusArea === 'channels') {
      if (direction === 'down') {
        if (this.visibleChannels.length === 0) return;
        this.cancelPendingPreviewPlayback();
        clearTimeout(this.previewTimer);
        if (this._miniTimelineTimer) {
          clearTimeout(this._miniTimelineTimer);
          this._miniTimelineTimer = null;
        }
        if (this.focusedChannelIndex < this.visibleChannels.length - 1) {
          this.focusedChannelIndex++;
          this._scheduleFocusVisualFlush();
        } else if (wrap) {
          this.focusedChannelIndex = 0;
          this._scheduleFocusVisualFlush();
        }
        this.scheduleAutoFullscreen();
      } else if (direction === 'up') {
        this.cancelPendingPreviewPlayback();
        clearTimeout(this.previewTimer);
        if (this._miniTimelineTimer) {
          clearTimeout(this._miniTimelineTimer);
          this._miniTimelineTimer = null;
        }
        if (this.visibleChannels.length === 0) {
          this.focusHeaderBar();
          return;
        }
        if (this.focusedChannelIndex > 0) {
          this.focusedChannelIndex--;
          this._scheduleFocusVisualFlush();
          this.scheduleAutoFullscreen();
        } else if (wrap) {
          this.focusedChannelIndex = this.visibleChannels.length - 1;
          this._scheduleFocusVisualFlush();
          this.scheduleAutoFullscreen();
        } else {
          this._flushFocusVisualsNow();
          this.focusHeaderBar();
        }
      } else if ((!isLeftLayout && direction === 'left') || (isLeftLayout && direction === 'right')) {
        this._flushFocusVisualsNow();
        this.flushPendingMiniTimeline();
        // Move focus to the Channel's Program Timeline Strip (Prev/Current/Next shows) or Header
        if (this.timelineItemNodes.length > 0 && prefs.showProgramStrip !== false) {
          this.cancelAutoFullscreen();
          this.focusArea = 'timeline';
          this.updateTimelineFocusFast();
        } else {
          this.focusHeaderBar();
        }
      } else if ((!isLeftLayout && direction === 'right') || (isLeftLayout && direction === 'left')) {
        this._flushFocusVisualsNow();
        this.updateChannelFocusFast();
      }
    } else if (this.focusArea === 'timeline') {
      // Navigating the Previous / Current / Next Program Strip under the Preview
      if (direction === 'left') {
        // In RTL, Left moves forward in the strip (or back to channel list when list is on left)
        if (this.focusedTimelineIndex < this.timelineItemNodes.length - 1) {
          this.focusedTimelineIndex++;
          this.updateTimelineFocusFast();
        } else if (isLeftLayout) {
          this.focusChannelList();
        }
      } else if (direction === 'right') {
        // In RTL, Right moves back toward earlier shows (or back to the Channel List when list is on right)
        if (this.focusedTimelineIndex > 0) {
          this.focusedTimelineIndex--;
          this.updateTimelineFocusFast();
        } else if (!isLeftLayout) {
          this.focusChannelList();
        }
      } else if (direction === 'up') {
        this.focusHeaderBar();
      } else if (direction === 'down') {
        // Open full 7-day guide if pressing down from timeline
        this.openGuideModal();
      }
    } else if (this.focusArea === 'header') {
      const buttons = this.getHeaderButtons();
      if (buttons.length === 0) return;

      if (direction === 'left') {
        this.focusedHeaderIndex = (this.focusedHeaderIndex + 1) % buttons.length;
        this.updateHeaderFocusFast();
      } else if (direction === 'right') {
        if (this.focusedHeaderIndex > 0) {
          this.focusedHeaderIndex--;
          this.updateHeaderFocusFast();
        } else {
          this.focusChannelList();
        }
      } else if (direction === 'down') {
        this.focusChannelList();
      }
    }
  }

  focusHeaderBar() {
    this.cancelAutoFullscreen();
    this._flushFocusVisualsNow();
    this.focusArea = 'header';
    this.focusedHeaderIndex = 0;
    this.updateHeaderFocusFast();
  }

  focusChannelList() {
    this.focusArea = 'channels';
    const previewCh = this.visibleChannels[this.focusedChannelIndex] || this.selectedChannel;
    if (previewCh) {
      const epgData = this.epg.getNowNext(previewCh);
      if (epgData && epgData.current) {
        this.displaySynopsisForProgramme(epgData.current);
      }
    }
    this.updateChannelFocusFast();
    this.scheduleAutoFullscreen();
  }

  /* --------------------------------------------------------------------------
     Center Button (OK) Handler:
     - In Fullscreen:
       * If surfing channels in OSD: switches to surfed channel
       * If OSD is hidden (1st press): brings up Info-Bar (OSD) ONLY
       * If OSD is already visible (2nd press): toggles Pause / Play!
     - In Browse (Channel List):
       * If focused channel is NOT currently playing: switches stream to that channel!
       * If focused channel IS already playing: enters Fullscreen!
     - In Browse (Timeline Strip): Starts Start-Over / Catch-Up for selected show
     - In 7-Day Guide: Starts Start-Over / Catch-Up for selected show
     -------------------------------------------------------------------------- */

  selectCurrent() {
    this._flushFocusVisualsNow();
    // 1. FULLSCREEN MODE
    if (this.mode === 'FULLSCREEN') {
      if (this.isSurfing) {
        this.focusedChannelIndex = this.surfingIndex;
        this.isSurfing = false;
        const targetCh = this.visibleChannels[this.focusedChannelIndex];
        if (targetCh) {
          this.highlightChannel(targetCh, true);
          this.updateOSD(targetCh, false);
          this.showOSD();
        }
      } else {
        const osd = document.getElementById('fullscreen-osd');
        const isOsdVisible = osd && !osd.classList.contains('hidden');
        if (!isOsdVisible) {
          // 1st press of OK when Info-Bar is hidden -> Only show Info-Bar!
          if (this.selectedChannel) {
            this.updateOSD(this.selectedChannel, false);
          }
          this.showOSD();
        } else {
          // 2nd press of OK while Info-Bar is visible -> Toggle Pause / Play!
          this.togglePlayPause();
          this.showOSD();
        }
      }
      return;
    }

    // 2. 7-DAY GUIDE & GLOBAL VOD MODAL MODE
    if (this.mode === 'GUIDE') {
      if (
        this.currentFocusedEl &&
        (
          this.currentFocusedEl.id === 'btn-guide-scope-channel' ||
          this.currentFocusedEl.id === 'btn-guide-scope-vod' ||
          this.currentFocusedEl.id === 'btn-vod-only-past' ||
          this.currentFocusedEl.id === 'vod-search-input' ||
          this.currentFocusedEl.classList.contains('modal-close-btn')
        )
      ) {
        if (this.currentFocusedEl.tagName === 'INPUT') {
          this.currentFocusedEl.focus();
        } else {
          this.currentFocusedEl.click();
        }
        return;
      }
      if (this.guideScope === 'vod') {
        const vodItem = Array.isArray(this.vodResults) ? this.vodResults[this.guideProgIndex] : null;
        if (vodItem) {
          this.playVodItem(vodItem);
        }
        return;
      }
      const dayBucket = this.guideDays[this.guideDayIndex];
      if (dayBucket && dayBucket.programmes[this.guideProgIndex]) {
        const prog = dayBucket.programmes[this.guideProgIndex];
        const ch = this.guideChannel || this.selectedChannel;
        this.closeModals();
        this.startProgrammeCatchup(ch, prog);
      }
      return;
    }

    // 2b. LEGAL DISCLAIMER MODAL MODE
    if (this.mode === 'DISCLAIMER') {
      this.acceptDisclaimer();
      return;
    }

    // 3. SETTINGS / SEARCH / OTA / ISSUE / VOICE MODAL MODE
    if (this.mode === 'SETTINGS' || this.mode === 'SEARCH' || this.mode === 'OTA' || this.mode === 'ISSUE' || this.mode === 'VOICE') {
      if (this.currentFocusedEl) {
        if (this.currentFocusedEl.tagName === 'INPUT' || this.currentFocusedEl.tagName === 'TEXTAREA') {
          this.activeSettingsInputId = this.currentFocusedEl.id;
          this.currentFocusedEl.focus();
        } else {
          this.currentFocusedEl.click();
        }
      }
      return;
    }

    // 4. BROWSE MODE
    if (this.focusArea === 'channels') {
      const targetCh = this.visibleChannels[this.focusedChannelIndex];
      if (!targetCh) return;
      const prefs = this.getUiPrefs();

      if (!this.selectedChannel || this.selectedChannel.id !== targetCh.id) {
        // Channel is not currently playing -> Switch to it ONLY on OK press! (No redundant bottom toast)
        this.highlightChannel(targetCh, true);
        if (prefs.previewAutoplay === 'off' || prefs.singleClickFullscreen === true) {
          this.enterFullscreen();
        }
      } else {
        if (
          prefs.previewAutoplay === 'off' &&
          this.player &&
          !this.player.hls &&
          !this.player._isNativePlayback &&
          !this.player._isPlaying
        ) {
          this.highlightChannel(targetCh, true);
        }
        // Channel is already playing -> Enter Fullscreen!
        this.enterFullscreen();
      }
    } else if (this.focusArea === 'timeline') {
      const prog = this.timelineProgrammes[this.focusedTimelineIndex];
      if (prog) {
        this.activateTimelineProgramme(prog);
      }
    } else if (this.focusArea === 'header') {
      const buttons = this.getHeaderButtons();
      if (buttons[this.focusedHeaderIndex]) {
        buttons[this.focusedHeaderIndex].click();
      }
    }
  }

  handleBack() {
    if (this.isPowerSaveMode) {
      this.exitPowerSaveMode();
      return;
    }

    if (this._sleepWarningActive) {
      this.cancelSleepWarning();
      return;
    }

    if (this.mode === 'DISCLAIMER') {
      if (this._disclaimerFromSettings) {
        this.closeDisclaimerModal();
      } else {
        const acceptBtn = document.getElementById('btn-disclaimer-accept');
        if (acceptBtn) this.setFocusedElementFast(acceptBtn);
      }
      return;
    }

    if (this.mode === 'VOICE') {
      this.closeVoiceOverlay();
      return;
    }

    // Cleaner Back escape from Search / VOD inputs: blur input first before closing modal
    if (typeof document !== 'undefined' && document.activeElement) {
      const actEl = document.activeElement;
      if (this.mode === 'GUIDE' && actEl.id === 'vod-search-input') {
        actEl.blur();
        if (this.guideProgNodes && this.guideProgNodes[0]) {
          this.guideProgIndex = 0;
          this.updateGuideProgrammeFocus();
        } else {
          this.setFocusedElementFast(actEl);
        }
        return;
      }
      if (this.mode === 'SEARCH' && actEl.id === 'search-query-input') {
        actEl.blur();
        const firstResult = document.querySelector('#search-results-list .focusable') || document.querySelector('#search-keyboard .kb-key');
        if (firstResult) this.setFocusedElementFast(firstResult);
        return;
      }
    }

    if (this.isModalOpen()) {
      this.closeModals();
      return;
    }

    if (this.mode === 'FULLSCREEN') {
      if (this.isSurfing) {
        this.hideOSD();
        return;
      }
      if (this.getUiPrefs().backHidesOsdFirst !== false) {
        const osd = document.getElementById('fullscreen-osd');
        if (osd && !osd.classList.contains('hidden')) {
          this.hideOSD();
          return;
        }
      }
      this.exitFullscreen();
      return;
    }

    if (this.focusArea === 'header' || this.focusArea === 'timeline') {
      this.focusChannelList();
      return;
    }

    // In Browse mode, staying on the channel list is the expected TV behavior.
    // Do NOT bounce or re-enter fullscreen on Back key!
  }

  /* --------------------------------------------------------------------------
     Fullscreen Mode Control
     -------------------------------------------------------------------------- */

  _cancelFullscreenRaf() {
    if (this._fullscreenRafId) {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(this._fullscreenRafId);
      } else {
        clearTimeout(this._fullscreenRafId);
      }
      this._fullscreenRafId = null;
    }
  }

  enterFullscreen() {
    if (!this.selectedChannel) return;
    this.cancelAutoFullscreen();
    this._flushFocusVisualsNow();
    this.mode = 'FULLSCREEN';
    this.isSurfing = false;
    this.endSeekHold();
    this._activeSeekSpeedLabel = '';
    clearTimeout(this._seekBadgeClearTimer);

    const targetChannel = this.selectedChannel;
    if (this.player && !this.isSafeMode()) {
      const hasActiveStream = Boolean(
        this.player.currentChannel &&
        this.player.currentChannel.id === targetChannel.id &&
        (this.player.hls || this.player._isNativePlayback || this.player._isPlaying)
      );
      if (!hasActiveStream && !this.player.currentProgramme) {
        try {
          localStorage.setItem(STORAGE_KEYS.LAST_CHANNEL, targetChannel.id);
        } catch (e) {}
        this.player.play(targetChannel);
      }
    }
    this.updateAutoplayOffBadge(true);
    this.updateStreamStatsOverlay();

    this._cancelFullscreenRaf();
    const runEnterFrame = () => {
      this._fullscreenRafId = null;
      if (this.mode !== 'FULLSCREEN') return;
      this.updateVideoSurfacePosition(true);
      this.updateOSD(targetChannel, false);
      this.showOSD();
      this.updateStreamStatsOverlay();
    };

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      this._fullscreenRafId = window.requestAnimationFrame(runEnterFrame);
    } else {
      runEnterFrame();
    }
  }

  exitFullscreen() {
    try {
      this.mode = 'BROWSE';
      this.isSurfing = false;
      this.focusArea = 'channels';
      this.endSeekHold();
      this._activeSeekSpeedLabel = '';
      clearTimeout(this._seekBadgeClearTimer);
      clearTimeout(this.osdTimer);
      clearInterval(this.osdTickTimer);
      this.updateStreamStatsOverlay();

      if (this.selectedChannel) {
        const indexMap = this._channelIndexById || (this._channelIndexById = Object.create(null));
        const mappedIdx = indexMap[this.selectedChannel.id];
        if (typeof mappedIdx === 'number') {
          this.focusedChannelIndex = mappedIdx;
        } else {
          const idx = this.visibleChannels.findIndex((c) => c.id === this.selectedChannel.id);
          if (idx !== -1) this.focusedChannelIndex = idx;
        }
      }

      if (this.getUiPrefs().previewAutoplay === 'off') {
        if (this.player && typeof this.player.stop === 'function') {
          this.player.stop();
        }
        const loader = document.getElementById('video-loader');
        const errBadge = document.getElementById('video-error-badge');
        const pauseBadge = document.getElementById('video-pause-indicator');
        if (loader) loader.classList.add('hidden');
        if (errBadge) errBadge.classList.add('hidden');
        if (pauseBadge) pauseBadge.classList.add('hidden');
      }
      this.updateAutoplayOffBadge();

      this._cancelFullscreenRaf();
      const runExitFrame = () => {
        this._fullscreenRafId = null;
        if (this.mode !== 'BROWSE') return;
        try {
          // READ-BEFORE-WRITE: measure/apply video surface FIRST (zero read-after-write layout thrash)
          this.updateVideoSurfacePosition(!this.cachedPreviewRect);
          const osd = this._getOsdEls().osd;
          if (osd && !osd.classList.contains('hidden')) {
            osd.classList.add('hidden');
          }
          if (this.selectedChannel) {
            this.previewChannelInfo(this.selectedChannel, true);
          }
          this.refreshVisibleEPGLabels();
          this.updateChannelFocusFast();
        } catch (e) {}
      };

      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        this._fullscreenRafId = window.requestAnimationFrame(runExitFrame);
      } else {
        runExitFrame();
      }
      this.scheduleAutoFullscreen();
    } catch (err) {
      console.warn('exitFullscreen notice:', err);
    }
  }

  changeChannelByOffset(offset) {
    if (this.visibleChannels.length === 0) return;
    this.isSurfing = false;
    let newIdx = (this.focusedChannelIndex + offset) % this.visibleChannels.length;
    if (newIdx < 0) newIdx += this.visibleChannels.length;

    this.focusedChannelIndex = newIdx;
    const targetChannel = this.visibleChannels[newIdx];
    this.highlightChannel(targetChannel, true);

    if (this.mode === 'FULLSCREEN') {
      this.showOSD();
    } else {
      this.updateChannelFocusFast();
      if (this.mode === 'BROWSE' && this.focusArea === 'channels') {
        this.scheduleAutoFullscreen();
      }
    }
  }

  jumpToChannelNumber(num) {
    const ch = this.allChannels.find((c) => c.number === num);
    if (ch) {
      this.isSurfing = false;
      if (this.onlyFavorites && !this.favorites.has(ch.id)) {
        this.onlyFavorites = false;
        this.applyChannelFilter();
      }
      const idx = this.visibleChannels.findIndex((c) => c.id === ch.id);
      if (idx !== -1) {
        this.focusedChannelIndex = idx;
      }
      this.highlightChannel(ch, true);
      if (this.mode === 'FULLSCREEN') {
        this.showOSD();
      } else {
        this.updateChannelFocusFast();
        if (this.mode === 'BROWSE' && this.focusArea === 'channels') {
          this.scheduleAutoFullscreen();
        }
      }
    } else {
      this.showToast('ערוץ מספר ' + num + ' לא נמצא', true);
    }
  }

  showNumberInputOverlay(digits) {
    const overlay = document.getElementById('channel-number-jump');
    if (!overlay) return;

    // Ensure rich preview structure exists inside #channel-number-jump (works even when hot-updated via OTA)
    if (!document.getElementById('jump-channel-preview')) {
      overlay.innerHTML =
        '<div class="jump-num-box">' +
          '<span class="jump-label">ערוץ</span>' +
          '<span id="jump-number-digits" class="jump-digits">1</span>' +
        '</div>' +
        '<div id="jump-channel-preview" class="jump-channel-preview">' +
          '<div class="jump-logo-box">' +
            '<img id="jump-channel-logo" src="" alt="" class="hidden">' +
            '<span id="jump-channel-monogram" class="jump-monogram">TV</span>' +
          '</div>' +
          '<div class="jump-preview-info">' +
            '<div id="jump-channel-name" class="jump-channel-name">שם הערוץ</div>' +
            '<div id="jump-channel-epg" class="jump-channel-epg">כעת: שידור ישיר</div>' +
            '<div id="numeric-zap-preview" class="numeric-zap-preview hidden"></div>' +
          '</div>' +
        '</div>';
    }

    const textEl = document.getElementById('jump-number-digits');
    const nameEl = document.getElementById('jump-channel-name');
    const epgEl = document.getElementById('jump-channel-epg');
    const logoImg = document.getElementById('jump-channel-logo');
    const monogramEl = document.getElementById('jump-channel-monogram');
    const zapPreviewEl = document.getElementById('numeric-zap-preview');

    if (textEl) textEl.textContent = digits;

    const targetNum = parseInt(digits, 10);
    const matchedCh = !isNaN(targetNum) ? this.allChannels.find((c) => c.number === targetNum) : null;
    const prefixStr = String(digits || '').trim();
    const prefixMatches = prefixStr
      ? this.allChannels.filter((c) => String(c.number).indexOf(prefixStr) === 0 && (!matchedCh || c.id !== matchedCh.id)).slice(0, 3)
      : [];

    if (matchedCh) {
      if (nameEl) {
        nameEl.textContent = matchedCh.name;
        nameEl.classList.remove('not-found');
      }
      if (epgEl) {
        const epgNow = this.epg ? this.epg.getNowNext(matchedCh) : null;
        if (epgNow && epgNow.current) {
          const timePart =
            epgNow.current.startStr && epgNow.current.stopStr
              ? ' (' + epgNow.current.startStr + ' - ' + epgNow.current.stopStr + ')'
              : '';
          epgEl.textContent = 'כעת: ' + epgNow.current.title + timePart;
        } else {
          epgEl.textContent = matchedCh.group || 'שידור חי';
        }
      }
      if (zapPreviewEl) {
        let previewText = 'יעבור לערוץ #' + matchedCh.number + ' • ' + matchedCh.name;
        if (prefixMatches.length > 0) {
          previewText += '  |  עוד: ' + prefixMatches.map((m) => m.number + ' ' + m.name).join(' • ');
        }
        zapPreviewEl.textContent = previewText;
        zapPreviewEl.classList.remove('hidden');
      }
      if (logoImg && monogramEl) {
        monogramEl.textContent = this.getChannelMonogram(matchedCh);
        logoImg.classList.add('hidden');
        monogramEl.classList.remove('hidden');
        if (matchedCh.logo) {
          logoImg.onload = () => {
            if (logoImg.naturalWidth > 2) {
              logoImg.classList.remove('hidden');
              monogramEl.classList.add('hidden');
            }
          };
          logoImg.onerror = () => {
            logoImg.classList.add('hidden');
            monogramEl.classList.remove('hidden');
          };
          logoImg.src = matchedCh.logo;
        }
      }
    } else {
      if (nameEl) {
        nameEl.textContent = prefixMatches.length > 0 ? (prefixMatches[0].number + ' • ' + prefixMatches[0].name) : ('אין ערוץ במספר ' + digits);
        nameEl.classList.toggle('not-found', prefixMatches.length === 0);
      }
      if (epgEl) {
        epgEl.textContent = prefixMatches.length > 0 ? 'המשך להקליד למעבר...' : 'המשך להקליד ספרות...';
      }
      if (zapPreviewEl) {
        if (prefixMatches.length > 0) {
          zapPreviewEl.textContent = 'התאמות: ' + prefixMatches.map((m) => '#' + m.number + ' ' + m.name).join(' • ');
        } else {
          zapPreviewEl.textContent = 'אין ערוץ תואם למספר ' + digits;
        }
        zapPreviewEl.classList.remove('hidden');
      }
      if (logoImg && monogramEl) {
        logoImg.classList.add('hidden');
        monogramEl.classList.remove('hidden');
        monogramEl.textContent = '?';
      }
    }

    overlay.classList.remove('hidden');

    clearTimeout(this.jumpTimer);
    const hideDelayMs = Math.max(1500, this.getNumericJumpMs() + 300);
    this.jumpTimer = setTimeout(() => {
      overlay.classList.add('hidden');
    }, hideDelayMs);
  }

  /* --------------------------------------------------------------------------
     Remote Color Buttons & Media Handlers
     Red: Start Over (סטארט אובר)
     Green: Rewind 30s (הרצה אחורה)
     Yellow: 7-Day Channel Program Guide (מדריך התוכניות של הערוץ)
     Blue: Fast-Forward 30s (הרצה קדימה)
     OK (Fullscreen): 1st press = Info-Bar | 2nd press = Pause / Play
     -------------------------------------------------------------------------- */

  handleSeekKeyHold(dir, baseSeconds) {
    const now = Date.now();
    if (this._seekHoldDir !== dir || (now - (this._seekHoldLastEventMs || 0)) > 600) {
      this._seekHoldDir = dir;
      this._seekHoldStartMs = now;
      this._seekHoldTicks = 0;
    }
    this._seekHoldLastEventMs = now;
    this._seekHoldTicks = (this._seekHoldTicks || 0) + 1;

    const heldMs = now - this._seekHoldStartMs;
    let step;
    let speedLabel;
    if (heldMs < 600 || this._seekHoldTicks <= 1) {
      step = baseSeconds || 15;
      speedLabel = '';
    } else if (heldMs < 1800) {
      step = 30;
      speedLabel = '×2';
    } else if (heldMs < 3500) {
      step = 60;
      speedLabel = '×4';
    } else if (heldMs < 6000) {
      step = 180;
      speedLabel = '×8';
    } else {
      step = 300;
      speedLabel = '×16';
    }

    this._activeSeekSpeedLabel = speedLabel
      ? (dir > 0 ? '◀◀ הרצה קדימה ' : '▶▶ הרצה אחורה ') + speedLabel
      : '';

    clearTimeout(this._seekBadgeClearTimer);
    this._seekBadgeClearTimer = setTimeout(() => {
      this._activeSeekSpeedLabel = '';
      if (this.mode === 'FULLSCREEN' && this.selectedChannel) {
        this.updateOSD(this.selectedChannel, false);
      }
    }, 900);

    this.seekAndShowOSD(dir * step);
  }

  endSeekHold() {
    this._seekHoldDir = 0;
    this._seekHoldStartMs = 0;
    this._seekHoldTicks = 0;
  }

  seekAndShowOSD(deltaSeconds) {
    if (!this.player) return;
    if (deltaSeconds < 0) {
      this.player.rewind(Math.abs(deltaSeconds));
    } else {
      this.player.fastForward(deltaSeconds);
    }
    this.isSurfing = false;
    const ch = this.selectedChannel || this.player.currentChannel;
    if (ch) {
      this.updateOSD(ch, false);
    }
    this.showOSD();
  }

  onRedButton() {
    const ch = this.selectedChannel || this.previewedChannel || (this.player && this.player.currentChannel);
    if (!ch || !this.player) return;

    if (this.player.currentProgramme && this.player.currentChannel && this.player.currentChannel.id === ch.id) {
      if (typeof this.player.exitStartOverToLive === 'function') {
        this.player.exitStartOverToLive();
      } else {
        this.player.currentProgramme = null;
        this.player.play(ch);
      }
      this.isSurfing = false;
      this._activeSeekSpeedLabel = '';
      this.endSeekHold();
      clearTimeout(this._seekBadgeClearTimer);
      this.updateOSD(ch, false);
      if (this.mode === 'FULLSCREEN') {
        this.showOSD();
      } else {
        this.previewChannelInfo(ch);
        this.showToast('חזרה לשידור חי: ' + ch.name);
      }
      return;
    }

    if (this.epg) {
      const epgData = this.epg.getNowNext(ch);
      if (epgData && epgData.current && (epgData.current.start || epgData.current.startMs)) {
        this.startProgrammeCatchup(ch, epgData.current);
        return;
      }
    }

    if (this.player.currentProgramme) {
      this.startProgrammeCatchup(ch, this.player.currentProgramme);
      return;
    }

    this.player.startOver();
    this.updateOSD(ch, false);
    if (this.mode === 'FULLSCREEN') {
      this.showOSD();
    }
  }

  onGreenButton() {
    this.handleSeekKeyHold(-1, this.getSeekStepSec());
  }

  onYellowButton() {
    // Yellow Button opens (or closes if already open) the 7-Day Channel Program Guide!
    if (this.mode === 'GUIDE') {
      this.closeModals();
      return;
    }
    const targetCh = (this.mode === 'FULLSCREEN' && this.isSurfing && this.visibleChannels[this.surfingIndex])
      ? this.visibleChannels[this.surfingIndex]
      : (this.previewedChannel || this.selectedChannel);
    this.openGuideModal(targetCh);
  }

  onBlueButton() {
    this.handleSeekKeyHold(1, this.getSeekStepSec());
  }

  togglePlayPause() {
    if (this.player) {
      this.endSeekHold();
      this._activeSeekSpeedLabel = '';
      clearTimeout(this._seekBadgeClearTimer);
      this.player.togglePlayPause();
      this.isSurfing = false;
      const ch = this.selectedChannel || this.player.currentChannel;
      if (ch) {
        this.updateOSD(ch, false);
      }
      this.showOSD();
    }
  }

  stopPlayback() {
    if (this.player) {
      this.player.stop();
    }
  }

  /* --------------------------------------------------------------------------
     7-Day Channel Program Guide Modal (#guide-modal)
     Bounded to 7 Days Back + Today, with Fast Day-by-Day Zapping (◀ / ▶)
     -------------------------------------------------------------------------- */

  openGuideModal(channelOrScope, vodInitialQuery) {
    this.ensureVodHeaderBtnDOM();
    const isVodMode = channelOrScope === 'vod';
    const ch =
      (!isVodMode && channelOrScope && typeof channelOrScope === 'object' ? channelOrScope : null) ||
      this.previewedChannel ||
      this.selectedChannel ||
      this.visibleChannels[0] ||
      this.allChannels[0] ||
      null;
    if (!isVodMode && !ch) return;

    this.cancelAutoFullscreen();
    if (!this.isModalOpen()) {
      this._saveFocusBeforeModal();
      this.previousModeBeforeModal = this.mode === 'FULLSCREEN' ? 'FULLSCREEN' : 'BROWSE';
    }
    this.mode = 'GUIDE';
    if (ch) this.guideChannel = ch;
    this.guideDayIndex = 0;

    const osd = document.getElementById('fullscreen-osd');
    if (osd) osd.classList.add('hidden');
    const pauseBadge = document.getElementById('video-pause-indicator');
    if (pauseBadge) pauseBadge.classList.add('hidden');

    const guideModal = document.getElementById('guide-modal');
    if (guideModal) {
      guideModal.classList.remove('hidden');
      guideModal.setAttribute('aria-hidden', 'false');
    }
    this.updateVideoSurfacePosition();

    this.setGuideScope(isVodMode ? 'vod' : 'channel', vodInitialQuery);
  }

  setGuideScope(scope, vodInitialQuery) {
    this.ensureVodHeaderBtnDOM();
    this.guideScope = scope === 'vod' ? 'vod' : 'channel';

    const scopeChBtn = document.getElementById('btn-guide-scope-channel');
    const scopeVodBtn = document.getElementById('btn-guide-scope-vod');
    const daysBar = document.getElementById('guide-days-bar');
    const vodSearchBar = document.getElementById('vod-search-bar');
    const vodInput = document.getElementById('vod-search-input');
    const titleEl = document.getElementById('guide-modal-title');
    const subtitleEl = document.getElementById('guide-modal-subtitle');

    if (scopeChBtn) scopeChBtn.classList.toggle('active', this.guideScope === 'channel');
    if (scopeVodBtn) scopeVodBtn.classList.toggle('active', this.guideScope === 'vod');

    if (this.guideScope === 'vod') {
      if (daysBar) daysBar.classList.add('hidden');
      if (vodSearchBar) vodSearchBar.classList.remove('hidden');
      if (titleEl) titleEl.textContent = 'VOD גלובלי — כל הערוצים (7 ימים)';
      if (subtitleEl) subtitleEl.textContent = 'חפש תוכנית מ-7 הימים האחרונים בכל הערוצים ולחץ OK לצפייה';
      if (typeof vodInitialQuery === 'string') {
        this.vodSearchQuery = vodInitialQuery;
        if (vodInput) vodInput.value = vodInitialQuery;
      } else if (vodInput) {
        this.vodSearchQuery = vodInput.value || '';
      }
      this._syncVodOnlyPastBtn();
      this.renderVodProgrammes();
      if (this.guideProgNodes.length > 0 && typeof vodInitialQuery === 'string' && vodInitialQuery.trim()) {
        this.guideProgIndex = 0;
        this.updateGuideProgrammeFocus();
      } else if (vodInput) {
        this.setFocusedElementFast(vodInput);
      } else if (scopeVodBtn) {
        this.setFocusedElementFast(scopeVodBtn);
      }
      return;
    }

    if (daysBar) daysBar.classList.remove('hidden');
    if (vodSearchBar) vodSearchBar.classList.add('hidden');

    const ch = this.guideChannel || this.previewedChannel || this.selectedChannel || this.visibleChannels[0];
    this.guideChannel = ch;
    if (ch) {
      this.guideDays = this.epg.getChannelGuideByDays(ch);
      if (titleEl) {
        titleEl.textContent = 'מדריך תוכניות (7 ימים): ערוץ ' + ch.number + ' - ' + ch.name;
      }
    } else {
      this.guideDays = [];
    }
    if (subtitleEl) {
      subtitleEl.textContent = 'בחר יום בחצים ◀ ▶ ובחר תוכנית לסטארט אובר';
    }
    this.renderGuideDayTabs();
    this.renderGuideDayProgrammes();
  }

  _syncVodOnlyPastBtn() {
    const btn = document.getElementById('btn-vod-only-past');
    if (!btn) return;
    btn.classList.toggle('active', Boolean(this.vodOnlyPast));
    btn.textContent = this.vodOnlyPast ? 'רק שידורים מוקלטים ✓' : 'רק שידורים מוקלטים';
  }

  toggleVodOnlyPast() {
    this.vodOnlyPast = !this.vodOnlyPast;
    this._syncVodOnlyPastBtn();
    if (this.mode === 'GUIDE' && this.guideScope === 'vod') {
      this.renderVodProgrammes();
    }
  }

  renderVodProgrammes() {
    const listEl = document.getElementById('guide-programmes-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    this.guideProgNodes = [];
    this.vodResults = [];

    const query = String(this.vodSearchQuery || '').trim();
    const lookup = this._buildEpgChannelLookup();
    let results = [];

    if (this.epg) {
      const opts = {
        maxDays: 7,
        pastOnly: Boolean(this.vodOnlyPast),
        limit: 80,
        channelMap: lookup.channelMap
      };
      if (query && typeof this.epg.searchAllVodProgrammes === 'function') {
        results = this.epg.searchAllVodProgrammes(query, opts) || [];
      } else if (!query && typeof this.epg.getRecentVodProgrammes === 'function') {
        results = this.epg.getRecentVodProgrammes(opts) || [];
      } else if (typeof this.epg.searchAllVodProgrammes === 'function') {
        results = this.epg.searchAllVodProgrammes(query, opts) || [];
      }
    }

    // Graceful offline / empty-XMLTV fallback when query is empty
    if (results.length === 0 && !query && this.epg && (!this.epg.programmesByChannel || this.epg.programmesByChannel.size === 0)) {
      const now = Date.now();
      const chPool = (this.visibleChannels.length > 0 ? this.visibleChannels : this.allChannels).slice(0, 12);
      for (let i = 0; i < chPool.length; i++) {
        const ch = chPool[i];
        const progs = this.epg.getChannelProgrammes(ch) || [];
        for (let pIdx = progs.length - 1; pIdx >= 0; pIdx--) {
          const p = progs[pIdx];
          if (!p || p.startMs > now) continue;
          if (this.vodOnlyPast && p.stopMs > now) continue;
          results.push({
            epgChannelId: ch.epgId || ch.id,
            channel: ch,
            title: p.title,
            desc: p.desc || '',
            start: p.startMs,
            stop: p.stopMs,
            isLive: p.startMs <= now && p.stopMs > now,
            isPast: p.stopMs <= now,
            durationMin: Math.max(1, Math.round((p.stopMs - p.startMs) / 60000)),
            score: 1
          });
          if (results.length >= 60) break;
        }
        if (results.length >= 60) break;
      }
      results.sort((a, b) => (b.start || 0) - (a.start || 0));
    }

    const mappedResults = [];
    for (let i = 0; i < results.length; i++) {
      const item = results[i];
      if (!item) continue;
      const ch = item.channel || this._resolveChannelForEpgId(item.epgChannelId, lookup);
      const startMs = typeof item.startMs === 'number'
        ? item.startMs
        : (typeof item.start === 'number' ? item.start : (item.start ? new Date(item.start).getTime() : 0));
      const stopMs = typeof item.stopMs === 'number'
        ? item.stopMs
        : (typeof item.stop === 'number' ? item.stop : (item.stop ? new Date(item.stop).getTime() : startMs + 3600000));
      mappedResults.push({
        epgChannelId: item.epgChannelId || (ch ? (ch.epgId || ch.id) : ''),
        channel: ch || null,
        channelName: ch ? ch.name : (item.channelName || lookup.channelMap[item.epgChannelId] || item.epgChannelId || 'ערוץ'),
        channelNumber: ch ? ch.number : '',
        title: item.title || 'שידור חי',
        desc: item.desc || '',
        startMs: startMs,
        stopMs: stopMs,
        startStr: this.epg ? this.epg.formatTime(startMs) : '',
        stopStr: this.epg ? this.epg.formatTime(stopMs) : '',
        dayLabel: this._formatVodDayLabel(startMs),
        durationMin: item.durationMin || Math.max(1, Math.round((stopMs - startMs) / 60000)),
        isLive: Boolean(item.isLive),
        isPast: Boolean(item.isPast)
      });
    }

    this.vodResults = mappedResults;
    this.guideProgIndex = 0;
    listEl.scrollTop = 0;

    if (mappedResults.length === 0) {
      listEl.innerHTML =
        '<div class="empty-state-card">' +
          '<div class="empty-state-icon">🎬</div>' +
          '<div class="empty-state-title">' + (query ? 'לא נמצאו תוכניות תואמות ב-7 הימים האחרונים' : 'אין תוכניות VOD להצגה כעת') + '</div>' +
          '<div class="empty-state-desc">' + (query ? 'נסה מילת חיפוש אחרת או בטל את הסינון "רק שידורים מוקלטים".' : 'טען לוח שידורים (EPG) או הקלד שם תוכנית בחיפוש למעלה.') + '</div>' +
        '</div>';
      const statusEl = document.getElementById('guide-detail-status');
      const titleEl = document.getElementById('guide-detail-title');
      const timeEl = document.getElementById('guide-detail-time');
      const descEl = document.getElementById('guide-detail-desc');
      if (statusEl) {
        statusEl.textContent = 'VOD גלובלי — 7 ימים';
        statusEl.className = 'guide-status-badge status-future';
      }
      if (titleEl) titleEl.textContent = query ? ('אין תוצאות עבור "' + query + '"') : 'אין תוכניות זמינות';
      if (timeEl) timeEl.textContent = '--:-- - --:--';
      if (descEl) descEl.textContent = 'ניתן לחפש לפי שם תוכנית, תיאור או שם ערוץ מ-7 הימים האחרונים.';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < mappedResults.length; i++) {
      const r = mappedResults[i];
      const row = document.createElement('div');
      row.className = 'vod-result-card focusable' + (r.isLive ? ' is-live' : ' is-past');
      const chBadgeLabel = (r.channelNumber ? ('#' + r.channelNumber + ' ') : '') + r.channelName;
      const typePillHtml = r.isLive
        ? '<span class="vod-type-pill is-live">● שידור חי</span>'
        : (r.isPast
          ? '<span class="vod-type-pill is-vod">VOD • הקלטה</span>'
          : '<span class="vod-type-pill">בהמשך</span>');

      row.innerHTML =
        '<div class="vod-result-main">' +
          '<div class="vod-result-meta">' +
            '<span class="vod-channel-badge"></span>' +
            '<span class="vod-day-badge"></span>' +
          '</div>' +
          '<div class="vod-result-title"></div>' +
        '</div>' +
        '<div class="vod-result-actions">' +
          typePillHtml +
          '<span class="vod-play-cta">▶ צפה</span>' +
        '</div>';

      const chBadgeEl = row.querySelector('.vod-channel-badge');
      const dayBadgeEl = row.querySelector('.vod-day-badge');
      const titleNode = row.querySelector('.vod-result-title');
      if (chBadgeEl) chBadgeEl.textContent = chBadgeLabel;
      if (dayBadgeEl) dayBadgeEl.textContent = r.dayLabel + ' • ' + r.startStr + '-' + r.stopStr + ' (' + r.durationMin + ' דק׳)';
      if (titleNode) titleNode.textContent = r.title;

      row.addEventListener('click', () => {
        this.guideProgIndex = i;
        this.updateGuideProgrammeFocus();
        this.playVodItem(r);
      });

      this.guideProgNodes.push(row);
      fragment.appendChild(row);
    }

    listEl.appendChild(fragment);
    this._updateVodDetailCard(mappedResults[0]);
  }

  _updateVodDetailCard(vodItem) {
    if (!vodItem) return;
    const statusEl = document.getElementById('guide-detail-status');
    const titleEl = document.getElementById('guide-detail-title');
    const timeEl = document.getElementById('guide-detail-time');
    const descEl = document.getElementById('guide-detail-desc');
    const hasCatchup = vodItem.channel ? this.hasCatchupSupport(vodItem.channel) : false;

    if (statusEl) {
      if (vodItem.isLive) {
        statusEl.textContent = '● משודר כעת בשידור חי (לחץ OK לצפייה)';
        statusEl.className = 'guide-status-badge status-live';
      } else if (hasCatchup) {
        statusEl.textContent = 'VOD זמין לצפייה חוזרת (לחץ OK להפעלה)';
        statusEl.className = 'guide-status-badge status-past';
      } else {
        statusEl.textContent = 'שידור מוקלט (' + vodItem.channelName + ' — מעבר לערוץ ב-OK)';
        statusEl.className = 'guide-status-badge status-past';
      }
    }
    if (titleEl) titleEl.textContent = vodItem.title;
    if (timeEl) {
      const chPrefix = (vodItem.channelNumber ? ('ערוץ ' + vodItem.channelNumber + ' • ') : '') + vodItem.channelName;
      timeEl.textContent = chPrefix + ' | ' + vodItem.dayLabel + ' ' + vodItem.startStr + ' - ' + vodItem.stopStr;
    }
    if (descEl) descEl.textContent = vodItem.desc || 'שידור מתוך מדריך 7 הימים האחרונים.';
  }

  renderGuideDayTabs() {
    const barEl = document.getElementById('guide-days-bar');
    if (!barEl) return;
    barEl.innerHTML = '';
    this.guideDayTabNodes = [];

    for (let i = 0; i < this.guideDays.length; i++) {
      const day = this.guideDays[i];
      const btn = document.createElement('button');
      btn.className = 'guide-day-tab' + (i === this.guideDayIndex ? ' active-day' : '');
      btn.textContent = day.label;
      btn.addEventListener('click', () => {
        this.guideDayIndex = i;
        this.updateGuideDayTabActive();
        this.renderGuideDayProgrammes();
      });
      this.guideDayTabNodes.push(btn);
      barEl.appendChild(btn);
    }
  }

  updateGuideDayTabActive() {
    for (let i = 0; i < this.guideDayTabNodes.length; i++) {
      if (i === this.guideDayIndex) {
        this.guideDayTabNodes[i].classList.add('active-day');
      } else {
        this.guideDayTabNodes[i].classList.remove('active-day');
      }
    }
    const barEl = document.getElementById('guide-days-bar');
    const activeTab = this.guideDayTabNodes[this.guideDayIndex];
    if (barEl && activeTab) {
      const tabLeft = activeTab.offsetLeft;
      const tabRight = tabLeft + activeTab.offsetWidth;
      const viewLeft = barEl.scrollLeft;
      const viewRight = viewLeft + barEl.clientWidth;
      if (tabLeft < viewLeft) {
        barEl.scrollLeft = tabLeft;
      } else if (tabRight > viewRight) {
        barEl.scrollLeft = tabRight - barEl.clientWidth;
      }
    }
  }

  renderGuideDayProgrammes() {
    const listEl = document.getElementById('guide-programmes-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    this.guideProgNodes = [];

    const dayBucket = this.guideDays[this.guideDayIndex];
    if (!dayBucket || !dayBucket.programmes || dayBucket.programmes.length === 0) {
      listEl.innerHTML =
        '<div class="empty-state-card">' +
          '<div class="empty-state-icon">📅</div>' +
          '<div class="empty-state-title">אין תוכניות רשומות ליום זה</div>' +
          '<div class="empty-state-desc">השתמש בחצים ◀ ▶ למעבר מהיר בין הימים האחרים.</div>' +
        '</div>';
      const statusEl = document.getElementById('guide-detail-status');
      const titleEl = document.getElementById('guide-detail-title');
      const timeEl = document.getElementById('guide-detail-time');
      const descEl = document.getElementById('guide-detail-desc');
      if (statusEl) {
        statusEl.textContent = 'אין נתוני שידור';
        statusEl.className = 'guide-status-badge status-future';
      }
      if (titleEl) titleEl.textContent = dayBucket ? dayBucket.label : 'ללא תוכניות';
      if (timeEl) timeEl.textContent = '--:-- - --:--';
      if (descEl) descEl.textContent = 'לא נמצאו תוכניות בלוח השידורים ליום שנבחר.';
      return;
    }

    const progs = dayBucket.programmes;
    let initialIdx = 0;
    if (dayBucket.isToday) {
      for (let i = 0; i < progs.length; i++) {
        if (progs[i].status === 'live') {
          initialIdx = i;
          break;
        }
      }
    }
    this.guideProgIndex = initialIdx;
    listEl.scrollTop = 0;

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < progs.length; i++) {
      const p = progs[i];
      const row = document.createElement('div');
      row.className = 'guide-prog-item status-' + p.status;

      let badgeHtml = '<span class="guide-prog-badge badge-future">ישודר בהמשך</span>';
      if (p.status === 'past') {
        badgeHtml = '<span class="guide-prog-badge badge-catchup">סטארט אובר (OK)</span>';
      } else if (p.status === 'live') {
        badgeHtml = '<span class="guide-prog-badge badge-live-now">• משודר כעת</span>';
      }

      row.innerHTML =
        '<span class="guide-prog-time">' + p.startStr + ' - ' + p.stopStr + '</span>' +
        '<span class="guide-prog-title">' + p.title + '</span>' +
        badgeHtml;

      row.addEventListener('click', () => {
        this.guideProgIndex = i;
        this.updateGuideProgrammeFocus();
        this.closeModals();
        this.startProgrammeCatchup(this.guideChannel || this.selectedChannel, p);
      });

      this.guideProgNodes.push(row);
      fragment.appendChild(row);
    }

    listEl.appendChild(fragment);
    this.updateGuideProgrammeFocus();
  }

  updateGuideProgrammeFocus() {
    const listEl = document.getElementById('guide-programmes-list');
    const target = this.guideProgNodes[this.guideProgIndex];
    if (target && listEl) {
      this.setFocusedElementFast(target);
      this.scrollContainerFast(listEl, target);
    }

    if (this.guideScope === 'vod') {
      const vodItem = Array.isArray(this.vodResults) ? this.vodResults[this.guideProgIndex] : null;
      this._updateVodDetailCard(vodItem);
      return;
    }

    const dayBucket = this.guideDays[this.guideDayIndex];
    const prog = dayBucket && dayBucket.programmes ? dayBucket.programmes[this.guideProgIndex] : null;
    if (prog) {
      const statusEl = document.getElementById('guide-detail-status');
      const titleEl = document.getElementById('guide-detail-title');
      const timeEl = document.getElementById('guide-detail-time');
      const descEl = document.getElementById('guide-detail-desc');

      if (statusEl) {
        if (prog.status === 'past') {
          statusEl.textContent = 'זמין לסטארט אובר (לחץ OK להפעלה)';
          statusEl.className = 'guide-status-badge status-past';
        } else if (prog.status === 'live') {
          statusEl.textContent = '• משודר כעת בשידור חי (לחץ OK לצפייה / סטארט אובר)';
          statusEl.className = 'guide-status-badge status-live';
        } else {
          statusEl.textContent = 'ישודר בהמשך היום';
          statusEl.className = 'guide-status-badge status-future';
        }
      }
      if (titleEl) titleEl.textContent = prog.title;
      if (timeEl) timeEl.textContent = dayBucket.label + ' | ' + prog.startStr + ' - ' + prog.stopStr;
      if (descEl) descEl.textContent = prog.desc || 'שידור ישיר בערוץ.';
    }
  }

  navigateGuideModal(direction) {
    const curEl = this.currentFocusedEl;
    const scopeChBtn = document.getElementById('btn-guide-scope-channel');
    const scopeVodBtn = document.getElementById('btn-guide-scope-vod');
    const vodInput = document.getElementById('vod-search-input');
    const onlyPastBtn = document.getElementById('btn-vod-only-past');
    const closeBtn = document.querySelector('#guide-modal .modal-close-btn');

    if (curEl === closeBtn) {
      if (direction === 'down') {
        const target = this.guideScope === 'vod' ? (scopeVodBtn || scopeChBtn) : (scopeChBtn || scopeVodBtn);
        if (target) this.setFocusedElementFast(target);
      }
      return;
    }

    if (curEl === scopeChBtn || curEl === scopeVodBtn) {
      if (direction === 'left' && scopeVodBtn && curEl !== scopeVodBtn) {
        this.setFocusedElementFast(scopeVodBtn);
        return;
      }
      if (direction === 'right' && scopeChBtn && curEl !== scopeChBtn) {
        this.setFocusedElementFast(scopeChBtn);
        return;
      }
      if (direction === 'up' && closeBtn) {
        this.setFocusedElementFast(closeBtn);
        return;
      }
      if (direction === 'down') {
        if (this.guideScope === 'vod' && vodInput) {
          this.setFocusedElementFast(vodInput);
          return;
        }
        if (this.guideProgNodes.length > 0) {
          this.updateGuideProgrammeFocus();
          return;
        }
      }
      return;
    }

    if (this.guideScope === 'vod' && (curEl === vodInput || curEl === onlyPastBtn)) {
      if (direction === 'left' && onlyPastBtn && curEl !== onlyPastBtn) {
        this.setFocusedElementFast(onlyPastBtn);
        return;
      }
      if (direction === 'right' && vodInput && curEl !== vodInput) {
        this.setFocusedElementFast(vodInput);
        return;
      }
      if (direction === 'up') {
        if (scopeVodBtn || scopeChBtn) this.setFocusedElementFast(scopeVodBtn || scopeChBtn);
        return;
      }
      if (direction === 'down' && this.guideProgNodes.length > 0) {
        this.guideProgIndex = Math.min(this.guideProgIndex || 0, this.guideProgNodes.length - 1);
        this.updateGuideProgrammeFocus();
        return;
      }
      return;
    }

    if (direction === 'down') {
      if (this.guideProgNodes.length === 0) return;
      this.guideProgIndex = (this.guideProgIndex + 1) % this.guideProgNodes.length;
      this.updateGuideProgrammeFocus();
    } else if (direction === 'up') {
      if (this.guideProgIndex <= 0 || this.guideProgNodes.length === 0) {
        if (this.guideScope === 'vod' && vodInput) {
          this.setFocusedElementFast(vodInput);
        } else if (scopeChBtn || scopeVodBtn) {
          this.setFocusedElementFast(scopeChBtn || scopeVodBtn);
        }
        return;
      }
      this.guideProgIndex = this.guideProgIndex - 1;
      this.updateGuideProgrammeFocus();
    } else if (direction === 'left') {
      if (this.guideScope === 'vod') return;
      // In RTL, Left moves to older day (Today -> Yesterday -> 2 days ago ... up to 7 days)
      if (this.guideDayIndex < this.guideDays.length - 1) {
        this.guideDayIndex++;
        this.updateGuideDayTabActive();
        this.renderGuideDayProgrammes();
      }
    } else if (direction === 'right') {
      if (this.guideScope === 'vod') return;
      // In RTL, Right moves toward Today
      if (this.guideDayIndex > 0) {
        this.guideDayIndex--;
        this.updateGuideDayTabActive();
        this.renderGuideDayProgrammes();
      }
    }
  }

  /* --------------------------------------------------------------------------
     Modals (Settings, Multi-M3U, Channel Number Editor & Search)
     -------------------------------------------------------------------------- */

  isModalOpen() {
    return (
      this.mode === 'SETTINGS' ||
      this.mode === 'SEARCH' ||
      this.mode === 'GUIDE' ||
      this.mode === 'OTA' ||
      this.mode === 'ISSUE' ||
      this.mode === 'DISCLAIMER' ||
      this.mode === 'VOICE' ||
      Boolean(this._sleepWarningActive)
    );
  }

  openSettingsModal() {
    this.cancelAutoFullscreen();
    if (!this.isModalOpen()) {
      this._saveFocusBeforeModal();
      this.previousModeBeforeModal = 'BROWSE';
    }
    this.mode = 'SETTINGS';
    this.activeSettingsInputId = 'm3u-url-input';
    this.ensureUiCustomizationDOM();
    this.ensureAppendDefaultBtnDOM();
    this.switchSettingsTab('sources');

    const savedEpg = localStorage.getItem(STORAGE_KEYS.EPG_URL);
    if (savedEpg) {
      const epgInput = document.getElementById('epg-url-input');
      if (epgInput) epgInput.value = savedEpg;
    }

    this.renderSourcesManagerList();
    if (this.otaManager) {
      this.otaManager.startCloudSyncPolling();
      this.otaManager.updateVersionBadgesUI();
    }
    this.ensureUiCustomizationDOM();
    const osd = document.getElementById('fullscreen-osd');
    if (osd) osd.classList.add('hidden');
    const pauseBadge = document.getElementById('video-pause-indicator');
    if (pauseBadge) pauseBadge.classList.add('hidden');
    document.getElementById('settings-modal').classList.remove('hidden');
    this.updateVideoSurfacePosition();
    this.setupModalFocus('#settings-modal');
  }

  switchSettingsTab(tabName) {
    this.ensureUiCustomizationDOM();
    this.activeSettingsTab = tabName;
    const tabs = [
      { key: 'sources', btn: 'tab-btn-sources', panel: 'settings-tab-sources' },
      { key: 'channels', btn: 'tab-btn-channels', panel: 'settings-tab-channels' },
      { key: 'performance', btn: 'tab-btn-performance', panel: 'settings-tab-performance' },
      { key: 'appearance', btn: 'tab-btn-appearance', panel: 'settings-tab-appearance' },
      { key: 'av', btn: 'tab-btn-av', panel: 'settings-tab-av' },
      { key: 'about', btn: 'tab-btn-about', panel: 'settings-tab-about' }
    ];

    tabs.forEach((t) => {
      const b = document.getElementById(t.btn);
      const p = document.getElementById(t.panel);
      if (t.key === tabName) {
        if (b) b.classList.add('active');
        if (p) p.classList.remove('hidden');
      } else {
        if (b) b.classList.remove('active');
        if (p) p.classList.add('hidden');
      }
    });

    if (tabName === 'channels') {
      const editorList = document.getElementById('channel-editor-list');
      if (editorList) editorList.scrollTop = 0;
      this.renderChannelEditorTab();
    } else if (tabName === 'performance') {
      this.renderPerformanceTab();
    } else if (tabName === 'appearance') {
      this.renderAppearanceTab();
    } else if (tabName === 'av') {
      this.renderAvTab();
    } else if (tabName === 'sources') {
      this.ensureAppendDefaultBtnDOM();
      this.renderSourcesManagerList();
    } else if (tabName === 'about') {
      this.ensureDisclaimerDOM();
      this.updateAutoOtaButtonUI();
      if (this.otaManager && typeof this.otaManager.updateVersionBadgesUI === 'function') {
        this.otaManager.updateVersionBadgesUI();
      }
      const aboutTabBtn = document.getElementById('tab-btn-about');
      if (aboutTabBtn) aboutTabBtn.textContent = 'אודות';
    }

    const activePanel = document.getElementById('settings-tab-' + tabName);
    if (activePanel) {
      activePanel.scrollTop = 0;
    }
  }

  renderPerformanceTab() {
    this.ensureThemeControlsDOM();
    const curTheme = this.getTheme();
    const curBuffer = this.player ? this.player.bufferMode : 'smart';
    const curTtl = this.epg ? this.epg.getCacheTtlHours() : 24;

    const themeBtns = document.querySelectorAll('#theme-mode-options .perf-option-btn');
    for (let i = 0; i < themeBtns.length; i++) {
      const btn = themeBtns[i];
      if (btn.dataset.uiTheme === curTheme) {
        btn.classList.add('active-option');
      } else {
        btn.classList.remove('active-option');
      }
    }

    const bufBtns = document.querySelectorAll('#buffer-mode-options .perf-option-btn');
    for (let i = 0; i < bufBtns.length; i++) {
      const btn = bufBtns[i];
      if (btn.dataset.buffer === curBuffer) {
        btn.classList.add('active-option');
      } else {
        btn.classList.remove('active-option');
      }
    }

    const ttlBtns = document.querySelectorAll('#cache-ttl-options .perf-option-btn');
    for (let i = 0; i < ttlBtns.length; i++) {
      const btn = ttlBtns[i];
      if (parseInt(btn.dataset.ttl, 10) === curTtl) {
        btn.classList.add('active-option');
      } else {
        btn.classList.remove('active-option');
      }
    }

    const statusEl = document.getElementById('perf-cache-status');
    if (statusEl) {
      const themeLabel = curTheme === 'glass' ? 'Apple Liquid Glass' : 'קלאסי (Classic)';
      const prof = this.player ? this.player.getBufferProfile() : { label: 'אוטומטי חכם — איכות מדורגת לפי באפר' };
      const ttlLabel =
        curTtl === 0 ? 'ידני בלבד' : curTtl === 24 ? 'כל 24 שעות' : curTtl === 72 ? 'כל 3 ימים' : 'כל 7 ימים';
      statusEl.textContent = 'ערכת נושא: ' + themeLabel + ' | באפר: ' + prof.label + ' | רענון לוח שידורים: ' + ttlLabel;
    }
  }

  renderSourcesManagerList() {
    const listEl = document.getElementById('m3u-sources-list');
    const countBadge = document.getElementById('sources-count-badge');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (countBadge) {
      countBadge.textContent = this.store.sources.length + ' מקורות M3U';
    }

    this.store.sources.forEach((src) => {
      const row = document.createElement('div');
      row.className = 'source-item-row';
      row.innerHTML =
        '<span class="source-item-name">' + src.name + '</span>' +
        '<span class="source-item-url">' + src.url + '</span>' +
        '<button class="source-item-btn focusable" data-toggle-src="' + src.id + '">' +
          (src.enabled ? 'פעיל ✓' : 'כבוי ✕') +
        '</button>' +
        (this.store.sources.length > 1
          ? '<button class="source-item-btn focusable" data-del-src="' + src.id + '">מחק ✕</button>'
          : '');

      const toggleBtn = row.querySelector('[data-toggle-src]');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
          this.store.updateSource(src.id, { enabled: !src.enabled });
          this.renderSourcesManagerList();
        });
      }

      const delBtn = row.querySelector('[data-del-src]');
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          this.store.removeSource(src.id);
          this.renderSourcesManagerList();
        });
      }

      listEl.appendChild(row);
    });
  }

  renderChannelEditorTab() {
    const filtersEl = document.getElementById('editor-source-filters');
    const listEl = document.getElementById('channel-editor-list');
    if (!filtersEl || !listEl) return;

    filtersEl.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.className = 'source-item-btn focusable' + (this.editorSourceFilter === 'ALL' ? ' active-filter' : '');
    allBtn.textContent = 'כל המקורות (' + this.store.rawChannels.length + ')';
    allBtn.addEventListener('click', () => {
      this.editorSourceFilter = 'ALL';
      this.renderChannelEditorTab();
    });
    filtersEl.appendChild(allBtn);

    this.store.sources.forEach((src) => {
      const btn = document.createElement('button');
      btn.className = 'source-item-btn focusable' + (this.editorSourceFilter === src.id ? ' active-filter' : '');
      btn.textContent = src.name;
      btn.addEventListener('click', () => {
        this.editorSourceFilter = src.id;
        this.renderChannelEditorTab();
      });
      filtersEl.appendChild(btn);
    });

    listEl.innerHTML = '';
    const filteredRaw = this.store.rawChannels
      .filter((ch) => this.editorSourceFilter === 'ALL' || ch.sourceId === this.editorSourceFilter)
      .slice(0, 120);

    const fragment = document.createDocumentFragment();
    filteredRaw.forEach((ch) => {
      const ov = this.store.overrides[ch.uid] || {};
      const isEnabled = typeof ov.enabled === 'boolean' ? ov.enabled : true;
      const curNum = typeof ov.customNumber === 'number' ? ov.customNumber : ch.number;

      const row = document.createElement('div');
      row.className = 'editor-channel-row' + (isEnabled ? '' : ' disabled-channel');
      row.innerHTML =
        '<div class="editor-ch-info">' +
          '<span class="editor-ch-num-badge">#' + curNum + '</span>' +
          '<span class="editor-ch-name">' + ch.name + '</span>' +
          '<span class="editor-ch-source">' + (ch.sourceName || 'M3U') + '</span>' +
        '</div>' +
        '<div class="editor-ch-actions">' +
          '<button class="editor-btn ' + (isEnabled ? 'toggle-on' : 'toggle-off') + ' focusable" data-act="toggle">' +
            (isEnabled ? 'מוצג ✓' : 'מוסתר ✕') +
          '</button>' +
          '<button class="editor-btn focusable" data-act="num-up" data-uid="' + ch.uid + '">מספר +1 ▲</button>' +
          '<button class="editor-btn focusable" data-act="num-down" data-uid="' + ch.uid + '">מספר -1 ▼</button>' +
        '</div>';

      row.querySelector('[data-act="toggle"]').addEventListener('click', () => {
        this.store.setChannelOverride(ch.uid, { enabled: !isEnabled, customNumber: curNum });
        this.allChannels = this.store.compiledChannels;
        this.applyChannelFilter();
        this.renderChannelEditorTab();
      });

      row.querySelector('[data-act="num-up"]').addEventListener('click', () => {
        this.store.setChannelOverride(ch.uid, { enabled: isEnabled, customNumber: curNum + 1 });
        this.allChannels = this.store.compiledChannels;
        this.applyChannelFilter();
        this.renderChannelEditorTab();
      });

      row.querySelector('[data-act="num-down"]').addEventListener('click', () => {
        this.store.setChannelOverride(ch.uid, { enabled: isEnabled, customNumber: Math.max(1, curNum - 1) });
        this.allChannels = this.store.compiledChannels;
        this.applyChannelFilter();
        this.renderChannelEditorTab();
      });

      fragment.appendChild(row);
    });

    listEl.appendChild(fragment);
  }

  handleModalNumberKey(digit) {
    if (this.mode === 'SEARCH') {
      this.handleSearchKey(digit);
      return;
    }

    if (this.mode === 'SETTINGS') {
      // If focused on a channel number button in Channel Editor tab, let user type exact channel number!
      if (this.currentFocusedEl && this.currentFocusedEl.dataset && this.currentFocusedEl.dataset.uid) {
        const uid = this.currentFocusedEl.dataset.uid;
        this.editorNumberBuffer += digit;
        clearTimeout(this.editorNumberTimer);
        this.showToast('קובע מספר ערוץ: ' + this.editorNumberBuffer);
        this.editorNumberTimer = setTimeout(() => {
          const newNum = parseInt(this.editorNumberBuffer, 10);
          this.editorNumberBuffer = '';
          if (!isNaN(newNum) && newNum > 0) {
            this.store.setChannelOverride(uid, { enabled: true, customNumber: newNum });
            this.allChannels = this.store.compiledChannels;
            this.applyChannelFilter();
            this.renderChannelEditorTab();
            this.showToast('מספר הערוץ עודכן ל-' + newNum);
          }
        }, 900);
        return;
      }

      // Otherwise append digit to active input (e.g. PC Sync IP or M3U URL)
      const input = document.getElementById(this.activeSettingsInputId || 'pc-sync-input');
      if (input) {
        input.value += digit;
      }
    }
  }

  openSearchModal() {
    this.cancelAutoFullscreen();
    if (!this.isModalOpen()) {
      this._saveFocusBeforeModal();
      this.previousModeBeforeModal = 'BROWSE';
    }
    this.mode = 'SEARCH';
    document.getElementById('search-modal').classList.remove('hidden');
    this.updateVideoSurfacePosition();
    this.renderSearchKeyboard();
    const searchInput = document.getElementById('search-query-input');
    this.filterChannels(searchInput ? searchInput.value : '');
    this.setupModalFocus('#search-modal');
  }

  closeModals() {
    if (this.mode === 'DISCLAIMER') {
      if (this._disclaimerFromSettings) {
        this.closeDisclaimerModal();
      }
      return;
    }
    if (this._sleepWarningActive) {
      this.cancelSleepWarning(true);
    }
    this._stopActiveSpeechRecognition();
    if (this.otaManager) {
      this.otaManager.stopCloudSyncPolling();
    }
    const modals = document.querySelectorAll('.modal-backdrop');
    for (let i = 0; i < modals.length; i++) {
      modals[i].classList.add('hidden');
      if (modals[i].id === 'voice-overlay' || modals[i].id === 'sleep-warning-modal') {
        modals[i].setAttribute('aria-hidden', 'true');
      }
    }
    if (this.previousModeBeforeModal === 'FULLSCREEN') {
      this._savedFocusContext = null;
      this.mode = 'FULLSCREEN';
      this.cancelAutoFullscreen();
      this.updateVideoSurfacePosition();
      this.updateStreamStatsOverlay();
    } else {
      this.mode = 'BROWSE';
      this.updateStreamStatsOverlay();
      this.updateVideoSurfacePosition(true);
      this._restoreFocusAfterModal();
      if (this.focusArea === 'channels') {
        this.scheduleAutoFullscreen();
      }
    }
  }

  setupModalFocus(modalSelector) {
    const modal = document.querySelector(modalSelector);
    if (!modal) return;
    const bodies = modal.querySelectorAll('.modal-body:not(.hidden)');
    for (let i = 0; i < bodies.length; i++) {
      bodies[i].scrollTop = 0;
    }
    const focusables = Array.from(modal.querySelectorAll('.focusable')).filter(
      (el) => el.offsetWidth > 0 || el.offsetHeight > 0
    );
    if (focusables.length > 0) {
      this.focusedModalIndex = focusables.length > 1 ? 1 : 0;
      const initialTarget = focusables[this.focusedModalIndex];
      this.setFocusedElementFast(initialTarget);
      this.scrollModalTargetIntoView(initialTarget);
    }
  }

  findModalScrollContainer(target) {
    let node = target ? target.parentElement : null;
    while (node && node !== document.body) {
      if (
        node.id === 'channel-editor-list' ||
        node.id === 'search-results-list' ||
        node.id === 'guide-programmes-list' ||
        (
          node.classList &&
          (
            node.classList.contains('modal-body') ||
            node.classList.contains('settings-tab-content') ||
            node.classList.contains('disclaimer-body')
          )
        )
      ) {
        if (node.scrollHeight > node.clientHeight + 2) {
          return node;
        }
      }
      if (node.classList && node.classList.contains('modal-card')) {
        break;
      }
      node = node.parentElement;
    }
    return null;
  }

  scrollModalTargetIntoView(target) {
    if (!target) return;
    const container = this.findModalScrollContainer(target);
    if (!container) return;

    const cRect = container.getBoundingClientRect();
    const tRect = target.getBoundingClientRect();
    const scale = container.clientHeight > 0 && cRect.height > 0 ? (cRect.height / container.clientHeight) : 1;
    const factor = scale > 0 ? scale : 1;
    const relTop = (tRect.top - cRect.top) / factor;
    const relBottom = (tRect.bottom - cRect.top) / factor;
    const viewHeight = container.clientHeight;
    const maxScroll = Math.max(0, container.scrollHeight - viewHeight);
    if (maxScroll <= 0) return;

    const pad = 28;
    let nextScrollTop = container.scrollTop;

    let cardTop = null;
    if (nextScrollTop > 0) {
      let ancestor = target.parentElement;
      while (ancestor && ancestor !== container) {
        if (
          ancestor.classList &&
          (ancestor.classList.contains('perf-section-card') || ancestor.classList.contains('ui-pref-card'))
        ) {
          const ct = (ancestor.getBoundingClientRect().top - cRect.top) / factor;
          if (relTop - ct <= 210) {
            cardTop = ct;
          }
          break;
        }
        ancestor = ancestor.parentElement;
      }
    }

    if (cardTop !== null && cardTop < pad && relBottom <= viewHeight - pad) {
      nextScrollTop = Math.max(0, nextScrollTop + cardTop - pad);
      if (nextScrollTop <= 140) {
        nextScrollTop = 0;
      }
    } else if (relTop < pad) {
      const desiredTop = cardTop !== null && cardTop < pad ? cardTop : relTop;
      nextScrollTop = Math.max(0, nextScrollTop + desiredTop - pad);
      if (nextScrollTop <= 140) {
        nextScrollTop = 0;
      }
    } else if (relBottom > viewHeight - pad) {
      nextScrollTop = Math.min(maxScroll, nextScrollTop + (relBottom - viewHeight) + pad);
      if (maxScroll - nextScrollTop <= 90) {
        nextScrollTop = maxScroll;
      }
    }

    if (nextScrollTop !== container.scrollTop) {
      container.scrollTop = Math.round(nextScrollTop);
    }
  }

  resetActiveModalScroll() {
    if (typeof document === 'undefined') return;
    const activeModal = document.querySelector('.modal-backdrop:not(.hidden)');
    if (!activeModal) return;
    const visibleBody = activeModal.querySelector('.modal-body:not(.hidden), .disclaimer-body');
    if (visibleBody && visibleBody.scrollTop > 0) {
      visibleBody.scrollTop = 0;
    }
  }

  scrollActiveModalBy(deltaPx) {
    if (typeof document === 'undefined' || !deltaPx) return;
    const activeModal = document.querySelector('.modal-backdrop:not(.hidden)');
    if (!activeModal) return;

    const candidates = [
      activeModal.querySelector('#guide-programmes-list'),
      activeModal.querySelector('#channel-editor-list'),
      activeModal.querySelector('#search-results-list'),
      activeModal.querySelector('.modal-body:not(.hidden)'),
      activeModal.querySelector('.disclaimer-body')
    ];
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (el && el.offsetHeight > 0 && el.scrollHeight > el.clientHeight + 2) {
        const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
        el.scrollTop = Math.max(0, Math.min(maxScroll, el.scrollTop + deltaPx));
        return;
      }
    }
  }

  navigateModal(direction) {
    const activeModal = document.querySelector('.modal-backdrop:not(.hidden)');
    if (!activeModal) return;

    const allFocusables = activeModal.querySelectorAll('.focusable');
    const focusables = [];
    const rects = [];
    for (let i = 0; i < allFocusables.length; i++) {
      const r = allFocusables[i].getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        focusables.push(allFocusables[i]);
        rects.push(r);
      }
    }
    if (focusables.length === 0) return;

    const curIdx = focusables.indexOf(this.currentFocusedEl);
    const activeIdx = curIdx !== -1 ? curIdx : 0;
    const curRect = rects[activeIdx];
    const curCx = curRect.left + curRect.width / 2;
    const curCy = curRect.top + curRect.height / 2;

    let bestIndex = -1;
    let bestScore = Infinity;

    if (direction === 'left' || direction === 'right') {
      let bestRowIndex = -1;
      let bestRowScore = Infinity;
      let bestNearIndex = -1;
      let bestNearScore = Infinity;

      for (let i = 0; i < focusables.length; i++) {
        if (i === activeIdx) continue;
        const rect = rects[i];
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const vOverlap = Math.min(rect.bottom, curRect.bottom) - Math.max(rect.top, curRect.top);
        const rowTol = Math.max(24, Math.min(curRect.height, rect.height) * 0.45);
        const isSameRow = vOverlap > 4 || Math.abs(cy - curCy) <= rowTol;

        if (isSameRow) {
          const inDir =
            direction === 'left'
              ? (rect.right <= curRect.left + 12 && cx < curCx - 8)
              : (rect.left >= curRect.right - 12 && cx > curCx + 8);
          if (!inDir) continue;
          const hGap =
            direction === 'left'
              ? Math.max(0, curRect.left - rect.right)
              : Math.max(0, rect.left - curRect.right);
          const rowScore = hGap + Math.abs(cy - curCy) * 4;
          if (rowScore < bestRowScore) {
            bestRowScore = rowScore;
            bestRowIndex = i;
          }
        } else if (Math.abs(cy - curCy) <= 120) {
          const inNearDir = direction === 'left' ? cx < curCx - 12 : cx > curCx + 12;
          if (!inNearDir) continue;
          const hGap =
            direction === 'left'
              ? Math.max(0, curRect.left - rect.right)
              : Math.max(0, rect.left - curRect.right);
          const nearScore = hGap + Math.abs(cy - curCy) * 8;
          if (nearScore < bestNearScore) {
            bestNearScore = nearScore;
            bestNearIndex = i;
          }
        }
      }

      bestIndex = bestRowIndex !== -1 ? bestRowIndex : bestNearIndex;
    } else {
      let curBody = null;
      let bp = this.currentFocusedEl ? this.currentFocusedEl.parentElement : null;
      while (bp && bp !== activeModal) {
        if (bp.classList && bp.classList.contains('modal-body')) {
          curBody = bp;
          break;
        }
        bp = bp.parentElement;
      }
      const isHeaderEl = (el) => {
        let p = el ? el.parentElement : null;
        while (p && p !== activeModal) {
          if (p.classList && p.classList.contains('modal-header')) return true;
          p = p.parentElement;
        }
        return false;
      };
      let bestBodyIndex = -1;
      let bestBodyScore = Infinity;

      for (let i = 0; i < focusables.length; i++) {
        if (i === activeIdx) continue;
        const rect = rects[i];
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        const inVertDir =
          direction === 'down'
            ? (rect.top >= curRect.bottom - 10 && cy > curCy + 10)
            : (rect.bottom <= curRect.top + 10 && cy < curCy - 10);
        if (!inVertDir) continue;

        const vGap =
          direction === 'down'
            ? Math.max(0, rect.top - curRect.bottom)
            : Math.max(0, curRect.top - rect.bottom);

        let hGap = 0;
        if (rect.right < curRect.left) {
          hGap = curRect.left - rect.right;
        } else if (rect.left > curRect.right) {
          hGap = rect.left - curRect.right;
        }

        // Tiny RTL right-first tie-breaker when vertical & edge overlap distances are identical
        const score = vGap + hGap * 1.6 + Math.abs(cx - curCx) * 0.05 - cx * 0.0005;
        if (score < bestScore) {
          bestScore = score;
          bestIndex = i;
        }
        if (direction === 'up' && curBody && curBody.contains(focusables[i]) && !isHeaderEl(focusables[i])) {
          if (score < bestBodyScore) {
            bestBodyScore = score;
            bestBodyIndex = i;
          }
        }
      }

      if (direction === 'up' && curBody && bestBodyIndex !== -1 && bestIndex !== -1 && isHeaderEl(focusables[bestIndex])) {
        bestIndex = bestBodyIndex;
      }
    }

    if (bestIndex === -1) {
      bestIndex = activeIdx;
    }

    this.focusedModalIndex = bestIndex;
    const target = focusables[bestIndex];
    if (target) {
      this.setFocusedElementFast(target);
      if (target.tagName === 'INPUT') {
        this.activeSettingsInputId = target.id;
      }
      let inModalHeader = false;
      let p = target.parentElement;
      while (p && p !== activeModal) {
        if (p.classList && p.classList.contains('modal-header')) {
          inModalHeader = true;
          break;
        }
        p = p.parentElement;
      }
      if (inModalHeader) {
        this.resetActiveModalScroll();
      } else {
        this.scrollModalTargetIntoView(target);
      }
    }
  }

  renderSearchKeyboard() {
    const kbContainer = document.getElementById('search-keyboard');
    if (!kbContainer || kbContainer.children.length > 0) return;

    const rows = [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
      ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י'],
      ['כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ', 'ק', 'ר'],
      ['ש', 'ת', 'ם', 'ן', 'ץ', 'ף', 'ך', '-', 's', 'h']
    ];

    rows.forEach((row) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'kb-row';
      row.forEach((char) => {
        const btn = document.createElement('button');
        btn.className = 'kb-key focusable';
        btn.dataset.char = char;
        btn.textContent = char;
        btn.addEventListener('click', () => this.handleSearchKey(char));
        rowEl.appendChild(btn);
      });
      kbContainer.appendChild(rowEl);
    });

    const actionRow = document.createElement('div');
    actionRow.className = 'kb-row';
    actionRow.innerHTML =
      '<button class="kb-key kb-key-wide focusable" data-kb="backspace">מחק ◀</button>' +
      '<button class="kb-key kb-key-space focusable" data-kb="space">רווח</button>' +
      '<button class="kb-key kb-key-wide focusable" data-kb="clear">נקה הכל</button>';

    actionRow.querySelector('[data-kb="backspace"]').addEventListener('click', () => this.handleSearchKey('backspace'));
    actionRow.querySelector('[data-kb="space"]').addEventListener('click', () => this.handleSearchKey(' '));
    actionRow.querySelector('[data-kb="clear"]').addEventListener('click', () => this.handleSearchKey('clear'));

    kbContainer.appendChild(actionRow);
  }

  handleSearchKey(char) {
    const input = document.getElementById('search-query-input');
    if (!input) return;

    if (char === 'backspace') {
      input.value = input.value.slice(0, -1);
    } else if (char === 'clear') {
      input.value = '';
    } else {
      input.value += char;
    }
    this.filterChannels(input.value);
  }

  filterChannels(query) {
    const listEl = document.getElementById('search-results-list');
    const countEl = document.getElementById('search-results-count');
    if (!listEl || !countEl) return;
    listEl.innerHTML = '';

    const q = query.trim().toLowerCase();
    if (!q) {
      countEl.textContent = '0';
      listEl.innerHTML =
        '<div class="empty-state-card">' +
          '<div class="empty-state-icon">🔍</div>' +
          '<div class="empty-state-title">חיפוש ערוץ מהיר</div>' +
          '<div class="empty-state-desc">הקלד שם ערוץ, קטגוריה או מספר ערוץ במקלדת משמאל.</div>' +
        '</div>';
      return;
    }

    const matches = this.allChannels
      .filter(
        (c) =>
          c.name.toLowerCase().indexOf(q) !== -1 ||
          String(c.number) === q ||
          (c.group && c.group.toLowerCase().indexOf(q) !== -1)
      )
      .slice(0, 30);

    countEl.textContent = matches.length.toString();

    if (matches.length === 0) {
      listEl.innerHTML =
        '<div class="empty-state-card">' +
          '<div class="empty-state-icon">😕</div>' +
          '<div class="empty-state-title">לא נמצאו ערוצים תואמים</div>' +
          '<div class="empty-state-desc">נסה להקליד שם חלקי או מספר ערוץ אחר.</div>' +
        '</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    matches.forEach((ch) => {
      const row = document.createElement('div');
      row.className = 'channel-item focusable';
      row.innerHTML =
        '<span class="channel-number">' + ch.number + '</span>' +
        '<div class="channel-text-col">' +
          '<span class="channel-title">' + ch.name + '</span>' +
          '<span class="channel-epg-sub">' + (ch.group || 'טלוויזיה חיה') + '</span>' +
        '</div>' +
        '<span class="channel-ok-pill">OK לצפייה ▶</span>';

      row.addEventListener('click', () => {
        this.closeModals();
        const idx = this.visibleChannels.findIndex((c) => c.id === ch.id);
        if (idx !== -1) this.focusedChannelIndex = idx;
        this.highlightChannel(ch, true);
        this.enterFullscreen();
      });
      frag.appendChild(row);
    });
    listEl.appendChild(frag);
  }

  /* --------------------------------------------------------------------------
     DOM Event Bindings
     -------------------------------------------------------------------------- */

  bindDOMEvents() {
    // Delegated click & passive scroll listeners on #channel-list (zero per-row listeners!)
    const channelListEl = document.getElementById('channel-list');
    if (channelListEl) {
      this._channelListEl = channelListEl;
      channelListEl.addEventListener('click', (e) => {
        let node = e.target;
        while (node && node !== channelListEl) {
          if (node.classList && node.classList.contains('channel-item')) break;
          node = node.parentNode;
        }
        if (!node || node === channelListEl || !node.dataset) return;
        const idx = parseInt(node.dataset.index, 10);
        if (isNaN(idx)) return;
        const ch = this.visibleChannels[idx];
        if (!ch) return;
        this.focusArea = 'channels';
        this.focusedChannelIndex = idx;
        this.updateChannelFocusFast();
        const prefs = this.getUiPrefs();
        if (this.selectedChannel && this.selectedChannel.id === ch.id) {
          if (
            prefs.previewAutoplay === 'off' &&
            this.player &&
            !this.player.hls &&
            !this.player._isNativePlayback &&
            !this.player._isPlaying
          ) {
            this.highlightChannel(ch, true);
          }
          this.enterFullscreen();
        } else {
          this.highlightChannel(ch, true);
          if (prefs.previewAutoplay === 'off' || prefs.singleClickFullscreen === true) {
            this.enterFullscreen();
          } else {
            this.scheduleAutoFullscreen();
          }
        }
      });

      const onListScroll = () => {
        if (this._lastProgrammaticScrollMs && (Date.now() - this._lastProgrammaticScrollMs) < 120) {
          return;
        }
        this._cachedListScrollTop = channelListEl.scrollTop;
        this._scheduleVisibleEpgWindowSync();
      };
      try {
        channelListEl.addEventListener('scroll', onListScroll, { passive: true });
      } catch (e) {
        channelListEl.addEventListener('scroll', onListScroll, false);
      }
    }

    const videoSurface = document.getElementById('video-surface');
    if (videoSurface) {
      videoSurface.addEventListener('click', () => {
        if (this.mode === 'FULLSCREEN') {
          const osd = document.getElementById('fullscreen-osd');
          const isOsdVisible = osd && !osd.classList.contains('hidden');
          if (!isOsdVisible) {
            if (this.selectedChannel) this.updateOSD(this.selectedChannel, false);
            this.showOSD();
          } else {
            this.togglePlayPause();
            this.showOSD();
          }
        } else {
          this.enterFullscreen();
        }
      });
    }

    const previewFrame = document.getElementById('preview-frame');
    if (previewFrame) {
      previewFrame.addEventListener('click', () => {
        this.enterFullscreen();
      });
    }

    const btnOsdExitFullscreen = document.getElementById('btn-osd-exit-fullscreen');
    if (btnOsdExitFullscreen) {
      btnOsdExitFullscreen.addEventListener('click', (e) => {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        this.exitFullscreen();
      });
    }

    // Header buttons
    const btnFilterFavs = document.getElementById('btn-filter-favs');
    if (btnFilterFavs) btnFilterFavs.addEventListener('click', () => this.toggleFavoritesFilter());

    const btnToggleFav = document.getElementById('btn-toggle-favorite');
    if (btnToggleFav) btnToggleFav.addEventListener('click', () => this.toggleFavorite());

    const btnOpenGuide = document.getElementById('btn-open-guide');
    if (btnOpenGuide) btnOpenGuide.addEventListener('click', () => this.openGuideModal());

    const btnCardGuide = document.getElementById('btn-card-full-guide');
    if (btnCardGuide) btnCardGuide.addEventListener('click', () => this.openGuideModal());

    const btnSearch = document.getElementById('btn-search-trigger');
    if (btnSearch) btnSearch.addEventListener('click', () => this.openSearchModal());

    const btnSettings = document.getElementById('btn-open-settings');
    if (btnSettings) btnSettings.addEventListener('click', () => this.openSettingsModal());

    // Settings Tabs
    const tabBtnSources = document.getElementById('tab-btn-sources');
    const tabBtnChannels = document.getElementById('tab-btn-channels');
    const tabBtnPerf = document.getElementById('tab-btn-performance');
    const tabBtnAppearance = document.getElementById('tab-btn-appearance');
    const tabBtnAv = document.getElementById('tab-btn-av');
    const tabBtnAbout = document.getElementById('tab-btn-about');
    if (tabBtnSources) tabBtnSources.addEventListener('click', () => this.switchSettingsTab('sources'));
    if (tabBtnChannels) tabBtnChannels.addEventListener('click', () => this.switchSettingsTab('channels'));
    if (tabBtnPerf) tabBtnPerf.addEventListener('click', () => this.switchSettingsTab('performance'));
    if (tabBtnAppearance && tabBtnAppearance.dataset && tabBtnAppearance.dataset.uiBound !== '1') {
      tabBtnAppearance.dataset.uiBound = '1';
      tabBtnAppearance.addEventListener('click', () => this.switchSettingsTab('appearance'));
    }
    if (tabBtnAv && tabBtnAv.dataset && tabBtnAv.dataset.avBound !== '1') {
      tabBtnAv.dataset.avBound = '1';
      tabBtnAv.addEventListener('click', () => this.switchSettingsTab('av'));
    }
    if (tabBtnAbout) tabBtnAbout.addEventListener('click', () => this.switchSettingsTab('about'));

    this.ensureThemeControlsDOM();
    this.ensureUiCustomizationDOM();
    this.ensureVodHeaderBtnDOM();
    this.ensurePowerSaveDOM();
    this.ensureVoiceDOM();
    this.ensureAppendDefaultBtnDOM();
    this.renderAppearanceTab();
    this.renderAvTab();

    if (typeof document !== 'undefined' && !this._audioClickUnlockBound) {
      this._audioClickUnlockBound = true;
      document.addEventListener('click', () => {
        if (this.player && this.player.video) {
          if (this.player.video.muted && !this.player.userPaused) {
            this.player.video.muted = false;
          }
          if (typeof this.player.applyEffectiveVolume === 'function') {
            this.player.applyEffectiveVolume();
          }
          if (typeof this.player.resumeAudioPipeline === 'function') {
            const avPrefs = this.getAvPrefs();
            if (avPrefs.audioNormMode !== 'off' || avPrefs.audioVoiceBoost) {
              this.player.resumeAudioPipeline();
            }
          }
        }
      }, true);
    }

    // Buffer Mode option buttons
    const bufBtns = document.querySelectorAll('#buffer-mode-options .perf-option-btn');
    for (let i = 0; i < bufBtns.length; i++) {
      const btn = bufBtns[i];
      btn.addEventListener('click', () => {
        const mode = btn.dataset.buffer;
        if (this.player && mode) {
          this.player.setBufferMode(mode);
          this.renderPerformanceTab();
          this.showToast('גודל הבאפר עודכן: ' + this.player.getBufferProfile().label);
        }
      });
    }

    // Cache TTL option buttons
    const ttlBtns = document.querySelectorAll('#cache-ttl-options .perf-option-btn');
    for (let i = 0; i < ttlBtns.length; i++) {
      const btn = ttlBtns[i];
      btn.addEventListener('click', () => {
        const hours = parseInt(btn.dataset.ttl, 10);
        if (this.epg && !isNaN(hours)) {
          this.epg.setCacheTtlHours(hours);
          this.renderPerformanceTab();
          const label = hours === 0 ? 'ידני בלבד' : 'כל ' + hours + ' שעות';
          this.showToast('תדירות עדכון לוח השידורים והקאש הוגדרה ל: ' + label);
        }
      });
    }

    // Force Refresh Cache & Clear Cache buttons
    const btnForceRefresh = document.getElementById('btn-force-refresh-cache');
    if (btnForceRefresh) {
      btnForceRefresh.addEventListener('click', () => {
        this.loadActiveEPGSources(true);
        this.refreshAllSources(false);
        this.showToast('מרענן כעת את כל הערוצים ולוח השידורים...');
      });
    }

    const btnClearCache = document.getElementById('btn-clear-all-cache');
    if (btnClearCache) {
      btnClearCache.addEventListener('click', () => {
        this.store.clearLineupCache();
        this.epg.clearCache();
        if (this.player && typeof this.player.resetChannelHealthMap === 'function') {
          this.player.resetChannelHealthMap();
        }
        this.renderPerformanceTab();
        this.showToast('זיכרון הקאש ונתוני הערוצים נוקו בהצלחה!');
      });
    }

    // Check Cloud M3U Push from Phone QR / PC 4-Digit Code
    const btnCheckCloudPush = document.getElementById('btn-check-cloud-push');
    if (btnCheckCloudPush) {
      btnCheckCloudPush.addEventListener('click', () => {
        if (this.otaManager) {
          this.otaManager.pollCloudM3UPush(false);
        }
      });
    }

    // Check OTA Update Now Button (in About Tab)
    const btnCheckOtaNow = document.getElementById('btn-check-ota-now');
    if (btnCheckOtaNow) {
      btnCheckOtaNow.addEventListener('click', () => {
        if (this.otaManager) {
          this.otaManager.checkForOTAUpdate(true);
        }
      });
    }

    // PC Sync Button
    const btnSyncPc = document.getElementById('btn-sync-pc');
    if (btnSyncPc) {
      btnSyncPc.addEventListener('click', () => {
        const hostInput = document.getElementById('pc-sync-input');
        const val = hostInput ? hostInput.value.trim() : '';
        const statusText = document.getElementById('settings-status-text');
        if (statusText) statusText.textContent = 'מתחבר למחשב ומסנכרן רשימות M3U ומיפוי ערוצים...';
        this.store
          .syncFromPc(val)
          .then((summary) => {
            if (summary.epgUrl) {
              localStorage.setItem(STORAGE_KEYS.EPG_URL, summary.epgUrl);
              this.epg.loadEPG(summary.epgUrl, () => this.refreshVisibleEPGLabels(), false, this.allChannels);
            }
            this.allChannels = this.store.compiledChannels;
            this.applyChannelFilter();
            this.restoreLastWatchedChannel();
            this.renderSourcesManagerList();
            if (statusText) {
              statusText.textContent =
                'סונכרן בהצלחה מהמחשב! (' + summary.sourcesCount + ' מקורות, ' + this.allChannels.length + ' ערוצים מותאמים).';
            }
            this.showToast('סונכרן בהצלחה מהמחשב! (' + this.allChannels.length + ' ערוצים)');
            this.closeModals();
          })
          .catch((err) => {
            if (statusText) statusText.textContent = 'שגיאת סנכרון: ' + err.message;
            this.showToast('שגיאת סנכרון: ' + err.message);
          });
      });
    }

    // Add M3U Source Button
    const btnAddSource = document.getElementById('btn-add-source');
    if (btnAddSource) {
      btnAddSource.addEventListener('click', () => {
        const nameIn = document.getElementById('m3u-source-name-input');
        const urlIn = document.getElementById('m3u-url-input');
        const url = urlIn ? urlIn.value.trim() : '';
        const name = nameIn ? nameIn.value.trim() : '';
        if (!url) {
          this.showToast('נא להזין כתובת קישור M3U');
          return;
        }
        this.store.addSource(name, url);
        if (nameIn) nameIn.value = '';
        if (urlIn) urlIn.value = '';
        this.renderSourcesManagerList();
        this.showToast('מקור M3U נוסף לרשימה! לחץ "שמור וטען" למיזוג.');
      });
    }

    // Local .m3u/.m3u8 file upload button (especially useful in Laptop / Desktop Web Player)
    const btnUploadLocalM3u = document.getElementById('btn-upload-local-m3u');
    const localM3uInput = document.getElementById('m3u-local-file-input');
    if (btnUploadLocalM3u && localM3uInput) {
      btnUploadLocalM3u.addEventListener('click', () => {
        localM3uInput.value = '';
        localM3uInput.click();
      });
      localM3uInput.addEventListener('change', (e) => {
        const file = e && e.target && e.target.files ? e.target.files[0] : null;
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const text = typeof reader.result === 'string' ? reader.result.trim() : '';
          if (!text || (text.indexOf('#EXT') === -1 && text.indexOf('http') === -1)) {
            this.showToast('הקובץ שנבחר אינו מכיל רשימת ערוצי M3U תקינה');
            return;
          }
          const cleanName = String(file.name || 'קובץ מקומי').replace(/\.(m3u8?|txt)$/i, '');
          const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
          try {
            if (this.store.sources.length === 1 && this.store.sources[0].url === DEFAULT_SAMPLE_M3U) {
              this.store.updateSource(this.store.sources[0].id, {
                name: cleanName,
                url: dataUrl,
                enabled: true
              });
            } else {
              this.store.addSource(cleanName, dataUrl);
            }
            this.renderSourcesManagerList();
            this.refreshAllSources(false);
            this.closeModals();
            this.showToast('קובץ ' + cleanName + ' נטען בהצלחה!');
          } catch (saveErr) {
            this.showToast('קובץ ה-M3U גדול מדי לשמירה בדפדפן — נסה קישור URL');
          }
        };
        reader.onerror = () => {
          this.showToast('שגיאה בקריאת הקובץ מהמחשב');
        };
        reader.readAsText(file);
      });
    }

    // Search input typing
    const searchInput = document.getElementById('search-query-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => this.filterChannels(e.target.value));
    }

    // Track active Settings input for virtual keyboard
    ['pc-sync-input', 'm3u-source-name-input', 'm3u-url-input', 'epg-url-input'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('focus', () => {
          this.activeSettingsInputId = id;
        });
        el.addEventListener('click', () => {
          this.activeSettingsInputId = id;
        });
      }
    });

    // Bottom Color hints
    const hintRed = document.getElementById('hint-red');
    const hintGreen = document.getElementById('hint-green');
    const hintYellow = document.getElementById('hint-yellow');
    const hintBlue = document.getElementById('hint-blue');
    if (hintRed) hintRed.addEventListener('click', () => this.onRedButton());
    if (hintGreen) hintGreen.addEventListener('click', () => this.onGreenButton());
    if (hintYellow) hintYellow.addEventListener('click', () => this.onYellowButton());
    if (hintBlue) hintBlue.addEventListener('click', () => this.onBlueButton());

    // Reset to sample playlist
    const btnLoadSample = document.getElementById('btn-load-sample');
    if (btnLoadSample) {
      btnLoadSample.addEventListener('click', () => {
        this.store.sources = [{ id: 'src_1', name: 'פלייליסט ראשי', url: DEFAULT_SAMPLE_M3U, enabled: true }];
        this.store.overrides = {};
        this.store.saveSources();
        this.store.saveOverrides();
        this.refreshAllSources(false);
        this.closeModals();
      });
    }

    // Save & Load All M3U Sources
    const btnSavePlaylist = document.getElementById('btn-save-playlist');
    if (btnSavePlaylist) {
      btnSavePlaylist.addEventListener('click', () => {
        // If user typed a URL in m3u-url-input without clicking "+ הוסף מקור M3U", add or update it automatically!
        const pendingUrlEl = document.getElementById('m3u-url-input');
        const pendingNameEl = document.getElementById('m3u-source-name-input');
        if (pendingUrlEl && pendingUrlEl.value.trim()) {
          const typedUrl = pendingUrlEl.value.trim();
          const typedName = pendingNameEl ? pendingNameEl.value.trim() : '';
          if (this.store.sources.length === 1 && this.store.sources[0].url === DEFAULT_SAMPLE_M3U) {
            this.store.updateSource(this.store.sources[0].id, {
              name: typedName || 'פלייליסט ראשי',
              url: typedUrl,
              enabled: true
            });
          } else {
            this.store.addSource(typedName, typedUrl);
          }
          pendingUrlEl.value = '';
          if (pendingNameEl) pendingNameEl.value = '';
        }

        const epgUrl = document.getElementById('epg-url-input')
          ? document.getElementById('epg-url-input').value.trim()
          : '';
        if (epgUrl) {
          localStorage.setItem(STORAGE_KEYS.EPG_URL, epgUrl);
          this.epg.loadEPG(epgUrl, () => this.refreshVisibleEPGLabels(), true, this.allChannels);
        } else {
          localStorage.removeItem(STORAGE_KEYS.EPG_URL);
        }

        this.refreshAllSources(false);
        this.closeModals();
      });
    }

    // Modal close buttons
    const closeBtns = document.querySelectorAll('[data-action="close-modal"]');
    for (let i = 0; i < closeBtns.length; i++) {
      closeBtns[i].addEventListener('click', () => this.closeModals());
    }

    // Settings Virtual Keyboard click handlers
    const kbKeys = document.querySelectorAll('#tv-virtual-keyboard .kb-key');
    for (let i = 0; i < kbKeys.length; i++) {
      const key = kbKeys[i];
      key.addEventListener('click', () => {
        const char = key.dataset.char;
        const action = key.dataset.kb;
        const input = document.getElementById(this.activeSettingsInputId || 'm3u-url-input');
        if (!input) return;

        if (char) {
          input.value += char;
        } else if (action === 'backspace') {
          input.value = input.value.slice(0, -1);
        } else if (action === 'space') {
          input.value += ' ';
        } else if (action === 'clear') {
          input.value = '';
        } else if (action === 'http') {
          input.value += 'https://';
        } else if (action === 'm3u') {
          input.value += '.m3u8';
        }
      });
    }
  }

  showToast(message, isCritical) {
    if (!isCritical && this.getUiPrefs().showToasts === false) {
      return;
    }
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    if (!toast || !msgEl) return;

    const now = Date.now();
    const text = message == null ? '' : String(message);
    if (!text) return;

    // Iteration 10: Deduplicate identical rapid toasts and protect critical alerts from rapid non-critical overlap
    if (this._lastToastMsg === text && (now - (this._lastToastTime || 0)) < 1200 && !toast.classList.contains('hidden')) {
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        toast.classList.add('hidden');
      }, 3000);
      return;
    }
    if (!isCritical && this._lastToastCritical && (now - (this._lastToastTime || 0)) < 1500 && !toast.classList.contains('hidden')) {
      clearTimeout(this._pendingToastTimer);
      this._pendingToastTimer = setTimeout(() => {
        this._pendingToastTimer = null;
        this.showToast(text, false);
      }, 1500);
      return;
    }

    clearTimeout(this._pendingToastTimer);
    this._pendingToastTimer = null;
    this._lastToastMsg = text;
    this._lastToastTime = now;
    this._lastToastCritical = Boolean(isCritical);

    msgEl.textContent = text;
    toast.classList.remove('hidden');

    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
      this._lastToastCritical = false;
    }, 3000);
  }
}

function boot() {
  if (typeof window === 'undefined' || window.__iptvAppBooted || window.app) return;
  window.__iptvAppBooted = true;
  window.app = new IPTVApp();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
  else boot();
}
