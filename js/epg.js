/**
 * High-Performance 7-Day EPG (Electronic Program Guide) & Catch-Up Engine
 * Optimized for LG webOS 4.64 & 5.0+
 * - Extracts & merges XMLTV from M3U headers (url-tvg / x-tvg-url / tvg-url), Xtream xmltv.php, and manual EPG URLs
 * - Supports both plain .xml and GZIP-compressed .xml.gz EPG feeds (DecompressionStream + pure-JS inflate fallback)
 * - Fault-tolerant XMLTV scanner (never aborts on unescaped '&' entities in IPTV provider feeds)
 * - Multi-alias channel matcher: matches by tvg-id, tvg-name, XMLTV <channel id>, <display-name>, and normalized Hebrew/English synonyms
 * - Strictly bounds history to 7 days back + today + 1 day ahead
 */
const NORM_BRACKETS_RE = /\[[^\]]*\]/g;
const NORM_PARENS_RE = /\([^)]*\)/g;
const NORM_NOISE_RE = /\b(?:1080p|720p|576p|480p|4k|uhd|fhd|hd|sd|hevc|h265|h264|israel|il|tv|channel|ch)\b/gi;
const NORM_HE_CH_RE = /ערוץ/g;
const NORM_STRIP_RE = /[^a-z0-9\u0590-\u05fe]+/g;
const VOD_NIQQUD_RE = /[\u0591-\u05C7]/g;
const VOD_QUOTES_RE = /["'\u05F3\u05F4\u2018\u2019\u201C\u201D׳״]/g;
const VOD_SEP_RE = /[^a-z0-9\u0590-\u05fe\s]+/g;
const VOD_WS_RE = /\s+/g;
const CDATA_RE = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
const XML_ENTITY_RE = /&(?:(quot|apos|lt|gt|amp|#39)|#(\d+)|#x([0-9a-fA-F]+));/g;
const XML_ENTITY_MAP = {
  quot: '"',
  apos: "'",
  '#39': "'",
  lt: '<',
  gt: '>',
  amp: '&'
};

const CHANNEL_SYNONYMS = {
  'כאן11': 'kan11',
  'kan11': 'kan11',
  'channel11': 'kan11',
  '11כאןשידורחי': 'kan11',
  '11': 'kan11',
  'קשת12': 'keshet12',
  'קשת': 'keshet12',
  'keshet12': 'keshet12',
  'channel12': 'keshet12',
  '12שידורחי': 'keshet12',
  '12': 'keshet12',
  'רשת13': 'reshet13',
  'רשת': 'reshet13',
  'reshet13': 'reshet13',
  'channel13': 'reshet13',
  '13': 'reshet13',
  'עכשיו14': 'now14',
  'now14': 'now14',
  'channel14': 'now14',
  '14שידורחי': 'now14',
  '14': 'now14',
  'kanchinuchit23': 'kanchinuchit',
  'kanchinuchit': 'kanchinuchit',
  'חינוכית': 'kanchinuchit',
  'כאןחינוכית': 'kanchinuchit',
  '23': 'kanchinuchit',
  'i24': 'i24news',
  'i24news': 'i24news',
  'עבריתi24': 'i24news',
  'hot3': 'hot3',
  'הוט3': 'hot3',
  '3': 'hot3',
  'one': 'oneil',
  'onehd': 'oneil',
  'one1': 'oneil',
  'one1hd': 'oneil',
  'oneשידורחי': 'oneil',
  'one2': 'one2il',
  'one2hd': 'one2il',
  '9': 'channel9il',
  '9שידורחי': 'channel9il',
  'ישראלפלוס': 'channel9il',
  '24': 'channel24il',
  '24בשידורחי': 'channel24il',
  'מוזיקה24': 'channel24il',
  'מכאן33': 'makan33',
  'makan33': 'makan33',
  '33': 'makan33',
  'ספורט5': 'sport5',
  'ספורט5שידורחי': 'sport5',
  '5sport': 'sport5',
  'sport5': 'sport5',
  '5plus': 'sport5plus',
  'ספורט5פלוס': 'sport5plus',
  '5stars': 'sport5stars',
  'ספורט5סטארס': 'sport5stars',
  '5live': 'sport5live',
  'sport5liv': 'sport5live',
  'ספורט5לייב': 'sport5live',
  'ספורט5פלוסלייב': 'sport5live',
  '5gold': 'sport5gold',
  'ספורט5גולד': 'sport5gold',
  'ספורט1': 'sport1il',
  'sport1': 'sport1il',
  'ספורט2': 'sport2il',
  'sport2': 'sport2il',
  'ספורט3': 'sport3il',
  'sport3': 'sport3il',
  'ספורט4': 'sport4il',
  'sport4': 'sport4il',
  'החייםהטובים': 'goodlife',
  'goodlife': 'goodlife',
  'הקומדיה': 'comedychannel',
  'comedychannel': 'comedychannel',
  'comedy': 'comedychannel',
  'הלא': 'halatv',
  'הלאtv': 'halatv',
  'hala': 'halatv',
  'halatv': 'halatv',
  'כנסת': 'knesset',
  'הכנסת': 'knesset',
  'knesset': 'knesset'
};

class EPGService {
  constructor() {
    this.programmesByChannel = new Map();
    this.programmes = this.programmesByChannel;
    this.channelAliasMap = new Map(); // normalizedKey -> xmltvChannelId
    this.channelAliasCandidates = new Map(); // aliasKey -> Array of xmltvChannelIds
    this.dayBucketsCache = new Map();
    this._channelMatchCache = new Map(); // Bounded LRU (max 512 entries)
    this._normCache = new Map();
    this._formatTimeCache = new Map(); // Pre-formatted HH:MM cache keyed by minute bucket
    this._nowNextCache = new Map(); // 15-second memoized getNowNext cache
    this._epgCacheEpoch = 0;
    this._syntheticScheduleCache = new Map(); // Bounded LRU (max 5 channels) for 7-day guide modal only
    this._lastParseHasLiveCoverage = false;
    this.epgUrl = '';
    this.loadedUrls = [];
    this.isLoading = false;
    this.lastUpdatedMs = 0;
    this.MAX_PAST_DAYS = 7;
    this.MAX_PARSE_PAST_DAYS = 8;
    this.MAX_PARSE_FUTURE_DAYS = 4;
    this.MAX_ALIAS_CACHE_SIZE = 512;
    this.DAY_MS = 86400000;
    this.EPG_CACHE_KEY = 'zenplay_iptv_epg_cache_v491';
    this.TTL_STORAGE_KEY = 'zenplay_iptv_cache_ttl_hours';
    this.DEFAULT_LIVE_EPG_URLS = [
      'https://raw.githubusercontent.com/maorisraelii/iptv-webos/main/epg-il.xml',
      'https://maorisraelii.github.io/iptv-webos/epg-il.xml',
      'https://gist.githubusercontent.com/maorisraelii/b4408ca1c31143ed2f50164629f53f1c/raw/epg-il.xml',
      'epg-il.xml'
    ];
    this.DEFAULT_LIVE_EPG_URL = this.DEFAULT_LIVE_EPG_URLS[0];
  }

  _ensureRuntimeCaches() {
    if (!this.programmesByChannel) this.programmesByChannel = new Map();
    if (!this.programmes) this.programmes = this.programmesByChannel;
    if (!this.channelAliasMap) this.channelAliasMap = new Map();
    if (!this.channelAliasCandidates) this.channelAliasCandidates = new Map();
    if (!this.dayBucketsCache) this.dayBucketsCache = new Map();
    if (!this._channelMatchCache) this._channelMatchCache = new Map();
    if (!this._normCache) this._normCache = new Map();
    if (!this._formatTimeCache) this._formatTimeCache = new Map();
    if (!this._nowNextCache) this._nowNextCache = new Map();
    if (typeof this._epgCacheEpoch !== 'number') this._epgCacheEpoch = 0;
    if (typeof this.MAX_PARSE_PAST_DAYS !== 'number') this.MAX_PARSE_PAST_DAYS = 8;
    if (typeof this.MAX_PARSE_FUTURE_DAYS !== 'number') this.MAX_PARSE_FUTURE_DAYS = 4;
    if (typeof this.MAX_ALIAS_CACHE_SIZE !== 'number') this.MAX_ALIAS_CACHE_SIZE = 512;
  }

  _invalidateQueryCaches() {
    this._ensureRuntimeCaches();
    this._epgCacheEpoch++;
    this._nowNextCache.clear();
    this._channelMatchCache.clear();
    this.dayBucketsCache.clear();
  }

  getCacheTtlHours() {
    try {
      const val = parseInt(localStorage.getItem(this.TTL_STORAGE_KEY), 10);
      if (!isNaN(val) && val >= 0) return val;
    } catch (e) {}
    return 24;
  }

  setCacheTtlHours(hours) {
    try {
      localStorage.setItem(this.TTL_STORAGE_KEY, String(hours));
    } catch (e) {}
  }

  /**
   * Normalizes a channel ID or display name for fuzzy matching between M3U and XMLTV
   */
  normalizeChannelKey(str) {
    if (!str || typeof str !== 'string') return '';
    if (!this._normCache) this._normCache = new Map();
    const cached = this._normCache.get(str);
    if (cached !== undefined) return cached;

    const s = str
      .toLowerCase()
      .replace(NORM_BRACKETS_RE, ' ')
      .replace(NORM_PARENS_RE, ' ')
      .replace(NORM_NOISE_RE, ' ')
      .replace(NORM_HE_CH_RE, ' ')
      .replace(NORM_STRIP_RE, '')
      .trim();

    const result = CHANNEL_SYNONYMS[s] || s;
    if (this._normCache.size >= 2000) {
      this._normCache.clear();
    }
    this._normCache.set(str, result);
    return result;
  }

  _addAliasCandidate(candMap, key, targetChannelId) {
    if (!candMap || !key || !targetChannelId) return;
    let arr = candMap.get(key);
    if (!arr) {
      candMap.set(key, [targetChannelId]);
    } else if (arr.indexOf(targetChannelId) === -1) {
      arr.push(targetChannelId);
    }
  }

  registerChannelAlias(rawAlias, targetChannelId, targetMap, targetCandidatesMap) {
    if (!rawAlias || !targetChannelId) return;
    const trimmed = rawAlias.trim();
    if (!trimmed) return;
    const map = targetMap || this.channelAliasMap;
    if (!targetMap && !this.channelAliasCandidates) {
      this.channelAliasCandidates = new Map();
    }
    const candMap = targetCandidatesMap || (targetMap ? null : this.channelAliasCandidates);
    const lower = trimmed.toLowerCase();
    const norm = this.normalizeChannelKey(trimmed);

    map.set(trimmed, targetChannelId);
    map.set(lower, targetChannelId);
    if (norm) {
      map.set(norm, targetChannelId);
    }
    if (candMap) {
      this._addAliasCandidate(candMap, trimmed, targetChannelId);
      this._addAliasCandidate(candMap, lower, targetChannelId);
      if (norm) {
        this._addAliasCandidate(candMap, norm, targetChannelId);
      }
    }
  }

  _purgeSyntheticChannels() {
    this.programmesByChannel.forEach((_val, chId) => {
      if (typeof chId === 'string' && chId.indexOf('gen_') === 0) {
        this.programmesByChannel.delete(chId);
      }
    });
    if (this._syntheticScheduleCache) {
      this._syntheticScheduleCache.clear();
    }
  }

  rebuildAliasesFromLoadedChannels() {
    this.programmesByChannel.forEach((_list, chId) => {
      if (chId.indexOf('gen_') === 0) return;
      this.registerChannelAlias(chId, chId);
    });
  }

  _isDefaultLiveEpgUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const clean = url.split('?')[0].trim();
    const defaults = Array.isArray(this.DEFAULT_LIVE_EPG_URLS)
      ? this.DEFAULT_LIVE_EPG_URLS
      : [this.DEFAULT_LIVE_EPG_URL];
    for (let i = 0; i < defaults.length; i++) {
      if (clean === defaults[i]) return true;
    }
    return false;
  }

  _withDefaultCacheBuster(url) {
    if (!url || !/^https?:\/\//i.test(url)) return url;
    if (!this._isDefaultLiveEpgUrl(url)) return url;
    if (/[?&]v=\d+/.test(url)) return url;
    const sep = url.indexOf('?') === -1 ? '?' : '&';
    return url + sep + 'v=' + Math.floor(Date.now() / 600000);
  }

  hasLiveCoverage(nowMs) {
    const refMs = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
    const minStopMs = refMs - 3600000;
    const maxStartMs = refMs + 6 * 3600000;
    let found = false;
    this.programmesByChannel.forEach((list, chId) => {
      if (found || !chId || chId.indexOf('gen_') === 0 || !Array.isArray(list)) return;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p && p.startMs <= maxStartMs && p.stopMs > minStopMs) {
          found = true;
          return;
        }
      }
    });
    return found;
  }

  loadFromLocalCache(cacheKeyUrl) {
    try {
      const raw = localStorage.getItem(this.EPG_CACHE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.entries) || data.entries.length === 0) {
        return false;
      }

      const defaultJoinKey = Array.isArray(this.DEFAULT_LIVE_EPG_URLS)
        ? this.DEFAULT_LIVE_EPG_URLS.join('|')
        : this.DEFAULT_LIVE_EPG_URL;
      const isDefaultCacheReq =
        cacheKeyUrl === defaultJoinKey || this._isDefaultLiveEpgUrl(cacheKeyUrl);
      const urlMatches =
        data.url === cacheKeyUrl ||
        (isDefaultCacheReq &&
          (data.url === defaultJoinKey || this._isDefaultLiveEpgUrl(data.url)));
      if (!urlMatches) {
        return false;
      }

      const nowMs = Date.now();
      const ttlHours = this.getCacheTtlHours();
      const ageMs = nowMs - (data.updatedAt || 0);
      const isExpired = ttlHours > 0 && ageMs > ttlHours * 3600000;

      // Stale data is infinitely better than an empty screen.
      // Load into memory regardless of expiration, but trigger immediate background refresh if expired.
      this.lastUpdatedMs = isExpired ? 0 : (data.updatedAt || 0);

      this._ensureRuntimeCaches();
      this.programmesByChannel.clear();
      this.programmes = this.programmesByChannel;
      this.channelAliasMap.clear();
      this.channelAliasCandidates.clear();
      this._invalidateQueryCaches();

      let latestStopMs = 0;
      for (let i = 0; i < data.entries.length; i++) {
        const entry = data.entries[i];
        const chId = entry[0];
        const rawList = entry[1];
        if (!chId || chId.indexOf('gen_') === 0 || !Array.isArray(rawList)) continue;
        const progs = new Array(rawList.length);
        for (let j = 0; j < rawList.length; j++) {
          const p = rawList[j];
          if (p.e > latestStopMs) latestStopMs = p.e;
          progs[j] = {
            id: chId + '_' + p.s,
            title: p.t,
            desc: p.d,
            startMs: p.s,
            stopMs: p.e
          };
        }
        this.programmesByChannel.set(chId, progs);
        this.registerChannelAlias(chId, chId);
      }

      // If cached data has NO programme covering Date.now() (latestStopMs < Date.now() or no live coverage),
      // force immediate background network refresh (ageMs >= 20 * 60 * 1000).
      if (latestStopMs < nowMs || !this.hasLiveCoverage(nowMs)) {
        this.lastUpdatedMs = 0;
      }

      if (Array.isArray(data.aliases)) {
        for (let i = 0; i < data.aliases.length; i++) {
          const pair = data.aliases[i];
          if (pair && pair[0] && pair[1]) {
            this.registerChannelAlias(pair[0], pair[1]);
          }
        }
      }

      this._purgeSyntheticChannels();
      if (this._channelMatchCache) this._channelMatchCache.clear();

      return true;
    } catch (e) {
      return false;
    }
  }

  saveToLocalCache(cacheKeyUrl) {
    try {
      const now = Date.now();
      // Active viewing window: from 6 hours ago to 24 hours ahead
      const minMs = now - 6 * 3600000;
      const maxMs = now + 24 * 3600000;

      const entries = [];
      const savedChannelIds = new Set();
      this.programmesByChannel.forEach((list, chId) => {
        if (!chId || chId.indexOf('gen_') === 0 || !Array.isArray(list)) return;
        // Keep shows in current active viewing window, up to 25 shows per channel
        const compactList = [];
        for (let i = 0; i < list.length && compactList.length < 25; i++) {
          const p = list[i];
          if (p.stopMs >= minMs && p.startMs <= maxMs) {
            compactList.push({
              t: p.title,
              d: p.desc ? (p.desc.length > 360 ? p.desc.substring(0, 360).replace(/\s+\S*$/, '') + '...' : p.desc) : '',
              s: p.startMs,
              e: p.stopMs
            });
          }
        }
        if (compactList.length > 0) {
          entries.push([chId, compactList]);
          savedChannelIds.add(chId);
        }
      });

      const aliases = [];
      if (this.channelAliasCandidates && this.channelAliasCandidates.size > 0) {
        this.channelAliasCandidates.forEach((candList, aliasKey) => {
          if (!aliasKey || !Array.isArray(candList)) return;
          for (let i = 0; i < candList.length; i++) {
            const targetId = candList[i];
            if (targetId && aliasKey !== targetId && savedChannelIds.has(targetId)) {
              aliases.push([aliasKey, targetId]);
            }
          }
        });
      } else {
        this.channelAliasMap.forEach((targetId, aliasKey) => {
          if (aliasKey && targetId && aliasKey !== targetId && savedChannelIds.has(targetId)) {
            aliases.push([aliasKey, targetId]);
          }
        });
      }

      this.lastUpdatedMs = Date.now();
      const payload = JSON.stringify({
        url: cacheKeyUrl,
        updatedAt: this.lastUpdatedMs,
        entries: entries,
        aliases: aliases
      });

      localStorage.setItem(this.EPG_CACHE_KEY, payload);
    } catch (e) {
      console.warn('saveToLocalCache storage error, attempting minimal compaction:', e);
      try {
        const minimalEntries = [];
        this.programmesByChannel.forEach((list, chId) => {
          if (!chId || chId.indexOf('gen_') === 0) return;
          const active = list.slice(0, 15);
          minimalEntries.push([
            chId,
            active.map((p) => ({ t: p.title, d: '', s: p.startMs, e: p.stopMs }))
          ]);
        });
        localStorage.setItem(
          this.EPG_CACHE_KEY,
          JSON.stringify({
            url: cacheKeyUrl,
            updatedAt: Date.now(),
            entries: minimalEntries,
            aliases: []
          })
        );
      } catch (inner) {}
    }
  }

  clearCache() {
    try {
      this._ensureRuntimeCaches();
      localStorage.removeItem(this.EPG_CACHE_KEY);
      this.programmesByChannel.clear();
      this.programmes = this.programmesByChannel;
      this.channelAliasMap.clear();
      if (this.channelAliasCandidates) this.channelAliasCandidates.clear();
      this._invalidateQueryCaches();
      if (this._normCache) this._normCache.clear();
      if (this._formatTimeCache) this._formatTimeCache.clear();
      if (this._syntheticScheduleCache) this._syntheticScheduleCache.clear();
      this.lastUpdatedMs = 0;
    } catch (e) {}
  }

  setTargetChannels(channels) {
    if (!Array.isArray(channels) || channels.length === 0) {
      this.targetChannelKeys = null;
      return;
    }
    this.targetChannelKeys = new Set();
    for (let i = 0; i < channels.length; i++) {
      const ch = channels[i];
      if (!ch) continue;
      const fields = [ch.epgId, ch.tvgName, ch.rawName, ch.name];
      for (let f = 0; f < fields.length; f++) {
        const val = fields[f];
        if (!val || typeof val !== 'string') continue;
        const trimmed = val.trim();
        if (!trimmed) continue;
        this.targetChannelKeys.add(trimmed.toLowerCase());
        const norm = this.normalizeChannelKey(trimmed);
        if (norm) this.targetChannelKeys.add(norm);
      }
    }
  }

  /**
   * Loads one or more XMLTV URLs (supports comma-separated strings, arrays, .xml and .xml.gz).
   * Implements Stale-While-Revalidate: serves instant cached schedule for 0-ms cold boot,
   * while continuing background network fetch to guarantee 100% freshness across all channels.
   */
  loadEPG(urlOrUrls, onComplete, forceRefresh, activeChannels) {
    if (activeChannels) {
      this.setTargetChannels(activeChannels);
    }
    let urls = [];
    if (Array.isArray(urlOrUrls)) {
      for (let i = 0; i < urlOrUrls.length; i++) {
        if (urlOrUrls[i] && typeof urlOrUrls[i] === 'string') {
          const parts = urlOrUrls[i].split(',');
          for (let p = 0; p < parts.length; p++) {
            const u = parts[p].trim();
            if (u) urls.push(u);
          }
        }
      }
    } else if (typeof urlOrUrls === 'string' && urlOrUrls.trim()) {
      const parts = urlOrUrls.split(',');
      for (let p = 0; p < parts.length; p++) {
        const u = parts[p].trim();
        if (u) urls.push(u);
      }
    }

    // Safety guard for TV hardware: monolithic global XML feeds (like epg.team/3.1.xml which is 307MB)
    // will crash webOS WebKit memory. Redirect them to our optimized, pre-filtered Israeli feed!
    urls = urls.map((u) => {
      if (u && (u.indexOf('epg.team') !== -1 || u.indexOf('epg_ripper_ALL') !== -1)) {
        return this.DEFAULT_LIVE_EPG_URL;
      }
      return u;
    });

    // Deduplicate URLs
    urls = Array.from(new Set(urls));
    if (urls.length === 0 || this.isLoading) {
      if (onComplete) onComplete(false);
      return;
    }

    const customUrls = [];
    let hasDefaultUrl = false;
    for (let i = 0; i < urls.length; i++) {
      if (this._isDefaultLiveEpgUrl(urls[i])) {
        hasDefaultUrl = true;
      } else {
        customUrls.push(urls[i]);
      }
    }

    const defaultCandidates =
      Array.isArray(this.DEFAULT_LIVE_EPG_URLS) && this.DEFAULT_LIVE_EPG_URLS.length > 0
        ? this.DEFAULT_LIVE_EPG_URLS.slice()
        : [this.DEFAULT_LIVE_EPG_URL];
    const cacheKeyUrl =
      hasDefaultUrl && customUrls.length === 0 ? defaultCandidates.join('|') : urls.join('|');

    this.epgUrl = customUrls.length > 0 ? customUrls[0] : defaultCandidates[0];
    this.loadedUrls = customUrls.length === 0 && hasDefaultUrl ? defaultCandidates.slice() : urls;

    // Stale-While-Revalidate: render immediately from local cache if available (< 15ms)
    const hasCachedData = !forceRefresh && this.loadFromLocalCache(cacheKeyUrl);
    if (hasCachedData) {
      if (onComplete) onComplete(true);
      const ageMs = Date.now() - (this.lastUpdatedMs || 0);
      // If cache was refreshed within last 20 minutes and has live coverage, don't spam network fetch
      if (ageMs < 20 * 60 * 1000) {
        return;
      }
    }

    this.isLoading = true;

    // Stream-parse custom EPG URLs first, then priority-ordered default live EPG fallback candidates
    let customIdx = 0;
    let defaultIdx = 0;
    let hasCustomParsed = false;
    let parsedAny = false;

    const finishLoad = () => {
      const anySuccess = parsedAny && this.programmesByChannel.size > 0;
      if (anySuccess) {
        this.saveToLocalCache(cacheKeyUrl);
        this.dayBucketsCache.clear();
      }
      this.isLoading = false;
      if (onComplete) onComplete(anySuccess);
    };

    const processNextDefault = () => {
      if (!hasDefaultUrl || defaultIdx >= defaultCandidates.length) {
        finishLoad();
        return;
      }
      const rawCandidate = defaultCandidates[defaultIdx++];
      const fetchUrl = this._withDefaultCacheBuster(rawCandidate);
      const isAppend = hasCustomParsed;
      this.fetchAndStreamParseXMLTV(fetchUrl, isAppend, true)
        .then((ok) => {
          if (ok) {
            parsedAny = true;
            if (!hasCustomParsed) {
              this.epgUrl = rawCandidate;
            }
            const hasLive = isAppend
              ? this._lastParseHasLiveCoverage
              : this.hasLiveCoverage(Date.now());
            if (hasLive) {
              finishLoad();
              return;
            }
            console.warn(
              'EPG default source stale or lacks live coverage (' + rawCandidate + '), trying fallback...'
            );
          } else {
            console.warn('EPG default source empty (' + rawCandidate + '), trying fallback...');
          }
          processNextDefault();
        })
        .catch((err) => {
          console.warn('EPG source warning (' + rawCandidate + '):', err);
          processNextDefault();
        });
    };

    const processNextCustom = () => {
      if (customIdx >= customUrls.length) {
        processNextDefault();
        return;
      }
      const u = customUrls[customIdx++];
      const isAppend = hasCustomParsed;
      this.fetchAndStreamParseXMLTV(u, isAppend, false)
        .then((ok) => {
          if (ok) {
            hasCustomParsed = true;
            parsedAny = true;
          }
          processNextCustom();
        })
        .catch((err) => {
          console.warn('EPG source warning (' + u + '):', err);
          processNextCustom();
        });
    };

    processNextCustom();
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

  fetchWithProxyFallback(url) {
    return fetch(url)
      .then((res) => {
        if (res && res.ok) return res;
        throw new Error('EPG HTTP ' + (res ? res.status : 0));
      })
      .catch((err) => {
        if (!this.shouldUseAndroidProxy(url)) {
          throw err;
        }
        const proxyUrl = 'https://appassets.androidplatform.net/__proxy__?url=' + encodeURIComponent(url);
        return fetch(proxyUrl).then((proxyRes) => {
          if (!proxyRes || !proxyRes.ok) {
            throw new Error('EPG HTTP ' + (proxyRes ? proxyRes.status : 0));
          }
          return proxyRes;
        });
      });
  }

  _fetchXmltvResponse(url, skipLocalFallback) {
    if (!url) return Promise.resolve(null);
    if (url.indexOf('epg.team') !== -1 || url.indexOf('epg_ripper_ALL') !== -1) {
      url = this.DEFAULT_LIVE_EPG_URL;
    }
    return this.fetchWithProxyFallback(url).catch((err) => {
      if (!skipLocalFallback && (url === this.DEFAULT_LIVE_EPG_URL || url.indexOf('epg-il.xml') !== -1)) {
        const cleanUrl = url.split('?')[0];
        if (cleanUrl !== 'epg-il.xml') {
          console.warn('Remote EPG unavailable, falling back to bundled epg-il.xml:', err);
          return fetch('epg-il.xml').then((localRes) => {
            if (!localRes || !localRes.ok) throw err;
            return localRes;
          });
        }
      }
      throw err;
    });
  }

  _decodeArrayBufferToXml(buffer, maxSafeBytes, url) {
    if (!buffer) return Promise.resolve('');
    if (buffer.byteLength > maxSafeBytes) {
      console.warn('EPG feed buffer exceeded 35MB safe limit, skipped:', url);
      return Promise.resolve('');
    }
    let bytes = new Uint8Array(buffer);
    buffer = null;
    // Check GZIP magic header (0x1f 0x8b)
    if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (typeof DecompressionStream !== 'undefined') {
        try {
          const ds = new DecompressionStream('gzip');
          const blob = new Blob([bytes]);
          bytes = null;
          const decompressedStream = blob.stream().pipeThrough(ds);
          return new Response(decompressedStream).text();
        } catch (e) {}
      }
    }
    if (typeof TextDecoder !== 'undefined') {
      const decoded = new TextDecoder('utf-8').decode(bytes);
      bytes = null;
      return Promise.resolve(decoded);
    }
    // Fallback for very old engines (webOS Chromium 53)
    let str = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      str += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    bytes = null;
    try {
      return Promise.resolve(decodeURIComponent(escape(str)));
    } catch (e) {
      return Promise.resolve(str);
    }
  }

  /**
   * Streaming XMLTV fetch + incremental chunked parser.
   * Uses ReadableStream + TextDecoder({ stream: true }) when available so 10MB+ feeds
   * peak at ~2-3 MB RAM with a rolling tail buffer < 64 KB; falls back cleanly to
   * ArrayBuffer + parseXMLTVAsync on older LG webOS Chromium 53 browsers.
   */
  fetchAndStreamParseXMLTV(url, appendMode, skipLocalFallback) {
    if (!url) return Promise.resolve(false);
    const MAX_SAFE_EPG_BYTES = 35 * 1024 * 1024;

    return this._fetchXmltvResponse(url, skipLocalFallback).then((res) => {
      if (!res) return false;
      const cl = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : null;
      if (cl && parseInt(cl, 10) > MAX_SAFE_EPG_BYTES) {
        console.warn('EPG feed exceeds TV memory safety limit (>35MB), aborting:', url);
        return false;
      }

      if (res.body && typeof res.body.getReader === 'function' && typeof TextDecoder !== 'undefined') {
        return this._parseXMLTVResponseStream(res, appendMode, MAX_SAFE_EPG_BYTES, url);
      }

      // Fallback for webOS Chromium 53 without ReadableStream
      return res
        .arrayBuffer()
        .then((buf) => this._decodeArrayBufferToXml(buf, MAX_SAFE_EPG_BYTES, url))
        .then((xmlText) => {
          if (!xmlText || xmlText.length <= 50) return false;
          return this.parseXMLTVAsync(xmlText, null, appendMode);
        });
    });
  }

  _parseXMLTVResponseStream(res, appendMode, maxSafeBytes, url) {
    const reader = res.body.getReader();
    return reader.read().then((first) => {
      if (!first || first.done || !first.value || first.value.byteLength === 0) {
        return false;
      }
      const firstChunk = first.value;
      const isGzip = firstChunk.byteLength >= 2 && firstChunk[0] === 0x1f && firstChunk[1] === 0x8b;

      if (isGzip) {
        if (typeof DecompressionStream !== 'undefined' && typeof ReadableStream !== 'undefined') {
          let sentFirst = false;
          const compressedStream = new ReadableStream({
            pull: (controller) => {
              if (!sentFirst) {
                sentFirst = true;
                controller.enqueue(firstChunk);
                return;
              }
              return reader.read().then((next) => {
                if (next.done) {
                  controller.close();
                } else {
                  controller.enqueue(next.value);
                }
              });
            },
            cancel: () => {
              try {
                reader.cancel();
              } catch (e) {}
            }
          });
          const gunzipReader = compressedStream.pipeThrough(new DecompressionStream('gzip')).getReader();
          return this._consumeUtf8XmlReader(gunzipReader, null, appendMode, maxSafeBytes);
        }

        // GZIP without DecompressionStream: collect chunks up to safe limit and decode via fallback
        const chunks = [firstChunk];
        let totalLen = firstChunk.byteLength;
        const readAll = () =>
          reader.read().then((next) => {
            if (next.done) {
              const merged = new Uint8Array(totalLen);
              let off = 0;
              for (let i = 0; i < chunks.length; i++) {
                merged.set(chunks[i], off);
                off += chunks[i].byteLength;
              }
              return this._decodeArrayBufferToXml(merged.buffer, maxSafeBytes, url).then((xmlText) =>
                xmlText && xmlText.length > 50 ? this.parseXMLTVAsync(xmlText, null, appendMode) : false
              );
            }
            if (next.value && next.value.byteLength) {
              totalLen += next.value.byteLength;
              if (totalLen > maxSafeBytes) {
                try {
                  reader.cancel();
                } catch (e) {}
                return false;
              }
              chunks.push(next.value);
            }
            return readAll();
          });
        return readAll();
      }

      return this._consumeUtf8XmlReader(reader, firstChunk, appendMode, maxSafeBytes);
    });
  }

  _consumeUtf8XmlReader(reader, initialChunk, appendMode, maxSafeBytes) {
    const ctx = this._xmltvStreamBegin(appendMode);
    const decoder = new TextDecoder('utf-8');
    let totalBytes = 0;
    let sliceStartMs = Date.now();
    let pendingFirst = initialChunk;

    return new Promise((resolve) => {
      const finish = () => {
        try {
          if (!ctx.failed && !ctx.zeroMatch) {
            const finalText = decoder.decode();
            if (finalText) {
              this._xmltvStreamFeed(ctx, finalText, true);
            } else if (ctx.buffer) {
              this._xmltvStreamFeed(ctx, '', true);
            }
          }
        } catch (e) {
          console.warn('XMLTV stream finish error:', e);
          ctx.failed = true;
        }
        ctx.buffer = '';
        resolve(this._xmltvFinish(ctx));
      };

      const cancelAndFinish = () => {
        try {
          const p = reader.cancel();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (e) {}
        finish();
      };

      const handleChunk = (chunkBytes) => {
        if (!chunkBytes || chunkBytes.byteLength === 0) return true;
        totalBytes += chunkBytes.byteLength;
        if (totalBytes > maxSafeBytes) {
          console.warn('EPG stream exceeded 35MB safe limit, stopping.');
          ctx.failed = true;
          return false;
        }
        const text = decoder.decode(chunkBytes, { stream: true });
        if (text) {
          this._xmltvStreamFeed(ctx, text, false);
        }
        return !ctx.zeroMatch && !ctx.failed;
      };

      const pump = () => {
        if (pendingFirst) {
          const chunk = pendingFirst;
          pendingFirst = null;
          let keepGoing = true;
          try {
            keepGoing = handleChunk(chunk);
          } catch (e) {
            console.warn('XMLTV stream chunk error:', e);
            ctx.failed = true;
            keepGoing = false;
          }
          if (!keepGoing) {
            cancelAndFinish();
            return;
          }
        }

        reader
          .read()
          .then((res) => {
            if (!res || res.done) {
              finish();
              return;
            }
            let keepGoing = true;
            try {
              keepGoing = handleChunk(res.value);
            } catch (e) {
              console.warn('XMLTV stream chunk error:', e);
              ctx.failed = true;
              keepGoing = false;
            }
            if (!keepGoing) {
              cancelAndFinish();
              return;
            }
            if (Date.now() - sliceStartMs >= 14) {
              sliceStartMs = Date.now();
              setTimeout(pump, 0);
            } else {
              pump();
            }
          })
          .catch((err) => {
            console.warn('XMLTV stream read error:', err);
            ctx.failed = true;
            finish();
          });
      };

      pump();
    });
  }

  /**
   * Fetches XMLTV from URL with hardware memory protection guards,
   * automatically decompresses if it is GZIP (.xml.gz).
   */
  fetchAndDecodeXMLTV(url) {
    if (!url) return Promise.resolve('');
    const MAX_SAFE_EPG_BYTES = 35 * 1024 * 1024;
    return this._fetchXmltvResponse(url)
      .then((res) => {
        if (!res) return null;
        const cl = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : null;
        if (cl && parseInt(cl, 10) > MAX_SAFE_EPG_BYTES) {
          console.warn('EPG feed exceeds TV memory safety limit (>35MB), aborting:', url);
          return null;
        }
        return res.arrayBuffer();
      })
      .then((buffer) => this._decodeArrayBufferToXml(buffer, MAX_SAFE_EPG_BYTES, url));
  }

  decodeXmlEntities(str) {
    if (!str) return '';
    if (str.indexOf('&') === -1 && str.indexOf('<') === -1) {
      return str.trim();
    }
    let out = str;
    if (out.indexOf('<![CDATA[') !== -1) {
      out = out.replace(CDATA_RE, '$1');
    }
    if (out.indexOf('&') !== -1) {
      out = out.replace(XML_ENTITY_RE, (m, named, dec, hex) => {
        if (named) return XML_ENTITY_MAP[named] || m;
        if (dec) return String.fromCharCode(parseInt(dec, 10));
        if (hex) return String.fromCharCode(parseInt(hex, 16));
        return m;
      });
    }
    return out.trim();
  }

  extractXmlAttr(attrs, attrName) {
    const nameLen = attrName.length;
    const len = attrs.length;
    let idx = attrs.indexOf(attrName);
    while (idx !== -1) {
      const prev = idx > 0 ? attrs.charCodeAt(idx - 1) : 32;
      if (prev <= 32) {
        let p = idx + nameLen;
        while (p < len && attrs.charCodeAt(p) <= 32) p++;
        if (p < len && attrs.charCodeAt(p) === 61) { // '='
          p++;
          while (p < len && attrs.charCodeAt(p) <= 32) p++;
          if (p < len) {
            const q = attrs.charCodeAt(p);
            if (q === 34 || q === 39) { // '"' or "'"
              const end = attrs.indexOf(q === 34 ? '"' : "'", p + 1);
              return end !== -1 ? attrs.slice(p + 1, end) : '';
            }
          }
        }
      }
      idx = attrs.indexOf(attrName, idx + 1);
    }
    return '';
  }

  extractXmlTagText(body, tagName) {
    const open = '<' + tagName;
    const openLen = open.length;
    let pos = body.indexOf(open);
    while (pos !== -1) {
      const nextChar = body.charCodeAt(pos + openLen);
      if (nextChar === 62 || nextChar <= 32) { // '>' or whitespace
        const gtIdx = body.indexOf('>', pos + openLen);
        if (gtIdx === -1) return '';
        const closeIdx = body.indexOf('</' + tagName + '>', gtIdx + 1);
        if (closeIdx === -1) return '';
        return body.slice(gtIdx + 1, closeIdx);
      }
      pos = body.indexOf(open, pos + openLen);
    }
    return '';
  }

  /**
   * High-speed, fault-tolerant XMLTV parser that extracts <channel> display-names and <programme> schedules.
   * Uses native indexOf scanning instead of backtracking regexes for minimal CPU & memory on webOS & Android TVs.
   *
   * Implemented as a resumable state machine (_xmltvBegin / _xmltvStep / _xmltvFinish) powering both:
   *  - parseXMLTV(xmlString, appendMode)                    : synchronous single-pass
   *  - parseXMLTVAsync(xmlText, filterChannels, appendMode) : yields every ~2000 <programme> blocks via setTimeout(..., 0)
   */
  parseXMLTV(xmlString, appendMode) {
    if (!xmlString || typeof xmlString !== 'string') return;
    let ctx = null;
    try {
      ctx = this._xmltvBegin(xmlString, appendMode);
      while (!this._xmltvStep(ctx, Infinity)) {
        // single synchronous pass
      }
    } catch (e) {
      console.warn('XMLTV parse error:', e);
      if (ctx) ctx.failed = true;
    }
    if (ctx) this._xmltvFinish(ctx);
  }

  /**
   * Async chunked XMLTV parser yielding every ~2000 <programme> blocks so 10MB XML feeds
   * never block the Android TV main thread for 600ms+.
   */
  parseXMLTVAsync(xmlText, filterChannelsOrAppend, appendModeArg) {
    if (!xmlText || typeof xmlText !== 'string') return Promise.resolve(false);
    let appendMode = Boolean(appendModeArg);
    if (Array.isArray(filterChannelsOrAppend)) {
      if (filterChannelsOrAppend.length > 0) {
        this.setTargetChannels(filterChannelsOrAppend);
      }
    } else if (typeof filterChannelsOrAppend === 'boolean') {
      appendMode = filterChannelsOrAppend;
    }

    let ctx = null;
    try {
      ctx = this._xmltvBegin(xmlText, appendMode);
    } catch (e) {
      console.warn('XMLTV parse error:', e);
      return Promise.resolve(false);
    }
    // Promptly drop caller parameter reference (ctx.xml is cleared in _xmltvFinish)
    xmlText = null;

    return new Promise((resolve) => {
      const CHUNK_BLOCKS = 2000;
      const run = () => {
        let done = false;
        try {
          done = this._xmltvStep(ctx, CHUNK_BLOCKS);
        } catch (e) {
          console.warn('XMLTV parse error:', e);
          ctx.failed = true;
          done = true;
        }
        if (!done) {
          setTimeout(run, 0);
          return;
        }
        resolve(this._xmltvFinish(ctx));
      };
      setTimeout(run, 0);
    });
  }

  _detachString(str) {
    if (!str || str.length === 0) return '';
    const len = str.length;
    if (len <= 1024) {
      const codes = new Array(len);
      for (let i = 0; i < len; i++) {
        codes[i] = str.charCodeAt(i);
      }
      return String.fromCharCode.apply(null, codes);
    }
    let out = '';
    for (let i = 0; i < len; i += 1024) {
      const end = i + 1024 < len ? i + 1024 : len;
      const codes = new Array(end - i);
      for (let j = i; j < end; j++) {
        codes[j - i] = str.charCodeAt(j);
      }
      out += String.fromCharCode.apply(null, codes);
    }
    return out;
  }

  _xmltvStreamBegin(appendMode) {
    this._ensureRuntimeCaches();
    const now = Date.now();
    const pastDays = typeof this.MAX_PARSE_PAST_DAYS === 'number' ? this.MAX_PARSE_PAST_DAYS : 8;
    const futureDays = typeof this.MAX_PARSE_FUTURE_DAYS === 'number' ? this.MAX_PARSE_FUTURE_DAYS : 4;
    return {
      xml: null,
      xmlLen: 0,
      buffer: '',
      blocksInChunk: 0,
      append: Boolean(appendMode),
      minAllowedTime: now - (pastDays * this.DAY_MS),
      maxAllowedTime: now + (futureDays * this.DAY_MS),
      hasFilter: Boolean(this.targetChannelKeys && this.targetChannelKeys.size > 0),
      matchedChannelIds: new Set(),
      progs: new Map(),
      aliasMap: new Map(),
      aliasCandidates: new Map(),
      phase: 'stream',
      chPos: -1,
      pPos: -1,
      channelBlocks: 0,
      programmeBlocks: 0,
      accepted: 0,
      zeroMatch: false,
      failed: false
    };
  }

  _xmltvProcessChannelBlock(ctx, chAttrs, chBody) {
    ctx.channelBlocks++;
    const rawId = this.extractXmlAttr(chAttrs, 'id');
    if (!rawId) return;
    const decodedId = this.decodeXmlEntities(rawId);
    if (!decodedId) return;
    const chId = this._detachString(decodedId);
    const hasFilter = ctx.hasFilter;
    const lowerId = chId.toLowerCase();
    let isMatch = !hasFilter || this.targetChannelKeys.has(lowerId);
    if (!isMatch && hasFilter) {
      const normId = this.normalizeChannelKey(chId);
      if (normId && this.targetChannelKeys.has(normId)) {
        isMatch = true;
      }
    }

    const displayNames = [];
    if (chBody) {
      let dnPos = chBody.indexOf('<display-name');
      while (dnPos !== -1) {
        const dnNext = chBody.charCodeAt(dnPos + 13);
        if (dnNext === 62 || dnNext <= 32) {
          const dnGt = chBody.indexOf('>', dnPos + 13);
          if (dnGt === -1) break;
          const dnClose = chBody.indexOf('</display-name>', dnGt + 1);
          if (dnClose === -1) break;
          const rawDisp = this.decodeXmlEntities(chBody.slice(dnGt + 1, dnClose));
          if (rawDisp) {
            const dispName = this._detachString(rawDisp);
            displayNames.push(dispName);
            if (!isMatch && hasFilter) {
              const lowerDisp = dispName.toLowerCase();
              if (this.targetChannelKeys.has(lowerDisp)) {
                isMatch = true;
              } else {
                const normDisp = this.normalizeChannelKey(dispName);
                if (normDisp && this.targetChannelKeys.has(normDisp)) {
                  isMatch = true;
                }
              }
            }
          }
          dnPos = chBody.indexOf('<display-name', dnClose + 15);
        } else {
          dnPos = chBody.indexOf('<display-name', dnPos + 13);
        }
      }
    }

    if (isMatch) {
      ctx.matchedChannelIds.add(chId);
      this.registerChannelAlias(chId, chId, ctx.aliasMap, ctx.aliasCandidates);
      for (let d = 0; d < displayNames.length; d++) {
        this.registerChannelAlias(displayNames[d], chId, ctx.aliasMap, ctx.aliasCandidates);
      }
    }
  }

  _xmltvProcessProgrammeBlock(ctx, attrs, body) {
    ctx.programmeBlocks++;
    const rawChannel = this.extractXmlAttr(attrs, 'channel');
    const startStr = this.extractXmlAttr(attrs, 'start');
    if (!rawChannel || !startStr) return;

    const decodedCh = this.decodeXmlEntities(rawChannel);
    if (!decodedCh) return;

    const hasFilter = ctx.hasFilter;
    let keepChannel = true;
    if (hasFilter && !ctx.matchedChannelIds.has(decodedCh)) {
      const lowerChId = decodedCh.toLowerCase();
      if (!this.targetChannelKeys.has(lowerChId)) {
        const normChId = this.normalizeChannelKey(decodedCh);
        if (!(normChId && this.targetChannelKeys.has(normChId))) {
          keepChannel = false;
        }
      }
    }
    if (!keepChannel) return;

    const startMs = this.parseDateMs(startStr);
    if (isNaN(startMs) || startMs < ctx.minAllowedTime || startMs > ctx.maxAllowedTime) {
      return;
    }

    const stopStr = this.extractXmlAttr(attrs, 'stop');
    const rawStopMs = stopStr ? this.parseDateMs(stopStr) : NaN;
    const stopMs = !isNaN(rawStopMs) && rawStopMs > startMs ? rawStopMs : startMs + 3600000;

    const rawTitle = body ? this.extractXmlTagText(body, 'title') : '';
    const rawDesc = body ? this.extractXmlTagText(body, 'desc') : '';
    const title = rawTitle ? this._detachString(this.decodeXmlEntities(rawTitle)) : 'שידור חי';
    let desc = rawDesc ? this._detachString(this.decodeXmlEntities(rawDesc)) : '';
    if (!desc && body) {
      const rawSub = this.extractXmlTagText(body, 'sub-title');
      if (rawSub) desc = this._detachString(this.decodeXmlEntities(rawSub));
    }

    const channelId = this._detachString(decodedCh);
    let list = ctx.progs.get(channelId);
    if (!list) {
      list = [];
      ctx.progs.set(channelId, list);
      this.registerChannelAlias(channelId, channelId, ctx.aliasMap, ctx.aliasCandidates);
    }

    list.push({
      id: channelId + '_' + startMs,
      title: title,
      desc: desc,
      startMs: startMs,
      stopMs: stopMs
    });
    ctx.accepted++;
  }

  _xmltvStreamFeed(ctx, chunkText, isFinal) {
    const MAX_TAIL_CHARS = 65536;
    const buf = ctx.buffer ? ctx.buffer + chunkText : chunkText;
    ctx.buffer = '';
    ctx.blocksInChunk = 0;

    let pos = 0;
    const len = buf.length;
    let nextCh = buf.indexOf('<channel', pos);
    let nextPr = buf.indexOf('<programme', pos);

    while (pos < len) {
      if (nextCh !== -1 && nextCh < pos) nextCh = buf.indexOf('<channel', pos);
      if (nextPr !== -1 && nextPr < pos) nextPr = buf.indexOf('<programme', pos);

      if (nextCh === -1 && nextPr === -1) {
        if (!isFinal) {
          const keepFrom = len - 16 > pos ? len - 16 : pos;
          ctx.buffer = this._detachString(buf.slice(keepFrom));
        }
        break;
      }

      const isChannel = nextCh !== -1 && (nextPr === -1 || nextCh < nextPr);
      const tagPos = isChannel ? nextCh : nextPr;
      const tagLen = isChannel ? 8 : 10;

      if (tagPos + tagLen >= len) {
        if (!isFinal) {
          ctx.buffer = this._detachString(buf.slice(tagPos));
        }
        break;
      }

      const afterTag = buf.charCodeAt(tagPos + tagLen);
      if (afterTag !== 62 && afterTag > 32) {
        pos = tagPos + tagLen;
        continue;
      }

      if (!isChannel && ctx.hasFilter && ctx.channelBlocks > 0 && ctx.matchedChannelIds.size === 0) {
        ctx.zeroMatch = true;
        ctx.buffer = '';
        return;
      }

      const openEnd = buf.indexOf('>', tagPos + tagLen);
      if (openEnd === -1) {
        if (!isFinal) {
          if (len - tagPos <= MAX_TAIL_CHARS) {
            ctx.buffer = this._detachString(buf.slice(tagPos));
          } else {
            ctx.buffer = this._detachString(buf.slice(len - 4096));
          }
        }
        break;
      }

      // Self-closing tag (e.g., <channel id="foo"/>)
      if (buf.charCodeAt(openEnd - 1) === 47) {
        const attrs = buf.slice(tagPos + tagLen, openEnd - 1);
        if (isChannel) {
          this._xmltvProcessChannelBlock(ctx, attrs, '');
        }
        ctx.blocksInChunk++;
        pos = openEnd + 1;
        continue;
      }

      const closeTag = isChannel ? '</channel>' : '</programme>';
      const closeIdx = buf.indexOf(closeTag, openEnd + 1);
      if (closeIdx === -1) {
        if (!isFinal) {
          if (len - tagPos > MAX_TAIL_CHARS) {
            // Malformed unclosed tag exceeding 64KB cap: skip past opening tag to bound RAM
            pos = openEnd + 1;
            continue;
          }
          ctx.buffer = this._detachString(buf.slice(tagPos));
        }
        break;
      }

      const attrs = buf.slice(tagPos + tagLen, openEnd);
      const body = buf.slice(openEnd + 1, closeIdx);
      if (isChannel) {
        this._xmltvProcessChannelBlock(ctx, attrs, body);
      } else {
        this._xmltvProcessProgrammeBlock(ctx, attrs, body);
      }
      ctx.blocksInChunk++;
      pos = closeIdx + closeTag.length;
    }
  }

  _xmltvBegin(xmlString, appendMode) {
    this._ensureRuntimeCaches();
    const now = Date.now();
    const pastDays = typeof this.MAX_PARSE_PAST_DAYS === 'number' ? this.MAX_PARSE_PAST_DAYS : 8;
    const futureDays = typeof this.MAX_PARSE_FUTURE_DAYS === 'number' ? this.MAX_PARSE_FUTURE_DAYS : 4;
    return {
      xml: xmlString,
      xmlLen: xmlString.length,
      append: Boolean(appendMode),
      minAllowedTime: now - (pastDays * this.DAY_MS),
      maxAllowedTime: now + (futureDays * this.DAY_MS),
      hasFilter: Boolean(this.targetChannelKeys && this.targetChannelKeys.size > 0),
      matchedChannelIds: new Set(),
      progs: new Map(),
      aliasMap: new Map(),
      aliasCandidates: new Map(),
      phase: 'channels',
      chPos: xmlString.indexOf('<channel'),
      pPos: -1,
      channelBlocks: 0,
      programmeBlocks: 0,
      accepted: 0,
      zeroMatch: false,
      failed: false
    };
  }

  _xmltvStep(ctx, budget) {
    const xmlString = ctx.xml;
    const hasFilter = ctx.hasFilter;
    let remaining = budget;

    // 1. Scan <channel id="..."> blocks and their <display-name> tags
    if (ctx.phase === 'channels') {
      let chPos = ctx.chPos;
      while (chPos !== -1) {
        if (remaining <= 0) {
          ctx.chPos = chPos;
          return false;
        }
        const afterTag = xmlString.charCodeAt(chPos + 8);
        if (afterTag === 62 || afterTag <= 32) {
          remaining--;
          const openEnd = xmlString.indexOf('>', chPos + 8);
          if (openEnd === -1) break;
          const closeIdx = xmlString.indexOf('</channel>', openEnd + 1);
          if (closeIdx === -1) break;
          ctx.channelBlocks++;

          const chAttrs = xmlString.slice(chPos + 8, openEnd);
          const rawId = this.extractXmlAttr(chAttrs, 'id');
          if (rawId) {
            const chId = this.decodeXmlEntities(rawId);
            if (chId) {
              const lowerId = chId.toLowerCase();
              let isMatch = !hasFilter || this.targetChannelKeys.has(lowerId);
              if (!isMatch && hasFilter) {
                const normId = this.normalizeChannelKey(chId);
                if (normId && this.targetChannelKeys.has(normId)) {
                  isMatch = true;
                }
              }

              const chBody = xmlString.slice(openEnd + 1, closeIdx);
              const displayNames = [];
              let dnPos = chBody.indexOf('<display-name');
              while (dnPos !== -1) {
                const dnNext = chBody.charCodeAt(dnPos + 13);
                if (dnNext === 62 || dnNext <= 32) {
                  const dnGt = chBody.indexOf('>', dnPos + 13);
                  if (dnGt === -1) break;
                  const dnClose = chBody.indexOf('</display-name>', dnGt + 1);
                  if (dnClose === -1) break;
                  const dispName = this.decodeXmlEntities(chBody.slice(dnGt + 1, dnClose));
                  if (dispName) {
                    displayNames.push(dispName);
                    if (!isMatch && hasFilter) {
                      const lowerDisp = dispName.toLowerCase();
                      if (this.targetChannelKeys.has(lowerDisp)) {
                        isMatch = true;
                      } else {
                        const normDisp = this.normalizeChannelKey(dispName);
                        if (normDisp && this.targetChannelKeys.has(normDisp)) {
                          isMatch = true;
                        }
                      }
                    }
                  }
                  dnPos = chBody.indexOf('<display-name', dnClose + 15);
                } else {
                  dnPos = chBody.indexOf('<display-name', dnPos + 13);
                }
              }

              if (isMatch) {
                ctx.matchedChannelIds.add(chId);
                this.registerChannelAlias(chId, chId, ctx.aliasMap, ctx.aliasCandidates);
                for (let d = 0; d < displayNames.length; d++) {
                  this.registerChannelAlias(displayNames[d], chId, ctx.aliasMap, ctx.aliasCandidates);
                }
              }
            }
          }
          chPos = xmlString.indexOf('<channel', closeIdx + 10);
        } else {
          chPos = xmlString.indexOf('<channel', chPos + 8);
        }
      }

      // Filter guard: when active channels filter is enabled and 0 <channel> tags matched,
      // return early instead of parsing all 30,816 programmes from all 263 channels into RAM!
      if (hasFilter && ctx.matchedChannelIds.size === 0 && ctx.channelBlocks > 0) {
        ctx.zeroMatch = true;
        ctx.phase = 'done';
        return true;
      }
      ctx.phase = 'programmes';
      ctx.pPos = xmlString.indexOf('<programme');
    }

    // 2. Scan <programme ...> blocks
    if (ctx.phase === 'programmes') {
      const matchedChannelIds = ctx.matchedChannelIds;
      const xmlLen = ctx.xmlLen;
      let pPos = ctx.pPos;
      while (pPos !== -1 && pPos < xmlLen) {
        if (remaining <= 0) {
          ctx.pPos = pPos;
          return false;
        }
        const afterTag = xmlString.charCodeAt(pPos + 10);
        if (afterTag === 62 || afterTag <= 32) {
          remaining--;
          ctx.programmeBlocks++;
          const openEnd = xmlString.indexOf('>', pPos + 10);
          if (openEnd === -1) break;
          const closeIdx = xmlString.indexOf('</programme>', openEnd + 1);
          if (closeIdx === -1) break;

          const attrs = xmlString.slice(pPos + 10, openEnd);
          const rawChannel = this.extractXmlAttr(attrs, 'channel');
          const startStr = this.extractXmlAttr(attrs, 'start');

          if (rawChannel && startStr) {
            const channelId = this.decodeXmlEntities(rawChannel);
            if (channelId) {
              // SYSTEMIC FILTER: Skip programmes for channels not in user's active playlist
              let keepChannel = true;
              if (hasFilter && !matchedChannelIds.has(channelId)) {
                const lowerChId = channelId.toLowerCase();
                if (!this.targetChannelKeys.has(lowerChId)) {
                  const normChId = this.normalizeChannelKey(channelId);
                  if (!(normChId && this.targetChannelKeys.has(normChId))) {
                    keepChannel = false;
                  }
                }
              }

              if (keepChannel) {
                const startMs = this.parseDateMs(startStr);
                if (!isNaN(startMs) && startMs >= ctx.minAllowedTime && startMs <= ctx.maxAllowedTime) {
                  const stopStr = this.extractXmlAttr(attrs, 'stop');
                  const rawStopMs = stopStr ? this.parseDateMs(stopStr) : NaN;
                  const stopMs = (!isNaN(rawStopMs) && rawStopMs > startMs) ? rawStopMs : startMs + 3600000;

                  const body = xmlString.slice(openEnd + 1, closeIdx);
                  const rawTitle = this.extractXmlTagText(body, 'title');
                  const rawDesc = this.extractXmlTagText(body, 'desc');
                  const title = rawTitle ? this.decodeXmlEntities(rawTitle) : 'שידור חי';
                  let desc = rawDesc ? this.decodeXmlEntities(rawDesc) : '';
                  if (!desc) {
                    const rawSub = this.extractXmlTagText(body, 'sub-title');
                    if (rawSub) desc = this.decodeXmlEntities(rawSub);
                  }

                  let list = ctx.progs.get(channelId);
                  if (!list) {
                    list = [];
                    ctx.progs.set(channelId, list);
                    this.registerChannelAlias(channelId, channelId, ctx.aliasMap, ctx.aliasCandidates);
                  }

                  list.push({
                    id: channelId + '_' + startMs,
                    title: title,
                    desc: desc,
                    startMs: startMs,
                    stopMs: stopMs
                  });
                  ctx.accepted++;
                }
              }
            }
          }
          pPos = xmlString.indexOf('<programme', closeIdx + 12);
        } else {
          pPos = xmlString.indexOf('<programme', pPos + 10);
        }
      }
      ctx.phase = 'done';
    }

    return true;
  }

  _sortDedupeProgrammes(list) {
    list.sort((a, b) => a.startMs - b.startMs);
    if (list.length <= 1) return list;
    const deduped = [list[0]];
    for (let i = 1; i < list.length; i++) {
      if (list[i].startMs !== list[i - 1].startMs) {
        deduped.push(list[i]);
      } else {
        const prev = deduped[deduped.length - 1];
        if ((list[i].desc || '').length > (prev.desc || '').length) {
          deduped[deduped.length - 1] = list[i];
        }
      }
    }
    return deduped;
  }

  _xmltvFinish(ctx) {
    ctx.xml = null; // Promptly release large temporary XML string reference
    try {
      this._ensureRuntimeCaches();
      this._lastParseHasLiveCoverage = false;
      if (ctx.progs.size === 0 && ctx.aliasMap.size === 0) {
        return false;
      }
      if (ctx.failed && ctx.progs.size === 0 && ctx.aliasMap.size === 0) {
        return false;
      }

      if (!this.channelAliasCandidates) this.channelAliasCandidates = new Map();

      if (!ctx.append) {
        this.programmesByChannel.clear();
        this.programmes = this.programmesByChannel;
        this.channelAliasMap.clear();
        this.channelAliasCandidates.clear();
      } else {
        this._purgeSyntheticChannels();
      }

      const nowMs = Date.now();
      const minStopMs = nowMs - 3600000;
      const maxStartMs = nowMs + 6 * 3600000;
      const pastDays = typeof this.MAX_PARSE_PAST_DAYS === 'number' ? this.MAX_PARSE_PAST_DAYS : 8;
      const futureDays = typeof this.MAX_PARSE_FUTURE_DAYS === 'number' ? this.MAX_PARSE_FUTURE_DAYS : 4;
      const pruneMinMs = nowMs - (pastDays * this.DAY_MS);
      const pruneMaxMs = nowMs + (futureDays * this.DAY_MS);
      let parsedHasLive = false;

      ctx.progs.forEach((list, chKey) => {
        const existing = ctx.append ? this.programmesByChannel.get(chKey) : null;
        let merged = existing && existing.length > 0 ? existing.concat(list) : list;
        if (ctx.append && merged.length > 0) {
          const pruned = [];
          for (let i = 0; i < merged.length; i++) {
            const p = merged[i];
            if (p && p.startMs >= pruneMinMs && p.startMs <= pruneMaxMs) {
              pruned.push(p);
            }
          }
          merged = pruned;
        }
        if (merged.length > 0) {
          this.programmesByChannel.set(chKey, this._sortDedupeProgrammes(merged));
        }
        if (!parsedHasLive) {
          for (let i = 0; i < list.length; i++) {
            const p = list[i];
            if (p && p.startMs <= maxStartMs && p.stopMs > minStopMs) {
              parsedHasLive = true;
              break;
            }
          }
        }
      });
      this._lastParseHasLiveCoverage = parsedHasLive;

      ctx.aliasMap.forEach((target, alias) => {
        this.channelAliasMap.set(alias, target);
      });
      if (ctx.aliasCandidates) {
        ctx.aliasCandidates.forEach((candList, alias) => {
          if (!Array.isArray(candList)) return;
          for (let i = 0; i < candList.length; i++) {
            this._addAliasCandidate(this.channelAliasCandidates, alias, candList[i]);
          }
        });
      }

      this._invalidateQueryCaches();
      this._purgeSyntheticChannels();
      return ctx.accepted > 0;
    } catch (e) {
      console.warn('XMLTV parse error:', e);
      return false;
    } finally {
      ctx.progs = null;
      ctx.aliasMap = null;
      ctx.aliasCandidates = null;
      ctx.matchedChannelIds = null;
    }
  }

  /**
   * Fast zero-regex XMLTV date parser returning epoch milliseconds.
   * Supports "YYYYMMDDHHMMSS +HHMM" or "YYYYMMDDHHMM +HHMM" or without timezone.
   */
  parseDateMs(str) {
    if (!str) return NaN;
    const s = str.trim();
    const len = s.length;
    if (len < 12) return NaN;

    const y = ((s.charCodeAt(0) - 48) * 1000) + ((s.charCodeAt(1) - 48) * 100) + ((s.charCodeAt(2) - 48) * 10) + (s.charCodeAt(3) - 48);
    const mo = ((s.charCodeAt(4) - 48) * 10) + (s.charCodeAt(5) - 48) - 1;
    const d = ((s.charCodeAt(6) - 48) * 10) + (s.charCodeAt(7) - 48);
    const h = ((s.charCodeAt(8) - 48) * 10) + (s.charCodeAt(9) - 48);
    const min = ((s.charCodeAt(10) - 48) * 10) + (s.charCodeAt(11) - 48);
    let sec = 0;
    let idx = 12;
    if (len >= 14 && s.charCodeAt(12) >= 48 && s.charCodeAt(12) <= 57 && s.charCodeAt(13) >= 48 && s.charCodeAt(13) <= 57) {
      sec = ((s.charCodeAt(12) - 48) * 10) + (s.charCodeAt(13) - 48);
      idx = 14;
    }

    while (idx < len && s.charCodeAt(idx) <= 32) idx++;
    if (idx + 4 < len) {
      const tzChar = s.charCodeAt(idx);
      if (tzChar === 43 || tzChar === 45) { // '+' or '-'
        const sign = tzChar === 45 ? -1 : 1;
        const tzH = ((s.charCodeAt(idx + 1) - 48) * 10) + (s.charCodeAt(idx + 2) - 48);
        const tzM = ((s.charCodeAt(idx + 3) - 48) * 10) + (s.charCodeAt(idx + 4) - 48);
        const offsetMs = sign * ((tzH * 60) + tzM) * 60000;
        return Date.UTC(y, mo, d, h, min, sec) - offsetMs;
      }
    }

    return new Date(y, mo, d, h, min, sec).getTime();
  }

  /**
   * Parses XMLTV date string: "20261109143000 +0200" or "20261109123000 +0000" or "20261109143000"
   * Respects timezone offset when provided so programmes align with the TV's local clock!
   */
  parseDate(str) {
    const ms = this.parseDateMs(str);
    return isNaN(ms) ? new Date() : new Date(ms);
  }

  _getChannelMatchLru(cacheKey) {
    if (!cacheKey || !this._channelMatchCache || !this._channelMatchCache.has(cacheKey)) {
      return undefined;
    }
    const val = this._channelMatchCache.get(cacheKey);
    // Refresh MRU order
    this._channelMatchCache.delete(cacheKey);
    this._channelMatchCache.set(cacheKey, val);
    return val;
  }

  _setChannelMatchLru(cacheKey, targetId) {
    if (!cacheKey) return;
    this._ensureRuntimeCaches();
    const maxEntries = typeof this.MAX_ALIAS_CACHE_SIZE === 'number' ? this.MAX_ALIAS_CACHE_SIZE : 512;
    if (this._channelMatchCache.has(cacheKey)) {
      this._channelMatchCache.delete(cacheKey);
    } else if (this._channelMatchCache.size >= maxEntries) {
      const oldestKey = this._channelMatchCache.keys().next().value;
      if (oldestKey !== undefined) {
        this._channelMatchCache.delete(oldestKey);
      }
    }
    this._channelMatchCache.set(cacheKey, targetId);
  }

  /**
   * Resolves a channel object to its XMLTV programme list by inspecting all candidate XMLTV IDs
   * across exact IDs, display-names, and normalized/synonym keys, preferring live coverage.
   */
  findXmlProgrammesForChannel(channel) {
    if (!channel || this.programmesByChannel.size === 0) return null;
    this._ensureRuntimeCaches();

    const nowMs = Date.now();
    const cacheKey = channel.id || channel.uid || '';
    const cachedTarget = cacheKey ? this._getChannelMatchLru(cacheKey) : undefined;
    if (cachedTarget !== undefined) {
      if (!cachedTarget) return null;
      const cachedList = this.programmesByChannel.get(cachedTarget) || null;
      if (cachedList && cachedList.length > 0) {
        const lastP = cachedList[cachedList.length - 1];
        if (lastP && lastP.stopMs > nowMs) {
          return cachedList;
        }
      }
    }

    const candidates = [
      channel.epgId,
      channel.tvgName,
      channel.rawName,
      channel.name,
      channel.id
    ];

    const seenIds = new Set();
    let bestId = '';
    let bestList = null;
    let bestHasLive = false;
    let bestExactTier = 999;
    let bestLastStop = -1;
    let bestLen = -1;

    const considerCandidate = (xmlId, exactTier) => {
      if (!xmlId || seenIds.has(xmlId)) return;
      seenIds.add(xmlId);
      const list = this.programmesByChannel.get(xmlId);
      if (!list || list.length === 0) return;

      const hasLive = this.findCurrentProgrammeIndex(list, nowMs) !== -1;
      const lastP = list[list.length - 1];
      const lastStop = lastP && typeof lastP.stopMs === 'number' ? lastP.stopMs : 0;
      const len = list.length;

      if (!bestList) {
        bestId = xmlId;
        bestList = list;
        bestHasLive = hasLive;
        bestExactTier = exactTier;
        bestLastStop = lastStop;
        bestLen = len;
        return;
      }

      if (hasLive !== bestHasLive) {
        if (hasLive) {
          bestId = xmlId;
          bestList = list;
          bestHasLive = hasLive;
          bestExactTier = exactTier;
          bestLastStop = lastStop;
          bestLen = len;
        }
        return;
      }

      if (exactTier !== bestExactTier) {
        if (exactTier < bestExactTier) {
          bestId = xmlId;
          bestList = list;
          bestHasLive = hasLive;
          bestExactTier = exactTier;
          bestLastStop = lastStop;
          bestLen = len;
        }
        return;
      }

      if (lastStop > bestLastStop || (lastStop === bestLastStop && len > bestLen)) {
        bestId = xmlId;
        bestList = list;
        bestHasLive = hasLive;
        bestExactTier = exactTier;
        bestLastStop = lastStop;
        bestLen = len;
      }
    };

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!c || typeof c !== 'string') continue;
      const trimmed = c.trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();

      // 1. Direct match
      if (this.programmesByChannel.has(trimmed)) {
        considerCandidate(trimmed, i);
      }

      // 2. Alias candidates (exact or lowercase)
      const exactCands = this.channelAliasCandidates.get(trimmed);
      if (exactCands) {
        for (let k = 0; k < exactCands.length; k++) {
          considerCandidate(exactCands[k], exactCands[k] === trimmed ? i : 50 + i);
        }
      }
      const lowerCands = this.channelAliasCandidates.get(lower);
      if (lowerCands) {
        for (let k = 0; k < lowerCands.length; k++) {
          considerCandidate(lowerCands[k], lowerCands[k].toLowerCase() === lower ? i : 50 + i);
        }
      }
      const aliasTarget = this.channelAliasMap.get(trimmed) || this.channelAliasMap.get(lower);
      if (aliasTarget) {
        considerCandidate(aliasTarget, 50 + i);
      }

      // 3. Normalized fuzzy / synonym alias candidates
      const norm = this.normalizeChannelKey(trimmed);
      if (norm) {
        if (this.programmesByChannel.has(norm)) {
          considerCandidate(norm, 100 + i);
        }
        const normCands = this.channelAliasCandidates.get(norm);
        if (normCands) {
          for (let k = 0; k < normCands.length; k++) {
            considerCandidate(normCands[k], 100 + i);
          }
        }
        const normTarget = this.channelAliasMap.get(norm);
        if (normTarget) {
          considerCandidate(normTarget, 100 + i);
        }
      }
    }

    if (cacheKey) this._setChannelMatchLru(cacheKey, bestId);
    return bestList;
  }

  _getCachedSyntheticSevenDaySchedule(channel) {
    if (!channel) return [];
    const cacheKey = 'gen_' + (channel.id || channel.name || 'tv');
    if (!this._syntheticScheduleCache) this._syntheticScheduleCache = new Map();
    if (this._syntheticScheduleCache.has(cacheKey)) {
      return this._syntheticScheduleCache.get(cacheKey);
    }
    const generated = this.generateSevenDaySchedule(channel);
    // Strict LRU/FIFO bound (max 5 channels) so 7-day synthetic schedules never grow unbounded in RAM
    if (this._syntheticScheduleCache.size >= 5) {
      const oldestKey = this._syntheticScheduleCache.keys().next().value;
      if (oldestKey !== undefined) {
        this._syntheticScheduleCache.delete(oldestKey);
      }
    }
    this._syntheticScheduleCache.set(cacheKey, generated);
    return generated;
  }

  /**
   * Returns complete 7-day + today schedule for a channel (lazily generated for 7-day guide modal / catch-up).
   */
  getChannelProgrammes(channel) {
    if (!channel) return [];
    const xmlList = this.findXmlProgrammesForChannel(channel);
    const nowMs = Date.now();
    if (xmlList && xmlList.length > 0) {
      const lastProg = xmlList[xmlList.length - 1];
      if (lastProg && lastProg.stopMs && lastProg.stopMs >= nowMs) {
        return xmlList;
      }
      // If XML feed has expired past programmes, keep the past history for Start-Over / Catch-up
      // and seamlessly append generated future programmes so current & next are always populated
      const generated = this._getCachedSyntheticSevenDaySchedule(channel);
      const futureGen = generated.filter((p) => p.startMs >= (lastProg ? lastProg.stopMs : nowMs));
      return xmlList.concat(futureGen);
    }

    return this._getCachedSyntheticSevenDaySchedule(channel);
  }

  /**
   * O(log P) binary search over sorted programme arrays for the programme covering targetMs.
   */
  findProgrammeIndexAt(list, targetMs) {
    if (!list || list.length === 0 || typeof targetMs !== 'number' || !isFinite(targetMs)) return -1;
    let lo = 0;
    let hi = list.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const p = list[mid];
      const pStart = typeof p.startMs === 'number' ? p.startMs : p.start;
      const pStop = typeof p.stopMs === 'number' ? p.stopMs : p.stop;
      if (targetMs < pStart) {
        hi = mid - 1;
      } else if (targetMs >= pStop) {
        lo = mid + 1;
      } else {
        return mid;
      }
    }
    return -1;
  }

  _findLowerBoundStartMs(list, targetStartMs) {
    if (!list || list.length === 0) return 0;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const p = list[mid];
      const pStart = typeof p.startMs === 'number' ? p.startMs : p.start;
      if (pStart < targetStartMs) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  findCurrentProgrammeIndex(list, nowMs) {
    return this.findProgrammeIndexAt(list, nowMs);
  }

  /**
   * O(log P) lookup for the current live programme of a channel.
   */
  getCurrentProgramme(channel, nowMs) {
    if (!channel) return null;
    const refMs = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
    const xmlList = this.findXmlProgrammesForChannel(channel);
    if (xmlList && xmlList.length > 0) {
      const idx = this.findProgrammeIndexAt(xmlList, refMs);
      if (idx !== -1) {
        const cur = xmlList[idx];
        return {
          id: cur.id,
          title: cur.title,
          desc: cur.desc || 'שידור ישיר בערוץ.',
          startMs: cur.startMs,
          stopMs: cur.stopMs,
          startStr: this.formatTimeCached(cur.startMs),
          stopStr: this.formatTimeCached(cur.stopMs),
          status: 'live'
        };
      }
    }
    const nn = this.computeSyntheticNowNext(channel, refMs);
    return nn ? nn.current : null;
  }

  _getSyntheticScheduleParams(channel) {
    const seed = this.channelSeed(channel);
    const offsetsMin = [0, 0, 15, 30, 10, 20, 45];
    const durationMinOptions = [60, 45, 60, 90, 60];
    return {
      seed: seed,
      lineup: this.getChannelLineupPool(channel),
      startOffsetMs: offsetsMin[seed % offsetsMin.length] * 60000,
      slotDurationMs: durationMinOptions[seed % durationMinOptions.length] * 60000
    };
  }

  _buildSyntheticSlot(channel, params, dayStartMs, slotIdx) {
    const startMs = dayStartMs + (slotIdx * params.slotDurationMs);
    const stopMs = startMs + params.slotDurationMs;
    const startHour = new Date(startMs).getHours();
    const progInfo = this.pickProgrammeFromPool(params.lineup, startHour, slotIdx + params.seed);
    return {
      id: (channel.id || 'ch') + '_' + startMs,
      title: progInfo.title,
      desc: progInfo.desc,
      startMs: startMs,
      stopMs: stopMs
    };
  }

  /**
   * Computes ONLY Previous + Current + Next synthetic slots on-the-fly with ZERO caching in programmesByChannel.
   */
  computeSyntheticNowNext(channel, nowMs) {
    if (!channel) return null;
    const refMs = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
    const now = new Date(refMs);
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const params = this._getSyntheticScheduleParams(channel);
    const dayStartMs = todayMidnight + params.startOffsetMs;
    const slotIdx = Math.floor((refMs - dayStartMs) / params.slotDurationMs);

    const prev = this._buildSyntheticSlot(channel, params, dayStartMs, slotIdx - 1);
    const cur = this._buildSyntheticSlot(channel, params, dayStartMs, slotIdx);
    const next = this._buildSyntheticSlot(channel, params, dayStartMs, slotIdx + 1);

    const totalDuration = Math.max(1, cur.stopMs - cur.startMs);
    const elapsed = Math.max(0, refMs - cur.startMs);
    const progress = Math.min(100, Math.round((elapsed / totalDuration) * 100));
    const remainingMin = Math.max(1, Math.ceil((cur.stopMs - refMs) / 60000));

    return {
      previous: {
        id: prev.id,
        title: prev.title,
        desc: prev.desc,
        startStr: this.formatTimeCached(prev.startMs),
        stopStr: this.formatTimeCached(prev.stopMs),
        startMs: prev.startMs,
        stopMs: prev.stopMs
      },
      current: {
        id: cur.id,
        title: cur.title,
        desc: cur.desc || 'שידור ישיר בערוץ.',
        start: new Date(cur.startMs),
        stop: new Date(cur.stopMs),
        startMs: cur.startMs,
        stopMs: cur.stopMs,
        startStr: this.formatTimeCached(cur.startMs),
        stopStr: this.formatTimeCached(cur.stopMs),
        progressPercent: progress,
        remainingMin: remainingMin,
        status: 'live'
      },
      next: {
        id: next.id,
        title: next.title,
        desc: next.desc,
        startStr: this.formatTimeCached(next.startMs),
        stopStr: this.formatTimeCached(next.stopMs),
        startMs: next.startMs,
        stopMs: next.stopMs
      }
    };
  }

  /**
   * Computes ONLY the 5-slot Mini Timeline (2 prev + live + 2 next) on-the-fly with ZERO 7-day allocation.
   */
  computeSyntheticMiniTimeline(channel, nowMs) {
    if (!channel) return [];
    const refMs = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
    const now = new Date(refMs);
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const params = this._getSyntheticScheduleParams(channel);
    const dayStartMs = todayMidnight + params.startOffsetMs;
    const slotIdx = Math.floor((refMs - dayStartMs) / params.slotDurationMs);

    const slice = [];
    for (let offset = -2; offset <= 2; offset++) {
      const p = this._buildSyntheticSlot(channel, params, dayStartMs, slotIdx + offset);
      const status = offset < 0 ? 'past' : offset === 0 ? 'live' : 'upcoming';
      slice.push({
        id: p.id,
        title: p.title,
        desc: p.desc,
        start: new Date(p.startMs),
        stop: new Date(p.stopMs),
        startMs: p.startMs,
        stopMs: p.stopMs,
        startStr: this.formatTimeCached(p.startMs),
        stopStr: this.formatTimeCached(p.stopMs),
        status: status,
        canStartOver: status === 'past' || status === 'live'
      });
    }
    return slice;
  }

  /**
   * Returns Previous, Current & Next programme using O(log P) binary search + 15-second memoization cache
   * keyed by channel + 15s bucket (automatically invalidated on EPG reload).
   */
  getNowNext(channel, nowMsOpt) {
    if (!channel) return null;
    this._ensureRuntimeCaches();
    const nowMs = typeof nowMsOpt === 'number' && isFinite(nowMsOpt) ? nowMsOpt : Date.now();
    const chKey = (channel.id || channel.uid || '') + '|' + (channel.epgId || '') + '|' + (channel.name || '');
    const bucket15s = Math.floor(nowMs / 15000);
    const memoKey = chKey + '|' + bucket15s + '|' + this._epgCacheEpoch;

    const cached = this._nowNextCache.get(memoKey);
    if (cached && cached.current && nowMs >= cached.current.startMs && nowMs < cached.current.stopMs) {
      return cached;
    }

    let result = null;
    const xmlList = this.findXmlProgrammesForChannel(channel);
    if (xmlList && xmlList.length > 0) {
      const currentIdx = this.findProgrammeIndexAt(xmlList, nowMs);

      if (currentIdx !== -1) {
        const prev = currentIdx > 0 ? xmlList[currentIdx - 1] : null;
        const current = xmlList[currentIdx];
        const next = xmlList[currentIdx + 1] || null;
        const totalDuration = Math.max(1, current.stopMs - current.startMs);
        const elapsed = Math.max(0, nowMs - current.startMs);
        const progress = Math.min(100, Math.round((elapsed / totalDuration) * 100));
        const remainingMin = Math.max(1, Math.ceil((current.stopMs - nowMs) / 60000));

        result = {
          previous: prev
            ? {
                id: prev.id,
                title: prev.title,
                desc: prev.desc,
                startStr: this.formatTimeCached(prev.startMs),
                stopStr: this.formatTimeCached(prev.stopMs),
                startMs: prev.startMs,
                stopMs: prev.stopMs
              }
            : null,
          current: {
            id: current.id,
            title: current.title,
            desc: current.desc || 'שידור ישיר בערוץ.',
            start: current.start || new Date(current.startMs),
            stop: current.stop || new Date(current.stopMs),
            startMs: current.startMs,
            stopMs: current.stopMs,
            startStr: this.formatTimeCached(current.startMs),
            stopStr: this.formatTimeCached(current.stopMs),
            progressPercent: progress,
            remainingMin: remainingMin,
            status: 'live'
          },
          next: next
            ? {
                id: next.id,
                title: next.title,
                desc: next.desc,
                startStr: this.formatTimeCached(next.startMs),
                stopStr: this.formatTimeCached(next.stopMs),
                startMs: next.startMs,
                stopMs: next.stopMs
              }
            : null
        };
      }
    }

    if (!result) {
      result = this.computeSyntheticNowNext(channel, nowMs);
    }

    if (this._nowNextCache.size >= 512) {
      this._nowNextCache.clear();
    }
    this._nowNextCache.set(memoKey, result);
    return result;
  }

  _formatAdjacentItem(p) {
    if (!p) return null;
    return {
      id: p.id,
      title: p.title,
      desc: p.desc,
      startMs: p.startMs,
      stopMs: p.stopMs,
      startStr: this.formatTimeCached(p.startMs),
      stopStr: this.formatTimeCached(p.stopMs)
    };
  }

  /**
   * Returns the next programme for a channel covering (afterMs + 1000) or starting >= (afterMs - 5000).
   */
  getNextProgrammeForChannel(channel, afterMs) {
    if (!channel) return null;
    const list = this.getChannelProgrammes(channel);
    if (!list || list.length === 0) return null;

    const refMs = typeof afterMs === 'number' && isFinite(afterMs) ? afterMs : Date.now();
    let target = null;
    const idx = this.findProgrammeIndexAt(list, refMs + 1000);
    if (idx !== -1) {
      target = list[idx];
    } else {
      const startScan = this._findLowerBoundStartMs(list, refMs - 5000);
      for (let i = startScan; i < list.length; i++) {
        if (list[i].startMs >= refMs - 5000 && (!list[i].stopMs || list[i].stopMs > refMs)) {
          target = list[i];
          break;
        }
      }
    }

    if (!target) return null;

    return {
      id: target.id,
      title: target.title,
      desc: target.desc || 'שידור ישיר בערוץ.',
      start: target.start || new Date(target.startMs),
      stop: target.stop || new Date(target.stopMs),
      startMs: target.startMs,
      stopMs: target.stopMs,
      startStr: this.formatTimeCached(target.startMs),
      stopStr: this.formatTimeCached(target.stopMs),
      status: target.stopMs <= Date.now() ? 'past' : 'live'
    };
  }

  /**
   * Returns Previous and Next programmes relative to a specific Start-Over target programme.
   */
  getAdjacentProgrammesForProgramme(channel, targetProg) {
    if (!channel || !targetProg) return null;
    const list = this.getChannelProgrammes(channel);
    if (!list || list.length === 0) return null;

    const targetStartMs =
      typeof targetProg.startMs === 'number'
        ? targetProg.startMs
        : targetProg.start
        ? new Date(targetProg.start).getTime()
        : NaN;

    let idx = -1;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if ((targetProg.id && p.id === targetProg.id) || (!isNaN(targetStartMs) && p.startMs === targetStartMs)) {
        idx = i;
        break;
      }
    }

    if (idx === -1 && !isNaN(targetStartMs)) {
      idx = this.findProgrammeIndexAt(list, targetStartMs + 1000);
    }

    if (idx === -1) return null;

    return {
      previous: idx > 0 ? this._formatAdjacentItem(list[idx - 1]) : null,
      current: targetProg,
      next: idx + 1 < list.length ? this._formatAdjacentItem(list[idx + 1]) : null
    };
  }

  /**
   * Returns a compact Mini Timeline around Now:
   * 2 Previous programmes (for instant Start-Over) + 1 Current Live + 2 Upcoming programmes
   */
  getMiniTimeline(channel) {
    if (!channel) return [];
    const nowMs = Date.now();
    const xmlList = this.findXmlProgrammesForChannel(channel);
    const currentIdx = xmlList && xmlList.length > 0 ? this.findProgrammeIndexAt(xmlList, nowMs) : -1;

    if (currentIdx === -1) {
      return this.computeSyntheticMiniTimeline(channel, nowMs);
    }

    const startIdx = Math.max(0, currentIdx - 2);
    const endIdx = Math.min(xmlList.length - 1, currentIdx + 2);
    const slice = [];

    for (let i = startIdx; i <= endIdx; i++) {
      const p = xmlList[i];
      let status = 'upcoming';
      if (i < currentIdx) status = 'past';
      else if (i === currentIdx) status = 'live';

      slice.push({
        id: p.id,
        title: p.title,
        desc: p.desc,
        start: p.start || new Date(p.startMs),
        stop: p.stop || new Date(p.stopMs),
        startMs: p.startMs,
        stopMs: p.stopMs,
        startStr: this.formatTimeCached(p.startMs),
        stopStr: this.formatTimeCached(p.stopMs),
        status: status,
        canStartOver: status === 'past' || status === 'live'
      });
    }

    return slice;
  }

  /**
   * Returns an array of up to 8 Day Buckets (Today + 7 Days Back) for fast Day-by-Day Guide Zapping.
   */
  getChannelGuideByDays(channel) {
    if (!channel) return [];
    const now = new Date();
    const nowMs = now.getTime();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();

    const list = this.getChannelProgrammes(channel);
    const dayNames = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'שבת'];
    const days = [];

    for (let offset = 0; offset <= this.MAX_PAST_DAYS; offset++) {
      const dayStartMs = todayMidnight - (offset * this.DAY_MS);
      const dayEndMs = dayStartMs + this.DAY_MS;
      const dateObj = new Date(dayStartMs);

      const dd = ('0' + dateObj.getDate()).slice(-2);
      const mm = ('0' + (dateObj.getMonth() + 1)).slice(-2);
      const shortDate = dd + '/' + mm;

      let label = dayNames[dateObj.getDay()] + ' ' + shortDate;
      if (offset === 0) label = 'היום (' + shortDate + ')';
      else if (offset === 1) label = 'אתמול (' + shortDate + ')';

      const dayProgs = [];
      const startIdx = this._findLowerBoundStartMs(list, dayStartMs);
      for (let i = startIdx; i < list.length; i++) {
        const p = list[i];
        if (p.startMs >= dayEndMs) break;
        if (p.startMs >= dayStartMs) {
          let status = 'upcoming';
          if (p.stopMs <= nowMs) status = 'past';
          else if (p.startMs <= nowMs && p.stopMs > nowMs) status = 'live';

          dayProgs.push({
            id: p.id,
            title: p.title,
            desc: p.desc,
            start: p.start || new Date(p.startMs),
            stop: p.stop || new Date(p.stopMs),
            startMs: p.startMs,
            stopMs: p.stopMs,
            startStr: this.formatTimeCached(p.startMs),
            stopStr: this.formatTimeCached(p.stopMs),
            status: status,
            canStartOver: status === 'past' || status === 'live'
          });
        }
      }

      days.push({
        offset: offset,
        label: label,
        shortDate: shortDate,
        isToday: offset === 0,
        programmes: dayProgs
      });
    }

    return days;
  }

  /**
   * Generates a realistic, varied 7-day + today schedule when an M3U channel has no external XMLTV match,
   * using channel-specific time offsets and programme lineups so channels have realistic titles and varied progress bars.
   */
  generateSevenDaySchedule(channel) {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const lineup = this.getChannelLineupPool(channel);
    const result = [];

    // Deterministic per-channel minute offset (0, 10, 15, 20, 30, 45) so not all channels start/end at :00!
    const seed = this.channelSeed(channel);
    const offsetsMin = [0, 0, 15, 30, 10, 20, 45];
    const durationMinOptions = [60, 45, 60, 90, 60];
    const startOffsetMs = offsetsMin[seed % offsetsMin.length] * 60000;
    const slotDurationMs = durationMinOptions[seed % durationMinOptions.length] * 60000;

    for (let dayOffset = this.MAX_PAST_DAYS; dayOffset >= -1; dayOffset--) {
      const dayStartMs = todayMidnight - (dayOffset * this.DAY_MS) + startOffsetMs;
      const stepMs = dayOffset <= 0 ? slotDurationMs : 7200000;
      const slotsPerDay = Math.floor(this.DAY_MS / stepMs);

      for (let s = 0; s < slotsPerDay; s++) {
        const startMs = dayStartMs + (s * stepMs);
        const stopMs = startMs + stepMs;
        const startHour = new Date(startMs).getHours();
        const progInfo = this.pickProgrammeFromPool(lineup, startHour, s + seed);

        result.push({
          id: channel.id + '_' + startMs,
          title: progInfo.title,
          desc: progInfo.desc,
          startMs: startMs,
          stopMs: stopMs
        });
      }
    }

    return result;
  }

  channelSeed(channel) {
    const str = (channel && (channel.name || channel.id)) || 'tv';
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) & 0x7fffffff;
    }
    return h;
  }

  getChannelLineupPool(channel) {
    const chName = (channel && channel.name) || 'הערוץ';
    const lowerName = chName.toLowerCase();
    const chGroup = ((channel && channel.group) || '').toLowerCase();

    if (
      chGroup.indexOf('ספורט') !== -1 ||
      chGroup.indexOf('sport') !== -1 ||
      lowerName.indexOf('sport') !== -1 ||
      lowerName.indexOf('5stars') !== -1 ||
      lowerName.indexOf('5plus') !== -1 ||
      lowerName.indexOf('5live') !== -1 ||
      lowerName.indexOf('ספורט') !== -1 ||
      lowerName.indexOf('one') !== -1
    ) {
      return [
        { title: 'בוקר ספורט - מהדורה מוקדמת', desc: 'פתיחת יום עם תקצירי משחקי הלילה, כותרות הספורט מהארץ ומהעולם וראיונות.' },
        { title: 'מגזין ספורט עולמי', desc: 'סיקור נרחב של אירועי הספורט הגדולים, תקצירים מליגות בכירות וכתבות צבע מיוחדות.' },
        { title: 'אולפן ליגת האלופות והכדורגל האירופי', desc: 'מיטב השערים, הניתוחים הטקטיים וההכנות למשחקי השבוע באירופה.' },
        { title: 'משחק מרכזי ישיר: שידור חי', desc: 'אולפן המשחק המרכזי עם מיטב השדרים והפרשנים, ניתוח המהלכים וראיונות מהמגרש.' },
        { title: 'חדשות הספורט - המהדורה המרכזית', desc: 'סיכום כל משחקי היום, שערי המחזור, טבלאות ופאנל הפרשנים של הערוץ.' },
        { title: 'יציע העיתונות - פאנל ספורט', desc: 'דיונים סוערים ופרשנויות על כל הנושאים הבוערים בספורט הישראלי והעולמי.' }
      ];
    }

    if (
      chGroup.indexOf('חדשות') !== -1 ||
      chGroup.indexOf('news') !== -1 ||
      lowerName.indexOf('11') !== -1 ||
      lowerName.indexOf('12') !== -1 ||
      lowerName.indexOf('13') !== -1 ||
      lowerName.indexOf('14') !== -1 ||
      lowerName.indexOf('channel 9') !== -1 ||
      lowerName.indexOf('i24') !== -1 ||
      lowerName.indexOf('news') !== -1 ||
      lowerName.indexOf('knesset') !== -1
    ) {
      return [
        { title: 'חדשות הבוקר - פותחים יום', desc: 'כל הדיווחים הראשונים, מבזקי תנועה, סקירת עיתונות ומזג האוויר באולפן פתוח.' },
        { title: 'משדר היום - אקטואליה וחדשות', desc: 'דיווחים ישירים ממוקדי ההתרחשויות, פרשנים באולפן וראיונות מיוחדים.' },
        { title: 'יומן הצהריים ואקטואליה', desc: 'סיכום אירועי הבוקר והצהריים מהארץ ומהעולם עם כתבי החדשות בשטח.' },
        { title: 'חמש עם - רצועת האקטואליה', desc: 'כל הכותרות המרכזיות של אחר הצהריים, כלכלה, ביטחון וצרכנות.' },
        { title: 'מהדורת החדשות המרכזית', desc: 'כל הכותרות, הדיווחים הבלעדיים, הפרשנויות מהשטח וכתבות תחקיר מיוחדות של כתבי המערכת.' },
        { title: 'אולפן הלילה - היום שהיה', desc: 'דיוני עומק, ראיונות וכל מה שקורה מאחורי הקלעים של סדר היום הציבורי.' }
      ];
    }

    if (
      lowerName.indexOf('comedy') !== -1 ||
      lowerName.indexOf('קומדי') !== -1 ||
      chGroup.indexOf('בידור') !== -1 ||
      chGroup.indexOf('סרטים') !== -1 ||
      chGroup.indexOf('סדרות') !== -1
    ) {
      return [
        { title: 'מופע סטנדאפ מרכזי', desc: 'מיטב הקומיקאים ואמני הסטנדאפ במופע קורע מצחוק.' },
        { title: 'סיטקום קומי - פרקים נבחרים', desc: 'הקומדיות האהובות והמוכרות ברצף פרקים מיוחד.' },
        { title: 'סדרת דרמה קומית יומית', desc: 'פרק מרתק ושנון בסדרה היומית האהובה בכיכובם של מיטב השחקנים.' },
        { title: 'סרט הערב: קומדיה ופעולה', desc: 'שובר קופות עטור שבחים בהקרנה מיוחדת לצופי הערוץ באיכות Full HD.' },
        { title: 'לילה של צחוק - מערכונים', desc: 'לקט מערכונים ותוכניות בידור נבחרות אל תוך הלילה.' }
      ];
    }

    if (lowerName.indexOf('24') !== -1 || chGroup.indexOf('מוזיקה') !== -1 || lowerName.indexOf('music') !== -1) {
      return [
        { title: 'להיטי הבוקר - מוזיקה ישראלית', desc: 'השירים האהובים ביותר מכל הזמנים לפתיחת היום באנרגיה טובה.' },
        { title: 'מצעד הלהיטים הרשמי', desc: 'השירים החמים והמושמעים ביותר השבוע בישראל ובעולם.' },
        { title: 'אולפן חי - הופעות ואירוח מוזיקלי', desc: 'מיטב האמנים והיוצרים בביצועים חיים וראיונות מיוחדים באולפן.' },
        { title: 'קליפים חדשים בבכורה', desc: 'כל הסינגלים והקליפים החדשים שיצאו השבוע במוזיקה הים-תיכונית והישראלית.' }
      ];
    }

    if (lowerName.indexOf('good life') !== -1 || lowerName.indexOf('החיים הטובים') !== -1 || chGroup.indexOf('לייף') !== -1) {
      return [
        { title: 'מסע קולינרי מסביב לעולם', desc: 'השפים המובילים יוצאים לגלות טעמים, שווקים ומתכונים מיוחדים ברחבי העולם.' },
        { title: 'עיצוב הבית ואדריכלות מודרנית', desc: 'הצצה לבתים המעוצבים ביותר, טיפים לשדרוג הסלון ופתרונות עיצוב חכמים.' },
        { title: 'יעדים קסומים - מגזין תיירות ונופש', desc: 'המלצות לחופשות הבאות, מלונות בוטיק, טבע ותרבות באירופה ובמזרח.' },
        { title: 'בריאות, כושר ואיכות חיים', desc: 'תוכנית האירוח המרכזית לתזונה נכונה, איזון ואורח חיים בריא.' }
      ];
    }

    if (
      chGroup.indexOf('מסורת') !== -1 ||
      chGroup.indexOf('דת') !== -1 ||
      lowerName.indexOf('kabbalah') !== -1 ||
      lowerName.indexOf('hidabroot') !== -1 ||
      lowerName.indexOf('angel') !== -1
    ) {
      return [
        { title: 'שיעור הבוקר - חוכמה ופרשת השבוע', desc: 'שיחות מעוררות השראה על פרשת השבוע, ערכים והתבוננות פנימית.' },
        { title: 'מגזין תרבות, רוח ומורשת', desc: 'תוכנית אירוח מיוחדת בנושאי משפחה, חינוך, היסטוריה ומסורת.' },
        { title: 'מפגשים ושיחות על משמעות החיים', desc: 'רב-שיח מרתק ושאלות ותשובות עם צופים מכל רחבי הארץ והעולם.' },
        { title: 'משדר הערב המרכזי - מדע ורוח', desc: 'הרצאות מרתקות וסיפורים אישיים מרגשים בשידור חי.' }
      ];
    }

    return [
      { title: 'מגזין הבוקר המרכזי', desc: 'תוכנית בוקר עשירה בכתבות צבע, ראיונות ואירוח באולפן.' },
      { title: 'רצועת הצהריים - תרבות ופנאי', desc: 'מיטב כתבות המגזין, סקירות תרבות ותוכניות מקור באיכות HD.' },
      { title: 'המשדר המרכזי - שידור חי', desc: 'התוכנית המרכזית של הערוץ עם אורחים מיוחדים וסיקור נרחב.' },
      { title: 'סדרת דוקו ותחקירים', desc: 'סיפורים אנושיים מרתקים והצצה אל מאחורי הקלעים בפרק מיוחד.' },
      { title: 'רצועת הערב והלילה', desc: 'מיטב תוכניות האירוח והמקור של הערוץ בשידור ישיר.' }
    ];
  }

  pickProgrammeFromPool(pool, hour, indexSeed) {
    if (!pool || pool.length === 0) {
      return { title: 'המשדר המרכזי', desc: 'שידור ישיר בערוץ.' };
    }
    const idx = Math.abs(hour + indexSeed) % pool.length;
    return pool[idx];
  }

  generateSmartFallbackNowNext(channel, now) {
    const nowMs = now && typeof now.getTime === 'function' ? now.getTime() : Date.now();
    return this.computeSyntheticNowNext(channel, nowMs);
  }

  /**
   * Pre-formatted HH:MM time-string cache keyed by minute epoch bucket
   * to eliminate repeated Date formatting allocations across EPG/Guide rendering.
   */
  formatTimeCached(dateOrMs) {
    if (!dateOrMs && dateOrMs !== 0) return '';
    const ms = typeof dateOrMs === 'number'
      ? dateOrMs
      : (dateOrMs && typeof dateOrMs.getTime === 'function' ? dateOrMs.getTime() : NaN);
    if (!isFinite(ms)) return '';
    this._ensureRuntimeCaches();
    const minBucket = Math.floor(ms / 60000);
    const cached = this._formatTimeCache.get(minBucket);
    if (cached !== undefined) return cached;

    const date = new Date(ms);
    const h = ('0' + date.getHours()).slice(-2);
    const m = ('0' + date.getMinutes()).slice(-2);
    const formatted = h + ':' + m;
    if (this._formatTimeCache.size >= 4096) {
      this._formatTimeCache.clear();
    }
    this._formatTimeCache.set(minBucket, formatted);
    return formatted;
  }

  formatTime(dateOrMs) {
    return this.formatTimeCached(dateOrMs);
  }

  /**
   * Normalizes Hebrew/English text for VOD & Voice search:
   * strips niqqud (\u0591-\u05C7), quotes/geresh, punctuation separators, and lowercases.
   */
  normalizeSearchText(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(VOD_NIQQUD_RE, '')
      .replace(VOD_QUOTES_RE, '')
      .replace(VOD_SEP_RE, ' ')
      .replace(VOD_WS_RE, ' ')
      .trim()
      .toLowerCase();
  }

  _getVodSourceMap() {
    this._ensureRuntimeCaches();
    if (this.programmesByChannel && this.programmesByChannel.size > 0) {
      return this.programmesByChannel;
    }
    return this.programmes || this.programmesByChannel;
  }

  _forEachProgrammeList(fn) {
    const src = this._getVodSourceMap();
    if (!src) return;
    if (typeof src.forEach === 'function') {
      src.forEach((list, chKey) => {
        if (!chKey || (typeof chKey === 'string' && chKey.indexOf('gen_') === 0) || !Array.isArray(list)) return;
        fn(list, chKey);
      });
    } else if (typeof src === 'object') {
      const keys = Object.keys(src);
      for (let i = 0; i < keys.length; i++) {
        const chKey = keys[i];
        const list = src[chKey];
        if (!chKey || chKey.indexOf('gen_') === 0 || !Array.isArray(list)) continue;
        fn(list, chKey);
      }
    }
  }

  _resolveChannelMapName(channelMap, chKey, normCache) {
    if (!channelMap || !chKey) return '';
    if (normCache && normCache[chKey] !== undefined) return normCache[chKey];
    let entry = null;
    if (typeof channelMap.get === 'function') {
      entry = channelMap.get(chKey) || null;
    } else if (typeof channelMap === 'object') {
      entry = channelMap[chKey] || null;
    }
    const rawName = typeof entry === 'string'
      ? entry
      : (entry && typeof entry === 'object' ? (entry.name || entry.tvgName || '') : '');
    const norm = rawName ? this.normalizeSearchText(rawName) : '';
    if (normCache) normCache[chKey] = norm;
    return norm;
  }

  _buildVodResultItem(chKey, p, pStart, pStop, now, score) {
    return {
      epgChannelId: chKey,
      id: p.id || (chKey + '_' + pStart),
      title: p.title,
      desc: p.desc || '',
      start: pStart,
      stop: pStop,
      startMs: pStart,
      stopMs: pStop,
      startStr: this.formatTimeCached(pStart),
      stopStr: this.formatTimeCached(pStop),
      isLive: pStart <= now && pStop > now,
      isPast: pStop <= now,
      durationMin: Math.max(1, Math.round((pStop - pStart) / 60000)),
      score: score
    };
  }

  /**
   * Returns recent live + past catchup programmes (sorted start desc) across all channels
   * so the Global 7-Day VOD browser populates immediately when search query is empty.
   */
  getRecentVodProgrammes(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const maxDays = typeof opts.maxDays === 'number' && opts.maxDays > 0 ? opts.maxDays : 7;
    const limit = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : 80;
    const now = typeof opts.now === 'number' && isFinite(opts.now) ? opts.now : Date.now();
    const minMs = now - (maxDays * this.DAY_MS);
    const results = [];

    this._forEachProgrammeList((list, chKey) => {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (!p || !p.title) continue;
        const pStart = typeof p.startMs === 'number' ? p.startMs : p.start;
        const pStop = typeof p.stopMs === 'number' ? p.stopMs : p.stop;
        if (typeof pStart !== 'number' || typeof pStop !== 'number') continue;
        if (pStop < minMs || pStart > now) continue;
        if (opts.pastOnly && pStop > now) continue;
        results.push(this._buildVodResultItem(chKey, p, pStart, pStop, now, 0));
      }
    });

    results.sort((a, b) => b.start - a.start);
    return results.length > limit ? results.slice(0, limit) : results;
  }

  /**
   * Global 7-Day VOD & Live Programme Search across ALL loaded XMLTV channels.
   * Uses lazily-cached niqqud-stripped _normTitle / _normDesc per programme for instant search.
   */
  searchAllVodProgrammes(query, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const normQuery = this.normalizeSearchText(typeof query === 'string' ? query : '');
    if (!normQuery) {
      return this.getRecentVodProgrammes(opts);
    }

    const maxDays = typeof opts.maxDays === 'number' && opts.maxDays > 0 ? opts.maxDays : 7;
    const pastOnly = Boolean(opts.pastOnly);
    const limit = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : 80;
    const channelMap = opts.channelMap || null;
    const now = typeof opts.now === 'number' && isFinite(opts.now) ? opts.now : Date.now();
    const minMs = now - (maxDays * this.DAY_MS);
    const maxMs = now + (4 * 3600000);

    const tokens = normQuery.split(' ');
    const tokenCount = tokens.length;
    const chNormCache = channelMap ? Object.create(null) : null;
    const results = [];

    this._forEachProgrammeList((list, chKey) => {
      const normChName = channelMap ? this._resolveChannelMapName(channelMap, chKey, chNormCache) : '';

      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (!p || !p.title) continue;
        const pStart = typeof p.startMs === 'number' ? p.startMs : p.start;
        const pStop = typeof p.stopMs === 'number' ? p.stopMs : p.stop;
        if (typeof pStart !== 'number' || typeof pStop !== 'number') continue;
        if (pStop < minMs || pStart > maxMs) continue;
        if (pastOnly && pStop > now) continue;

        if (p._normTitle === undefined) {
          p._normTitle = this.normalizeSearchText(p.title);
        }
        if (p._normDesc === undefined) {
          p._normDesc = p.desc ? this.normalizeSearchText(p.desc) : '';
        }

        const normTitle = p._normTitle;
        const normDesc = p._normDesc;
        let score = 0;
        let titleHits = 0;
        let allMatched = true;

        for (let t = 0; t < tokenCount; t++) {
          const tok = tokens[t];
          if (!tok) continue;
          let matchedTok = false;
          if (normTitle.indexOf(tok) !== -1) {
            score += 30;
            titleHits++;
            matchedTok = true;
          }
          if (normChName && normChName.indexOf(tok) !== -1) {
            score += 15;
            matchedTok = true;
          }
          if (normDesc && normDesc.indexOf(tok) !== -1) {
            score += 10;
            matchedTok = true;
          }
          if (!matchedTok) {
            allMatched = false;
            break;
          }
        }

        if (!allMatched || score === 0) continue;

        if (normTitle.indexOf(normQuery) !== -1) {
          score += 100;
          if (normTitle.indexOf(normQuery) === 0) {
            score += 35;
          }
        } else if (titleHits === tokenCount && tokenCount > 1) {
          score += 25;
        }

        results.push(this._buildVodResultItem(chKey, p, pStart, pStop, now, score));
      }
    });

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.start - a.start;
    });
    return results.length > limit ? results.slice(0, limit) : results;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EPGService;
}
