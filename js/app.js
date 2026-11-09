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
    this.osdTimer = null;
    this.toastTimer = null;
    this.jumpTimer = null;

    this.init();
  }

  init() {
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

    // Load saved EPG URL if configured
    const savedEpgUrl = localStorage.getItem(STORAGE_KEYS.EPG_URL);
    if (savedEpgUrl) {
      const epgInput = document.getElementById('epg-url-input');
      if (epgInput) epgInput.value = savedEpgUrl;
      this.epg.loadEPG(savedEpgUrl, () => {
        this.refreshVisibleEPGLabels();
      });
    }

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
      this.applyChannelFilter();
      this.restoreLastWatchedChannel();
      this.updateVideoSurfacePosition(true);

      // Only refresh in background if the cache TTL (24h / 3d / 7d) has expired!
      const ttlHours = this.epg.getCacheTtlHours();
      if (!this.store.isLineupCacheFresh(ttlHours)) {
        setTimeout(() => this.refreshAllSources(true), 1500);
      }
    } else {
      this.refreshAllSources(false);
    }

    this.updateVideoSurfacePosition(true);
    setTimeout(() => this.updateVideoSurfacePosition(true), 150);
    window.addEventListener('resize', () => this.updateVideoSurfacePosition(true));
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
      }
    });
  }

  initRemote() {
    this.remote = new RemoteController(this);
  }

  initClock() {
    const updateTime = () => {
      const now = new Date();
      const hours = ('0' + now.getHours()).slice(-2);
      const minutes = ('0' + now.getMinutes()).slice(-2);
      const timeStr = hours + ':' + minutes;

      const headerClock = document.getElementById('clock');
      const osdClock = document.getElementById('osd-clock');
      if (headerClock) headerClock.textContent = timeStr;
      if (osdClock) osdClock.textContent = timeStr;
    };
    updateTime();
    setInterval(updateTime, 15000);
  }

  updateVideoSurfacePosition(forceRecalc) {
    const surface = document.getElementById('video-surface');
    if (!surface) return;

    if (this.mode === 'FULLSCREEN') {
      surface.classList.remove('preview-mode');
      surface.classList.add('fullscreen-mode');
      surface.style.left = '0px';
      surface.style.top = '0px';
      surface.style.width = '100vw';
      surface.style.height = '100vh';
      surface.style.borderRadius = '0px';
      surface.style.zIndex = '100';
    } else {
      surface.classList.remove('fullscreen-mode');
      surface.classList.add('preview-mode');
      surface.style.zIndex = this.isModalOpen() ? '5' : '30';

      if (forceRecalc || !this.cachedPreviewRect) {
        const frame = document.getElementById('preview-frame');
        if (frame) {
          const rect = frame.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            this.cachedPreviewRect = {
              left: Math.round(rect.left) + 'px',
              top: Math.round(rect.top) + 'px',
              width: Math.round(rect.width) + 'px',
              height: Math.round(rect.height) + 'px'
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
      this.showToast('טוען וממזג מקורות M3U...');
      if (statusText) statusText.textContent = 'מוריד וממזג רשימות ערוצים...';
    }

    this.store
      .fetchAllSources()
      .then((res) => {
        if (res.epgUrl && !localStorage.getItem(STORAGE_KEYS.EPG_URL)) {
          const epgInput = document.getElementById('epg-url-input');
          if (epgInput && !epgInput.value) epgInput.value = res.epgUrl;
          this.epg.loadEPG(res.epgUrl, () => this.refreshVisibleEPGLabels());
        }

        if (!res.compiledChannels || res.compiledChannels.length === 0) {
          if (!silentBackground) {
            this.showToast('לא נמצאו ערוצים פעילים במקורות ה-M3U');
            if (statusText) statusText.textContent = 'לא נמצאו ערוצים פעילים.';
          }
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
          this.showToast('נטענו ' + this.allChannels.length + ' ערוצים');
          this.onlyFavorites = false;
          this.applyChannelFilter();
          this.restoreLastWatchedChannel();
          this.updateVideoSurfacePosition();
        } else {
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
          this.showToast('שגיאה בטעינת מקורות M3U. בדוק את ההגדרות.');
          if (statusText) statusText.textContent = 'שגיאה: ' + err.message;
        }
      });
  }

  restoreLastWatchedChannel() {
    const lastChId = localStorage.getItem(STORAGE_KEYS.LAST_CHANNEL);
    const startIdx = this.visibleChannels.findIndex((c) => c.id === lastChId);
    this.focusedChannelIndex = startIdx !== -1 ? startIdx : 0;

    this.updateChannelFocusFast();
    const startCh = this.visibleChannels[this.focusedChannelIndex];
    if (startCh) {
      this.highlightChannel(startCh, true);
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

  renderChannelList() {
    const listEl = document.getElementById('channel-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    this.channelRowNodes = [];
    this.currentActiveRowEl = null;

    if (this.visibleChannels.length === 0) {
      listEl.innerHTML =
        '<div style="padding: 36px 24px; color: #94a3b8; font-size: 25px; font-weight: 700; text-align: center;">' +
        (this.onlyFavorites
          ? 'רשימת המועדפים ריקה כעת.<br><span style="font-size:21px;font-weight:500;">בחר ערוץ ולחץ על "הוסף למועדפים" בסרגל העליון.</span>'
          : 'אין ערוצים להצגה. לחץ על "הגדרות ו-M3U" להוספת פלייליסט.') +
        '</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (let idx = 0; idx < this.visibleChannels.length; idx++) {
      const ch = this.visibleChannels[idx];
      const item = document.createElement('div');
      const isSelected = this.selectedChannel && this.selectedChannel.id === ch.id;
      item.className = 'channel-item focusable' + (isSelected ? ' active' : '');
      item.dataset.index = idx;
      item.dataset.channelId = ch.id;
      if (isSelected) this.currentActiveRowEl = item;

      const isFav = this.favorites.has(ch.id);
      const epgInfo = this.epg ? this.epg.getNowNext(ch) : null;
      const nowPlayingTitle = epgInfo && epgInfo.current ? epgInfo.current.title : 'שידור ישיר';
      const monogram = this.getChannelMonogram(ch);
      const pillLabel = isSelected ? 'מתנגן • OK למסך מלא ▶' : 'לחץ OK למעבר';

      item.innerHTML =
        '<span class="channel-number">' + ch.number + '</span>' +
        '<div class="channel-logo-thumb">' +
          (ch.logo
            ? '<img src="' + ch.logo + '" alt="" style="display:none;" onload="if(this.naturalWidth>2){this.style.display=\'block\';if(this.nextElementSibling)this.nextElementSibling.style.display=\'none\';}" onerror="this.style.display=\'none\';if(this.nextElementSibling)this.nextElementSibling.style.display=\'block\';">'
            : '') +
          '<span class="channel-thumb-placeholder">' + monogram + '</span>' +
        '</div>' +
        '<div class="channel-text-col">' +
          '<span class="channel-title">' + ch.name + '</span>' +
          '<span class="channel-epg-sub">כעת: ' + nowPlayingTitle + '</span>' +
        '</div>' +
        (isFav ? '<span class="channel-fav-star">★</span>' : '') +
        '<span class="channel-playing-badge">מתנגן ▶</span>' +
        '<span class="channel-ok-pill">' + pillLabel + '</span>';

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

      this.channelRowNodes.push(item);
      fragment.appendChild(item);
    }

    listEl.appendChild(fragment);
  }

  refreshVisibleEPGLabels() {
    for (let i = 0; i < this.channelRowNodes.length; i++) {
      const ch = this.visibleChannels[i];
      const row = this.channelRowNodes[i];
      if (!ch || !row) continue;
      const sub = row.querySelector('.channel-epg-sub');
      if (sub) {
        const epgInfo = this.epg.getNowNext(ch);
        if (epgInfo && epgInfo.current) {
          sub.textContent = 'כעת: ' + epgInfo.current.title;
        }
      }
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
  previewChannelInfo(channel) {
    if (!channel) return;
    this.previewedChannel = channel;

    const numEl = document.getElementById('preview-channel-num');
    const nameEl = document.getElementById('preview-channel-name');
    const catEl = document.getElementById('preview-channel-category');
    const srcEl = document.getElementById('preview-channel-source');
    if (numEl) numEl.textContent = 'ערוץ ' + channel.number;
    if (nameEl) nameEl.textContent = channel.name;
    if (catEl) catEl.textContent = channel.group || 'טלוויזיה חיה';
    if (srcEl) srcEl.textContent = channel.sourceName || 'פלייליסט ראשי';

    const logoImg = document.getElementById('preview-channel-logo');
    const logoPlaceholder = document.getElementById('preview-channel-placeholder');
    if (logoImg && logoPlaceholder) {
      logoPlaceholder.textContent = this.getChannelMonogram(channel);
      logoImg.classList.add('hidden');
      logoPlaceholder.classList.remove('hidden');
      if (channel.logo) {
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
        logoImg.src = channel.logo;
      }
    }

    this.updateFavoriteButtonUI(channel);
    this.updateEPGUI(channel);
  }

  /**
   * Switches the active playing video stream to `channel` (triggered on OK press or initial boot).
   */
  highlightChannel(channel, immediatePlay) {
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

    const catchupBadge = document.getElementById('video-catchup-badge');
    if (catchupBadge) catchupBadge.classList.add('hidden');

    if (this.mode === 'FULLSCREEN') {
      this.updateOSD(channel, false);
    }

    clearTimeout(this.previewDebounceTimer);
    if (immediatePlay) {
      localStorage.setItem(STORAGE_KEYS.LAST_CHANNEL, channel.id);
      this.player.play(channel);
    } else {
      this.previewDebounceTimer = setTimeout(() => {
        localStorage.setItem(STORAGE_KEYS.LAST_CHANNEL, channel.id);
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

  startProgrammeCatchup(channel, prog) {
    if (!channel || !prog) return;
    this.selectedChannel = channel;
    this.player.playProgrammeStartOver(channel, prog);

    const catchupBadge = document.getElementById('video-catchup-badge');
    if (catchupBadge) {
      catchupBadge.textContent = 'סטארט אובר: ' + prog.title + ' (' + prog.startStr + ' - ' + prog.stopStr + ')';
      catchupBadge.classList.remove('hidden');
    }

    this.enterFullscreen();
    this.showToast('מפעיל מההתחלה (סטארט אובר): ' + prog.title);
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
      osdPlaceholder.textContent = this.getChannelMonogram(channel);
      osdLogo.classList.add('hidden');
      osdPlaceholder.classList.remove('hidden');
      if (channel.logo) {
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
        osdLogo.src = channel.logo;
      }
    }

    if (this.epg) {
      const epgData = this.epg.getNowNext(channel);
      if (epgData && epgData.current) {
        const osdTitle = document.getElementById('osd-epg-title');
        const osdTime = document.getElementById('osd-epg-time');
        const osdProg = document.getElementById('osd-epg-progress');
        const osdDesc = document.getElementById('osd-epg-desc');
        const osdPrevTitle = document.getElementById('osd-epg-prev-title');
        const osdPrevTime = document.getElementById('osd-epg-prev-time');
        const osdNextTitle = document.getElementById('osd-epg-next-title');
        const osdNextTime = document.getElementById('osd-epg-next-time');

        if (osdTitle) osdTitle.textContent = epgData.current.title;
        if (osdTime) osdTime.textContent = epgData.current.startStr + ' - ' + epgData.current.stopStr;
        if (osdProg) osdProg.style.width = epgData.current.progressPercent + '%';
        if (osdDesc) osdDesc.textContent = epgData.current.desc;

        if (osdPrevTitle) {
          osdPrevTitle.textContent = epgData.previous ? epgData.previous.title : 'שידור קודם';
        }
        if (osdPrevTime) {
          osdPrevTime.textContent = epgData.previous
            ? epgData.previous.startStr + ' - ' + epgData.previous.stopStr
            : '';
        }

        if (osdNextTitle) {
          osdNextTitle.textContent = epgData.next ? epgData.next.title : 'שידור המשך';
        }
        if (osdNextTime) {
          osdNextTime.textContent = epgData.next
            ? epgData.next.startStr + ' - ' + epgData.next.stopStr
            : '';
        }
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
    this.osdTimer = setTimeout(() => {
      osd.classList.add('hidden');
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
      this.renderChannelList();
      if (this.focusArea === 'channels') {
        this.updateChannelFocusFast();
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
        this.player.rewind(15);
        this.showToast('◀◀ הרצה אחורה 15 שניות');
        return;
      } else if (direction === 'right') {
        this.player.fastForward(15);
        this.showToast('▶▶ הרצה קדימה 15 שניות');
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
        // Preview channel EPG/info ONLY without switching the playing stream!
        this.previewChannelInfo(this.visibleChannels[this.focusedChannelIndex]);
      } else if (direction === 'up') {
        if (this.visibleChannels.length === 0) {
          this.focusHeaderBar();
          return;
        }
        if (this.focusedChannelIndex > 0) {
          this.focusedChannelIndex--;
          this.updateChannelFocusFast();
          // Preview channel EPG/info ONLY without switching the playing stream!
          this.previewChannelInfo(this.visibleChannels[this.focusedChannelIndex]);
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
          this.showToast('עבר לערוץ ' + targetCh.number + ': ' + targetCh.name);
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
        // Channel is not currently playing -> Switch to it ONLY on OK press!
        this.highlightChannel(targetCh, true);
        this.showToast('עבר לערוץ ' + targetCh.number + ': ' + targetCh.name);
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

    if (this.selectedChannel) {
      this.enterFullscreen();
    }
  }

  /* --------------------------------------------------------------------------
     Fullscreen Mode Control
     -------------------------------------------------------------------------- */

  enterFullscreen() {
    if (!this.selectedChannel) return;
    this.mode = 'FULLSCREEN';
    this.isSurfing = false;
    this.updateVideoSurfacePosition();
    this.updateOSD(this.selectedChannel, false);
    this.showOSD(4500);
  }

  exitFullscreen() {
    this.mode = 'BROWSE';
    this.isSurfing = false;
    this.focusArea = 'channels';
    const osd = document.getElementById('fullscreen-osd');
    if (osd) osd.classList.add('hidden');
    if (this.selectedChannel) {
      const idx = this.visibleChannels.findIndex((c) => c.id === this.selectedChannel.id);
      if (idx !== -1) this.focusedChannelIndex = idx;
      this.previewChannelInfo(this.selectedChannel);
    }
    this.updateVideoSurfacePosition();
    this.updateChannelFocusFast();
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
    const textEl = document.getElementById('jump-number-digits');
    if (!overlay || !textEl) return;
    textEl.textContent = digits;
    overlay.classList.remove('hidden');

    clearTimeout(this.jumpTimer);
    this.jumpTimer = setTimeout(() => {
      overlay.classList.add('hidden');
    }, 1400);
  }

  /* --------------------------------------------------------------------------
     Remote Color Buttons & Media Handlers
     Red: Start Over (סטארט אובר)
     Green: Rewind 30s (הרצה אחורה)
     Yellow: 7-Day Channel Program Guide (מדריך התוכניות של הערוץ)
     Blue: Fast-Forward 30s (הרצה קדימה)
     OK (Fullscreen): 1st press = Info-Bar | 2nd press = Pause / Play
     -------------------------------------------------------------------------- */

  onRedButton() {
    if (this.player) {
      this.player.startOver();
      this.showToast('סטארט אובר (חזרה לתחילת השידור)');
    }
  }

  onGreenButton() {
    if (this.player) {
      this.player.rewind(30);
      this.showToast('◀◀ הרצה אחורה 30 שניות');
    }
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
    if (this.player) {
      this.player.fastForward(30);
      this.showToast('▶▶ הרצה קדימה 30 שניות');
    }
  }

  togglePlayPause() {
    if (this.player) {
      const isPaused = this.player.togglePlayPause();
      const osdLiveBadge = document.getElementById('osd-live-badge');
      if (osdLiveBadge) {
        osdLiveBadge.textContent = isPaused ? '❚❚ מושהה' : 'שידור חי';
      }
      this.showToast(isPaused ? '❚❚ השהייה (לחץ OK להמשך)' : '▶ המשך ניגון (Play)');
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
  }

  renderGuideDayProgrammes() {
    const listEl = document.getElementById('guide-programmes-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    this.guideProgNodes = [];

    const dayBucket = this.guideDays[this.guideDayIndex];
    if (!dayBucket || !dayBucket.programmes || dayBucket.programmes.length === 0) {
      listEl.innerHTML = '<div style="padding:28px;font-size:24px;color:#94a3b8;">אין תוכניות רשומות ליום זה.</div>';
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
          statusEl.style.backgroundColor = '#f59e0b';
          statusEl.style.color = '#0f172a';
        } else if (prog.status === 'live') {
          statusEl.textContent = '• משודר כעת בשידור חי (לחץ OK לצפייה / סטארט אובר)';
          statusEl.style.backgroundColor = '#e11d48';
          statusEl.style.color = '#ffffff';
        } else {
          statusEl.textContent = 'ישודר בהמשך היום';
          statusEl.style.backgroundColor = '#334155';
          statusEl.style.color = '#e2e8f0';
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

    const focusables = Array.from(activeModal.querySelectorAll('.focusable')).filter(
      (el) => el.offsetWidth > 0 || el.offsetHeight > 0
    );
    if (focusables.length === 0) return;

    const curIdx = focusables.indexOf(this.currentFocusedEl);
    const activeIdx = curIdx !== -1 ? curIdx : 0;
    const currentEl = focusables[activeIdx];
    const curRect = currentEl.getBoundingClientRect();
    const curCx = curRect.left + curRect.width / 2;
    const curCy = curRect.top + curRect.height / 2;

    let bestIndex = -1;
    let bestScore = Infinity;

    for (let i = 0; i < focusables.length; i++) {
      if (i === activeIdx) continue;
      const rect = focusables[i].getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

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

    matches.forEach((ch) => {
      const row = document.createElement('div');
      row.className = 'channel-item focusable';
      row.innerHTML =
        '<span class="channel-number">' + ch.number + '</span>' +
        '<div class="channel-text-col">' +
          '<span class="channel-title">' + ch.name + '</span>' +
          '<span class="channel-epg-sub">' + (ch.group || 'טלוויזיה חיה') + '</span>' +
        '</div>';

      row.addEventListener('click', () => {
        this.closeModals();
        const idx = this.visibleChannels.findIndex((c) => c.id === ch.id);
        if (idx !== -1) this.focusedChannelIndex = idx;
        this.highlightChannel(ch, true);
        this.enterFullscreen();
      });
      listEl.appendChild(row);
    });
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
        const epgUrl = localStorage.getItem(STORAGE_KEYS.EPG_URL);
        if (epgUrl) {
          this.epg.loadEPG(epgUrl, () => this.refreshVisibleEPGLabels(), true);
        }
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
              this.epg.loadEPG(summary.epgUrl, () => this.refreshVisibleEPGLabels());
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
          this.epg.loadEPG(epgUrl, () => this.refreshVisibleEPGLabels());
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

window.addEventListener('DOMContentLoaded', () => {
  window.app = new IPTVApp();
});
