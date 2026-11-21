#!/usr/bin/env node
/**
 * Automated E2E & Regression Verification Suite for IPTV Live TV
 * Targets:
 *  - LG webOS Smart TV (1920x1080 & 1280x720 scaled, Chromium 53 syntax checks, Classic & Glass themes)
 *  - Android TV WebView (virtual origin simulation, Safe Mode, Back handling, AndroidTvHost bridge)
 *  - OTA Live-Instance & Cold-Boot Upgrades (prevents disappearing channels on upgrade from v5.0.x / v5.1.x)
 *  - Settings Modal Scrolling across all tabs (D-pad Arrows, PageUp/PageDown, Mouse Wheel, Classic & Glass)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync, execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');

function parseArgs(argv) {
  const opts = {
    platform: 'all',
    webRoot: process.cwd(),
    repoRoot: process.cwd()
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.indexOf('--platform=') === 0) {
      opts.platform = a.slice('--platform='.length).toLowerCase();
    } else if (a.indexOf('--web-root=') === 0) {
      opts.webRoot = path.resolve(a.slice('--web-root='.length));
    } else if (a.indexOf('--repo-root=') === 0) {
      opts.repoRoot = path.resolve(a.slice('--repo-root='.length));
    }
  }
  return opts;
}

function findBrowserExecutable() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);

  for (let i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) {
      return candidates[i];
    }
  }
  throw new Error('Could not find Chromium/Chrome/Edge executable. Set PUPPETEER_EXECUTABLE_PATH.');
}

function buildSampleM3u(count) {
  const lines = ['#EXTM3U'];
  for (let i = 1; i <= count; i++) {
    const chId = i === 1 ? 'kan11' : i === 2 ? 'keshet12' : i === 3 ? 'reshet13' : 'ch_' + i;
    const chName = i === 1 ? 'כאן 11' : i === 2 ? 'קשת 12' : i === 3 ? 'רשת 13' : 'ערוץ בדיקה ' + i;
    lines.push(`#EXTINF:-1 tvg-id="${chId}" group-title="בדיקה",${chName}`);
    lines.push(`http://127.0.0.1:19999/live/${i}.m3u8`);
  }
  return lines.join('\n') + '\n';
}

function buildSampleCachedChannels(count) {
  const out = [];
  for (let i = 1; i <= count; i++) {
    out.push({
      uid: 'src_1::' + i,
      sourceId: 'src_1',
      sourceName: 'רשימת בדיקה',
      number: i + 10,
      name: i === 1 ? 'כאן 11' : i === 2 ? 'קשת 12' : i === 3 ? 'רשת 13' : 'ערוץ בדיקה ' + i,
      epgId: i === 1 ? 'kan11' : i === 2 ? 'keshet12' : i === 3 ? 'reshet13' : 'ch_' + i,
      group: 'כללי',
      url: 'http://127.0.0.1:19999/live/' + i + '.m3u8'
    });
  }
  return out;
}

function createStaticServer(options) {
  const webRoot = options.webRoot;
  const gitTag = options.gitTag || '';
  const sampleM3u = options.sampleM3u || buildSampleM3u(25);
  const sampleMode = options.sampleMode || 'ok'; // 'ok' | 'error'

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      if (urlPath === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
      }
      if (urlPath === '/sample.m3u') {
        if (sampleMode === 'error') {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('Upstream error');
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(sampleM3u);
      }

      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      let body;
      try {
        if (gitTag) {
          body = execFileSync('git', ['show', gitTag + ':' + rel], { encoding: null });
        } else {
          const abs = path.resolve(webRoot, rel);
          if (abs.indexOf(path.resolve(webRoot)) !== 0) {
            res.writeHead(403);
            return res.end('Forbidden');
          }
          body = fs.readFileSync(abs);
        }
      } catch (e) {
        res.writeHead(404);
        return res.end('Not found');
      }

      const ext = path.extname(rel).toLowerCase();
      const mimeMap = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.xml': 'application/xml; charset=utf-8',
        '.png': 'image/png',
        '.svg': 'image/svg+xml'
      };
      res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' });
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function hasGitTag(repoRoot, tag) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', 'refs/tags/' + tag], {
      cwd: repoRoot,
      stdio: 'ignore'
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function runStaticChecks(webRoot, repoRoot) {
  const appInfo = JSON.parse(fs.readFileSync(path.join(webRoot, 'appinfo.json'), 'utf8'));
  const expectedVer = appInfo.version;
  assert(expectedVer && /^\d+\.\d+\.\d+$/.test(expectedVer), 'appinfo.json must contain semver version');

  const appConfig = JSON.parse(fs.readFileSync(path.join(webRoot, 'app-config.json'), 'utf8'));
  assert.strictEqual(appConfig.version, expectedVer, 'app-config.json version mismatch');

  const qrOtaCode = fs.readFileSync(path.join(webRoot, 'js/qr-ota.js'), 'utf8');
  assert(
    qrOtaCode.indexOf("APP_BUNDLE_VERSION = '" + expectedVer + "'") !== -1,
    'js/qr-ota.js APP_BUNDLE_VERSION must match ' + expectedVer
  );

  const indexHtml = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  assert(indexHtml.indexOf('v' + expectedVer) !== -1, 'index.html version badge must reference v' + expectedVer);

  const pkgPath = path.join(repoRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.strictEqual(pkg.version, expectedVer, 'package.json version mismatch');
  }

  const gradlePath = path.join(repoRoot, 'android-tv/app/build.gradle.kts');
  if (fs.existsSync(gradlePath)) {
    const gradle = fs.readFileSync(gradlePath, 'utf8');
    assert(
      gradle.indexOf('versionName = "' + expectedVer + '"') !== -1,
      'android-tv/app/build.gradle.kts versionName must match ' + expectedVer
    );
  }

  const otaManifest = JSON.parse(fs.readFileSync(path.join(webRoot, 'ota-manifest.json'), 'utf8'));
  assert.strictEqual(otaManifest.version, expectedVer, 'ota-manifest.json version mismatch (run build-ota-manifest.js)');
  assert(otaManifest.cssPatch && otaManifest.cssPatch.length > 1000, 'ota-manifest.json cssPatch is empty');
  assert(otaManifest.cssGlassPatch && otaManifest.cssGlassPatch.length > 1000, 'ota-manifest.json cssGlassPatch is empty');
  assert(otaManifest.jsPatch && otaManifest.jsPatch.length > 1000, 'ota-manifest.json jsPatch is empty');

  // Verify jsPatch parses cleanly via Function constructor
  new Function(otaManifest.jsPatch);

  // Syntax-check all JS files & check Chromium 53 compatibility
  const jsFiles = [
    'js/loader.js',
    'js/m3u-parser.js',
    'js/lineup-store.js',
    'js/epg.js',
    'js/player.js',
    'js/remote.js',
    'js/qr-ota.js',
    'js/app.js'
  ];

  const compatRules = [
    { name: 'optional chaining (?.)', rx: /\?\.[a-zA-Z_$]/ },
    { name: 'nullish coalescing (??)', rx: /\?\?/ },
    { name: 'object spread ({...)', rx: /\{\s*\.\.\./ },
    { name: 'async function', rx: /\basync\s+function\b/ },
    { name: 'optional catch binding', rx: /\bcatch\s*\{/ },
    { name: 'Array.prototype.flat/flatMap', rx: /\.(flat|flatMap)\(/ },
    { name: 'String.prototype.replaceAll', rx: /\.replaceAll\(/ },
    { name: 'Object.values/entries/fromEntries', rx: /Object\.(values|entries|fromEntries)\(/ }
  ];

  for (let i = 0; i < jsFiles.length; i++) {
    const rel = jsFiles[i];
    const abs = path.join(webRoot, rel);
    execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' });
    const src = fs.readFileSync(abs, 'utf8');
    for (let r = 0; r < compatRules.length; r++) {
      assert(!compatRules[r].rx.test(src), rel + ' contains Chromium 53 incompatible syntax: ' + compatRules[r].name);
    }
  }

  for (let r = 0; r < compatRules.length; r++) {
    assert(
      !compatRules[r].rx.test(otaManifest.jsPatch),
      'ota-manifest.json jsPatch contains Chromium 53 incompatible syntax: ' + compatRules[r].name
    );
  }

  for (const cssRel of ['css/style.css', 'css/theme-glass.css']) {
    const cssText = fs.readFileSync(path.join(webRoot, cssRel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert(!/:\s*[^;{}]*\b(clamp|min|max)\s*\(/i.test(cssText), cssRel + ' must not use CSS min()/max()/clamp() (webOS 4.x)');
    const webkitClamps = (cssText.match(/-webkit-line-clamp\s*:/g) || []).length;
    const stdClamps = (cssText.match(/(^|[^-])line-clamp\s*:/gm) || []).length;
    assert.strictEqual(webkitClamps, stdClamps, cssRel + ' must pair every -webkit-line-clamp with standard line-clamp');
  }

  return otaManifest;
}

function attachNetworkInterception(page, serverPort) {
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
  return page.setRequestInterception(true).then(() => {
    page.on('request', (req) => {
      const url = req.url();
      if (url.indexOf('http://127.0.0.1:' + serverPort) === 0) {
        return req.continue();
      }
      if (req.method() === 'OPTIONS') {
        return req.respond({ status: 204, headers: corsHeaders, body: '' });
      }
      if (url.indexOf('ntfy.sh') !== -1) {
        return req.respond({ status: 200, headers: corsHeaders, contentType: 'text/plain', body: '' });
      }
      if (url.indexOf('ota-manifest') !== -1) {
        return req.respond({
          status: 200,
          headers: corsHeaders,
          contentType: 'application/json',
          body: JSON.stringify({ version: '0.0.0' })
        });
      }
      if (url.indexOf('epg-il.xml') !== -1 || url.indexOf('.xml') !== -1) {
        return req.respond({
          status: 200,
          headers: corsHeaders,
          contentType: 'application/xml; charset=utf-8',
          body: '<?xml version="1.0" encoding="UTF-8"?><tv></tv>'
        });
      }
      if (url.indexOf('127.0.0.1:19999') !== -1) {
        return req.respond({
          status: 200,
          headers: corsHeaders,
          contentType: 'application/vnd.apple.mpegurl',
          body: '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-ENDLIST\n'
        });
      }
      return req.abort();
    });
  });
}

async function openConfiguredPage(browser, serverPort, options) {
  const page = await browser.newPage();
  const width = (options && options.width) || 1920;
  const height = (options && options.height) || 1080;
  await page.setViewport({ width, height });
  await attachNetworkInterception(page, serverPort);

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (text.indexOf('Failed to load resource') !== -1 && options && options.allowResourceErrors) {
        return;
      }
      consoleErrors.push(text);
    }
  });

  if (options && options.setupFn) {
    await page.evaluateOnNewDocument(options.setupFn, ...(options.setupArgs || []));
  }

  const query = options && options.query ? options.query : '';
  await page.goto('http://127.0.0.1:' + serverPort + '/' + query, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, (options && options.waitMs) || 700));

  return { page, pageErrors, consoleErrors };
}

async function verifySettingsScrollingForTheme(page, theme) {
  await page.evaluate((targetTheme) => {
    window.app.applyTheme(targetTheme, true);
  }, theme);
  await page.waitForFunction((targetTheme) => {
    const link = document.getElementById(targetTheme === 'glass' ? 'theme-css-glass' : 'theme-css-classic');
    return Boolean(link && !link.disabled && link.media === 'all' && link.sheet);
  }, {}, theme);
  await new Promise((r) => setTimeout(r, 80));

  const result = await page.evaluate((targetTheme) => {
    window.app.openSettingsModal();

    const out = { theme: targetTheme, tabs: {} };

    // 1. Sources tab: navigate all the way down to bottom virtual keyboard/status controls
    window.app.switchSettingsTab('sources');
    window.app.setupModalFocus('#settings-modal');
    const srcEl = document.getElementById('settings-tab-sources');
    let srcSteps = [];
    for (let i = 0; i < 45; i++) {
      window.app.navigate('down');
      const cur = window.app.currentFocusedEl;
      if (cur && !cur.classList.contains('settings-tab-btn') && !cur.classList.contains('modal-close-btn')) {
        const cr = srcEl.getBoundingClientRect();
        const tr = cur.getBoundingClientRect();
        srcSteps.push({
          topOk: tr.top >= cr.top - 4,
          bottomOk: tr.bottom <= cr.bottom + 4
        });
      }
    }
    out.tabs.sources = {
      clientH: srcEl.clientHeight,
      scrollH: srcEl.scrollHeight,
      scrollTopAfterDown: srcEl.scrollTop,
      allVisibleInViewport: srcSteps.length > 0 && srcSteps.every((s) => s.topOk && s.bottomOk)
    };

    // 2. Channels tab: navigate down inside #channel-editor-list and verify scrolling works
    window.app.switchSettingsTab('channels');
    window.app.setupModalFocus('#settings-modal');
    const editorList = document.getElementById('channel-editor-list');
    let editorSteps = [];
    for (let i = 0; i < 20; i++) {
      window.app.navigate('down');
      const cur = window.app.currentFocusedEl;
      if (cur && editorList.contains(cur)) {
        const cr = editorList.getBoundingClientRect();
        const tr = cur.getBoundingClientRect();
        editorSteps.push({
          topOk: tr.top >= cr.top - 4,
          bottomOk: tr.bottom <= cr.bottom + 4
        });
      }
    }
    out.tabs.channels = {
      clientH: editorList.clientHeight,
      scrollH: editorList.scrollHeight,
      scrollTopAfterDown: editorList.scrollTop,
      allVisibleInViewport: editorSteps.length > 0 && editorSteps.every((s) => s.topOk && s.bottomOk)
    };

    // 3. Performance tab (Theme + Buffer + Cache): must reset to 0, scroll down to bottom buttons, then scroll back up to 0
    window.app.switchSettingsTab('performance');
    const perfEl = document.getElementById('settings-tab-performance');
    const resetOnSwitch = perfEl.scrollTop;
    window.app.setupModalFocus('#settings-modal');

    const perfVis = [];
    let seenBottomRefreshBtn = false;
    for (let i = 0; i < 12; i++) {
      window.app.navigate('down');
      const cur = window.app.currentFocusedEl;
      if (cur && perfEl.contains(cur)) {
        const cr = perfEl.getBoundingClientRect();
        const tr = cur.getBoundingClientRect();
        perfVis.push({
          id: cur.id || cur.dataset.buffer || cur.dataset.ttl || cur.dataset.uiTheme || 'btn',
          topOk: tr.top >= cr.top - 6,
          bottomOk: tr.bottom <= cr.bottom + 6
        });
        if (cur.id === 'btn-force-refresh-cache' || cur.id === 'btn-clear-all-cache') {
          seenBottomRefreshBtn = true;
          break;
        }
      }
    }
    const maxScrollAfterDown = perfEl.scrollTop;

    // Navigate back up to the top card & tab header
    for (let i = 0; i < 12; i++) {
      window.app.navigate('up');
      const cur = window.app.currentFocusedEl;
      if (cur && (cur.classList.contains('settings-tab-btn') || cur.classList.contains('modal-close-btn'))) {
        break;
      }
    }
    const scrollAfterUp = perfEl.scrollTop;

    // PageDown / PageUp remote helper must scroll modal without changing selectedChannel
    const prevChId = window.app.selectedChannel ? window.app.selectedChannel.id : null;
    window.app.remote.dispatchKeyEventFallbackTest = true;
    perfEl.scrollTop = 0;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', keyCode: 34, bubbles: true }));
    const afterPageDown = perfEl.scrollTop;
    const chAfterPageDown = window.app.selectedChannel ? window.app.selectedChannel.id : null;

    out.tabs.performance = {
      resetOnSwitch,
      clientH: perfEl.clientHeight,
      scrollH: perfEl.scrollHeight,
      overflows: perfEl.scrollHeight > perfEl.clientHeight,
      needsDpadScroll: perfEl.scrollHeight > perfEl.clientHeight + 28,
      maxScrollAfterDown,
      scrollAfterUp,
      seenBottomRefreshBtn,
      afterPageDown,
      channelUnchangedOnPageDown: prevChId === chAfterPageDown,
      badItems: perfVis.filter((v) => !v.topOk || !v.bottomOk)
    };

    // 4. Appearance tab (5th/customization panel): 1-line tab bar + scroll all the way to #btn-reset-ui-prefs & back up
    window.app.switchSettingsTab('appearance');
    const appEl = document.getElementById('settings-tab-appearance');
    const appResetOnSwitch = appEl.scrollTop;
    window.app.setupModalFocus('#settings-modal');

    const tabBtns = Array.from(document.querySelectorAll('#settings-modal .settings-tab-btn'));
    const tabTop0 = tabBtns[0] ? tabBtns[0].getBoundingClientRect().top : 0;
    const tabsSingleLine = tabBtns.length === 5 && tabBtns.every((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && Math.abs(r.top - tabTop0) <= 6;
    });

    const appVis = [];
    let seenResetUiBtn = false;
    for (let i = 0; i < 25; i++) {
      window.app.navigate('down');
      const cur = window.app.currentFocusedEl;
      if (cur && appEl.contains(cur)) {
        const cr = appEl.getBoundingClientRect();
        const tr = cur.getBoundingClientRect();
        appVis.push({
          id: cur.id || 'ui-btn',
          topOk: tr.top >= cr.top - 6,
          bottomOk: tr.bottom <= cr.bottom + 6
        });
        if (cur.id === 'btn-reset-ui-prefs') {
          seenResetUiBtn = true;
          break;
        }
      }
    }
    const appMaxScrollAfterDown = appEl.scrollTop;

    for (let i = 0; i < 30; i++) {
      window.app.navigate('up');
      const cur = window.app.currentFocusedEl;
      if (cur && (cur.classList.contains('settings-tab-btn') || cur.classList.contains('modal-close-btn'))) {
        break;
      }
    }
    const appScrollAfterUp = appEl.scrollTop;

    appEl.scrollTop = 0;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', keyCode: 34, bubbles: true }));
    const appAfterPageDown = appEl.scrollTop;

    window.app.closeModals();

    out.tabs.appearance = {
      tabsSingleLine,
      resetOnSwitch: appResetOnSwitch,
      clientH: appEl.clientHeight,
      scrollH: appEl.scrollHeight,
      overflows: appEl.scrollHeight > appEl.clientHeight,
      maxScrollAfterDown: appMaxScrollAfterDown,
      scrollAfterUp: appScrollAfterUp,
      seenResetUiBtn,
      afterPageDown: appAfterPageDown,
      badItems: appVis.filter((v) => !v.topOk || !v.bottomOk)
    };

    return out;
  }, theme);

  // Also test real mouse wheel scrolling in #settings-tab-performance & #settings-tab-appearance
  await page.evaluate(() => {
    window.app.openSettingsModal();
    window.app.switchSettingsTab('performance');
    const el = document.getElementById('settings-tab-performance');
    el.scrollTop = 0;
  });
  const box = await page.$eval('#settings-tab-performance', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.wheel({ deltaY: 300 });
  await new Promise((r) => setTimeout(r, 120));
  const wheelScrollTop = await page.$eval('#settings-tab-performance', (el) => el.scrollTop);

  await page.evaluate(() => {
    window.app.switchSettingsTab('appearance');
    const el = document.getElementById('settings-tab-appearance');
    el.scrollTop = 0;
  });
  const appBox = await page.$eval('#settings-tab-appearance', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(appBox.x, appBox.y);
  await page.mouse.wheel({ deltaY: 350 });
  await new Promise((r) => setTimeout(r, 120));
  const appWheelScrollTop = await page.$eval('#settings-tab-appearance', (el) => el.scrollTop);
  await page.evaluate(() => window.app.closeModals());

  result.tabs.performance.wheelScrollTop = wheelScrollTop;
  result.tabs.appearance.wheelScrollTop = appWheelScrollTop;
  return result;
}

async function verifyUiCustomizationSuite(browser, webRoot, sampleM3u25, cached25, pass) {
  const sampleLogoSvg = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#0284c7"/></svg>');
  const cachedWithLogos = cached25.map((ch) => {
    const copy = Object.assign({}, ch);
    copy.logo = sampleLogoSvg;
    return copy;
  });

  // Dedicated static server port for clean isolated localStorage across reload
  const { server, port: serverPort } = await createStaticServer({ webRoot, sampleM3u: sampleM3u25 });
  try {
    const { page, pageErrors, consoleErrors } = await openConfiguredPage(browser, serverPort, {
      width: 1920,
      height: 1080,
      setupFn: (sampleUrl, cached) => {
        window.webOSSystem = { close: function () {} };
        localStorage.setItem('zenplay_iptv_sources_v2', JSON.stringify([{ id: 'src_1', name: 'Test', url: sampleUrl, enabled: true }]));
        localStorage.setItem('zenplay_iptv_cached_lineup_v2', JSON.stringify({ v: 2, updatedAt: Date.now(), discoveredEpgUrls: [], rawChannels: cached }));
      },
      setupArgs: ['http://127.0.0.1:' + serverPort + '/sample.m3u', cachedWithLogos]
    });

    // 1. Default Clean UI + 0 backdrop-filter on .tv-platform Glass
    const defaultsCheck = await page.evaluate(() => {
      const cls = document.documentElement.classList;
      window.app.applyTheme('glass', true);
      const allEls = document.querySelectorAll('*');
      let backdropLeaks = 0;
      for (let i = 0; i < allEls.length; i++) {
        const cs = getComputedStyle(allEls[i]);
        const bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
        if (bf && bf !== 'none') backdropLeaks++;
      }
      window.app.applyTheme('classic', true);
      return {
        hasHideListHints: cls.contains('ui-hide-list-hints'),
        hasCleanHeader: cls.contains('ui-clean-header'),
        hasBalanced: cls.contains('ui-density-balanced'),
        hasOsdClean: cls.contains('ui-osd-clean'),
        hasFxLight: cls.contains('ui-fx-light'),
        hasAnimReduced: cls.contains('ui-anim-reduced'),
        hasScaleMd: cls.contains('ui-scale-md'),
        hasAccentSky: cls.contains('ui-accent-sky'),
        hasHideColorBar: cls.contains('ui-hide-color-bar'),
        hasHideRowEpg: cls.contains('ui-hide-row-epg'),
        hasMonogram: cls.contains('ui-monogram-logos'),
        hasHideStrip: cls.contains('ui-hide-program-strip'),
        listHintDisplay: getComputedStyle(document.querySelector('.list-instruction-bar')).display,
        headerBadgeDisplay: getComputedStyle(document.getElementById('header-version-badge')).display,
        backdropLeaks
      };
    });
    assert(
      defaultsCheck.hasHideListHints &&
        defaultsCheck.hasCleanHeader &&
        defaultsCheck.hasBalanced &&
        defaultsCheck.hasOsdClean &&
        defaultsCheck.hasFxLight &&
        defaultsCheck.hasAnimReduced &&
        defaultsCheck.hasScaleMd &&
        defaultsCheck.hasAccentSky,
      'Default Clean UI classes missing: ' + JSON.stringify(defaultsCheck)
    );
    assert(
      !defaultsCheck.hasHideColorBar && !defaultsCheck.hasHideRowEpg && !defaultsCheck.hasMonogram && !defaultsCheck.hasHideStrip,
      'Unexpected hidden flags on Clean UI default'
    );
    assert.strictEqual(defaultsCheck.listHintDisplay, 'none', 'Clean default must hide .list-instruction-bar');
    assert.strictEqual(defaultsCheck.headerBadgeDisplay, 'none', 'Clean default must hide #header-version-badge');
    assert.strictEqual(defaultsCheck.backdropLeaks, 0, 'Glass .tv-platform must have 0 computed backdrop-filter elements');

    // 2. D-pad navigation into #tab-btn-appearance & preset clicks
    await page.evaluate(() => window.app.openSettingsModal());
    await new Promise((r) => setTimeout(r, 80));
    await page.keyboard.press('ArrowLeft');
    await new Promise((r) => setTimeout(r, 60));
    await page.keyboard.press('ArrowLeft');
    await new Promise((r) => setTimeout(r, 60));
    const focusedAppTab = await page.evaluate(() => window.app.currentFocusedEl && window.app.currentFocusedEl.id);
    assert.strictEqual(focusedAppTab, 'tab-btn-appearance', 'Two ArrowLeft presses from Channels must reach #tab-btn-appearance');
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 80));
    const tabOpen = await page.evaluate(() => !document.getElementById('settings-tab-appearance').classList.contains('hidden'));
    assert.strictEqual(tabOpen, true, '#settings-tab-appearance must open via D-pad Enter');
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 80));

    // 3. Presets (minimal -> full -> clean) + 6 visibility toggles (incl. showRowLogos 0 <img> check)
    const presetAndToggleRes = await page.evaluate(() => {
      document.getElementById('btn-preset-minimal').click();
      const minCls = document.documentElement.classList;
      const minRowImgs = document.querySelectorAll('#channel-list .channel-item img').length;
      const minColorBar = getComputedStyle(document.getElementById('color-bar')).display;
      const minStrip = getComputedStyle(document.querySelector('.program-strip-section')).display;
      const minState = {
        compact: minCls.contains('ui-density-compact'),
        hideColorBar: minCls.contains('ui-hide-color-bar'),
        hideHints: minCls.contains('ui-hide-list-hints'),
        hideRowEpg: minCls.contains('ui-hide-row-epg'),
        monogram: minCls.contains('ui-monogram-logos'),
        hideStrip: minCls.contains('ui-hide-program-strip'),
        osdMinimal: minCls.contains('ui-osd-minimal'),
        animOff: minCls.contains('ui-anim-off'),
        fxFlat: minCls.contains('ui-fx-flat'),
        autoplay: window.app.getUiPrefs().previewAutoplay,
        minRowImgs,
        minColorBar,
        minStrip,
        badgeVisible: !document.getElementById('preview-autoplay-off-badge').classList.contains('hidden')
      };

      document.getElementById('btn-preset-full').click();
      const fullCls = document.documentElement.classList;
      const fullRowImgs = document.querySelectorAll('#channel-list .channel-item img').length;
      const fullState = {
        comfortable: fullCls.contains('ui-density-comfortable'),
        osdFull: fullCls.contains('ui-osd-full'),
        animNormal: fullCls.contains('ui-anim-normal'),
        fxFull: fullCls.contains('ui-fx-full'),
        autoplay: window.app.getUiPrefs().previewAutoplay,
        headerVerDisplay: getComputedStyle(document.getElementById('header-version-badge')).display,
        listHintsDisplay: getComputedStyle(document.querySelector('.list-instruction-bar')).display,
        fullRowImgs
      };

      document.getElementById('btn-preset-clean').click();

      // Exercise all 6 visibility toggles individually
      const toggles = ['showColorBar', 'showListHints', 'showRowEpgBar', 'showRowLogos', 'showProgramStrip', 'showHeaderMeta'];
      const toggleChecks = {};
      for (let i = 0; i < toggles.length; i++) {
        const k = toggles[i];
        const before = window.app.getUiPrefs()[k];
        document.getElementById('btn-pref-' + k).click();
        const after = window.app.getUiPrefs()[k];
        toggleChecks[k] = { before, after, flipped: before !== after };
        if (k === 'showRowLogos') {
          toggleChecks.logosOffImgCount = document.querySelectorAll('#channel-list .channel-item img').length;
          toggleChecks.previewLogoSrcOff = document.getElementById('preview-channel-logo').getAttribute('src');
        }
        document.getElementById('btn-pref-' + k).click();
      }
      const logosBackImgCount = document.querySelectorAll('#channel-list .channel-item img').length;

      return { minState, fullState, toggleChecks, logosBackImgCount };
    });

    assert(
      presetAndToggleRes.minState.compact &&
        presetAndToggleRes.minState.hideColorBar &&
        presetAndToggleRes.minState.hideHints &&
        presetAndToggleRes.minState.hideRowEpg &&
        presetAndToggleRes.minState.monogram &&
        presetAndToggleRes.minState.hideStrip &&
        presetAndToggleRes.minState.osdMinimal &&
        presetAndToggleRes.minState.animOff &&
        presetAndToggleRes.minState.fxFlat &&
        presetAndToggleRes.minState.autoplay === 'off' &&
        presetAndToggleRes.minState.minRowImgs === 0 &&
        presetAndToggleRes.minState.minColorBar === 'none' &&
        presetAndToggleRes.minState.minStrip === 'none' &&
        presetAndToggleRes.minState.badgeVisible,
      'Minimal preset mismatch: ' + JSON.stringify(presetAndToggleRes.minState)
    );
    assert(
      presetAndToggleRes.fullState.comfortable &&
        presetAndToggleRes.fullState.osdFull &&
        presetAndToggleRes.fullState.animNormal &&
        presetAndToggleRes.fullState.fxFull &&
        presetAndToggleRes.fullState.autoplay === 'instant' &&
        presetAndToggleRes.fullState.headerVerDisplay !== 'none' &&
        presetAndToggleRes.fullState.listHintsDisplay !== 'none' &&
        presetAndToggleRes.fullState.fullRowImgs === 25,
      'Full preset mismatch: ' + JSON.stringify(presetAndToggleRes.fullState)
    );
    for (const k of ['showColorBar', 'showListHints', 'showRowEpgBar', 'showRowLogos', 'showProgramStrip', 'showHeaderMeta']) {
      assert.strictEqual(presetAndToggleRes.toggleChecks[k].flipped, true, 'Toggle ' + k + ' did not flip');
    }
    assert.strictEqual(presetAndToggleRes.toggleChecks.logosOffImgCount, 0, 'showRowLogos=false must render 0 channel row <img> elements');
    assert.strictEqual(presetAndToggleRes.toggleChecks.previewLogoSrcOff, null, 'showRowLogos=false must clear preview logo src');
    assert.strictEqual(presetAndToggleRes.logosBackImgCount, 25, 'Restoring showRowLogos=true must render 25 channel row <img> elements');

    // 4. Density heights, fontScale sizes, 5 Accent palettes, animations='off', visualEffects='flat', osdStyle='minimal', osdTimeoutSec
    const controlsCheck = await page.evaluate(() => {
      const heights = {};
      for (const d of ['compact', 'balanced', 'comfortable']) {
        document.getElementById('btn-density-' + d).click();
        const row = document.querySelector('#channel-list .channel-item.active') || document.querySelector('#channel-list .channel-item');
        const badge = row.querySelector('.channel-playing-badge');
        const rowR = row.getBoundingClientRect();
        const badgeR = badge.getBoundingClientRect();
        heights[d] = {
          rowH: Math.round(rowR.height),
          badgeCenterDiff: Math.abs((rowR.top + rowR.height / 2) - (badgeR.top + badgeR.height / 2))
        };
      }
      document.getElementById('btn-density-balanced').click();

      const fontSizes = {};
      for (const s of ['sm', 'md', 'lg']) {
        document.getElementById('btn-scale-' + s).click();
        fontSizes[s] = parseFloat(getComputedStyle(document.querySelector('.channel-title')).fontSize);
      }
      document.getElementById('btn-scale-md').click();

      const accents = {};
      for (const a of ['sky', 'indigo', 'emerald', 'amber', 'mono']) {
        document.getElementById('btn-accent-' + a).click();
        const rootCs = getComputedStyle(document.documentElement);
        accents[a] = rootCs.getPropertyValue('--primary-accent').trim() + '|' + rootCs.getPropertyValue('--primary-bright').trim();
      }

      document.getElementById('btn-anim-off').click();
      const animOffTransition = getComputedStyle(document.getElementById('fullscreen-osd')).transitionDuration;
      const animOffKey = getComputedStyle(document.querySelector('.live-pulse')).animationName;

      document.getElementById('btn-fx-flat').click();
      const flatBoxShadow = getComputedStyle(document.querySelector('.channel-item')).boxShadow;
      const flatBgImg = getComputedStyle(document.querySelector('.channel-item')).backgroundImage;

      document.getElementById('btn-osd-minimal').click();
      const osdMinDesc = getComputedStyle(document.querySelector('.osd-epg-desc')).display;
      const osdMinGrid = getComputedStyle(document.querySelector('.osd-schedule-grid')).display;
      const osdMinArrows = getComputedStyle(document.querySelector('.osd-arrows-indicator')).display;

      document.getElementById('btn-osd-sec-8').click();
      const osdTimeoutMs = window.app.getOsdTimeoutMs();

      return { heights, fontSizes, accents, animOffTransition, animOffKey, flatBoxShadow, flatBgImg, osdMinDesc, osdMinGrid, osdMinArrows, osdTimeoutMs };
    });

    assert(
      controlsCheck.heights.compact.rowH < controlsCheck.heights.balanced.rowH &&
        controlsCheck.heights.balanced.rowH < controlsCheck.heights.comfortable.rowH,
      'Density heights must be strictly increasing: ' + JSON.stringify(controlsCheck.heights)
    );
    for (const d of ['compact', 'balanced', 'comfortable']) {
      assert(controlsCheck.heights[d].badgeCenterDiff <= 2.5, 'Badge not vertically centered in ' + d + ': ' + controlsCheck.heights[d].badgeCenterDiff);
    }
    assert(
      controlsCheck.fontSizes.sm < controlsCheck.fontSizes.md && controlsCheck.fontSizes.md < controlsCheck.fontSizes.lg,
      'Font scale sizes must increase sm < md < lg: ' + JSON.stringify(controlsCheck.fontSizes)
    );
    assert.strictEqual(new Set(Object.keys(controlsCheck.accents).map((k) => controlsCheck.accents[k])).size, 5, 'All 5 accent palettes must produce distinct CSS colors');
    assert.strictEqual(controlsCheck.animOffTransition, '0s', 'animations=off must zero transitionDuration');
    assert.strictEqual(controlsCheck.animOffKey, 'none', 'animations=off must disable keyframe animation');
    assert.strictEqual(controlsCheck.flatBoxShadow, 'none', 'visualEffects=flat must remove box-shadow');
    assert.strictEqual(controlsCheck.flatBgImg, 'none', 'visualEffects=flat must remove background-image gradients');
    assert(
      controlsCheck.osdMinDesc === 'none' && controlsCheck.osdMinGrid === 'none' && controlsCheck.osdMinArrows === 'none',
      'osdStyle=minimal must hide synopsis, schedule grid, and arrows'
    );
    assert.strictEqual(controlsCheck.osdTimeoutMs, 8000, 'osdTimeoutSec=8 must return 8000ms');

    // 5. previewAutoplay === 'off': no playback until OK -> FULLSCREEN, Back stops playback
    await page.evaluate(() => {
      document.getElementById('btn-autoplay-off').click();
      window.app.closeModals();
    });
    await page.keyboard.press('ArrowDown');
    await new Promise((r) => setTimeout(r, 250));
    const autoplayOffBrowse = await page.evaluate(() => ({
      mode: window.app.mode,
      hasHls: Boolean(window.app.player && window.app.player.hls),
      isNative: Boolean(window.app.player && window.app.player._isNativePlayback),
      isPlaying: Boolean(window.app.player && window.app.player._isPlaying),
      badgeVisible: !document.getElementById('preview-autoplay-off-badge').classList.contains('hidden')
    }));
    assert.strictEqual(autoplayOffBrowse.mode, 'BROWSE');
    assert(!autoplayOffBrowse.hasHls && !autoplayOffBrowse.isNative && !autoplayOffBrowse.isPlaying, 'previewAutoplay=off must not play in BROWSE');
    assert.strictEqual(autoplayOffBrowse.badgeVisible, true, 'previewAutoplay=off badge must be visible in BROWSE');

    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 150));
    const autoplayOffFs = await page.evaluate(() => ({
      mode: window.app.mode,
      currentUrl: window.app.player ? window.app.player._currentUrl : '',
      badgeHidden: document.getElementById('preview-autoplay-off-badge').classList.contains('hidden')
    }));
    assert.strictEqual(autoplayOffFs.mode, 'FULLSCREEN', 'OK with previewAutoplay=off must enter FULLSCREEN');
    assert(autoplayOffFs.currentUrl.length > 0, 'OK with previewAutoplay=off must start stream playback in FULLSCREEN');
    assert.strictEqual(autoplayOffFs.badgeHidden, true, 'Autoplay-off badge must hide in FULLSCREEN');

    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 150));
    const autoplayOffBack = await page.evaluate(() => ({
      mode: window.app.mode,
      hasHls: Boolean(window.app.player && window.app.player.hls),
      isNative: Boolean(window.app.player && window.app.player._isNativePlayback),
      badgeVisible: !document.getElementById('preview-autoplay-off-badge').classList.contains('hidden')
    }));
    assert.strictEqual(autoplayOffBack.mode, 'BROWSE');
    assert(!autoplayOffBack.hasHls && !autoplayOffBack.isNative, 'Back to BROWSE with previewAutoplay=off must stop playback');
    assert.strictEqual(autoplayOffBack.badgeVisible, true, 'Autoplay-off badge must reappear on Back to BROWSE');

    // 6. Persistence across reload + Reset to Clean defaults
    await page.evaluate(() => {
      window.app.setUiPref('showRowLogos', false, true);
      window.app.setUiPref('density', 'compact', true);
      window.app.setUiPref('accent', 'emerald', true);
      window.app.setUiPref('fontScale', 'lg', true);
      window.app.setUiPref('startupMode', 'fullscreen', true);
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 700));
    const persisted = await page.evaluate(() => {
      const cls = document.documentElement.classList;
      return {
        compact: cls.contains('ui-density-compact'),
        emerald: cls.contains('ui-accent-emerald'),
        scaleLg: cls.contains('ui-scale-lg'),
        monogram: cls.contains('ui-monogram-logos'),
        osdTimeoutSec: window.app.getUiPrefs().osdTimeoutSec,
        previewAutoplay: window.app.getUiPrefs().previewAutoplay,
        startupMode: window.app.getUiPrefs().startupMode,
        rowImgs: document.querySelectorAll('#channel-list .channel-item img').length,
        bootMode: window.app.mode
      };
    });
    assert(
      persisted.compact &&
        persisted.emerald &&
        persisted.scaleLg &&
        persisted.monogram &&
        persisted.osdTimeoutSec === 8 &&
        persisted.previewAutoplay === 'off' &&
        persisted.startupMode === 'fullscreen' &&
        persisted.rowImgs === 0 &&
        persisted.bootMode === 'FULLSCREEN',
      'Reload persistence & startupMode=fullscreen failed: ' + JSON.stringify(persisted)
    );

    // Reset via #btn-reset-ui-prefs
    const resetRes = await page.evaluate(() => {
      document.getElementById('btn-reset-ui-prefs').click();
      const prefs = window.app.getUiPrefs();
      const cls = document.documentElement.classList;
      return {
        preset: prefs.preset,
        density: prefs.density,
        accent: prefs.accent,
        showRowLogos: prefs.showRowLogos,
        startupMode: prefs.startupMode,
        hasBalanced: cls.contains('ui-density-balanced'),
        hasSky: cls.contains('ui-accent-sky'),
        rowImgs: document.querySelectorAll('#channel-list .channel-item img').length
      };
    });
    assert.strictEqual(resetRes.preset, 'clean');
    assert.strictEqual(resetRes.density, 'balanced');
    assert.strictEqual(resetRes.accent, 'sky');
    assert.strictEqual(resetRes.showRowLogos, true);
    assert.strictEqual(resetRes.startupMode, 'browse');
    assert(resetRes.hasBalanced && resetRes.hasSky && resetRes.rowImgs === 25, 'Reset did not restore Clean UI defaults');

    assert.strictEqual(pageErrors.length, 0, 'UI customization suite pageerrors: ' + pageErrors.join('; '));
    assert.strictEqual(consoleErrors.length, 0, 'UI customization suite console errors: ' + consoleErrors.join('; '));
    await page.close();
    pass('ui-customization-persistence-and-lightness', 'Clean defaults, presets, 6 toggles, density, fontScale, 5 accents, flat FX, anim=off, autoplay=off, OSD, reload persistence, startupMode=fullscreen & reset verified');
  } finally {
    server.close();
  }
}

async function runTests() {
  const opts = parseArgs(process.argv);
  const steps = [];
  function pass(name, detail) {
    steps.push({ name, ok: true, detail });
    console.log('[PASS]', name, detail ? '- ' + detail : '');
  }

  // 1. Static Checks
  const otaManifest = await runStaticChecks(opts.webRoot, opts.repoRoot);
  pass('static-checks', 'v' + otaManifest.version + ', ES5/Chromium53 OK, jsPatch parses cleanly');

  const execPath = findBrowserExecutable();
  const browser = await puppeteer.launch({
    executablePath: execPath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1920,1080']
  });

  try {
    const sampleM3u25 = buildSampleM3u(25);
    const cached25 = buildSampleCachedChannels(25);

    // 2. LG webOS Platform Suite (Fresh Boot, Theme Switching, Navigation & Fullscreen Back)
    if (opts.platform === 'all' || opts.platform === 'webos') {
      const { server, port } = await createStaticServer({ webRoot: opts.webRoot, sampleM3u: sampleM3u25 });
      try {
        const { page, pageErrors, consoleErrors } = await openConfiguredPage(browser, port, {
          width: 1920,
          height: 1080,
          setupFn: (sampleUrl, cached) => {
            window.webOSSystem = { close: function () {} };
            localStorage.setItem('zenplay_iptv_sources_v2', JSON.stringify([{ id: 'src_1', name: 'Test', url: sampleUrl, enabled: true }]));
            localStorage.setItem('zenplay_iptv_cached_lineup_v2', JSON.stringify({ v: 2, updatedAt: Date.now(), discoveredEpgUrls: [], rawChannels: cached }));
          },
          setupArgs: ['http://127.0.0.1:' + port + '/sample.m3u', cached25]
        });

        const bootCheck = await page.evaluate(() => ({
          isWebOS: window.__IPTV_IS_WEBOS === true,
          domRows: document.querySelectorAll('#channel-list .channel-item').length,
          splashHidden: document.getElementById('boot-splash').classList.contains('hidden'),
          listH: document.getElementById('channel-list').clientHeight
        }));
        assert.strictEqual(bootCheck.isWebOS, true, 'webOS platform flag should be active');
        assert.strictEqual(bootCheck.domRows, 25, 'All 25 channels should render on webOS cold boot');
        assert.strictEqual(bootCheck.splashHidden, true, 'Boot splash must be hidden');
        assert(bootCheck.listH > 400, 'Channel list must have positive layout height');

        // Live theme toggle Classic <-> Glass & back to Classic (including rapid synchronous toggles)
        const themeCheck = await page.evaluate(() => {
          window.app.applyTheme('glass', true);
          window.app.applyTheme('classic', true);
          window.app.applyTheme('glass', true);
          const gLink = document.getElementById('theme-css-glass');
          const cLink = document.getElementById('theme-css-classic');
          const gActive = document.documentElement.classList.contains('theme-glass');
          const gLinkOn = gLink.media === 'all' && Boolean(gLink.sheet);
          const cLinkOff = cLink.media === 'not all' && Boolean(cLink.sheet);
          window.app.applyTheme('classic', true);
          const cActive = document.documentElement.classList.contains('theme-classic');
          return {
            gActive,
            gLinkOn,
            cLinkOff,
            cActive,
            domRowsAfterSwitch: document.querySelectorAll('#channel-list .channel-item').length
          };
        });
        assert(themeCheck.gActive && themeCheck.gLinkOn && themeCheck.cLinkOff, 'Glass theme link toggling broken');
        assert(themeCheck.cActive && themeCheck.domRowsAfterSwitch === 25, 'Classic theme switch lost channels');

        // D-pad navigation, Enter (select channel, then Enter again for Fullscreen), Back return
        await page.keyboard.press('ArrowDown');
        await new Promise((r) => setTimeout(r, 60));
        await page.keyboard.press('ArrowDown');
        await new Promise((r) => setTimeout(r, 60));
        await page.keyboard.press('Enter');
        await new Promise((r) => setTimeout(r, 180));
        await page.keyboard.press('Enter');
        await new Promise((r) => setTimeout(r, 180));
        const modeInFs = await page.evaluate(() => window.app.mode);
        assert.strictEqual(modeInFs, 'FULLSCREEN', 'Second Enter on selected channel must enter FULLSCREEN');
        await page.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 180));
        const navState = await page.evaluate(() => ({
          mode: window.app.mode,
          focusedIdx: window.app.focusedChannelIndex
        }));
        assert.strictEqual(navState.mode, 'BROWSE', 'Back/Escape from Fullscreen must return to BROWSE mode');
        assert.strictEqual(navState.focusedIdx, 2, 'Focused index must advance via ArrowDown');

        assert.strictEqual(pageErrors.length, 0, 'Unexpected pageerrors: ' + pageErrors.join('; '));
        assert.strictEqual(consoleErrors.length, 0, 'Unexpected console errors: ' + consoleErrors.join('; '));
        pass('webos-fresh-nav-theme', '25 channels rendered, Glass/Classic toggle + D-pad/Fullscreen/Back OK');

        // Real TV Remote D-pad navigation in Settings -> Performance tab -> Theme & 2-column rows
        await page.evaluate(() => {
          window.app.applyTheme('classic', true);
          window.app.openSettingsModal();
        });
        await new Promise((r) => setTimeout(r, 80));
        await page.keyboard.press('ArrowLeft');
        await new Promise((r) => setTimeout(r, 60));
        const focusedTabPerf = await page.evaluate(() => window.app.currentFocusedEl && window.app.currentFocusedEl.id);
        assert.strictEqual(focusedTabPerf, 'tab-btn-performance', 'ArrowLeft from tab-btn-channels must land on tab-btn-performance');
        await page.keyboard.press('Enter');
        await new Promise((r) => setTimeout(r, 120));
        await page.keyboard.press('ArrowDown');
        await new Promise((r) => setTimeout(r, 60));
        assert.strictEqual(
          await page.evaluate(() => window.app.currentFocusedEl && window.app.currentFocusedEl.id),
          'btn-theme-classic',
          'ArrowDown from tab-btn-performance must focus btn-theme-classic'
        );
        await page.keyboard.press('ArrowLeft');
        await new Promise((r) => setTimeout(r, 60));
        assert.strictEqual(
          await page.evaluate(() => window.app.currentFocusedEl && window.app.currentFocusedEl.id),
          'btn-theme-glass',
          'ArrowLeft from btn-theme-classic must focus btn-theme-glass'
        );
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => {
          const g = document.getElementById('theme-css-glass');
          return Boolean(g && g.media === 'all' && g.sheet && window.app.getTheme() === 'glass');
        });
        await new Promise((r) => setTimeout(r, 60));
        const glassVisual = await page.evaluate(() => ({
          theme: window.app.getTheme(),
          active: document.getElementById('btn-theme-glass').classList.contains('active-option'),
          radius: getComputedStyle(document.querySelector('.modal-settings-card')).borderRadius
        }));
        assert.strictEqual(glassVisual.theme, 'glass');
        assert.strictEqual(glassVisual.active, true, 'Glass button must become active-option after OK');
        assert.strictEqual(glassVisual.radius, '28px', 'Glass stylesheet border-radius (28px) must be active');

        await page.keyboard.press('ArrowRight');
        await new Promise((r) => setTimeout(r, 60));
        assert.strictEqual(
          await page.evaluate(() => window.app.currentFocusedEl && window.app.currentFocusedEl.id),
          'btn-theme-classic',
          'ArrowRight from btn-theme-glass must focus btn-theme-classic'
        );
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => {
          const c = document.getElementById('theme-css-classic');
          return Boolean(c && c.media === 'all' && c.sheet && window.app.getTheme() === 'classic');
        });
        await new Promise((r) => setTimeout(r, 60));
        assert.strictEqual(
          await page.evaluate(() => getComputedStyle(document.querySelector('.modal-settings-card')).borderRadius),
          '24px',
          'Classic stylesheet border-radius (24px) must be active after OK'
        );

        await page.keyboard.press('ArrowDown');
        await new Promise((r) => setTimeout(r, 60));
        assert.strictEqual(
          await page.evaluate(() => window.app.currentFocusedEl && window.app.currentFocusedEl.dataset && window.app.currentFocusedEl.dataset.buffer),
          'smart',
          'ArrowDown from Theme must focus Smart buffer'
        );
        await page.keyboard.press('ArrowDown');
        await new Promise((r) => setTimeout(r, 60));
        assert.strictEqual(
          await page.evaluate(() => window.app.currentFocusedEl && window.app.currentFocusedEl.dataset && window.app.currentFocusedEl.dataset.buffer),
          'fast',
          'ArrowDown from Smart buffer must focus Fast buffer (right column)'
        );
        await page.keyboard.press('ArrowLeft');
        await new Promise((r) => setTimeout(r, 60));
        assert.strictEqual(
          await page.evaluate(() => window.app.currentFocusedEl && window.app.currentFocusedEl.dataset && window.app.currentFocusedEl.dataset.buffer),
          'balanced',
          'ArrowLeft from Fast buffer must focus Balanced buffer (left column)'
        );
        await page.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 120));
        pass('webos-dpad-theme-switch', 'Real TV D-pad switches Classic <-> Glass visually & reaches 2-col options');

        // Settings Modal Scroll Suite on 1920x1080 Classic & Glass
        for (const t of ['classic', 'glass']) {
          const scrollRes = await verifySettingsScrollingForTheme(page, t);
          assert(scrollRes.tabs.channels.scrollTopAfterDown > 0, t + ' channels editor list did not scroll on ArrowDown');
          assert(scrollRes.tabs.channels.allVisibleInViewport, t + ' channels editor focused item outside viewport');
          assert.strictEqual(scrollRes.tabs.performance.resetOnSwitch, 0, t + ' perf tab scrollTop did not reset to 0');
          assert.strictEqual(scrollRes.tabs.performance.badItems.length, 0, t + ' perf tab clipped focused item(s): ' + JSON.stringify(scrollRes.tabs.performance.badItems));
          if (scrollRes.tabs.performance.overflows) {
            if (scrollRes.tabs.performance.needsDpadScroll) {
              assert(scrollRes.tabs.performance.maxScrollAfterDown > 0, t + ' perf tab failed to scroll down when overflowing');
            }
            assert(scrollRes.tabs.performance.wheelScrollTop > 0, t + ' perf tab failed to scroll via mouse wheel');
            assert(scrollRes.tabs.performance.afterPageDown > 0, t + ' perf tab failed to scroll via PageDown');
          }
          assert.strictEqual(scrollRes.tabs.performance.scrollAfterUp, 0, t + ' perf tab failed to scroll back to top');
          assert.strictEqual(scrollRes.tabs.performance.seenBottomRefreshBtn, true, t + ' bottom refresh/clear buttons not reachable');
          assert.strictEqual(scrollRes.tabs.performance.channelUnchangedOnPageDown, true, t + ' PageDown inside modal must not zap TV channel');
          assert.strictEqual(scrollRes.tabs.appearance.tabsSingleLine, true, t + ' 5 settings tabs must fit cleanly on one header line');
          assert.strictEqual(scrollRes.tabs.appearance.resetOnSwitch, 0, t + ' appearance tab scrollTop did not reset to 0');
          assert.strictEqual(scrollRes.tabs.appearance.badItems.length, 0, t + ' appearance tab clipped focused item(s): ' + JSON.stringify(scrollRes.tabs.appearance.badItems));
          if (scrollRes.tabs.appearance.overflows) {
            assert(scrollRes.tabs.appearance.maxScrollAfterDown > 0, t + ' appearance tab failed to scroll down');
            assert(scrollRes.tabs.appearance.wheelScrollTop > 0, t + ' appearance tab failed to scroll via mouse wheel');
            assert(scrollRes.tabs.appearance.afterPageDown > 0, t + ' appearance tab failed to scroll via PageDown');
          }
          assert.strictEqual(scrollRes.tabs.appearance.scrollAfterUp, 0, t + ' appearance tab failed to scroll back to top');
          assert.strictEqual(scrollRes.tabs.appearance.seenResetUiBtn, true, t + ' #btn-reset-ui-prefs not reachable via D-pad');
          assert(scrollRes.tabs.sources.allVisibleInViewport, t + ' sources tab focused item outside viewport');
          pass('settings-scroll-1080p-' + t, 'All 5 Settings tabs (incl. Appearance) scroll cleanly via D-pad, PageDown, and Mouse Wheel');
        }

        // Settings Modal Scroll Suite on 1280x720 (CSS zoom = 1280/1920)
        await page.setViewport({ width: 1280, height: 720 });
        await page.evaluate(() => {
          if (typeof window.applyTvViewportScale === 'function') window.applyTvViewportScale();
        });
        await new Promise((r) => setTimeout(r, 150));
        const zoomScroll = await verifySettingsScrollingForTheme(page, 'glass');
        assert.strictEqual(zoomScroll.tabs.performance.badItems.length, 0, '720p zoomed perf tab clipped items: ' + JSON.stringify(zoomScroll.tabs.performance.badItems));
        assert.strictEqual(zoomScroll.tabs.appearance.badItems.length, 0, '720p zoomed appearance tab clipped items: ' + JSON.stringify(zoomScroll.tabs.appearance.badItems));
        assert.strictEqual(zoomScroll.tabs.appearance.seenResetUiBtn, true, '720p zoomed #btn-reset-ui-prefs not reachable');
        assert(zoomScroll.tabs.channels.scrollTopAfterDown > 0, '720p zoomed channel editor must scroll');
        pass('settings-scroll-720p-zoomed', 'Settings scroll math accurate under CSS zoom (1280x720)');

        await page.close();
        await verifyUiCustomizationSuite(browser, opts.webRoot, sampleM3u25, cached25, pass);
      } finally {
        server.close();
      }
    }

    // 3. Android TV Platform Suite (Bridge, Safe Mode, Fullscreen Back, Settings Scroll)
    if (opts.platform === 'all' || opts.platform === 'androidtv') {
      const { server, port } = await createStaticServer({ webRoot: opts.webRoot, sampleM3u: sampleM3u25 });
      try {
        for (const isSafe of [false, true]) {
          const { page, pageErrors, consoleErrors } = await openConfiguredPage(browser, port, {
            width: 1920,
            height: 1080,
            query: isSafe ? '?safeMode=1' : '',
            setupFn: (sampleUrl, cached, safeFlag) => {
              window.__IPTV_ANDROID_TV = true;
              window.__testReadyCalls = 0;
              window.AndroidTvHost = {
                isSafeMode: function () { return safeFlag; },
                notifyAppReady: function () { window.__testReadyCalls++; },
                setInputFocused: function () {}
              };
              localStorage.setItem('zenplay_iptv_sources_v2', JSON.stringify([{ id: 'src_1', name: 'Test', url: sampleUrl, enabled: true }]));
              localStorage.setItem('zenplay_iptv_cached_lineup_v2', JSON.stringify({ v: 2, updatedAt: Date.now(), discoveredEpgUrls: [], rawChannels: cached }));
              if (safeFlag) {
                localStorage.setItem('zenplay_ui_prefs_v1', JSON.stringify({ startupMode: 'fullscreen' }));
              }
            },
            setupArgs: ['http://127.0.0.1:' + port + '/sample.m3u', cached25, isSafe]
          });

          const atv = await page.evaluate(() => ({
            isAtv: window.__IPTV_IS_ANDROID_TV === true,
            readyCalls: window.__testReadyCalls,
            domRows: document.querySelectorAll('#channel-list .channel-item').length,
            splashHidden: document.getElementById('boot-splash').classList.contains('hidden'),
            mode: window.app.mode
          }));
          assert.strictEqual(atv.isAtv, true, 'Android TV flag not detected');
          assert(atv.readyCalls >= 1, 'AndroidTvHost.notifyAppReady() must be invoked');
          assert.strictEqual(atv.domRows, 25, 'Android TV must render all 25 channels');
          assert.strictEqual(atv.splashHidden, true, 'Android TV boot splash must dismiss');
          if (isSafe) {
            assert.strictEqual(atv.mode, 'BROWSE', 'Safe mode must stay in BROWSE even when startupMode=fullscreen');
          }

          if (!isSafe) {
            await page.evaluate(() => {
              window.AndroidTVBridge.dispatchKey('down');
              window.AndroidTVBridge.dispatchKey('ok');
              window.AndroidTVBridge.dispatchKey('ok');
            });
            await new Promise((r) => setTimeout(r, 120));
            await page.evaluate(() => window.AndroidTVBridge.dispatchKey('back'));
            await new Promise((r) => setTimeout(r, 150));
            const atvMode = await page.evaluate(() => window.app.mode);
            assert.strictEqual(atvMode, 'BROWSE', 'AndroidTVBridge back must return from Fullscreen to BROWSE');

            const atvScroll = await verifySettingsScrollingForTheme(page, 'glass');
            assert.strictEqual(atvScroll.tabs.performance.badItems.length, 0, 'Android TV Settings perf tab clipped focused control');
            assert.strictEqual(atvScroll.tabs.appearance.badItems.length, 0, 'Android TV Settings appearance tab clipped focused control');
            assert.strictEqual(atvScroll.tabs.appearance.seenResetUiBtn, true, 'Android TV #btn-reset-ui-prefs not reachable');

            // Verify AndroidTVBridge D-pad keys reach & switch Classic <-> Glass
            const atvThemeSwitch = await page.evaluate(() => {
              window.app.applyTheme('classic', true);
              window.app.openSettingsModal();
              window.AndroidTVBridge.dispatchKey('left');
              window.AndroidTVBridge.dispatchKey('ok');
              window.AndroidTVBridge.dispatchKey('down');
              window.AndroidTVBridge.dispatchKey('left');
              const focused = window.app.currentFocusedEl ? window.app.currentFocusedEl.id : '';
              window.AndroidTVBridge.dispatchKey('ok');
              const themeAfterGlass = window.app.getTheme();
              window.app.closeModals();
              return { focused, themeAfterGlass };
            });
            assert.strictEqual(atvThemeSwitch.focused, 'btn-theme-glass', 'AndroidTVBridge must focus btn-theme-glass');
            assert.strictEqual(atvThemeSwitch.themeAfterGlass, 'glass', 'AndroidTVBridge OK must switch theme to glass');
          }

          assert.strictEqual(pageErrors.length, 0, 'Android TV pageerrors: ' + pageErrors.join('; '));
          assert.strictEqual(consoleErrors.length, 0, 'Android TV console errors: ' + consoleErrors.join('; '));
          await page.close();
          pass(isSafe ? 'androidtv-safemode' : 'androidtv-normal-bridge-scroll', 'Android TV verified with 25 channels, bridge, Back & Settings scroll');
        }
      } finally {
        server.close();
      }
    }

    // 4. Synthetic Legacy-Instance OTA Regression Test (works both in Docker & locally without .git!)
    {
      const { server, port } = await createStaticServer({ webRoot: opts.webRoot, sampleM3u: sampleM3u25 });
      try {
        const { page, pageErrors, consoleErrors } = await openConfiguredPage(browser, port, {
          width: 1920,
          height: 1080,
          setupFn: (sampleUrl, cached) => {
            window.webOSSystem = {};
            const now = Date.now();
            localStorage.setItem('zenplay_iptv_sources_v2', JSON.stringify([{ id: 'src_1', name: 'Test', url: sampleUrl, enabled: true }]));
            localStorage.setItem('zenplay_iptv_cached_lineup_v2', JSON.stringify({ v: 2, updatedAt: now, discoveredEpgUrls: [], rawChannels: cached }));
            localStorage.setItem('zenplay_iptv_epg_cache_v491', JSON.stringify({
              url: 'https://gist.githubusercontent.com/maorisraelii/b4408ca1c31143ed2f50164629f53f1c/raw/epg-il.xml',
              updatedAt: now,
              entries: [['kan11', [{ s: now - 600000, e: now + 1800000, t: 'חדשות', d: 'שידור חי' }]]],
              aliases: [['kan 11', 'kan11']]
            }));
          },
          setupArgs: ['http://127.0.0.1:' + port + '/sample.m3u', cached25.slice(0, 5)]
        });

        // Strip all v5.2 constructor fields from live window.app to simulate a v4.x/v5.0.x/v5.1.x instance,
        // then apply the generated ota-manifest.json jsPatch + exercise EPG, preview, OSD & D-pad!
        const synthRes = await page.evaluate((jsPatch) => {
          const app = window.app;
          delete app._channelRowEls;
          delete app._channelIndexById;
          delete app._previewHeaderCache;
          delete app._osdLastCache;
          delete app._cachedRowHeight;
          delete app._cachedRowBoxHeight;
          delete app._cachedListHeight;
          delete app._cachedListPaddingTop;
          delete app._cachedListScrollTop;
          delete app._epgRefreshEpoch;
          delete app._lastMiniTimelineSig;
          delete app._lastVideoSurfaceKey;
          delete app._clockEls;
          delete app.__zenplayOtaUpgradedVersion;

          const fn = new Function(jsPatch);
          fn();

          app.loadActiveEPGSources(false);
          app.refreshVisibleEPGLabels();
          if (app.visibleChannels[1]) {
            app.previewChannelInfo(app.visibleChannels[1], false);
            app.updateOSD(app.visibleChannels[1], false);
          }
          app.navigate('down');
          app.openSettingsModal();
          app.switchSettingsTab('appearance');
          const injectedTab = Boolean(document.getElementById('tab-btn-appearance'));
          const injectedPanel = Boolean(document.getElementById('settings-tab-appearance'));
          const injectedBadge = Boolean(document.getElementById('preview-autoplay-off-badge'));
          document.getElementById('btn-preset-minimal').click();
          const minimalOk = document.documentElement.classList.contains('ui-density-compact');
          document.getElementById('btn-reset-ui-prefs').click();
          app.closeModals();

          return {
            domRows: document.querySelectorAll('#channel-list .channel-item').length,
            hasRowEls: Array.isArray(app._channelRowEls),
            hasPreviewCache: Boolean(app._previewHeaderCache),
            hasOsdCache: Boolean(app._osdLastCache),
            injectedTab,
            injectedPanel,
            injectedBadge,
            minimalOk
          };
        }, otaManifest.jsPatch);

        assert.strictEqual(synthRes.domRows, 5, 'Synthetic legacy OTA upgrade must keep all 5 channels');
        assert.strictEqual(synthRes.hasRowEls, true, '_channelRowEls must be backfilled');
        assert.strictEqual(synthRes.hasPreviewCache, true, '_previewHeaderCache must be backfilled');
        assert.strictEqual(synthRes.hasOsdCache, true, '_osdLastCache must be backfilled');
        assert(synthRes.injectedTab && synthRes.injectedPanel && synthRes.injectedBadge && synthRes.minimalOk, 'Synthetic OTA must inject Appearance controls & badge');
        assert.strictEqual(pageErrors.length, 0, 'Synthetic OTA pageerrors: ' + pageErrors.join('; '));
        assert.strictEqual(consoleErrors.length, 0, 'Synthetic OTA console errors: ' + consoleErrors.join('; '));
        await page.close();
        pass('synthetic-legacy-ota-upgrade', 'Legacy instance missing v5.2/v5.3 caches & DOM upgraded cleanly with 0 errors');
      } finally {
        server.close();
      }
    }

    // 5. Real Git-Tag Upgrade Matrix (runs locally when .git has v5.0.7 & v5.1.4)
    for (const tag of ['v5.0.7', 'v5.1.4']) {
      if (!hasGitTag(opts.repoRoot, tag)) continue;
      const { server, port } = await createStaticServer({ webRoot: opts.webRoot, gitTag: tag, sampleM3u: sampleM3u25 });
      try {
        // 5a: Cold boot with OTA already stored + valid cached EPG & channels
        {
          const isBetaTag = tag === 'v5.1.4';
          const { page, pageErrors, consoleErrors } = await openConfiguredPage(browser, port, {
            width: 1920,
            height: 1080,
            waitMs: 1200,
            setupFn: (m, sampleUrl, cached, useBeta) => {
              window.webOSSystem = {};
              const now = Date.now();
              localStorage.setItem('zenplay_iptv_sources_v2', JSON.stringify([{ id: 'src_1', name: 'Test', url: sampleUrl, enabled: true }]));
              localStorage.setItem('zenplay_iptv_cached_lineup_v2', JSON.stringify({ v: 2, updatedAt: now, discoveredEpgUrls: [], rawChannels: cached }));
              localStorage.setItem('zenplay_iptv_epg_cache_v491', JSON.stringify({
                url: 'https://gist.githubusercontent.com/maorisraelii/b4408ca1c31143ed2f50164629f53f1c/raw/epg-il.xml',
                updatedAt: now,
                entries: [['kan11', [{ s: now - 600000, e: now + 1800000, t: 'חדשות', d: 'שידור חי' }]]],
                aliases: [['kan 11', 'kan11']]
              }));
              localStorage.setItem('zenplay_ota_installed_version', m.version);
              localStorage.setItem('zenplay_ota_installed_channel', useBeta ? 'beta' : 'stable');
              if (useBeta) localStorage.setItem('zenplay_ota_update_channel', 'beta');
              localStorage.setItem('zenplay_ota_installed_bundle', JSON.stringify({
                version: m.version,
                channel: useBeta ? 'beta' : 'stable',
                baseBundleVersion: useBeta ? '5.1.4' : '5.0.7',
                appliedOnBaseVersion: useBeta ? '5.1.4' : '5.0.7',
                updatedAt: now,
                cssPatch: m.cssPatch,
                jsPatch: m.jsPatch
              }));
            },
            setupArgs: [otaManifest, 'http://127.0.0.1:' + port + '/sample.m3u', cached25.slice(0, 3), isBetaTag]
          });

          await page.keyboard.press('ArrowDown');
          const res = await page.evaluate(() => ({
            allChannels: window.app.allChannels.length,
            visibleChannels: window.app.visibleChannels.length,
            domRows: document.querySelectorAll('#channel-list .channel-item').length,
            countPill: document.getElementById('channel-list-count').textContent,
            runningVer: window.app.otaManager.getRunningVersion()
          }));
          assert.strictEqual(res.domRows, 3, tag + ' cold OTA boot lost channels! got ' + JSON.stringify(res));
          assert.strictEqual(res.visibleChannels, 3, tag + ' visibleChannels mismatch');
          assert.strictEqual(res.runningVer, otaManifest.version, tag + ' runningVer mismatch');

          // Offline D-pad switch Classic <-> Glass on legacy base HTML (without cssGlassPatch in localStorage!)
          const otaThemeRes = await page.evaluate(() => {
            window.app.applyTheme('classic', true);
            window.app.openSettingsModal();
            window.app.navigate('left');
            window.app.selectCurrent();
            window.app.navigate('down');
            window.app.navigate('left');
            const focusedGlass = window.app.currentFocusedEl ? window.app.currentFocusedEl.id : '';
            window.app.selectCurrent();
            const glassRadius = getComputedStyle(document.querySelector('.modal-settings-card')).borderRadius;
            const glassTheme = window.app.getTheme();
            window.app.navigate('right');
            window.app.selectCurrent();
            const classicRadius = getComputedStyle(document.querySelector('.modal-settings-card')).borderRadius;
            const classicTheme = window.app.getTheme();
            window.app.closeModals();
            return { focusedGlass, glassTheme, glassRadius, classicTheme, classicRadius };
          });
          assert.strictEqual(otaThemeRes.focusedGlass, 'btn-theme-glass', tag + ' OTA D-pad failed to reach btn-theme-glass');
          assert.strictEqual(otaThemeRes.glassTheme, 'glass', tag + ' OTA theme did not change to glass');
          assert.strictEqual(otaThemeRes.glassRadius, '28px', tag + ' OTA Glass CSS did not apply instantly without cssGlassPatch');
          assert.strictEqual(otaThemeRes.classicTheme, 'classic', tag + ' OTA theme did not change back to classic');
          assert.strictEqual(otaThemeRes.classicRadius, '24px', tag + ' OTA Classic CSS did not apply back');

          // Dynamically injected Appearance tab, preset, toggle, and reset on legacy v5.0.7 / v5.1.4 hosts
          const otaUiRes = await page.evaluate(() => {
            const tabBtn = document.getElementById('tab-btn-appearance');
            const tabPanel = document.getElementById('settings-tab-appearance');
            const offBadge = document.getElementById('preview-autoplay-off-badge');
            window.app.openSettingsModal();
            window.app.switchSettingsTab('appearance');
            document.getElementById('btn-preset-minimal').click();
            const isMinimal = document.documentElement.classList.contains('ui-density-compact') &&
              document.documentElement.classList.contains('ui-monogram-logos') &&
              document.querySelectorAll('#channel-list .channel-item img').length === 0;
            document.getElementById('btn-accent-emerald').click();
            const isEmerald = document.documentElement.classList.contains('ui-accent-emerald');
            document.getElementById('btn-reset-ui-prefs').click();
            const isResetClean = window.app.getUiPrefs().preset === 'clean';
            window.app.closeModals();
            return {
              hasTabBtn: Boolean(tabBtn),
              hasTabPanel: Boolean(tabPanel),
              hasOffBadge: Boolean(offBadge),
              isMinimal,
              isEmerald,
              isResetClean
            };
          });
          assert(otaUiRes.hasTabBtn && otaUiRes.hasTabPanel && otaUiRes.hasOffBadge, tag + ' OTA missing injected UI customization DOM: ' + JSON.stringify(otaUiRes));
          assert(otaUiRes.isMinimal && otaUiRes.isEmerald && otaUiRes.isResetClean, tag + ' OTA Appearance controls failed: ' + JSON.stringify(otaUiRes));

          assert.strictEqual(pageErrors.length, 0, tag + ' OTA cold boot pageerrors: ' + pageErrors.join('; '));
          assert.strictEqual(consoleErrors.length, 0, tag + ' OTA cold boot console errors: ' + consoleErrors.join('; '));
          await page.close();
          pass('git-ota-cold-boot-' + tag, tag + ' + cached EPG + v' + otaManifest.version + ' OTA kept channels, injected Appearance UI & switched Glass/Classic');
        }

        // 5b: Live performOTAUpdate() from old tag -> v5.3.0
        {
          const { page, pageErrors, consoleErrors } = await openConfiguredPage(browser, port, {
            width: 1920,
            height: 1080,
            waitMs: 900,
            setupFn: (sampleUrl, cached) => {
              window.webOSSystem = {};
              const now = Date.now();
              localStorage.setItem('zenplay_iptv_sources_v2', JSON.stringify([{ id: 'src_1', name: 'Test', url: sampleUrl, enabled: true }]));
              localStorage.setItem('zenplay_iptv_cached_lineup_v2', JSON.stringify({ v: 2, updatedAt: now, discoveredEpgUrls: [], rawChannels: cached }));
            },
            setupArgs: ['http://127.0.0.1:' + port + '/sample.m3u', cached25.slice(0, 4)]
          });
          await page.evaluate((m) => window.app.otaManager.performOTAUpdate(m), otaManifest);
          await new Promise((r) => setTimeout(r, 1200));
          const liveRes = await page.evaluate(() => {
            const hasAppTab = Boolean(document.getElementById('tab-btn-appearance'));
            const hasAppPanel = Boolean(document.getElementById('settings-tab-appearance'));
            window.app.openSettingsModal();
            window.app.switchSettingsTab('appearance');
            document.getElementById('btn-pref-showColorBar').click();
            const colorBarHidden = document.documentElement.classList.contains('ui-hide-color-bar');
            document.getElementById('btn-reset-ui-prefs').click();
            window.app.closeModals();
            return {
              domRows: document.querySelectorAll('#channel-list .channel-item').length,
              runningVer: window.app.otaManager.getRunningVersion(),
              hasAppTab,
              hasAppPanel,
              colorBarHidden
            };
          });
          assert.strictEqual(liveRes.domRows, 4, tag + ' live OTA install lost channels');
          assert.strictEqual(liveRes.runningVer, otaManifest.version, tag + ' live OTA did not activate version');
          assert(liveRes.hasAppTab && liveRes.hasAppPanel && liveRes.colorBarHidden, tag + ' live OTA did not inject functional Appearance tab');
          assert.strictEqual(pageErrors.length, 0, tag + ' live OTA pageerrors: ' + pageErrors.join('; '));
          assert.strictEqual(consoleErrors.length, 0, tag + ' live OTA console errors: ' + consoleErrors.join('; '));
          await page.close();
          pass('git-ota-live-install-' + tag, tag + ' live OTA upgrade preserved 4 channels & injected Appearance tab with 0 errors');
        }
      } finally {
        server.close();
      }
    }

    // 6. Network Error Resilience (cached channels preserved if M3U source fails)
    {
      const { server, port } = await createStaticServer({ webRoot: opts.webRoot, sampleMode: 'error' });
      try {
        const { page, pageErrors } = await openConfiguredPage(browser, port, {
          width: 1920,
          height: 1080,
          waitMs: 900,
          allowResourceErrors: true,
          setupFn: (sampleUrl, cached) => {
            window.webOSSystem = {};
            localStorage.setItem('zenplay_iptv_sources_v2', JSON.stringify([{ id: 'src_1', name: 'Test', url: sampleUrl, enabled: true }]));
            localStorage.setItem('zenplay_iptv_cached_lineup_v2', JSON.stringify({ v: 2, updatedAt: Date.now(), discoveredEpgUrls: [], rawChannels: cached }));
          },
          setupArgs: ['http://127.0.0.1:' + port + '/sample.m3u', cached25.slice(0, 6)]
        });
        await page.evaluate(() => window.app.refreshAllSources(false));
        await new Promise((r) => setTimeout(r, 500));
        const res = await page.evaluate(() => ({
          domRows: document.querySelectorAll('#channel-list .channel-item').length,
          allChannels: window.app.allChannels.length
        }));
        assert.strictEqual(res.domRows, 6, 'Failed M3U refresh must preserve existing 6 channels');
        assert.strictEqual(res.allChannels, 6, 'Failed M3U refresh must not clear allChannels');
        assert.strictEqual(pageErrors.length, 0, 'Network failure test pageerrors: ' + pageErrors.join('; '));
        await page.close();
        pass('network-failure-resilience', 'HTTP 500 source error preserves existing 6 channels');
      } finally {
        server.close();
      }
    }

    console.log('\nALL ' + steps.length + ' TEST SUITES PASSED! (platform=' + opts.platform + ', version=' + otaManifest.version + ')');
  } finally {
    await browser.close();
  }
}

runTests().catch((err) => {
  console.error('\n[FAIL]', err && err.stack ? err.stack : err);
  process.exit(1);
});
