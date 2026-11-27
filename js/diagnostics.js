/**
 * In-Memory Diagnostic Ring Buffer, Privacy Redactor & GitHub Issue Reporter
 * Compatible with LG webOS 4.x+ (Chromium 53), Android TV WebView & Desktop Web
 */
(function (global) {
  'use strict';

  var MAX_LOG_ENTRIES = 80;
  var GITHUB_REPO_NEW_ISSUE = 'https://github.com/maorisraelii/iptv-webos/issues/new';
  var ENDPOINT_STORAGE_KEY = 'zenplay_issue_endpoint_url';
  // Optional: set your deployed Cloudflare Worker URL here (or via localStorage 'zenplay_issue_endpoint_url')
  // to enable 1-click direct GitHub Issue creation without requiring a user GitHub account.
  var DEFAULT_ISSUE_ENDPOINT = '';

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function formatClockTime(ts) {
    try {
      var d = new Date(ts);
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    } catch (e) {
      return '00:00:00';
    }
  }

  function safeStringifyArg(arg) {
    if (arg === null || typeof arg === 'undefined') return '';
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) {
      return arg.message || String(arg);
    }
    try {
      return JSON.stringify(arg);
    } catch (e) {
      return String(arg);
    }
  }

  function redactText(input) {
    if (input === null || typeof input === 'undefined') return '';
    var s = String(input);
    // Strip embedded credentials in URLs: http://user:pass@host -> http://[REDACTED_AUTH]@host
    s = s.replace(/(https?:\/\/)([^\/\s:@]+):([^\/\s@]+)@/gi, '$1[REDACTED_AUTH]@');
    // Mask sensitive query params (?token=..., &password=..., &key=..., &auth=..., &secret=...)
    s = s.replace(/([?&](?:token|password|pass|pwd|key|apikey|api_key|auth|secret|username|user)=)([^&\s]+)/gi, '$1[REDACTED]');
    // Redact arbitrary external M3U/stream URLs while keeping safe GitHub / iptv-org / localhost diagnostic context
    s = s.replace(/https?:\/\/[^\s"'<>]+/gi, function (url) {
      var lower = url.toLowerCase();
      if (
        lower.indexOf('github.com/maorisraelii/') !== -1 ||
        lower.indexOf('githubusercontent.com/maorisraelii/') !== -1 ||
        lower.indexOf('iptv-org.github.io/') !== -1 ||
        lower.indexOf('127.0.0.1') !== -1 ||
        lower.indexOf('localhost') !== -1
      ) {
        return url;
      }
      if (/\.(m3u8?|xml|ts)(\?|$)/i.test(url) || /get\.php|player_api\.php|xmltv\.php/i.test(url)) {
        return '[REDACTED_STREAM_URL]';
      }
      var hostMatch = url.match(/^https?:\/\/([^\/:?#]+)/i);
      return hostMatch ? 'https://' + hostMatch[1] + '/[REDACTED_PATH]' : '[REDACTED_URL]';
    });
    // Mask non-loopback IPv4 addresses
    s = s.replace(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g, function (ip) {
      if (ip === '127.0.0.1' || ip === '0.0.0.0') return ip;
      return '[REDACTED_IP]';
    });
    if (s.length > 360) {
      s = s.slice(0, 357) + '...';
    }
    return s;
  }

  var entries = [];
  var installed = false;

  function pushEntry(level, source, message) {
    var cleanMsg = redactText(message);
    if (!cleanMsg) return;
    entries.push({
      ts: Date.now(),
      time: formatClockTime(Date.now()),
      level: level || 'INFO',
      source: source || 'app',
      message: cleanMsg
    });
    if (entries.length > MAX_LOG_ENTRIES) {
      entries.shift();
    }
  }

  function installHooks() {
    if (installed) return;
    installed = true;

    if (typeof console !== 'undefined') {
      var origError = console.error;
      var origWarn = console.warn;

      if (typeof origError === 'function') {
        console.error = function () {
          try {
            var parts = [];
            for (var i = 0; i < arguments.length; i++) {
              parts.push(safeStringifyArg(arguments[i]));
            }
            pushEntry('ERR', 'console', parts.join(' '));
          } catch (e) {}
          return origError.apply(console, arguments);
        };
      }

      if (typeof origWarn === 'function') {
        console.warn = function () {
          try {
            var parts = [];
            for (var i = 0; i < arguments.length; i++) {
              parts.push(safeStringifyArg(arguments[i]));
            }
            pushEntry('WARN', 'console', parts.join(' '));
          } catch (e) {}
          return origWarn.apply(console, arguments);
        };
      }
    }

    if (global && typeof global.addEventListener === 'function') {
      global.addEventListener('error', function (evt) {
        try {
          var msg = evt && evt.message ? evt.message : 'Uncaught script error';
          var file = evt && evt.filename ? String(evt.filename).split('/').pop() : '';
          var line = evt && evt.lineno ? ':' + evt.lineno : '';
          pushEntry('ERR', 'window', msg + (file ? ' (' + file + line + ')' : ''));
        } catch (e) {}
      });

      global.addEventListener('unhandledrejection', function (evt) {
        try {
          var reason = evt && evt.reason ? safeStringifyArg(evt.reason) : 'Unhandled Promise rejection';
          pushEntry('ERR', 'promise', reason);
        } catch (e) {}
      });
    }
  }

  function getLogs(limit) {
    var max = typeof limit === 'number' && limit > 0 ? limit : MAX_LOG_ENTRIES;
    var start = Math.max(0, entries.length - max);
    var out = [];
    for (var i = start; i < entries.length; i++) {
      var e = entries[i];
      out.push('[' + e.time + '] [' + e.level + '] [' + e.source + '] ' + e.message);
    }
    return out;
  }

  function collectMeta(app) {
    var a = app || (global && global.app) || null;
    var platform = 'Web Browser';
    try {
      if (a && typeof a.isWebOSPlatform === 'function' && a.isWebOSPlatform()) {
        platform = 'LG webOS';
      } else if (a && typeof a.isAndroidTvWebView === 'function' && a.isAndroidTvWebView()) {
        platform = 'Android TV';
      } else if (global && global.__IPTV_IS_WEBOS) {
        platform = 'LG webOS';
      } else if (global && global.__IPTV_IS_ANDROID_TV) {
        platform = 'Android TV';
      }
    } catch (e) {}

    var version = 'unknown';
    var baseVersion = 'unknown';
    try {
      if (a && a.otaManager && typeof a.otaManager.getRunningVersion === 'function') {
        version = a.otaManager.getRunningVersion();
      }
      if (a && a.otaManager && typeof a.otaManager.getBaseBundleVersion === 'function') {
        baseVersion = a.otaManager.getBaseBundleVersion();
      }
    } catch (e) {}

    var uiPrefs = a && typeof a.getUiPrefs === 'function' ? a.getUiPrefs() : {};
    var avPrefs = a && typeof a.getAvPrefs === 'function' ? a.getAvPrefs() : {};
    var theme = a && typeof a.getTheme === 'function' ? a.getTheme() : (global.__IPTV_THEME || 'classic');
    var bufMode = a && a.player && a.player.bufferMode ? a.player.bufferMode : 'smart';
    var chCount = a && Array.isArray(a.allChannels) ? a.allChannels.length : 0;
    var epgLoaded = Boolean(a && a.epg && a.epg.programmes && a.epg.programmes.size > 0);
    var vw = typeof global.innerWidth === 'number' ? global.innerWidth : 0;
    var vh = typeof global.innerHeight === 'number' ? global.innerHeight : 0;

    return {
      version: version,
      baseVersion: baseVersion,
      platform: platform,
      theme: theme,
      uiPreset: uiPrefs.preset || 'clean',
      bufferMode: bufMode,
      audioNormMode: avPrefs.audioNormMode || 'off',
      channelsCount: chCount,
      epgLoaded: epgLoaded,
      viewport: vw + 'x' + vh,
      timestamp: new Date().toISOString()
    };
  }

  function buildReport(userTitle, userDescription, app) {
    var title = redactText((userTitle || '').trim()) || 'דיווח תקלה מהאפליקציה';
    var desc = redactText((userDescription || '').trim()) || 'לא הוזן תיאור נוסף.';
    var meta = collectMeta(app);
    var logs = getLogs(60);

    var md = [
      '### תיאור התקלה',
      desc,
      '',
      '### פרטי מערכת (אוטומטי)',
      '- **גרסה:** `v' + meta.version + '` (בסיס: `v' + meta.baseVersion + '`)',
      '- **פלטפורמה:** ' + meta.platform + ' (' + meta.viewport + ')',
      '- **ערכת נושא / פריסט:** `' + meta.theme + '` / `' + meta.uiPreset + '`',
      '- **באפר / השוואת סאונד:** `' + meta.bufferMode + '` / `' + meta.audioNormMode + '`',
      '- **ערוצים / EPG:** ' + meta.channelsCount + ' ערוצים | EPG: ' + (meta.epgLoaded ? 'פעיל' : 'לא נטען'),
      '- **זמן דיווח:** `' + meta.timestamp + '`',
      '',
      '<details>',
      '<summary>לוגים טכניים אוטומטיים (' + logs.length + ' שורות מסוננות)</summary>',
      '',
      '```text',
      logs.length > 0 ? logs.join('\n') : '(אין שגיאות או אזהרות רשומות)',
      '```',
      '</details>'
    ].join('\n');

    return {
      title: title,
      description: desc,
      meta: meta,
      logs: logs,
      markdown: md
    };
  }

  function buildGitHubNewIssueUrl(report, maxBodyChars) {
    var rep = report || buildReport('', '');
    var limit = typeof maxBodyChars === 'number' && maxBodyChars > 200 ? maxBodyChars : 1100;
    var shortLogs = rep.logs.slice(-12).join('\n');
    if (shortLogs.length > 520) {
      shortLogs = shortLogs.slice(shortLogs.length - 520);
    }
    var compactBody = [
      rep.description,
      '',
      '---',
      'v' + rep.meta.version + ' | ' + rep.meta.platform + ' | ' + rep.meta.theme + ' | ch:' + rep.meta.channelsCount,
      shortLogs ? '```\n' + shortLogs + '\n```' : '(no errors logged)'
    ].join('\n');

    if (compactBody.length > limit) {
      compactBody = compactBody.slice(0, limit - 3) + '...';
    }

    return (
      GITHUB_REPO_NEW_ISSUE +
      '?title=' +
      encodeURIComponent('[TV Report] ' + rep.title) +
      '&body=' +
      encodeURIComponent(compactBody)
    );
  }

  function getEndpointUrl() {
    try {
      var saved = localStorage.getItem(ENDPOINT_STORAGE_KEY);
      if (saved && /^https?:\/\//i.test(saved.trim())) {
        return saved.trim();
      }
    } catch (e) {}
    return DEFAULT_ISSUE_ENDPOINT;
  }

  function setEndpointUrl(url) {
    try {
      if (url && /^https?:\/\//i.test(url.trim())) {
        localStorage.setItem(ENDPOINT_STORAGE_KEY, url.trim());
      } else {
        localStorage.removeItem(ENDPOINT_STORAGE_KEY);
      }
    } catch (e) {}
  }

  function submitIssue(userTitle, userDescription, app) {
    var report = buildReport(userTitle, userDescription, app);
    var githubUrl = buildGitHubNewIssueUrl(report, 1000);
    var endpoint = getEndpointUrl();

    if (!endpoint) {
      return Promise.resolve({
        ok: false,
        mode: 'qr_fallback',
        reason: 'no_endpoint',
        report: report,
        githubUrl: githubUrl
      });
    }

    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: report.title,
        description: report.description,
        meta: report.meta,
        logs: report.logs
      })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.ok) {
          throw new Error((data && data.error) || 'Worker rejected issue');
        }
        return {
          ok: true,
          mode: 'api',
          issueNumber: data.issueNumber || null,
          issueUrl: data.issueUrl || githubUrl,
          report: report,
          githubUrl: data.issueUrl || githubUrl
        };
      })
      .catch(function (err) {
        return {
          ok: false,
          mode: 'qr_fallback',
          reason: err && err.message ? err.message : 'network_error',
          report: report,
          githubUrl: githubUrl
        };
      });
  }

  installHooks();

  var api = {
    MAX_LOG_ENTRIES: MAX_LOG_ENTRIES,
    redactText: redactText,
    record: pushEntry,
    getLogs: getLogs,
    clearLogs: function () {
      entries = [];
    },
    collectMeta: collectMeta,
    buildReport: buildReport,
    buildGitHubNewIssueUrl: buildGitHubNewIssueUrl,
    getEndpointUrl: getEndpointUrl,
    setEndpointUrl: setEndpointUrl,
    submitIssue: submitIssue
  };

  global.DiagnosticLogger = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
