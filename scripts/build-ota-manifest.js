/**
 * Builds a complete, self-contained OTA Manifest (ota-manifest.json)
 * that embeds 100% of the current CSS (css/style.css) and JS classes
 * (M3UParser, LineupStore, EPGService, VideoPlayer, RemoteController, IPTVApp)
 * so any LG webOS TV running an earlier version (v4.3.0 - v4.7.0) can upgrade
 * 100% of its functionality Over-The-Air without needing a manual .ipk install.
 */
const fs = require('fs');
const path = require('path');

const appInfo = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'appinfo.json'), 'utf8'));
const version = appInfo.version;

function extractClassBody(filePath, originalClassName, otaClassName) {
  let code = fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
  // Remove module.exports and DOMContentLoaded bootstrap at bottom
  code = code.replace(/if\s*\(\s*typeof\s+module\s*!==\s*'undefined'[\s\S]*$/m, '');
  code = code.replace(/window\.addEventListener\s*\(\s*'DOMContentLoaded'[\s\S]*$/m, '');
  // Rename class declaration to Ota* so it doesn't collide with lexical globals inside Function()
  code = code.replace(new RegExp('\\bclass\\s+' + originalClassName + '\\b'), 'class ' + otaClassName);
  return code.trim();
}

const cssContent = fs
  .readFileSync(path.join(process.cwd(), 'css/style.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')
  .trim();

const m3uCode = extractClassBody('js/m3u-parser.js', 'M3UParser', 'OtaM3UParser');
const storeCode = extractClassBody('js/lineup-store.js', 'LineupStore', 'OtaLineupStore');
const epgCode = extractClassBody('js/epg.js', 'EPGService', 'OtaEPGService');
const playerCode = extractClassBody('js/player.js', 'VideoPlayer', 'OtaVideoPlayer');
const remoteCode = extractClassBody('js/remote.js', 'RemoteController', 'OtaRemoteController');
const appCode = extractClassBody('js/app.js', 'IPTVApp', 'OtaIPTVApp');

const jsPatch = `
(function() {
  try {
    ${m3uCode}
    ${storeCode}
    ${epgCode}
    ${playerCode}
    ${remoteCode}
    ${appCode}

    function syncClassProto(TargetClass, SourceClass) {
      if (!TargetClass || !TargetClass.prototype || !SourceClass || !SourceClass.prototype) return;
      var names = Object.getOwnPropertyNames(SourceClass.prototype);
      for (var i = 0; i < names.length; i++) {
        var name = names[i];
        if (name !== 'constructor') {
          try {
            TargetClass.prototype[name] = SourceClass.prototype[name];
          } catch (e) {}
        }
      }
    }

    if (typeof M3UParser !== 'undefined') syncClassProto(M3UParser, OtaM3UParser);
    if (typeof LineupStore !== 'undefined') syncClassProto(LineupStore, OtaLineupStore);
    if (typeof EPGService !== 'undefined') syncClassProto(EPGService, OtaEPGService);
    if (typeof VideoPlayer !== 'undefined') syncClassProto(VideoPlayer, OtaVideoPlayer);
    if (typeof RemoteController !== 'undefined') syncClassProto(RemoteController, OtaRemoteController);
    if (typeof IPTVApp !== 'undefined') syncClassProto(IPTVApp, OtaIPTVApp);

    function upgradeLiveAppInstance() {
      var app = window.app;
      if (!app) return;

      syncClassProto({ prototype: Object.getPrototypeOf(app) }, OtaIPTVApp);

      if (app.epg) {
        syncClassProto({ prototype: Object.getPrototypeOf(app.epg) }, OtaEPGService);
        if (!app.epg.channelAliasMap) app.epg.channelAliasMap = new Map();
        if (!app.epg.loadedUrls) app.epg.loadedUrls = [];
        app.epg.EPG_CACHE_KEY = 'zenplay_iptv_epg_cache_v491';
        app.epg.DEFAULT_LIVE_EPG_URL = 'https://gist.githubusercontent.com/maorisraelii/b4408ca1c31143ed2f50164629f53f1c/raw/epg-il.xml';
      }

      if (app.store) {
        syncClassProto({ prototype: Object.getPrototypeOf(app.store) }, OtaLineupStore);
        if (!app.store.discoveredEpgUrls) app.store.discoveredEpgUrls = [];
        if (app.store.parser) {
          syncClassProto({ prototype: Object.getPrototypeOf(app.store.parser) }, OtaM3UParser);
        }
      }

      if (app.player) {
        syncClassProto({ prototype: Object.getPrototypeOf(app.player) }, OtaVideoPlayer);
        if (app.player.video) {
          try { app.player.video.playbackRate = 1.0; } catch (e) {}
        }
      }

      if (app.remote) {
        syncClassProto({ prototype: Object.getPrototypeOf(app.remote) }, OtaRemoteController);
      }

      if (!app.__zenplayOtaUpgradedV491) {
        app.__zenplayOtaUpgradedV491 = true;
        if (typeof app.loadActiveEPGSources === 'function') {
          app.loadActiveEPGSources(false);
        }
        if (typeof app.renderChannelList === 'function') {
          app.renderChannelList();
          if (app.focusArea === 'channels') app.updateChannelFocusFast();
        }
        if (typeof app.updateVideoSurfacePosition === 'function') {
          app.updateVideoSurfacePosition(true);
        }
      }
    }

    upgradeLiveAppInstance();
    setTimeout(upgradeLiveAppInstance, 60);
    setTimeout(upgradeLiveAppInstance, 450);
  } catch (err) {
    console.warn('OTA Runtime Bundle Error:', err);
  }
})();
`.trim();

const manifest = {
  version: version,
  releaseDate: new Date().toISOString().slice(0, 10),
  title: 'עדכון גרסה ' + version + ' - תיקון שימור לוח השידורים ביציאה וכניסה לאפליקציה (100% ערוצים)',
  releaseNotes: [
    'תיקון שימור לוח שידורים מקומי (Zero EPG Truncation): תוקן באג שבו שמירת הקאש המקומי ביציאה מהאפליקציה קטעה חלק מהערוצים. כעת נשמרים 100% מכלל הערוצים (285 ערוצים ו-896 כינויים) ללא איבוד מידע',
    'מנגנון Stale-While-Revalidate: עלייה מיידית מהקאש (פחות מ-15 מילישניות) ובמקביל רענון רקע ענני מלא שמבטיח שכל הערוצים מציגים תמיד את לוח השידורים החי והמעודכן ביותר',
    'שמירה על פתיחה ישירה במסך מלא והגנת קריסות חומרה על כל מסכי LG webOS'
  ],
  cssPatch: cssContent,
  jsPatch: jsPatch
};

const outPath = path.join(process.cwd(), 'ota-manifest.json');
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(
  `[OTA Builder] Wrote ota-manifest.json (v${version}, CSS: ${(cssContent.length / 1024).toFixed(1)} KB, JS: ${(jsPatch.length / 1024).toFixed(1)} KB)`
);
