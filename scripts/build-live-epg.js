/**
 * Builds a clean, real-time XMLTV file (epg-il.xml) for Israeli TV channels
 * by fetching and merging:
 *   1. https://epgshare01.online/epgshare01/epg_ripper_IL1.xml.gz
 *   2. https://www.open-epg.com/files/israel1.xml.gz
 * and enriching <channel> tags with standard M3U tvg-id / tvg-name aliases
 * (e.g., Kan11.il@SD, Keshet12.il@SD, Channel13.il@SD, Now14.il@SD, 5Stars.il@SD, etc.)
 * so every Israeli M3U playlist matches 100% of its channels out-of-the-box.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Explicit mapping from standard M3U tvg-ids & display names to XMLTV channel IDs in epgshare01 / open-epg
const CHANNEL_ALIASES = [
  {
    canonicalId: 'Kan11.il@SD',
    sourceIds: ['כאן.11.il', 'ערוץ.11.כאן.שידור.חי.il', 'ערוץ 11 | תאגיד השידור הישראלי.il'],
    aliases: ['Kan11.il@SD', 'Kan11.il', 'Kan 11 (1080p)', 'Kan 11', 'כאן 11', 'כאן 11 HD', 'ערוץ 11']
  },
  {
    canonicalId: 'Keshet12.il@SD',
    sourceIds: ['קשת.il', 'ערוץ.12.שידור.חי.il', 'ערוץ 12 | לוח השידורים המלא של קשת 12.il'],
    aliases: ['Keshet12.il@SD', 'Keshet12.il', 'Keshet 12 (1080p)', 'Keshet 12', 'קשת 12', 'קשת 12 HD', 'ערוץ 12', 'Channel 12']
  },
  {
    canonicalId: 'Channel13.il@SD',
    sourceIds: ['רשת.il', 'ערוץ 13.il'],
    aliases: ['Channel13.il@SD', 'Channel13.il', 'Reshet13.il', 'Channel 13 (1080p)', 'Channel 13 (Israel) (1080p)', 'Reshet 13 (720p)', 'Reshet 13', 'רשת 13', 'ערוץ 13']
  },
  {
    canonicalId: 'Now14.il@SD',
    sourceIds: ['ערוץ.14.HD.il', 'ערוץ.14.שידור.חי.il', 'ערוץ 14.il'],
    aliases: ['Now14.il@SD', 'Now14.il', 'Now 14 (1080p)', 'Now 14', 'עכשיו 14', 'ערוץ 14', 'Channel 14']
  },
  {
    canonicalId: 'Channel9.il@SD',
    sourceIds: ['ערוץ.9.il', 'ערוץ.9.שידור.חי.il', 'ערוץ 9.il'],
    aliases: ['Channel9.il@SD', 'Channel9.il', 'Channel 9 (1080p)', 'Channel 9 (Israel) (1080p)', 'Channel 9', 'ערוץ 9']
  },
  {
    canonicalId: 'Channel24.il@SD',
    sourceIds: ['מוסיקה.24.il', 'ערוץ.24.בשידור.חי.il', 'ערוץ 24.il'],
    aliases: ['Channel24.il@SD', 'Channel24.il', 'Channel 24 (1080p)', 'Channel 24 (Israel) (1080p)', 'Channel 24', 'ערוץ 24', 'מוסיקה 24']
  },
  {
    canonicalId: 'i24NEWSHebrew.il@SD',
    sourceIds: ['עברית.i24.il', 'i24news בעברית.il'],
    aliases: ['i24NEWSHebrew.il@SD', 'I24 News Hebrew (1080p)', 'i24NEWS Hebrew', 'i24NEWS עברית', 'i24 עברית']
  },
  {
    canonicalId: 'i24NEWSEnglishWorld.il@SD',
    sourceIds: ['i24NEWS.ENGLISH.il'],
    aliases: ['i24NEWSEnglishWorld.il@SD', 'i24NEWS English World (1080p)', 'i24NEWS English', 'i24 English']
  },
  {
    canonicalId: 'i24NEWSFrench.il@SD',
    sourceIds: ['i24NEWS.FRENCH.il'],
    aliases: ['i24NEWSFrench.il@SD', 'i24NEWS French (1080p)', 'I24 News French (720p)', 'i24NEWS French']
  },
  {
    canonicalId: 'i24NEWSArabic.il@SD',
    sourceIds: ['i24NEWS.ARABIC.il'],
    aliases: ['i24NEWSArabic.il@SD', 'i24NEWS Arabic (1080p)', 'i24NEWS Arabic']
  },
  {
    canonicalId: '5Sport.il@SD',
    sourceIds: ['5SPORT.HD.il', 'ספורט.5.שידור.חי.il', 'ספורט 5.il'],
    aliases: ['5Sport.il@SD', 'Sport 5', '5 SPORT', 'ספורט 5', 'ערוץ הספורט']
  },
  {
    canonicalId: '5Plus.il@SD',
    sourceIds: ['5PLUS.HD.il', 'ספורט.5.פלוס.il', 'ספורט 5 פלוס.il'],
    aliases: ['5Plus.il@SD', '5Plus (1080p)', '5Plus', '5 PLUS', 'ספורט 5 פלוס', '5+']
  },
  {
    canonicalId: '5Stars.il@SD',
    sourceIds: ['5STARS.il', 'ערוץ.הכוכבים.il'],
    aliases: ['5Stars.il@SD', '5Stars (1080p)', '5Stars', '5 STARS', 'ספורט 5 סטארס', 'ערוץ הכוכבים']
  },
  {
    canonicalId: '5Live.il@SD',
    sourceIds: ['5LIVE.HD.il', 'ספורט.5.לייב.il', 'ספורט 5 פלוס לייב.il'],
    aliases: ['5Live.il@SD', '5Live', '5 LIVE', 'ספורט 5 לייב']
  },
  {
    canonicalId: '5Gold.il@SD',
    sourceIds: ['5GOLD.il', 'ספורט.5.גולד.il', 'ספורט 5 גולד.il'],
    aliases: ['5Gold.il@SD', '5Gold', '5 GOLD', 'ספורט 5 גולד']
  },
  {
    canonicalId: 'OneHD.il@SD',
    sourceIds: ['ONE.HD.il', 'ערוץ.one.שידור.חי.il', 'ערוץ One.il'],
    aliases: ['OneHD.il@SD', 'ONE HD', 'ONE', 'ערוץ ONE']
  },
  {
    canonicalId: 'One2HD.il@SD',
    sourceIds: ['ONE2.HD.il'],
    aliases: ['One2HD.il@SD', 'ONE2 HD', 'ONE 2', 'ערוץ ONE 2']
  },
  {
    canonicalId: 'Sport1.il@SD',
    sourceIds: ['ספורט 1.il'],
    aliases: ['Sport1.il@SD', 'Sport 1', 'ספורט 1']
  },
  {
    canonicalId: 'Sport2.il@SD',
    sourceIds: ['ספורט 2.il'],
    aliases: ['Sport2.il@SD', 'Sport 2', 'ספורט 2']
  },
  {
    canonicalId: 'Sport3.il@SD',
    sourceIds: ['ספורט 3.il'],
    aliases: ['Sport3.il@SD', 'Sport 3', 'ספורט 3']
  },
  {
    canonicalId: 'Sport4.il@SD',
    sourceIds: ['ספורט 4.il'],
    aliases: ['Sport4.il@SD', 'Sport 4', 'ספורט 4']
  },
  {
    canonicalId: 'KanEducational.il@SD',
    sourceIds: ['כאן.חינוכית.il', 'כאן חינוכית.il', 'ערוץ.23.רק.ישראלי.il'],
    aliases: ['KanEducational.il@SD', 'Kan Educational (720p)', 'Kan Educational', 'כאן חינוכית', 'ערוץ 23']
  },
  {
    canonicalId: 'Makan33.il@SD',
    sourceIds: ['מכאן.il', 'ישראל 33.il'],
    aliases: ['Makan33.il@SD', 'Makan 33 (1080p)', 'Makan 33', 'מכאן 33', 'ערוץ 33']
  },
  {
    canonicalId: 'KnessetChannel.il@SD',
    sourceIds: ['ערוץ.הכנסת.il', 'ערוץ הכנסת.il'],
    aliases: ['KnessetChannel.il@SD', 'Knesset Channel (576p)', 'Knesset Channel (480p) [Not 24/7]', 'Knesset Channel', 'ערוץ הכנסת', 'ערוץ 99']
  },
  {
    canonicalId: 'Hidabroot.il@SD',
    sourceIds: ['ערוץ.הידברות.il'],
    aliases: [
      'Hidabroot.il@SD',
      'Hidabroot (1080p)',
      'Hidabroot',
      'הידברות',
      'ערוץ הידברות',
      'KabbalahforthePeopleIsrael.il@SD',
      'Kabbalah for the People (Israel) (504p) [Not 24/7]',
      'Musayof (Israel) (240p) [Not 24/7]',
      'Musayof (Israel)',
      'Musayof',
      'Angel TV Hebrew (720p)',
      'Angel TV Hebrew',
      'AngelTVHebrew.in@SD'
    ]
  },
  {
    canonicalId: 'ComedyChannel.il@SD',
    sourceIds: ['ערוץ.ההומור.il', 'ערוץ.הקומדיות.הקלאסיות.il'],
    aliases: ['ComedyChannel.il@SD', 'Comedy Channel (1080p)', 'Comedy Channel', 'ערוץ ההומור', 'ערוץ הקומדיה']
  },
  {
    canonicalId: 'GoodLife.il@SD',
    sourceIds: ['GOOD.LIFE+.il', 'בית.+.HD.il'],
    aliases: ['GoodLife.il@SD', 'Good Life (576p)', 'Good Life', 'החיים הטובים', 'HealthChannel.il@SD', 'Health Channel (1080p)', 'ערוץ הבריאות']
  },
  {
    canonicalId: 'RealityChannel.il@SD',
    sourceIds: ['ערוץ.הריאליטי.il'],
    aliases: ['RealityChannel.il@SD', 'Reality Channel', 'ערוץ הריאליטי']
  },
  {
    canonicalId: 'VacationChannel.il@SD',
    sourceIds: ['ערוץ.הנופש.il', 'ערוץ.הטיולים.il', 'TRAVEL+.il'],
    aliases: ['VacationChannel.il@SD', 'Vacation Channel', 'ערוץ הנופש', 'ערוץ הטיולים']
  },
  {
    canonicalId: 'VivaPremium.il@SD',
    sourceIds: ['ויוה.פרימיום.il', 'ערוץ.ויוה.שידור.חי.il', 'ערוץ ויוה.il'],
    aliases: ['VivaPremium.il@SD', 'Viva Premium (1080p)', 'Viva Premium', 'ויוה פרימיום', 'ויוה']
  },
  {
    canonicalId: 'YamTichoni.il@SD',
    sourceIds: ['ים.תיכוני.il', 'ים.תיכוני.+.il'],
    aliases: ['YamTichoni.il@SD', 'Yam Tichoni (1080p)', 'Yam Tichoni', 'ים תיכוני', 'ערוץ 25']
  },
  {
    canonicalId: 'TeenNick.il@SD',
    sourceIds: ['ערוץ.TeenNick.il', 'ערוץ טין ניק.il'],
    aliases: ['TeenNick.il@SD', 'TeenNick (406p)', 'TeenNick', 'טין ניק']
  },
  {
    canonicalId: 'Zoom.il@SD',
    sourceIds: ['ZOOM.Toon.il', 'ספיישל.ZOOM.לילדים.il'],
    aliases: ['Zoom.il@SD', 'Zoom (576p)', 'Zoom', 'זום']
  },
  {
    canonicalId: 'Hop.il@SD',
    sourceIds: ['ילדותי.il', 'יויו.il', 'בייבי.HD.il'],
    aliases: ['Hop.il@SD', 'Hop! (1080p)', 'Hop!', 'הופ!', 'ערוץ הופ']
  },
  {
    canonicalId: 'HOTDrama.il@SD',
    sourceIds: ['סלקום.DRAMA.MOVIES.il', 'הוט.בידור.ישראלי.il', 'ערוץ 3.il'],
    aliases: ['HOTDrama.il@SD', 'HOT Drama (1080p)', 'HOT Drama', 'הוט דרמה', 'ShelanuTV.il@SD', 'Shelanu TV (720p)']
  },
  {
    canonicalId: 'HOTZone.il@SD',
    sourceIds: ['ערוץ.האקשן.העולמי.1.il', 'סלקום.סדרות.il'],
    aliases: ['HOTZone.il@SD', 'HOT Zone (1080p)', 'HOT Zone', 'הוט זון']
  },
  {
    canonicalId: 'YesMoviesAction.il@SD',
    sourceIds: ['סלקום.ACTION.MOVIES.il', 'ערוץ.האקשן.העולמי.2.il', 'הוט סינמה 1.il'],
    aliases: ['YesMoviesAction.il@SD', 'Yes Movies Action (1080p)', 'Yes Movies Action', 'יס אקשן', 'Channel16.il@SD', 'Channel 16']
  },
  {
    canonicalId: 'HalaTV.il@SD',
    sourceIds: ['מכאן.il', 'i24NEWS.ARABIC.il'],
    aliases: ['HalaTV.il@SD', 'Hala TV (1080p) [Not 24/7]', 'Hala TV', 'הלא TV']
  }
];

function escapeXml(str) {
  return String(str || '')
    .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function fetchGzXml(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  const buf = Buffer.from(await res.arrayBuffer());
  return zlib.gunzipSync(buf).toString('utf8');
}

function extractProgrammesByChannel(xml) {
  const map = new Map();
  const progRegex = /<programme\s+start="([^"]+)"\s+stop="([^"]+)"\s+channel="([^"]+)"[^>]*>([\s\S]*?)<\/programme>/g;
  let m;
  while ((m = progRegex.exec(xml)) !== null) {
    const start = m[1].trim();
    const stop = m[2].trim();
    const ch = m[3].trim();
    const inner = m[4];
    const titleM = inner.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descM = inner.match(/<desc[^>]*>([\s\S]*?)<\/desc>/i);
    const title = titleM ? titleM[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
    const desc = descM ? descM[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
    if (!title) continue;
    if (!map.has(ch)) map.set(ch, []);
    map.get(ch).push({ start, stop, title, desc });
  }
  return map;
}

async function main() {
  console.log('[EPG Builder] Downloading live Israeli XMLTV feeds...');
  const [xml1, xml2] = await Promise.all([
    fetchGzXml('https://epgshare01.online/epgshare01/epg_ripper_IL1.xml.gz'),
    fetchGzXml('https://www.open-epg.com/files/israel1.xml.gz')
  ]);

  const map1 = extractProgrammesByChannel(xml1);
  const map2 = extractProgrammesByChannel(xml2);

  // Filter window: 36 hours back to 48 hours ahead so file stays compact (~400KB) and ultra-fast to parse on TV!
  const now = new Date();
  const minDate = new Date(now.getTime() - 36 * 3600000);
  const maxDate = new Date(now.getTime() + 48 * 3600000);
  const fmtUtc = (d) =>
    d.getUTCFullYear().toString() +
    ('0' + (d.getUTCMonth() + 1)).slice(-2) +
    ('0' + d.getUTCDate()).slice(-2) +
    ('0' + d.getUTCHours()).slice(-2) +
    ('0' + d.getUTCMinutes()).slice(-2) +
    '00';
  const minStr = fmtUtc(minDate);
  const maxStr = fmtUtc(maxDate);

  let out = '<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="ZenPlay-Live-IL-EPG">\n';
  let totalChs = 0;
  let totalProgs = 0;

  for (const entry of CHANNEL_ALIASES) {
    let progs = [];
    for (const srcId of entry.sourceIds) {
      if (map1.has(srcId) && map1.get(srcId).length > 0) {
        progs = map1.get(srcId);
        break;
      }
      if (map2.has(srcId) && map2.get(srcId).length > 0) {
        progs = map2.get(srcId);
        break;
      }
    }
    if (progs.length === 0) continue;

    const filtered = progs.filter((p) => {
      const s = p.start.slice(0, 14);
      const e = p.stop.slice(0, 14);
      return e >= minStr && s <= maxStr;
    });
    if (filtered.length === 0) continue;

    totalChs++;
    out += '  <channel id="' + escapeXml(entry.canonicalId) + '">\n';
    const allNames = new Set([...entry.aliases, ...entry.sourceIds]);
    for (const alias of allNames) {
      out += '    <display-name>' + escapeXml(alias) + '</display-name>\n';
    }
    out += '  </channel>\n';

    for (const p of filtered) {
      totalProgs++;
      out +=
        '  <programme start="' +
        escapeXml(p.start) +
        '" stop="' +
        escapeXml(p.stop) +
        '" channel="' +
        escapeXml(entry.canonicalId) +
        '">' +
        '<title>' +
        escapeXml(p.title) +
        '</title>' +
        (p.desc ? '<desc>' + escapeXml(p.desc.slice(0, 220)) + '</desc>' : '') +
        '</programme>\n';
    }
  }

  out += '</tv>\n';
  const outPath = path.join(process.cwd(), 'epg-il.xml');
  fs.writeFileSync(outPath, out, 'utf8');
  console.log(
    `[EPG Builder] Wrote ${outPath} (${(out.length / 1024).toFixed(1)} KB, ${totalChs} channels, ${totalProgs} live programmes)`
  );
}

main().catch((err) => {
  console.error('[EPG Builder] Error:', err);
  process.exit(1);
});
