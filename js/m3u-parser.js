/**
 * High-Speed M3U Parser optimized for LG webOS TV (webOS 4.64 & 5.0+)
 * - Single-pass indexOf('\n') scanner (zero whole-file split array allocation)
 * - Zero-regex fast-path attribute extractor + group-title string interning
 * - O(1) hash map deduplication of identical stream URLs during parse
 * - Extracts all EPG URLs from #EXTM3U headers and derives Xtream Codes xmltv.php URLs
 */
const HEADER_EPG_ATTR_REGEX = /(?:x-tvg-url|url-tvg|tvg-url|epg-url|tvg-epg)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'>]+))/gi;
const XTREAM_GET_REGEX = /^(https?:\/\/[^\/]+)\/get\.php\?([^#]+)/i;
const XTREAM_USER_REGEX = /(?:^|&)username=([^&]+)/i;
const XTREAM_PASS_REGEX = /(?:^|&)password=([^&]+)/i;
const XTREAM_STREAM_REGEX = /^(https?:\/\/[^\/]+)\/(?:live\/)?([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)\/\d+(?:\.[a-z0-9]+)?$/i;

const GROUP_NAME_MAP = {
  'general': 'ערוצים מרכזיים',
  'news': 'חדשות ואקטואליה',
  'sports': 'ספורט',
  'sport': 'ספורט',
  'entertainment': 'בידור',
  'movies': 'סרטים וסינמה',
  'series': 'סדרות',
  'kids': 'ילדים ונוער',
  'children': 'ילדים ונוער',
  'music': 'מוזיקה',
  'religious': 'מסורת ודת',
  'documentary': 'דוקו וטבע',
  'education': 'חינוך ומדע',
  'culture': 'תרבות',
  'legislative': 'ציבורי וכנסת',
  'business': 'כלכלה ועסקים',
  'lifestyle': 'לייף סטייל'
};

const MAX_GROUP_INTERN_ENTRIES = 2048;

class M3UParser {
  constructor() {
    this.channels = [];
    this.categories = [];
    this.categoryMap = new Map();
    this.epgUrl = '';
    this.epgUrls = [];
    this._groupInternTable = Object.create(null);
    this._groupInternCount = 0;
    this.lastParseStats = { totalParsed: 0, duplicatesSkipped: 0 };
  }

  _ensureParserState() {
    if (!this._groupInternTable || typeof this._groupInternTable !== 'object') {
      this._groupInternTable = Object.create(null);
      this._groupInternCount = 0;
    }
    if (typeof this._groupInternCount !== 'number') {
      this._groupInternCount = Object.keys(this._groupInternTable).length;
    }
  }

  /**
   * Detaches a short string from a huge M3U parent backing buffer so V8/WebKit can GC the file string.
   */
  _detachShortString(str) {
    if (!str || str.length === 0) return '';
    const len = str.length;
    if (len > 256) return str;
    const codes = new Array(len);
    for (let i = 0; i < len; i++) {
      codes[i] = str.charCodeAt(i);
    }
    return String.fromCharCode.apply(null, codes);
  }

  /**
   * Appends comma-delimited HTTP(S) EPG URLs without intermediate split() array allocations.
   */
  _addCommaSeparatedEpgUrls(rawVal, discoveredEpgSet) {
    if (!rawVal) return;
    const len = rawVal.length;
    let start = 0;
    while (start < len) {
      let comma = rawVal.indexOf(',', start);
      if (comma === -1) comma = len;
      let s = start;
      let e = comma;
      while (s < e && rawVal.charCodeAt(s) <= 32) s++;
      while (e > s && rawVal.charCodeAt(e - 1) <= 32) e--;
      if (e - s >= 8) {
        const candidate = rawVal.slice(s, e);
        if (candidate.indexOf('http://') === 0 || candidate.indexOf('https://') === 0) {
          discoveredEpgSet.add(candidate);
        }
      }
      start = comma + 1;
    }
  }

  /**
   * Zero-regex fast-path for header EPG attributes (x-tvg-url, url-tvg, tvg-url, epg-url, tvg-epg).
   */
  _scanHeaderEpgUrls(line, discoveredEpgSet) {
    const fastAttrs = ['url-tvg="', 'x-tvg-url="', 'tvg-url="', 'epg-url="', 'tvg-epg="'];
    let foundAny = false;
    for (let a = 0; a < fastAttrs.length; a++) {
      const needle = fastAttrs[a];
      const idx = line.indexOf(needle);
      if (idx !== -1 && (idx === 0 || line.charCodeAt(idx - 1) <= 32)) {
        const valStart = idx + needle.length;
        const endQ = line.indexOf('"', valStart);
        if (endQ !== -1) {
          this._addCommaSeparatedEpgUrls(line.slice(valStart, endQ), discoveredEpgSet);
          foundAny = true;
        }
      }
    }
    if (foundAny) return;

    HEADER_EPG_ATTR_REGEX.lastIndex = 0;
    let match;
    while ((match = HEADER_EPG_ATTR_REGEX.exec(line)) !== null) {
      const rawVal = (match[1] || match[2] || match[3] || '').trim();
      if (rawVal) {
        this._addCommaSeparatedEpgUrls(rawVal, discoveredEpgSet);
      }
    }
  }

  /**
   * Zero-regex fast-path extractor for core double-quoted #EXTINF attributes
   * (tvg-id, tvg-name, tvg-logo, group-title, catchup-days) within [startPos, endPos).
   */
  extractCoreAttrFast(line, attrName, startPos, endPos) {
    const needle = attrName + '="';
    const needleLen = needle.length;
    let idx = line.indexOf(needle, startPos);
    while (idx !== -1 && idx + needleLen <= endPos) {
      const prev = idx > startPos ? line.charCodeAt(idx - 1) : 32;
      if (prev <= 32) {
        const valStart = idx + needleLen;
        const endQ = line.indexOf('"', valStart);
        if (endQ !== -1 && endQ < endPos) {
          return line.slice(valStart, endQ).trim();
        }
        return '';
      }
      idx = line.indexOf(needle, idx + 1);
    }
    return '';
  }

  /**
   * Parse M3U content string via single-pass indexOf('\n') scanner
   * @param {string} content
   * @param {Object} sourceMeta Optional { id, name, url } for Multi-M3U playlists
   */
  parse(content, sourceMeta) {
    this._ensureParserState();
    if (!content || typeof content !== 'string') {
      this.lastParseStats = { totalParsed: 0, duplicatesSkipped: 0 };
      return { channels: [], categories: [], epgUrl: '', epgUrls: [] };
    }

    const srcId = (sourceMeta && sourceMeta.id) ? sourceMeta.id : 'src_default';
    const srcName = (sourceMeta && sourceMeta.name) ? sourceMeta.name : 'פלייליסט ראשי';
    const srcUrl = (sourceMeta && sourceMeta.url)
      ? sourceMeta.url
      : typeof sourceMeta === 'string'
      ? sourceMeta
      : '';

    const channels = [];
    const categorySet = new Set();
    const categoryMap = new Map();
    const discoveredEpgSet = new Set();
    const seenUrls = Object.create(null);

    // If source URL itself is an Xtream Codes get.php URL, auto-derive xmltv.php URL
    const xtreamFromSource = this.deriveXtreamEpgUrl(srcUrl);
    if (xtreamFromSource) {
      discoveredEpgSet.add(xtreamFromSource);
    }

    let currentItem = null;
    let channelNumber = 1;
    let lineIndex = 0;
    let duplicatesSkipped = 0;
    let pos = 0;
    const len = content.length;

    while (pos < len) {
      let nl = content.indexOf('\n', pos);
      if (nl === -1) nl = len;

      let s = pos;
      let e = nl;
      if (e > s && content.charCodeAt(e - 1) === 13) e--;
      while (s < e && content.charCodeAt(s) <= 32) s++;
      while (e > s && content.charCodeAt(e - 1) <= 32) e--;
      pos = nl + 1;

      const currentLineIdx = lineIndex++;
      if (s >= e) continue;

      const line = content.slice(s, e);
      const firstChar = line.charCodeAt(0);
      if (firstChar === 35) { // '#'
        // Scan first 30 lines for header EPG attributes
        if (currentLineIdx < 30 && line.indexOf('=') !== -1) {
          this._scanHeaderEpgUrls(line, discoveredEpgSet);
        }

        if (line.indexOf('#EXTINF:') === 0) {
          currentItem = this.parseExtInf(line, channelNumber, srcId, srcName);
        } else if (line.indexOf('#EXTGRP:') === 0) {
          if (currentItem) {
            const grp = line.slice(8).trim();
            if (grp) currentItem.group = this.normalizeGroupName(grp);
          }
        }
      } else {
        // Stream URL line
        if (currentItem) {
          // O(1) hash map deduplication of identical stream URLs during parse
          if (seenUrls[line]) {
            duplicatesSkipped++;
            currentItem = null;
            continue;
          }
          seenUrls[line] = true;

          currentItem.url = line;
          currentItem.uid = srcId + '::' + this.hashKey(currentItem.name + '|' + line);
          currentItem.id = currentItem.uid;
          channels.push(currentItem);

          // If no EPG URL found yet, check if stream URL matches Xtream pattern
          if (discoveredEpgSet.size === 0) {
            const xtreamFromStream = this.deriveXtreamEpgFromStreamUrl(line);
            if (xtreamFromStream) {
              discoveredEpgSet.add(xtreamFromStream);
            }
          }

          const group = currentItem.group || 'טלוויזיה חיה';
          categorySet.add(group);
          let catList = categoryMap.get(group);
          if (!catList) {
            catList = [];
            categoryMap.set(group, catList);
          }
          catList.push(currentItem);

          channelNumber++;
          currentItem = null;
        }
      }
    }

    this.epgUrls = Array.from(discoveredEpgSet);
    this.epgUrl = this.epgUrls.length > 0 ? this.epgUrls[0] : '';
    this.channels = channels;
    this.categories = Array.from(categorySet);
    this.categoryMap = categoryMap;
    this.lastParseStats = {
      totalParsed: channels.length,
      duplicatesSkipped: duplicatesSkipped
    };

    return {
      channels: this.channels,
      categories: this.categories,
      categoryMap: this.categoryMap,
      epgUrl: this.epgUrl,
      epgUrls: this.epgUrls
    };
  }

  deriveXtreamEpgUrl(m3uUrl) {
    if (!m3uUrl || typeof m3uUrl !== 'string') return '';
    if (m3uUrl.indexOf('/get.php?') === -1) return '';
    try {
      const m = m3uUrl.match(XTREAM_GET_REGEX);
      if (!m) return '';
      const base = m[1];
      const query = m[2];
      const userMatch = query.match(XTREAM_USER_REGEX);
      const passMatch = query.match(XTREAM_PASS_REGEX);
      if (userMatch && passMatch) {
        return base + '/xmltv.php?username=' + userMatch[1] + '&password=' + passMatch[1];
      }
    } catch (e) {}
    return '';
  }

  deriveXtreamEpgFromStreamUrl(streamUrl) {
    if (!streamUrl || typeof streamUrl !== 'string') return '';
    // Fast zero-regex guard: Xtream stream URLs end with numeric stream ID (or .ts/.m3u8) after 2-3 path segments
    if (streamUrl.indexOf('http://') !== 0 && streamUrl.indexOf('https://') !== 0) return '';
    const dotIdx = streamUrl.lastIndexOf('.');
    const slashIdx = streamUrl.lastIndexOf('/');
    if (slashIdx <= 8) return '';
    const lastSegEnd = dotIdx > slashIdx ? dotIdx : streamUrl.length;
    if (lastSegEnd <= slashIdx + 1) return '';
    const lastChar = streamUrl.charCodeAt(lastSegEnd - 1);
    if (lastChar < 48 || lastChar > 57) return '';

    try {
      const m = streamUrl.match(XTREAM_STREAM_REGEX);
      if (m && m[1] && m[2] && m[3]) {
        const u = m[2].toLowerCase();
        // Avoid false positives on generic paths like /hls/stream/123.m3u8
        if (u !== 'hls' && u !== 'live' && u !== 'stream' && u !== 'tv' && u !== 'play' && u !== 'channels') {
          return m[1] + '/xmltv.php?username=' + encodeURIComponent(m[2]) + '&password=' + encodeURIComponent(m[3]);
        }
      }
    } catch (e) {}
    return '';
  }

  hashKey(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h) + str.charCodeAt(i);
      h = h & h;
    }
    return Math.abs(h).toString(36);
  }

  /**
   * Matches lowercase attribute keys directly by length and charCodes before allocating a lowercase string.
   */
  _matchAttrKeyFast(line, start, end) {
    const kLen = end - start;
    const c0 = line.charCodeAt(start);
    if (kLen === 6 && c0 === 116 && line.indexOf('tvg-id', start) === start) return 'tvg-id';
    if (kLen === 8) {
      if (c0 === 116 && line.indexOf('tvg-name', start) === start) return 'tvg-name';
      if (c0 === 116 && line.indexOf('tvg-logo', start) === start) return 'tvg-logo';
      if (c0 === 116 && line.indexOf('tvg-chno', start) === start) return 'tvg-chno';
    }
    if (kLen === 11 && c0 === 103 && line.indexOf('group-title', start) === start) return 'group-title';
    if (kLen === 12 && c0 === 99 && line.indexOf('catchup-days', start) === start) return 'catchup-days';
    if (kLen === 7 && c0 === 99 && line.indexOf('catchup', start) === start) return 'catchup';
    if (kLen === 14 && c0 === 99 && line.indexOf('catchup-source', start) === start) return 'catchup-source';
    return line.slice(start, end).toLowerCase();
  }

  parseExtInf(line, number, srcId, srcName) {
    const item = {
      id: srcId + '_ch_' + number,
      uid: '',
      sourceId: srcId,
      sourceName: srcName,
      originalNumber: number,
      number: number,
      name: '',
      tvgName: '',
      logo: '',
      group: 'טלוויזיה חיה',
      epgId: '',
      url: '',
      catchupType: '',
      catchupSource: '',
      catchupDays: 7
    };

    // Single-pass zero-regex attribute scanner: fast-path key matching + quote/escape fallback
    const len = line.length;
    let i = 8; // skip '#EXTINF:'
    let commaIndex = -1;

    while (i < len) {
      let c = line.charCodeAt(i);
      while (i < len && c <= 32) {
        c = line.charCodeAt(++i);
      }
      if (i >= len) break;
      if (c === 44) { // ','
        commaIndex = i;
        break;
      }

      const keyStart = i;
      while (i < len) {
        c = line.charCodeAt(i);
        if (c === 61 || c <= 32 || c === 44) break; // '=', whitespace, ','
        i++;
      }

      if (i < len && line.charCodeAt(i) === 61) { // '='
        const key = this._matchAttrKeyFast(line, keyStart, i);
        i++; // skip '='
        while (i < len && line.charCodeAt(i) <= 32) i++;

        let val = '';
        if (i < len) {
          const q = line.charCodeAt(i);
          if (q === 34 || q === 39) { // '"' or "'"
            const valStart = i + 1;
            const endQ = line.indexOf(q === 34 ? '"' : "'", valStart);
            if (endQ !== -1) {
              val = line.slice(valStart, endQ).trim();
              i = endQ + 1;
            } else {
              val = line.slice(valStart).trim();
              i = len;
            }
          } else {
            const valStart = i;
            while (i < len) {
              c = line.charCodeAt(i);
              if (c <= 32 || c === 44) break;
              i++;
            }
            val = line.slice(valStart, i).trim();
          }
        }

        if (val) {
          if (key === 'group-title') {
            item.group = this.normalizeGroupName(val);
          } else if (key === 'tvg-chno' || key === 'channel-number' || key === 'ch-number') {
            const parsedNum = parseInt(val, 10);
            if (!isNaN(parsedNum) && parsedNum > 0) {
              item.number = parsedNum;
              item.originalNumber = parsedNum;
            }
          } else if (key === 'tvg-logo') {
            item.logo = val;
          } else if (key === 'tvg-name') {
            item.tvgName = val;
            if (!item.name) item.name = val;
          } else if (key === 'tvg-id' || key === 'channel-id') {
            item.epgId = val;
          } else if (key === 'catchup') {
            item.catchupType = val.toLowerCase();
          } else if (key === 'catchup-source') {
            item.catchupSource = val;
          } else if (key === 'catchup-days' || key === 'timeshift' || key === 'tvg-rec') {
            const d = parseInt(val, 10);
            if (!isNaN(d) && d > 0) {
              item.catchupDays = Math.min(7, d);
              if (!item.catchupType) {
                item.catchupType = 'flussonic';
              }
            }
          }
        }
      } else if (i < len && line.charCodeAt(i) === 44) {
        commaIndex = i;
        break;
      }
    }

    if (commaIndex !== -1) {
      const parsedName = line.slice(commaIndex + 1).trim();
      if (parsedName) {
        item.name = parsedName;
      }
    }

    if (!item.name) {
      item.name = 'ערוץ ' + number;
    }

    return item;
  }

  /**
   * Interns repeated group-title strings into a lookup table to eliminate duplicate heap strings
   * across 5,000+ channel playlists.
   */
  normalizeGroupName(rawGroup) {
    if (!rawGroup) return 'טלוויזיה חיה';
    this._ensureParserState();
    const trimmed = rawGroup.trim();
    if (!trimmed) return 'טלוויזיה חיה';

    const cached = this._groupInternTable[trimmed];
    if (cached !== undefined) {
      return cached;
    }

    const g = trimmed.toLowerCase();
    let normalized;
    if (g === 'undefined' || g === 'none' || g === 'null' || g === 'uncategorized') {
      normalized = 'טלוויזיה חיה';
    } else {
      normalized = GROUP_NAME_MAP[g] || this._detachShortString(trimmed);
    }

    if (this._groupInternCount >= MAX_GROUP_INTERN_ENTRIES) {
      this._groupInternTable = Object.create(null);
      this._groupInternCount = 0;
    }
    this._groupInternTable[trimmed] = normalized;
    if (this._groupInternTable[normalized] === undefined) {
      this._groupInternTable[normalized] = normalized;
      this._groupInternCount += 2;
    } else {
      this._groupInternCount += 1;
    }
    return normalized;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = M3UParser;
}
