/**
 * Multi-M3U Lineup Store, Custom Channel Numbering & Instant-Boot Cache Engine
 * Optimized for LG webOS 4.64 & 5.0+
 * - O(1) channelById, channelByNumber, and favoritesMap lookup indices
 * - Debounced/coalesced localStorage persistence scheduler with flushPendingSaves()
 * - Compact cache serialization stripping empty/transient fields
 * - Non-destructive appendDefaultSource() preserving all existing user sources
 */
const LINEUP_KEYS = {
  SOURCES: 'zenplay_iptv_sources_v2',
  OVERRIDES: 'zenplay_iptv_channel_overrides_v2',
  CACHED_LINEUP: 'zenplay_iptv_cached_lineup_v2',
  PC_SYNC_HOST: 'zenplay_iptv_pc_sync_host',
  LEGACY_M3U: 'zenplay_iptv_m3u_url',
  FAVORITES: 'zenplay_iptv_favorites',
  LAST_CHANNEL: 'zenplay_iptv_last_channel',
  RECENT_CHANNELS: 'zenplay_iptv_recent_channels_v1'
};

const DEFAULT_SAMPLE_M3U = 'https://iptv-org.github.io/iptv/countries/il.m3u';

class LineupStore {
  constructor(parser) {
    this.parser = parser || new M3UParser();
    this.sources = [];
    this.overrides = {}; // { [channelUid]: { enabled: true/false, customNumber: 12, customName: '' } }
    this.rawChannels = []; // All parsed channels from all enabled sources
    this.compiledChannels = []; // Filtered (enabled) & sorted by customNumber
    this.discoveredEpgUrls = [];
    this.channelById = Object.create(null);
    this.channelByNumber = Object.create(null);
    this.favoritesMap = Object.create(null);
    this.recentChannelIds = [];
    this._pendingSaves = Object.create(null);
    this._saveTimer = null;
    this._saveDebounceMs = 350;
    this._lifecycleFlushBound = false;
    this._heCollator = (typeof Intl !== 'undefined' && typeof Intl.Collator === 'function')
      ? new Intl.Collator('he')
      : null;

    this._bindLifecycleFlush();
    this.loadConfig();
  }

  _ensureStoreState() {
    if (!Array.isArray(this.sources)) this.sources = [];
    if (!this.overrides || typeof this.overrides !== 'object') this.overrides = {};
    if (!Array.isArray(this.rawChannels)) this.rawChannels = [];
    if (!Array.isArray(this.compiledChannels)) this.compiledChannels = [];
    if (!Array.isArray(this.discoveredEpgUrls)) this.discoveredEpgUrls = [];
    if (!this.channelById || typeof this.channelById !== 'object') this.channelById = Object.create(null);
    if (!this.channelByNumber || typeof this.channelByNumber !== 'object') this.channelByNumber = Object.create(null);
    if (!this.favoritesMap || typeof this.favoritesMap !== 'object') this.favoritesMap = Object.create(null);
    if (!Array.isArray(this.recentChannelIds)) this.recentChannelIds = [];
    if (!this._pendingSaves || typeof this._pendingSaves !== 'object') this._pendingSaves = Object.create(null);
    if (typeof this._saveDebounceMs !== 'number') this._saveDebounceMs = 350;
  }

  _bindLifecycleFlush() {
    if (this._lifecycleFlushBound || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return;
    }
    this._lifecycleFlushBound = true;
    const flushFn = () => this.flushPendingSaves();
    try {
      window.addEventListener('pagehide', flushFn);
      window.addEventListener('beforeunload', flushFn);
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') {
            this.flushPendingSaves();
          }
        });
      }
    } catch (e) {}
  }

  /**
   * Queues a coalesced localStorage write to minimize synchronous JSON/storage stalls during rapid zapping.
   */
  schedulePendingSave(storageKey, valueOrGetter, delayMs) {
    this._ensureStoreState();
    if (!storageKey) return;
    this._pendingSaves[storageKey] = valueOrGetter;
    if (!this._saveTimer) {
      const wait = typeof delayMs === 'number' && delayMs >= 0 ? delayMs : this._saveDebounceMs;
      this._saveTimer = setTimeout(() => {
        this.flushPendingSaves();
      }, wait);
    }
  }

  /**
   * Synchronously flushes all queued localStorage writes (for immediate sync, exit, or test assertions).
   */
  flushPendingSaves() {
    this._ensureStoreState();
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    const keys = Object.keys(this._pendingSaves);
    if (keys.length === 0) return 0;

    let flushed = 0;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const entry = this._pendingSaves[key];
      delete this._pendingSaves[key];
      try {
        const val = typeof entry === 'function' ? entry() : entry;
        if (val === undefined) continue;
        const serialized = typeof val === 'string' ? val : JSON.stringify(val);
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(key, serialized);
          flushed++;
        }
      } catch (e) {}
    }
    return flushed;
  }

  /**
   * Rebuilds O(1) channelById and channelByNumber lookup indices from compiledChannels.
   */
  rebuildChannelIndices() {
    this._ensureStoreState();
    const byId = Object.create(null);
    const byNum = Object.create(null);
    const list = this.compiledChannels;
    for (let i = 0; i < list.length; i++) {
      const ch = list[i];
      if (!ch) continue;
      if (ch.id !== undefined && ch.id !== null && ch.id !== '') {
        byId[String(ch.id)] = ch;
      }
      if (ch.uid !== undefined && ch.uid !== null && ch.uid !== '') {
        byId[String(ch.uid)] = ch;
      }
      if (typeof ch.number === 'number' && ch.number > 0) {
        const numKey = String(ch.number);
        if (!byNum[numKey]) {
          byNum[numKey] = ch;
        }
      }
    }
    this.channelById = byId;
    this.channelByNumber = byNum;
  }

  getChannelById(id) {
    if (id === undefined || id === null || id === '') return null;
    this._ensureStoreState();
    return this.channelById[String(id)] || null;
  }

  getChannelByNumber(num) {
    if (num === undefined || num === null || num === '') return null;
    this._ensureStoreState();
    return this.channelByNumber[String(num)] || null;
  }

  setChannels(channels, skipCacheSave) {
    this._ensureStoreState();
    this.rawChannels = Array.isArray(channels) ? channels : [];
    return this.recompileLineup(Boolean(skipCacheSave));
  }

  loadFavorites() {
    this._ensureStoreState();
    const map = Object.create(null);
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(LINEUP_KEYS.FAVORITES);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            for (let i = 0; i < arr.length; i++) {
              if (arr[i] !== undefined && arr[i] !== null && arr[i] !== '') {
                map[String(arr[i])] = true;
              }
            }
          }
        }
      }
    } catch (e) {}
    this.favoritesMap = map;
    return map;
  }

  syncFavorites(favIdsOrSet, immediate) {
    this._ensureStoreState();
    const map = Object.create(null);
    if (favIdsOrSet && typeof favIdsOrSet.forEach === 'function') {
      favIdsOrSet.forEach((id) => {
        if (id !== undefined && id !== null && id !== '') {
          map[String(id)] = true;
        }
      });
    } else if (Array.isArray(favIdsOrSet)) {
      for (let i = 0; i < favIdsOrSet.length; i++) {
        const id = favIdsOrSet[i];
        if (id !== undefined && id !== null && id !== '') {
          map[String(id)] = true;
        }
      }
    }
    this.favoritesMap = map;
    this._persistFavorites(Boolean(immediate));
    return map;
  }

  _persistFavorites(immediate) {
    const buildFavJson = () => JSON.stringify(Object.keys(this.favoritesMap));
    if (immediate) {
      if (this._pendingSaves) delete this._pendingSaves[LINEUP_KEYS.FAVORITES];
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(LINEUP_KEYS.FAVORITES, buildFavJson());
        }
      } catch (e) {}
    } else {
      this.schedulePendingSave(LINEUP_KEYS.FAVORITES, buildFavJson, this._saveDebounceMs);
    }
  }

  isFavorite(channelId) {
    if (channelId === undefined || channelId === null || channelId === '') return false;
    this._ensureStoreState();
    return this.favoritesMap[String(channelId)] === true;
  }

  setFavorite(channelId, enabled, immediate) {
    if (channelId === undefined || channelId === null || channelId === '') return false;
    this._ensureStoreState();
    const key = String(channelId);
    if (enabled) {
      this.favoritesMap[key] = true;
    } else {
      delete this.favoritesMap[key];
    }
    this._persistFavorites(Boolean(immediate));
    return Boolean(enabled);
  }

  toggleFavorite(channelId, immediate) {
    const next = !this.isFavorite(channelId);
    return this.setFavorite(channelId, next, immediate);
  }

  getFavoriteIds() {
    this._ensureStoreState();
    return Object.keys(this.favoritesMap);
  }

  recordRecentChannel(channelOrId) {
    this._ensureStoreState();
    const chId = typeof channelOrId === 'string'
      ? channelOrId
      : (channelOrId && (channelOrId.id || channelOrId.uid) ? String(channelOrId.id || channelOrId.uid) : '');
    if (!chId) return;

    const nextRecent = [chId];
    for (let i = 0; i < this.recentChannelIds.length && nextRecent.length < 25; i++) {
      if (this.recentChannelIds[i] !== chId) {
        nextRecent.push(this.recentChannelIds[i]);
      }
    }
    this.recentChannelIds = nextRecent;
    this.schedulePendingSave(LINEUP_KEYS.LAST_CHANNEL, chId, this._saveDebounceMs);
    this.schedulePendingSave(LINEUP_KEYS.RECENT_CHANNELS, () => JSON.stringify(this.recentChannelIds), this._saveDebounceMs);
  }

  loadConfig() {
    this._ensureStoreState();
    try {
      const savedSources = localStorage.getItem(LINEUP_KEYS.SOURCES);
      if (savedSources) {
        const parsed = JSON.parse(savedSources);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.sources = parsed;
        }
      }

      if (this.sources.length === 0) {
        const legacyUrl = localStorage.getItem(LINEUP_KEYS.LEGACY_M3U) || DEFAULT_SAMPLE_M3U;
        this.sources = [
          {
            id: 'src_1',
            name: 'פלייליסט ראשי (M3U #1)',
            url: legacyUrl,
            enabled: true
          }
        ];
        this.saveSources();
      }

      const savedOverrides = localStorage.getItem(LINEUP_KEYS.OVERRIDES);
      if (savedOverrides) {
        this.overrides = JSON.parse(savedOverrides) || {};
      }

      const savedRecent = localStorage.getItem(LINEUP_KEYS.RECENT_CHANNELS);
      if (savedRecent) {
        const recentArr = JSON.parse(savedRecent);
        if (Array.isArray(recentArr)) {
          this.recentChannelIds = recentArr;
        }
      }
    } catch (e) {
      console.warn('LineupStore loadConfig warning:', e);
      this.sources = [
        { id: 'src_1', name: 'פלייליסט ראשי', url: DEFAULT_SAMPLE_M3U, enabled: true }
      ];
      this.overrides = {};
    }
    this.loadFavorites();
  }

  saveSources(defer) {
    this._ensureStoreState();
    if (defer === true) {
      this.schedulePendingSave(LINEUP_KEYS.SOURCES, () => JSON.stringify(this.sources), this._saveDebounceMs);
      if (this.sources.length > 0 && this.sources[0].url) {
        this.schedulePendingSave(LINEUP_KEYS.LEGACY_M3U, this.sources[0].url, this._saveDebounceMs);
      }
      return;
    }
    delete this._pendingSaves[LINEUP_KEYS.SOURCES];
    delete this._pendingSaves[LINEUP_KEYS.LEGACY_M3U];
    try {
      localStorage.setItem(LINEUP_KEYS.SOURCES, JSON.stringify(this.sources));
      if (this.sources.length > 0 && this.sources[0].url) {
        localStorage.setItem(LINEUP_KEYS.LEGACY_M3U, this.sources[0].url);
      }
    } catch (e) {}
  }

  saveOverrides(defer) {
    this._ensureStoreState();
    if (defer === true) {
      this.schedulePendingSave(LINEUP_KEYS.OVERRIDES, () => JSON.stringify(this.overrides), this._saveDebounceMs);
      return;
    }
    delete this._pendingSaves[LINEUP_KEYS.OVERRIDES];
    try {
      localStorage.setItem(LINEUP_KEYS.OVERRIDES, JSON.stringify(this.overrides));
    } catch (e) {}
  }

  /**
   * Non-destructive addition of the built-in Israeli default playlist source.
   * Preserves all existing user sources and overrides.
   */
  appendDefaultSource() {
    this._ensureStoreState();
    const defaultUrl = DEFAULT_SAMPLE_M3U;

    for (let i = 0; i < this.sources.length; i++) {
      const existing = this.sources[i];
      if (!existing) continue;
      if (existing.url === defaultUrl || this.normalizeM3uInput(existing.url) === defaultUrl) {
        existing.enabled = true;
        this.saveSources();
        return { added: false, reenabled: true, source: existing };
      }
    }

    const usedIds = Object.create(null);
    for (let i = 0; i < this.sources.length; i++) {
      if (this.sources[i] && this.sources[i].id) {
        usedIds[String(this.sources[i].id)] = true;
      }
    }
    let uniqueId = 'default-il';
    let suffix = 2;
    while (usedIds[uniqueId]) {
      uniqueId = 'default-il-' + suffix++;
    }

    const newSource = {
      id: uniqueId,
      name: 'ברירת מחדל — ערוצי ישראל',
      url: defaultUrl,
      enabled: true
    };
    this.sources.push(newSource);
    this.saveSources();
    return { added: true, reenabled: false, source: newSource };
  }

  /**
   * Instant-Boot Cache: Returns cached compiled lineup in < 5ms so UI renders before network finishes!
   */
  loadCachedLineup() {
    this._ensureStoreState();
    try {
      const raw = localStorage.getItem(LINEUP_KEYS.CACHED_LINEUP);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data) return null;

      this.discoveredEpgUrls = Array.isArray(data.discoveredEpgUrls) ? data.discoveredEpgUrls : [];
      this.lastCacheTimestamp = data.updatedAt || 0;

      // Compact v2 format: stores only rawChannels (omitting empty/transient fields) and compiles in-memory
      if (Array.isArray(data.rawChannels) && data.rawChannels.length > 0 && !Array.isArray(data.compiledChannels)) {
        this.rawChannels = data.rawChannels.map((c, idx) => {
          const seqFallback = idx + 1;
          const num = (typeof c.number === 'number' && c.number > 0) ? c.number : seqFallback;
          const defSeq = (typeof c.defaultSeqNumber === 'number' && c.defaultSeqNumber > 0) ? c.defaultSeqNumber : num;
          const origNum = (typeof c.originalNumber === 'number' && c.originalNumber > 0) ? c.originalNumber : defSeq;
          return {
            id: c.id || c.uid,
            uid: c.uid || c.id,
            sourceId: c.sourceId || 'src_default',
            sourceName: c.sourceName || '',
            originalNumber: origNum,
            defaultSeqNumber: defSeq,
            number: num,
            name: c.name || '',
            tvgName: c.tvgName || c.name || '',
            logo: c.logo || '',
            group: c.group || 'טלוויזיה חיה',
            epgId: c.epgId || '',
            url: c.url || '',
            catchupType: c.catchupType || '',
            catchupSource: c.catchupSource || '',
            catchupDays: typeof c.catchupDays === 'number' ? c.catchupDays : 7
          };
        });
        // Auto-heal if a previous cache write collapsed all channels to #1
        if (this.rawChannels.length > 2 && this.rawChannels.every((ch) => ch.number === 1)) {
          for (let i = 0; i < this.rawChannels.length; i++) {
            this.rawChannels[i].number = i + 1;
            this.rawChannels[i].defaultSeqNumber = i + 1;
            this.rawChannels[i].originalNumber = i + 1;
          }
        }
        return this.recompileLineup(true);
      }

      // Legacy format compatibility
      if (Array.isArray(data.compiledChannels) && data.compiledChannels.length > 0) {
        this.rawChannels = data.rawChannels || data.compiledChannels;
        this.compiledChannels = data.compiledChannels;
        if (this.compiledChannels.length > 2 && this.compiledChannels.every((ch) => ch.number === 1)) {
          for (let i = 0; i < this.compiledChannels.length; i++) {
            this.compiledChannels[i].number = i + 1;
          }
        }
        this.rebuildChannelIndices();
        return this.compiledChannels;
      }
    } catch (e) {}
    return null;
  }

  isLineupCacheFresh(ttlHours) {
    if (!this.lastCacheTimestamp) return false;
    // ttlHours === 0 means manual refresh only (never auto-fetch in background)
    if (ttlHours === 0) return true;
    const ageMs = Date.now() - this.lastCacheTimestamp;
    return ageMs < ttlHours * 3600000;
  }

  clearLineupCache() {
    this._ensureStoreState();
    delete this._pendingSaves[LINEUP_KEYS.CACHED_LINEUP];
    try {
      localStorage.removeItem(LINEUP_KEYS.CACHED_LINEUP);
      this.lastCacheTimestamp = 0;
    } catch (e) {}
  }

  /**
   * Strips empty, default, duplicate, and transient runtime fields before JSON.stringify
   * to minimize localStorage footprint and serialization time.
   */
  compactChannelForCache(ch) {
    const out = {
      uid: ch.uid || ch.id,
      number: ch.number,
      name: ch.name,
      url: ch.url
    };
    const srcId = typeof ch.sourceId === 'string' ? ch.sourceId.trim() : '';
    if (srcId && srcId !== 'src_default') out.sourceId = srcId;
    const srcName = typeof ch.sourceName === 'string' ? ch.sourceName.trim() : '';
    if (srcName) out.sourceName = srcName;
    if (ch.originalNumber && ch.originalNumber !== ch.number) out.originalNumber = ch.originalNumber;
    if (ch.defaultSeqNumber && ch.defaultSeqNumber !== ch.number) out.defaultSeqNumber = ch.defaultSeqNumber;
    const tvgName = typeof ch.tvgName === 'string' ? ch.tvgName.trim() : '';
    if (tvgName && tvgName !== ch.name) out.tvgName = tvgName;
    const logo = typeof ch.logo === 'string' ? ch.logo.trim() : '';
    if (logo) out.logo = logo;
    const group = typeof ch.group === 'string' ? ch.group.trim() : '';
    if (group && group !== 'טלוויזיה חיה') out.group = group;
    const epgId = typeof ch.epgId === 'string' ? ch.epgId.trim() : '';
    if (epgId) out.epgId = epgId;
    const catchupType = typeof ch.catchupType === 'string' ? ch.catchupType.trim() : '';
    if (catchupType) out.catchupType = catchupType;
    const catchupSource = typeof ch.catchupSource === 'string' ? ch.catchupSource.trim() : '';
    if (catchupSource) out.catchupSource = catchupSource;
    if (typeof ch.catchupDays === 'number' && ch.catchupDays !== 7 && ch.catchupDays > 0) {
      out.catchupDays = ch.catchupDays;
    }
    return out;
  }

  _buildCompactCachePayloadJson(cap) {
    const sliceLen = Math.min(this.rawChannels.length, cap);
    const compactRaw = [];
    for (let i = 0; i < sliceLen; i++) {
      const rawCh = this.rawChannels[i];
      if (!rawCh || !rawCh.url) continue;
      compactRaw.push(this.compactChannelForCache(rawCh));
    }
    const payload = {
      v: 2,
      updatedAt: this.lastCacheTimestamp,
      rawChannels: compactRaw
    };
    if (this.discoveredEpgUrls && this.discoveredEpgUrls.length > 0) {
      payload.discoveredEpgUrls = this.discoveredEpgUrls;
    }
    return JSON.stringify(payload);
  }

  saveCachedLineup(defer) {
    this._ensureStoreState();
    this.rebuildChannelIndices();
    this.lastCacheTimestamp = Date.now();

    if (defer === true) {
      this.schedulePendingSave(LINEUP_KEYS.CACHED_LINEUP, () => {
        const caps = [1500, 800, 400];
        for (let c = 0; c < caps.length; c++) {
          try {
            return this._buildCompactCachePayloadJson(caps[c]);
          } catch (e) {}
        }
        return undefined;
      }, this._saveDebounceMs);
      return;
    }

    delete this._pendingSaves[LINEUP_KEYS.CACHED_LINEUP];
    // Store single compacted rawChannels copy (avoids 2x duplication) with graceful quota fallback
    const caps = [1500, 800, 400];
    for (let c = 0; c < caps.length; c++) {
      const cap = caps[c];
      try {
        localStorage.setItem(LINEUP_KEYS.CACHED_LINEUP, this._buildCompactCachePayloadJson(cap));
        return;
      } catch (e) {
        if (c === caps.length - 1) {
          console.warn('Could not cache lineup in localStorage:', e);
        }
      }
    }
  }

  /**
   * Smart URL & Short-Code Normalizer:
   * - Expands 8-char Pastebin codes (e.g. "xYz123Ab" -> "https://pastebin.com/raw/xYz123Ab")
   * - Converts "pastebin.com/xYz123Ab" -> "https://pastebin.com/raw/xYz123Ab"
   * - Prepends "https://" to short links (bit.ly/..., is.gd/..., etc.)
   * - Preserves data: URLs from direct .m3u file uploads
   */
  normalizeM3uInput(rawInput) {
    const val = (rawInput || '').trim();
    if (!val) return '';
    if (val.indexOf('data:') === 0) return val;
    if (/^[a-zA-Z0-9]{8}$/.test(val)) {
      return 'https://pastebin.com/raw/' + val;
    }
    const pbMatch = val.match(/^(?:https?:\/\/)?pastebin\.com\/(?:raw\/)?([a-zA-Z0-9]+)$/i);
    if (pbMatch && pbMatch[1]) {
      return 'https://pastebin.com/raw/' + pbMatch[1];
    }
    if (val.indexOf('http://') !== 0 && val.indexOf('https://') !== 0) {
      return 'https://' + val;
    }
    return val;
  }

  /**
   * Add or update an M3U source
   */
  addSource(name, url) {
    const cleanUrl = this.normalizeM3uInput(url);
    if (!cleanUrl) return null;
    const id = 'src_' + Date.now().toString(36) + '_' + (this.sources.length + 1);
    const src = {
      id: id,
      name: (name && name.trim()) ? name.trim() : ('פלייליסט M3U #' + (this.sources.length + 1)),
      url: cleanUrl,
      enabled: true
    };
    this.sources.push(src);
    this.saveSources();
    return src;
  }

  updateSource(id, updates) {
    for (let i = 0; i < this.sources.length; i++) {
      if (this.sources[i].id === id) {
        if (typeof updates.name === 'string') this.sources[i].name = updates.name;
        if (typeof updates.url === 'string') this.sources[i].url = this.normalizeM3uInput(updates.url);
        if (typeof updates.enabled === 'boolean') this.sources[i].enabled = updates.enabled;
        this.saveSources();
        return this.sources[i];
      }
    }
    return null;
  }

  removeSource(id) {
    if (this.sources.length <= 1) {
      // If only 1 source left, clear or reset instead of leaving empty array
      return false;
    }
    this.sources = this.sources.filter((s) => s.id !== id);
    this.saveSources();

    // Clean up stale overrides belonging to the removed source
    const prefix = id + '::';
    let removedAny = false;
    const keys = Object.keys(this.overrides);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].indexOf(prefix) === 0) {
        delete this.overrides[keys[i]];
        removedAny = true;
      }
    }
    if (removedAny) {
      this.saveOverrides();
    }
    return true;
  }

  /**
   * Removes no-op overrides and (when full lineup is loaded) overrides for channels no longer present.
   */
  pruneStaleOverrides(pruneMissingUids) {
    let activeUids = null;
    if (pruneMissingUids && this.rawChannels.length > 0) {
      activeUids = new Set();
      for (let i = 0; i < this.rawChannels.length; i++) {
        if (this.rawChannels[i] && this.rawChannels[i].uid) {
          activeUids.add(this.rawChannels[i].uid);
        }
      }
    }

    let changed = false;
    const keys = Object.keys(this.overrides);
    for (let i = 0; i < keys.length; i++) {
      const uid = keys[i];
      const ov = this.overrides[uid];
      if (!ov || typeof ov !== 'object') {
        delete this.overrides[uid];
        changed = true;
        continue;
      }
      if (activeUids && !activeUids.has(uid)) {
        delete this.overrides[uid];
        changed = true;
        continue;
      }
      const isDefaultEnabled = ov.enabled !== false;
      const hasCustomNum = typeof ov.customNumber === 'number' && !isNaN(ov.customNumber) && ov.customNumber > 0;
      const hasCustomName = typeof ov.customName === 'string' && ov.customName.trim().length > 0;
      if (isDefaultEnabled && !hasCustomNum && !hasCustomName) {
        delete this.overrides[uid];
        changed = true;
      }
    }

    if (changed) {
      this.saveOverrides();
    }
  }

  /**
   * Set per-channel override (visibility or custom channel number)
   */
  setChannelOverride(uid, changes) {
    if (!uid) return;
    const existing = this.overrides[uid] || {};
    const nextEnabled = typeof changes.enabled === 'boolean' ? changes.enabled : (typeof existing.enabled === 'boolean' ? existing.enabled : true);
    const nextNumber = typeof changes.customNumber === 'number' && !isNaN(changes.customNumber) ? changes.customNumber : existing.customNumber;
    const nextName = typeof changes.customName === 'string' ? changes.customName : existing.customName;

    const hasCustomNum = typeof nextNumber === 'number' && !isNaN(nextNumber) && nextNumber > 0;
    const hasCustomName = typeof nextName === 'string' && nextName.trim().length > 0;
    if (nextEnabled !== false && !hasCustomNum && !hasCustomName) {
      delete this.overrides[uid];
    } else {
      const entry = { enabled: nextEnabled };
      if (hasCustomNum) entry.customNumber = nextNumber;
      if (hasCustomName) entry.customName = nextName;
      this.overrides[uid] = entry;
    }

    this.saveOverrides(true);
    this.recompileLineup(false, true);
  }

  /**
   * Enable or disable all channels belonging to a specific M3U source
   */
  setAllSourceChannelsEnabled(sourceId, enabled) {
    for (let i = 0; i < this.rawChannels.length; i++) {
      const ch = this.rawChannels[i];
      if (ch.sourceId === sourceId) {
        const existing = this.overrides[ch.uid] || {};
        const hasCustomNum = typeof existing.customNumber === 'number' && !isNaN(existing.customNumber) && existing.customNumber > 0;
        const hasCustomName = typeof existing.customName === 'string' && existing.customName.trim().length > 0;
        if (enabled !== false && !hasCustomNum && !hasCustomName) {
          delete this.overrides[ch.uid];
        } else {
          const entry = { enabled: enabled };
          if (hasCustomNum) entry.customNumber = existing.customNumber;
          if (hasCustomName) entry.customName = existing.customName;
          this.overrides[ch.uid] = entry;
        }
      }
    }
    this.saveOverrides(true);
    this.recompileLineup(false, true);
  }

  shouldUseAndroidProxy(url) {
    if (
      typeof window === 'undefined' ||
      !window.location ||
      window.location.hostname !== 'appassets.androidplatform.net'
    ) {
      return false;
    }
    if (!url || typeof url !== 'string') return false;
    if (!/^https?:\/\//i.test(url)) return false;
    if (/^https?:\/\/appassets\.androidplatform\.net(?:[:\/?#]|$)/i.test(url)) return false;
    return true;
  }

  fetchWithProxyFallback(url, options) {
    const doFetch = (targetUrl) => (options ? fetch(targetUrl, options) : fetch(targetUrl));
    return doFetch(url)
      .then((res) => {
        if (res && res.ok) return res;
        const status = res ? res.status : 0;
        throw new Error('HTTP ' + status);
      })
      .catch((err) => {
        if (!this.shouldUseAndroidProxy(url)) {
          throw err;
        }
        const proxyUrl = 'https://appassets.androidplatform.net/__proxy__?url=' + encodeURIComponent(url);
        return doFetch(proxyUrl).then((proxyRes) => {
          if (!proxyRes || !proxyRes.ok) {
            const pStatus = proxyRes ? proxyRes.status : 0;
            throw new Error('HTTP ' + pStatus);
          }
          return proxyRes;
        });
      });
  }

  /**
   * Fetches all enabled M3U sources in parallel, merges them, and applies custom channel selections & numbers.
   */
  fetchAllSources(onProgress) {
    const activeSources = this.sources.filter((s) => s.enabled && s.url && s.url.trim());
    if (activeSources.length === 0) {
      return Promise.reject(new Error('אין מקורות M3U פעילים'));
    }

    let discoveredEpgUrl = '';
    const discoveredEpgSet = new Set();
    let hadSourceError = false;
    const fetchPromises = activeSources.map((src) => {
      const normalizedUrl = this.normalizeM3uInput(src.url);
      let textPromise;
      if (normalizedUrl.indexOf('data:') === 0) {
        const commaIdx = normalizedUrl.indexOf(',');
        const encoded = commaIdx !== -1 ? normalizedUrl.substring(commaIdx + 1) : '';
        textPromise = Promise.resolve(decodeURIComponent(encoded));
      } else {
        textPromise = this.fetchWithProxyFallback(normalizedUrl)
          .then((res) => res.text())
          .catch((err) => {
            const msg = err && err.message ? err.message : 'Fetch error';
            throw new Error(msg + ' (' + src.name + ')');
          });
      }

      return textPromise
        .then((text) => {
          const parsed = this.parser.parse(text, { id: src.id, name: src.name, url: normalizedUrl });
          if (Array.isArray(parsed.epgUrls)) {
            for (let i = 0; i < parsed.epgUrls.length; i++) {
              if (parsed.epgUrls[i]) discoveredEpgSet.add(parsed.epgUrls[i]);
            }
          }
          if (parsed.epgUrl) {
            discoveredEpgSet.add(parsed.epgUrl);
            if (!discoveredEpgUrl) discoveredEpgUrl = parsed.epgUrl;
          }
          return parsed.channels || [];
        })
        .catch((err) => {
          hadSourceError = true;
          console.warn('Failed to fetch source ' + src.name + ':', err);
          if (onProgress) onProgress('שגיאה בטעינת ' + src.name);
          return [];
        });
    });

    return Promise.all(fetchPromises).then((channelArrays) => {
      this.discoveredEpgUrls = Array.from(discoveredEpgSet);
      if (!discoveredEpgUrl && this.discoveredEpgUrls.length > 0) {
        discoveredEpgUrl = this.discoveredEpgUrls[0];
      }

      const mergedRaw = [];
      let sequentialFallback = 1;

      for (let s = 0; s < channelArrays.length; s++) {
        const list = channelArrays[s];
        for (let c = 0; c < list.length; c++) {
          const ch = list[c];
          ch.defaultSeqNumber = sequentialFallback++;
          mergedRaw.push(ch);
        }
      }

      if (mergedRaw.length > 0) {
        this.rawChannels = mergedRaw;
        this.pruneStaleOverrides(!hadSourceError);
        this.recompileLineup();
      }

      return {
        rawChannels: this.rawChannels,
        compiledChannels: this.compiledChannels,
        epgUrl: discoveredEpgUrl,
        epgUrls: this.discoveredEpgUrls,
        hadSourceError: hadSourceError
      };
    });
  }

  /**
   * Applies channel selection (enabled/disabled) and custom channel numbers,
   * producing a single unified, sorted channel lineup and rebuilding O(1) lookup indices.
   */
  recompileLineup(skipCacheSave, deferCacheSave) {
    this._ensureStoreState();
    const visible = [];
    const overrides = this.overrides;
    for (let i = 0; i < this.rawChannels.length; i++) {
      const raw = this.rawChannels[i];
      if (!raw) continue;
      const uid = raw.uid || raw.id || ((raw.sourceId || 'src') + '_' + (i + 1));
      raw.uid = uid;
      const ov = overrides[uid];
      const isEnabled = ov && typeof ov.enabled === 'boolean' ? ov.enabled : true;

      const assignedNum = (ov && typeof ov.customNumber === 'number' && ov.customNumber > 0)
        ? ov.customNumber
        : (raw.defaultSeqNumber || raw.originalNumber || raw.number || (i + 1));

      raw.enabled = isEnabled;
      raw.number = assignedNum;
      const customName = (ov && ov.customName && ov.customName.trim()) ? ov.customName.trim() : '';
      if (customName) {
        raw.displayName = customName;
      }

      if (isEnabled) {
        visible.push({
          id: uid,
          uid: uid,
          sourceId: raw.sourceId || 'src_default',
          sourceName: raw.sourceName || '',
          number: assignedNum,
          originalNumber: raw.originalNumber || assignedNum,
          name: customName || raw.name,
          rawName: raw.name,
          tvgName: raw.tvgName || raw.name,
          logo: raw.logo || '',
          group: raw.group || 'טלוויזיה חיה',
          epgId: raw.epgId || '',
          url: raw.url || '',
          catchupType: raw.catchupType || '',
          catchupSource: raw.catchupSource || '',
          catchupDays: typeof raw.catchupDays === 'number' ? raw.catchupDays : 7
        });
      }
    }

    // Sort unified channel list by assigned channel number ascending
    const collator = this._heCollator;
    visible.sort((a, b) => {
      if (a.number !== b.number) return a.number - b.number;
      return collator ? collator.compare(a.name, b.name) : a.name.localeCompare(b.name, 'he');
    });

    this.compiledChannels = visible;
    this.rebuildChannelIndices();
    if (!skipCacheSave) {
      this.saveCachedLineup(Boolean(deferCacheSave));
    }
    return this.compiledChannels;
  }

  /**
   * Import full configuration JSON pushed/pulled from the PC Web Studio (manager.html / sync-server.js)
   */
  importStudioConfig(configData) {
    if (!configData || typeof configData !== 'object') {
      throw new Error('קובץ הגדרות לא תקין');
    }

    if (Array.isArray(configData.sources) && configData.sources.length > 0) {
      this.sources = configData.sources;
      this.saveSources();
    }

    if (configData.overrides && typeof configData.overrides === 'object') {
      this.overrides = configData.overrides;
      this.saveOverrides();
    }

    if (Array.isArray(configData.rawChannels) && configData.rawChannels.length > 0) {
      this.rawChannels = configData.rawChannels;
      this.recompileLineup();
    }
    this.flushPendingSaves();

    return {
      sourcesCount: this.sources.length,
      channelsCount: this.compiledChannels.length,
      epgUrl: configData.epgUrl || ''
    };
  }

  /**
   * Sync configuration from PC Studio Server (e.g., "192.168.1.20" or "192.168.1.20:8765" or full URL)
   */
  syncFromPc(inputHostOrUrl) {
    if (!inputHostOrUrl || !inputHostOrUrl.trim()) {
      return Promise.reject(new Error('נא להזין כתובת IP של המחשב או קישור סנכרון'));
    }

    let target = inputHostOrUrl.trim();
    localStorage.setItem(LINEUP_KEYS.PC_SYNC_HOST, target);

    // If user entered just IP like "192.168.1.15" or "192.168.1.15:8765" using TV remote numbers
    if (target.indexOf('http://') !== 0 && target.indexOf('https://') !== 0) {
      if (target.indexOf(':') === -1) {
        target = 'http://' + target + ':8765/api/lineup';
      } else {
        target = 'http://' + target + '/api/lineup';
      }
    } else if (target.indexOf('/api/lineup') === -1 && target.indexOf(':8765') !== -1) {
      target = target.replace(/\/$/, '') + '/api/lineup';
    }

    return this.fetchWithProxyFallback(target, { cache: 'no-cache' })
      .then((res) => res.json())
      .catch((err) => {
        if (err && typeof err.message === 'string' && err.message.indexOf('HTTP ') === 0) {
          throw new Error('שרת המחשב החזיר שגיאה: ' + err.message.slice(5));
        }
        throw err;
      })
      .then((data) => {
        const summary = this.importStudioConfig(data);
        // If studio only sent sources+overrides without pre-parsed rawChannels, fetch sources now
        if (!Array.isArray(data.rawChannels) || data.rawChannels.length === 0) {
          return this.fetchAllSources().then(() => summary);
        }
        return summary;
      });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LineupStore;
}
