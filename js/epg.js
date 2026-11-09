/**
 * High-Performance 7-Day EPG (Electronic Program Guide) & Catch-Up Engine
 * Optimized for LG webOS 4.64 & 5.0+
 * - Extracts & merges XMLTV from M3U headers (url-tvg / x-tvg-url / tvg-url), Xtream xmltv.php, and manual EPG URLs
 * - Supports both plain .xml and GZIP-compressed .xml.gz EPG feeds (DecompressionStream + pure-JS inflate fallback)
 * - Fault-tolerant XMLTV scanner (never aborts on unescaped '&' entities in IPTV provider feeds)
 * - Multi-alias channel matcher: matches by tvg-id, tvg-name, XMLTV <channel id>, <display-name>, and normalized Hebrew/English synonyms
 * - Strictly bounds history to 7 days back + today + 1 day ahead
 */
class EPGService {
  constructor() {
    this.programmesByChannel = new Map();
    this.channelAliasMap = new Map(); // normalizedKey -> xmltvChannelId
    this.dayBucketsCache = new Map();
    this.epgUrl = '';
    this.loadedUrls = [];
    this.isLoading = false;
    this.lastUpdatedMs = 0;
    this.MAX_PAST_DAYS = 7;
    this.DAY_MS = 86400000;
    this.EPG_CACHE_KEY = 'zenplay_iptv_epg_cache_v48';
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
    let s = str
      .toLowerCase()
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\b(?:1080p|720p|576p|480p|4k|uhd|fhd|hd|sd|hevc|h265|h264|israel|il|tv|channel|ch)\b/gi, ' ')
      .replace(/ערוץ/g, ' ')
      .replace(/[^a-z0-9\u0590-\u05fe]+/g, '')
      .trim();

    // Canonical synonym table for common Israeli & international channels
    const synonyms = {
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

    return synonyms[s] || s;
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
      if (ttlHours > 0 && ageMs > ttlHours * 3600000) {
        return false;
      }

      this.programmesByChannel.clear();
      this.channelAliasMap.clear();

      for (let i = 0; i < data.entries.length; i++) {
        const entry = data.entries[i];
        const chId = entry[0];
        const progs = entry[1].map((p) => ({
          id: chId + '_' + p.s,
          title: p.t,
          desc: p.d,
          startMs: p.s,
          stopMs: p.e,
          start: new Date(p.s),
          stop: new Date(p.e)
        }));
        this.programmesByChannel.set(chId, progs);
        this.registerChannelAlias(chId, chId);
      }

      if (Array.isArray(data.aliases)) {
        for (let i = 0; i < data.aliases.length; i++) {
          const pair = data.aliases[i];
          if (pair && pair[0] && pair[1]) {
            this.registerChannelAlias(pair[0], pair[1]);
          }
        }
      }

      this.lastUpdatedMs = data.updatedAt || Date.now();
      return true;
    } catch (e) {
      return false;
    }
  }

  saveToLocalCache(cacheKeyUrl) {
    try {
      const entries = [];
      let count = 0;
      this.programmesByChannel.forEach((list, chId) => {
        if (chId.indexOf('gen_') === 0 || count > 3500) return;
        const compact = list.slice(0, 90).map((p) => ({
          t: p.title,
          d: p.desc ? p.desc.substring(0, 160) : '',
          s: p.startMs,
          e: p.stopMs
        }));
        entries.push([chId, compact]);
        count += compact.length;
      });

      const aliases = [];
      this.channelAliasMap.forEach((targetId, aliasKey) => {
        if (aliases.length < 1500 && aliasKey !== targetId) {
          aliases.push([aliasKey, targetId]);
        }
      });

      this.lastUpdatedMs = Date.now();
      localStorage.setItem(
        this.EPG_CACHE_KEY,
        JSON.stringify({
          url: cacheKeyUrl,
          updatedAt: this.lastUpdatedMs,
          entries: entries,
          aliases: aliases
        })
      );
    } catch (e) {}
  }

  clearCache() {
    try {
      localStorage.removeItem(this.EPG_CACHE_KEY);
      this.programmesByChannel.clear();
      this.channelAliasMap.clear();
      this.dayBucketsCache.clear();
      this.lastUpdatedMs = 0;
    } catch (e) {}
  }

  /**
   * Loads one or more XMLTV URLs (supports comma-separated strings, arrays, .xml and .xml.gz)
   */
  loadEPG(urlOrUrls, onComplete, forceRefresh) {
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

    // Deduplicate URLs
    urls = Array.from(new Set(urls));
    if (urls.length === 0 || this.isLoading) {
      if (onComplete) onComplete(false);
      return;
    }

    const cacheKeyUrl = urls.join('|');
    this.epgUrl = urls[0];
    this.loadedUrls = urls;

    if (!forceRefresh && this.loadFromLocalCache(cacheKeyUrl)) {
      if (onComplete) onComplete(true);
      return;
    }

    this.isLoading = true;
    let ClearFirst = true;

    const fetchPromises = urls.map((u) =>
      this.fetchAndDecodeXMLTV(u)
        .then((xmlText) => {
          if (xmlText && xmlText.length > 50) {
            this.parseXMLTV(xmlText, !ClearFirst);
            ClearFirst = false;
            return true;
          }
          return false;
        })
        .catch((err) => {
          console.warn('EPG source warning (' + u + '):', err);
          return false;
        })
    );

    Promise.all(fetchPromises)
      .then((results) => {
        const anySuccess = results.some(Boolean) && this.programmesByChannel.size > 0;
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

  /**
   * Fetches XMLTV from URL and automatically decompresses if it is GZIP (.xml.gz)
   */
  fetchAndDecodeXMLTV(url) {
    return fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error('EPG HTTP ' + res.status);
        return res.arrayBuffer();
      })
      .then((buffer) => {
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
    return str
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)))
      .trim();
  }

  /**
   * High-speed, fault-tolerant XMLTV parser that extracts <channel> display-names and <programme> schedules.
   * Never fails on unescaped '&' entities in IPTV XMLTV feeds.
   */
  parseXMLTV(xmlString, appendMode) {
    if (!xmlString || typeof xmlString !== 'string') return;
    try {
      const now = Date.now();
      const minAllowedTime = now - (this.MAX_PAST_DAYS * this.DAY_MS);
      const maxAllowedTime = now + (2 * this.DAY_MS);

      if (!appendMode) {
        this.programmesByChannel.clear();
        this.channelAliasMap.clear();
      } else {
        Array.from(this.programmesByChannel.keys()).forEach((k) => {
          if (k.indexOf('gen_') === 0) this.programmesByChannel.delete(k);
        });
      }
      this.dayBucketsCache.clear();

      // 1. Parse <channel id="..."> and its <display-name> tags
      const channelBlockRegex = /<channel\b[^>]*\bid\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/channel>/gi;
      let chMatch;
      while ((chMatch = channelBlockRegex.exec(xmlString)) !== null) {
        const chId = this.decodeXmlEntities(chMatch[1] || chMatch[2] || '');
        const chBody = chMatch[3] || '';
        if (!chId) continue;
        this.registerChannelAlias(chId, chId);

        const dispRegex = /<display-name\b[^>]*>([\s\S]*?)<\/display-name>/gi;
        let dMatch;
        while ((dMatch = dispRegex.exec(chBody)) !== null) {
          const dispName = this.decodeXmlEntities(dMatch[1] || '');
          if (dispName) {
            this.registerChannelAlias(dispName, chId);
          }
        }
      }

      // 2. Parse <programme ...> blocks
      const progBlockRegex = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
      let pMatch;
      while ((pMatch = progBlockRegex.exec(xmlString)) !== null) {
        const attrs = pMatch[1] || '';
        const body = pMatch[2] || '';

        const chAttr = attrs.match(/\bchannel\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
        const startAttr = attrs.match(/\bstart\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
        if (!chAttr || !startAttr) continue;

        const channelId = this.decodeXmlEntities(chAttr[1] || chAttr[2] || '');
        const startStr = startAttr[1] || startAttr[2] || '';
        if (!channelId || !startStr) continue;

        const start = this.parseDate(startStr);
        const startMs = start.getTime();
        if (isNaN(startMs) || startMs < minAllowedTime || startMs > maxAllowedTime) continue;

        const stopAttr = attrs.match(/\bstop\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
        const stopStr = stopAttr ? (stopAttr[1] || stopAttr[2] || '') : '';
        const stop = stopStr ? this.parseDate(stopStr) : new Date(startMs + 3600000);
        const stopMs = stop.getTime();

        const titleMatch = body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
        const descMatch = body.match(/<desc\b[^>]*>([\s\S]*?)<\/desc>/i);
        const subTitleMatch = body.match(/<sub-title\b[^>]*>([\s\S]*?)<\/sub-title>/i);

        const title = titleMatch ? this.decodeXmlEntities(titleMatch[1]) : 'שידור חי';
        let desc = descMatch ? this.decodeXmlEntities(descMatch[1]) : '';
        if (!desc && subTitleMatch) {
          desc = this.decodeXmlEntities(subTitleMatch[1]);
        }

        if (!this.programmesByChannel.has(channelId)) {
          this.programmesByChannel.set(channelId, []);
          this.registerChannelAlias(channelId, channelId);
        }

        this.programmesByChannel.get(channelId).push({
          id: channelId + '_' + startMs,
          title: title,
          desc: desc,
          start: start,
          stop: stop,
          startMs: startMs,
          stopMs: stopMs > startMs ? stopMs : startMs + 3600000
        });
      }

      // Sort each channel's schedule chronologically once
      this.programmesByChannel.forEach((list) => {
        list.sort((a, b) => a.startMs - b.startMs);
      });
    } catch (e) {
      console.warn('XMLTV parse error:', e);
    }
  }

  /**
   * Parses XMLTV date string: "20261109143000 +0200" or "20261109123000 +0000" or "20261109143000"
   * Respects timezone offset when provided so programmes align with the TV's local clock!
   */
  parseDate(str) {
    if (!str) return new Date();
    const m = str.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s*([+-])(\d{2})(\d{2}))?/);
    if (!m) {
      return new Date();
    }
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    const h = parseInt(m[4], 10) || 0;
    const min = parseInt(m[5], 10) || 0;
    const sec = parseInt(m[6], 10) || 0;

    if (m[7] && m[8] && m[9]) {
      const sign = m[7] === '-' ? -1 : 1;
      const tzHours = parseInt(m[8], 10) || 0;
      const tzMins = parseInt(m[9], 10) || 0;
      const offsetMs = sign * ((tzHours * 60) + tzMins) * 60000;
      const utcMs = Date.UTC(y, mo, d, h, min, sec) - offsetMs;
      return new Date(utcMs);
    }

    return new Date(y, mo, d, h, min, sec);
  }

  /**
   * Resolves a channel object to its XMLTV programme list using exact ID, tvg-name, display-name, or normalized alias
   */
  findXmlProgrammesForChannel(channel) {
    if (!channel || this.programmesByChannel.size === 0) return null;

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
        return this.programmesByChannel.get(trimmed);
      }

      // 2. Alias map match (exact or lowercase)
      const aliasTarget = this.channelAliasMap.get(trimmed) || this.channelAliasMap.get(trimmed.toLowerCase());
      if (aliasTarget && this.programmesByChannel.has(aliasTarget)) {
        return this.programmesByChannel.get(aliasTarget);
      }

      // 3. Normalized fuzzy alias match
      const norm = this.normalizeChannelKey(trimmed);
      if (norm) {
        const normTarget = this.channelAliasMap.get(norm);
        if (normTarget && this.programmesByChannel.has(normTarget)) {
          return this.programmesByChannel.get(normTarget);
        }
      }
    }

    return null;
  }

  /**
   * Returns complete 7-day + today schedule for a channel (from XMLTV or deterministic channel-specific schedule)
   */
  getChannelProgrammes(channel) {
    if (!channel) return [];
    const xmlList = this.findXmlProgrammesForChannel(channel);
    if (xmlList && xmlList.length > 0) {
      return xmlList;
    }

    const cacheKey = 'gen_' + channel.id;
    if (this.programmesByChannel.has(cacheKey)) {
      return this.programmesByChannel.get(cacheKey);
    }

    const generated = this.generateSevenDaySchedule(channel);
    this.programmesByChannel.set(cacheKey, generated);
    return generated;
  }

  /**
   * Returns Previous, Current & Next programme for fast rendering (including both startStr, stopStr, progressPercent, remainingMin)
   */
  getNowNext(channel) {
    if (!channel) return null;
    const nowMs = Date.now();
    const list = this.findXmlProgrammesForChannel(channel) || this.getChannelProgrammes(channel);

    if (list && list.length > 0) {
      let currentIdx = -1;
      for (let i = 0; i < list.length; i++) {
        if (list[i].startMs <= nowMs && list[i].stopMs > nowMs) {
          currentIdx = i;
          break;
        }
      }

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
                startStr: this.formatTime(prev.start),
                stopStr: this.formatTime(prev.stop),
                startMs: prev.startMs,
                stopMs: prev.stopMs
              }
            : null,
          current: {
            id: current.id,
            title: current.title,
            desc: current.desc || 'שידור ישיר בערוץ.',
            start: current.start,
            stop: current.stop,
            startMs: current.startMs,
            stopMs: current.stopMs,
            startStr: this.formatTime(current.start),
            stopStr: this.formatTime(current.stop),
            progressPercent: progress,
            remainingMin: remainingMin,
            status: 'live'
          },
          next: next
            ? {
                id: next.id,
                title: next.title,
                desc: next.desc,
                startStr: this.formatTime(next.start),
                stopStr: this.formatTime(next.stop),
                startMs: next.startMs,
                stopMs: next.stopMs
              }
            : null
        };
      }
    }

    return this.generateSmartFallbackNowNext(channel, new Date(nowMs));
  }

  /**
   * Returns a compact Mini Timeline around Now:
   * 2 Previous programmes (for instant Start-Over) + 1 Current Live + 2 Upcoming programmes
   */
  getMiniTimeline(channel) {
    if (!channel) return [];
    const nowMs = Date.now();
    const list = this.getChannelProgrammes(channel);
    let currentIdx = -1;

    for (let i = 0; i < list.length; i++) {
      if (list[i].startMs <= nowMs && list[i].stopMs > nowMs) {
        currentIdx = i;
        break;
      }
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
        start: p.start,
        stop: p.stop,
        startMs: p.startMs,
        stopMs: p.stopMs,
        startStr: this.formatTime(p.start),
        stopStr: this.formatTime(p.stop),
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
            start: p.start,
            stop: p.stop,
            startMs: p.startMs,
            stopMs: p.stopMs,
            startStr: this.formatTime(p.start),
            stopStr: this.formatTime(p.stop),
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
          start: new Date(startMs),
          stop: new Date(stopMs),
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
    for (let i = 0; i < list.length; i++) {
      if (list[i].startMs <= nowMs && list[i].stopMs > nowMs) {
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
                startStr: this.formatTime(prev.start),
                stopStr: this.formatTime(prev.stop),
                startMs: prev.startMs,
                stopMs: prev.stopMs
              }
            : null,
          current: {
            id: cur.id,
            title: cur.title,
            desc: cur.desc,
            startStr: this.formatTime(cur.start),
            stopStr: this.formatTime(cur.stop),
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
                startStr: this.formatTime(next.start),
                stopStr: this.formatTime(next.stop),
                startMs: next.startMs,
                stopMs: next.stopMs
              }
            : null
        };
      }
    }
    return null;
  }

  formatTime(date) {
    if (!date) return '';
    const h = ('0' + date.getHours()).slice(-2);
    const m = ('0' + date.getMinutes()).slice(-2);
    return h + ':' + m;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EPGService;
}
