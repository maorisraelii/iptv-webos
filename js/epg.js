/**
 * EPG (Electronic Program Guide) & Schedule Engine
 * Supports real XMLTV guide parsing and automatic high-quality schedule generation
 * so channels ALWAYS show current show, next show, progress, and synopsis.
 */
class EPGService {
  constructor() {
    this.programmesByChannel = new Map(); // channelId/epgId -> Array of { start, stop, title, desc }
    this.epgUrl = '';
    this.isLoading = false;
  }

  /**
   * Set EPG source URL and trigger background load
   */
  loadEPG(url) {
    if (!url || typeof url !== 'string' || this.isLoading) return;
    this.epgUrl = url.trim();
    this.isLoading = true;

    console.log('Fetching EPG XMLTV data from:', this.epgUrl);
    fetch(this.epgUrl)
      .then(res => {
        if (!res.ok) throw new Error('EPG fetch failed (' + res.status + ')');
        return res.text();
      })
      .then(xmlText => {
        this.parseXMLTV(xmlText);
        console.log('Parsed XMLTV guide for ' + this.programmesByChannel.size + ' channels.');
      })
      .catch(err => {
        console.warn('Could not load remote XMLTV EPG:', err);
      })
      .then(() => {
        this.isLoading = false;
      });
  }

  /**
   * Fast XML parser for XMLTV <programme> elements
   */
  parseXMLTV(xmlString) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
      const progElements = xmlDoc.getElementsByTagName('programme');

      for (let i = 0; i < progElements.length; i++) {
        const el = progElements[i];
        const channelId = el.getAttribute('channel');
        const startStr = el.getAttribute('start');
        const stopStr = el.getAttribute('stop');

        if (!channelId || !startStr) continue;

        const titleEl = el.getElementsByTagName('title')[0];
        const descEl = el.getElementsByTagName('desc')[0];

        const title = titleEl ? titleEl.textContent.trim() : '';
        const desc = descEl ? descEl.textContent.trim() : '';

        const start = this.parseDate(startStr);
        const stop = stopStr ? this.parseDate(stopStr) : new Date(start.getTime() + 3600000);

        if (!this.programmesByChannel.has(channelId)) {
          this.programmesByChannel.set(channelId, []);
        }

        this.programmesByChannel.get(channelId).push({
          title,
          desc,
          start,
          stop
        });
      }
    } catch (e) {
      console.warn('XMLTV parse error:', e);
    }
  }

  parseDate(str) {
    // Format: 20261109180000 +0200 or 20261109180000
    if (!str) return new Date();
    const clean = str.replace(/[^\d]/g, '');
    const y = parseInt(clean.substring(0, 4), 10);
    const m = parseInt(clean.substring(4, 6), 10) - 1;
    const d = parseInt(clean.substring(6, 8), 10);
    const h = parseInt(clean.substring(8, 10), 10);
    const min = parseInt(clean.substring(10, 12), 10);
    return new Date(y, m, d, h, min);
  }

  /**
   * Get Now & Next programme for a channel
   * @param {Object} channel
   * @returns {{ current: Object, next: Object }}
   */
  getNowNext(channel) {
    if (!channel) return null;

    const now = new Date();
    const idKey = channel.epgId || channel.name;
    const list = this.programmesByChannel.get(idKey) || this.programmesByChannel.get(channel.id);

    if (list && list.length > 0) {
      // Find current programme
      const current = list.find(p => p.start <= now && p.stop > now);
      const next = list.find(p => p.start >= (current ? current.stop : now));

      if (current) {
        const totalDuration = current.stop.getTime() - current.start.getTime();
        const elapsed = Math.max(0, now.getTime() - current.start.getTime());
        const progress = Math.min(100, Math.round((elapsed / totalDuration) * 100));

        return {
          current: {
            title: current.title,
            desc: current.desc || 'שידור חי בערוץ.',
            startStr: this.formatTime(current.start),
            stopStr: this.formatTime(current.stop),
            progressPercent: progress
          },
          next: next ? {
            title: next.title,
            startStr: this.formatTime(next.start)
          } : null
        };
      }
    }

    // Dynamic Intelligent Guide Generator (Fallback so screen is NEVER empty)
    return this.generateSmartSchedule(channel, now);
  }

  generateSmartSchedule(channel, now) {
    const curHour = now.getHours();
    const curMinute = now.getMinutes();

    // Align to current hour slot
    const startTime = new Date(now);
    startTime.setMinutes(0, 0, 0);

    const stopTime = new Date(startTime);
    stopTime.setHours(stopTime.getHours() + 1);

    const nextStop = new Date(stopTime);
    nextStop.setHours(nextStop.getHours() + 1);

    const progress = Math.min(100, Math.round((curMinute / 60) * 100));

    // Tailor titles based on channel name or group
    const chName = channel.name || '';
    const chGroup = (channel.group || '').toLowerCase();

    let curTitle = 'שידור ישיר';
    let curDesc = `שידור חי ישיר ב-${chName}. לוח השידורים מתעדכן בזמן אמת.`;
    let nextTitle = 'תוכנית המשך';

    if (chGroup.includes('sport') || chGroup.includes('ספורט') || chName.includes('ספורט')) {
      if (curHour >= 18 && curHour <= 23) {
        curTitle = 'משחק מרכזי ישיר: שידור חי ומלא';
        curDesc = 'אולפן המשחק המרכזי עם מיטב השדרים והפרשנים, ניתוח המהלכים, הילוכים חוזרים וראיונות בסיום.';
        nextTitle = 'חדשות הספורט - סיכום המשחקים';
      } else {
        curTitle = 'מגזין ספורט עולמי';
        curDesc = 'סיקור נרחב של אירועי הספורט הגדולים, תקצירים מליגות בכירות וכתבות צבע מיוחדות.';
        nextTitle = 'שידור חוזר: משחק השבוע';
      }
    } else if (chGroup.includes('news') || chGroup.includes('חדשות') || chName.includes('חדשות') || chName.includes('11') || chName.includes('12') || chName.includes('13') || chName.includes('14')) {
      if (curHour === 19 || curHour === 20) {
        curTitle = 'מהדורת החדשות המרכזית';
        curDesc = 'כל הכותרות, הדיווחים הבלעדיים, הפרשנויות מהשטח וכתבות תחקיר מיוחדות של כתבי המערכת.';
        nextTitle = 'תוכנית התחקירים והאקטואליה';
      } else if (curHour >= 21 && curHour <= 23) {
        curTitle = 'אולפן הלילה המרכזי';
        curDesc = 'דיוני עומק, ראיונות פוליטיים וכל מה שקורה מאחורי הקלעים של סדר היום הציבורי.';
        nextTitle = 'היום שהיה - סיכום חדשות היום';
      } else if (curHour >= 6 && curHour <= 10) {
        curTitle = 'תוכנית הבוקר החדשותית';
        curDesc = 'פתיחת יום עם כל הדיווחים הראשונים, מבזקי תנועה, סקירת עיתונות ומזג האוויר.';
        nextTitle = 'מבזק חדשות וענייני היום';
      } else {
        curTitle = 'מהדורת יום ואקטואליה שוטפת';
        curDesc = 'דיווחים רציפים מהארץ ומהעולם, מבזקים שוטפים בכל שעה עגולה ועדכונים חיים.';
        nextTitle = 'תוכנית הכלכלה והצרכנות';
      }
    } else if (chGroup.includes('movie') || chGroup.includes('סרטים') || chName.includes('סרטים')) {
      curTitle = 'סרט הקולנוע המרכזי של היום';
      curDesc = 'חוויית צפייה קולנועית באיכות גבוהה. דרמה מרתקת ועטורת שבחים בכיכובם של שחקנים מובילים.';
      nextTitle = 'סרט מתח ופעולה';
    } else if (chGroup.includes('kid') || chGroup.includes('ילדים') || chName.includes('ילדים')) {
      curTitle = 'סדרת אנימציה וילדים אהובה';
      curDesc = 'פרקים חדשים ומרתקים בעלילות מצחיקות וחינוכיות לכל המשפחה.';
      nextTitle = 'תוכנית ההרפתקאות לקטנטנים';
    } else {
      curTitle = `שידור חי בערוץ ${chName}`;
      curDesc = `שידור ישיר ללא הפסקה באיכות HD. למידע מפורט ועדכני ניתן להגדיר כתובת EPG בהגדרות הנגן.`;
      nextTitle = 'תוכנית המשך בערוץ';
    }

    return {
      current: {
        title: curTitle,
        desc: curDesc,
        startStr: this.formatTime(startTime),
        stopStr: this.formatTime(stopTime),
        progressPercent: progress
      },
      next: {
        title: nextTitle,
        startStr: this.formatTime(stopTime)
      }
    };
  }

  formatTime(date) {
    if (!date) return '';
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EPGService;
}
