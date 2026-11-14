/**
 * High-Speed M3U Parser optimized for LG webOS TV (webOS 4.64 & 5.0+)
 * - Extracts all EPG URLs from #EXTM3U headers (url-tvg, x-tvg-url, tvg-url, epg-url, comma-separated, .xml & .xml.gz)
 * - Auto-derives Xtream Codes xmltv.php URLs from M3U / stream URLs when header EPG is omitted
 * - Preserves tvg-id, tvg-name, and display name for high-accuracy EPG channel matching
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

class M3UParser {
  constructor() {
    this.channels = [];
    this.categories = [];
    this.categoryMap = new Map();
    this.epgUrl = '';
    this.epgUrls = [];
  }

  /**
   * Parse M3U content string
   * @param {string} content
   * @param {Object} sourceMeta Optional { id, name, url } for Multi-M3U playlists
   */
  parse(content, sourceMeta) {
    if (!content || typeof content !== 'string') {
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

    // 2. If source URL itself is an Xtream Codes get.php URL, auto-derive xmltv.php URL
    const xtreamFromSource = this.deriveXtreamEpgUrl(srcUrl);
    if (xtreamFromSource) {
      discoveredEpgSet.add(xtreamFromSource);
    }

    let currentItem = null;
    let channelNumber = 1;
    let lineIndex = 0;
    let pos = 0;
    const len = content.length;

    while (pos < len) {
      let nl = content.indexOf('\n', pos);
      if (nl === -1) nl = len;
      const rawLine = content.slice(pos, nl);
      pos = nl + 1;

      const line = rawLine.trim();
      const currentLineIdx = lineIndex++;
      if (!line) continue;

      const firstChar = line.charCodeAt(0);
      if (firstChar === 35) { // '#'
        // 1. Scan first 30 lines for header EPG attributes
        if (currentLineIdx < 30 && line.indexOf('=') !== -1) {
          HEADER_EPG_ATTR_REGEX.lastIndex = 0;
          let match;
          while ((match = HEADER_EPG_ATTR_REGEX.exec(line)) !== null) {
            const rawVal = (match[1] || match[2] || match[3] || '').trim();
            if (rawVal) {
              const parts = rawVal.split(',');
              for (let p = 0; p < parts.length; p++) {
                const candidate = parts[p].trim();
                if (candidate && (candidate.indexOf('http://') === 0 || candidate.indexOf('https://') === 0)) {
                  discoveredEpgSet.add(candidate);
                }
              }
            }
          }
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

    // Single-pass attribute scanner: avoids 8 separate regex scans & handles both " and ' quotes
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
        const key = line.slice(keyStart, i).toLowerCase();
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

  normalizeGroupName(rawGroup) {
    if (!rawGroup) return 'טלוויזיה חיה';
    const g = rawGroup.trim().toLowerCase();
    if (g === 'undefined' || g === 'none' || g === 'null' || g === 'uncategorized') return 'טלוויזיה חיה';
    return GROUP_NAME_MAP[g] || rawGroup;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = M3UParser;
}
