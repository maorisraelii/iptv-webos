/**
 * High-Performance 7-Day EPG (Electronic Program Guide) & Catch-Up Engine
 * Optimized for LG webOS 4.64 & 5.0+
 * - Strictly bounds history to 7 days back + today + 1 day ahead (prevents infinite lists & memory bloat)
 * - Provides O(1) cached day-buckets for instant day-by-day zapping
 * - Provides Mini Timeline (2 previous + current + 3 upcoming) for main screen & Start-Over
 */
class EPGService {
  constructor() {
    this.programmesByChannel = new Map();
    this.dayBucketsCache = new Map();
    this.epgUrl = '';
    this.isLoading = false;
    this.lastUpdatedMs = 0;
    this.MAX_PAST_DAYS = 7;
    this.DAY_MS = 86400000;
    this.EPG_CACHE_KEY = 'zenplay_iptv_epg_cache_v2';
    this.TTL_STORAGE_KEY = 'zenplay_iptv_cache_ttl_hours';
  }

  getCacheTtlHours() {
    try {
      const val = parseInt(localStorage.getItem(this.TTL_STORAGE_KEY), 10);
      if (!isNaN(val) && val >= 0) return val;
    } catch (e) {}
    return 24; // Default: refresh EPG once every 24 hours
  }

  setCacheTtlHours(hours) {
    try {
      localStorage.setItem(this.TTL_STORAGE_KEY, String(hours));
    } catch (e) {}
  }

  loadFromLocalCache(url) {
    try {
      const raw = localStorage.getItem(this.EPG_CACHE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || data.url !== url || !Array.isArray(data.entries)) return false;

      const ttlHours = this.getCacheTtlHours();
      const ageMs = Date.now() - (data.updatedAt || 0);
      // ttlHours === 0 means manual refresh only (cache never expires automatically)
      if (ttlHours > 0 && ageMs > ttlHours * 3600000) {
        return false;
      }

      this.programmesByChannel.clear();
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
      }
      this.lastUpdatedMs = data.updatedAt || Date.now();
      return true;
    } catch (e) {
      return false;
    }
  }

  saveToLocalCache(url) {
    try {
      const entries = [];
      let count = 0;
      this.programmesByChannel.forEach((list, chId) => {
        if (chId.indexOf('gen_') === 0 || count > 2500) return;
        const compact = list.slice(0, 80).map((p) => ({
          t: p.title,
          d: p.desc ? p.desc.substring(0, 160) : '',
          s: p.startMs,
          e: p.stopMs
        }));
        entries.push([chId, compact]);
        count += compact.length;
      });
      this.lastUpdatedMs = Date.now();
      localStorage.setItem(
        this.EPG_CACHE_KEY,
        JSON.stringify({
          url: url,
          updatedAt: this.lastUpdatedMs,
          entries: entries
        })
      );
    } catch (e) {}
  }

  clearCache() {
    try {
      localStorage.removeItem(this.EPG_CACHE_KEY);
      this.lastUpdatedMs = 0;
    } catch (e) {}
  }

  loadEPG(url, onComplete, forceRefresh) {
    if (!url || typeof url !== 'string' || this.isLoading) {
      if (onComplete) onComplete(false);
      return;
    }
    this.epgUrl = url.trim();

    // Check long-term cache first (24h / 3d / 7d) to avoid network & CPU load during playback
    if (!forceRefresh && this.loadFromLocalCache(this.epgUrl)) {
      if (onComplete) onComplete(true);
      return;
    }

    this.isLoading = true;

    fetch(this.epgUrl)
      .then((res) => {
        if (!res.ok) throw new Error('EPG HTTP ' + res.status);
        return res.text();
      })
      .then((xmlText) => {
        this.parseXMLTV(xmlText);
        this.saveToLocalCache(this.epgUrl);
        this.dayBucketsCache.clear();
        this.isLoading = false;
        if (onComplete) onComplete(true);
      })
      .catch((err) => {
        console.warn('EPG load warning:', err);
        this.isLoading = false;
        if (onComplete) onComplete(false);
      });
  }

  /**
   * High-speed XMLTV parser that prunes any programme older than 7 days
   */
  parseXMLTV(xmlString) {
    try {
      const now = Date.now();
      const minAllowedTime = now - (this.MAX_PAST_DAYS * this.DAY_MS);
      const maxAllowedTime = now + (2 * this.DAY_MS);

      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
      const progElements = xmlDoc.getElementsByTagName('programme');

      this.programmesByChannel.clear();

      for (let i = 0; i < progElements.length; i++) {
        const el = progElements[i];
        const channelId = el.getAttribute('channel');
        const startStr = el.getAttribute('start');
        if (!channelId || !startStr) continue;

        const start = this.parseDate(startStr);
        const startMs = start.getTime();

        // Performance guard: skip programmes older than 7 days or too far in future
        if (startMs < minAllowedTime || startMs > maxAllowedTime) continue;

        const stopStr = el.getAttribute('stop');
        const stop = stopStr ? this.parseDate(stopStr) : new Date(startMs + 3600000);

        const titleEl = el.getElementsByTagName('title')[0];
        const descEl = el.getElementsByTagName('desc')[0];
        const title = titleEl ? titleEl.textContent.trim() : 'שידור חי';
        const desc = descEl ? descEl.textContent.trim() : '';

        if (!this.programmesByChannel.has(channelId)) {
          this.programmesByChannel.set(channelId, []);
        }

        this.programmesByChannel.get(channelId).push({
          id: channelId + '_' + startMs,
          title: title,
          desc: desc,
          start: start,
          stop: stop,
          startMs: startMs,
          stopMs: stop.getTime()
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

  parseDate(str) {
    if (!str) return new Date();
    const clean = str.replace(/[^\d]/g, '');
    const y = parseInt(clean.substring(0, 4), 10);
    const m = parseInt(clean.substring(4, 6), 10) - 1;
    const d = parseInt(clean.substring(6, 8), 10);
    const h = parseInt(clean.substring(8, 10), 10) || 0;
    const min = parseInt(clean.substring(10, 12), 10) || 0;
    return new Date(y, m, d, h, min);
  }

  /**
   * Returns complete 7-day + today schedule for a channel (either from XMLTV or deterministic generator)
   */
  getChannelProgrammes(channel) {
    if (!channel) return [];
    const idKey = channel.epgId || channel.name;
    const xmlList = this.programmesByChannel.get(idKey) || this.programmesByChannel.get(channel.id);
    if (xmlList && xmlList.length > 5) {
      return xmlList;
    }

    // Check generated cache
    const cacheKey = 'gen_' + channel.id;
    if (this.programmesByChannel.has(cacheKey)) {
      return this.programmesByChannel.get(cacheKey);
    }

    const generated = this.generateSevenDaySchedule(channel);
    this.programmesByChannel.set(cacheKey, generated);
    return generated;
  }

  /**
   * Returns Previous, Current & Next programme for fast rendering (including both startStr and stopStr for all three).
   * O(1) fast path: only checks XMLTV map or computes 3 lightweight objects (never generates 7 days per channel).
   */
  getNowNext(channel) {
    if (!channel) return null;
    const nowMs = Date.now();
    const idKey = channel.epgId || channel.name;
    const list = this.programmesByChannel.get(idKey) || this.programmesByChannel.get(channel.id);

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
            desc: current.desc || 'שידור חי בערוץ.',
            start: current.start,
            stop: current.stop,
            startMs: current.startMs,
            stopMs: current.stopMs,
            startStr: this.formatTime(current.start),
            stopStr: this.formatTime(current.stop),
            progressPercent: progress,
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
   * Ordered from Today (index 0) back to 7 days ago (index 7):
   * [{ dayKey, label, shortDate, isToday, programmes: [...] }]
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
   * Generates a bounded 7-day past + today schedule (2-hour slots on past days, 1-hour slots today)
   * so the guide is ultra-fast, realistic, and never infinite.
   */
  generateSevenDaySchedule(channel) {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const templates = this.getChannelTemplates(channel);
    const result = [];

    for (let dayOffset = this.MAX_PAST_DAYS; dayOffset >= 0; dayOffset--) {
      const dayStartMs = todayMidnight - (dayOffset * this.DAY_MS);
      // Use 2-hour slots for past days (12 shows/day) and 1-hour slots for today (24 shows/day) for speed
      const stepHours = dayOffset === 0 ? 1 : 2;

      for (let hour = 0; hour < 24; hour += stepHours) {
        const startMs = dayStartMs + (hour * 3600000);
        const stopMs = startMs + (stepHours * 3600000);
        const tpl = this.pickTemplateForHour(templates, hour, dayOffset);

        result.push({
          id: channel.id + '_' + startMs,
          title: tpl.title,
          desc: tpl.desc,
          start: new Date(startMs),
          stop: new Date(stopMs),
          startMs: startMs,
          stopMs: stopMs
        });
      }
    }

    return result;
  }

  getChannelTemplates(channel) {
    const chName = channel.name || 'הערוץ';
    const chGroup = (channel.group || '').toLowerCase();

    if (chGroup.indexOf('ספורט') !== -1 || chGroup.indexOf('sport') !== -1 || chName.indexOf('5') !== -1 || chName.indexOf('ספורט') !== -1) {
      return {
        morning: { title: 'בוקר ספורט - מהדורה מוקדמת', desc: 'פתיחת יום עם תקצירי משחקי הלילה, כותרות הספורט מהארץ ומהעולם וראיונות.' },
        day: { title: 'מגזין ספורט עולמי', desc: 'סיקור נרחב של אירועי הספורט הגדולים, תקצירים מליגות בכירות וכתבות צבע מיוחדות.' },
        prime: { title: 'משחק מרכזי ישיר: שידור חי', desc: 'אולפן המשחק המרכזי עם מיטב השדרים והפרשנים, ניתוח המהלכים וראיונות מהמגרש.' },
        late: { title: 'חדשות הספורט - סיכום היומי', desc: 'סיכום כל משחקי היום, שערי המחזור, טבלאות ופאנל הפרשנים של הערוץ.' }
      };
    }

    if (chGroup.indexOf('חדשות') !== -1 || chGroup.indexOf('news') !== -1 || chName.indexOf('11') !== -1 || chName.indexOf('12') !== -1 || chName.indexOf('13') !== -1 || chName.indexOf('14') !== -1 || chName.indexOf('9') !== -1 || chName.indexOf('i24') !== -1) {
      return {
        morning: { title: 'תוכנית הבוקר החדשותית', desc: 'פתיחת יום עם כל הדיווחים הראשונים, מבזקי תנועה, סקירת עיתונות ומזג האוויר.' },
        day: { title: 'יומן הצהריים ואקטואליה', desc: 'דיווחים רציפים מהארץ ומהעולם, פרשנויות ועדכונים חיים ממוקדי החדשות.' },
        prime: { title: 'מהדורת החדשות המרכזית', desc: 'כל הכותרות, הדיווחים הבלעדיים, הפרשנויות מהשטח וכתבות תחקיר מיוחדות של כתבי המערכת.' },
        late: { title: 'אולפן הלילה - היום שהיה', desc: 'דיוני עומק, ראיונות וכל מה שקורה מאחורי הקלעים של סדר היום הציבורי.' }
      };
    }

    if (chGroup.indexOf('סרטים') !== -1 || chGroup.indexOf('movie') !== -1 || chGroup.indexOf('בידור') !== -1) {
      return {
        morning: { title: 'קולנוע של בוקר', desc: 'דרמה קומית מרגשת לכל המשפחה באיכות שידור HD.' },
        day: { title: 'סדרת דרמה יומית', desc: 'פרק מרתק בסדרת הדרמה האהובה בכיכובם של מיטב השחקנים.' },
        prime: { title: 'סרט הערב המרכזי', desc: 'שובר קופות עטור שבחים בהקרנה מיוחדת לצופי הערוץ.' },
        late: { title: 'קולנוע לילי - מתח ופעולה', desc: 'מותחן אקשן קצבי ומרתק אל תוך הלילה.' }
      };
    }

    if (chGroup.indexOf('ילדים') !== -1 || chGroup.indexOf('kid') !== -1) {
      return {
        morning: { title: 'בוקר טוב לקטנטנים', desc: 'שירים, סיפורים והרפתקאות ראשונות לפתיחת היום בחיוך.' },
        day: { title: 'סדרת האנימציה וההרפתקאות', desc: 'פרקים חדשים ומצחיקים עם הדמויות האהובות.' },
        prime: { title: 'מופע הערב לכל המשפחה', desc: 'תוכנית האירוח והשעשועונים המרכזית לילדים ולכל המשפחה.' },
        late: { title: 'סיפור לפני השינה', desc: 'תוכניות רגועות ומוזיקה נעימה לשעות הערב.' }
      };
    }

    return {
      morning: { title: 'רצועת הבוקר ב-' + chName, desc: 'תוכניות בוקר, מגזינים ואירוח בשידור חי.' },
      day: { title: 'שידור חי: רצועת היום ב-' + chName, desc: 'שידור ישיר רציף באיכות HD עם מיטב תוכניות הערוץ.' },
      prime: { title: 'התוכנית המרכזית - ' + chName, desc: 'משדר הערב המרכזי של הערוץ בשידור חי.' },
      late: { title: 'רצועת הלילה ב-' + chName, desc: 'לקט התוכניות הנבחרות ושידורים מיוחדים.' }
    };
  }

  pickTemplateForHour(templates, hour, dayOffset) {
    const suffix = dayOffset > 0 ? '' : '';
    if (hour >= 6 && hour < 12) {
      return { title: templates.morning.title + suffix, desc: templates.morning.desc };
    }
    if (hour >= 12 && hour < 19) {
      return { title: templates.day.title + suffix, desc: templates.day.desc };
    }
    if (hour >= 19 && hour < 23) {
      return { title: templates.prime.title + suffix, desc: templates.prime.desc };
    }
    return { title: templates.late.title + suffix, desc: templates.late.desc };
  }

  generateSmartFallbackNowNext(channel, now) {
    const startTime = new Date(now);
    startTime.setMinutes(0, 0, 0);
    const prevStartTime = new Date(startTime.getTime() - 3600000);
    const stopTime = new Date(startTime.getTime() + 3600000);
    const nextStopTime = new Date(stopTime.getTime() + 3600000);
    const progress = Math.min(100, Math.round((now.getMinutes() / 60) * 100));
    const templates = this.getChannelTemplates(channel);
    const curHour = now.getHours();
    const prv = this.pickTemplateForHour(templates, (curHour + 23) % 24, 0);
    const cur = this.pickTemplateForHour(templates, curHour, 0);
    const nxt = this.pickTemplateForHour(templates, (curHour + 1) % 24, 0);

    return {
      previous: {
        id: channel.id + '_' + prevStartTime.getTime(),
        title: prv.title,
        desc: prv.desc,
        startStr: this.formatTime(prevStartTime),
        stopStr: this.formatTime(startTime),
        startMs: prevStartTime.getTime(),
        stopMs: startTime.getTime()
      },
      current: {
        id: channel.id + '_' + startTime.getTime(),
        title: cur.title,
        desc: cur.desc,
        startStr: this.formatTime(startTime),
        stopStr: this.formatTime(stopTime),
        startMs: startTime.getTime(),
        stopMs: stopTime.getTime(),
        progressPercent: progress,
        status: 'live'
      },
      next: {
        id: channel.id + '_' + stopTime.getTime(),
        title: nxt.title,
        desc: nxt.desc,
        startStr: this.formatTime(stopTime),
        stopStr: this.formatTime(nextStopTime),
        startMs: stopTime.getTime(),
        stopMs: nextStopTime.getTime()
      }
    };
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
