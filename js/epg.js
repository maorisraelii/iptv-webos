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
  '11': 'kan11',
  'קשת12': 'keshet12',
  'קשת': 'keshet12',
  'keshet12': 'keshet12',
  '12': 'keshet12',
  'רשת13': 'reshet13',
  'רשת': 'reshet13',
  'reshet13': 'reshet13',
  '13': 'reshet13',
  'עכשיו14': 'now14',
  'now14': 'now14',
  '14': 'now14',
  '9': 'channel9il',
  'ישראלפלוס': 'channel9il',
  '24': 'channel24il',
  'מוזיקה24': 'channel24il',
  'מכאן33': 'makan33',
  'makan33': 'makan33',
  '33': 'makan33',
  'ספורט5': 'sport5',
  '5sport': 'sport5',
  'sport5': 'sport5',
  '5plus': 'sport5plus',
  'ספורט5פלוס': 'sport5plus',
  '5stars': 'sport5stars',
  'ספורט5סטארס': 'sport5stars',
  '5live': 'sport5live',
  'ספורט5לייב': 'sport5live',
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
    this.channelAliasMap = new Map(); // normalizedKey -> xmltvChannelId
    this.dayBucketsCache = new Map();
    this._channelMatchCache = new Map();
    this._normCache = new Map();
    this.epgUrl = '';
    this.loadedUrls = [];
    this.isLoading = false;
    this.lastUpdatedMs = 0;
    this.MAX_PAST_DAYS = 7;
    this.DAY_MS = 86400000;
    this.EPG_CACHE_KEY = 'zenplay_iptv_epg_cache_v491';
    this.TTL_STORAGE_KEY = 'zenplay_iptv_cache_ttl_hours';
    this.DEFAULT_LIVE_EPG_URL =
      'https://gist.githubusercontent.com/maorisraelii/b4408ca1c31143ed2f50164629f53f1c/raw/epg-il.xml';
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

  registerChannelAlias(rawAlias, targetChannelId) {
    if (!rawAlias || !targetChannelId) return;
    const trimmed = rawAlias.trim();
    if (!trimmed) return;
    this.channelAliasMap.set(trimmed, targetChannelId);
    this.channelAliasMap.set(trimmed.toLowerCase(), targetChannelId);
    const norm = this.normalizeChannelKey(trimmed);
    if (norm) {
      this.channelAliasMap.set(norm, targetChannelId);
    }
  }

  _purgeSyntheticChannels() {
    this.programmesByChannel.forEach((_val, chId) => {
      if (typeof chId === 'string' && chId.indexOf('gen_') === 0) {
        this.programmesByChannel.delete(chId);
      }
    });
  }

  rebuildAliasesFromLoadedChannels() {
    this.programmesByChannel.forEach((_list, chId) => {
      if (chId.indexOf('gen_') === 0) return;
      this.registerChannelAlias(chId, chId);
    });
  }

  loadFromLocalCache(cacheKeyUrl) {
    try {
      const raw = localStorage.getItem(this.EPG_CACHE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || data.url !== cacheKeyUrl || !Array.isArray(data.entries) || data.entries.length === 0) {
        return false;
      }

      const ttlHours = this.getCacheTtlHours();
      const ageMs = Date.now() - (data.updatedAt || 0);
      const isExpired = ttlHours > 0 && ageMs > ttlHours * 3600000;

      // Stale data is infinitely better than an empty screen.
      // Load into memory regardless of expiration, but trigger immediate background refresh if expired.
      this.lastUpdatedMs = isExpired ? 0 : (data.updatedAt || 0);

      this.programmesByChannel.clear();
      this.channelAliasMap.clear();
      if (this.dayBucketsCache) this.dayBucketsCache.clear();
      if (this._channelMatchCache) this._channelMatchCache.clear();

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

      // If all cached programmes have already ended more than 3h ago, force immediate network refresh
      if (latestStopMs < Date.now() - 3 * 3600000) {
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
        }
      });

      const aliases = [];
      this.channelAliasMap.forEach((targetId, aliasKey) => {
        if (aliasKey && targetId && aliasKey !== targetId) {
          aliases.push([aliasKey, targetId]);
        }
      });

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
      localStorage.removeItem(this.EPG_CACHE_KEY);
      this.programmesByChannel.clear();
      this.channelAliasMap.clear();
      this.dayBucketsCache.clear();
      if (this._channelMatchCache) this._channelMatchCache.clear();
      if (this._normCache) this._normCache.clear();
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
      if (ch.epgId) this.targetChannelKeys.add(ch.epgId.trim().toLowerCase());
      if (ch.tvgName) this.targetChannelKeys.add(ch.tvgName.trim().toLowerCase());
      if (ch.name) this.targetChannelKeys.add(ch.name.trim().toLowerCase());
      if (ch.rawName) this.targetChannelKeys.add(ch.rawName.trim().toLowerCase());
      const norm = this.normalizeChannelKey(ch.name || ch.tvgName || '');
      if (norm) this.targetChannelKeys.add(norm);
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

    const cacheKeyUrl = urls.join('|');
    this.epgUrl = urls[0];
    this.loadedUrls = urls;

    // Stale-While-Revalidate: render immediately from local cache if available (< 15ms)
    const hasCachedData = !forceRefresh && this.loadFromLocalCache(cacheKeyUrl);
    if (hasCachedData) {
      if (onComplete) onComplete(true);
      const ageMs = Date.now() - (this.lastUpdatedMs || 0);
      // If cache was refreshed within last 20 minutes, don't spam network fetch
      if (ageMs < 20 * 60 * 1000) {
        return;
      }
    }

    this.isLoading = true;

    const fetchPromises = urls.map((u) =>
      this.fetchAndDecodeXMLTV(u)
        .then((xmlText) => (xmlText && xmlText.length > 50 ? xmlText : null))
        .catch((err) => {
          console.warn('EPG source warning (' + u + '):', err);
          return null;
        })
    );

    Promise.all(fetchPromises)
      .then((xmlList) => {
        const validXmls = xmlList.filter(Boolean);
        let parsedAny = false;
        for (let i = 0; i < validXmls.length; i++) {
          // First valid XML replaces stale cached data cleanly; subsequent feeds append
          this.parseXMLTV(validXmls[i], i > 0);
          parsedAny = true;
        }
        const anySuccess = parsedAny && this.programmesByChannel.size > 0;
        if (anySuccess) {
          this.saveToLocalCache(cacheKeyUrl);
          this.dayBucketsCache.clear();
        }
        this.isLoading = false;
        if (onComplete) onComplete(anySuccess);
      })
      .catch(() => {
        this.isLoading = false;
        if (onComplete) onComplete(false);
      });
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

  /**
   * Fetches XMLTV from URL with hardware memory protection guards,
   * automatically decompresses if it is GZIP (.xml.gz).
   */
  fetchAndDecodeXMLTV(url) {
    if (!url) return Promise.resolve('');
    // Hardware guard: intercept known giant monolithic feeds
    if (url.indexOf('epg.team') !== -1 || url.indexOf('epg_ripper_ALL') !== -1) {
      url = this.DEFAULT_LIVE_EPG_URL;
    }

    const MAX_SAFE_EPG_BYTES = 35 * 1024 * 1024; // 35MB safety limit to prevent OOM on giant 300MB global feeds

    return this.fetchWithProxyFallback(url)
      .then((res) => {
        const cl = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : null;
        if (cl && parseInt(cl, 10) > MAX_SAFE_EPG_BYTES) {
          console.warn('EPG feed exceeds TV memory safety limit (>35MB), aborting:', url);
          return null;
        }
        return res.arrayBuffer();
      })
      .catch((err) => {
        if (url === this.DEFAULT_LIVE_EPG_URL || url.indexOf('epg-il.xml') !== -1) {
          if (url !== 'epg-il.xml') {
            console.warn('Remote EPG unavailable, falling back to bundled epg-il.xml:', err);
            return fetch('epg-il.xml').then((localRes) => {
              if (!localRes || !localRes.ok) throw err;
              return localRes.arrayBuffer();
            });
          }
        }
        throw err;
      })
      .then((buffer) => {
        if (!buffer) return '';
        if (buffer.byteLength > MAX_SAFE_EPG_BYTES) {
          console.warn('EPG feed buffer exceeded 35MB safe limit, skipped:', url);
          return '';
        }
        const bytes = new Uint8Array(buffer);
        // Check GZIP magic header (0x1f 0x8b)
        if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
          if (typeof DecompressionStream !== 'undefined') {
            try {
              const ds = new DecompressionStream('gzip');
              const decompressedStream = new Blob([bytes]).stream().pipeThrough(ds);
              return new Response(decompressedStream).text();
            } catch (e) {}
          }
        }
        if (typeof TextDecoder !== 'undefined') {
          return new TextDecoder('utf-8').decode(bytes);
        }
        // Fallback for very old engines
        let str = '';
        const chunk = 8192;
        for (let i = 0; i < bytes.length; i += chunk) {
          str += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        try {
          return decodeURIComponent(escape(str));
        } catch (e) {
          return str;
        }
      });
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
   * Uses native indexOf scanning instead of backtracking regexes for minimal CPU & memory on webOS TVs.
   */
  parseXMLTV(xmlString, appendMode) {
    if (!xmlString || typeof xmlString !== 'string') return;
    try {
      const now = Date.now();
      const minAllowedTime = now - (this.MAX_PAST_DAYS * this.DAY_MS);
      const maxAllowedTime = now + (7 * this.DAY_MS);

      if (!appendMode) {
        this.programmesByChannel.clear();
        this.channelAliasMap.clear();
      } else {
        this._purgeSyntheticChannels();
      }
      if (this.dayBucketsCache) this.dayBucketsCache.clear();
      if (this._channelMatchCache) this._channelMatchCache.clear();

      const matchedChannelIds = new Set();
      const hasFilter = Boolean(this.targetChannelKeys && this.targetChannelKeys.size > 0);
      const xmlLen = xmlString.length;

      // 1. Scan <channel id="..."> blocks and their <display-name> tags
      let chPos = xmlString.indexOf('<channel');
      while (chPos !== -1) {
        const afterTag = xmlString.charCodeAt(chPos + 8);
        if (afterTag === 62 || afterTag <= 32) {
          const openEnd = xmlString.indexOf('>', chPos + 8);
          if (openEnd === -1) break;
          const closeIdx = xmlString.indexOf('</channel>', openEnd + 1);
          if (closeIdx === -1) break;

          const chAttrs = xmlString.slice(chPos + 8, openEnd);
          const rawId = this.extractXmlAttr(chAttrs, 'id');
          if (rawId) {
            const chId = this.decodeXmlEntities(rawId);
            if (chId) {
              const lowerId = chId.toLowerCase();
              let isMatch = !hasFilter || this.targetChannelKeys.has(lowerId);

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
                matchedChannelIds.add(chId);
                this.registerChannelAlias(chId, chId);
                for (let d = 0; d < displayNames.length; d++) {
                  this.registerChannelAlias(displayNames[d], chId);
                }
              }
            }
          }
          chPos = xmlString.indexOf('<channel', closeIdx + 10);
        } else {
          chPos = xmlString.indexOf('<channel', chPos + 8);
        }
      }

      // 2. Scan <programme ...> blocks
      let pPos = xmlString.indexOf('<programme');
      while (pPos !== -1 && pPos < xmlLen) {
        const afterTag = xmlString.charCodeAt(pPos + 10);
        if (afterTag === 62 || afterTag <= 32) {
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
              if (hasFilter && matchedChannelIds.size > 0 && !matchedChannelIds.has(channelId)) {
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
                if (!isNaN(startMs) && startMs >= minAllowedTime && startMs <= maxAllowedTime) {
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

                  let list = this.programmesByChannel.get(channelId);
                  if (!list) {
                    list = [];
                    this.programmesByChannel.set(channelId, list);
                    this.registerChannelAlias(channelId, channelId);
                  }

                  list.push({
                    id: channelId + '_' + startMs,
                    title: title,
                    desc: desc,
                    startMs: startMs,
                    stopMs: stopMs
                  });
                }
              }
            }
          }
          pPos = xmlString.indexOf('<programme', closeIdx + 12);
        } else {
          pPos = xmlString.indexOf('<programme', pPos + 10);
        }
      }

      // Sort each channel's schedule chronologically and deduplicate identical start times
      this.programmesByChannel.forEach((list, chKey) => {
        list.sort((a, b) => a.startMs - b.startMs);
        if (list.length > 1) {
          const deduped = [list[0]];
          for (let i = 1; i < list.length; i++) {
            if (list[i].startMs !== list[i - 1].startMs) {
              deduped.push(list[i]);
            } else {
              // Prefer the entry with longer description/title
              const prev = deduped[deduped.length - 1];
              if ((list[i].desc || '').length > (prev.desc || '').length) {
                deduped[deduped.length - 1] = list[i];
              }
            }
          }
          this.programmesByChannel.set(chKey, deduped);
        }
      });

      this._purgeSyntheticChannels();
      if (this._channelMatchCache) this._channelMatchCache.clear();
    } catch (e) {
      console.warn('XMLTV parse error:', e);
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

  /**
   * Resolves a channel object to its XMLTV programme list using exact ID, tvg-name, display-name, or normalized alias
   */
  findXmlProgrammesForChannel(channel) {
    if (!channel || this.programmesByChannel.size === 0) return null;
    if (!this._channelMatchCache) this._channelMatchCache = new Map();

    const cacheKey = channel.id || channel.uid || '';
    if (cacheKey && this._channelMatchCache.has(cacheKey)) {
      const cachedTarget = this._channelMatchCache.get(cacheKey);
      return cachedTarget ? this.programmesByChannel.get(cachedTarget) || null : null;
    }

    const candidates = [
      channel.epgId,
      channel.tvgName,
      channel.rawName,
      channel.name,
      channel.id
    ];

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!c || typeof c !== 'string') continue;
      const trimmed = c.trim();
      if (!trimmed) continue;

      // 1. Direct match
      if (this.programmesByChannel.has(trimmed)) {
        if (cacheKey) this._channelMatchCache.set(cacheKey, trimmed);
        return this.programmesByChannel.get(trimmed);
      }

      // 2. Alias map match (exact or lowercase)
      const aliasTarget = this.channelAliasMap.get(trimmed) || this.channelAliasMap.get(trimmed.toLowerCase());
      if (aliasTarget && this.programmesByChannel.has(aliasTarget)) {
        if (cacheKey) this._channelMatchCache.set(cacheKey, aliasTarget);
        return this.programmesByChannel.get(aliasTarget);
      }

      // 3. Normalized fuzzy alias match
      const norm = this.normalizeChannelKey(trimmed);
      if (norm) {
        const normTarget = this.channelAliasMap.get(norm);
        if (normTarget && this.programmesByChannel.has(normTarget)) {
          if (cacheKey) this._channelMatchCache.set(cacheKey, normTarget);
          return this.programmesByChannel.get(normTarget);
        }
      }
    }

    if (cacheKey) this._channelMatchCache.set(cacheKey, '');
    return null;
  }

  /**
   * Returns complete 7-day + today schedule for a channel (from XMLTV or deterministic channel-specific schedule)
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
      const generated = this.generateSevenDaySchedule(channel);
      const futureGen = generated.filter((p) => p.startMs >= (lastProg ? lastProg.stopMs : nowMs));
      return xmlList.concat(futureGen);
    }

    const cacheKey = 'gen_' + channel.id;
    if (this.programmesByChannel.has(cacheKey)) {
      return this.programmesByChannel.get(cacheKey);
    }

    const generated = this.generateSevenDaySchedule(channel);
    this.programmesByChannel.set(cacheKey, generated);
    return generated;
  }

  findCurrentProgrammeIndex(list, nowMs) {
    if (!list || list.length === 0) return -1;
    let lo = 0;
    let hi = list.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const p = list[mid];
      if (nowMs < p.startMs) {
        hi = mid - 1;
      } else if (nowMs >= p.stopMs) {
        lo = mid + 1;
      } else {
        return mid;
      }
    }
    return -1;
  }

  /**
   * Returns Previous, Current & Next programme for fast rendering (including both startStr, stopStr, progressPercent, remainingMin)
   */
  getNowNext(channel) {
    if (!channel) return null;
    const nowMs = Date.now();
    const list = this.getChannelProgrammes(channel);

    if (list && list.length > 0) {
      const currentIdx = this.findCurrentProgrammeIndex(list, nowMs);

      if (currentIdx !== -1) {
        const prev = currentIdx > 0 ? list[currentIdx - 1] : null;
        const current = list[currentIdx];
        const next = list[currentIdx + 1] || null;
        const totalDuration = Math.max(1, current.stopMs - current.startMs);
        const elapsed = Math.max(0, nowMs - current.startMs);
        const progress = Math.min(100, Math.round((elapsed / totalDuration) * 100));
        const remainingMin = Math.max(1, Math.ceil((current.stopMs - nowMs) / 60000));

        return {
          previous: prev
            ? {
                id: prev.id,
                title: prev.title,
                desc: prev.desc,
                startStr: this.formatTime(prev.startMs),
                stopStr: this.formatTime(prev.stopMs),
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
            startStr: this.formatTime(current.startMs),
            stopStr: this.formatTime(current.stopMs),
            progressPercent: progress,
            remainingMin: remainingMin,
            status: 'live'
          },
          next: next
            ? {
                id: next.id,
                title: next.title,
                desc: next.desc,
                startStr: this.formatTime(next.startMs),
                stopStr: this.formatTime(next.stopMs),
                startMs: next.startMs,
                stopMs: next.stopMs
              }
            : null
        };
      }
    }

    return this.generateSmartFallbackNowNext(channel, new Date(nowMs));
  }

  _formatAdjacentItem(p) {
    if (!p) return null;
    return {
      id: p.id,
      title: p.title,
      desc: p.desc,
      startMs: p.startMs,
      stopMs: p.stopMs,
      startStr: this.formatTime(p.startMs),
      stopStr: this.formatTime(p.stopMs)
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
    const idx = this.findCurrentProgrammeIndex(list, refMs + 1000);
    if (idx !== -1) {
      target = list[idx];
    } else {
      for (let i = 0; i < list.length; i++) {
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
      startStr: this.formatTime(target.startMs),
      stopStr: this.formatTime(target.stopMs),
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
      idx = this.findCurrentProgrammeIndex(list, targetStartMs + 1000);
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
    let list = this.getChannelProgrammes(channel);
    let currentIdx = this.findCurrentProgrammeIndex(list, nowMs);

    if (currentIdx === -1) {
      list = this.generateSevenDaySchedule(channel);
      currentIdx = this.findCurrentProgrammeIndex(list, nowMs);
    }

    if (currentIdx === -1) return [];

    const startIdx = Math.max(0, currentIdx - 2);
    const endIdx = Math.min(list.length - 1, currentIdx + 2);
    const slice = [];

    for (let i = startIdx; i <= endIdx; i++) {
      const p = list[i];
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
        startStr: this.formatTime(p.startMs),
        stopStr: this.formatTime(p.stopMs),
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
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.startMs >= dayStartMs && p.startMs < dayEndMs) {
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
            startStr: this.formatTime(p.startMs),
            stopStr: this.formatTime(p.stopMs),
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
    const list = this.getChannelProgrammes(channel);
    const nowMs = now.getTime();
    const i = this.findCurrentProgrammeIndex(list, nowMs);
    if (i !== -1) {
      const prev = i > 0 ? list[i - 1] : null;
      const cur = list[i];
      const next = list[i + 1] || null;
      const totalDuration = Math.max(1, cur.stopMs - cur.startMs);
      const elapsed = Math.max(0, nowMs - cur.startMs);
      const progress = Math.min(100, Math.round((elapsed / totalDuration) * 100));
      const remainingMin = Math.max(1, Math.ceil((cur.stopMs - nowMs) / 60000));
      return {
        previous: prev
          ? {
              id: prev.id,
              title: prev.title,
              desc: prev.desc,
              startStr: this.formatTime(prev.startMs),
              stopStr: this.formatTime(prev.stopMs),
              startMs: prev.startMs,
              stopMs: prev.stopMs
            }
          : null,
        current: {
          id: cur.id,
          title: cur.title,
          desc: cur.desc,
          start: cur.start || new Date(cur.startMs),
          stop: cur.stop || new Date(cur.stopMs),
          startStr: this.formatTime(cur.startMs),
          stopStr: this.formatTime(cur.stopMs),
          startMs: cur.startMs,
          stopMs: cur.stopMs,
          progressPercent: progress,
          remainingMin: remainingMin,
          status: 'live'
        },
        next: next
          ? {
              id: next.id,
              title: next.title,
              desc: next.desc,
              startStr: this.formatTime(next.startMs),
              stopStr: this.formatTime(next.stopMs),
              startMs: next.startMs,
              stopMs: next.stopMs
            }
          : null
      };
    }
    return null;
  }

  formatTime(dateOrMs) {
    if (!dateOrMs && dateOrMs !== 0) return '';
    const date = typeof dateOrMs === 'number' ? new Date(dateOrMs) : dateOrMs;
    const h = ('0' + date.getHours()).slice(-2);
    const m = ('0' + date.getMinutes()).slice(-2);
    return h + ':' + m;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EPGService;
}
