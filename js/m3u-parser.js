/**
 * M3U Parser optimized for LG webOS TV
 * Handles large playlists without blocking the UI thread
 */
class M3UParser {
  constructor() {
    this.channels = [];
    this.categories = [];
    this.categoryMap = new Map();
  }

  /**
   * Parse M3U content string
   * @param {string} content 
   * @returns {{channels: Array, categories: Array}}
   */
  parse(content) {
    if (!content || typeof content !== 'string') {
      return { channels: [], categories: [] };
    }

    const lines = content.split(/\r?\n/);
    const channels = [];
    const categorySet = new Set();
    const categoryMap = new Map();

    let currentItem = null;
    let channelNumber = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#EXTINF:')) {
        currentItem = this.parseExtInf(line, channelNumber);
      } else if (line.startsWith('#EXTVLCOPT:') || line.startsWith('#EXTGRP:')) {
        if (currentItem && line.startsWith('#EXTGRP:')) {
          const grp = line.replace('#EXTGRP:', '').trim();
          if (grp) currentItem.group = grp;
        }
      } else if (!line.startsWith('#')) {
        // Stream URL line
        if (currentItem) {
          currentItem.url = line;
          channels.push(currentItem);

          const group = currentItem.group || 'אחר / שונות';
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
    this.categories = Array.from(categorySet).sort((a, b) => a.localeCompare(b, 'he'));
    this.categoryMap = categoryMap;

    return {
      channels: this.channels,
      categories: this.categories,
      categoryMap: this.categoryMap
    };
  }

  /**
   * Parse a single #EXTINF line
   */
  parseExtInf(line, number) {
    // Extract attributes like tvg-name, tvg-logo, group-title
    const item = {
      id: 'ch_' + number,
      number: number,
      name: '',
      logo: '',
      group: 'כללי',
      epgId: '',
      url: ''
    };

    // Extract group-title
    const groupMatch = line.match(/group-title="([^"]*)"/i);
    if (groupMatch && groupMatch[1].trim()) {
      item.group = groupMatch[1].trim();
    }

    // Extract tvg-logo
    const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
    if (logoMatch && logoMatch[1].trim()) {
      item.logo = logoMatch[1].trim();
    }

    // Extract tvg-name
    const nameMatch = line.match(/tvg-name="([^"]*)"/i);
    if (nameMatch && nameMatch[1].trim()) {
      item.name = nameMatch[1].trim();
    }

    // Extract tvg-id
    const idMatch = line.match(/tvg-id="([^"]*)"/i);
    if (idMatch && idMatch[1].trim()) {
      item.epgId = idMatch[1].trim();
    }

    // Extract Channel Name from end of comma
    const commaIndex = line.lastIndexOf(',');
    if (commaIndex !== -1) {
      const parsedName = line.substring(commaIndex + 1).trim();
      if (parsedName) {
        item.name = parsedName;
      }
    }

    if (!item.name) {
      item.name = `ערוץ ${number}`;
    }

    return item;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = M3UParser;
}
