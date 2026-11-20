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
  LAST_CHANNEL: 'zenplay_iptv_last_channel'
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

    // Fast O(1) DOM node caches
    this.channelRowNodes = [];
    this.timelineItemNodes = [];
    this.timelineProgrammes = [];
    this.currentFocusedEl = null;
    this.currentActiveRowEl = null;

    this.focusedChannelIndex = 0;
    this.focusedTimelineIndex = 0;
    this.focusedHeaderIndex = 0;
    this.focusedModalIndex = 0;
    this.activeSettingsInputId = 'm3u-url-input';
    this.activeSettingsTab = 'sources'; // 'sources' | 'channels'
    this.editorSourceFilter = 'ALL';
    this.editorNumberBuffer = '';
    this.editorNumberTimer = null;

    // 7-Day Guide Modal state
    this.guideChannel = null;
    this.guideDays = [];
    this.guideDayIndex = 0; // 0 = Today, 1 = Yesterday, ... up to 7
    this.guideProgIndex = 0;
    this.guideProgNodes = [];
    this.guideDayTabNodes = [];

    // Fullscreen Info-Bar Surfing state
    this.isSurfing = false;
    this.surfingIndex = 0;

    this.previewDebounceTimer = null;
    this.initialPreviewTimer = null;
    this._pendingInitialPreviewChannel = null;
    this._deferredEpgTimer = null;
    this._bootSplashSafetyTimer = null;
    this._appReadyNotified = false;
    this.osdTimer = null;
    this.toastTimer = null;
    this.jumpTimer = null;

    this._seekHoldDir = 0;
    this._seekHoldStartMs = 0;
    this._seekHoldLastEventMs = 0;
    this._seekHoldTicks = 0;
    this._activeSeekSpeedLabel = '';
    this._seekBadgeClearTimer = null;

    this.init();
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
      this.loadFavorites();
      this.initPlayer();
      this.initRemote();
      this.initClock();
      this.bindDOMEvents();

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
        this.restoreLastWatchedChannel(false);
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
      window.addEventListener('resize', () => this.updateVideoSurfacePosition(true));

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
        this.scheduleInitialPreviewPlayback(pendingCh, 1800);
      }
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

    // If no EPG URLs were discovered from playlists or custom settings, supply default fallback feed
    if (urls.length === 0) {
      const defaultLiveEpg =
        (this.epg && this.epg.DEFAULT_LIVE_EPG_URL) ||
        'https://gist.githubusercontent.com/maorisraelii/b4408ca1c31143ed2f50164629f53f1c/raw/epg-il.xml';
      urls.push(defaultLiveEpg);
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
    const defaultLiveEpg =
      (this.epg && this.epg.DEFAULT_LIVE_EPG_URL) ||
      'https://gist.githubusercontent.com/maorisraelii/b4408ca1c31143ed2f50164629f53f1c/raw/epg-il.xml';
    const safeUrls = urls.map((u) => {
      if (u && (u.indexOf('epg.team') !== -1 || u.indexOf('epg_ripper_ALL') !== -1)) {
        return defaultLiveEpg;
      }
      return u;
    });
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
        this.showToast(msg);
      },
      getNextProgramme: (channel, currentProg, afterMs) =>
        this.epg && typeof this.epg.getNextProgrammeForChannel === 'function'
          ? this.epg.getNextProgrammeForChannel(channel, afterMs)
          : null,
      onProgrammeChanged: (channel) => {
        this.refreshVisibleEPGLabels();
        if (this.selectedChannel && channel && this.selectedChannel.id === channel.id) {
          this.updateOSD(channel, false);
          if (this.mode === 'FULLSCREEN') this.showOSD(5000);
        }
      }
    });
  }

  initRemote() {
    this.remote = new RemoteController(this);
  }

  initClock() {
    let lastMinute = -1;
    const updateTime = () => {
      const now = new Date();
      const hours = ('0' + now.getHours()).slice(-2);
      const minNum = now.getMinutes();
      const minutes = ('0' + minNum).slice(-2);
      const timeStr = hours + ':' + minutes;

      const headerClock = document.getElementById('clock');
      const osdClock = document.getElementById('osd-clock');
      if (headerClock) headerClock.textContent = timeStr;
      if (osdClock) osdClock.textContent = timeStr;

      if (minNum !== lastMinute && lastMinute !== -1) {
        this.refreshVisibleEPGLabels();
      }
      lastMinute = minNum;
    };
    updateTime();
    setInterval(updateTime, 15000);
  }

  updateVideoSurfacePosition(forceRecalc) {
    const surface = document.getElementById('video-surface');
    if (!surface) return;

    const rawZoom =
      typeof document !== 'undefined' && document.documentElement && document.documentElement.style
        ? parseFloat(document.documentElement.style.zoom)
        : NaN;
    const docZoom = rawZoom > 0 ? rawZoom : 1;

    if (this.mode === 'FULLSCREEN') {
      surface.classList.remove('preview-mode');
      surface.classList.add('fullscreen-mode');
      surface.style.left = '0px';
      surface.style.top = '0px';
      if (docZoom !== 1 && typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0) {
        surface.style.setProperty('width', Math.ceil(window.innerWidth / docZoom) + 'px', 'important');
        surface.style.setProperty('height', Math.ceil(window.innerHeight / docZoom) + 'px', 'important');
      } else {
        surface.style.removeProperty('width');
        surface.style.removeProperty('height');
        surface.style.width = '100vw';
        surface.style.height = '100vh';
      }
      surface.style.borderRadius = '0px';
      surface.style.zIndex = '100';
    } else {
      surface.classList.remove('fullscreen-mode');
      surface.classList.add('preview-mode');
      surface.style.removeProperty('width');
      surface.style.removeProperty('height');
      surface.style.zIndex = this.isModalOpen() ? '5' : '30';

      if (forceRecalc || !this.cachedPreviewRect) {
        const frame = document.getElementById('preview-frame');
        if (frame) {
          const rect = frame.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const scale = frame.offsetWidth > 0 ? rect.width / frame.offsetWidth : docZoom;
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

      if (this.cachedPreviewRect) {
        surface.style.left = this.cachedPreviewRect.left;
        surface.style.top = this.cachedPreviewRect.top;
        surface.style.width = this.cachedPreviewRect.width;
        surface.style.height = this.cachedPreviewRect.height;
        surface.style.borderRadius = '18px';
      }
    }
  }

  /* --------------------------------------------------------------------------
     Multi-M3U Loading & Lineup Compilation
     -------------------------------------------------------------------------- */

  refreshAllSources(silentBackground) {
    const statusText = document.getElementById('settings-status-text');
    if (!silentBackground) {
      if (statusText) statusText.textContent = 'מוריד וממזג רשימות ערוצים...';
    }

    this.store
      .fetchAllSources()
      .then((res) => {
        if (!res.compiledChannels || res.compiledChannels.length === 0) {
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

        if (!silentBackground) {
          this.onlyFavorites = false;
          this.applyChannelFilter();
          const shouldFullscreen = false;
          this.restoreLastWatchedChannel(shouldFullscreen);
          this.updateVideoSurfacePosition();
          this.hideBootSplash();
          // Load EPG after initial channel list paints (skipped in Safe Mode, deferred 2500ms on Android TV)
          this.scheduleBootEPGLoad(false);
        } else {
          if (!this.isSafeMode()) {
            this.loadActiveEPGSources(false);
          }
          // Silent background update: preserve current channel & focus index
          const curId = this.selectedChannel ? this.selectedChannel.id : null;
          this.applyChannelFilter();
          if (curId) {
            const idx = this.visibleChannels.findIndex((c) => c.id === curId);
            if (idx !== -1) {
              this.focusedChannelIndex = idx;
              this.updateChannelFocusFast();
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

    this.updateChannelFocusFast();
    const startCh = this.visibleChannels[this.focusedChannelIndex];
    if (startCh) {
      if (this.isSafeMode()) {
        this.cancelInitialPreviewTimer();
        this.highlightChannel(startCh, false, true);
        return;
      }
      if (this.isAndroidTvWebView()) {
        this.highlightChannel(startCh, false, true);
        if (this._bootSplashHidden) {
          this.scheduleInitialPreviewPlayback(startCh, 1800);
        } else {
          this._pendingInitialPreviewChannel = startCh;
        }
      } else {
        this.highlightChannel(startCh, true);
      }
      if (openFullscreen) {
        this.enterFullscreen();
      }
    }
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
      if (filterLabel) filterLabel.textContent = 'הצג את כל הערוצים';
    } else {
      this.visibleChannels = this.allChannels.slice();
      if (titleEl) titleEl.textContent = 'כל הערוצים';
      if (filterBtn) filterBtn.classList.remove('active-filter');
      if (filterLabel) filterLabel.textContent = 'מועדפים בלבד';
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
    if (this.focusArea === 'channels') {
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

  createChannelRowElement(ch, idx) {
    const item = document.createElement('div');
    const isSelected = this.selectedChannel && this.selectedChannel.id === ch.id;
    item.className = 'channel-item focusable' + (isSelected ? ' active' : '');
    item.dataset.index = idx;
    item.dataset.channelId = ch.id;
    if (isSelected) this.currentActiveRowEl = item;

    const isFav = this.favorites.has(ch.id);
    const epgMetrics = this.getChannelRowEPGMetrics(ch);
    const monogram = this.getChannelMonogram(ch);
    const pillLabel = isSelected ? 'מתנגן • OK למסך מלא ▶' : 'לחץ OK למעבר';

    item.innerHTML =
      '<span class="channel-number">' + ch.number + '</span>' +
      '<div class="channel-logo-thumb">' +
        (ch.logo
          ? '<img src="' + ch.logo + '" alt="" loading="lazy" decoding="async" style="display:none;" onload="if(this.naturalWidth>2){this.style.display=\'block\';if(this.nextElementSibling)this.nextElementSibling.style.display=\'none\';}" onerror="this.style.display=\'none\';if(this.nextElementSibling)this.nextElementSibling.style.display=\'block\';">'
          : '') +
        '<span class="channel-thumb-placeholder">' + monogram + '</span>' +
      '</div>' +
      '<div class="channel-text-col">' +
        '<div class="channel-row-top">' +
          '<span class="channel-title">' + ch.name + '</span>' +
          '<span class="channel-epg-sub">' + epgMetrics.title + '</span>' +
        '</div>' +
        '<div class="channel-mini-bar-row">' +
          '<span class="channel-mini-time">' + epgMetrics.timeRange + '</span>' +
          '<div class="channel-mini-progress-track">' +
            '<div class="channel-mini-progress-fill' + (epgMetrics.isEndingSoon ? ' ending-soon' : '') + '" style="width:' + epgMetrics.pct + '%"></div>' +
          '</div>' +
          '<span class="channel-mini-rem-badge' + (epgMetrics.isEndingSoon ? ' ending-soon' : '') + '">' + epgMetrics.remText + '</span>' +
        '</div>' +
      '</div>' +
      (isFav ? '<span class="channel-fav-star">★</span>' : '') +
      '<span class="channel-playing-badge">מתנגן ▶</span>' +
      '<span class="channel-ok-pill">' + pillLabel + '</span>';

    // Cache direct child references to eliminate querySelector calls on periodic EPG ticks
    item._epgSub = item.querySelector('.channel-epg-sub');
    item._epgTime = item.querySelector('.channel-mini-time');
    item._epgFill = item.querySelector('.channel-mini-progress-fill');
    item._epgRem = item.querySelector('.channel-mini-rem-badge');
    item._lastEpgSig = epgMetrics.title + '|' + epgMetrics.timeRange + '|' + epgMetrics.pct + '|' + epgMetrics.remText;

    item.addEventListener('click', () => {
      this.focusArea = 'channels';
      this.focusedChannelIndex = idx;
      this.updateChannelFocusFast();
      if (this.selectedChannel && this.selectedChannel.id === ch.id) {
        this.enterFullscreen();
      } else {
        this.highlightChannel(ch, true);
      }
    });

    return item;
  }

  renderChannelList() {
    const listEl = document.getElementById('channel-list');
    if (!listEl) return;
    this._renderJobId = (this._renderJobId || 0) + 1;
    const jobId = this._renderJobId;
    listEl.innerHTML = '';
    this.channelRowNodes = [];
    this.currentActiveRowEl = null;

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
    const INITIAL_BATCH = 16;
    const CHUNK_SIZE = 40;
    const firstEnd = Math.min(total, INITIAL_BATCH);

    const firstFrag = document.createDocumentFragment();
    for (let idx = 0; idx < firstEnd; idx++) {
      const item = this.createChannelRowElement(this.visibleChannels[idx], idx);
      this.channelRowNodes.push(item);
      firstFrag.appendChild(item);
    }
    listEl.appendChild(firstFrag);

    if (firstEnd >= total) return;

    let cursor = firstEnd;
    const renderNextChunk = () => {
      if (this._renderJobId !== jobId) return;
      const end = Math.min(total, cursor + CHUNK_SIZE);
      const frag = document.createDocumentFragment();
      for (let idx = cursor; idx < end; idx++) {
        const item = this.createChannelRowElement(this.visibleChannels[idx], idx);
        this.channelRowNodes.push(item);
        frag.appendChild(item);
      }
      listEl.appendChild(frag);
      cursor = end;
      if (cursor < total) {
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(renderNextChunk);
        } else {
          setTimeout(renderNextChunk, 0);
        }
      } else if (this.focusArea === 'channels' && this.focusedChannelIndex >= firstEnd) {
        this.updateChannelFocusFast();
      }
    };

    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(renderNextChunk);
    } else {
      setTimeout(renderNextChunk, 0);
    }
  }

  updateRowEPGDom(row, ch) {
    if (!row || !ch) return;
    const epgMetrics = this.getChannelRowEPGMetrics(ch);
    const sig = epgMetrics.title + '|' + epgMetrics.timeRange + '|' + epgMetrics.pct + '|' + epgMetrics.remText;
    if (row._lastEpgSig === sig) return;
    row._lastEpgSig = sig;

    if (row._epgSub) row._epgSub.textContent = epgMetrics.title;
    if (row._epgTime) row._epgTime.textContent = epgMetrics.timeRange;
    if (row._epgFill) {
      row._epgFill.style.width = epgMetrics.pct + '%';
      row._epgFill.classList.toggle('ending-soon', epgMetrics.isEndingSoon);
    }
    if (row._epgRem) {
      row._epgRem.textContent = epgMetrics.remText;
      row._epgRem.classList.toggle('ending-soon', epgMetrics.isEndingSoon);
    }
  }

  refreshVisibleEPGLabels() {
    const total = this.channelRowNodes.length;
    for (let i = 0; i < total; i++) {
      this.updateRowEPGDom(this.channelRowNodes[i], this.visibleChannels[i]);
    }
    const previewCh = this.visibleChannels[this.focusedChannelIndex] || this.selectedChannel;
    if (previewCh) {
      this.updateEPGUI(previewCh);
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
    this.previewTimer = setTimeout(() => {
      this.previewChannelInfo(channel);
    }, 85);
  }

  previewChannelInfo(channel) {
    if (!channel) return;
    clearTimeout(this.previewTimer);
    this.previewedChannel = channel;

    const numEl = document.getElementById('preview-channel-num');
    const nameEl = document.getElementById('preview-channel-name');
    const catEl = document.getElementById('preview-channel-category');
    const srcEl = document.getElementById('preview-channel-source');
    if (numEl) numEl.textContent = 'ערוץ ' + channel.number;
    if (nameEl) nameEl.textContent = channel.name;
    if (catEl) catEl.textContent = channel.group || 'טלוויזיה חיה';
    if (srcEl) srcEl.textContent = channel.sourceName || 'פלייליסט ראשי';

    const playStatusEl = document.getElementById('preview-playing-status');
    if (playStatusEl) {
      const isCatchupHere = Boolean(
        this.player &&
        this.player.currentProgramme &&
        this.player.currentChannel &&
        this.player.currentChannel.id === channel.id
      );
      playStatusEl.textContent = isCatchupHere ? 'סטארט אובר' : 'שידור חי';
      playStatusEl.classList.toggle('catchup-mode', isCatchupHere);
    }

    const logoImg = document.getElementById('preview-channel-logo');
    const logoPlaceholder = document.getElementById('preview-channel-placeholder');
    if (logoImg && logoPlaceholder) {
      const nextLogo = channel.logo || '';
      if (logoImg.dataset.loadedSrc !== nextLogo) {
        logoImg.dataset.loadedSrc = nextLogo;
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
        }
      }
    }

    this.updateFavoriteButtonUI(channel);
    this.updateEPGUI(channel);
  }

  /**
   * Switches the active playing video stream to `channel` (triggered on OK press or initial boot).
   */
  highlightChannel(channel, immediatePlay, skipPlayback) {
    if (!channel) return;
    this.selectedChannel = channel;
    this.previewedChannel = channel;

    // Update previous active row pill & class
    if (this.currentActiveRowEl) {
      this.currentActiveRowEl.classList.remove('active');
      const oldPill = this.currentActiveRowEl.querySelector('.channel-ok-pill');
      if (oldPill) oldPill.textContent = 'לחץ OK למעבר';
    }

    let newActiveRow = this.channelRowNodes[this.focusedChannelIndex];
    if (!newActiveRow || newActiveRow.dataset.channelId !== channel.id) {
      for (let i = 0; i < this.channelRowNodes.length; i++) {
        if (this.channelRowNodes[i].dataset.channelId === channel.id) {
          newActiveRow = this.channelRowNodes[i];
          break;
        }
      }
    }
    if (newActiveRow) {
      newActiveRow.classList.add('active');
      const newPill = newActiveRow.querySelector('.channel-ok-pill');
      if (newPill) newPill.textContent = 'מתנגן • OK למסך מלא ▶';
      this.currentActiveRowEl = newActiveRow;
    }

    this.previewChannelInfo(channel);

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
    }

    clearTimeout(this.previewDebounceTimer);
    this.previewDebounceTimer = null;
    this.cancelInitialPreviewTimer();
    if (skipPlayback === true) {
      return;
    }
    if (immediatePlay === true) {
      try {
        localStorage.setItem(STORAGE_KEYS.LAST_CHANNEL, channel.id);
      } catch (e) {}
      this.player.play(channel);
    } else if (!this.isSafeMode()) {
      this.previewDebounceTimer = setTimeout(() => {
        try {
          localStorage.setItem(STORAGE_KEYS.LAST_CHANNEL, channel.id);
        } catch (e) {}
        this.player.play(channel);
      }, 150);
    }
  }

  updateEPGUI(channel) {
    if (!channel || !this.epg) return;
    const epgData = this.epg.getNowNext(channel);
    if (epgData && epgData.current) {
      this.displaySynopsisForProgramme(epgData.current);
    }

    // Populate Previous & Next programme with Start & End times in Main EPG Box
    const prevTitleEl = document.getElementById('preview-epg-prev-title');
    const prevTimeEl = document.getElementById('preview-epg-prev-time');
    const nextTitleEl = document.getElementById('preview-epg-next-title');
    const nextTimeEl = document.getElementById('preview-epg-next-time');

    if (epgData && epgData.previous) {
      if (prevTitleEl) prevTitleEl.textContent = epgData.previous.title;
      if (prevTimeEl) prevTimeEl.textContent = epgData.previous.startStr + ' - ' + epgData.previous.stopStr;
    }
    if (epgData && epgData.next) {
      if (nextTitleEl) nextTitleEl.textContent = epgData.next.title;
      if (nextTimeEl) nextTimeEl.textContent = epgData.next.startStr + ' - ' + epgData.next.stopStr;
    }

    // Render Interactive Mini Timeline Strip (2 Previous + Current + 2 Upcoming)
    this.renderMiniTimelineStrip(channel);
  }

  displaySynopsisForProgramme(prog) {
    if (!prog) return;
    const badgeEl = document.getElementById('preview-epg-badge');
    const titleEl = document.getElementById('preview-epg-title');
    const timeEl = document.getElementById('preview-epg-time');
    const progressEl = document.getElementById('preview-epg-progress');
    const descEl = document.getElementById('preview-epg-desc');

    if (badgeEl) {
      if (prog.status === 'past') {
        badgeEl.textContent = 'שודר קודם • לחץ OK לסטארט אובר';
        badgeEl.classList.add('past-mode');
      } else if (prog.status === 'upcoming') {
        badgeEl.textContent = 'ישודר בהמשך';
        badgeEl.classList.remove('past-mode');
      } else {
        badgeEl.textContent = 'משודר כעת';
        badgeEl.classList.remove('past-mode');
      }
    }
    if (titleEl) titleEl.textContent = prog.title;
    if (timeEl) timeEl.textContent = prog.startStr + ' - ' + prog.stopStr;
    if (progressEl) {
      progressEl.style.width = (typeof prog.progressPercent === 'number' ? prog.progressPercent : (prog.status === 'past' ? 100 : 0)) + '%';
    }
    if (descEl) descEl.textContent = prog.desc || 'שידור ישיר בערוץ.';
  }

  renderMiniTimelineStrip(channel) {
    const stripEl = document.getElementById('channel-program-strip');
    if (!stripEl || !this.epg) return;
    this.timelineProgrammes = this.epg.getMiniTimeline(channel);

    let liveIdx = 0;
    for (let i = 0; i < this.timelineProgrammes.length; i++) {
      if (this.timelineProgrammes[i].status === 'live') {
        liveIdx = i;
        break;
      }
    }
    this.focusedTimelineIndex = liveIdx;

    if (this.timelineItemNodes.length !== 5) {
      stripEl.innerHTML = '';
      this.timelineItemNodes = [];
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
        stripEl.appendChild(card);
      }
    }

    for (let i = 0; i < 5; i++) {
      const card = this.timelineItemNodes[i];
      const p = this.timelineProgrammes[i];
      if (!p) {
        card.style.display = 'none';
        continue;
      }
      card.style.display = '';
      card.className = 'program-strip-item status-' + p.status;

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
     Fullscreen OSD Updates (With Previous + Current + Next & Start/End Times)
     -------------------------------------------------------------------------- */

  updateOSD(channel, isSurfing) {
    if (!channel) return;
    const numEl = document.getElementById('osd-channel-number');
    const nameEl = document.getElementById('osd-channel-name');
    const catEl = document.getElementById('osd-channel-category');
    if (numEl) numEl.textContent = channel.number;
    if (nameEl) nameEl.textContent = channel.name;
    if (catEl) catEl.textContent = channel.group || 'HD';

    const osdLogo = document.getElementById('osd-channel-logo');
    const osdPlaceholder = document.getElementById('osd-logo-placeholder');
    if (osdLogo && osdPlaceholder) {
      const nextLogo = channel.logo || '';
      if (osdLogo.dataset.loadedSrc !== nextLogo) {
        osdLogo.dataset.loadedSrc = nextLogo;
        osdPlaceholder.textContent = this.getChannelMonogram(channel);
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

    const osdLiveBadge = document.getElementById('osd-live-badge');
    if (osdLiveBadge) {
      if (this._activeSeekSpeedLabel && !isSurfing) {
        osdLiveBadge.textContent = this._activeSeekSpeedLabel;
        osdLiveBadge.classList.add('seeking-mode');
        osdLiveBadge.classList.remove('catchup-mode');
        osdLiveBadge.classList.remove('paused-mode');
      } else if (playback && playback.isPaused && !isSurfing) {
        osdLiveBadge.textContent = '❚❚ מושהה';
        osdLiveBadge.classList.remove('seeking-mode');
        osdLiveBadge.classList.remove('catchup-mode');
        osdLiveBadge.classList.add('paused-mode');
      } else if (activeCatchupProg) {
        osdLiveBadge.textContent = 'סטארט אובר';
        osdLiveBadge.classList.remove('seeking-mode');
        osdLiveBadge.classList.add('catchup-mode');
        osdLiveBadge.classList.remove('paused-mode');
      } else {
        osdLiveBadge.textContent = 'שידור חי';
        osdLiveBadge.classList.remove('seeking-mode');
        osdLiveBadge.classList.remove('catchup-mode');
        osdLiveBadge.classList.remove('paused-mode');
      }
    }

    const hintRedLabel = document.getElementById('hint-red-label') || document.querySelector('#hint-red span:last-child');
    if (hintRedLabel) {
      hintRedLabel.textContent = activeCatchupProg ? 'יציאה מסטארט אובר (לחי)' : 'סטארט אובר (מההתחלה)';
    }

    const osdTitle = document.getElementById('osd-epg-title');
    const osdTime = document.getElementById('osd-epg-time');
    const osdProg = document.getElementById('osd-epg-progress');
    const osdDesc = document.getElementById('osd-epg-desc');
    const osdPrevTitle = document.getElementById('osd-epg-prev-title');
    const osdPrevTime = document.getElementById('osd-epg-prev-time');
    const osdNextTitle = document.getElementById('osd-epg-next-title');
    const osdNextTime = document.getElementById('osd-epg-next-time');

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

      if (osdTitle) osdTitle.textContent = activeCatchupProg.title;
      if (osdTime) osdTime.textContent = startStr + ' - ' + stopStr + elapsedStr;
      if (osdProg) osdProg.style.width = pct + '%';
      if (osdDesc) osdDesc.textContent = activeCatchupProg.desc || (epgData && epgData.current ? epgData.current.desc : '');
    } else if (epgData && epgData.current) {
      if (osdTitle) osdTitle.textContent = epgData.current.title;
      if (osdTime) osdTime.textContent = epgData.current.startStr + ' - ' + epgData.current.stopStr;
      if (osdProg) osdProg.style.width = epgData.current.progressPercent + '%';
      if (osdDesc) osdDesc.textContent = epgData.current.desc;
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
      if (osdPrevTitle) {
        osdPrevTitle.textContent = schedSource.previous ? schedSource.previous.title : 'שידור קודם';
      }
      if (osdPrevTime) {
        osdPrevTime.textContent = schedSource.previous
          ? schedSource.previous.startStr + ' - ' + schedSource.previous.stopStr
          : '';
      }

      if (osdNextTitle) {
        osdNextTitle.textContent = schedSource.next ? schedSource.next.title : 'שידור המשך';
      }
      if (osdNextTime) {
        osdNextTime.textContent = schedSource.next
          ? schedSource.next.startStr + ' - ' + schedSource.next.stopStr
          : '';
      }
    }

    const surfPrompt = document.getElementById('osd-surf-prompt');
    if (surfPrompt) {
      if (isSurfing) {
        surfPrompt.classList.remove('hidden');
      } else {
        surfPrompt.classList.add('hidden');
      }
    }

    if (this.otaManager) {
      this.otaManager.updateVersionBadgesUI();
    }
  }

  showOSD(duration) {
    const waitMs = duration || 5000;
    const osd = document.getElementById('fullscreen-osd');
    if (!osd) return;
    osd.classList.remove('hidden');
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
      osd.classList.add('hidden');
      clearInterval(this.osdTickTimer);
      if (this.isSurfing) {
        this.isSurfing = false;
        if (this.selectedChannel) {
          this.updateOSD(this.selectedChannel, false);
        }
      }
    }, waitMs);
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
      for (let i = 0; i < this.channelRowNodes.length; i++) {
        const row = this.channelRowNodes[i];
        if (row && row.dataset.channelId === id) {
          let starEl = row.querySelector('.channel-fav-star');
          if (nowFav && !starEl) {
            starEl = document.createElement('span');
            starEl.className = 'channel-fav-star';
            starEl.textContent = '★';
            const playingBadge = row.querySelector('.channel-playing-badge');
            row.insertBefore(starEl, playingBadge || null);
          } else if (!nowFav && starEl) {
            starEl.remove();
          }
          break;
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
     O(1) Spatial Navigation & Focus Engine
     -------------------------------------------------------------------------- */

  getHeaderButtons() {
    return [
      document.getElementById('btn-filter-favs'),
      document.getElementById('btn-toggle-favorite'),
      document.getElementById('btn-open-guide'),
      document.getElementById('btn-search-trigger'),
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

  updateChannelFocusFast() {
    const listEl = document.getElementById('channel-list');
    const targetItem = this.channelRowNodes[this.focusedChannelIndex];
    if (targetItem && listEl) {
      this.updateRowEPGDom(targetItem, this.visibleChannels[this.focusedChannelIndex]);
      this.setFocusedElementFast(targetItem);
      this.scrollContainerFast(listEl, targetItem);
    }
  }

  updateTimelineFocusFast() {
    const target = this.timelineItemNodes[this.focusedTimelineIndex];
    if (target) {
      this.setFocusedElementFast(target);
      const prog = this.timelineProgrammes[this.focusedTimelineIndex];
      if (prog) {
        this.displaySynopsisForProgramme(prog);
      }
    }
  }

  updateHeaderFocusFast() {
    const buttons = this.getHeaderButtons();
    const target = buttons[this.focusedHeaderIndex];
    if (target) {
      this.setFocusedElementFast(target);
    }
  }

  /**
   * Pure integer offsetTop scroll calculation — zero getBoundingClientRect() layout reflow!
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

        const osd = document.getElementById('fullscreen-osd');
        const isOsdVisible = osd && !osd.classList.contains('hidden');

        // First press while Info Bar is hidden: only reveal Info Bar for the current channel
        if (!isOsdVisible) {
          this.isSurfing = false;
          this.surfingIndex = this.focusedChannelIndex;
          const currentCh = this.selectedChannel || this.visibleChannels[this.focusedChannelIndex];
          if (currentCh) {
            this.updateOSD(currentCh, false);
          }
          this.showOSD(5500);
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
        this.showOSD(7000);
        return;
      } else if (direction === 'left') {
        // In Hebrew RTL, Left arrow moves Forward along the progress bar
        this.handleSeekKeyHold(1, 15);
        return;
      } else if (direction === 'right') {
        // In Hebrew RTL, Right arrow moves Backward along the progress bar
        this.handleSeekKeyHold(-1, 15);
        return;
      }
      return;
    }

    // 2. 7-DAY GUIDE MODAL MODE (Left/Right = Zapping between Days, Up/Down = Programmes in Day)
    if (this.mode === 'GUIDE') {
      this.navigateGuideModal(direction);
      return;
    }

    // 3. SETTINGS / SEARCH / OTA MODAL MODE
    if (this.mode === 'SETTINGS' || this.mode === 'SEARCH' || this.mode === 'OTA') {
      this.navigateModal(direction);
      return;
    }

    // 4. BROWSE MODE (Channels List, Program Timeline Strip, Top Header Toolbar)
    if (this.focusArea === 'channels') {
      if (direction === 'down') {
        if (this.visibleChannels.length === 0) return;
        this.focusedChannelIndex = (this.focusedChannelIndex + 1) % this.visibleChannels.length;
        this.updateChannelFocusFast();
        // Debounce heavy EPG/timeline/logo preview during rapid D-pad scrolling
        this.schedulePreviewChannelInfo(this.visibleChannels[this.focusedChannelIndex]);
      } else if (direction === 'up') {
        if (this.visibleChannels.length === 0) {
          this.focusHeaderBar();
          return;
        }
        if (this.focusedChannelIndex > 0) {
          this.focusedChannelIndex--;
          this.updateChannelFocusFast();
          // Debounce heavy EPG/timeline/logo preview during rapid D-pad scrolling
          this.schedulePreviewChannelInfo(this.visibleChannels[this.focusedChannelIndex]);
        } else {
          this.focusHeaderBar();
        }
      } else if (direction === 'left') {
        // Move focus to the Channel's Program Timeline Strip (Prev/Current/Next shows) or Header
        if (this.timelineItemNodes.length > 0) {
          this.focusArea = 'timeline';
          this.updateTimelineFocusFast();
        } else {
          this.focusHeaderBar();
        }
      } else if (direction === 'right') {
        this.updateChannelFocusFast();
      }
    } else if (this.focusArea === 'timeline') {
      // Navigating the Previous / Current / Next Program Strip under the Preview
      if (direction === 'left') {
        // In RTL, Left moves forward in the strip
        if (this.focusedTimelineIndex < this.timelineItemNodes.length - 1) {
          this.focusedTimelineIndex++;
          this.updateTimelineFocusFast();
        }
      } else if (direction === 'right') {
        // In RTL, Right moves back toward earlier shows, or back to the Channel List
        if (this.focusedTimelineIndex > 0) {
          this.focusedTimelineIndex--;
          this.updateTimelineFocusFast();
        } else {
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
    // 1. FULLSCREEN MODE
    if (this.mode === 'FULLSCREEN') {
      if (this.isSurfing) {
        this.focusedChannelIndex = this.surfingIndex;
        this.isSurfing = false;
        const targetCh = this.visibleChannels[this.focusedChannelIndex];
        if (targetCh) {
          this.highlightChannel(targetCh, true);
          this.updateOSD(targetCh, false);
          this.showOSD(4500);
        }
      } else {
        const osd = document.getElementById('fullscreen-osd');
        const isOsdVisible = osd && !osd.classList.contains('hidden');
        if (!isOsdVisible) {
          // 1st press of OK when Info-Bar is hidden -> Only show Info-Bar!
          if (this.selectedChannel) {
            this.updateOSD(this.selectedChannel, false);
          }
          this.showOSD(5000);
        } else {
          // 2nd press of OK while Info-Bar is visible -> Toggle Pause / Play!
          this.togglePlayPause();
          this.showOSD(5000);
        }
      }
      return;
    }

    // 2. 7-DAY GUIDE MODAL MODE
    if (this.mode === 'GUIDE') {
      const dayBucket = this.guideDays[this.guideDayIndex];
      if (dayBucket && dayBucket.programmes[this.guideProgIndex]) {
        const prog = dayBucket.programmes[this.guideProgIndex];
        const ch = this.guideChannel || this.selectedChannel;
        this.closeModals();
        this.startProgrammeCatchup(ch, prog);
      }
      return;
    }

    // 3. SETTINGS / SEARCH / OTA MODAL MODE
    if (this.mode === 'SETTINGS' || this.mode === 'SEARCH' || this.mode === 'OTA') {
      if (this.currentFocusedEl) {
        if (this.currentFocusedEl.tagName === 'INPUT') {
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

      if (!this.selectedChannel || this.selectedChannel.id !== targetCh.id) {
        // Channel is not currently playing -> Switch to it ONLY on OK press! (No redundant bottom toast)
        this.highlightChannel(targetCh, true);
      } else {
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
    if (this.isModalOpen()) {
      this.closeModals();
      return;
    }

    if (this.mode === 'FULLSCREEN') {
      if (this.isSurfing) {
        this.isSurfing = false;
        const curChannel = this.visibleChannels[this.focusedChannelIndex] || this.selectedChannel;
        if (curChannel) this.updateOSD(curChannel, false);
        const osd = document.getElementById('fullscreen-osd');
        if (osd) osd.classList.add('hidden');
        return;
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

  enterFullscreen() {
    if (!this.selectedChannel) return;
    this.mode = 'FULLSCREEN';
    this.isSurfing = false;
    this.endSeekHold();
    this._activeSeekSpeedLabel = '';
    clearTimeout(this._seekBadgeClearTimer);
    this.updateVideoSurfacePosition(true);
    this.updateOSD(this.selectedChannel, false);
    this.showOSD(4500);
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
      const osd = document.getElementById('fullscreen-osd');
      if (osd) osd.classList.add('hidden');
      if (this.selectedChannel) {
        const idx = this.visibleChannels.findIndex((c) => c.id === this.selectedChannel.id);
        if (idx !== -1) this.focusedChannelIndex = idx;
        this.previewChannelInfo(this.selectedChannel);
      }
      this.updateVideoSurfacePosition(true);
      // Asynchronously update DOM focus & EPG labels on next animation frame
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          try {
            this.refreshVisibleEPGLabels();
            this.updateChannelFocusFast();
          } catch (e) {}
        });
      } else {
        this.refreshVisibleEPGLabels();
        this.updateChannelFocusFast();
      }
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
      this.showOSD(4500);
    } else {
      this.updateChannelFocusFast();
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
        this.showOSD(4500);
      } else {
        this.updateChannelFocusFast();
      }
    } else {
      this.showToast('ערוץ מספר ' + num + ' לא נמצא');
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
          '</div>' +
        '</div>';
    }

    const textEl = document.getElementById('jump-number-digits');
    const nameEl = document.getElementById('jump-channel-name');
    const epgEl = document.getElementById('jump-channel-epg');
    const logoImg = document.getElementById('jump-channel-logo');
    const monogramEl = document.getElementById('jump-channel-monogram');

    if (textEl) textEl.textContent = digits;

    const targetNum = parseInt(digits, 10);
    const matchedCh = !isNaN(targetNum) ? this.allChannels.find((c) => c.number === targetNum) : null;

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
        nameEl.textContent = 'אין ערוץ במספר ' + digits;
        nameEl.classList.add('not-found');
      }
      if (epgEl) {
        epgEl.textContent = 'המשך להקליד ספרות...';
      }
      if (logoImg && monogramEl) {
        logoImg.classList.add('hidden');
        monogramEl.classList.remove('hidden');
        monogramEl.textContent = '?';
      }
    }

    overlay.classList.remove('hidden');

    clearTimeout(this.jumpTimer);
    this.jumpTimer = setTimeout(() => {
      overlay.classList.add('hidden');
    }, 1500);
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
    this.showOSD(4500);
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
        this.showOSD(4500);
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
      this.showOSD(4500);
    }
  }

  onGreenButton() {
    this.handleSeekKeyHold(-1, 30);
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
    this.handleSeekKeyHold(1, 30);
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
      this.showOSD(4500);
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

  openGuideModal(channelOverride) {
    const ch = channelOverride || this.previewedChannel || this.selectedChannel || this.visibleChannels[0];
    if (!ch) return;

    this.previousModeBeforeModal = this.mode === 'FULLSCREEN' ? 'FULLSCREEN' : 'BROWSE';
    this.mode = 'GUIDE';
    this.guideChannel = ch;
    this.guideDays = this.epg.getChannelGuideByDays(ch);
    this.guideDayIndex = 0; // Start on Today

    const titleEl = document.getElementById('guide-modal-title');
    if (titleEl) {
      titleEl.textContent = 'מדריך תוכניות (7 ימים): ערוץ ' + ch.number + ' - ' + ch.name;
    }

    const osd = document.getElementById('fullscreen-osd');
    if (osd) osd.classList.add('hidden');
    const pauseBadge = document.getElementById('video-pause-indicator');
    if (pauseBadge) pauseBadge.classList.add('hidden');

    document.getElementById('guide-modal').classList.remove('hidden');
    this.updateVideoSurfacePosition();

    this.renderGuideDayTabs();
    this.renderGuideDayProgrammes();
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
    if (barEl && activeTab && typeof activeTab.scrollIntoView === 'function') {
      try {
        activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } catch (e) {}
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
    if (direction === 'down') {
      if (this.guideProgNodes.length === 0) return;
      this.guideProgIndex = (this.guideProgIndex + 1) % this.guideProgNodes.length;
      this.updateGuideProgrammeFocus();
    } else if (direction === 'up') {
      if (this.guideProgNodes.length === 0) return;
      this.guideProgIndex = (this.guideProgIndex - 1 + this.guideProgNodes.length) % this.guideProgNodes.length;
      this.updateGuideProgrammeFocus();
    } else if (direction === 'left') {
      // In RTL, Left moves to older day (Today -> Yesterday -> 2 days ago ... up to 7 days)
      if (this.guideDayIndex < this.guideDays.length - 1) {
        this.guideDayIndex++;
        this.updateGuideDayTabActive();
        this.renderGuideDayProgrammes();
      }
    } else if (direction === 'right') {
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
    return this.mode === 'SETTINGS' || this.mode === 'SEARCH' || this.mode === 'GUIDE' || this.mode === 'OTA';
  }

  openSettingsModal() {
    this.previousModeBeforeModal = 'BROWSE';
    this.mode = 'SETTINGS';
    this.activeSettingsInputId = 'm3u-url-input';
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
    const osd = document.getElementById('fullscreen-osd');
    if (osd) osd.classList.add('hidden');
    const pauseBadge = document.getElementById('video-pause-indicator');
    if (pauseBadge) pauseBadge.classList.add('hidden');
    document.getElementById('settings-modal').classList.remove('hidden');
    this.updateVideoSurfacePosition();
    this.setupModalFocus('#settings-modal');
  }

  switchSettingsTab(tabName) {
    this.activeSettingsTab = tabName;
    const tabs = [
      { key: 'sources', btn: 'tab-btn-sources', panel: 'settings-tab-sources' },
      { key: 'channels', btn: 'tab-btn-channels', panel: 'settings-tab-channels' },
      { key: 'performance', btn: 'tab-btn-performance', panel: 'settings-tab-performance' },
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
      this.renderChannelEditorTab();
    } else if (tabName === 'performance') {
      this.renderPerformanceTab();
    } else if (tabName === 'sources') {
      this.renderSourcesManagerList();
    } else if (tabName === 'about') {
      if (this.otaManager && typeof this.otaManager.updateVersionBadgesUI === 'function') {
        this.otaManager.updateVersionBadgesUI();
      }
    }
  }

  renderPerformanceTab() {
    const curBuffer = this.player ? this.player.bufferMode : 'smart';
    const curTtl = this.epg ? this.epg.getCacheTtlHours() : 24;

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
      const prof = this.player ? this.player.getBufferProfile() : { label: 'אוטומטי חכם — איכות מדורגת לפי באפר' };
      const ttlLabel =
        curTtl === 0 ? 'ידני בלבד' : curTtl === 24 ? 'כל 24 שעות' : curTtl === 72 ? 'כל 3 ימים' : 'כל 7 ימים';
      statusEl.textContent = 'פעיל כעת: ' + prof.label + ' | רענון לוח שידורים: ' + ttlLabel;
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
    this.previousModeBeforeModal = 'BROWSE';
    this.mode = 'SEARCH';
    document.getElementById('search-modal').classList.remove('hidden');
    this.updateVideoSurfacePosition();
    this.renderSearchKeyboard();
    const searchInput = document.getElementById('search-query-input');
    this.filterChannels(searchInput ? searchInput.value : '');
    this.setupModalFocus('#search-modal');
  }

  closeModals() {
    if (this.otaManager) {
      this.otaManager.stopCloudSyncPolling();
    }
    const modals = document.querySelectorAll('.modal-backdrop');
    for (let i = 0; i < modals.length; i++) {
      modals[i].classList.add('hidden');
    }
    if (this.previousModeBeforeModal === 'FULLSCREEN') {
      this.mode = 'FULLSCREEN';
      this.updateVideoSurfacePosition();
    } else {
      this.mode = 'BROWSE';
      this.focusArea = 'channels';
      this.updateVideoSurfacePosition();
      this.updateChannelFocusFast();
    }
  }

  setupModalFocus(modalSelector) {
    const modal = document.querySelector(modalSelector);
    if (!modal) return;
    const focusables = Array.from(modal.querySelectorAll('.focusable')).filter(
      (el) => el.offsetWidth > 0 || el.offsetHeight > 0
    );
    if (focusables.length > 0) {
      this.focusedModalIndex = focusables.length > 1 ? 1 : 0;
      this.setFocusedElementFast(focusables[this.focusedModalIndex]);
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

    for (let i = 0; i < focusables.length; i++) {
      if (i === activeIdx) continue;
      const rect = rects[i];

      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = cx - curCx;
      const dy = cy - curCy;

      let isCandidate = false;
      let primaryDist = 0;
      let secondaryDist = 0;

      if (direction === 'down' && dy > 12) {
        isCandidate = true;
        primaryDist = dy;
        secondaryDist = Math.abs(dx) * 2.2;
      } else if (direction === 'up' && dy < -12) {
        isCandidate = true;
        primaryDist = -dy;
        secondaryDist = Math.abs(dx) * 2.2;
      } else if (direction === 'left' && dx < -12) {
        isCandidate = true;
        primaryDist = -dx;
        secondaryDist = Math.abs(dy) * 2.5;
      } else if (direction === 'right' && dx > 12) {
        isCandidate = true;
        primaryDist = dx;
        secondaryDist = Math.abs(dy) * 2.5;
      }

      if (isCandidate) {
        const score = primaryDist + secondaryDist;
        if (score < bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
    }

    if (bestIndex === -1) {
      if (direction === 'down' || direction === 'left') {
        bestIndex = (activeIdx + 1) % focusables.length;
      } else {
        bestIndex = (activeIdx - 1 + focusables.length) % focusables.length;
      }
    }

    this.focusedModalIndex = bestIndex;
    const target = focusables[bestIndex];
    if (target) {
      this.setFocusedElementFast(target);
      if (target.tagName === 'INPUT') {
        this.activeSettingsInputId = target.id;
      }
      if (target.parentElement && (target.parentElement.id === 'search-results-list' || target.parentElement.id === 'channel-editor-list')) {
        this.scrollContainerFast(target.parentElement, target);
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
    const videoSurface = document.getElementById('video-surface');
    if (videoSurface) {
      videoSurface.addEventListener('click', () => {
        if (this.mode === 'FULLSCREEN') {
          const osd = document.getElementById('fullscreen-osd');
          const isOsdVisible = osd && !osd.classList.contains('hidden');
          if (!isOsdVisible) {
            if (this.selectedChannel) this.updateOSD(this.selectedChannel, false);
            this.showOSD(5000);
          } else {
            this.togglePlayPause();
            this.showOSD(5000);
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
    const tabBtnAbout = document.getElementById('tab-btn-about');
    if (tabBtnSources) tabBtnSources.addEventListener('click', () => this.switchSettingsTab('sources'));
    if (tabBtnChannels) tabBtnChannels.addEventListener('click', () => this.switchSettingsTab('channels'));
    if (tabBtnPerf) tabBtnPerf.addEventListener('click', () => this.switchSettingsTab('performance'));
    if (tabBtnAbout) tabBtnAbout.addEventListener('click', () => this.switchSettingsTab('about'));

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

  showToast(message) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    if (!toast || !msgEl) return;
    msgEl.textContent = message;
    toast.classList.remove('hidden');

    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
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
