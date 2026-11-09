/**
 * High-Speed M3U Parser optimized for LG webOS TV (webOS 4.64 & 5.0+)
 * Supports Multi-M3U source tagging, Catch-Up / Start-Over attributes, and Hebrew category normalization.
 */
class M3UParser {
  constructor() {
    this.channels = [];
    this.categories = [];
    this.categoryMap = new Map();
    this.epgUrl = '';
  }

  /**
   * Parse M3U content string
   * @param {string} content
   * @param {Object} sourceMeta Optional { id, name } for Multi-M3U playlists
   */
  parse(content, sourceMeta) {
    if (!content || typeof content !== 'string') {
      return { channels: [], categories: [], epgUrl: '' };
    }

    const srcId = (sourceMeta && sourceMeta.id) ? sourceMeta.id : 'src_default';
    const srcName = (sourceMeta && sourceMeta.name) ? sourceMeta.name : 'פלייליסט ראשי';

    const lines = content.split(/\r?\n/);
    const channels = [];
    const categorySet = new Set();
    const categoryMap = new Map();

    // Check for EPG URL in header
    let epgUrl = '';
    const headerScanLimit = Math.min(15, lines.length);
    for (let i = 0; i < headerScanLimit; i++) {
      const epgMatch = lines[i].match(/(?:url-tvg|x-tvg-url)="([^"]+)"/i);
      if (epgMatch && epgMatch[1].trim()) {
        epgUrl = epgMatch[1].trim();
        break;
      }
    }
    this.epgUrl = epgUrl;

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
        // Not starting with '#' -> Stream URL line
        if (currentItem) {
          currentItem.url = line;
          currentItem.uid = srcId + '::' + this.hashKey(currentItem.name + '|' + line);
          currentItem.id = currentItem.uid;
          channels.push(currentItem);

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

    this.channels = channels;
    this.categories = Array.from(categorySet);
    this.categoryMap = categoryMap;

    return {
      channels: this.channels,
      categories: this.categories,
      categoryMap: this.categoryMap,
      epgUrl: this.epgUrl
    };
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

    const chnoMatch = line.match(/tvg-chno="([^"]*)"/i);
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
      item.name = nameMatch[1].trim();
    }

    const idMatch = line.match(/tvg-id="([^"]*)"/i);
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

    const catchupDaysMatch = line.match(/(?:catchup-days|timeshift)="([^"]*)"/i);
    if (catchupDaysMatch && catchupDaysMatch[1].trim()) {
      const d = parseInt(catchupDaysMatch[1].trim(), 10);
      if (!isNaN(d) && d > 0) item.catchupDays = Math.min(7, d);
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
