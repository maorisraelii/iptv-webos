/**
 * High-Speed M3U Parser optimized for LG webOS TV (webOS 4.64 & 5.0+)
 * - Extracts all EPG URLs from #EXTM3U headers (url-tvg, x-tvg-url, tvg-url, epg-url, comma-separated, .xml & .xml.gz)
 * - Auto-derives Xtream Codes xmltv.php URLs from M3U / stream URLs when header EPG is omitted
 * - Preserves tvg-id, tvg-name, and display name for high-accuracy EPG channel matching
 */
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

    const lines = content.split(/\r?\n/);
    const channels = [];
    const categorySet = new Set();
    const categoryMap = new Map();
    const discoveredEpgSet = new Set();

    // 1. Scan header lines for url-tvg / x-tvg-url / tvg-url / epg-url (supports double/single quotes & comma-separated URLs)
    const headerScanLimit = Math.min(30, lines.length);
    for (let i = 0; i < headerScanLimit; i++) {
      const hdrLine = lines[i];
      if (!hdrLine || hdrLine.charCodeAt(0) !== 35) continue;
      const attrRegex = /(?:x-tvg-url|url-tvg|tvg-url|epg-url|tvg-epg)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'>]+))/gi;
      let match;
      while ((match = attrRegex.exec(hdrLine)) !== null) {
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

    // 2. If source URL itself is an Xtream Codes get.php URL, auto-derive xmltv.php URL
    const xtreamFromSource = this.deriveXtreamEpgUrl(srcUrl);
    if (xtreamFromSource) {
      discoveredEpgSet.add(xtreamFromSource);
    }

    let currentItem = null;
    let channelNumber = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.indexOf('#EXTINF:') === 0) {
        currentItem = this.parseExtInf(line, channelNumber, srcId, srcName);
      } else if (line.indexOf('#EXTGRP:') === 0) {
        if (currentItem) {
          const grp = line.replace('#EXTGRP:', '').trim();
          if (grp) currentItem.group = this.normalizeGroupName(grp);
        }
      } else if (line.charCodeAt(0) !== 35) {
        // Stream URL line
        if (currentItem) {
          currentItem.url = line;
          currentItem.uid = srcId + '::' + this.hashKey(currentItem.name + '|' + line);
          currentItem.id = currentItem.uid;
          channels.push(currentItem);

          // If no EPG URL found yet, check if stream URL matches Xtream pattern: http(s)://host:port/(live/)?user/pass/id
          if (discoveredEpgSet.size === 0) {
            const xtreamFromStream = this.deriveXtreamEpgFromStreamUrl(line);
            if (xtreamFromStream) {
              discoveredEpgSet.add(xtreamFromStream);
            }
          }

          const group = currentItem.group || 'טלוויזיה חיה';
          categorySet.add(group);
          if (!categoryMap.has(group)) {
            categoryMap.set(group, []);
          }
          categoryMap.get(group).push(currentItem);

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
      const m = m3uUrl.match(/^(https?:\/\/[^\/]+)\/get\.php\?([^#]+)/i);
      if (!m) return '';
      const base = m[1];
      const query = m[2];
      const userMatch = query.match(/(?:^|&)username=([^&]+)/i);
      const passMatch = query.match(/(?:^|&)password=([^&]+)/i);
      if (userMatch && passMatch) {
        return base + '/xmltv.php?username=' + userMatch[1] + '&password=' + passMatch[1];
      }
    } catch (e) {}
    return '';
  }

  deriveXtreamEpgFromStreamUrl(streamUrl) {
    if (!streamUrl || typeof streamUrl !== 'string') return '';
    try {
      // Matches http(s)://host:port/live/USER/PASS/1234.m3u8 or http(s)://host:port/USER/PASS/1234
      const m = streamUrl.match(/^(https?:\/\/[^\/]+)\/(?:live\/)?([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)\/\d+(?:\.[a-z0-9]+)?$/i);
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

    const groupMatch = line.match(/group-title="([^"]*)"/i);
    if (groupMatch && groupMatch[1].trim()) {
      item.group = this.normalizeGroupName(groupMatch[1].trim());
    }

    const chnoMatch = line.match(/(?:tvg-chno|channel-number|ch-number)="([^"]*)"/i);
    if (chnoMatch && chnoMatch[1].trim()) {
      const parsedNum = parseInt(chnoMatch[1].trim(), 10);
      if (!isNaN(parsedNum) && parsedNum > 0) {
        item.number = parsedNum;
        item.originalNumber = parsedNum;
      }
    }

    const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
    if (logoMatch && logoMatch[1].trim()) {
      item.logo = logoMatch[1].trim();
    }

    const nameMatch = line.match(/tvg-name="([^"]*)"/i);
    if (nameMatch && nameMatch[1].trim()) {
      item.tvgName = nameMatch[1].trim();
      item.name = item.tvgName;
    }

    const idMatch = line.match(/(?:tvg-id|channel-id)="([^"]*)"/i);
    if (idMatch && idMatch[1].trim()) {
      item.epgId = idMatch[1].trim();
    }

    // Catch-up / Start-Over attributes
    const catchupMatch = line.match(/catchup="([^"]*)"/i);
    if (catchupMatch && catchupMatch[1].trim()) {
      item.catchupType = catchupMatch[1].trim().toLowerCase();
    }

    const catchupSrcMatch = line.match(/catchup-source="([^"]*)"/i);
    if (catchupSrcMatch && catchupSrcMatch[1].trim()) {
      item.catchupSource = catchupSrcMatch[1].trim();
    }

    const catchupDaysMatch = line.match(/(?:catchup-days|timeshift|tvg-rec)="([^"]*)"/i);
    if (catchupDaysMatch && catchupDaysMatch[1].trim()) {
      const d = parseInt(catchupDaysMatch[1].trim(), 10);
      if (!isNaN(d) && d > 0) {
        item.catchupDays = Math.min(7, d);
        if (!item.catchupType) {
          item.catchupType = 'flussonic';
        }
      }
    }

    const commaIndex = line.lastIndexOf(',');
    if (commaIndex !== -1) {
      const parsedName = line.substring(commaIndex + 1).trim();
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
    const map = {
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
    return map[g] || rawGroup;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = M3UParser;
}
