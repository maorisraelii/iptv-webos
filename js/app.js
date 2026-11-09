/**
 * Main IPTV Live TV Application Controller
 * Optimized for LG webOS 4.64 - 5.0+ and 1080p Smart TV UI
 */

const STORAGE_KEYS = {
  M3U_URL: 'zenplay_iptv_m3u_url',
  REMOTE_URL: 'zenplay_iptv_remote_url',
  FAVORITES: 'zenplay_iptv_favorites',
  LAST_CHANNEL: 'zenplay_iptv_last_channel'
};

// Verified working public streams as a fallback / sample
const SAMPLE_M3U_URL = 'https://iptv-org.github.io/iptv/countries/il.m3u';

class IPTVApp {
  constructor() {
    this.mode = 'BROWSE'; // 'BROWSE', 'FULLSCREEN', 'SETTINGS', 'SEARCH'
    this.focusArea = 'channels'; // 'rail', 'channels', 'preview', 'modal'
    
    this.parser = new M3UParser();
    this.player = null;
    this.remote = null;

    this.allChannels = [];
    this.categories = [];
    this.categoryMap = new Map();
    this.favorites = new Set();

    this.activeCategory = '__all__';
    this.visibleChannels = [];
    this.selectedChannel = null;

    this.focusedRailIndex = 0;
    this.focusedChannelIndex = 0;
    this.focusedModalIndex = 0;

    this.previewDebounceTimer = null;
    this.osdTimer = null;
    this.toastTimer = null;

    this.init();
  }

  async init() {
    this.loadFavorites();
    this.initPlayer();
    this.initRemote();
    this.initClock();
    this.bindDOMEvents();

    // Check if user already configured an M3U URL
    const savedUrl = localStorage.getItem(STORAGE_KEYS.M3U_URL);
    const savedRemoteUrl = localStorage.getItem(STORAGE_KEYS.REMOTE_URL);
    if (savedRemoteUrl) {
      const remoteInput = document.getElementById('remote-url-input');
      if (remoteInput) remoteInput.value = savedRemoteUrl;
    }
    if (savedUrl) {
      document.getElementById('m3u-url-input').value = savedUrl;
      await this.loadPlaylist(savedUrl);
    } else {
      // First boot: open settings or load sample
      document.getElementById('m3u-url-input').value = SAMPLE_M3U_URL;
      this.showToast('ברוך הבא! טוען ערוצים לדוגמה...');
      await this.loadPlaylist(SAMPLE_M3U_URL);
    }

    this.updateVideoSurfacePosition();
    window.addEventListener('resize', () => this.updateVideoSurfacePosition());
  }

  /* --------------------------------------------------------------------------
     Player & Video Surface Management
     -------------------------------------------------------------------------- */

  initPlayer() {
    const video = document.getElementById('tv-video');
    this.player = new VideoPlayer(video, {
      onStateChange: (state, channel) => {
        const loader = document.getElementById('video-loader');
        const errBadge = document.getElementById('video-error-badge');

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
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const timeStr = `${hours}:${minutes}`;

      const railClock = document.getElementById('clock');
      const osdClock = document.getElementById('osd-clock');
      if (railClock) railClock.textContent = timeStr;
      if (osdClock) osdClock.textContent = timeStr;
    };
    updateTime();
    setInterval(updateTime, 10000);
  }

  updateVideoSurfacePosition() {
    const surface = document.getElementById('video-surface');
    if (this.mode === 'FULLSCREEN') {
      surface.classList.remove('preview-mode');
      surface.classList.add('fullscreen-mode');
      surface.style.left = '';
      surface.style.top = '';
      surface.style.width = '';
      surface.style.height = '';
      surface.style.borderRadius = '';
    } else {
      surface.classList.remove('fullscreen-mode');
      surface.classList.add('preview-mode');

      const frame = document.getElementById('preview-frame');
      if (frame) {
        const rect = frame.getBoundingClientRect();
        surface.style.left = rect.left + 'px';
        surface.style.top = rect.top + 'px';
        surface.style.width = rect.width + 'px';
        surface.style.height = rect.height + 'px';
        surface.style.borderRadius = '1.25rem';
      }
    }
  }

  /* --------------------------------------------------------------------------
     M3U Playlist Loading & Parsing
     -------------------------------------------------------------------------- */

  async loadPlaylist(url) {
    if (!url) return;
    this.showToast('טוען רשימת שידור M3U...');
    const statusText = document.getElementById('settings-status-text');
    if (statusText) statusText.textContent = 'מוריד נתוני פלייליסט...';

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`שגיאת שרת: ${response.status}`);
      }
      const m3uContent = await response.text();
      const result = this.parser.parse(m3uContent);

      this.allChannels = result.channels;
      this.categories = result.categories;
      this.categoryMap = result.categoryMap;

      localStorage.setItem(STORAGE_KEYS.M3U_URL, url);

      if (this.allChannels.length === 0) {
        this.showToast('לא נמצאו ערוצים בפלייליסט זה');
        if (statusText) statusText.textContent = 'הפלייליסט ריק או לא תקין.';
        return;
      }

      if (statusText) {
        statusText.textContent = `נטענו בהצלחה ${this.allChannels.length} ערוצים ב-${this.categories.length} קטגוריות.`;
      }
      this.showToast(`נטענו ${this.allChannels.length} ערוצים`);

      this.renderCategoryRail();
      this.selectCategory('__all__');

      // Play first channel or restore last watched
      const lastChId = localStorage.getItem(STORAGE_KEYS.LAST_CHANNEL);
      const startCh = this.allChannels.find(c => c.id === lastChId) || this.allChannels[0];
      if (startCh) {
        this.highlightChannel(startCh);
      }
    } catch (err) {
      console.error('Failed to load M3U:', err);
      this.showToast('שגיאה בטעינת ה-M3U. ודא שהקישור תקין ויש חיבור רשת.');
      if (statusText) statusText.textContent = `שגיאה: ${err.message}`;
    }
  }

  /* --------------------------------------------------------------------------
     UI Rendering
     -------------------------------------------------------------------------- */

  renderCategoryRail() {
    const listEl = document.getElementById('category-list');
    listEl.innerHTML = '';

    const favChannels = this.allChannels.filter(c => this.favorites.has(c.id));

    // Special items
    const specialCategories = [
      { id: '__favs__', name: '★ מועדפים', count: favChannels.length },
      { id: '__all__', name: 'כל הערוצים', count: this.allChannels.length }
    ];

    specialCategories.forEach((cat, idx) => {
      const el = document.createElement('div');
      el.className = 'category-item focusable' + (this.activeCategory === cat.id ? ' active' : '');
      el.dataset.id = cat.id;
      el.dataset.railIndex = idx;
      el.innerHTML = `
        <span>${cat.name}</span>
        <span class="category-count">${cat.count}</span>
      `;
      el.addEventListener('click', () => {
        this.selectCategory(cat.id);
        this.closeCategoryRail();
      });
      listEl.appendChild(el);
    });

    // M3U groups
    this.categories.forEach((catName, idx) => {
      const count = (this.categoryMap.get(catName) || []).length;
      const el = document.createElement('div');
      const railIndex = idx + specialCategories.length;
      el.className = 'category-item focusable' + (this.activeCategory === catName ? ' active' : '');
      el.dataset.id = catName;
      el.dataset.railIndex = railIndex;
      el.innerHTML = `
        <span>${catName}</span>
        <span class="category-count">${count}</span>
      `;
      el.addEventListener('click', () => {
        this.selectCategory(catName);
        this.closeCategoryRail();
      });
      listEl.appendChild(el);
    });
  }

  selectCategory(catId) {
    this.activeCategory = catId;
    let label = 'כל הערוצים';

    if (catId === '__favs__') {
      label = '★ מועדפים';
      this.visibleChannels = this.allChannels.filter(c => this.favorites.has(c.id));
    } else if (catId === '__all__') {
      label = 'כל הערוצים';
      this.visibleChannels = this.allChannels;
    } else {
      label = catId;
      this.visibleChannels = this.categoryMap.get(catId) || [];
    }

    document.getElementById('active-category-title').textContent = label;
    document.getElementById('channel-count-badge').textContent = `${this.visibleChannels.length} ערוצים`;

    // Update active highlight in rail
    document.querySelectorAll('.category-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === catId);
    });

    this.renderChannelList();
    this.focusedChannelIndex = 0;
    if (this.visibleChannels.length > 0) {
      this.highlightChannel(this.visibleChannels[0]);
    }
  }

  renderChannelList() {
    const listEl = document.getElementById('channel-list');
    listEl.innerHTML = '';

    if (this.visibleChannels.length === 0) {
      listEl.innerHTML = `
        <div style="padding: 2rem; color: var(--text-dim); font-size: 1.25rem;">
          ${this.activeCategory === '__favs__' ? 'רשימת המועדפים ריקה. לחץ על הכפתור הצהוב כדי להוסיף ערוץ.' : 'אין ערוצים בקטגוריה זו.'}
        </div>
      `;
      return;
    }

    // Limit initial DOM nodes for performance on webOS 5 / 4.64
    const fragment = document.createDocumentFragment();
    this.visibleChannels.forEach((ch, idx) => {
      const item = document.createElement('div');
      item.className = 'channel-item focusable' + (this.selectedChannel?.id === ch.id ? ' active' : '');
      item.dataset.index = idx;
      item.dataset.channelId = ch.id;

      const isFav = this.favorites.has(ch.id);

      item.innerHTML = `
        <span class="channel-number">${ch.number}</span>
        <div class="channel-logo-thumb">
          ${ch.logo ? `<img src="${ch.logo}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">` : ''}
          <span class="channel-thumb-placeholder" style="${ch.logo ? 'display:none;' : ''}">TV</span>
        </div>
        <span class="channel-title">${ch.name}</span>
        ${isFav ? '<span class="channel-fav-star">★</span>' : ''}
      `;

      item.addEventListener('click', () => {
        this.focusedChannelIndex = idx;
        this.highlightChannel(ch);
        this.enterFullscreen();
      });

      fragment.appendChild(item);
    });

    listEl.appendChild(fragment);
    this.updateChannelFocusClass();
  }

  highlightChannel(channel) {
    if (!channel) return;
    this.selectedChannel = channel;
    localStorage.setItem(STORAGE_KEYS.LAST_CHANNEL, channel.id);

    // Update active class in list
    document.querySelectorAll('.channel-item').forEach(el => {
      el.classList.toggle('active', el.dataset.channelId === channel.id);
    });

    // Update Preview Panel Info
    document.getElementById('preview-channel-num').textContent = channel.number;
    document.getElementById('preview-channel-name').textContent = channel.name;
    document.getElementById('preview-channel-category').textContent = channel.group || 'כללי';

    const logoImg = document.getElementById('preview-channel-logo');
    const logoPlaceholder = document.getElementById('preview-channel-placeholder');
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

    // Update Favorite Button State
    this.updateFavoriteButtonUI();

    // Debounced video playback to prevent hammering TV decoder while scrolling
    clearTimeout(this.previewDebounceTimer);
    this.previewDebounceTimer = setTimeout(() => {
      this.player.play(channel);
    }, 450);

    // Update Fullscreen OSD info as well
    this.updateOSD(channel);
  }

  updateOSD(channel) {
    if (!channel) return;
    document.getElementById('osd-channel-number').textContent = channel.number;
    document.getElementById('osd-channel-name').textContent = channel.name;
    document.getElementById('osd-channel-category').textContent = channel.group || 'שידור חי';

    const osdLogo = document.getElementById('osd-channel-logo');
    const osdPlaceholder = document.getElementById('osd-logo-placeholder');
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

  showOSD() {
    const osd = document.getElementById('fullscreen-osd');
    osd.classList.remove('hidden');
    clearTimeout(this.osdTimer);
    this.osdTimer = setTimeout(() => {
      osd.classList.add('hidden');
    }, 4000);
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
      this.showToast(`הערוץ ${this.selectedChannel.name} הוסר מהמועדפים`);
    } else {
      this.favorites.add(id);
      this.showToast(`הערוץ ${this.selectedChannel.name} נוסף למועדפים! ★`);
    }

    this.saveFavorites();
    this.updateFavoriteButtonUI();
    this.renderCategoryRail();

    // If currently viewing favorites category, refresh the list
    if (this.activeCategory === '__favs__') {
      this.selectCategory('__favs__');
    } else {
      // Re-render current item's star
      const itemEl = document.querySelector(`.channel-item[data-channel-id="${id}"]`);
      if (itemEl) {
        let star = itemEl.querySelector('.channel-fav-star');
        if (this.favorites.has(id)) {
          if (!star) {
            star = document.createElement('span');
            star.className = 'channel-fav-star';
            star.textContent = '★';
            itemEl.appendChild(star);
          }
        } else if (star) {
          star.remove();
        }
      }
    }
  }

  updateFavoriteButtonUI() {
    if (!this.selectedChannel) return;
    const isFav = this.favorites.has(this.selectedChannel.id);
    const label = document.getElementById('fav-btn-label');
    const icon = document.getElementById('fav-icon');

    if (isFav) {
      label.textContent = 'במועדפים ★ (צהוב)';
      icon.setAttribute('fill', '#f59e0b');
      icon.setAttribute('stroke', '#f59e0b');
    } else {
      label.textContent = 'הוסף למועדפים (צהוב)';
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
    }
  }

  /* --------------------------------------------------------------------------
     Navigation & Focus Control
     -------------------------------------------------------------------------- */

  navigate(direction) {
    if (this.mode === 'FULLSCREEN') {
      if (direction === 'up') {
        this.changeChannelByOffset(-1);
      } else if (direction === 'down') {
        this.changeChannelByOffset(1);
      } else if (direction === 'left' || direction === 'right') {
        this.showOSD();
      }
      return;
    }

    if (this.mode === 'SETTINGS' || this.mode === 'SEARCH') {
      this.navigateModal(direction);
      return;
    }

    // BROWSE Mode Navigation
    if (this.focusArea === 'channels') {
      if (direction === 'up') {
        if (this.focusedChannelIndex > 0) {
          this.focusedChannelIndex--;
          this.updateChannelFocusClass();
          this.highlightChannel(this.visibleChannels[this.focusedChannelIndex]);
        }
      } else if (direction === 'down') {
        if (this.focusedChannelIndex < this.visibleChannels.length - 1) {
          this.focusedChannelIndex++;
          this.updateChannelFocusClass();
          this.highlightChannel(this.visibleChannels[this.focusedChannelIndex]);
        }
      } else if (direction === 'left') {
        // Move to Category Rail
        this.openCategoryRail();
      } else if (direction === 'right') {
        // Move to Preview actions
        this.focusArea = 'preview';
        this.clearAllFocusStyles();
        document.getElementById('btn-play-full').classList.add('focused');
      }
    } else if (this.focusArea === 'rail') {
      const railItems = document.querySelectorAll('.category-item');
      if (direction === 'up') {
        if (this.focusedRailIndex > 0) {
          this.focusedRailIndex--;
          this.updateRailFocusClass();
        }
      } else if (direction === 'down') {
        if (this.focusedRailIndex < railItems.length - 1) {
          this.focusedRailIndex++;
          this.updateRailFocusClass();
        }
      } else if (direction === 'right') {
        this.closeCategoryRail();
      }
    } else if (this.focusArea === 'preview') {
      if (direction === 'left') {
        this.focusArea = 'channels';
        this.clearAllFocusStyles();
        this.updateChannelFocusClass();
      } else if (direction === 'up' || direction === 'down') {
        // Toggle between preview frame, favorite button and fullscreen button
        const fullBtn = document.getElementById('btn-play-full');
        const favBtn = document.getElementById('btn-toggle-favorite');
        if (fullBtn.classList.contains('focused')) {
          fullBtn.classList.remove('focused');
          favBtn.classList.add('focused');
        } else {
          favBtn.classList.remove('focused');
          fullBtn.classList.add('focused');
        }
      }
    }
  }

  updateChannelFocusClass() {
    this.clearAllFocusStyles();
    const items = document.querySelectorAll('.channel-item');
    if (items[this.focusedChannelIndex]) {
      items[this.focusedChannelIndex].classList.add('focused');
      items[this.focusedChannelIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  updateRailFocusClass() {
    this.clearAllFocusStyles();
    const items = document.querySelectorAll('.category-item');
    if (items[this.focusedRailIndex]) {
      items[this.focusedRailIndex].classList.add('focused');
      items[this.focusedRailIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  clearAllFocusStyles() {
    document.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
  }

  openCategoryRail() {
    this.focusArea = 'rail';
    document.getElementById('category-rail').classList.remove('hidden');
    document.getElementById('category-rail-backdrop').classList.remove('hidden');

    // Find current active category index
    const railItems = document.querySelectorAll('.category-item');
    railItems.forEach((el, idx) => {
      if (el.dataset.id === this.activeCategory) {
        this.focusedRailIndex = idx;
      }
    });
    this.updateRailFocusClass();
  }

  closeCategoryRail() {
    this.focusArea = 'channels';
    document.getElementById('category-rail').classList.add('hidden');
    document.getElementById('category-rail-backdrop').classList.add('hidden');
    this.updateChannelFocusClass();
  }

  selectCurrent() {
    if (this.mode === 'FULLSCREEN') {
      this.showOSD();
      return;
    }

    if (this.focusArea === 'channels') {
      // Enter Fullscreen directly on OK
      this.enterFullscreen();
    } else if (this.focusArea === 'rail') {
      const items = document.querySelectorAll('.category-item');
      if (items[this.focusedRailIndex]) {
        const catId = items[this.focusedRailIndex].dataset.id;
        this.selectCategory(catId);
        this.closeCategoryRail();
      }
    } else if (this.focusArea === 'preview') {
      const favBtn = document.getElementById('btn-toggle-favorite');
      if (favBtn.classList.contains('focused')) {
        this.toggleFavorite();
      } else {
        this.enterFullscreen();
      }
    } else if (this.mode === 'SETTINGS' || this.mode === 'SEARCH') {
      const focusedBtn = document.querySelector('.modal-backdrop:not(.hidden) .focusable.focused');
      if (focusedBtn) {
        focusedBtn.click();
      }
    }
  }

  handleBack() {
    if (this.isModalOpen()) {
      this.closeModals();
      return;
    }

    if (this.mode === 'FULLSCREEN') {
      this.exitFullscreen();
      return;
    }

    if (this.focusArea === 'preview') {
      this.focusArea = 'channels';
      this.clearAllFocusStyles();
      this.updateChannelFocusClass();
      return;
    }

    if (this.focusArea === 'channels') {
      this.openCategoryRail();
      return;
    }

    if (this.focusArea === 'rail') {
      // Exit app prompt or minimize on webOS
      if (window.webOS && window.webOS.platformBack) {
        window.webOS.platformBack();
      } else {
        this.showToast('לחץ שוב ליציאה');
      }
    }
  }

  /* --------------------------------------------------------------------------
     Fullscreen Mode Control
     -------------------------------------------------------------------------- */

  enterFullscreen() {
    if (!this.selectedChannel) return;
    this.mode = 'FULLSCREEN';
    this.updateVideoSurfacePosition();
    this.showOSD();
  }

  exitFullscreen() {
    this.mode = 'BROWSE';
    this.focusArea = 'channels';
    document.getElementById('fullscreen-osd').classList.add('hidden');
    this.updateVideoSurfacePosition();
    this.updateChannelFocusClass();
  }

  changeChannelByOffset(offset) {
    if (this.visibleChannels.length === 0) return;
    let newIdx = this.focusedChannelIndex + offset;

    if (newIdx < 0) newIdx = this.visibleChannels.length - 1;
    if (newIdx >= this.visibleChannels.length) newIdx = 0;

    this.focusedChannelIndex = newIdx;
    const targetChannel = this.visibleChannels[newIdx];
    this.highlightChannel(targetChannel);

    if (this.mode === 'FULLSCREEN') {
      this.showOSD();
    } else {
      this.updateChannelFocusClass();
    }
  }

  jumpToChannelNumber(num) {
    const ch = this.allChannels.find(c => c.number === num);
    if (ch) {
      this.highlightChannel(ch);
      if (this.mode === 'FULLSCREEN') {
        this.showOSD();
      } else {
        // If in another category, switch to All Channels
        if (!this.visibleChannels.some(c => c.id === ch.id)) {
          this.selectCategory('__all__');
        }
        const idx = this.visibleChannels.findIndex(c => c.id === ch.id);
        if (idx !== -1) {
          this.focusedChannelIndex = idx;
          this.updateChannelFocusClass();
        }
      }
    } else {
      this.showToast(`ערוץ מספר ${num} לא נמצא`);
    }
  }

  showNumberInputOverlay(digits) {
    const overlay = document.getElementById('channel-number-jump');
    const textEl = document.getElementById('jump-number-digits');
    textEl.textContent = digits;
    overlay.classList.remove('hidden');

    clearTimeout(this.jumpTimer);
    this.jumpTimer = setTimeout(() => {
      overlay.classList.add('hidden');
    }, 1500);
  }

  /* --------------------------------------------------------------------------
     Remote Color Buttons Handlers
     -------------------------------------------------------------------------- */

  onRedButton() {
    this.openSettingsModal();
  }

  onGreenButton() {
    this.openSearchModal();
  }

  onYellowButton() {
    this.toggleFavorite();
  }

  onBlueButton() {
    if (this.mode === 'FULLSCREEN') {
      this.exitFullscreen();
    } else {
      this.enterFullscreen();
    }
  }

  togglePlayPause() {
    if (this.player) {
      this.player.togglePlayPause();
    }
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
    document.getElementById('settings-modal').classList.remove('hidden');
    this.setupModalFocus('#settings-modal');
  }

  openSearchModal() {
    this.mode = 'SEARCH';
    document.getElementById('search-modal').classList.remove('hidden');
    this.renderSearchKeyboard();
    this.setupModalFocus('#search-modal');
  }

  closeModals() {
    document.querySelectorAll('.modal-backdrop').forEach(el => el.classList.add('hidden'));
    this.mode = 'BROWSE';
    this.focusArea = 'channels';
    this.updateChannelFocusClass();
  }

  setupModalFocus(modalSelector) {
    this.clearAllFocusStyles();
    const focusableElements = document.querySelectorAll(`${modalSelector} .focusable`);
    if (focusableElements.length > 0) {
      this.focusedModalIndex = 0;
      focusableElements[0].classList.add('focused');
    }
  }

  navigateModal(direction) {
    const activeModal = document.querySelector('.modal-backdrop:not(.hidden)');
    if (!activeModal) return;

    const focusables = Array.from(activeModal.querySelectorAll('.focusable'));
    if (focusables.length === 0) return;

    let current = this.focusedModalIndex;
    if (direction === 'down' || direction === 'right') {
      current = (current + 1) % focusables.length;
    } else if (direction === 'up' || direction === 'left') {
      current = (current - 1 + focusables.length) % focusables.length;
    }

    this.focusedModalIndex = current;
    this.clearAllFocusStyles();
    focusables[current].classList.add('focused');
    focusables[current].scrollIntoView({ block: 'nearest' });
  }

  renderSearchKeyboard() {
    const kbContainer = document.getElementById('search-keyboard');
    if (kbContainer.children.length > 0) return; // already rendered

    const rows = [
      ['1','2','3','4','5','6','7','8','9','0'],
      ['q','w','e','r','t','y','u','i','o','p'],
      ['a','s','d','f','g','h','j','k','l'],
      ['z','x','c','v','b','n','m','-','_']
    ];

    rows.forEach(row => {
      const rowEl = document.createElement('div');
      rowEl.className = 'kb-row';
      row.forEach(char => {
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
    actionRow.innerHTML = `
      <button class="kb-key kb-key-wide focusable" data-kb="backspace">מחק ⌫</button>
      <button class="kb-key kb-key-space focusable" data-kb="space">רווח (Space)</button>
      <button class="kb-key kb-key-wide focusable" data-kb="clear">נקה הכל</button>
    `;

    actionRow.querySelector('[data-kb="backspace"]').addEventListener('click', () => this.handleSearchKey('backspace'));
    actionRow.querySelector('[data-kb="space"]').addEventListener('click', () => this.handleSearchKey(' '));
    actionRow.querySelector('[data-kb="clear"]').addEventListener('click', () => this.handleSearchKey('clear'));

    kbContainer.appendChild(actionRow);
  }

  handleSearchKey(char) {
    const input = document.getElementById('search-query-input');
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
    listEl.innerHTML = '';

    const q = query.trim().toLowerCase();
    if (!q) {
      countEl.textContent = '0';
      return;
    }

    const matches = this.allChannels.filter(c => 
      c.name.toLowerCase().includes(q) || (c.group && c.group.toLowerCase().includes(q))
    ).slice(0, 30);

    countEl.textContent = matches.length.toString();

    matches.forEach(ch => {
      const row = document.createElement('div');
      row.className = 'channel-item focusable';
      row.innerHTML = `
        <span class="channel-number">${ch.number}</span>
        <span class="channel-title">${ch.name}</span>
        <span class="category-count">${ch.group}</span>
      `;
      row.addEventListener('click', () => {
        this.closeModals();
        this.highlightChannel(ch);
        this.enterFullscreen();
      });
      listEl.appendChild(row);
    });
  }

  /* --------------------------------------------------------------------------
     DOM Event Bindings
     -------------------------------------------------------------------------- */

  bindDOMEvents() {
    // Collapsed rail click
    document.getElementById('collapsed-rail').addEventListener('click', () => {
      this.openCategoryRail();
    });

    document.getElementById('category-rail-backdrop').addEventListener('click', () => {
      this.closeCategoryRail();
    });

    // Preview frame click
    document.getElementById('preview-frame').addEventListener('click', () => {
      this.enterFullscreen();
    });

    // Favorite button click
    document.getElementById('btn-toggle-favorite').addEventListener('click', () => {
      this.toggleFavorite();
    });

    // Fullscreen button click
    document.getElementById('btn-play-full').addEventListener('click', () => {
      this.enterFullscreen();
    });

    // Search trigger
    document.getElementById('btn-search-trigger').addEventListener('click', () => {
      this.openSearchModal();
    });

    // Bottom Color hints
    document.getElementById('hint-red').addEventListener('click', () => this.onRedButton());
    document.getElementById('hint-green').addEventListener('click', () => this.onGreenButton());
    document.getElementById('hint-yellow').addEventListener('click', () => this.onYellowButton());
    document.getElementById('hint-blue').addEventListener('click', () => this.onBlueButton());

    // Settings actions
    document.getElementById('btn-load-sample').addEventListener('click', () => {
      document.getElementById('m3u-url-input').value = SAMPLE_M3U_URL;
      this.loadPlaylist(SAMPLE_M3U_URL);
    });

    document.getElementById('btn-save-playlist').addEventListener('click', () => {
      const url = document.getElementById('m3u-url-input').value.trim();
      const remoteUrl = document.getElementById('remote-url-input').value.trim();

      if (remoteUrl) {
        localStorage.setItem(STORAGE_KEYS.REMOTE_URL, remoteUrl);
      } else {
        localStorage.removeItem(STORAGE_KEYS.REMOTE_URL);
      }

      if (url) {
        this.loadPlaylist(url);
      } else {
        this.showToast('נא להזין כתובת M3U תקינה');
      }
    });

    // Modal close buttons
    document.querySelectorAll('[data-action="close-modal"]').forEach(btn => {
      btn.addEventListener('click', () => this.closeModals());
    });

    // Settings Virtual Keyboard click handlers
    document.querySelectorAll('#tv-virtual-keyboard .kb-key').forEach(key => {
      key.addEventListener('click', (e) => {
        const char = key.dataset.char;
        const action = key.dataset.kb;
        const input = document.getElementById('m3u-url-input');

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
    });
  }

  showToast(message) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    msgEl.textContent = message;
    toast.classList.remove('hidden');

    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
    }, 3200);
  }
}

// Launch application on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  window.app = new IPTVApp();
});
