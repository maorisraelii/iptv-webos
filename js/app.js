/**
 * Main IPTV Live TV Application Controller
 * Production-grade 10-foot UI optimized for LG webOS 4.64 & 5.0+
 */

const STORAGE_KEYS = {
  M3U_URL: 'zenplay_iptv_m3u_url',
  EPG_URL: 'zenplay_iptv_epg_url',
  REMOTE_URL: 'zenplay_iptv_remote_url',
  FAVORITES: 'zenplay_iptv_favorites',
  LAST_CHANNEL: 'zenplay_iptv_last_channel'
};

// Public fallback playlist for first-boot demonstration
const SAMPLE_M3U_URL = 'https://iptv-org.github.io/iptv/countries/il.m3u';

class IPTVApp {
  constructor() {
    this.mode = 'BROWSE'; // 'BROWSE', 'FULLSCREEN', 'SETTINGS', 'SEARCH'
    this.focusArea = 'channels'; // 'channels', 'header', 'modal'

    this.parser = new M3UParser();
    this.epg = new EPGService();
    this.player = null;
    this.remote = null;

    this.allChannels = [];
    this.favorites = new Set();
    this.onlyFavorites = false;

    this.visibleChannels = [];
    this.selectedChannel = null;

    this.focusedChannelIndex = 0;
    this.focusedHeaderIndex = 0;
    this.focusedModalIndex = 0;
    this.activeSettingsInputId = 'm3u-url-input';

    // Fullscreen Info-Bar Surfing state (זפינג בפס מידע ללא החלפת ערוץ)
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

    // Ensure keyboard / remote focus is attached to window & document on webOS
    window.focus();
    if (document.body) {
      document.body.focus();
    }

    // Load saved EPG URL if configured
    const savedEpgUrl = localStorage.getItem(STORAGE_KEYS.EPG_URL);
    if (savedEpgUrl) {
      const epgInput = document.getElementById('epg-url-input');
      if (epgInput) epgInput.value = savedEpgUrl;
      this.epg.loadEPG(savedEpgUrl);
    }

    // Load saved M3U URL or default sample
    const savedUrl = localStorage.getItem(STORAGE_KEYS.M3U_URL);
    const savedRemoteUrl = localStorage.getItem(STORAGE_KEYS.REMOTE_URL);
    if (savedRemoteUrl) {
      const remoteInput = document.getElementById('remote-url-input');
      if (remoteInput) remoteInput.value = savedRemoteUrl;
    }

    if (savedUrl) {
      const m3uInput = document.getElementById('m3u-url-input');
      if (m3uInput) m3uInput.value = savedUrl;
      this.loadPlaylist(savedUrl);
    } else {
      const m3uInput = document.getElementById('m3u-url-input');
      if (m3uInput) m3uInput.value = SAMPLE_M3U_URL;
      this.showToast('ברוך הבא! טוען רשימת ערוצים...');
      this.loadPlaylist(SAMPLE_M3U_URL);
    }

    this.updateVideoSurfacePosition();
    setTimeout(() => this.updateVideoSurfacePosition(), 200);
    setTimeout(() => this.updateVideoSurfacePosition(), 600);
    window.addEventListener('resize', () => this.updateVideoSurfacePosition());
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
        if (!loader || !errBadge) return;

        if (state === 'loading' || state === 'buffering' || state === 'retrying') {
          loader.classList.remove('hidden');
          errBadge.classList.add('hidden');
        } else if (state === 'playing') {
          loader.classList.add('hidden');
          errBadge.classList.add('hidden');
        } else if (state === 'error') {
          loader.classList.add('hidden');
          errBadge.classList.remove('hidden');
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
    setInterval(updateTime, 10000);
  }

  updateVideoSurfacePosition() {
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

      // Keep video below modal backdrop when a modal is open, otherwise above app-shell
      surface.style.zIndex = this.isModalOpen() ? '5' : '30';

      const frame = document.getElementById('preview-frame');
      if (frame) {
        const rect = frame.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          surface.style.left = Math.round(rect.left) + 'px';
          surface.style.top = Math.round(rect.top) + 'px';
          surface.style.width = Math.round(rect.width) + 'px';
          surface.style.height = Math.round(rect.height) + 'px';
          surface.style.borderRadius = '20px';
        }
      }
    }
  }

  /* --------------------------------------------------------------------------
     M3U Playlist Loading & Parsing
     -------------------------------------------------------------------------- */

  loadPlaylist(url) {
    if (!url) return;
    this.showToast('טוען רשימת ערוצים...');
    const statusText = document.getElementById('settings-status-text');
    if (statusText) statusText.textContent = 'מוריד נתוני פלייליסט...';

    fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error('שגיאת שרת: ' + response.status);
        }
        return response.text();
      })
      .then((m3uContent) => {
        const result = this.parser.parse(m3uContent);
        this.allChannels = result.channels || [];

        localStorage.setItem(STORAGE_KEYS.M3U_URL, url);

        if (result.epgUrl && !localStorage.getItem(STORAGE_KEYS.EPG_URL)) {
          const epgInput = document.getElementById('epg-url-input');
          if (epgInput && !epgInput.value) epgInput.value = result.epgUrl;
          this.epg.loadEPG(result.epgUrl);
        }

        if (this.allChannels.length === 0) {
          this.showToast('לא נמצאו ערוצים בפלייליסט זה');
          if (statusText) statusText.textContent = 'הפלייליסט ריק או לא תקין.';
          return;
        }

        if (statusText) {
          statusText.textContent = 'נטענו בהצלחה ' + this.allChannels.length + ' ערוצים לשידור חי.';
        }
        this.showToast('נטענו ' + this.allChannels.length + ' ערוצים');

        this.onlyFavorites = false;
        this.applyChannelFilter();

        // Restore last watched channel or play first channel
        const lastChId = localStorage.getItem(STORAGE_KEYS.LAST_CHANNEL);
        const startIdx = this.visibleChannels.findIndex((c) => c.id === lastChId);
        this.focusedChannelIndex = startIdx !== -1 ? startIdx : 0;

        this.updateChannelFocusClass();
        const startCh = this.visibleChannels[this.focusedChannelIndex];
        if (startCh) {
          this.highlightChannel(startCh, true);
        }

        this.updateVideoSurfacePosition();
      })
      .catch((err) => {
        console.error('Failed to load M3U:', err);
        this.showToast('שגיאה בטעינת הפלייליסט. בדוק את הקישור בהגדרות.');
        if (statusText) statusText.textContent = 'שגיאה: ' + err.message;
      });
  }

  /* --------------------------------------------------------------------------
     Channel List Filtering & Rendering (No Category Clutter)
     -------------------------------------------------------------------------- */

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
      if (titleEl) titleEl.textContent = 'ערוצים מועדפים ⭐';
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
      this.updateChannelFocusClass();
    }
  }

  renderChannelList() {
    const listEl = document.getElementById('channel-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (this.visibleChannels.length === 0) {
      listEl.innerHTML =
        '<div style="padding: 36px 24px; color: #94a3b8; font-size: 26px; font-weight: 700; text-align: center;">' +
        (this.onlyFavorites
          ? 'רשימת המועדפים ריקה כעת.<br><span style="font-size:22px;font-weight:500;">בחר ערוץ ולחץ על "הוסף למועדפים" בסרגל העליון.</span>'
          : 'אין ערוצים להצגה. לחץ על "הגדרות" להזנת פלייליסט.') +
        '</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    this.visibleChannels.forEach((ch, idx) => {
      const item = document.createElement('div');
      const isSelected = this.selectedChannel && this.selectedChannel.id === ch.id;
      item.className = 'channel-item focusable' + (isSelected ? ' active' : '');
      item.dataset.index = idx;
      item.dataset.channelId = ch.id;

      const isFav = this.favorites.has(ch.id);
      const epgInfo = this.epg ? this.epg.getNowNext(ch) : null;
      const nowPlayingTitle = epgInfo && epgInfo.current ? epgInfo.current.title : 'שידור ישיר';

      item.innerHTML =
        '<span class="channel-number">' + ch.number + '</span>' +
        '<div class="channel-logo-thumb">' +
          (ch.logo
            ? '<img src="' + ch.logo + '" alt="" onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'block\';">'
            : '') +
          '<span class="channel-thumb-placeholder" style="' + (ch.logo ? 'display:none;' : '') + '">TV</span>' +
        '</div>' +
        '<div class="channel-text-col">' +
          '<span class="channel-title">' + ch.name + '</span>' +
          '<span class="channel-epg-sub">משודר כעת: ' + nowPlayingTitle + '</span>' +
        '</div>' +
        (isFav ? '<span class="channel-fav-star">★</span>' : '') +
        '<span class="channel-ok-pill">OK למסך מלא ▶</span>';

      item.addEventListener('click', () => {
        this.focusArea = 'channels';
        this.focusedChannelIndex = idx;
        this.updateChannelFocusClass();
        if (this.selectedChannel && this.selectedChannel.id === ch.id) {
          this.enterFullscreen();
        } else {
          this.highlightChannel(ch, true);
        }
      });

      fragment.appendChild(item);
    });

    listEl.appendChild(fragment);
  }

  /* --------------------------------------------------------------------------
     Channel Selection, Live Preview Playback & EPG Updates
     -------------------------------------------------------------------------- */

  highlightChannel(channel, immediatePlay) {
    if (!channel) return;
    this.selectedChannel = channel;
    localStorage.setItem(STORAGE_KEYS.LAST_CHANNEL, channel.id);

    // Update active state in channel list
    const items = document.querySelectorAll('#channel-list .channel-item');
    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      if (el.dataset.channelId === channel.id) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }

    // Update Preview Card Details
    const numEl = document.getElementById('preview-channel-num');
    const nameEl = document.getElementById('preview-channel-name');
    const catEl = document.getElementById('preview-channel-category');
    if (numEl) numEl.textContent = 'ערוץ ' + channel.number;
    if (nameEl) nameEl.textContent = channel.name;
    if (catEl) catEl.textContent = channel.group || 'טלוויזיה חיה';

    const logoImg = document.getElementById('preview-channel-logo');
    const logoPlaceholder = document.getElementById('preview-channel-placeholder');
    if (logoImg && logoPlaceholder) {
      if (channel.logo) {
        logoImg.src = channel.logo;
        logoImg.classList.remove('hidden');
        logoPlaceholder.classList.add('hidden');
        logoImg.onerror = () => {
          logoImg.classList.add('hidden');
          logoPlaceholder.classList.remove('hidden');
        };
      } else {
        logoImg.classList.add('hidden');
        logoPlaceholder.classList.remove('hidden');
      }
    }

    this.updateFavoriteButtonUI();
    this.updateEPGUI(channel);
    this.updateOSD(channel, false);
    this.updateVideoSurfacePosition();

    // Play live stream in the Preview / Fullscreen Video Player
    clearTimeout(this.previewDebounceTimer);
    if (immediatePlay) {
      this.player.play(channel);
    } else {
      this.previewDebounceTimer = setTimeout(() => {
        this.player.play(channel);
      }, 280);
    }
  }

  updateEPGUI(channel) {
    if (!channel || !this.epg) return;
    const epgData = this.epg.getNowNext(channel);
    if (!epgData) return;

    const titleEl = document.getElementById('preview-epg-title');
    const timeEl = document.getElementById('preview-epg-time');
    const progressEl = document.getElementById('preview-epg-progress');
    const descEl = document.getElementById('preview-epg-desc');
    const nextTitleEl = document.getElementById('preview-epg-next-title');
    const nextTimeEl = document.getElementById('preview-epg-next-time');

    if (titleEl) titleEl.textContent = epgData.current.title;
    if (timeEl) timeEl.textContent = epgData.current.startStr + ' - ' + epgData.current.stopStr;
    if (progressEl) progressEl.style.width = epgData.current.progressPercent + '%';
    if (descEl) descEl.textContent = epgData.current.desc;

    if (nextTitleEl) {
      nextTitleEl.textContent = epgData.next ? epgData.next.title : 'שידור המשך';
    }
    if (nextTimeEl) {
      nextTimeEl.textContent = epgData.next ? epgData.next.startStr : '';
    }
  }

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
      if (channel.logo) {
        osdLogo.src = channel.logo;
        osdLogo.classList.remove('hidden');
        osdPlaceholder.classList.add('hidden');
        osdLogo.onerror = () => {
          osdLogo.classList.add('hidden');
          osdPlaceholder.classList.remove('hidden');
        };
      } else {
        osdLogo.classList.add('hidden');
        osdPlaceholder.classList.remove('hidden');
      }
    }

    if (this.epg) {
      const epgData = this.epg.getNowNext(channel);
      if (epgData) {
        const osdTitle = document.getElementById('osd-epg-title');
        const osdTime = document.getElementById('osd-epg-time');
        const osdProg = document.getElementById('osd-epg-progress');
        const osdDesc = document.getElementById('osd-epg-desc');
        const osdNextTitle = document.getElementById('osd-epg-next-title');
        const osdNextTime = document.getElementById('osd-epg-next-time');

        if (osdTitle) osdTitle.textContent = epgData.current.title;
        if (osdTime) osdTime.textContent = epgData.current.startStr + ' - ' + epgData.current.stopStr;
        if (osdProg) osdProg.style.width = epgData.current.progressPercent + '%';
        if (osdDesc) osdDesc.textContent = epgData.current.desc;
        if (osdNextTitle) osdNextTitle.textContent = epgData.next ? epgData.next.title : 'שידור המשך';
        if (osdNextTime) osdNextTime.textContent = epgData.next ? epgData.next.startStr : '';
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
  }

  showOSD(duration) {
    const waitMs = duration || 4500;
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
    if (!this.selectedChannel) return;
    const id = this.selectedChannel.id;

    if (this.favorites.has(id)) {
      this.favorites.delete(id);
      this.showToast('הוסר מהמועדפים: ' + this.selectedChannel.name);
    } else {
      this.favorites.add(id);
      this.showToast('נוסף למועדפים ⭐: ' + this.selectedChannel.name);
    }

    this.saveFavorites();
    this.updateFavoriteButtonUI();

    if (this.onlyFavorites) {
      this.applyChannelFilter();
    } else {
      this.renderChannelList();
      if (this.focusArea === 'channels') {
        this.updateChannelFocusClass();
      }
    }
  }

  updateFavoriteButtonUI() {
    if (!this.selectedChannel) return;
    const isFav = this.favorites.has(this.selectedChannel.id);
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
     Spatial Navigation & Focus Control (1 Step per Press, Jump-Free Scroll)
     -------------------------------------------------------------------------- */

  getHeaderButtons() {
    return [
      document.getElementById('btn-filter-favs'),
      document.getElementById('btn-toggle-favorite'),
      document.getElementById('btn-search-trigger'),
      document.getElementById('btn-open-settings')
    ].filter(Boolean);
  }

  navigate(direction) {
    // 1. FULLSCREEN MODE: Info-Bar Channel Surfing (Up = Next Channel +1, Down = Prev Channel -1)
    if (this.mode === 'FULLSCREEN') {
      if (direction === 'up' || direction === 'down') {
        if (this.visibleChannels.length === 0) return;

        if (!this.isSurfing) {
          this.isSurfing = true;
          this.surfingIndex = this.focusedChannelIndex;
        }

        // Up (▲) advances channel number UP (+1: 11 -> 12 -> 13)
        // Down (▼) moves channel number DOWN (-1: 13 -> 12 -> 11)
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
        this.showToast('⏪ הרצה אחורה 15 שניות');
        return;
      } else if (direction === 'right') {
        this.player.fastForward(15);
        this.showToast('⏩ הרצה קדימה 15 שניות');
        return;
      }
      return;
    }

    // 2. MODAL MODE (Settings or Search)
    if (this.mode === 'SETTINGS' || this.mode === 'SEARCH') {
      this.navigateModal(direction);
      return;
    }

    // 3. BROWSE MODE: Channel List & Top Header Bar
    if (this.focusArea === 'channels') {
      if (direction === 'down') {
        if (this.visibleChannels.length === 0) return;
        if (this.focusedChannelIndex < this.visibleChannels.length - 1) {
          this.focusedChannelIndex++;
        } else {
          this.focusedChannelIndex = 0; // Wrap around to top
        }
        this.updateChannelFocusClass();
        this.highlightChannel(this.visibleChannels[this.focusedChannelIndex], false);
      } else if (direction === 'up') {
        if (this.visibleChannels.length === 0) {
          this.focusHeaderBar();
          return;
        }
        if (this.focusedChannelIndex > 0) {
          this.focusedChannelIndex--;
          this.updateChannelFocusClass();
          this.highlightChannel(this.visibleChannels[this.focusedChannelIndex], false);
        } else {
          // At top of channel list: pressing Up moves to Top Header Toolbar
          this.focusHeaderBar();
        }
      } else if (direction === 'left') {
        // Move to Top Header Toolbar
        this.focusHeaderBar();
      } else if (direction === 'right') {
        // Stay on channel list
        this.updateChannelFocusClass();
      }
    } else if (this.focusArea === 'header') {
      const buttons = this.getHeaderButtons();
      if (buttons.length === 0) return;

      if (direction === 'left') {
        // In RTL, Left moves to next button on the left
        this.focusedHeaderIndex = (this.focusedHeaderIndex + 1) % buttons.length;
        this.updateHeaderFocusClass();
      } else if (direction === 'right') {
        if (this.focusedHeaderIndex > 0) {
          this.focusedHeaderIndex--;
          this.updateHeaderFocusClass();
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
    this.updateHeaderFocusClass();
  }

  focusChannelList() {
    this.focusArea = 'channels';
    this.updateChannelFocusClass();
  }

  updateHeaderFocusClass() {
    this.clearAllFocusStyles();
    const buttons = this.getHeaderButtons();
    if (buttons[this.focusedHeaderIndex]) {
      buttons[this.focusedHeaderIndex].classList.add('focused');
    }
  }

  updateChannelFocusClass() {
    this.clearAllFocusStyles();
    const listEl = document.getElementById('channel-list');
    const items = document.querySelectorAll('#channel-list .channel-item');
    const targetItem = items[this.focusedChannelIndex];
    if (targetItem && listEl) {
      targetItem.classList.add('focused');
      this.scrollChannelIntoView(listEl, targetItem);
    }
  }

  /**
   * Mathematically scrolls ONLY the channel list container when needed.
   * Prevents Chromium 53/68 scrollIntoView bugs that jump the whole TV screen!
   */
  scrollChannelIntoView(listEl, itemEl) {
    const listRect = listEl.getBoundingClientRect();
    const itemRect = itemEl.getBoundingClientRect();
    const padding = 18;

    if (itemRect.top < listRect.top + padding) {
      listEl.scrollTop -= (listRect.top + padding - itemRect.top);
    } else if (itemRect.bottom > listRect.bottom - padding) {
      listEl.scrollTop += (itemRect.bottom - (listRect.bottom - padding));
    }
  }

  clearAllFocusStyles() {
    const focused = document.querySelectorAll('.focused');
    for (let i = 0; i < focused.length; i++) {
      focused[i].classList.remove('focused');
    }
  }

  selectCurrent() {
    // 1. FULLSCREEN MODE
    if (this.mode === 'FULLSCREEN') {
      if (this.isSurfing) {
        // Confirm channel switch from Info-Bar Surfing!
        this.focusedChannelIndex = this.surfingIndex;
        this.isSurfing = false;
        const targetCh = this.visibleChannels[this.focusedChannelIndex];
        if (targetCh) {
          this.highlightChannel(targetCh, true);
          this.updateOSD(targetCh, false);
          this.showOSD(3500);
          this.showToast('עבר לערוץ ' + targetCh.number + ': ' + targetCh.name);
        }
      } else {
        const osd = document.getElementById('fullscreen-osd');
        if (osd && !osd.classList.contains('hidden')) {
          // If OSD is already visible and user presses OK again, open the channel list guide
          this.exitFullscreen();
        } else {
          this.showOSD(4500);
        }
      }
      return;
    }

    // 2. MODAL MODE
    if (this.mode === 'SETTINGS' || this.mode === 'SEARCH') {
      const focusedBtn = document.querySelector('.modal-backdrop:not(.hidden) .focusable.focused');
      if (focusedBtn) {
        if (focusedBtn.tagName === 'INPUT') {
          this.activeSettingsInputId = focusedBtn.id;
          focusedBtn.focus();
        } else {
          focusedBtn.click();
        }
      }
      return;
    }

    // 3. BROWSE MODE
    if (this.focusArea === 'channels') {
      const targetCh = this.visibleChannels[this.focusedChannelIndex];
      if (!targetCh) return;

      if (!this.selectedChannel || this.selectedChannel.id !== targetCh.id) {
        this.highlightChannel(targetCh, true);
      }
      this.enterFullscreen();
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
        // Cancel surfing and restore current playing channel info
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

    if (this.focusArea === 'header') {
      this.focusChannelList();
      return;
    }

    // At root of Browse Mode -> Enter Fullscreen if watching a channel
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
    this.showOSD(4000);
  }

  exitFullscreen() {
    this.mode = 'BROWSE';
    this.isSurfing = false;
    this.focusArea = 'channels';
    const osd = document.getElementById('fullscreen-osd');
    if (osd) osd.classList.add('hidden');
    this.updateVideoSurfacePosition();
    this.updateChannelFocusClass();
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
      this.showOSD(4000);
    } else {
      this.updateChannelFocusClass();
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
        this.showOSD(4000);
      } else {
        this.updateChannelFocusClass();
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
    }, 1500);
  }

  /* --------------------------------------------------------------------------
     Remote Color Buttons Handlers
     🔴 Red: Start Over (סטארט אובר)
     🟢 Green: Rewind (הרצה אחורה 30 שניות)
     🟡 Yellow: Pause / Play (פאוז / נגן)
     🔵 Blue: Fast Forward (הרצה קדימה 30 שניות)
     -------------------------------------------------------------------------- */

  onRedButton() {
    if (this.player) {
      this.player.startOver();
      this.showToast('↺ סטארט אובר (חזרה לתחילת השידור)');
    }
  }

  onGreenButton() {
    if (this.player) {
      this.player.rewind(30);
      this.showToast('⏪ הרצה אחורה 30 שניות');
    }
  }

  onYellowButton() {
    if (this.player) {
      const isPaused = this.player.togglePlayPause();
      this.showToast(isPaused ? '⏸ השהייה (Pause)' : '▶ המשך ניגון (Play)');
    }
  }

  onBlueButton() {
    if (this.player) {
      this.player.fastForward(30);
      this.showToast('⏩ הרצה קדימה 30 שניות');
    }
  }

  togglePlayPause() {
    this.onYellowButton();
  }

  stopPlayback() {
    if (this.player) {
      this.player.stop();
    }
  }

  /* --------------------------------------------------------------------------
     Modals (Settings & Search)
     -------------------------------------------------------------------------- */

  isModalOpen() {
    return this.mode === 'SETTINGS' || this.mode === 'SEARCH';
  }

  openSettingsModal() {
    this.mode = 'SETTINGS';
    this.activeSettingsInputId = 'm3u-url-input';
    const savedEpg = localStorage.getItem(STORAGE_KEYS.EPG_URL);
    if (savedEpg) {
      const epgInput = document.getElementById('epg-url-input');
      if (epgInput) epgInput.value = savedEpg;
    }
    document.getElementById('settings-modal').classList.remove('hidden');
    this.updateVideoSurfacePosition();
    this.setupModalFocus('#settings-modal');
  }

  openSearchModal() {
    this.mode = 'SEARCH';
    document.getElementById('search-modal').classList.remove('hidden');
    this.updateVideoSurfacePosition();
    this.renderSearchKeyboard();
    this.setupModalFocus('#search-modal');
  }

  closeModals() {
    const modals = document.querySelectorAll('.modal-backdrop');
    for (let i = 0; i < modals.length; i++) {
      modals[i].classList.add('hidden');
    }
    this.mode = 'BROWSE';
    this.focusArea = 'channels';
    this.updateVideoSurfacePosition();
    this.updateChannelFocusClass();
  }

  setupModalFocus(modalSelector) {
    this.clearAllFocusStyles();
    const focusableElements = document.querySelectorAll(modalSelector + ' .focusable');
    if (focusableElements.length > 0) {
      // Start focus on the first main interactive control (skip the top-left close button if possible)
      this.focusedModalIndex = focusableElements.length > 1 ? 1 : 0;
      focusableElements[this.focusedModalIndex].classList.add('focused');
    }
  }

  navigateModal(direction) {
    const activeModal = document.querySelector('.modal-backdrop:not(.hidden)');
    if (!activeModal) return;

    const focusables = Array.from(activeModal.querySelectorAll('.focusable'));
    if (focusables.length === 0) return;

    const currentEl = focusables[this.focusedModalIndex] || focusables[0];
    const curRect = currentEl.getBoundingClientRect();
    const curCx = curRect.left + curRect.width / 2;
    const curCy = curRect.top + curRect.height / 2;

    let bestIndex = -1;
    let bestScore = Infinity;

    for (let i = 0; i < focusables.length; i++) {
      if (i === this.focusedModalIndex) continue;
      const rect = focusables[i].getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = cx - curCx;
      const dy = cy - curCy;

      let isCandidate = false;
      let primaryDist = 0;
      let secondaryDist = 0;

      if (direction === 'down' && dy > 14) {
        isCandidate = true;
        primaryDist = dy;
        secondaryDist = Math.abs(dx) * 2.2;
      } else if (direction === 'up' && dy < -14) {
        isCandidate = true;
        primaryDist = -dy;
        secondaryDist = Math.abs(dx) * 2.2;
      } else if (direction === 'left' && dx < -14) {
        isCandidate = true;
        primaryDist = -dx;
        secondaryDist = Math.abs(dy) * 2.5;
      } else if (direction === 'right' && dx > 14) {
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
        bestIndex = (this.focusedModalIndex + 1) % focusables.length;
      } else {
        bestIndex = (this.focusedModalIndex - 1 + focusables.length) % focusables.length;
      }
    }

    this.focusedModalIndex = bestIndex;
    this.clearAllFocusStyles();
    const target = focusables[bestIndex];
    if (target) {
      target.classList.add('focused');
      if (target.tagName === 'INPUT') {
        this.activeSettingsInputId = target.id;
      }
      if (target.parentElement && target.parentElement.id === 'search-results-list') {
        this.scrollChannelIntoView(target.parentElement, target);
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
      '<button class="kb-key kb-key-wide focusable" data-kb="backspace">מחק ⌫</button>' +
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
      .filter((c) => c.name.toLowerCase().indexOf(q) !== -1 || String(c.number) === q || (c.group && c.group.toLowerCase().indexOf(q) !== -1))
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
    // Video surface click: in preview mode, enters fullscreen; in fullscreen mode, toggles OSD
    const videoSurface = document.getElementById('video-surface');
    if (videoSurface) {
      videoSurface.addEventListener('click', () => {
        if (this.mode === 'FULLSCREEN') {
          this.showOSD(4500);
        } else {
          this.enterFullscreen();
        }
      });
    }

    // Preview frame click
    const previewFrame = document.getElementById('preview-frame');
    if (previewFrame) {
      previewFrame.addEventListener('click', () => {
        this.enterFullscreen();
      });
    }

    // Header buttons
    const btnFilterFavs = document.getElementById('btn-filter-favs');
    if (btnFilterFavs) {
      btnFilterFavs.addEventListener('click', () => this.toggleFavoritesFilter());
    }

    const btnToggleFav = document.getElementById('btn-toggle-favorite');
    if (btnToggleFav) {
      btnToggleFav.addEventListener('click', () => this.toggleFavorite());
    }

    const btnSearch = document.getElementById('btn-search-trigger');
    if (btnSearch) {
      btnSearch.addEventListener('click', () => this.openSearchModal());
    }

    const btnSettings = document.getElementById('btn-open-settings');
    if (btnSettings) {
      btnSettings.addEventListener('click', () => this.openSettingsModal());
    }

    // Search input typing
    const searchInput = document.getElementById('search-query-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => this.filterChannels(e.target.value));
    }

    // Settings inputs track active input for virtual keyboard
    ['m3u-url-input', 'epg-url-input', 'remote-url-input'].forEach((id) => {
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

    // Settings actions
    const btnLoadSample = document.getElementById('btn-load-sample');
    if (btnLoadSample) {
      btnLoadSample.addEventListener('click', () => {
        document.getElementById('m3u-url-input').value = SAMPLE_M3U_URL;
        this.loadPlaylist(SAMPLE_M3U_URL);
        this.closeModals();
      });
    }

    const btnSavePlaylist = document.getElementById('btn-save-playlist');
    if (btnSavePlaylist) {
      btnSavePlaylist.addEventListener('click', () => {
        const url = document.getElementById('m3u-url-input').value.trim();
        const remoteUrl = document.getElementById('remote-url-input').value.trim();
        const epgUrl = document.getElementById('epg-url-input') ? document.getElementById('epg-url-input').value.trim() : '';

        if (remoteUrl) {
          localStorage.setItem(STORAGE_KEYS.REMOTE_URL, remoteUrl);
        } else {
          localStorage.removeItem(STORAGE_KEYS.REMOTE_URL);
        }

        if (epgUrl) {
          localStorage.setItem(STORAGE_KEYS.EPG_URL, epgUrl);
          this.epg.loadEPG(epgUrl);
        } else {
          localStorage.removeItem(STORAGE_KEYS.EPG_URL);
        }

        if (url) {
          this.loadPlaylist(url);
          this.closeModals();
        } else {
          this.showToast('נא להזין כתובת M3U תקינה');
        }
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
    }, 3200);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new IPTVApp();
});
