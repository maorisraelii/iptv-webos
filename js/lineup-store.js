/**
 * Multi-M3U Lineup Store, Custom Channel Numbering & Instant-Boot Cache Engine
 * Optimized for LG webOS 4.64 & 5.0+
 * - Supports multiple M3U playlist sources merged into one unified channel list
 * - Supports per-channel visibility selection (enabled/disabled) & custom channel numbers
 * - Caches compiled channel list in localStorage for < 20ms instant cold boot
 * - Supports 1-click sync from the PC / Mobile Web Studio (manager.html / sync-server.js)
 */
const LINEUP_KEYS = {
  SOURCES: 'zenplay_iptv_sources_v2',
  OVERRIDES: 'zenplay_iptv_channel_overrides_v2',
  CACHED_LINEUP: 'zenplay_iptv_cached_lineup_v2',
  PC_SYNC_HOST: 'zenplay_iptv_pc_sync_host',
  LEGACY_M3U: 'zenplay_iptv_m3u_url'
};

const DEFAULT_SAMPLE_M3U = 'https://iptv-org.github.io/iptv/countries/il.m3u';

class LineupStore {
  constructor(parser) {
    this.parser = parser || new M3UParser();
    this.sources = [];
    this.overrides = {}; // { [channelUid]: { enabled: true/false, customNumber: 12, customName: '' } }
    this.rawChannels = []; // All parsed channels from all enabled sources
    this.compiledChannels = []; // Filtered (enabled) & sorted by customNumber

    this.loadConfig();
  }

  loadConfig() {
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
    } catch (e) {
      console.warn('LineupStore loadConfig warning:', e);
      this.sources = [
        { id: 'src_1', name: 'פלייליסט ראשי', url: DEFAULT_SAMPLE_M3U, enabled: true }
      ];
      this.overrides = {};
    }
  }

  saveSources() {
    try {
      localStorage.setItem(LINEUP_KEYS.SOURCES, JSON.stringify(this.sources));
      if (this.sources.length > 0 && this.sources[0].url) {
        localStorage.setItem(LINEUP_KEYS.LEGACY_M3U, this.sources[0].url);
      }
    } catch (e) {}
  }

  saveOverrides() {
    try {
      localStorage.setItem(LINEUP_KEYS.OVERRIDES, JSON.stringify(this.overrides));
    } catch (e) {}
  }

  /**
   * Instant-Boot Cache: Returns cached compiled lineup in < 5ms so UI renders before network finishes!
   */
  loadCachedLineup() {
    try {
      const raw = localStorage.getItem(LINEUP_KEYS.CACHED_LINEUP);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.compiledChannels) && data.compiledChannels.length > 0) {
        this.rawChannels = data.rawChannels || data.compiledChannels;
        this.compiledChannels = data.compiledChannels;
        this.lastCacheTimestamp = data.updatedAt || 0;
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
    try {
      localStorage.removeItem(LINEUP_KEYS.CACHED_LINEUP);
      this.lastCacheTimestamp = 0;
    } catch (e) {}
  }

  saveCachedLineup() {
    try {
      this.lastCacheTimestamp = Date.now();
      // Keep cache compact (cap at 800 channels for 5MB localStorage limit safety)
      const payload = {
        updatedAt: this.lastCacheTimestamp,
        rawChannels: this.rawChannels.slice(0, 800),
        compiledChannels: this.compiledChannels.slice(0, 800)
      };
      localStorage.setItem(LINEUP_KEYS.CACHED_LINEUP, JSON.stringify(payload));
    } catch (e) {
      console.warn('Could not cache lineup in localStorage:', e);
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
    return true;
  }

  /**
   * Set per-channel override (visibility or custom channel number)
   */
  setChannelOverride(uid, changes) {
    if (!uid) return;
    const existing = this.overrides[uid] || {};
    this.overrides[uid] = {
      enabled: typeof changes.enabled === 'boolean' ? changes.enabled : (typeof existing.enabled === 'boolean' ? existing.enabled : true),
      customNumber: typeof changes.customNumber === 'number' && !isNaN(changes.customNumber) ? changes.customNumber : existing.customNumber,
      customName: typeof changes.customName === 'string' ? changes.customName : existing.customName
    };
    this.saveOverrides();
    this.recompileLineup();
  }

  /**
   * Enable or disable all channels belonging to a specific M3U source
   */
  setAllSourceChannelsEnabled(sourceId, enabled) {
    for (let i = 0; i < this.rawChannels.length; i++) {
      const ch = this.rawChannels[i];
      if (ch.sourceId === sourceId) {
        const existing = this.overrides[ch.uid] || {};
        this.overrides[ch.uid] = {
          enabled: enabled,
          customNumber: existing.customNumber,
          customName: existing.customName
        };
      }
    }
    this.saveOverrides();
    this.recompileLineup();
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
    const fetchPromises = activeSources.map((src) => {
      const normalizedUrl = this.normalizeM3uInput(src.url);
      let textPromise;
      if (normalizedUrl.indexOf('data:') === 0) {
        const commaIdx = normalizedUrl.indexOf(',');
        const encoded = commaIdx !== -1 ? normalizedUrl.substring(commaIdx + 1) : '';
        textPromise = Promise.resolve(decodeURIComponent(encoded));
      } else {
        textPromise = fetch(normalizedUrl).then((res) => {
          if (!res.ok) throw new Error('HTTP ' + res.status + ' (' + src.name + ')');
          return res.text();
        });
      }

      return textPromise
        .then((text) => {
          const parsed = this.parser.parse(text, { id: src.id, name: src.name });
          if (parsed.epgUrl && !discoveredEpgUrl) {
            discoveredEpgUrl = parsed.epgUrl;
          }
          return parsed.channels || [];
        })
        .catch((err) => {
          console.warn('Failed to fetch source ' + src.name + ':', err);
          if (onProgress) onProgress('שגיאה בטעינת ' + src.name);
          return [];
        });
    });

    return Promise.all(fetchPromises).then((channelArrays) => {
      const mergedRaw = [];
      let sequentialFallback = 1;

      for (let s = 0; s < channelArrays.length; s++) {
        const list = channelArrays[s];
        for (let c = 0; c < list.length; c++) {
          const ch = Object.assign({}, list[c]);
          ch.defaultSeqNumber = sequentialFallback++;
          mergedRaw.push(ch);
        }
      }

      if (mergedRaw.length > 0) {
        this.rawChannels = mergedRaw;
        this.recompileLineup();
      }

      return {
        rawChannels: this.rawChannels,
        compiledChannels: this.compiledChannels,
        epgUrl: discoveredEpgUrl
      };
    });
  }

  /**
   * Applies channel selection (enabled/disabled) and custom channel numbers,
   * producing a single unified, sorted channel lineup.
   */
  recompileLineup() {
    const visible = [];
    for (let i = 0; i < this.rawChannels.length; i++) {
      const raw = this.rawChannels[i];
      const ov = this.overrides[raw.uid] || {};
      const isEnabled = typeof ov.enabled === 'boolean' ? ov.enabled : true;

      const assignedNum = (typeof ov.customNumber === 'number' && ov.customNumber > 0)
        ? ov.customNumber
        : (raw.defaultSeqNumber || raw.originalNumber || (i + 1));

      raw.enabled = isEnabled;
      raw.number = assignedNum;
      if (ov.customName && ov.customName.trim()) {
        raw.displayName = ov.customName.trim();
      }

      if (isEnabled) {
        visible.push({
          id: raw.uid,
          uid: raw.uid,
          sourceId: raw.sourceId,
          sourceName: raw.sourceName,
          number: assignedNum,
          originalNumber: raw.originalNumber,
          name: (ov.customName && ov.customName.trim()) ? ov.customName.trim() : raw.name,
          logo: raw.logo,
          group: raw.group,
          epgId: raw.epgId,
          url: raw.url,
          catchupType: raw.catchupType,
          catchupSource: raw.catchupSource,
          catchupDays: raw.catchupDays
        });
      }
    }

    // Sort unified channel list by assigned channel number ascending
    visible.sort((a, b) => {
      if (a.number !== b.number) return a.number - b.number;
      return a.name.localeCompare(b.name, 'he');
    });

    this.compiledChannels = visible;
    this.saveCachedLineup();
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

    return fetch(target, { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error('שרת המחשב החזיר שגיאה: ' + res.status);
        return res.json();
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
