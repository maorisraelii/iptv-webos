/**
 * Builds a complete, self-contained OTA Manifest (ota-manifest.json)
 * that embeds 100% of the current CSS (css/style.css & css/theme-glass.css) and JS classes
 * (M3UParser, LineupStore, EPGService, VideoPlayer, RemoteController, IPTVApp)
 * with lexer-safe JS comment/whitespace stripping, deterministic bundle validation,
 * and v5.6.0 DOM fallback injectors for legacy index.html shells.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const appInfo = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'appinfo.json'), 'utf8'));
const version = appInfo.version;
const channel = 'stable';

/**
 * Lexer-safe JavaScript comment & redundant whitespace stripper:
 * Preserves string literals, template literals (${expr}), and regex literals (/.../)
 * while stripping // and /* ... *\/ comments and collapsing redundant indentation/blank lines.
 */
function stripJsCommentsAndWhitespace(src) {
  if (!src || typeof src !== 'string') return '';
  const len = src.length;
  const out = [];
  let i = 0;
  let canStartRegex = true;
  let inLineStart = true;
  let lastWord = '';
  const templateBraceDepths = [];

  const regexKeywords = {
    'return': true, 'throw': true, 'case': true, 'delete': true, 'void': true,
    'typeof': true, 'in': true, 'instanceof': true, 'new': true, 'else': true,
    'do': true, 'await': true, 'yield': true, 'export': true, 'of': true
  };

  function isIdentStart(ch) {
    return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 95 || ch === 36;
  }
  function isIdentPart(ch) {
    return isIdentStart(ch) || (ch >= 48 && ch <= 57);
  }

  while (i < len) {
    const c = src.charCodeAt(i);

    // Line comment //
    if (c === 47 && i + 1 < len && src.charCodeAt(i + 1) === 47) {
      i += 2;
      while (i < len && src.charCodeAt(i) !== 10) i++;
      continue;
    }

    // Block comment /* ... */
    if (c === 47 && i + 1 < len && src.charCodeAt(i + 1) === 42) {
      i += 2;
      let hadNewline = false;
      while (i < len) {
        if (src.charCodeAt(i) === 10) hadNewline = true;
        if (src.charCodeAt(i) === 42 && i + 1 < len && src.charCodeAt(i + 1) === 47) {
          i += 2;
          break;
        }
        i++;
      }
      if (hadNewline) {
        if (!inLineStart) {
          out.push('\n');
          inLineStart = true;
        }
      } else if (!inLineStart && out.length > 0 && out[out.length - 1] !== ' ' && out[out.length - 1] !== '\n') {
        out.push(' ');
      }
      continue;
    }

    // Single or double quoted string
    if (c === 34 || c === 39) {
      const quote = c;
      const start = i++;
      while (i < len) {
        const sc = src.charCodeAt(i);
        if (sc === 92) { // backslash
          i += 2;
          continue;
        }
        if (sc === quote) {
          i++;
          break;
        }
        i++;
      }
      out.push(src.slice(start, i));
      inLineStart = false;
      canStartRegex = false;
      lastWord = '';
      continue;
    }

    // Template literal `...`
    if (c === 96) {
      const start = i++;
      let closed = false;
      while (i < len) {
        const tc = src.charCodeAt(i);
        if (tc === 92) {
          i += 2;
          continue;
        }
        if (tc === 36 && i + 1 < len && src.charCodeAt(i + 1) === 123) { // ${
          i += 2;
          out.push(src.slice(start, i));
          templateBraceDepths.push(1);
          inLineStart = false;
          canStartRegex = true;
          lastWord = '';
          closed = true;
          break;
        }
        if (tc === 96) {
          i++;
          out.push(src.slice(start, i));
          inLineStart = false;
          canStartRegex = false;
          lastWord = '';
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        out.push(src.slice(start));
        break;
      }
      continue;
    }

    // Continue template literal after closing } of ${expr}
    if (c === 125 && templateBraceDepths.length > 0) {
      const top = templateBraceDepths[templateBraceDepths.length - 1] - 1;
      if (top === 0) {
        templateBraceDepths.pop();
        const start = i++;
        let closed = false;
        while (i < len) {
          const tc = src.charCodeAt(i);
          if (tc === 92) {
            i += 2;
            continue;
          }
          if (tc === 36 && i + 1 < len && src.charCodeAt(i + 1) === 123) {
            i += 2;
            out.push(src.slice(start, i));
            templateBraceDepths.push(1);
            inLineStart = false;
            canStartRegex = true;
            lastWord = '';
            closed = true;
            break;
          }
          if (tc === 96) {
            i++;
            out.push(src.slice(start, i));
            inLineStart = false;
            canStartRegex = false;
            lastWord = '';
            closed = true;
            break;
          }
          i++;
        }
        if (!closed) {
          out.push(src.slice(start));
          break;
        }
        continue;
      }
      templateBraceDepths[templateBraceDepths.length - 1] = top;
    } else if (c === 123 && templateBraceDepths.length > 0) {
      templateBraceDepths[templateBraceDepths.length - 1]++;
    }

    // Regex literal /.../
    if (c === 47 && canStartRegex) {
      const start = i++;
      let inClass = false;
      while (i < len) {
        const rc = src.charCodeAt(i);
        if (rc === 92) {
          i += 2;
          continue;
        }
        if (rc === 91) { // '['
          inClass = true;
        } else if (rc === 93) { // ']'
          inClass = false;
        } else if (rc === 47 && !inClass) {
          i++;
          while (i < len && isIdentPart(src.charCodeAt(i))) i++;
          break;
        } else if (rc === 10 || rc === 13) {
          break;
        }
        i++;
      }
      out.push(src.slice(start, i));
      inLineStart = false;
      canStartRegex = false;
      lastWord = '';
      continue;
    }

    // Newlines (\r / \n)
    if (c === 13 || c === 10) {
      if (c === 13 && i + 1 < len && src.charCodeAt(i + 1) === 10) i++;
      i++;
      while (out.length > 0 && out[out.length - 1] === ' ') {
        out.pop();
      }
      if (out.length > 0 && out[out.length - 1] !== '\n') {
        out.push('\n');
      }
      inLineStart = true;
      continue;
    }

    // Horizontal whitespace
    if (c === 32 || c === 9 || c === 11 || c === 12) {
      while (i < len) {
        const wc = src.charCodeAt(i);
        if (wc !== 32 && wc !== 9 && wc !== 11 && wc !== 12) break;
        i++;
      }
      if (!inLineStart && out.length > 0 && out[out.length - 1] !== ' ' && out[out.length - 1] !== '\n') {
        out.push(' ');
      }
      continue;
    }

    // Identifier / keyword
    if (isIdentStart(c)) {
      const start = i++;
      while (i < len && isIdentPart(src.charCodeAt(i))) i++;
      const word = src.slice(start, i);
      out.push(word);
      inLineStart = false;
      lastWord = word;
      canStartRegex = Boolean(regexKeywords[word]);
      continue;
    }

    // Numeric literal
    if (c >= 48 && c <= 57) {
      const start = i++;
      while (i < len) {
        const nc = src.charCodeAt(i);
        if ((nc >= 48 && nc <= 57) || (nc >= 65 && nc <= 90) || (nc >= 97 && nc <= 122) || nc === 46 || nc === 95) {
          i++;
        } else {
          break;
        }
      }
      out.push(src.slice(start, i));
      inLineStart = false;
      canStartRegex = false;
      lastWord = '';
      continue;
    }

    // Increment / Decrement operators (++ / --)
    if ((c === 43 || c === 45) && i + 1 < len && src.charCodeAt(i + 1) === c) {
      out.push(src.slice(i, i + 2));
      i += 2;
      inLineStart = false;
      canStartRegex = false;
      lastWord = '';
      continue;
    }

    const chStr = src.charAt(i++);
    out.push(chStr);
    inLineStart = false;
    lastWord = '';
    if (c === 41 || c === 93) { // ')' or ']'
      canStartRegex = false;
    } else {
      canStartRegex = true;
    }
  }

  return out.join('').trim();
}

function extractClassBody(filePath, originalClassName, otaClassName) {
  let code = fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
  // Remove module.exports and DOMContentLoaded/boot bootstrap at bottom
  code = code.replace(/^if\s*\(\s*typeof\s+module\s*!==\s*'undefined'[\s\S]*$/m, '');
  code = code.replace(/^function\s+boot\s*\(\s*\)[\s\S]*$/m, '');
  code = code.replace(/^if\s*\(\s*typeof\s+document\s*!==\s*'undefined'[\s\S]*$/m, '');
  code = code.replace(/window\.addEventListener\s*\(\s*'DOMContentLoaded'[\s\S]*$/m, '');
  // Rename class declaration to Ota* so it doesn't collide with lexical globals inside Function()
  code = code.replace(new RegExp('\\bclass\\s+' + originalClassName + '\\b'), 'class ' + otaClassName);
  return stripJsCommentsAndWhitespace(code);
}

function extractOtaManagerCode() {
  let code = fs.readFileSync(path.join(process.cwd(), 'js/qr-ota.js'), 'utf8');
  code = code.replace(/^if\s*\(\s*typeof\s+module\s*!==\s*'undefined'[\s\S]*$/m, '');
  // Do not shadow outer APP_BUNDLE_VERSION / APP_BUNDLE_CHANNEL inside IIFE so older base hosts can still report their base version
  code = code.replace(/^const\s+APP_BUNDLE_VERSION\s*=.*$/m, '');
  code = code.replace(/^const\s+APP_BUNDLE_CHANNEL\s*=.*$/m, '');
  code = code.replace(/\bclass\s+OTACloudManager\b/, 'class OtaOTACloudManager');
  return stripJsCommentsAndWhitespace(code);
}

const cssContent = fs
  .readFileSync(path.join(process.cwd(), 'css/style.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')
  .trim();

const glassCssPath = path.join(process.cwd(), 'css/theme-glass.css');
const cssGlassContent = fs.existsSync(glassCssPath)
  ? fs
      .readFileSync(glassCssPath, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .trim()
  : '';

const diagCodeRaw = fs.existsSync(path.join(process.cwd(), 'js/diagnostics.js'))
  ? fs
      .readFileSync(path.join(process.cwd(), 'js/diagnostics.js'), 'utf8')
      .replace(/\r?\n\s*if\s*\(\s*typeof\s+module\s*!==\s*'undefined'[\s\S]*$/m, '\n})(typeof window !== "undefined" ? window : globalThis);')
  : '';
const diagCode = stripJsCommentsAndWhitespace(diagCodeRaw);
const m3uCode = extractClassBody('js/m3u-parser.js', 'M3UParser', 'OtaM3UParser');
const storeCode = extractClassBody('js/lineup-store.js', 'LineupStore', 'OtaLineupStore');
const epgCode = extractClassBody('js/epg.js', 'EPGService', 'OtaEPGService');
const playerCode = extractClassBody('js/player.js', 'VideoPlayer', 'OtaVideoPlayer');
const remoteCode = extractClassBody('js/remote.js', 'RemoteController', 'OtaRemoteController');
const otaCode = extractOtaManagerCode();
const appCode = extractClassBody('js/app.js', 'IPTVApp', 'OtaIPTVApp');

const otaRuntimeWrapper = `
(function() {
  try {
    __OTA_MODULES__

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
    if (typeof OTACloudManager !== 'undefined') syncClassProto(OTACloudManager, OtaOTACloudManager);
    if (typeof IPTVApp !== 'undefined') syncClassProto(IPTVApp, OtaIPTVApp);

    if (typeof window !== 'undefined') {
      window.__ZENPLAY_OTA_CLASSIC_CSS = ${JSON.stringify(cssContent)};
      window.__ZENPLAY_OTA_GLASS_CSS = ${JSON.stringify(cssGlassContent)};
    }

    function ensureFallbackVodDom(app) {
      if (typeof document === 'undefined') return;
      var headerLeft = document.querySelector('#top-header .header-left');
      var btnGuide = document.getElementById('btn-open-guide');
      if (headerLeft && !document.getElementById('btn-open-vod')) {
        var vodBtn = document.createElement('button');
        vodBtn.id = 'btn-open-vod';
        vodBtn.className = 'top-nav-btn focusable';
        vodBtn.setAttribute('data-action', 'open-vod');
        vodBtn.innerHTML = '<span>🎬 VOD 7 ימים</span>';
        if (btnGuide && btnGuide.parentNode === headerLeft) {
          headerLeft.insertBefore(vodBtn, btnGuide.nextSibling);
        } else {
          headerLeft.appendChild(vodBtn);
        }
      }
      var vodOpenEl = document.getElementById('btn-open-vod');
      if (vodOpenEl && vodOpenEl.dataset && vodOpenEl.dataset.otaFallbackBound !== '1') {
        vodOpenEl.dataset.otaFallbackBound = '1';
        if (vodOpenEl.dataset.vodBound !== '1') {
          vodOpenEl.addEventListener('click', function() {
            if (typeof app.openGuideModal === 'function') app.openGuideModal('vod');
          });
        }
      }

      if (headerLeft && !document.getElementById('btn-voice-command')) {
        var voiceBtn = document.createElement('button');
        voiceBtn.id = 'btn-voice-command';
        voiceBtn.className = 'top-nav-btn focusable';
        voiceBtn.setAttribute('data-action', 'voice-command');
        voiceBtn.innerHTML = '<span>🎤 פקודה קולית</span>';
        var btnSettings = document.getElementById('btn-open-settings');
        if (btnSettings && btnSettings.parentNode === headerLeft) {
          headerLeft.insertBefore(voiceBtn, btnSettings);
        } else {
          headerLeft.appendChild(voiceBtn);
        }
      }
      var voiceBtnEl = document.getElementById('btn-voice-command');
      if (voiceBtnEl && voiceBtnEl.dataset && voiceBtnEl.dataset.otaFallbackBound !== '1') {
        voiceBtnEl.dataset.otaFallbackBound = '1';
        if (voiceBtnEl.dataset.voiceBound !== '1') {
          voiceBtnEl.addEventListener('click', function() {
            if (typeof app.startVoiceCommand === 'function') app.startVoiceCommand();
          });
        }
      }

      var guideCard = document.querySelector('#guide-modal .modal-card');
      var daysBar = document.getElementById('guide-days-bar');
      if (guideCard && !document.getElementById('guide-scope-bar')) {
        var scopeBar = document.createElement('div');
        scopeBar.id = 'guide-scope-bar';
        scopeBar.className = 'guide-scope-bar';
        scopeBar.innerHTML =
          '<button id="btn-guide-scope-channel" class="guide-scope-btn active focusable" type="button">הערוץ הנוכחי</button>' +
          '<button id="btn-guide-scope-vod" class="guide-scope-btn focusable" type="button">VOD כל הערוצים — 7 ימים</button>';
        if (daysBar && daysBar.parentNode === guideCard) {
          guideCard.insertBefore(scopeBar, daysBar);
        } else {
          guideCard.appendChild(scopeBar);
        }
      }
      if (guideCard && !document.getElementById('vod-search-bar')) {
        var vodSearchBar = document.createElement('div');
        vodSearchBar.id = 'vod-search-bar';
        vodSearchBar.className = 'vod-search-bar hidden';
        vodSearchBar.innerHTML =
          '<input type="text" id="vod-search-input" class="tv-input focusable" placeholder="חפש תוכנית מ-7 הימים האחרונים..." dir="auto">' +
          '<button id="btn-vod-only-past" class="btn-tv-secondary focusable" type="button">רק שידורים מוקלטים</button>';
        if (daysBar && daysBar.parentNode === guideCard) {
          guideCard.insertBefore(vodSearchBar, daysBar);
        } else {
          guideCard.appendChild(vodSearchBar);
        }
      }
      var scopeChBtn = document.getElementById('btn-guide-scope-channel');
      if (scopeChBtn && scopeChBtn.dataset && scopeChBtn.dataset.otaFallbackBound !== '1') {
        scopeChBtn.dataset.otaFallbackBound = '1';
        if (scopeChBtn.dataset.vodBound !== '1') {
          scopeChBtn.addEventListener('click', function() {
            if (typeof app.setGuideScope === 'function') app.setGuideScope('channel');
          });
        }
      }
      var scopeVodBtn = document.getElementById('btn-guide-scope-vod');
      if (scopeVodBtn && scopeVodBtn.dataset && scopeVodBtn.dataset.otaFallbackBound !== '1') {
        scopeVodBtn.dataset.otaFallbackBound = '1';
        if (scopeVodBtn.dataset.vodBound !== '1') {
          scopeVodBtn.addEventListener('click', function() {
            if (typeof app.setGuideScope === 'function') app.setGuideScope('vod');
          });
        }
      }
      var vodInput = document.getElementById('vod-search-input');
      if (vodInput && vodInput.dataset && vodInput.dataset.otaFallbackBound !== '1') {
        vodInput.dataset.otaFallbackBound = '1';
        if (vodInput.dataset.vodBound !== '1') {
          vodInput.addEventListener('input', function() {
            if (typeof app.renderVodResults === 'function') app.renderVodResults();
          });
        }
      }
      var vodPastBtn = document.getElementById('btn-vod-only-past');
      if (vodPastBtn && vodPastBtn.dataset && vodPastBtn.dataset.otaFallbackBound !== '1') {
        vodPastBtn.dataset.otaFallbackBound = '1';
        if (vodPastBtn.dataset.vodBound !== '1') {
          vodPastBtn.addEventListener('click', function() {
            if (typeof app.toggleVodOnlyPast === 'function') app.toggleVodOnlyPast();
          });
        }
      }
    }

    function ensureFallbackSleepAndVoiceDom(app) {
      if (typeof document === 'undefined' || !document.body) return;
      if (!document.getElementById('sleep-warning-modal')) {
        var sleepModal = document.createElement('div');
        sleepModal.id = 'sleep-warning-modal';
        sleepModal.className = 'modal-backdrop hidden';
        sleepModal.setAttribute('aria-hidden', 'true');
        sleepModal.innerHTML =
          '<div id="sleep-warning-card" class="modal-card modal-sleep-card">' +
            '<h2 class="sleep-warning-title">מצב חיסכון בחשמל — כיבוי מסך אוטומטי</h2>' +
            '<p class="sleep-warning-desc">לא זוהתה פעילות ממושכת. השידור ייעצר והמסך ייכנס לחיסכון בחשמל בעוד:</p>' +
            '<div id="sleep-countdown-sec" class="sleep-countdown-sec">60</div>' +
            '<div id="sleep-countdown-bar-track" class="sleep-countdown-bar-track">' +
              '<div id="sleep-countdown-bar" class="sleep-countdown-bar" style="width:100%;"></div>' +
            '</div>' +
            '<button id="btn-sleep-stay-awake" class="btn-tv-primary focusable" type="button">אני עדיין צופה — בטל כיבוי (OK)</button>' +
          '</div>';
        document.body.appendChild(sleepModal);
      }
      var stayAwakeBtn = document.getElementById('btn-sleep-stay-awake');
      if (stayAwakeBtn && stayAwakeBtn.dataset && stayAwakeBtn.dataset.otaFallbackBound !== '1') {
        stayAwakeBtn.dataset.otaFallbackBound = '1';
        if (stayAwakeBtn.dataset.sleepBound !== '1') {
          stayAwakeBtn.addEventListener('click', function() {
            if (typeof app.cancelSleepWarning === 'function') app.cancelSleepWarning();
          });
        }
      }

      if (!document.getElementById('power-save-screen')) {
        var powerSaveEl = document.createElement('div');
        powerSaveEl.id = 'power-save-screen';
        powerSaveEl.className = 'power-save-screen hidden';
        powerSaveEl.setAttribute('aria-hidden', 'true');
        powerSaveEl.innerHTML =
          '<div class="power-save-hint">מצב חיסכון בחשמל — לחץ על כל מקש לחזרה לצפייה</div>';
        document.body.appendChild(powerSaveEl);
      }
      var powerSaveNode = document.getElementById('power-save-screen');
      if (powerSaveNode && powerSaveNode.dataset && powerSaveNode.dataset.otaFallbackBound !== '1') {
        powerSaveNode.dataset.otaFallbackBound = '1';
        if (powerSaveNode.dataset.sleepBound !== '1') {
          powerSaveNode.addEventListener('click', function() {
            if (typeof app.exitPowerSaveMode === 'function') app.exitPowerSaveMode();
          });
        }
      }

      if (!document.getElementById('voice-overlay')) {
        var voiceEl = document.createElement('div');
        voiceEl.id = 'voice-overlay';
        voiceEl.className = 'modal-backdrop hidden';
        voiceEl.setAttribute('aria-hidden', 'true');
        voiceEl.innerHTML =
          '<div class="modal-card voice-card">' +
            '<div id="voice-mic-ring" class="voice-mic-ring">🎤</div>' +
            '<div id="voice-status-text" class="voice-status-text">מקשיב... אמור שם ערוץ, מספר או תוכנית</div>' +
            '<div id="voice-transcript-text" class="voice-transcript-text"></div>' +
            '<button id="btn-voice-cancel" class="btn-tv-secondary focusable" type="button">ביטול (BACK)</button>' +
          '</div>';
        document.body.appendChild(voiceEl);
      }
      var voiceCancelBtn = document.getElementById('btn-voice-cancel');
      if (voiceCancelBtn && voiceCancelBtn.dataset && voiceCancelBtn.dataset.otaFallbackBound !== '1') {
        voiceCancelBtn.dataset.otaFallbackBound = '1';
        if (voiceCancelBtn.dataset.voiceBound !== '1') {
          voiceCancelBtn.addEventListener('click', function() {
            if (typeof app.stopVoiceCommand === 'function') app.stopVoiceCommand();
            else if (typeof app.closeModals === 'function') app.closeModals();
          });
        }
      }
    }

    function ensureFallbackSettingsDom(app) {
      if (typeof document === 'undefined') return;
      var actionsCol = document.querySelector('#settings-tab-sources .epg-actions-col');
      var loadSampleBtn = document.getElementById('btn-load-sample');
      if (actionsCol && !document.getElementById('btn-append-default-source')) {
        var appendBtn = document.createElement('button');
        appendBtn.id = 'btn-append-default-source';
        appendBtn.className = 'btn-tv-secondary focusable';
        appendBtn.type = 'button';
        appendBtn.textContent = '+ הוסף מקור ברירת מחדל (ללא מחיקה)';
        if (loadSampleBtn && loadSampleBtn.parentNode === actionsCol) {
          actionsCol.insertBefore(appendBtn, loadSampleBtn.nextSibling);
        } else {
          actionsCol.appendChild(appendBtn);
        }
      }
      var appendBtnEl = document.getElementById('btn-append-default-source');
      if (appendBtnEl && appendBtnEl.dataset && appendBtnEl.dataset.otaFallbackBound !== '1') {
        appendBtnEl.dataset.otaFallbackBound = '1';
        if (appendBtnEl.dataset.appendBound !== '1') {
          appendBtnEl.addEventListener('click', function() {
            if (app.store && typeof app.store.appendDefaultSource === 'function') {
              var res = app.store.appendDefaultSource();
              if (typeof app.renderSourcesManagerList === 'function') app.renderSourcesManagerList();
              if (typeof app.refreshAllSources === 'function') app.refreshAllSources(false);
              if (typeof app.showToast === 'function') {
                app.showToast(res && res.added ? 'מקור ברירת המחדל נוסף לרשימה ללא מחיקה ✓' : 'מקור ברירת המחדל הופעל מחדש ✓');
              }
            }
          });
        }
      }

      var appPanel = document.getElementById('settings-tab-appearance');
      if (appPanel && (!document.getElementById('ui-sleep-options') || !document.getElementById('ui-voice-lang-options'))) {
        var card = document.createElement('div');
        card.className = 'perf-section-card ui-pref-card';
        card.id = 'ui-power-voice-card';
        card.innerHTML =
          '<h3>חיסכון בחשמל (Sleep Timer) ושפת פקודות קוליות</h3>' +
          '<p class="perf-desc">כיבוי מסך והפסקת שידור אוטומטית בחוסר פעילות:</p>' +
          '<div class="perf-options-grid ui-grid-4" id="ui-sleep-options">' +
            '<button class="perf-option-btn focusable" data-ui-pref="sleepTimeoutHours" data-ui-value="0"><span class="perf-opt-title">כבוי</span><span class="perf-opt-sub">ללא כיבוי אוטומטי</span></button>' +
            '<button class="perf-option-btn focusable" data-ui-pref="sleepTimeoutHours" data-ui-value="1"><span class="perf-opt-title">שעה אחת</span><span class="perf-opt-sub">חיסכון מהיר</span></button>' +
            '<button class="perf-option-btn focusable" data-ui-pref="sleepTimeoutHours" data-ui-value="2"><span class="perf-opt-title">שעתיים</span><span class="perf-opt-sub">2 שעות</span></button>' +
            '<button class="perf-option-btn focusable" data-ui-pref="sleepTimeoutHours" data-ui-value="3"><span class="perf-opt-title">3 שעות</span><span class="perf-opt-sub">צפייה ממושכת</span></button>' +
            '<button class="perf-option-btn focusable" data-ui-pref="sleepTimeoutHours" data-ui-value="4"><span class="perf-opt-title">4 שעות (ברירת מחדל)</span><span class="perf-opt-sub">מומלץ לטלוויזיות</span></button>' +
            '<button class="perf-option-btn focusable" data-ui-pref="sleepTimeoutHours" data-ui-value="6"><span class="perf-opt-title">6 שעות</span><span class="perf-opt-sub">ערב ארוך</span></button>' +
            '<button class="perf-option-btn focusable" data-ui-pref="sleepTimeoutHours" data-ui-value="8"><span class="perf-opt-title">8 שעות</span><span class="perf-opt-sub">מקסימום</span></button>' +
          '</div>' +
          '<p class="perf-desc">שפת זיהוי פקודות קוליות (Voice Language):</p>' +
          '<div class="perf-options-grid" id="ui-voice-lang-options">' +
            '<button class="perf-option-btn focusable" data-ui-pref="voiceLang" data-ui-value="he-IL"><span class="perf-opt-title">עברית (he-IL)</span><span class="perf-opt-sub">ברירת מחדל</span></button>' +
            '<button class="perf-option-btn focusable" data-ui-pref="voiceLang" data-ui-value="en-US"><span class="perf-opt-title">English (en-US)</span><span class="perf-opt-sub">אנגלית</span></button>' +
          '</div>';
        var actionsBar = appPanel.querySelector('.perf-actions-bar');
        if (actionsBar && actionsBar.parentNode === appPanel) {
          appPanel.insertBefore(card, actionsBar);
        } else {
          appPanel.appendChild(card);
        }
        var prefBtns = card.querySelectorAll('[data-ui-pref]');
        for (var i = 0; i < prefBtns.length; i++) {
          (function(btn) {
            if (btn && btn.dataset && btn.dataset.otaFallbackBound !== '1') {
              btn.dataset.otaFallbackBound = '1';
              btn.addEventListener('click', function() {
                var key = btn.dataset.uiPref;
                var val = btn.dataset.uiValue;
                if (key && typeof val !== 'undefined' && typeof app.setUiPref === 'function') {
                  app.setUiPref(key, key === 'sleepTimeoutHours' ? parseInt(val, 10) : val, false);
                }
              });
            }
          })(prefBtns[i]);
        }
      }
    }

    function upgradeLiveAppInstance() {
      if (typeof window !== 'undefined') {
        if (!window.__ZENPLAY_BASE_BUNDLE_VERSION) {
          window.__ZENPLAY_BASE_BUNDLE_VERSION =
            (typeof APP_BUNDLE_VERSION === 'string' && APP_BUNDLE_VERSION) ? APP_BUNDLE_VERSION : '${version}';
        }
        if (!window.__ZENPLAY_BASE_BUNDLE_CHANNEL) {
          window.__ZENPLAY_BASE_BUNDLE_CHANNEL = 'stable';
        }
      }

      var app = window.app;
      if (!app) return;

      syncClassProto({ prototype: Object.getPrototypeOf(app) }, OtaIPTVApp);
      if (typeof app.ensureRuntimeState === 'function') {
        app.ensureRuntimeState();
      }
      if (typeof app.isPowerSaveMode !== 'boolean') app.isPowerSaveMode = false;
      if (typeof app.guideScope !== 'string') app.guideScope = 'channel';
      if (typeof app.vodOnlyPast !== 'boolean') app.vodOnlyPast = false;
      if (typeof app._lastActivityMs !== 'number') app._lastActivityMs = Date.now();

      if (app.epg) {
        syncClassProto({ prototype: Object.getPrototypeOf(app.epg) }, OtaEPGService);
        if (typeof app.epg._ensureRuntimeCaches === 'function') {
          app.epg._ensureRuntimeCaches();
        }
        if (!app.epg.programmes) app.epg.programmes = app.epg.programmesByChannel;
        if (!app.epg.channelAliasMap) app.epg.channelAliasMap = new Map();
        if (!app.epg.channelAliasCandidates) app.epg.channelAliasCandidates = new Map();
        if (app.epg.channelAliasCandidates.size === 0 && app.epg.channelAliasMap.size > 0 && typeof app.epg._addAliasCandidate === 'function') {
          app.epg.channelAliasMap.forEach(function(targetId, aliasKey) {
            app.epg._addAliasCandidate(app.epg.channelAliasCandidates, aliasKey, targetId);
          });
        }
        if (!app.epg.loadedUrls) app.epg.loadedUrls = [];
        if (!app.epg._channelMatchCache) app.epg._channelMatchCache = new Map();
        if (!app.epg._normCache) app.epg._normCache = new Map();
        if (!app.epg._formatTimeCache) app.epg._formatTimeCache = new Map();
        if (!app.epg._nowNextCache) app.epg._nowNextCache = new Map();
        app.epg.EPG_CACHE_KEY = 'zenplay_iptv_epg_cache_v491';
        app.epg.DEFAULT_LIVE_EPG_URLS = [
          'https://raw.githubusercontent.com/maorisraelii/iptv-webos/main/epg-il.xml',
          'https://maorisraelii.github.io/iptv-webos/epg-il.xml',
          'https://gist.githubusercontent.com/maorisraelii/b4408ca1c31143ed2f50164629f53f1c/raw/epg-il.xml',
          'epg-il.xml'
        ];
        app.epg.DEFAULT_LIVE_EPG_URL = app.epg.DEFAULT_LIVE_EPG_URLS[0];
        if (typeof app.epg.rebuildAliasesFromLoadedChannels === 'function') {
          app.epg.rebuildAliasesFromLoadedChannels();
        }
      }

      if (app.store) {
        syncClassProto({ prototype: Object.getPrototypeOf(app.store) }, OtaLineupStore);
        if (typeof app.store._ensureStoreState === 'function') {
          app.store._ensureStoreState();
        }
        if (!app.store.discoveredEpgUrls) app.store.discoveredEpgUrls = [];
        if (!app.store._heCollator && typeof Intl !== 'undefined' && typeof Intl.Collator === 'function') {
          app.store._heCollator = new Intl.Collator('he');
        }
        if (typeof app.store.rebuildChannelIndices === 'function') {
          app.store.rebuildChannelIndices();
        }
        if (typeof app.store.loadFavorites === 'function') {
          app.store.loadFavorites();
        }
        if (app.store.parser) {
          syncClassProto({ prototype: Object.getPrototypeOf(app.store.parser) }, OtaM3UParser);
          if (typeof app.store.parser._ensureParserState === 'function') {
            app.store.parser._ensureParserState();
          }
        }
      }

      if (app.player) {
        syncClassProto({ prototype: Object.getPrototypeOf(app.player) }, OtaVideoPlayer);
        if (typeof app.player._ensureAvRuntimeState === 'function') {
          app.player._ensureAvRuntimeState();
        }
        if (typeof app.player._mediaRecoveryAttempts !== 'number') app.player._mediaRecoveryAttempts = 0;
        if (!app.player._currentUrl) app.player._currentUrl = '';
        if (typeof app.player.catchupOriginStartMs !== 'number') app.player.catchupOriginStartMs = 0;
        if (typeof app.player._streamCatchupOriginMs !== 'number') app.player._streamCatchupOriginMs = 0;
        if (typeof app.player._pendingCatchupTargetMs !== 'number') app.player._pendingCatchupTargetMs = 0;
        if (typeof app.player._lastBoundaryCheckMs !== 'number') app.player._lastBoundaryCheckMs = 0;
        if (app.player.callbacks) {
          if (typeof app.player.callbacks.getNextProgramme !== 'function') {
            app.player.callbacks.getNextProgramme = function(channel, currentProg, afterMs) {
              return (app.epg && typeof app.epg.getNextProgrammeForChannel === 'function')
                ? app.epg.getNextProgrammeForChannel(channel, afterMs)
                : null;
            };
          }
          if (typeof app.player.callbacks.onProgrammeChanged !== 'function') {
            app.player.callbacks.onProgrammeChanged = function(channel) {
              if (typeof app.refreshVisibleEPGLabels === 'function') app.refreshVisibleEPGLabels();
              if (app.selectedChannel && channel && app.selectedChannel.id === channel.id) {
                if (typeof app.updateOSD === 'function') app.updateOSD(channel, false);
                if (app.mode === 'FULLSCREEN' && typeof app.showOSD === 'function') app.showOSD();
              }
            };
          }
        }
        if (app.player.video) {
          try { app.player.video.playbackRate = 1.0; } catch (e) {}
        }
      }

      if (app.remote) {
        syncClassProto({ prototype: Object.getPrototypeOf(app.remote) }, OtaRemoteController);
      }

      if (app.otaManager) {
        syncClassProto({ prototype: Object.getPrototypeOf(app.otaManager) }, OtaOTACloudManager);
        if (typeof app.otaManager._pendingChangelogInfo === 'undefined') {
          app.otaManager._pendingChangelogInfo = null;
        }
        if (typeof app.otaManager.ensureOTAChannelControlsDOM === 'function') {
          app.otaManager.ensureOTAChannelControlsDOM();
        }
        if (typeof app.otaManager.updateVersionBadgesUI === 'function') {
          app.otaManager.updateVersionBadgesUI();
        }
      }

      if (typeof app.ensureThemeControlsDOM === 'function') {
        app.ensureThemeControlsDOM();
      }
      if (typeof app.ensureUiCustomizationDOM === 'function') {
        app.ensureUiCustomizationDOM();
      }
      if (typeof app.ensureVodHeaderBtnDOM === 'function') {
        app.ensureVodHeaderBtnDOM();
      }
      if (typeof app.ensurePowerSaveDOM === 'function') {
        app.ensurePowerSaveDOM();
      }
      if (typeof app.ensureVoiceDOM === 'function') {
        app.ensureVoiceDOM();
      }
      if (typeof app.ensureAppendDefaultBtnDOM === 'function') {
        app.ensureAppendDefaultBtnDOM();
      }
      if (typeof app.ensureDisclaimerDOM === 'function') {
        app.ensureDisclaimerDOM();
      }

      ensureFallbackVodDom(app);
      ensureFallbackSleepAndVoiceDom(app);
      ensureFallbackSettingsDom(app);

      if (typeof app.applyUiPrefs === 'function') {
        app.applyUiPrefs(true);
      }
      if (typeof app.applyAvPrefs === 'function') {
        app.applyAvPrefs(true);
      }
      if (typeof app.applyTheme === 'function') {
        app.applyTheme(app.getTheme(), true);
      }

      if (typeof app.ensureRuntimeState === 'function') {
        app.ensureRuntimeState();
      }

      if (app.__zenplayOtaUpgradedVersion !== '${version}') {
        app.__zenplayOtaUpgradedVersion = '${version}';
        if (typeof app.initSleepTimer === 'function') {
          app.initSleepTimer();
        }
        if (app.player && typeof app.player.startWatchdogAndQualityRamp === 'function') {
          app.player.startWatchdogAndQualityRamp();
        }
        if (app.player && typeof app.player.applyEffectiveVolume === 'function') {
          app.player.applyEffectiveVolume();
        }
        var hasLoadedChannels =
          (Array.isArray(app.allChannels) && app.allChannels.length > 0) ||
          (Array.isArray(app.visibleChannels) && app.visibleChannels.length > 0);
        if (hasLoadedChannels) {
          if (Array.isArray(app.visibleChannels) && app.visibleChannels.length > 0) {
            if (typeof app.renderChannelList === 'function') {
              app.renderChannelList();
              if (app.focusArea === 'channels' && (!app.isModalOpen || !app.isModalOpen()) && typeof app.updateChannelFocusFast === 'function') {
                app.updateChannelFocusFast();
              }
            }
          } else if (typeof app.applyChannelFilter === 'function') {
            app.applyChannelFilter();
          }
          if (!app.isSafeMode || !app.isSafeMode()) {
            if (typeof app.loadActiveEPGSources === 'function') {
              app.loadActiveEPGSources(false);
            }
          }
        }
        if (typeof app.updateVideoSurfacePosition === 'function') {
          app.updateVideoSurfacePosition(true);
        }
      } else if (
        Array.isArray(app.allChannels) &&
        app.allChannels.length > 0 &&
        typeof document !== 'undefined' &&
        document.querySelectorAll('#channel-list .channel-item').length === 0
      ) {
        if (typeof app.applyChannelFilter === 'function') {
          app.applyChannelFilter();
        }
        if (!app.selectedChannel && Array.isArray(app.visibleChannels) && app.visibleChannels.length > 0 && typeof app.restoreLastWatchedChannel === 'function') {
          app.restoreLastWatchedChannel(false);
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
`;

const strippedWrapper = stripJsCommentsAndWhitespace(otaRuntimeWrapper);
const jsPatch = strippedWrapper.replace('__OTA_MODULES__', function() {
  return [diagCode, m3uCode, storeCode, epgCode, playerCode, remoteCode, otaCode, appCode].join('\n');
});

function validateBundleAndMetadata(manifestObj) {
  if (!manifestObj || typeof manifestObj !== 'object') {
    throw new Error('[OTA Builder] Manifest must be a valid object');
  }
  if (!manifestObj.version || !/^\d+\.\d+\.\d+$/.test(manifestObj.version)) {
    throw new Error('[OTA Builder] Invalid semver version: ' + manifestObj.version);
  }
  if (!manifestObj.channel || typeof manifestObj.channel !== 'string') {
    throw new Error('[OTA Builder] Missing OTA channel');
  }
  if (!manifestObj.releaseDate || !/^\d{4}-\d{2}-\d{2}$/.test(manifestObj.releaseDate)) {
    throw new Error('[OTA Builder] Invalid releaseDate: ' + manifestObj.releaseDate);
  }
  if (!manifestObj.title || typeof manifestObj.title !== 'string') {
    throw new Error('[OTA Builder] Missing release title');
  }
  if (!Array.isArray(manifestObj.releaseNotes) || manifestObj.releaseNotes.length === 0) {
    throw new Error('[OTA Builder] Missing releaseNotes array');
  }
  if (!manifestObj.cssPatch || manifestObj.cssPatch.length < 1000) {
    throw new Error('[OTA Builder] cssPatch unexpectedly small or empty');
  }
  if (!manifestObj.cssGlassPatch || manifestObj.cssGlassPatch.length < 1000) {
    throw new Error('[OTA Builder] cssGlassPatch unexpectedly small or empty');
  }
  if (!manifestObj.jsPatch || manifestObj.jsPatch.length < 1000) {
    throw new Error('[OTA Builder] jsPatch unexpectedly small or empty');
  }

  // Validate generated jsPatch parses cleanly
  new Function(manifestObj.jsPatch);

  // Enforce Chromium 53 / LG webOS 4.x syntax compatibility on generated jsPatch
  const compatRules = [
    { name: 'optional-chaining', rx: /\x3f\.[a-zA-Z_$]/ },
    { name: 'nullish-coalescing', rx: /\x3f\x3f/ },
    { name: 'object-spread', rx: /\x7b\s*\.\.\./ },
    { name: 'async-fn', rx: /\basync\s+function\b/ },
    { name: 'optional-catch', rx: /\bcatch\s*\x7b/ },
    { name: 'array-flat', rx: /\.(?:flat|flatMap)\(/ },
    { name: 'string-replace-all', rx: /\x2ereplaceAll\(/ },
    { name: 'object-entries-values', rx: /Object\.(?:values|entries|fromEntries)\(/ }
  ];
  for (let i = 0; i < compatRules.length; i++) {
    if (compatRules[i].rx.test(manifestObj.jsPatch)) {
      throw new Error('[OTA Builder] jsPatch contains Chromium 53 incompatible syntax: ' + compatRules[i].name);
    }
  }
}

let releaseMeta = {
  title: 'עדכון גרסה ' + version,
  releaseNotes: ['שיפורי ביצועים, יציבות ועדכוני ממשק'],
  releaseDate: ''
};
try {
  const notesPath = path.join(process.cwd(), 'ota-release-notes.json');
  if (fs.existsSync(notesPath)) {
    const parsedNotes = JSON.parse(fs.readFileSync(notesPath, 'utf8'));
    if (parsedNotes && parsedNotes.title) releaseMeta.title = parsedNotes.title;
    if (parsedNotes && Array.isArray(parsedNotes.releaseNotes) && parsedNotes.releaseNotes.length > 0) {
      releaseMeta.releaseNotes = parsedNotes.releaseNotes;
    }
    if (parsedNotes && typeof parsedNotes.releaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsedNotes.releaseDate)) {
      releaseMeta.releaseDate = parsedNotes.releaseDate;
    }
  }
} catch (e) {
  console.warn('[OTA Builder] Warning reading ota-release-notes.json:', e.message);
}

const deterministicDate = releaseMeta.releaseDate
  || (process.env.SOURCE_DATE_EPOCH
    ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10));

const bundleSha256 = crypto
  .createHash('sha256')
  .update(JSON.stringify({
    version: version,
    channel: channel,
    title: releaseMeta.title,
    releaseNotes: releaseMeta.releaseNotes,
    cssPatch: cssContent,
    cssGlassPatch: cssGlassContent,
    jsPatch: jsPatch
  }))
  .digest('hex');

const manifest = {
  version: version,
  channel: channel,
  releaseDate: deterministicDate,
  title: releaseMeta.title,
  releaseNotes: releaseMeta.releaseNotes,
  bundleSha256: bundleSha256,
  bundleBytes: {
    cssPatch: Buffer.byteLength(cssContent, 'utf8'),
    cssGlassPatch: Buffer.byteLength(cssGlassContent, 'utf8'),
    jsPatch: Buffer.byteLength(jsPatch, 'utf8')
  },
  cssPatch: cssContent,
  cssGlassPatch: cssGlassContent,
  jsPatch: jsPatch
};

validateBundleAndMetadata(manifest);

const outPath = path.join(process.cwd(), 'ota-manifest.json');
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(
  `[OTA Builder] Wrote ota-manifest.json (v${version} [${channel}], sha256=${bundleSha256.slice(0, 12)}, Classic CSS: ${(cssContent.length / 1024).toFixed(1)} KB, Glass CSS: ${(cssGlassContent.length / 1024).toFixed(1)} KB, JS: ${(jsPatch.length / 1024).toFixed(1)} KB)`
);
