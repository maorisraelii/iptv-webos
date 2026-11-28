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
  const extraRoutes = options.extraRoutes || null;

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      if (extraRoutes && Object.prototype.hasOwnProperty.call(extraRoutes, urlPath)) {
        const route = extraRoutes[urlPath];
        res.writeHead(route.status || 200, {
          'Content-Type': route.contentType || 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        });
        return res.end(route.body);
      }
      if (urlPath === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
      }
      if (urlPath === '/sample.m3u') {
        if (sampleMode === 'error') {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          return res.end('Upstream error');
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
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
      res.writeHead(200, {
        'Content-Type': mimeMap[ext] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*'
      });
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
    'js/diagnostics.js',
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

  // Verify inline <script> tags in index.html parse cleanly and pass Chromium 53 rules
  const inlineScriptRe = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
  let inlineMatch;
  let inlineIdx = 0;
  while ((inlineMatch = inlineScriptRe.exec(indexHtml)) !== null) {
    inlineIdx++;
    new Function(inlineMatch[1]);
    for (let r = 0; r < compatRules.length; r++) {
      assert(!compatRules[r].rx.test(inlineMatch[1]), 'index.html inline script #' + inlineIdx + ' contains Chromium 53 incompatible syntax: ' + compatRules[r].name);
    }
  }
  assert(inlineIdx >= 1, 'index.html must contain inline boot script');

  // Verify clean-boot hidden guard on v5.6.0 modals/overlays (only #disclaimer-modal may show on fresh boot)
  for (const hiddenId of ['sleep-warning-modal', 'power-save-screen', 'voice-overlay']) {
    const tagMatch = indexHtml.match(new RegExp('<[^>]*id="' + hiddenId + '"[^>]*>'));
    assert(tagMatch && /\bhidden\b/.test(tagMatch[0]), 'index.html #' + hiddenId + ' must start with .hidden on clean boot');
  }

  for (const cssRel of ['css/style.css', 'css/theme-glass.css']) {
    const cssText = fs.readFileSync(path.join(webRoot, cssRel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert(!/:\s*[^;{}]*\b(clamp|min|max)\s*\(/i.test(cssText), cssRel + ' must not use CSS min()/max()/clamp() (webOS 4.x)');
    assert(!/(?:^|[;{\s])(?:row-|column-)?gap\s*:/im.test(cssText), cssRel + ' must not use CSS flex gap (Chromium 53)');
    assert(!/display\s*:\s*(?:inline-)?grid/i.test(cssText), cssRel + ' must not use display: grid (Chromium 53)');
    const webkitClamps = (cssText.match(/-webkit-line-clamp\s*:/g) || []).length;
    const stdClamps = (cssText.match(/(^|[^-])line-clamp\s*:/gm) || []).length;
    assert.strictEqual(webkitClamps, stdClamps, cssRel + ' must pair every -webkit-line-clamp with standard line-clamp');
  }

  return otaManifest;
}

function attachNetworkInterception(page, serverPort, options) {
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
  return page.setRequestInterception(true).then(() => {
    page.on('request', (req) => {
      const url = req.url();
      if (url.indexOf('http://127.0.0.1:' + serverPort) === 0 || url.indexOf('/mock-issue-worker') !== -1) {
        return req.continue();
      }
      if (options && typeof options.interceptFn === 'function') {
        if (options.interceptFn(req, corsHeaders)) return;
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
  try { await page.bringToFront(); } catch (e) {}
  const width = (options && options.width) || 1920;
  const height = (options && options.height) || 1080;
  await page.setViewport({ width, height });
  await attachNetworkInterception(page, serverPort, options);

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

  if (!(options && options.skipDisclaimerAccept)) {
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('zenplay_disclaimer_accepted_v1', '1');
      } catch (e) {}
    });
  }

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
    // Verify toggling visibility / number on a scrolled row preserves exact focus & scrollTop
    let focusPreservedAfterEdit = false;
    const focusedBtn = window.app.currentFocusedEl;
    if (focusedBtn && focusedBtn.dataset && focusedBtn.dataset.uid && editorList.scrollTop > 0) {
      const targetUid = focusedBtn.dataset.uid;
      const scrollBeforeToggle = editorList.scrollTop;
      const rows = Array.from(editorList.querySelectorAll('.editor-channel-row'));
      const curRowIdx = rows.findIndex((r) => r.contains(focusedBtn));
      const toggleBtn = curRowIdx >= 0 ? rows[curRowIdx].querySelector('[data-act="toggle"]') : null;
      if (toggleBtn) {
        window.app.setFocusedElementFast(toggleBtn);
        toggleBtn.click();
        const cur1 = window.app.currentFocusedEl;
        const scrollAfterToggle = editorList.scrollTop;
        const keptOnToggle = Boolean(cur1 && cur1.dataset && cur1.dataset.uid === targetUid && cur1.dataset.act === 'toggle');
        const keptScroll = scrollAfterToggle >= Math.max(1, scrollBeforeToggle - 10);

        const toggledBack = editorList.querySelector('.editor-channel-row [data-act="toggle"].toggle-off');
        if (keptOnToggle && cur1 === editorList.querySelectorAll('.editor-channel-row')[curRowIdx].querySelector('[data-act="toggle"]')) {
          cur1.click();
        } else if (toggledBack) {
          toggledBack.click();
        }
        window.app.navigate('down');
        const afterDownEl = window.app.currentFocusedEl;
        const stayedNearRow = Boolean(afterDownEl && editorList.contains(afterDownEl) && editorList.scrollTop > 0);
        focusPreservedAfterEdit = Boolean(keptOnToggle && keptScroll && stayedNearRow);
      }
    }

    out.tabs.channels = {
      clientH: editorList.clientHeight,
      scrollH: editorList.scrollHeight,
      scrollTopAfterDown: editorList.scrollTop,
      allVisibleInViewport: editorSteps.length > 0 && editorSteps.every((s) => s.topOk && s.bottomOk),
      focusPreservedAfterEdit: focusPreservedAfterEdit
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

    // 4. Appearance tab (4th panel): 6-tab 1-line bar + scroll all the way to #btn-reset-ui-prefs & back up
    window.app.switchSettingsTab('appearance');
    const appEl = document.getElementById('settings-tab-appearance');
    const appResetOnSwitch = appEl.scrollTop;
    window.app.setupModalFocus('#settings-modal');

    const tabBtns = Array.from(document.querySelectorAll('#settings-modal .settings-tab-btn'));
    const closeBtn = document.querySelector('#settings-modal .modal-close-btn');
    const hdrEl = document.querySelector('#settings-modal .modal-header');
    const hdrRect = hdrEl ? hdrEl.getBoundingClientRect() : null;
    const tabTop0 = tabBtns[0] ? tabBtns[0].getBoundingClientRect().top : 0;
    const headerRowEls = tabBtns.concat(closeBtn ? [closeBtn] : []);
    const tabsSingleLine = tabBtns.length === 6 && headerRowEls.every((b) => {
      const r = b.getBoundingClientRect();
      const horizOk = !hdrRect || (r.left >= hdrRect.left - 2 && r.right <= hdrRect.right + 2);
      return r.width > 0 && Math.abs(r.top - tabTop0) <= 6 && horizOk && b.scrollWidth <= b.clientWidth + 2;
    });

    const appVis = [];
    let seenResetUiBtn = false;
    for (let i = 0; i < 120; i++) {
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

    for (let i = 0; i < 120; i++) {
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

    // 5. Sound & Picture tab (5th panel): scroll all the way to #btn-reset-av-prefs & back up
    window.app.switchSettingsTab('av');
    const avEl = document.getElementById('settings-tab-av');
    const avResetOnSwitch = avEl.scrollTop;
    window.app.setupModalFocus('#settings-modal');

    const avVis = [];
    let seenResetAvBtn = false;
    for (let i = 0; i < 65; i++) {
      window.app.navigate('down');
      const cur = window.app.currentFocusedEl;
      if (cur && avEl.contains(cur)) {
        const cr = avEl.getBoundingClientRect();
        const tr = cur.getBoundingClientRect();
        avVis.push({
          id: cur.id || 'av-btn',
          topOk: tr.top >= cr.top - 6,
          bottomOk: tr.bottom <= cr.bottom + 6
        });
        if (cur.id === 'btn-reset-av-prefs') {
          seenResetAvBtn = true;
          break;
        }
      }
    }
    const avMaxScrollAfterDown = avEl.scrollTop;

    for (let i = 0; i < 65; i++) {
      window.app.navigate('up');
      const cur = window.app.currentFocusedEl;
      if (cur && (cur.classList.contains('settings-tab-btn') || cur.classList.contains('modal-close-btn'))) {
        break;
      }
    }
    const avScrollAfterUp = avEl.scrollTop;

    avEl.scrollTop = 0;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', keyCode: 34, bubbles: true }));
    const avAfterPageDown = avEl.scrollTop;

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

    out.tabs.av = {
      resetOnSwitch: avResetOnSwitch,
      clientH: avEl.clientHeight,
      scrollH: avEl.scrollHeight,
      overflows: avEl.scrollHeight > avEl.clientHeight,
      maxScrollAfterDown: avMaxScrollAfterDown,
      scrollAfterUp: avScrollAfterUp,
      seenResetAvBtn,
      afterPageDown: avAfterPageDown,
      badItems: avVis.filter((v) => !v.topOk || !v.bottomOk)
    };

    return out;
  }, theme);

  // Also test real mouse wheel scrolling in #settings-tab-performance, #settings-tab-appearance & #settings-tab-av
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

  await page.evaluate(() => {
    window.app.switchSettingsTab('av');
    const el = document.getElementById('settings-tab-av');
    el.scrollTop = 0;
  });
  const avBox = await page.$eval('#settings-tab-av', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(avBox.x, avBox.y);
  await page.mouse.wheel({ deltaY: 350 });
  await new Promise((r) => setTimeout(r, 120));
  const avWheelScrollTop = await page.$eval('#settings-tab-av', (el) => el.scrollTop);
  await page.evaluate(() => window.app.closeModals());

  result.tabs.performance.wheelScrollTop = wheelScrollTop;
  result.tabs.appearance.wheelScrollTop = appWheelScrollTop;
  result.tabs.av.wheelScrollTop = avWheelScrollTop;
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
    await new Promise((r) => setTimeout(r, 240));
    const autoplayOffStep1 = await page.evaluate(() => ({
      mode: window.app.mode,
      osdHidden: document.getElementById('fullscreen-osd').classList.contains('hidden')
    }));
    assert.strictEqual(autoplayOffStep1.mode, 'FULLSCREEN', 'First Escape in Fullscreen must keep FULLSCREEN while hiding OSD');
    assert.strictEqual(autoplayOffStep1.osdHidden, true, 'First Escape in Fullscreen must hide OSD');

    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 240));
    const autoplayOffBack = await page.evaluate(() => ({
      mode: window.app.mode,
      hasHls: Boolean(window.app.player && window.app.player.hls),
      isNative: Boolean(window.app.player && window.app.player._isNativePlayback),
      badgeVisible: !document.getElementById('preview-autoplay-off-badge').classList.contains('hidden')
    }));
    assert.strictEqual(autoplayOffBack.mode, 'BROWSE');
    assert(!autoplayOffBack.hasHls && !autoplayOffBack.isNative, 'Back to BROWSE with previewAutoplay=off must stop playback');
    assert.strictEqual(autoplayOffBack.badgeVisible, true, 'Autoplay-off badge must reappear on Back to BROWSE');

    // 5b. Deep UI Customization v5.4.0: layoutSide, listWidth, bgTone, cornerRadius, focusStyle, osdOpacity, 5 visibility toggles, wrapNavigation, seekStepSec, singleClickFullscreen
    const deepUiRes = await page.evaluate(() => {
      window.app.resetUiPrefs(true);
      document.getElementById('btn-autoplay-delayed').click();
      document.getElementById('btn-layout-left').click();
      document.getElementById('btn-listwidth-wide').click();
      document.getElementById('btn-bgtone-oled').click();
      document.getElementById('btn-radius-pill').click();
      document.getElementById('btn-focusstyle-border').click();
      document.getElementById('btn-osdop-solid').click();
      window.app.closeModals();

      const cls = document.documentElement.classList;
      const hasLayoutLeft = cls.contains('ui-layout-left');
      const leftPanelRect = document.querySelector('.channel-list-panel').getBoundingClientRect();
      const rightStageRect = document.querySelector('.preview-stage').getBoundingClientRect();
      const surfRect = document.getElementById('video-surface').getBoundingClientRect();
      const frameRect = document.getElementById('preview-frame').getBoundingClientRect();
      const oledBg = getComputedStyle(document.body).backgroundColor;
      const wideStageW = Math.round(rightStageRect.width);

      document.getElementById('btn-listwidth-narrow').click();
      const narrowStageW = Math.round(document.querySelector('.preview-stage').getBoundingClientRect().width);
      document.getElementById('btn-listwidth-balanced').click();

      document.getElementById('btn-radius-sharp').click();
      const hasSharp = cls.contains('ui-radius-sharp');
      document.getElementById('btn-focusstyle-solid').click();
      const hasFocusSolid = cls.contains('ui-focus-solid');

      // OSD Opacity check
      window.app.enterFullscreen();
      const osdSolidAlpha = getComputedStyle(document.querySelector('.osd-card')).backgroundColor;
      document.getElementById('btn-osdop-light').click();
      const osdLightAlpha = getComputedStyle(document.querySelector('.osd-card')).backgroundColor;
      window.app.exitFullscreen();

      // 5 new visibility toggles (showClock, showSynopsis, showPrevNext, showChannelNumbers, showToasts)
      const vis5 = ['showClock', 'showSynopsis', 'showPrevNext', 'showChannelNumbers', 'showToasts'];
      const visState = {};
      for (let i = 0; i < vis5.length; i++) {
        const k = vis5[i];
        document.getElementById('btn-pref-' + k).click();
        visState[k] = {
          afterOff: window.app.getUiPrefs()[k],
          clockDisplayOff: k === 'showClock' ? getComputedStyle(document.getElementById('clock')).display : null,
          synDisplayOff: k === 'showSynopsis' ? getComputedStyle(document.getElementById('preview-epg-desc')).display : null,
          prevNextDisplayOff: k === 'showPrevNext' ? getComputedStyle(document.querySelector('.epg-prev-next-bar')).display : null,
          chNumDisplayOff: k === 'showChannelNumbers' ? getComputedStyle(document.querySelector('.channel-number')).display : null
        };
      }
      // showToasts === false must suppress non-critical toast while still permitting critical toast
      const toastEl = document.getElementById('toast');
      toastEl.classList.add('hidden');
      window.app.showToast('non-critical-suppressed');
      const nonCriticalSuppressed = toastEl.classList.contains('hidden');
      window.app.showToast('critical-shown', true);
      const criticalAllowed = !toastEl.classList.contains('hidden');
      toastEl.classList.add('hidden');
      for (let i = 0; i < vis5.length; i++) {
        document.getElementById('btn-pref-' + vis5[i]).click();
      }

      // wrapNavigation false -> stops at 0 / last; true -> wraps cleanly
      window.app.setUiPref('wrapNavigation', false, true);
      window.app.focusedChannelIndex = 0;
      window.app.navigate('up');
      const stayedAtHeaderOrZero = window.app.focusArea === 'header' || window.app.focusedChannelIndex === 0;
      window.app.focusChannelList();
      window.app.focusedChannelIndex = window.app.visibleChannels.length - 1;
      window.app.navigate('down');
      const stoppedAtLast = window.app.focusedChannelIndex === window.app.visibleChannels.length - 1;

      window.app.setUiPref('wrapNavigation', true, true);
      window.app.focusedChannelIndex = 0;
      window.app.navigate('up');
      const wrappedUpToLast = window.app.focusedChannelIndex === window.app.visibleChannels.length - 1;
      window.app.navigate('down');
      const wrappedDownToZero = window.app.focusedChannelIndex === 0;

      // seekStepSec = 60 updates hint labels & getter
      document.getElementById('btn-seekstep-60').click();
      const seekStepAfter = window.app.getSeekStepSec();
      const greenLabelAfter = document.getElementById('hint-green-label').textContent;

      // singleClickFullscreen = true enters FULLSCREEN on first OK for an unselected channel
      document.getElementById('btn-pref-singleClickFullscreen').click();
      window.app.focusedChannelIndex = 2;
      window.app.selectCurrent();
      const singleClickFsMode = window.app.mode;
      window.app.exitFullscreen();

      window.app.resetUiPrefs(true);
      document.getElementById('btn-autoplay-off').click();
      document.getElementById('btn-osd-sec-8').click();

      return {
        hasLayoutLeft,
        leftBeforeStage: leftPanelRect.right <= rightStageRect.left + 4,
        surfMatchesFrameLeft: Math.abs(surfRect.left - frameRect.left) <= 3 && Math.abs(surfRect.width - frameRect.width) <= 3,
        oledBg,
        wideStageW,
        narrowStageW,
        hasSharp,
        hasFocusSolid,
        osdSolidAlpha,
        osdLightAlpha,
        visState,
        nonCriticalSuppressed,
        criticalAllowed,
        stayedAtHeaderOrZero,
        stoppedAtLast,
        wrappedUpToLast,
        wrappedDownToZero,
        seekStepAfter,
        greenLabelAfter,
        singleClickFsMode
      };
    });

    assert(deepUiRes.hasLayoutLeft && deepUiRes.leftBeforeStage && deepUiRes.surfMatchesFrameLeft, 'layoutSide=left geometry broken: ' + JSON.stringify(deepUiRes));
    assert.strictEqual(deepUiRes.oledBg, 'rgb(0, 0, 0)', 'bgTone=oled must produce pure black rgb(0, 0, 0)');
    assert(deepUiRes.wideStageW === 840 && deepUiRes.narrowStageW === 1020, 'listWidth stage widths incorrect: ' + JSON.stringify(deepUiRes));
    assert(deepUiRes.hasSharp && deepUiRes.hasFocusSolid, 'cornerRadius=sharp or focusStyle=solid class missing');
    assert(deepUiRes.osdSolidAlpha.indexOf('0.98') !== -1 && deepUiRes.osdLightAlpha.indexOf('0.72') !== -1, 'osdOpacity alpha mismatch: ' + deepUiRes.osdSolidAlpha + ' vs ' + deepUiRes.osdLightAlpha);
    assert.strictEqual(deepUiRes.visState.showClock.clockDisplayOff, 'none', 'showClock=false must hide #clock');
    assert.strictEqual(deepUiRes.visState.showSynopsis.synDisplayOff, 'none', 'showSynopsis=false must hide synopsis');
    assert.strictEqual(deepUiRes.visState.showPrevNext.prevNextDisplayOff, 'none', 'showPrevNext=false must hide prev/next bar');
    assert.strictEqual(deepUiRes.visState.showChannelNumbers.chNumDisplayOff, 'none', 'showChannelNumbers=false must hide channel numbers');
    assert(deepUiRes.nonCriticalSuppressed && deepUiRes.criticalAllowed, 'showToasts=false suppression behavior broken');
    assert(deepUiRes.stayedAtHeaderOrZero && deepUiRes.stoppedAtLast && deepUiRes.wrappedUpToLast && deepUiRes.wrappedDownToZero, 'wrapNavigation behavior failed: ' + JSON.stringify(deepUiRes));
    assert(deepUiRes.seekStepAfter === 60 && deepUiRes.greenLabelAfter.indexOf('60') !== -1, 'seekStepSec=60 failed: ' + JSON.stringify(deepUiRes));
    assert.strictEqual(deepUiRes.singleClickFsMode, 'FULLSCREEN', 'singleClickFullscreen=true must enter FULLSCREEN on first OK');

    // 6. Persistence across reload + Reset to Clean defaults
    await page.evaluate(() => {
      window.app.setUiPref('showRowLogos', false, true);
      window.app.setUiPref('density', 'compact', true);
      window.app.setUiPref('accent', 'emerald', true);
      window.app.setUiPref('fontScale', 'lg', true);
      window.app.setUiPref('layoutSide', 'left', true);
      window.app.setUiPref('bgTone', 'oled', true);
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
        layoutLeft: cls.contains('ui-layout-left'),
        bgOled: cls.contains('ui-bg-oled'),
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
        persisted.layoutLeft &&
        persisted.bgOled &&
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
        layoutSide: prefs.layoutSide,
        bgTone: prefs.bgTone,
        hasBalanced: cls.contains('ui-density-balanced'),
        hasSky: cls.contains('ui-accent-sky'),
        hasLayoutLeft: cls.contains('ui-layout-left'),
        hasBgMidnight: cls.contains('ui-bg-midnight'),
        rowImgs: document.querySelectorAll('#channel-list .channel-item img').length
      };
    });
    assert.strictEqual(resetRes.preset, 'clean');
    assert.strictEqual(resetRes.density, 'balanced');
    assert.strictEqual(resetRes.accent, 'sky');
    assert.strictEqual(resetRes.showRowLogos, true);
    assert.strictEqual(resetRes.startupMode, 'browse');
    assert.strictEqual(resetRes.layoutSide, 'right');
    assert.strictEqual(resetRes.bgTone, 'midnight');
    assert(resetRes.hasBalanced && resetRes.hasSky && !resetRes.hasLayoutLeft && resetRes.hasBgMidnight && resetRes.rowImgs === 25, 'Reset did not restore Clean UI defaults');

    assert.strictEqual(pageErrors.length, 0, 'UI customization suite pageerrors: ' + pageErrors.join('; '));
    assert.strictEqual(consoleErrors.length, 0, 'UI customization suite console errors: ' + consoleErrors.join('; '));
    await page.close();
    pass('ui-customization-persistence-and-lightness', 'Clean defaults, presets, 11 toggles, layoutSide/listWidth/OLED/radius/focus/osdOpacity, nav prefs, reload persistence & reset verified');
  } finally {
    server.close();
  }
}

async function verifyAvAudioPictureAndPerfSuite(browser, webRoot, sampleM3u25, cached25, pass) {
  const cached60 = buildSampleCachedChannels(60);
  const m3u60 = buildSampleM3u(60);
  const { server, port } = await createStaticServer({ webRoot, sampleM3u: m3u60 });
  try {
    const { page, pageErrors, consoleErrors } = await openConfiguredPage(browser, port, {
      width: 1920,
      height: 1080,
      setupFn: (sampleUrl, cached) => {
        window.webOSSystem = { close: function () {} };
        window.__cmesCount = 0;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC && AC.prototype && AC.prototype.createMediaElementSource) {
          const origCmes = AC.prototype.createMediaElementSource;
          AC.prototype.createMediaElementSource = function () {
            window.__cmesCount++;
            return origCmes.apply(this, arguments);
          };
        }
        localStorage.setItem('zenplay_iptv_sources_v2', JSON.stringify([{ id: 'src_1', name: 'Test', url: sampleUrl, enabled: true }]));
        localStorage.setItem('zenplay_iptv_cached_lineup_v2', JSON.stringify({ v: 2, updatedAt: Date.now(), discoveredEpgUrls: [], rawChannels: cached }));
      },
      setupArgs: ['http://127.0.0.1:' + port + '/sample.m3u', cached60]
    });

    // 1. Zero silent-audio regression on boot & Original picture preset zero GPU filter
    try {
      await page.waitForFunction(() => {
        const vid = document.getElementById('tv-video');
        return Boolean(vid && vid.volume === 1);
      }, { timeout: 3500, polling: 50 });
    } catch (e) {
      const dbg = await page.evaluate(() => ({
        vol: document.getElementById('tv-video').volume,
        factor: window.app && window.app.player ? window.app.player._zapFadeFactor : null,
        raf: window.app && window.app.player ? window.app.player._zapFadeRaf : null,
        timer: window.app && window.app.player ? window.app.player._zapFadeTimer : null,
        elapsed: window.app && window.app.player ? Date.now() - window.app.player._zapFadeStartMs : null,
        hidden: document.hidden
      }));
      throw new Error('Boot volume did not settle to 1 within 3.5s: ' + JSON.stringify(dbg));
    }
    const bootRes = await page.evaluate(() => {
      const vid = document.getElementById('tv-video');
      const av = window.app.getAvPrefs();
      const bootVol = vid.volume;
      const prevPlay = vid.play;
      vid.play = function () { return Promise.resolve(); };
      window.app.player.play(window.app.visibleChannels[0]);
      const mutedAfterTvPlay = vid.muted;
      const volAfterTvPlay = vid.volume;
      vid.play = prevPlay;
      return {
        cmesCount: window.__cmesCount,
        volume: bootVol,
        mutedAfterTvPlay,
        volAfterTvPlay,
        audioNormMode: av.audioNormMode,
        audioVoiceBoost: av.audioVoiceBoost,
        picturePreset: av.picturePreset,
        filter: vid.style.filter,
        webkitFilter: vid.style.webkitFilter,
        statsHidden: document.getElementById('stream-stats-badge').classList.contains('hidden'),
        hasStatsTimer: Boolean(window.app._streamStatsTimer),
        hasLoudnessTimer: Boolean(window.app.player._loudnessSampleTimer)
      };
    });
    assert.strictEqual(bootRes.cmesCount, 0, 'Boot with audioNormMode=off & voiceBoost=false must NEVER call createMediaElementSource');
    assert.strictEqual(bootRes.volume, 1, 'Boot video.volume must be 1 (zero silent boot)');
    assert.strictEqual(bootRes.mutedAfterTvPlay, false, 'TV autoplay boot video.muted must be false');
    assert(bootRes.volAfterTvPlay >= 0.15 && bootRes.volAfterTvPlay <= 1, 'TV zap fade / effective volume active on boot');
    try {
      await page.waitForFunction(() => {
        const vid = document.getElementById('tv-video');
        return Boolean(vid && vid.volume === 1);
      }, { timeout: 2000, polling: 40 });
    } catch (e) {
      const dbg = await page.evaluate(() => ({
        vol: document.getElementById('tv-video').volume,
        factor: window.app && window.app.player ? window.app.player._zapFadeFactor : null,
        raf: window.app && window.app.player ? window.app.player._zapFadeRaf : null,
        timer: window.app && window.app.player ? window.app.player._zapFadeTimer : null,
        elapsed: window.app && window.app.player ? Date.now() - window.app.player._zapFadeStartMs : null,
        cleaning: window.app && window.app.player ? window.app.player._isCleaningUp : null
      }));
      throw new Error('Post zap-fade timeout: ' + JSON.stringify(dbg));
    }
    const postFadeVol = await page.evaluate(() => document.getElementById('tv-video').volume);
    assert.strictEqual(postFadeVol, 1, 'Post zap-fade video.volume must reach 1.0');
    assert.strictEqual(bootRes.picturePreset, 'original');
    assert.strictEqual(bootRes.filter, '', 'Original preset must keep video.style.filter empty');
    assert.strictEqual(bootRes.webkitFilter, '', 'Original preset must keep video.style.webkitFilter empty');
    assert.strictEqual(bootRes.statsHidden, true);
    assert.strictEqual(bootRes.hasStatsTimer, false);
    assert.strictEqual(bootRes.hasLoudnessTimer, false);

    // 2. Audio Volume Normalization modes, Voice Boost, Zap Fade, Per-channel Trim & Reset
    const audioRes = await page.evaluate(() => {
      window.app.openSettingsModal();
      window.app.switchSettingsTab('av');
      const modes = [];
      for (const m of ['gentle', 'broadcast', 'night', 'off']) {
        document.getElementById('btn-av-norm-' + m).click();
        modes.push(window.app.getAvPrefs().audioNormMode);
      }
      document.getElementById('btn-av-audioVoiceBoost').click();
      const boostOn = window.app.getAvPrefs().audioVoiceBoost;
      document.getElementById('btn-av-audioVoiceBoost').click();
      const boostOff = window.app.getAvPrefs().audioVoiceBoost;

      document.getElementById('btn-av-audioZapFade').click();
      const fadeOff = window.app.getAvPrefs().audioZapFade;
      document.getElementById('btn-av-audioZapFade').click();
      const fadeOn = window.app.getAvPrefs().audioZapFade;

      // Suspended AudioContext / native playback safety guard check
      const player = window.app.player;
      const cmesBeforeGuard = window.__cmesCount;
      const prevNative = player._isNativePlayback;
      const prevGraphReady = player._webAudioGraphReady;
      const prevAudioCtx = player._audioCtx;
      const prevMediaSrc = player._mediaSourceNode;

      player._webAudioGraphReady = false;
      player._mediaSourceNode = null;
      player._isNativePlayback = true;
      player.setAvPrefs({ audioNormMode: 'broadcast', audioVoiceBoost: true });
      const ensureNativeRes = player.ensureWebAudioPipeline();
      const cmesAfterNative = window.__cmesCount;

      player._isNativePlayback = false;
      player._audioCtx = { state: 'suspended' };
      const ensureSuspendedRes = player.ensureWebAudioPipeline();
      const cmesAfterSuspended = window.__cmesCount;

      player._isNativePlayback = prevNative;
      player._webAudioGraphReady = prevGraphReady;
      player._audioCtx = prevAudioCtx;
      player._mediaSourceNode = prevMediaSrc;

      // Per-channel trim -6dB -> updates applyEffectiveVolume() & persists in zenplay_channel_loudness_v1
      player.setAvPrefs({ audioNormMode: 'off', audioVoiceBoost: false });
      document.getElementById('btn-av-trim--6').click();
      const volAtMinus6 = player.video.volume;
      const savedLoudRaw = localStorage.getItem('zenplay_channel_loudness_v1');
      const savedLoud = savedLoudRaw ? JSON.parse(savedLoudRaw) : {};
      const chId = window.app.selectedChannel.id;
      const trimPersistedMinus6 = savedLoud.trim ? savedLoud.trim[chId] : null;

      // +6dB trim persists cleanly
      document.getElementById('btn-av-trim-6').click();
      const trimPersistedPlus6 = player.getChannelVolumeTrim(chId);

      // Reset loudness memory clears trim & learned and restores effective volume 1.0
      document.getElementById('btn-reset-loudness-memory').click();
      const trimAfterReset = player.getChannelVolumeTrim(chId);
      const volAfterReset = player.video.volume;

      return {
        modes,
        boostOn,
        boostOff,
        fadeOff,
        fadeOn,
        cmesBeforeGuard,
        ensureNativeRes,
        cmesAfterNative,
        ensureSuspendedRes,
        cmesAfterSuspended,
        volAtMinus6,
        trimPersistedMinus6,
        trimPersistedPlus6,
        trimAfterReset,
        volAfterReset
      };
    });
    assert.deepStrictEqual(audioRes.modes, ['gentle', 'broadcast', 'night', 'off']);
    assert(audioRes.boostOn === true && audioRes.boostOff === false, 'audioVoiceBoost toggle failed');
    assert(audioRes.fadeOff === false && audioRes.fadeOn === true, 'audioZapFade toggle failed');
    assert.strictEqual(audioRes.ensureNativeRes, false, 'Native playback ensureWebAudioPipeline must return false');
    assert.strictEqual(audioRes.cmesAfterNative, audioRes.cmesBeforeGuard, 'Native playback must NEVER attach createMediaElementSource');
    assert.strictEqual(audioRes.ensureSuspendedRes, false, 'Suspended AudioContext ensureWebAudioPipeline must return false');
    assert.strictEqual(audioRes.cmesAfterSuspended, audioRes.cmesBeforeGuard, 'Suspended AudioContext must NEVER attach createMediaElementSource');
    assert(audioRes.volAtMinus6 >= 0.48 && audioRes.volAtMinus6 <= 0.53, '-6dB trim must attenuate video.volume to ~0.501, got ' + audioRes.volAtMinus6);
    assert.strictEqual(audioRes.trimPersistedMinus6, -6, '-6dB trim must persist in zenplay_channel_loudness_v1');
    assert.strictEqual(audioRes.trimPersistedPlus6, 6, '+6dB trim must persist');
    assert(audioRes.trimAfterReset === 0 && audioRes.volAfterReset === 1, 'resetLoudnessMemory must restore 0dB trim & volume 1.0');

    // 3. Picture presets, manual calibration (custom), aspect ratio, crisp, quality caps, latency, memory & Stream Stats
    const picQualRes = await page.evaluate(() => {
      const vid = document.getElementById('tv-video');
      const cls = document.documentElement.classList;

      document.getElementById('btn-av-pic-vivid').click();
      const vividFilter = vid.style.filter;
      const vividCrisp = cls.contains('video-crisp');

      document.getElementById('btn-av-pic-cinema').click();
      const cinemaFilter = vid.style.filter;

      document.getElementById('btn-av-bright-116').click();
      document.getElementById('btn-av-contrast-108').click();
      document.getElementById('btn-av-sat-125').click();
      const customPreset = window.app.getAvPrefs().picturePreset;
      const customFilter = vid.style.filter;

      document.getElementById('btn-av-pic-original').click();
      const origFilter = vid.style.filter;
      const origWebkit = vid.style.webkitFilter;

      // Aspect ratio & crisp rendering
      document.getElementById('btn-av-aspect-cover').click();
      const hasCover = cls.contains('video-aspect-cover');
      document.getElementById('btn-av-aspect-fill').click();
      const hasFill = cls.contains('video-aspect-fill');
      document.getElementById('btn-av-aspect-zoom').click();
      const hasZoom = cls.contains('video-aspect-zoom');
      document.getElementById('btn-av-crisp-crisp').click();
      const hasCrisp = cls.contains('video-crisp');

      // Video quality, latency & memory modes verified against mock HLS levels
      const player = window.app.player;
      const origHls = player.hls;
      const mockHls = {
        levels: [
          { width: 854, height: 480, bitrate: 1200000 },
          { width: 1280, height: 720, bitrate: 2800000 },
          { width: 1920, height: 1080, bitrate: 5500000 },
          { width: 3840, height: 2160, bitrate: 15000000 }
        ],
        autoLevelCapping: -1,
        startLevel: 0,
        nextLevel: -1,
        currentLevel: 2,
        config: {}
      };
      player.hls = mockHls;

      document.getElementById('btn-av-quality-hd720').click();
      const cap720 = mockHls.autoLevelCapping;
      document.getElementById('btn-av-quality-hd1080').click();
      const cap1080 = mockHls.autoLevelCapping;
      document.getElementById('btn-av-quality-max').click();
      const maxCap = mockHls.autoLevelCapping;
      const maxEst = mockHls.config.abrEwmaDefaultEstimate;
      const maxNext = mockHls.nextLevel;

      document.getElementById('btn-av-latency-low').click();
      const lowLatCfg = {
        sync: mockHls.config.liveSyncDurationCount,
        maxLat: mockHls.config.liveMaxLatencyDurationCount,
        ewma: mockHls.config.abrEwmaFastLive
      };

      document.getElementById('btn-av-memsaver-aggressive').click();
      const aggMemCfg = {
        buf: mockHls.config.maxBufferLength,
        maxBuf: mockHls.config.maxMaxBufferLength,
        back: mockHls.config.backBufferLength,
        size: mockHls.config.maxBufferSize
      };

      player.hls = origHls;

      // Stream Stats overlay in Fullscreen & cleared on exitFullscreen
      document.getElementById('btn-av-showStreamStats').click();
      window.app.closeModals();
      const hiddenInBrowse = document.getElementById('stream-stats-badge').classList.contains('hidden');
      window.app.enterFullscreen();
      window.app.updateStreamStatsOverlay();
      const statsBadge = document.getElementById('stream-stats-badge');
      const visibleInFs = !statsBadge.classList.contains('hidden');
      const statsText = statsBadge.textContent;
      const timerActiveInFs = Boolean(window.app._streamStatsTimer);
      window.app.exitFullscreen();
      const hiddenAfterExit = statsBadge.classList.contains('hidden');
      const timerClearedAfterExit = !window.app._streamStatsTimer;

      // Reset AV prefs via #btn-reset-av-prefs
      window.app.openSettingsModal();
      window.app.switchSettingsTab('av');
      document.getElementById('btn-reset-av-prefs').click();
      const resetAv = window.app.getAvPrefs();
      const resetFilter = vid.style.filter;
      window.app.closeModals();

      return {
        vividFilter,
        vividCrisp,
        cinemaFilter,
        customPreset,
        customFilter,
        origFilter,
        origWebkit,
        hasCover,
        hasFill,
        hasZoom,
        hasCrisp,
        cap720,
        cap1080,
        maxCap,
        maxEst,
        maxNext,
        lowLatCfg,
        aggMemCfg,
        hiddenInBrowse,
        visibleInFs,
        statsText,
        timerActiveInFs,
        hiddenAfterExit,
        timerClearedAfterExit,
        resetAv,
        resetFilter
      };
    });

    assert(picQualRes.vividFilter.indexOf('saturate(1.25)') !== -1 && picQualRes.vividCrisp, 'Vivid preset filter/crisp mismatch');
    assert(picQualRes.cinemaFilter.indexOf('brightness(0.92)') !== -1, 'Cinema preset filter mismatch');
    assert.strictEqual(picQualRes.customPreset, 'custom', 'Manual calibration must set picturePreset=custom');
    assert(picQualRes.customFilter.indexOf('brightness(1.16)') !== -1, 'Custom calibration filter mismatch');
    assert(picQualRes.origFilter === '' && picQualRes.origWebkit === '', 'Original preset must clear video.style.filter to empty string');
    assert(picQualRes.hasCover && picQualRes.hasFill && picQualRes.hasZoom && picQualRes.hasCrisp, 'Aspect/crisp classes failed');
    assert.strictEqual(picQualRes.cap720, 1, 'hd720 must cap levels at 720p (index 1)');
    assert.strictEqual(picQualRes.cap1080, 2, 'hd1080 must cap levels at 1080p (index 2)');
    assert(picQualRes.maxCap === -1 && picQualRes.maxEst === 12000000 && picQualRes.maxNext === 3, 'max quality config mismatch');
    assert(picQualRes.lowLatCfg.sync === 2 && picQualRes.lowLatCfg.maxLat === 5 && picQualRes.lowLatCfg.ewma === 1.8, 'low latency config mismatch: ' + JSON.stringify(picQualRes.lowLatCfg));
    assert(picQualRes.aggMemCfg.buf === 20 && picQualRes.aggMemCfg.maxBuf === 35 && picQualRes.aggMemCfg.back === 10 && picQualRes.aggMemCfg.size === 20000000, 'aggressive memory config mismatch');
    assert(picQualRes.hiddenInBrowse && picQualRes.visibleInFs && picQualRes.statsText.indexOf('BUF') !== -1 && picQualRes.timerActiveInFs && picQualRes.hiddenAfterExit && picQualRes.timerClearedAfterExit, 'Stream stats overlay/timer lifecycle broken: ' + JSON.stringify(picQualRes));
    assert(picQualRes.resetAv.picturePreset === 'original' && picQualRes.resetAv.videoQualityMode === 'smart' && picQualRes.resetAv.showStreamStats === false && picQualRes.resetFilter === '', 'btn-reset-av-prefs failed');

    // 4. Real 50-Step D-Pad Channel Scroll Performance Benchmark (< 8ms avg step latency, 0 errors)
    const benchRes = await page.evaluate(() => {
      window.app.focusedChannelIndex = 0;
      window.app.focusArea = 'channels';
      window.app.mode = 'BROWSE';
      const t0 = performance.now();
      for (let i = 0; i < 50; i++) {
        window.app.navigate('down');
      }
      window.app._flushFocusVisualsNow();
      const elapsedMs = performance.now() - t0;
      return {
        elapsedMs,
        avgMs: elapsedMs / 50,
        finalIdx: window.app.focusedChannelIndex
      };
    });
    assert.strictEqual(benchRes.finalIdx, 50, '50-step D-pad scroll did not reach channel index 50');
    assert(benchRes.avgMs < 8, '50-step D-pad scroll avg latency exceeded 8ms: ' + benchRes.avgMs.toFixed(3) + 'ms');

    assert.strictEqual(pageErrors.length, 0, 'AV & Perf suite pageerrors: ' + pageErrors.join('; '));
    assert.strictEqual(consoleErrors.length, 0, 'AV & Perf suite console errors: ' + consoleErrors.join('; '));
    await page.close();
    pass(
      'av-audio-picture-and-dpad-perf-benchmark',
      'Zero-silent-boot, Audio Norm/VoiceBoost/ZapFade/Trim/Reset, Picture calibration/Aspect/Quality/Latency/Memory/Stats & 50-step D-pad (' +
        benchRes.avgMs.toFixed(2) +
        'ms/step) verified'
    );
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
        await new Promise((r) => setTimeout(r, 240));
        const fsStep1 = await page.evaluate(() => ({
          mode: window.app.mode,
          osdHidden: document.getElementById('fullscreen-osd').classList.contains('hidden')
        }));
        assert.strictEqual(fsStep1.mode, 'FULLSCREEN', '1st Escape from Fullscreen must keep FULLSCREEN while hiding OSD');
        assert.strictEqual(fsStep1.osdHidden, true, '1st Escape from Fullscreen must hide OSD');
        await page.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 240));
        const navState = await page.evaluate(() => ({
          mode: window.app.mode,
          focusedIdx: window.app.focusedChannelIndex
        }));
        assert.strictEqual(navState.mode, 'BROWSE', '2nd Back/Escape from Fullscreen must return to BROWSE mode');
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
          assert.strictEqual(scrollRes.tabs.channels.focusPreservedAfterEdit, true, t + ' channels editor must preserve scrollTop and exact focused button when toggling channel');
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
          assert.strictEqual(scrollRes.tabs.appearance.tabsSingleLine, true, t + ' all 6 settings tabs + close button must fit cleanly on one header line');
          assert.strictEqual(scrollRes.tabs.appearance.resetOnSwitch, 0, t + ' appearance tab scrollTop did not reset to 0');
          assert.strictEqual(scrollRes.tabs.appearance.badItems.length, 0, t + ' appearance tab clipped focused item(s): ' + JSON.stringify(scrollRes.tabs.appearance.badItems));
          if (scrollRes.tabs.appearance.overflows) {
            assert(scrollRes.tabs.appearance.maxScrollAfterDown > 0, t + ' appearance tab failed to scroll down');
            assert(scrollRes.tabs.appearance.wheelScrollTop > 0, t + ' appearance tab failed to scroll via mouse wheel');
            assert(scrollRes.tabs.appearance.afterPageDown > 0, t + ' appearance tab failed to scroll via PageDown');
          }
          assert.strictEqual(scrollRes.tabs.appearance.scrollAfterUp, 0, t + ' appearance tab failed to scroll back to top');
          assert.strictEqual(scrollRes.tabs.appearance.seenResetUiBtn, true, t + ' #btn-reset-ui-prefs not reachable via D-pad');
          assert.strictEqual(scrollRes.tabs.av.resetOnSwitch, 0, t + ' av tab scrollTop did not reset to 0');
          assert.strictEqual(scrollRes.tabs.av.badItems.length, 0, t + ' av tab clipped focused item(s): ' + JSON.stringify(scrollRes.tabs.av.badItems));
          if (scrollRes.tabs.av.overflows) {
            assert(scrollRes.tabs.av.maxScrollAfterDown > 0, t + ' av tab failed to scroll down');
            assert(scrollRes.tabs.av.wheelScrollTop > 0, t + ' av tab failed to scroll via mouse wheel');
            assert(scrollRes.tabs.av.afterPageDown > 0, t + ' av tab failed to scroll via PageDown');
          }
          assert.strictEqual(scrollRes.tabs.av.scrollAfterUp, 0, t + ' av tab failed to scroll back to top');
          assert.strictEqual(scrollRes.tabs.av.seenResetAvBtn, true, t + ' #btn-reset-av-prefs not reachable via D-pad');
          assert(scrollRes.tabs.sources.allVisibleInViewport, t + ' sources tab focused item outside viewport');
          pass('settings-scroll-1080p-' + t, 'All 6 Settings tabs (incl. Appearance & AV) scroll cleanly via D-pad, PageDown, and Mouse Wheel');
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
        assert.strictEqual(zoomScroll.tabs.av.badItems.length, 0, '720p zoomed av tab clipped items: ' + JSON.stringify(zoomScroll.tabs.av.badItems));
        assert.strictEqual(zoomScroll.tabs.av.seenResetAvBtn, true, '720p zoomed #btn-reset-av-prefs not reachable');
        assert(zoomScroll.tabs.channels.scrollTopAfterDown > 0, '720p zoomed channel editor must scroll');
        pass('settings-scroll-720p-zoomed', 'Settings scroll math accurate under CSS zoom (1280x720) across all 6 tabs');

        await page.close();
        await verifyUiCustomizationSuite(browser, opts.webRoot, sampleM3u25, cached25, pass);
        await verifyAvAudioPictureAndPerfSuite(browser, opts.webRoot, sampleM3u25, cached25, pass);
        await verifyLegalDisclaimerSuite(browser, opts.webRoot, sampleM3u25, cached25, pass);
        await verifyTwoStepBackSuite(browser, opts.webRoot, sampleM3u25, cached25, pass);
        await verifyAutoFullscreenSuite(browser, opts.webRoot, sampleM3u25, cached25, pass);
        await verifySilentAutoOtaSuite(browser, opts.webRoot, sampleM3u25, cached25, otaManifest, pass);
        await verifyLiveEpgSuite(browser, opts.webRoot, opts.repoRoot, sampleM3u25, cached25, pass);
        await verifyGlobalVodDiscoverySuite(browser, opts.webRoot, sampleM3u25, cached25, pass);
        await verifyPowerSaveSleepSuite(browser, opts.webRoot, sampleM3u25, cached25, pass);
        await verifyVoiceCommandSuite(browser, opts.webRoot, sampleM3u25, cached25, pass);
        await verifyAppendDefaultSourceSuite(browser, opts.webRoot, sampleM3u25, cached25, pass);
        await verifyInstantProgramEpisodesSuite(browser, opts.webRoot, sampleM3u25, cached25, pass);
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
                setInputFocused: function () {},
                setScreenSleepMode: function (asleep) {
                  window.__sleepModeCalls = window.__sleepModeCalls || [];
                  window.__sleepModeCalls.push(Boolean(asleep));
                },
                startVoiceCommand: function (lang) {
                  window.__voiceHostLangs = window.__voiceHostLangs || [];
                  window.__voiceHostLangs.push(lang || '');
                }
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
            const atvStep1 = await page.evaluate(() => ({
              mode: window.app.mode,
              osdHidden: document.getElementById('fullscreen-osd').classList.contains('hidden')
            }));
            assert.strictEqual(atvStep1.mode, 'FULLSCREEN', '1st AndroidTVBridge back must hide OSD and stay in FULLSCREEN');
            assert.strictEqual(atvStep1.osdHidden, true, '1st AndroidTVBridge back must hide OSD');
            await page.evaluate(() => window.AndroidTVBridge.dispatchKey('back'));
            await new Promise((r) => setTimeout(r, 150));
            const atvMode = await page.evaluate(() => window.app.mode);
            assert.strictEqual(atvMode, 'BROWSE', '2nd AndroidTVBridge back must return from Fullscreen to BROWSE');

            const atvScroll = await verifySettingsScrollingForTheme(page, 'glass');
            assert.strictEqual(atvScroll.tabs.performance.badItems.length, 0, 'Android TV Settings perf tab clipped focused control');
            assert.strictEqual(atvScroll.tabs.appearance.badItems.length, 0, 'Android TV Settings appearance tab clipped focused control');
            assert.strictEqual(atvScroll.tabs.appearance.seenResetUiBtn, true, 'Android TV #btn-reset-ui-prefs not reachable');
            assert.strictEqual(atvScroll.tabs.av.badItems.length, 0, 'Android TV Settings av tab clipped focused control');
            assert.strictEqual(atvScroll.tabs.av.seenResetAvBtn, true, 'Android TV #btn-reset-av-prefs not reachable');

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

            // Verify AndroidTvHost v5.6.0 native hooks (setScreenSleepMode + startVoiceCommand + handleVoiceCommand)
            const atvV56 = await page.evaluate(() => {
              window.app.startVoiceCommand();
              window.app.handleVoiceCommand('ערוץ 12');
              const voiceNum = window.app.selectedChannel ? window.app.selectedChannel.number : 0;
              window.app.enterPowerSaveMode();
              const isAsleep = window.app.isPowerSaveMode === true && window.app.player._isPowerSaveMode === true;
              window.app.exitPowerSaveMode();
              const isAwake = window.app.isPowerSaveMode === false && window.app.player._isPowerSaveMode === false;
              return {
                voiceHostLangs: window.__voiceHostLangs || [],
                voiceNum,
                sleepCalls: window.__sleepModeCalls || [],
                isAsleep,
                isAwake
              };
            });
            assert(atvV56.voiceHostLangs.length === 1 && atvV56.voiceHostLangs[0] === 'he-IL', 'AndroidTvHost.startVoiceCommand must pass he-IL: ' + JSON.stringify(atvV56));
            assert.strictEqual(atvV56.voiceNum, 12, 'Android TV handleVoiceCommand must tune ch 12');
            assert(atvV56.isAsleep && atvV56.isAwake, 'Android TV power-save mode toggle failed');
            assert.deepStrictEqual(atvV56.sleepCalls, [true, false], 'AndroidTvHost.setScreenSleepMode(true/false) mismatch');
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
          const injectedAvTab = Boolean(document.getElementById('tab-btn-av'));
          const injectedAvPanel = Boolean(document.getElementById('settings-tab-av'));
          const injectedStatsBadge = Boolean(document.getElementById('stream-stats-badge'));
          const injectedBadge = Boolean(document.getElementById('preview-autoplay-off-badge'));
          const injectedDisclaimerModal = Boolean(document.getElementById('disclaimer-modal'));
          const injectedOpenLegal = Boolean(document.getElementById('btn-open-disclaimer'));
          const injectedAutoOta = Boolean(document.getElementById('btn-toggle-auto-ota'));
          const injectedVodBtn = Boolean(document.getElementById('btn-open-vod'));
          const injectedVoiceBtn = Boolean(document.getElementById('btn-voice-command'));
          const injectedScopeBar = Boolean(document.getElementById('guide-scope-bar'));
          const injectedVodSearch = Boolean(document.getElementById('vod-search-bar'));
          const injectedSleepModal = Boolean(document.getElementById('sleep-warning-modal'));
          const injectedPowerSave = Boolean(document.getElementById('power-save-screen'));
          const injectedVoiceOverlay = Boolean(document.getElementById('voice-overlay'));
          const injectedAppendBtn = Boolean(document.getElementById('btn-append-default-source'));
          const injectedSleepOpts = Boolean(document.getElementById('ui-sleep-options'));
          const injectedVoiceLangOpts = Boolean(document.getElementById('ui-voice-lang-options'));
          document.getElementById('btn-preset-minimal').click();
          const minimalOk = document.documentElement.classList.contains('ui-density-compact');
          document.getElementById('btn-reset-ui-prefs').click();
          app.switchSettingsTab('av');
          document.getElementById('btn-av-pic-vivid').click();
          const vividOk = document.getElementById('tv-video').style.filter.indexOf('saturate(1.25)') !== -1;
          document.getElementById('btn-reset-av-prefs').click();
          app.closeModals();

          return {
            domRows: document.querySelectorAll('#channel-list .channel-item').length,
            hasRowEls: Array.isArray(app._channelRowEls),
            hasPreviewCache: Boolean(app._previewHeaderCache),
            hasOsdCache: Boolean(app._osdLastCache),
            injectedTab,
            injectedPanel,
            injectedAvTab,
            injectedAvPanel,
            injectedStatsBadge,
            injectedBadge,
            injectedDisclaimerModal,
            injectedOpenLegal,
            injectedAutoOta,
            injectedVodBtn,
            injectedVoiceBtn,
            injectedScopeBar,
            injectedVodSearch,
            injectedSleepModal,
            injectedPowerSave,
            injectedVoiceOverlay,
            injectedAppendBtn,
            injectedSleepOpts,
            injectedVoiceLangOpts,
            minimalOk,
            vividOk
          };
        }, otaManifest.jsPatch);

        assert.strictEqual(synthRes.domRows, 5, 'Synthetic legacy OTA upgrade must keep all 5 channels');
        assert.strictEqual(synthRes.hasRowEls, true, '_channelRowEls must be backfilled');
        assert.strictEqual(synthRes.hasPreviewCache, true, '_previewHeaderCache must be backfilled');
        assert.strictEqual(synthRes.hasOsdCache, true, '_osdLastCache must be backfilled');
        assert(synthRes.injectedTab && synthRes.injectedPanel && synthRes.injectedAvTab && synthRes.injectedAvPanel && synthRes.injectedStatsBadge && synthRes.injectedBadge && synthRes.injectedDisclaimerModal && synthRes.injectedOpenLegal && synthRes.injectedAutoOta && synthRes.injectedVodBtn && synthRes.injectedVoiceBtn && synthRes.injectedScopeBar && synthRes.injectedVodSearch && synthRes.injectedSleepModal && synthRes.injectedPowerSave && synthRes.injectedVoiceOverlay && synthRes.injectedAppendBtn && synthRes.injectedSleepOpts && synthRes.injectedVoiceLangOpts && synthRes.minimalOk && synthRes.vividOk, 'Synthetic OTA must inject Appearance, AV, Disclaimer, Auto-OTA & v5.6.0 VOD/Sleep/Voice/Append controls');
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

          // Dynamically injected Appearance + AV tabs, stats badge, presets, toggles, and resets on legacy v5.0.7 / v5.1.4 hosts
          const otaUiRes = await page.evaluate(() => {
            const tabBtn = document.getElementById('tab-btn-appearance');
            const tabPanel = document.getElementById('settings-tab-appearance');
            const avTabBtn = document.getElementById('tab-btn-av');
            const avTabPanel = document.getElementById('settings-tab-av');
            const statsBadge = document.getElementById('stream-stats-badge');
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
            window.app.switchSettingsTab('av');
            document.getElementById('btn-av-pic-vivid').click();
            const avVividOk = document.getElementById('tv-video').style.filter.indexOf('saturate(1.25)') !== -1;
            document.getElementById('btn-av-trim--3').click();
            const avTrimOk = window.app.player.getChannelVolumeTrim(window.app.selectedChannel.id) === -3;
            document.getElementById('btn-reset-loudness-memory').click();
            document.getElementById('btn-reset-av-prefs').click();
            const avResetOk = window.app.getAvPrefs().picturePreset === 'original' && document.getElementById('tv-video').style.filter === '';
            window.app.closeModals();
            return {
              hasTabBtn: Boolean(tabBtn),
              hasTabPanel: Boolean(tabPanel),
              hasAvTabBtn: Boolean(avTabBtn),
              hasAvTabPanel: Boolean(avTabPanel),
              hasStatsBadge: Boolean(statsBadge),
              hasOffBadge: Boolean(offBadge),
              isMinimal,
              isEmerald,
              isResetClean,
              avVividOk,
              avTrimOk,
              avResetOk
            };
          });
          assert(otaUiRes.hasTabBtn && otaUiRes.hasTabPanel && otaUiRes.hasAvTabBtn && otaUiRes.hasAvTabPanel && otaUiRes.hasStatsBadge && otaUiRes.hasOffBadge, tag + ' OTA missing injected UI/AV DOM: ' + JSON.stringify(otaUiRes));
          assert(otaUiRes.isMinimal && otaUiRes.isEmerald && otaUiRes.isResetClean && otaUiRes.avVividOk && otaUiRes.avTrimOk && otaUiRes.avResetOk, tag + ' OTA Appearance/AV controls failed: ' + JSON.stringify(otaUiRes));

          assert.strictEqual(pageErrors.length, 0, tag + ' OTA cold boot pageerrors: ' + pageErrors.join('; '));
          assert.strictEqual(consoleErrors.length, 0, tag + ' OTA cold boot console errors: ' + consoleErrors.join('; '));
          await page.close();
          pass('git-ota-cold-boot-' + tag, tag + ' + cached EPG + v' + otaManifest.version + ' OTA kept channels, injected Appearance+AV UI & switched Glass/Classic');
        }

        // 5b: Live performOTAUpdate() from old tag -> v5.4.0
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
            const hasAvTab = Boolean(document.getElementById('tab-btn-av'));
            const hasAvPanel = Boolean(document.getElementById('settings-tab-av'));
            const hasStatsBadge = Boolean(document.getElementById('stream-stats-badge'));
            window.app.openSettingsModal();
            window.app.switchSettingsTab('appearance');
            document.getElementById('btn-pref-showColorBar').click();
            const colorBarHidden = document.documentElement.classList.contains('ui-hide-color-bar');
            document.getElementById('btn-reset-ui-prefs').click();
            window.app.switchSettingsTab('av');
            document.getElementById('btn-av-norm-gentle').click();
            const avNormOk = window.app.getAvPrefs().audioNormMode === 'gentle';
            document.getElementById('btn-reset-av-prefs').click();
            window.app.closeModals();
            return {
              domRows: document.querySelectorAll('#channel-list .channel-item').length,
              runningVer: window.app.otaManager.getRunningVersion(),
              hasAppTab,
              hasAppPanel,
              hasAvTab,
              hasAvPanel,
              hasStatsBadge,
              colorBarHidden,
              avNormOk
            };
          });
          assert.strictEqual(liveRes.domRows, 4, tag + ' live OTA install lost channels');
          assert.strictEqual(liveRes.runningVer, otaManifest.version, tag + ' live OTA did not activate version');
          assert(liveRes.hasAppTab && liveRes.hasAppPanel && liveRes.hasAvTab && liveRes.hasAvPanel && liveRes.hasStatsBadge && liveRes.colorBarHidden && liveRes.avNormOk, tag + ' live OTA did not inject functional Appearance+AV tabs & stats badge');
          assert.strictEqual(pageErrors.length, 0, tag + ' live OTA pageerrors: ' + pageErrors.join('; '));
          assert.strictEqual(consoleErrors.length, 0, tag + ' live OTA console errors: ' + consoleErrors.join('; '));
          await page.close();
          pass('git-ota-live-install-' + tag, tag + ' live OTA upgrade preserved 4 channels & injected Appearance+AV tabs + stats badge with 0 errors');
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

    // 7. In-App Issue Reporter & Automatic Redacted Diagnostic Log Collector
    {
      const { server, port } = await createStaticServer({ webRoot: opts.webRoot, sampleM3u: sampleM3u25 });
      let receivedIssuePayload = null;
      const mockWorkerServer = http.createServer((req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          });
          return res.end();
        }
        if (req.url === '/mock-issue-worker' && req.method === 'POST') {
          let body = '';
          req.on('data', (c) => { body += c; });
          req.on('end', () => {
            try {
              receivedIssuePayload = JSON.parse(body);
            } catch (e) {}
            res.writeHead(201, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ ok: true, issueNumber: 123, issueUrl: 'https://github.com/maorisraelii/iptv-webos/issues/123' }));
          });
          return;
        }
        res.writeHead(404);
        res.end();
      });
      await new Promise((resolve) => mockWorkerServer.listen(0, '127.0.0.1', resolve));
      const workerPort = mockWorkerServer.address().port;

      try {
        const { page, pageErrors } = await openConfiguredPage(browser, port, {
          width: 1920,
          height: 1080,
          waitMs: 800,
          allowResourceErrors: true,
          setupFn: (sampleUrl, cached) => {
            window.webOSSystem = {};
            localStorage.setItem('zenplay_iptv_sources_v2', JSON.stringify([{ id: 'src_1', name: 'Test', url: sampleUrl, enabled: true }]));
            localStorage.setItem('zenplay_iptv_cached_lineup_v2', JSON.stringify({ v: 2, updatedAt: Date.now(), discoveredEpgUrls: [], rawChannels: cached }));
          },
          setupArgs: ['http://127.0.0.1:' + port + '/sample.m3u', cached25.slice(0, 5)]
        });

        const issueCheck = await page.evaluate(async (mockEndpoint) => {
          console.warn('Stream timeout http://secretuser:secretpass@192.168.1.50:8080/live/stream.m3u8?token=mySecretToken99');
          window.app.openSettingsModal();
          window.app.switchSettingsTab('about');
          document.getElementById('btn-open-issue-report').click();

          const modalOpen = window.app.mode === 'ISSUE' && !document.getElementById('issue-modal').classList.contains('hidden');
          const presetBtn = document.querySelector('#issue-presets-row .issue-preset-btn');
          if (presetBtn) presetBtn.click();
          document.getElementById('issue-desc-input').value = 'בדקתי עכשיו ונתקע';

          const qrSvg = document.querySelector('#issue-qr-box svg') ? document.querySelector('#issue-qr-box svg').outerHTML : '';
          const previewText = document.getElementById('issue-logs-preview').textContent;

          // Fallback (no endpoint configured)
          window.DiagnosticLogger.setEndpointUrl('');
          const fallbackRes = await window.app.submitIssueReport();

          // Direct API submission via mocked Cloudflare Worker
          window.DiagnosticLogger.setEndpointUrl(mockEndpoint);
          const apiRes = await window.app.submitIssueReport();

          window.app.closeModals();
          return {
            modalOpen,
            hasQrSvg: qrSvg.indexOf('<svg') !== -1,
            previewText,
            fallbackMode: fallbackRes.mode,
            fallbackUrlValid: fallbackRes.githubUrl.indexOf('https://github.com/maorisraelii/iptv-webos/issues/new?') === 0,
            apiOk: apiRes.ok,
            apiIssueNum: apiRes.issueNumber
          };
        }, 'http://127.0.0.1:' + workerPort + '/mock-issue-worker');

        assert.strictEqual(issueCheck.modalOpen, true, 'Issue modal must open in ISSUE mode');
        assert.strictEqual(issueCheck.hasQrSvg, true, 'Issue modal must render SVG QR code');
        assert(issueCheck.previewText.indexOf('mySecretToken99') === -1, 'Private token leaked in diagnostic logs!');
        assert(issueCheck.previewText.indexOf('secretpass') === -1, 'Private password leaked in diagnostic logs!');
        assert(issueCheck.previewText.indexOf('192.168.1.50') === -1, 'Private IP leaked in diagnostic logs!');
        assert(issueCheck.previewText.indexOf('[REDACTED') !== -1, 'Diagnostic redaction marker expected');
        assert.strictEqual(issueCheck.fallbackMode, 'qr_fallback', 'Fallback mode expected when no endpoint configured');
        assert.strictEqual(issueCheck.fallbackUrlValid, true, 'GitHub pre-filled issue URL invalid');
        assert.strictEqual(issueCheck.apiOk, true, 'Mocked Cloudflare Worker API submission failed');
        assert.strictEqual(issueCheck.apiIssueNum, 123, 'Mocked issueNumber mismatch');
        assert(receivedIssuePayload && Array.isArray(receivedIssuePayload.logs) && receivedIssuePayload.logs.length > 0, 'Worker did not receive logs array');
        assert.strictEqual(pageErrors.length, 0, 'Issue reporter pageerrors: ' + pageErrors.join('; '));
        await page.close();
        pass('in-app-issue-reporter-and-redacted-logs', 'Issue modal, QR fallback, redacted logs & Worker API submission verified');
      } finally {
        mockWorkerServer.close();
        server.close();
      }
    }

    console.log('\nALL ' + steps.length + ' TEST SUITES PASSED! (platform=' + opts.platform + ', version=' + otaManifest.version + ')');
  } finally {
    await browser.close();
  }
}

async function verifyLegalDisclaimerSuite(browser, webRoot, sampleM3u25, cached25, pass) {
  const { server, port } = await createStaticServer({ webRoot, sampleM3u: sampleM3u25 });
  try {
    const { page, pageErrors, consoleErrors } = await openConfiguredPage(browser, port, {
      width: 1920,
      height: 1080,
      skipDisclaimerAccept: true,
      setupFn: (sampleUrl, cached) => {
        window.webOSSystem = { close: function () {} };
        localStorage.setItem('zenplay_iptv_sources_v2', JSON.stringify([{ id: 'src_1', name: 'Test', url: sampleUrl, enabled: true }]));
        localStorage.setItem('zenplay_iptv_cached_lineup_v2', JSON.stringify({ v: 2, updatedAt: Date.now(), discoveredEpgUrls: [], rawChannels: cached }));
        localStorage.setItem('zenplay_ui_prefs_v1', JSON.stringify({ startupMode: 'fullscreen', autoFullscreenSec: 8 }));
      },
      setupArgs: ['http://127.0.0.1:' + port + '/sample.m3u', cached25]
    });

    const initCheck = await page.evaluate(() => ({
      mode: window.app.mode,
      modalVisible: !document.getElementById('disclaimer-modal').classList.contains('hidden'),
      acceptFocused: Boolean(window.app.currentFocusedEl && window.app.currentFocusedEl.id === 'btn-disclaimer-accept'),
      hasAutoFsTimer: Boolean(window.app._autoFullscreenTimer)
    }));
    assert.strictEqual(initCheck.mode, 'DISCLAIMER', 'First launch without accepted key must enter DISCLAIMER mode');
    assert.strictEqual(initCheck.modalVisible, true, '#disclaimer-modal must be visible on first launch');
    assert.strictEqual(initCheck.acceptFocused, true, '#btn-disclaimer-accept must be focused on open');
    assert.strictEqual(initCheck.hasAutoFsTimer, false, 'Auto-Fullscreen must not run while disclaimer is open');

    // Back (Escape, AndroidTVBridge) & hotkeys must be blocked on mandatory first-launch disclaimer
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 80));
    await page.evaluate(() => {
      if (window.AndroidTVBridge) window.AndroidTVBridge.dispatchKey('back');
    });
    await page.keyboard.press('ArrowDown');
    await new Promise((r) => setTimeout(r, 80));
    const blockedCheck = await page.evaluate(() => ({
      mode: window.app.mode,
      modalVisible: !document.getElementById('disclaimer-modal').classList.contains('hidden'),
      acceptFocused: Boolean(window.app.currentFocusedEl && window.app.currentFocusedEl.id === 'btn-disclaimer-accept'),
      acceptedStorage: localStorage.getItem('zenplay_disclaimer_accepted_v1')
    }));
    assert.strictEqual(blockedCheck.mode, 'DISCLAIMER', 'BACK must not close mandatory first-launch disclaimer');
    assert.strictEqual(blockedCheck.modalVisible, true, '#disclaimer-modal must stay open after BACK');
    assert.strictEqual(blockedCheck.acceptFocused, true, '#btn-disclaimer-accept must retain focus after ArrowDown');
    assert.strictEqual(blockedCheck.acceptedStorage, null, 'Disclaimer must not be persisted before OK');

    // Accept via OK (Enter) -> persists & enters BROWSE
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 120));
    const acceptedRes = await page.evaluate(() => ({
      mode: window.app.mode,
      modalHidden: document.getElementById('disclaimer-modal').classList.contains('hidden'),
      acceptedStorage: localStorage.getItem('zenplay_disclaimer_accepted_v1'),
      hasAutoFsTimer: Boolean(window.app._autoFullscreenTimer),
      domRows: document.querySelectorAll('#channel-list .channel-item').length
    }));
    assert.strictEqual(acceptedRes.mode, 'BROWSE');
    assert.strictEqual(acceptedRes.modalHidden, true);
    assert.strictEqual(acceptedRes.acceptedStorage, '1');
    assert.strictEqual(acceptedRes.hasAutoFsTimer, true, 'Accepting disclaimer must schedule Auto-Fullscreen');
    assert.strictEqual(acceptedRes.domRows, 25);

    // Reload -> must NOT show disclaimer again
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 700));
    const reloadCheck = await page.evaluate(() => ({
      mode: window.app.mode,
      modalHidden: document.getElementById('disclaimer-modal').classList.contains('hidden')
    }));
    assert.notStrictEqual(reloadCheck.mode, 'DISCLAIMER', 'Reload after acceptance must not re-open mandatory disclaimer');
    assert.strictEqual(reloadCheck.modalHidden, true);

    // Settings -> About tab -> reopen & close via Back + OK cleanly
    await page.evaluate(() => {
      window.app.openSettingsModal();
      window.app.switchSettingsTab('about');
      window.app.setupModalFocus('#settings-modal');
    });
    await new Promise((r) => setTimeout(r, 80));
    const aboutReach = await page.evaluate(() => {
      const aboutEl = document.getElementById('settings-tab-about');
      let seenAutoOta = false;
      let seenOpenDisclaimer = false;
      let clipped = false;
      for (let i = 0; i < 15; i++) {
        window.app.navigate('down');
        const cur = window.app.currentFocusedEl;
        if (cur && aboutEl.contains(cur)) {
          const cr = aboutEl.getBoundingClientRect();
          const tr = cur.getBoundingClientRect();
          if (tr.top < cr.top - 6 || tr.bottom > cr.bottom + 6) clipped = true;
          if (cur.id === 'btn-toggle-auto-ota') seenAutoOta = true;
          if (cur.id === 'btn-open-disclaimer') {
            seenOpenDisclaimer = true;
            break;
          }
        }
      }
      return { seenAutoOta, seenOpenDisclaimer, clipped };
    });
    assert(aboutReach.seenAutoOta && aboutReach.seenOpenDisclaimer && !aboutReach.clipped, 'Settings About controls reach/scroll issue: ' + JSON.stringify(aboutReach));

    await page.evaluate(() => document.getElementById('btn-open-disclaimer').click());
    await new Promise((r) => setTimeout(r, 80));
    const reopenState = await page.evaluate(() => ({
      mode: window.app.mode,
      fromSettings: window.app._disclaimerFromSettings,
      disclaimerVisible: !document.getElementById('disclaimer-modal').classList.contains('hidden'),
      settingsHidden: document.getElementById('settings-modal').classList.contains('hidden')
    }));
    assert.strictEqual(reopenState.mode, 'DISCLAIMER');
    assert.strictEqual(reopenState.fromSettings, true);
    assert(reopenState.disclaimerVisible && reopenState.settingsHidden);

    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 80));
    const backToAbout = await page.evaluate(() => ({
      mode: window.app.mode,
      disclaimerHidden: document.getElementById('disclaimer-modal').classList.contains('hidden'),
      settingsVisible: !document.getElementById('settings-modal').classList.contains('hidden'),
      activeTab: window.app.activeSettingsTab,
      focusedId: window.app.currentFocusedEl ? window.app.currentFocusedEl.id : ''
    }));
    assert(backToAbout.mode === 'SETTINGS' && backToAbout.disclaimerHidden && backToAbout.settingsVisible && backToAbout.activeTab === 'about' && backToAbout.focusedId === 'btn-open-disclaimer', 'Back from About disclaimer must return to About tab: ' + JSON.stringify(backToAbout));

    await page.evaluate(() => document.getElementById('btn-open-disclaimer').click());
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 80));
    const okBackToAbout = await page.evaluate(() => ({
      mode: window.app.mode,
      activeTab: window.app.activeSettingsTab,
      settingsVisible: !document.getElementById('settings-modal').classList.contains('hidden')
    }));
    assert(okBackToAbout.mode === 'SETTINGS' && okBackToAbout.activeTab === 'about' && okBackToAbout.settingsVisible);
    await page.evaluate(() => window.app.closeModals());

    assert.strictEqual(pageErrors.length, 0, 'Disclaimer suite pageerrors: ' + pageErrors.join('; '));
    assert.strictEqual(consoleErrors.length, 0, 'Disclaimer suite console errors: ' + consoleErrors.join('; '));
    await page.close();

    // Safe Mode skips first-launch disclaimer cleanly
    const { server: safeSrv, port: safePort } = await createStaticServer({ webRoot, sampleM3u: sampleM3u25 });
    try {
      const safePageRes = await openConfiguredPage(browser, safePort, {
        width: 1920,
        height: 1080,
        query: '?safeMode=1',
        skipDisclaimerAccept: true,
        setupFn: (sampleUrl, cached) => {
          window.__IPTV_ANDROID_TV = true;
          localStorage.setItem('zenplay_iptv_sources_v2', JSON.stringify([{ id: 'src_1', name: 'Test', url: sampleUrl, enabled: true }]));
          localStorage.setItem('zenplay_iptv_cached_lineup_v2', JSON.stringify({ v: 2, updatedAt: Date.now(), discoveredEpgUrls: [], rawChannels: cached }));
        },
        setupArgs: ['http://127.0.0.1:' + safePort + '/sample.m3u', cached25]
      });
      const safeModeState = await safePageRes.page.evaluate(() => ({
        mode: window.app.mode,
        disclaimerHidden: document.getElementById('disclaimer-modal').classList.contains('hidden'),
        hasAutoFsTimer: Boolean(window.app._autoFullscreenTimer)
      }));
      assert.strictEqual(safeModeState.mode, 'BROWSE');
      assert.strictEqual(safeModeState.disclaimerHidden, true);
      assert.strictEqual(safeModeState.hasAutoFsTimer, false);
      assert.strictEqual(safePageRes.pageErrors.length, 0);
      await safePageRes.page.close();
    } finally {
      safeSrv.close();
    }

    pass('legal-disclaimer-first-launch-and-about', 'First-launch Back block, OK persist, reload skip, SafeMode skip & About reopen/close verified');
  } finally {
    server.close();
  }
}

async function verifyTwoStepBackSuite(browser, webRoot, sampleM3u25, cached25, pass) {
  const { server, port } = await createStaticServer({ webRoot, sampleM3u: sampleM3u25 });
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

    // 1. Default backHidesOsdFirst: true -> 1st Escape hides OSD, 2nd Escape exits to BROWSE
    await page.evaluate(() => window.app.enterFullscreen());
    await new Promise((r) => setTimeout(r, 120));
    const fsVisible = await page.evaluate(() => ({
      mode: window.app.mode,
      osdVisible: !document.getElementById('fullscreen-osd').classList.contains('hidden'),
      hasOsdTimer: Boolean(window.app.osdTimer),
      hasOsdTickTimer: Boolean(window.app.osdTickTimer)
    }));
    assert(fsVisible.mode === 'FULLSCREEN' && fsVisible.osdVisible && fsVisible.hasOsdTimer && fsVisible.hasOsdTickTimer, 'Fullscreen must show OSD with active timers: ' + JSON.stringify(fsVisible));

    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 240));
    const afterFirstBack = await page.evaluate(() => ({
      mode: window.app.mode,
      osdHidden: document.getElementById('fullscreen-osd').classList.contains('hidden'),
      osdTimerCleared: window.app.osdTimer === null,
      osdTickCleared: window.app.osdTickTimer === null,
      isSurfing: window.app.isSurfing
    }));
    assert(afterFirstBack.mode === 'FULLSCREEN' && afterFirstBack.osdHidden && afterFirstBack.osdTimerCleared && afterFirstBack.osdTickCleared && !afterFirstBack.isSurfing, '1st Back must hide OSD cleanly and stay FULLSCREEN: ' + JSON.stringify(afterFirstBack));

    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 240));
    assert.strictEqual(await page.evaluate(() => window.app.mode), 'BROWSE', '2nd Back must exit to BROWSE');

    // 2. When OSD is already hidden via hideOSD(), single Back exits immediately; exit button exits in 1 click
    await page.evaluate(() => {
      window.app.enterFullscreen();
    });
    await new Promise((r) => setTimeout(r, 120));
    await page.evaluate(() => document.getElementById('btn-osd-exit-fullscreen').click());
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(await page.evaluate(() => window.app.mode), 'BROWSE', '#btn-osd-exit-fullscreen must exit Fullscreen in 1 click');

    // 3. AndroidTVBridge 2-step Back + toggle backHidesOsdFirst: false -> immediate 1-step exit
    await page.evaluate(() => window.app.enterFullscreen());
    await new Promise((r) => setTimeout(r, 120));
    await page.evaluate(() => window.AndroidTVBridge.dispatchKey('back'));
    assert.strictEqual(await page.evaluate(() => window.app.mode), 'FULLSCREEN', 'AndroidTVBridge 1st back must stay FULLSCREEN');
    assert.strictEqual(await page.evaluate(() => document.getElementById('fullscreen-osd').classList.contains('hidden')), true);
    await page.evaluate(() => window.AndroidTVBridge.dispatchKey('back'));
    assert.strictEqual(await page.evaluate(() => window.app.mode), 'BROWSE', 'AndroidTVBridge 2nd back must exit to BROWSE');

    // Toggle backHidesOsdFirst OFF via UI button -> 1-step Back on both webOS Escape & AndroidTVBridge
    await page.evaluate(() => {
      window.app.openSettingsModal();
      window.app.switchSettingsTab('appearance');
      document.getElementById('btn-pref-backHidesOsdFirst').click();
      window.app.closeModals();
    });
    assert.strictEqual(await page.evaluate(() => window.app.getUiPrefs().backHidesOsdFirst), false);

    await page.evaluate(() => window.app.enterFullscreen());
    await new Promise((r) => setTimeout(r, 120));
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(await page.evaluate(() => window.app.mode), 'BROWSE', 'With backHidesOsdFirst=false, 1st Escape must exit directly to BROWSE');

    await page.evaluate(() => window.app.enterFullscreen());
    await new Promise((r) => setTimeout(r, 120));
    await page.evaluate(() => window.AndroidTVBridge.dispatchKey('back'));
    assert.strictEqual(await page.evaluate(() => window.app.mode), 'BROWSE', 'With backHidesOsdFirst=false, AndroidTVBridge 1st back must exit directly to BROWSE');

    assert.strictEqual(pageErrors.length, 0, '2-Step Back suite pageerrors: ' + pageErrors.join('; '));
    assert.strictEqual(consoleErrors.length, 0, '2-Step Back suite console errors: ' + consoleErrors.join('; '));
    await page.close();
    pass('two-step-fullscreen-back', '2-step Back (OSD hide -> Browse exit), hideOSD() cleanup, exit btn & backHidesOsdFirst=false verified');
  } finally {
    server.close();
  }
}

async function verifyAutoFullscreenSuite(browser, webRoot, sampleM3u25, cached25, pass) {
  const { server, port } = await createStaticServer({ webRoot, sampleM3u: sampleM3u25 });
  try {
    const { page, pageErrors, consoleErrors } = await openConfiguredPage(browser, port, {
      width: 1920,
      height: 1080,
      setupFn: (sampleUrl, cached) => {
        window.webOSSystem = { close: function () {} };
        localStorage.setItem('zenplay_iptv_sources_v2', JSON.stringify([{ id: 'src_1', name: 'Test', url: sampleUrl, enabled: true }]));
        localStorage.setItem('zenplay_iptv_cached_lineup_v2', JSON.stringify({ v: 2, updatedAt: Date.now(), discoveredEpgUrls: [], rawChannels: cached }));
        localStorage.setItem('zenplay_ui_prefs_v1', JSON.stringify({ autoFullscreenSec: 5 }));
      },
      setupArgs: ['http://127.0.0.1:' + port + '/sample.m3u', cached25]
    });

    // 1. Focus away (header / timeline) and opening modal must cancel timer; returning reschedules
    const lifecycle = await page.evaluate(() => {
      const initialTimer = Boolean(window.app._autoFullscreenTimer);
      window.app.focusHeaderBar();
      const afterHeader = Boolean(window.app._autoFullscreenTimer);
      window.app.focusChannelList();
      const afterReturn = Boolean(window.app._autoFullscreenTimer);
      window.app.navigate('left');
      const afterTimeline = window.app.focusArea === 'timeline' ? Boolean(window.app._autoFullscreenTimer) : false;
      window.app.focusChannelList();
      window.app.openSettingsModal();
      const inModal = Boolean(window.app._autoFullscreenTimer);
      window.app.closeModals();
      const afterModalClose = Boolean(window.app._autoFullscreenTimer);
      return { initialTimer, afterHeader, afterReturn, afterTimeline, inModal, afterModalClose };
    });
    assert(lifecycle.initialTimer && !lifecycle.afterHeader && lifecycle.afterReturn && !lifecycle.afterTimeline && !lifecycle.inModal && lifecycle.afterModalClose, 'Auto-Fullscreen cancel/reschedule lifecycle failed: ' + JSON.stringify(lifecycle));

    // 2. Navigate down once and wait for 5s idle Auto-Fullscreen transition
    const idleStartMs = Date.now();
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => window.app && window.app.mode === 'FULLSCREEN', { timeout: 8500, polling: 50 });
    const idleElapsedMs = Date.now() - idleStartMs;
    const autoEntered = await page.evaluate(() => ({
      mode: window.app.mode,
      selectedName: window.app.selectedChannel ? window.app.selectedChannel.name : '',
      focusedIdx: window.app.focusedChannelIndex
    }));
    assert.strictEqual(autoEntered.mode, 'FULLSCREEN', 'Idle 5s in BROWSE must auto-enter FULLSCREEN: ' + JSON.stringify(autoEntered));
    assert(idleElapsedMs >= 4500, 'Auto-Fullscreen fired too early (' + idleElapsedMs + 'ms)');
    assert.strictEqual(autoEntered.focusedIdx, 1);

    // 3. Exit Fullscreen, set autoFullscreenSec = 0 via #btn-autofs-0 -> cancels timer & stays BROWSE
    await page.evaluate(() => {
      window.app.exitFullscreen();
      window.app.openSettingsModal();
      window.app.switchSettingsTab('appearance');
      document.getElementById('btn-autofs-0').click();
      window.app.closeModals();
    });
    const zeroCheck = await page.evaluate(() => ({
      sec: window.app.getUiPrefs().autoFullscreenSec,
      timer: Boolean(window.app._autoFullscreenTimer),
      mode: window.app.mode
    }));
    assert.strictEqual(zeroCheck.sec, 0);
    assert.strictEqual(zeroCheck.timer, false, 'autoFullscreenSec=0 must cancel timer');

    // 4. destroy() clears _autoFullscreenTimer
    const destroyOk = await page.evaluate(() => {
      window.app.setUiPref('autoFullscreenSec', 5, true);
      window.app.scheduleAutoFullscreen();
      const had = Boolean(window.app._autoFullscreenTimer);
      window.app.destroy();
      return had && !window.app._autoFullscreenTimer;
    });
    assert.strictEqual(destroyOk, true, 'destroy() must clear _autoFullscreenTimer');

    assert.strictEqual(pageErrors.length, 0, 'Auto-Fullscreen suite pageerrors: ' + pageErrors.join('; '));
    assert.strictEqual(consoleErrors.length, 0, 'Auto-Fullscreen suite console errors: ' + consoleErrors.join('; '));
    await page.close();
    pass('auto-fullscreen-timer', 'Auto-Fullscreen 5s idle transition, focus/modal/0/destroy cancellations verified');
  } finally {
    server.close();
  }
}

async function verifySilentAutoOtaSuite(browser, webRoot, sampleM3u25, cached25, otaManifest, pass) {
  let mockRemoteManifest = {
    version: '9.9.0',
    channel: 'stable',
    title: 'עדכון בדיקה 9.9.0',
    releaseNotes: ['שיפור ראשון', 'שיפור שני'],
    cssPatch: otaManifest.cssPatch,
    cssGlassPatch: otaManifest.cssGlassPatch,
    jsPatch: otaManifest.jsPatch
  };
  const interceptFn = (req, corsHeaders) => {
    if (req.url().indexOf('ota-manifest') !== -1) {
      req.respond({
        status: 200,
        headers: corsHeaders,
        contentType: 'application/json',
        body: JSON.stringify(mockRemoteManifest)
      });
      return true;
    }
    return false;
  };

  // Case 1: Auto-OTA ON in BROWSE -> silent install + Changelog-only modal; Case 3: Toggle Auto-OTA OFF -> manual popup
  {
    const { server, port } = await createStaticServer({ webRoot, sampleM3u: sampleM3u25 });
    try {
      const { page, pageErrors, consoleErrors } = await openConfiguredPage(browser, port, {
        width: 1920,
        height: 1080,
        waitMs: 1100,
        interceptFn,
        setupFn: (sampleUrl, cached) => {
          window.webOSSystem = { close: function () {} };
          localStorage.setItem('zenplay_iptv_sources_v2', JSON.stringify([{ id: 'src_1', name: 'Test', url: sampleUrl, enabled: true }]));
          localStorage.setItem('zenplay_iptv_cached_lineup_v2', JSON.stringify({ v: 2, updatedAt: Date.now(), discoveredEpgUrls: [], rawChannels: cached }));
        },
        setupArgs: ['http://127.0.0.1:' + port + '/sample.m3u', cached25]
      });
      await page.waitForFunction(() => window.app && window.app.mode === 'OTA', { timeout: 5000, polling: 50 });

      const silentCheck = await page.evaluate(() => ({
        autoEnabled: window.app.otaManager.isAutoOtaEnabled(),
        runningVer: window.app.otaManager.getRunningVersion(),
        mode: window.app.mode,
        modalVisible: !document.getElementById('ota-modal').classList.contains('hidden'),
        badgeText: document.getElementById('ota-modal-badge').textContent,
        titleText: document.getElementById('ota-modal-title').textContent,
        verCompare: document.getElementById('ota-version-compare').textContent,
        progressHidden: document.getElementById('ota-progress-wrap').classList.contains('hidden'),
        laterHidden: document.getElementById('btn-ota-later').classList.contains('hidden'),
        confirmText: document.getElementById('btn-ota-confirm').textContent
      }));
      assert.strictEqual(silentCheck.autoEnabled, true);
      assert.strictEqual(silentCheck.runningVer, '9.9.0', 'Silent auto-OTA must auto-install 9.9.0 without confirmation');
      assert.strictEqual(silentCheck.mode, 'OTA');
      assert.strictEqual(silentCheck.modalVisible, true);
      assert(silentCheck.badgeText.indexOf('מה חדש בגרסה') !== -1, 'Changelog badge expected, got ' + silentCheck.badgeText);
      assert(silentCheck.titleText.indexOf('המערכת התעדכנה אוטומטית') !== -1, 'Auto-update title expected, got ' + silentCheck.titleText);
      assert(silentCheck.verCompare.indexOf('שינויים וחידושים בגרסה') !== -1);
      assert.strictEqual(silentCheck.progressHidden, true);
      assert.strictEqual(silentCheck.laterHidden, true, '#btn-ota-later must be hidden on Changelog-only modal');
      assert.strictEqual(silentCheck.confirmText, 'המשך לצפייה (OK)');

      await page.keyboard.press('Enter');
      await new Promise((r) => setTimeout(r, 100));
      const afterDismiss = await page.evaluate(() => ({
        mode: window.app.mode,
        otaHidden: document.getElementById('ota-modal').classList.contains('hidden'),
        hasAutoFsTimer: Boolean(window.app._autoFullscreenTimer)
      }));
      assert(afterDismiss.mode === 'BROWSE' && afterDismiss.otaHidden && afterDismiss.hasAutoFsTimer, 'Dismissing Changelog must return to BROWSE and schedule Auto-Fullscreen: ' + JSON.stringify(afterDismiss));

      // Toggle Auto-OTA OFF in Settings -> About & check newer version 9.9.1 shows manual confirm popup
      mockRemoteManifest = Object.assign({}, mockRemoteManifest, { version: '9.9.1' });
      const manualRes = await page.evaluate(async () => {
        window.app.openSettingsModal();
        window.app.switchSettingsTab('about');
        document.getElementById('btn-toggle-auto-ota').click();
        const isOff = window.app.otaManager.isAutoOtaEnabled() === false;
        const pillText = document.querySelector('#btn-toggle-auto-ota .ui-toggle-pill').textContent;
        window.app.closeModals();
        await window.app.otaManager.checkForOTAUpdate(false);
        return {
          isOff,
          pillText,
          runningVer: window.app.otaManager.getRunningVersion(),
          mode: window.app.mode,
          laterHidden: document.getElementById('btn-ota-later').classList.contains('hidden'),
          confirmText: document.getElementById('btn-ota-confirm').textContent
        };
      });
      assert.strictEqual(manualRes.isOff, true);
      assert.strictEqual(manualRes.pillText, 'כבוי');
      assert.strictEqual(manualRes.runningVer, '9.9.0', 'With Auto-OTA off, 9.9.1 must wait for confirmation');
      assert.strictEqual(manualRes.mode, 'OTA');
      assert.strictEqual(manualRes.laterHidden, false, 'Manual OTA prompt must show #btn-ota-later');
      assert(manualRes.confirmText.indexOf('עדכן עכשיו') !== -1);

      assert.strictEqual(pageErrors.length, 0, 'Silent Auto-OTA suite pageerrors: ' + pageErrors.join('; '));
      assert.strictEqual(consoleErrors.length, 0, 'Silent Auto-OTA suite console errors: ' + consoleErrors.join('; '));
      await page.close();
    } finally {
      server.close();
    }
  }

  // Case 2: Deferral behind mandatory first-launch DISCLAIMER (no modal overlap!)
  {
    mockRemoteManifest = Object.assign({}, mockRemoteManifest, { version: '9.9.0' });
    const { server, port } = await createStaticServer({ webRoot, sampleM3u: sampleM3u25 });
    try {
      const { page, pageErrors } = await openConfiguredPage(browser, port, {
        width: 1920,
        height: 1080,
        waitMs: 1100,
        skipDisclaimerAccept: true,
        interceptFn,
        setupFn: (sampleUrl, cached) => {
          window.webOSSystem = { close: function () {} };
          localStorage.setItem('zenplay_iptv_sources_v2', JSON.stringify([{ id: 'src_1', name: 'Test', url: sampleUrl, enabled: true }]));
          localStorage.setItem('zenplay_iptv_cached_lineup_v2', JSON.stringify({ v: 2, updatedAt: Date.now(), discoveredEpgUrls: [], rawChannels: cached }));
        },
        setupArgs: ['http://127.0.0.1:' + port + '/sample.m3u', cached25]
      });
      await page.waitForFunction(() => Boolean(window.app && window.app.otaManager && window.app.otaManager._pendingChangelogInfo), { timeout: 5000, polling: 50 });

      const duringDisclaimer = await page.evaluate(() => ({
        mode: window.app.mode,
        disclaimerVisible: !document.getElementById('disclaimer-modal').classList.contains('hidden'),
        otaHidden: document.getElementById('ota-modal').classList.contains('hidden'),
        hasPending: Boolean(window.app.otaManager._pendingChangelogInfo),
        runningVer: window.app.otaManager.getRunningVersion(),
        acceptFocused: Boolean(window.app.currentFocusedEl && window.app.currentFocusedEl.id === 'btn-disclaimer-accept')
      }));
      assert(duringDisclaimer.mode === 'DISCLAIMER' && duringDisclaimer.disclaimerVisible && duringDisclaimer.otaHidden && duringDisclaimer.hasPending && duringDisclaimer.runningVer === '9.9.0' && duringDisclaimer.acceptFocused, 'Silent OTA during DISCLAIMER must defer changelog without overlapping or stealing focus: ' + JSON.stringify(duringDisclaimer));

      // Accepting disclaimer must immediately flush the Changelog-only modal
      await page.keyboard.press('Enter');
      await new Promise((r) => setTimeout(r, 120));
      const afterAccept = await page.evaluate(() => ({
        mode: window.app.mode,
        disclaimerHidden: document.getElementById('disclaimer-modal').classList.contains('hidden'),
        otaVisible: !document.getElementById('ota-modal').classList.contains('hidden'),
        laterHidden: document.getElementById('btn-ota-later').classList.contains('hidden')
      }));
      assert(afterAccept.mode === 'OTA' && afterAccept.disclaimerHidden && afterAccept.otaVisible && afterAccept.laterHidden, 'Accepting disclaimer must flush queued OTA Changelog modal: ' + JSON.stringify(afterAccept));

      assert.strictEqual(pageErrors.length, 0);
      await page.close();
    } finally {
      server.close();
    }
  }

  pass('silent-auto-ota-and-changelog-deferral', 'Silent auto-OTA install, Changelog-only UX, Auto-OTA toggle & DISCLAIMER deferral verified');
}

async function verifyLiveEpgSuite(browser, webRoot, repoRoot, sampleM3u25, cached25, pass) {
  const realEpgXml = fs.readFileSync(path.join(repoRoot, 'epg-il.xml'));
  const staleXml = '<?xml version="1.0" encoding="UTF-8"?><tv><channel id="ch428"><display-name>כאן 11</display-name></channel><programme start="20261124100000 +0200" stop="20261124110000 +0200" channel="ch428"><title>תוכנית ישנה שפגה</title></programme></tv>';

  const { server, port } = await createStaticServer({
    webRoot,
    sampleM3u: sampleM3u25,
    extraRoutes: {
      '/mock-stale-epg.xml': { contentType: 'application/xml; charset=utf-8', body: staleXml },
      '/mock-live-epg.xml': { contentType: 'application/xml; charset=utf-8', body: realEpgXml }
    }
  });
  try {
    const { page, pageErrors, consoleErrors } = await openConfiguredPage(browser, port, {
      width: 1920,
      height: 1080,
      interceptFn: (req) => {
        const u = req.url();
        if (u.indexOf('raw.githubusercontent.com/maorisraelii/iptv-webos/main/epg-il.xml') !== -1) {
          req.continue({ url: 'http://127.0.0.1:' + port + '/mock-stale-epg.xml' });
          return true;
        }
        if (u.indexOf('maorisraelii.github.io/iptv-webos/epg-il.xml') !== -1) {
          req.continue({ url: 'http://127.0.0.1:' + port + '/mock-live-epg.xml' });
          return true;
        }
        return false;
      },
      setupFn: (sampleUrl, cached) => {
        window.webOSSystem = { close: function () {} };
        const now = Date.now();
        localStorage.setItem('zenplay_iptv_sources_v2', JSON.stringify([{ id: 'src_1', name: 'Test', url: sampleUrl, enabled: true }]));
        localStorage.setItem('zenplay_iptv_cached_lineup_v2', JSON.stringify({ v: 2, updatedAt: now, discoveredEpgUrls: [], rawChannels: cached }));
        localStorage.setItem('zenplay_iptv_epg_cache_v491', JSON.stringify({
          url: [
            'https://raw.githubusercontent.com/maorisraelii/iptv-webos/main/epg-il.xml',
            'https://maorisraelii.github.io/iptv-webos/epg-il.xml',
            'https://gist.githubusercontent.com/maorisraelii/b4408ca1c31143ed2f50164629f53f1c/raw/epg-il.xml',
            'epg-il.xml'
          ].join('|'),
          updatedAt: now,
          entries: [['ch428', [{ s: now - 600000, e: now + 1800000, t: 'אתחול', d: '' }]]],
          aliases: [['כאן 11', 'ch428']]
        }));
      },
      setupArgs: ['http://127.0.0.1:' + port + '/sample.m3u', cached25]
    });

    const epgRes = await page.evaluate(async () => {
      const epg = window.app.epg;
      epg.clearCache();
      epg.setTargetChannels(null);
      await new Promise((resolve) => {
        epg.loadEPG(epg.DEFAULT_LIVE_EPG_URLS, () => resolve(), true);
      });
      const nowMs = Date.now();
      const loadedEpgUrl = epg.epgUrl;
      const loadedHasLive = epg.hasLiveCoverage(nowMs);
      const targets = [
        { label: 'Kan 11 ch428', id: 'ch428', epgId: 'ch428', name: 'כאן 11' },
        { label: 'Kan 11 il', id: 'כאן.11.il', epgId: 'כאן.11.il', name: 'כאן 11' },
        { label: 'Keshet 12 ch429', id: 'ch429', epgId: 'ch429', name: 'קשת 12' },
        { label: 'Keshet 12 il', id: 'קשת.il', epgId: 'קשת.il', name: 'קשת 12' },
        { label: 'Reshet 13 ch430', id: 'ch430', epgId: 'ch430', name: 'רשת 13' },
        { label: 'Reshet 13 il', id: 'רשת.il', epgId: 'רשת.il', name: 'רשת 13' },
        { label: 'Now 14 ch1119', id: 'ch1119', epgId: 'ch1119', name: 'ערוץ 14' },
        { label: 'Now 14 il', id: 'ערוץ.14.HD.il', epgId: 'ערוץ.14.HD.il', name: 'ערוץ 14' },
        { label: 'Sport 5 il', id: 'ספורט.5.שידור.חי.il', epgId: 'ספורט.5.שידור.חי.il', name: 'ספורט 5' },
        { label: 'Kan Chinuchit ch1171', id: 'ch1171', epgId: 'ch1171', name: 'כאן חינוכית' }
      ];
      const matched = targets.map((ch) => {
        const list = epg.findXmlProgrammesForChannel(ch) || [];
        const nn = epg.getNowNext(ch);
        return {
          label: ch.label,
          count: list.length,
          curTitle: nn && nn.current ? nn.current.title : null
        };
      });

      // Multi-alias sibling freshness preference & expired local cache refresh trigger
      const pad = (n) => (n < 10 ? '0' + n : '' + n);
      const fmtXmltv = (ms) => {
        const d = new Date(ms);
        return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + ' +0000';
      };
      const sibXml = '<?xml version="1.0"?><tv>' +
        '<channel id="ch428"><display-name>כאן 11</display-name></channel>' +
        '<channel id="כאן.11.il"><display-name>כאן 11</display-name></channel>' +
        '<programme start="' + fmtXmltv(nowMs - 1800000) + '" stop="' + fmtXmltv(nowMs + 1800000) + '" channel="ch428"><title>Live Sibling Kan11</title></programme>' +
        '<programme start="20261124100000 +0200" stop="20261124110000 +0200" channel="כאן.11.il"><title>Stale Sibling Kan11</title></programme>' +
        '</tv>';
      epg.parseXMLTV(sibXml);
      const sibMatch = epg.getNowNext({ id: 'כאן.11.il', epgId: 'כאן.11.il', name: 'כאן 11' });

      localStorage.setItem(epg.EPG_CACHE_KEY, JSON.stringify({
        url: epg.DEFAULT_LIVE_EPG_URLS.join('|'),
        updatedAt: nowMs - 60000,
        entries: [['ch428', [{ s: nowMs - 7200000, e: nowMs - 3600000, t: 'Ended Show', d: '' }]]],
        aliases: [['כאן 11', 'ch428']]
      }));
      const cacheLoaded = epg.loadFromLocalCache(epg.DEFAULT_LIVE_EPG_URLS.join('|'));

      return {
        epgUrl: loadedEpgUrl,
        expectedFallback: epg.DEFAULT_LIVE_EPG_URLS[1],
        hasLive: loadedHasLive,
        matched,
        sibTitle: sibMatch && sibMatch.current ? sibMatch.current.title : null,
        cacheLoaded,
        lastUpdatedAfterStaleCache: epg.lastUpdatedMs
      };
    });

    assert.strictEqual(epgRes.epgUrl, epgRes.expectedFallback, 'Stale feed [0] must trigger fallback to [1]: ' + epgRes.epgUrl);
    assert.strictEqual(epgRes.hasLive, true, 'Fallback real epg-il.xml must have live coverage');
    for (const m of epgRes.matched) {
      assert(m.count >= 10 && m.curTitle, 'Channel failed live EPG resolution: ' + JSON.stringify(m));
    }
    assert.strictEqual(epgRes.sibTitle, 'Live Sibling Kan11', 'Must prefer live sibling over stale sibling ID');
    assert.strictEqual(epgRes.cacheLoaded, true);
    assert.strictEqual(epgRes.lastUpdatedAfterStaleCache, 0, 'Expired cached EPG must zero lastUpdatedMs for immediate refresh');
    assert.strictEqual(pageErrors.length, 0, 'Live EPG suite pageerrors: ' + pageErrors.join('; '));
    assert.strictEqual(consoleErrors.length, 0, 'Live EPG suite console errors: ' + consoleErrors.join('; '));
    await page.close();
    pass('live-epg-fallback-and-multi-alias', 'Stale feed fallback, real epg-il.xml 10/10 Israeli channels, sibling freshness & cache expiry verified');
  } finally {
    server.close();
  }
}

async function verifyGlobalVodDiscoverySuite(browser, webRoot, sampleM3u25, cached25, pass) {
  const vodM3u = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="kan11" catchup="default" catchup-days="7" catchup-source="http://127.0.0.1:19999/catchup/kan11.m3u8?start={utc}&end={utcend}",כאן 11',
    'http://127.0.0.1:19999/live/1.m3u8',
    '#EXTINF:-1 tvg-id="keshet12" catchup="default" catchup-days="7" catchup-source="http://127.0.0.1:19999/catchup/keshet12.m3u8?start={utc}&end={utcend}",קשת 12',
    'http://127.0.0.1:19999/live/2.m3u8',
    '#EXTINF:-1 tvg-id="reshet13",רשת 13',
    'http://127.0.0.1:19999/live/3.m3u8'
  ].join('\n') + '\n';

  const { server, port } = await createStaticServer({ webRoot, sampleM3u: vodM3u });
  try {
    const { page, pageErrors, consoleErrors } = await openConfiguredPage(browser, port, {
      width: 1920,
      height: 1080,
      setupFn: (sampleUrl) => {
        window.webOSSystem = { close: function () {} };
        localStorage.setItem('zenplay_iptv_sources_v2', JSON.stringify([{ id: 'src_vod', name: 'VOD Test', url: sampleUrl, enabled: true }]));
      },
      setupArgs: ['http://127.0.0.1:' + port + '/sample.m3u']
    });

    await page.waitForFunction(() => window.app && window.app.allChannels && window.app.allChannels.length === 3, { timeout: 6000 });

    const setupRes = await page.evaluate(() => {
      const now = Date.now();
      const pad = (n) => (n < 10 ? '0' + n : '' + n);
      const fmt = (ms) => {
        const d = new Date(ms);
        return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + ' +0000';
      };
      const xml = '<?xml version="1.0" encoding="UTF-8"?><tv>' +
        '<channel id="kan11"><display-name>כאן 11</display-name></channel>' +
        '<channel id="keshet12"><display-name>קשת 12</display-name></channel>' +
        '<channel id="reshet13"><display-name>רשת 13</display-name></channel>' +
        '<programme start="' + fmt(now - 1800000) + '" stop="' + fmt(now + 1800000) + '" channel="kan11"><title>מהדורה מרכזית חי</title><desc>שידור חדשות</desc></programme>' +
        '<programme start="' + fmt(now - 2 * 86400000 - 3600000) + '" stop="' + fmt(now - 2 * 86400000) + '" channel="keshet12"><title>ארץ נהדרת פרק מיוחד</title><desc>סאטירה ובידור</desc></programme>' +
        '<programme start="' + fmt(now - 4 * 86400000 - 3600000) + '" stop="' + fmt(now - 4 * 86400000) + '" channel="reshet13"><title>הצינור ארכיון</title><desc>תוכנית לילה</desc></programme>' +
        '</tv>';
      window.app.epg.parseXMLTV(xml);
      window.app.epg.rebuildAliasesFromLoadedChannels();
      window.app.refreshVisibleEPGLabels();

      const vodBtn = document.getElementById('btn-open-vod');
      vodBtn.click();

      const initialCards = Array.from(document.querySelectorAll('#guide-programmes-list .vod-result-card'));
      document.getElementById('btn-vod-only-past').click();
      const pastOnlyLiveCount = document.querySelectorAll('#guide-programmes-list .vod-result-card.is-live').length;
      const pastOnlyTotal = document.querySelectorAll('#guide-programmes-list .vod-result-card').length;
      document.getElementById('btn-vod-only-past').click();

      return {
        mode: window.app.mode,
        scope: window.app.guideScope,
        guideVisible: !document.getElementById('guide-modal').classList.contains('hidden'),
        vodActiveBtn: document.getElementById('btn-guide-scope-vod').classList.contains('active'),
        searchBarVisible: !document.getElementById('vod-search-bar').classList.contains('hidden'),
        daysBarHidden: document.getElementById('guide-days-bar').classList.contains('hidden'),
        initialCount: initialCards.length,
        pastOnlyLiveCount,
        pastOnlyTotal
      };
    });
    assert.strictEqual(setupRes.mode, 'GUIDE');
    assert.strictEqual(setupRes.scope, 'vod');
    assert(setupRes.guideVisible && setupRes.vodActiveBtn && setupRes.searchBarVisible && setupRes.daysBarHidden, 'Global VOD UI state mismatch: ' + JSON.stringify(setupRes));
    assert(setupRes.initialCount >= 3, 'Global VOD must populate recent 7-day items immediately');
    assert.strictEqual(setupRes.pastOnlyLiveCount, 0, '#btn-vod-only-past must exclude live broadcasts');
    assert(setupRes.pastOnlyTotal >= 2, 'Past-only filter should retain past programmes');

    // Search by Hebrew title and trigger catchup VOD playback
    await page.evaluate(() => {
      const inp = document.getElementById('vod-search-input');
      inp.value = 'ארץ';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 200));
    const catchupRes = await page.evaluate(() => {
      const cards = document.querySelectorAll('#guide-programmes-list .vod-result-card');
      const count = cards.length;
      const title = cards[0] ? cards[0].querySelector('.vod-result-title').textContent : '';
      const vid = document.getElementById('tv-video');
      if (vid) vid.play = function () { return Promise.resolve(); };
      if (cards[0]) cards[0].click();
      return {
        count,
        title,
        selectedEpgId: window.app.selectedChannel ? window.app.selectedChannel.epgId : '',
        modeAfterClick: window.app.mode,
        catchupOriginStartMs: window.app.player ? window.app.player.catchupOriginStartMs : 0,
        toastText: (document.getElementById('toast-message') && document.getElementById('toast-message').textContent) || ''
      };
    });
    assert.strictEqual(catchupRes.count, 1, 'VOD search for "ארץ" should match 1 item');
    assert(catchupRes.title.indexOf('ארץ נהדרת') !== -1);
    assert.strictEqual(catchupRes.selectedEpgId, 'keshet12');
    assert.strictEqual(catchupRes.modeAfterClick, 'FULLSCREEN');
    assert(catchupRes.catchupOriginStartMs > 0, 'Catchup-capable channel must start catchup playback');

    // Non-catchup channel past programme falls back cleanly to live tuning with informative toast
    const nonCatchupRes = await page.evaluate(() => {
      window.app.exitFullscreen();
      window.app.openGuideModal('vod', 'הצינור');
      const cards = document.querySelectorAll('#guide-programmes-list .vod-result-card');
      const count = cards.length;
      if (cards[0]) cards[0].click();
      return {
        count,
        selectedEpgId: window.app.selectedChannel ? window.app.selectedChannel.epgId : '',
        modeAfterClick: window.app.mode,
        toastText: (document.getElementById('toast-message') && document.getElementById('toast-message').textContent) || ''
      };
    });
    assert.strictEqual(nonCatchupRes.count, 1);
    assert.strictEqual(nonCatchupRes.selectedEpgId, 'reshet13');
    assert.strictEqual(nonCatchupRes.modeAfterClick, 'FULLSCREEN');
    assert(nonCatchupRes.toastText.indexOf('Catchup/VOD') !== -1, 'Non-catchup VOD fallback toast missing: ' + nonCatchupRes.toastText);

    // Toggle back to channel scope
    const scopeBackRes = await page.evaluate(() => {
      window.app.exitFullscreen();
      window.app.openGuideModal('vod');
      document.getElementById('btn-guide-scope-channel').click();
      const res = {
        scope: window.app.guideScope,
        daysBarHidden: document.getElementById('guide-days-bar').classList.contains('hidden'),
        searchBarHidden: document.getElementById('vod-search-bar').classList.contains('hidden')
      };
      window.app.closeModals();
      return res;
    });
    assert(scopeBackRes.scope === 'channel' && !scopeBackRes.daysBarHidden && scopeBackRes.searchBarHidden);

    assert.strictEqual(pageErrors.length, 0, 'Global VOD suite pageerrors: ' + pageErrors.join('; '));
    assert.strictEqual(consoleErrors.length, 0, 'Global VOD suite console errors: ' + consoleErrors.join('; '));
    await page.close();
    pass('global-7day-vod-discovery', 'Global VOD trigger, search, past-only filter, catchup & fallback playback verified');
  } finally {
    server.close();
  }
}

async function verifyPowerSaveSleepSuite(browser, webRoot, sampleM3u25, cached25, pass) {
  const { server, port } = await createStaticServer({ webRoot, sampleM3u: sampleM3u25 });
  try {
    const { page, pageErrors, consoleErrors } = await openConfiguredPage(browser, port, {
      width: 1920,
      height: 1080,
      setupFn: (sampleUrl, cached) => {
        window.webOSSystem = { close: function () {} };
        window.__sleepHookCalls = [];
        window.AndroidTvHost = {
          setScreenSleepMode: function (asleep) {
            window.__sleepHookCalls.push(Boolean(asleep));
          }
        };
        localStorage.setItem('zenplay_iptv_sources_v2', JSON.stringify([{ id: 'src_1', name: 'Test', url: sampleUrl, enabled: true }]));
        localStorage.setItem('zenplay_iptv_cached_lineup_v2', JSON.stringify({ v: 2, updatedAt: Date.now(), discoveredEpgUrls: [], rawChannels: cached }));
      },
      setupArgs: ['http://127.0.0.1:' + port + '/sample.m3u', cached25]
    });

    // 1. Clean boot hidden state + default 4h + Settings persistence
    const initial = await page.evaluate(() => ({
      sleepTimeoutHours: window.app.getUiPrefs().sleepTimeoutHours,
      sleepModalHidden: document.getElementById('sleep-warning-modal').classList.contains('hidden'),
      powerSaveHidden: document.getElementById('power-save-screen').classList.contains('hidden'),
      voiceHidden: document.getElementById('voice-overlay').classList.contains('hidden')
    }));
    assert.strictEqual(initial.sleepTimeoutHours, 4, 'Default sleepTimeoutHours must be 4');
    assert(initial.sleepModalHidden && initial.powerSaveHidden && initial.voiceHidden, 'New v5.6.0 overlays must start hidden on clean boot');

    await page.evaluate(() => {
      window.app.openSettingsModal();
      window.app.switchSettingsTab('appearance');
      document.getElementById('btn-sleep-2').click();
      window.app.closeModals();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 600));
    const afterReloadHours = await page.evaluate(() => {
      window.__sleepHookCalls = [];
      window.__sleepHandoffCalls = 0;
      window.AndroidTvHost = {
        setScreenSleepMode: function (asleep) {
          window.__sleepHookCalls.push(Boolean(asleep));
        },
        handoffToTvScreensaver: function () {
          window.__sleepHandoffCalls += 1;
        }
      };
      return window.app.getUiPrefs().sleepTimeoutHours;
    });
    assert.strictEqual(afterReloadHours, 2, 'sleepTimeoutHours=2 must persist across reload');

    // 2. triggerSleepWarning(2) -> any-key cancels cleanly
    const warnCheck = await page.evaluate(() => {
      window.app.triggerSleepWarning(2);
      return {
        active: window.app._sleepWarningActive,
        visible: !document.getElementById('sleep-warning-modal').classList.contains('hidden'),
        secText: document.getElementById('sleep-countdown-sec').textContent,
        focusedId: window.app.currentFocusedEl ? window.app.currentFocusedEl.id : ''
      };
    });
    assert(warnCheck.active && warnCheck.visible && warnCheck.secText === '2' && warnCheck.focusedId === 'btn-sleep-stay-awake', 'Sleep warning modal state invalid: ' + JSON.stringify(warnCheck));

    await page.keyboard.press('ArrowDown');
    await new Promise((r) => setTimeout(r, 80));
    const cancelledCheck = await page.evaluate(() => ({
      active: window.app._sleepWarningActive,
      hidden: document.getElementById('sleep-warning-modal').classList.contains('hidden'),
      powerSave: window.app.isPowerSaveMode
    }));
    assert(!cancelledCheck.active && cancelledCheck.hidden && !cancelledCheck.powerSave, 'Any-key must cancel sleep warning');

    // 3. Countdown to 0 -> enters #power-save-screen, stops player, calls setPowerSaveMode(true) & AndroidTvHost(true), then hands off to TV screensaver
    await page.evaluate(() => {
      const vid = document.getElementById('tv-video');
      if (vid) vid.play = function () { return Promise.resolve(); };
      window.app.player.play(window.app.visibleChannels[0]);
      window.__sleepHookCalls = [];
      window.__sleepHandoffCalls = 0;
      window.app._powerSaveHandoffDelayMs = 150;
      window.app.triggerSleepWarning(1);
    });
    await page.waitForFunction(() => window.app && window.app.isPowerSaveMode === true, { timeout: 3500, polling: 50 });

    const asleepState = await page.evaluate(() => ({
      isPowerSaveMode: window.app.isPowerSaveMode,
      playerPowerSave: window.app.player._isPowerSaveMode,
      playerPlaying: window.app.player._isPlaying,
      blackoutVisible: !document.getElementById('power-save-screen').classList.contains('hidden'),
      warningHidden: document.getElementById('sleep-warning-modal').classList.contains('hidden'),
      sleepCalls: window.__sleepHookCalls.slice(),
      handoffBefore: window.__sleepHandoffCalls
    }));
    assert(asleepState.isPowerSaveMode && asleepState.playerPowerSave && !asleepState.playerPlaying && asleepState.blackoutVisible && asleepState.warningHidden, 'Power-save blackout state failed: ' + JSON.stringify(asleepState));
    assert.deepStrictEqual(asleepState.sleepCalls, [true]);

    await new Promise((r) => setTimeout(r, 260));
    const handoffAfter = await page.evaluate(() => window.__sleepHandoffCalls);
    assert.strictEqual(handoffAfter, 1, 'Expected handoffToTvScreensaver() after Stage-2 delay');

    // 4. Key wake resumes playback and restores player._isPowerSaveMode = false
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 100));
    const awakeState = await page.evaluate(() => ({
      isPowerSaveMode: window.app.isPowerSaveMode,
      playerPowerSave: window.app.player._isPowerSaveMode,
      blackoutHidden: document.getElementById('power-save-screen').classList.contains('hidden'),
      sleepCalls: window.__sleepHookCalls.slice()
    }));
    assert(!awakeState.isPowerSaveMode && !awakeState.playerPowerSave && awakeState.blackoutHidden, 'Wake from power-save failed: ' + JSON.stringify(awakeState));
    assert.deepStrictEqual(awakeState.sleepCalls, [true, false]);

    // 5. Waking before Stage-2 handoff delay cancels the handoff timer cleanly
    await page.evaluate(() => {
      window.app._powerSaveHandoffDelayMs = 260;
      window.app.enterPowerSaveMode();
    });
    await new Promise((r) => setTimeout(r, 60));
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 300));
    const finalHandoffCalls = await page.evaluate(() => window.__sleepHandoffCalls);
    assert.strictEqual(finalHandoffCalls, 1, 'Wake before delay must cancel TV screensaver handoff timer');

    assert.strictEqual(pageErrors.length, 0, 'Sleep suite pageerrors: ' + pageErrors.join('; '));
    assert.strictEqual(consoleErrors.length, 0, 'Sleep suite console errors: ' + consoleErrors.join('; '));
    await page.close();
    pass('power-save-sleep-timer', 'Default 4h, Settings persistence, 60s warning cancel, blackout sleep, Stage-2 TV screensaver handoff & key-wake verified');
  } finally {
    server.close();
  }
}

async function verifyVoiceCommandSuite(browser, webRoot, sampleM3u25, cached25, pass) {
  const { server, port } = await createStaticServer({ webRoot, sampleM3u: sampleM3u25 });
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

    // 1. V key fallback when Speech API & AndroidTvHost unavailable, then Escape closes cleanly
    await page.keyboard.press('KeyV');
    await new Promise((r) => setTimeout(r, 80));
    const unsupportedOverlay = await page.evaluate(() => ({
      mode: window.app.mode,
      visible: !document.getElementById('voice-overlay').classList.contains('hidden'),
      fallbackVisible: !document.getElementById('btn-voice-fallback-search').classList.contains('hidden')
    }));
    assert(unsupportedOverlay.mode === 'VOICE' && unsupportedOverlay.visible && unsupportedOverlay.fallbackVisible, 'V key unsupported voice overlay failed: ' + JSON.stringify(unsupportedOverlay));
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 80));
    assert.strictEqual(await page.evaluate(() => window.app.mode), 'BROWSE', 'Escape must close voice overlay');

    // 2. Web Speech Recognition interim -> final command tuning + XMLTV VOD voice search + remote commands
    const voiceRes = await page.evaluate(() => {
      const now = Date.now();
      const pad = (n) => (n < 10 ? '0' + n : '' + n);
      const fmt = (ms) => {
        const d = new Date(ms);
        return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + ' +0000';
      };
      const xml = '<?xml version="1.0" encoding="UTF-8"?><tv>' +
        '<channel id="kan11"><display-name>כאן 11</display-name></channel>' +
        '<channel id="keshet12"><display-name>קשת 12</display-name></channel>' +
        '<programme start="' + fmt(now - 3600000 * 5) + '" stop="' + fmt(now - 3600000 * 4) + '" channel="keshet12"><title>סדרת מופת מיוחדת</title></programme>' +
        '<programme start="' + fmt(now - 3600000 * 7) + '" stop="' + fmt(now - 3600000 * 6) + '" channel="kan11"><title>סדרת מופת ראשונה</title></programme>' +
        '</tv>';
      window.app.epg.parseXMLTV(xml);
      window.app.epg.rebuildAliasesFromLoadedChannels();

      let latestRec = null;
      window.SpeechRecognition = function () {
        latestRec = this;
        this.start = function () {};
        this.abort = function () {};
      };
      document.getElementById('btn-voice-command').click();
      const overlayVisibleDuringListen = !document.getElementById('voice-overlay').classList.contains('hidden');
      latestRec.onresult({
        resultIndex: 0,
        results: [{ isFinal: false, 0: { transcript: 'קשת' } }]
      });
      const interimText = document.getElementById('voice-transcript-text').textContent;
      latestRec.onresult({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: 'ערוץ 12' } }]
      });
      const tunedNumAfterSpeech = window.app.selectedChannel ? window.app.selectedChannel.number : 0;
      const overlayClosedAfterFinal = document.getElementById('voice-overlay').classList.contains('hidden');

      delete window.SpeechRecognition;

      const chNameRes = window.app.handleVoiceCommand('כאן');
      const chNameAfter = window.app.selectedChannel ? window.app.selectedChannel.name : '';

      const vodVoiceRes = window.app.handleVoiceCommand('סדרת מופת');
      const vodOpenedQuery = document.getElementById('vod-search-input') ? document.getElementById('vod-search-input').value : '';
      const vodScopeOpen = window.app.mode === 'GUIDE' && window.app.guideScope === 'vod';
      window.app.closeModals();

      const fsRes = window.app.handleVoiceCommand('מסך מלא');
      const modeInFs = window.app.mode;
      const exitRes = window.app.handleVoiceCommand('רשימה');
      const modeAfterExit = window.app.mode;

      window.app.openSettingsModal();
      window.app.switchSettingsTab('appearance');
      document.getElementById('btn-voicelang-en').click();
      window.app.closeModals();
      const hostLangs = [];
      window.AndroidTvHost = { startVoiceCommand: (l) => hostLangs.push(l) };
      document.getElementById('btn-voice-command').click();

      return {
        overlayVisibleDuringListen,
        interimText,
        tunedNumAfterSpeech,
        overlayClosedAfterFinal,
        chNameAction: chNameRes.action,
        chNameAfter,
        vodAction: vodVoiceRes.action,
        vodOpenedQuery,
        vodScopeOpen,
        fsAction: fsRes.action,
        modeInFs,
        exitAction: exitRes.action,
        modeAfterExit,
        hostLangs
      };
    });

    assert(voiceRes.overlayVisibleDuringListen && voiceRes.interimText === 'קשת' && voiceRes.tunedNumAfterSpeech === 12 && voiceRes.overlayClosedAfterFinal, 'SpeechRecognition interim/final flow failed: ' + JSON.stringify(voiceRes));
    assert(voiceRes.chNameAction === 'channel-name' && voiceRes.chNameAfter === 'כאן 11', 'Fuzzy Hebrew channel match failed: ' + JSON.stringify(voiceRes));
    assert(voiceRes.vodAction === 'vod-list' && voiceRes.vodScopeOpen && voiceRes.vodOpenedQuery === 'סדרת מופת', '7-day VOD voice search failed: ' + JSON.stringify(voiceRes));
    assert(voiceRes.fsAction === 'fullscreen' && voiceRes.modeInFs === 'FULLSCREEN' && voiceRes.exitAction === 'exit' && voiceRes.modeAfterExit === 'BROWSE', 'Voice remote commands failed: ' + JSON.stringify(voiceRes));
    assert.deepStrictEqual(voiceRes.hostLangs, ['en-US'], 'Voice language setting must flow to AndroidTvHost.startVoiceCommand');

    assert.strictEqual(pageErrors.length, 0, 'Voice suite pageerrors: ' + pageErrors.join('; '));
    assert.strictEqual(consoleErrors.length, 0, 'Voice suite console errors: ' + consoleErrors.join('; '));
    await page.close();
    pass('direct-voice-command-engine', 'V hotkey, SpeechRecognition interim/final, channel/VOD/remote voice commands & AndroidTvHost verified');
  } finally {
    server.close();
  }
}

async function verifyAppendDefaultSourceSuite(browser, webRoot, sampleM3u25, cached25, pass) {
  const defaultDemoM3u = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="demo1" group-title="ברירת מחדל",דמו ישראל 1',
    'http://127.0.0.1:19999/live/101.m3u8',
    '#EXTINF:-1 tvg-id="demo2" group-title="ברירת מחדל",דמו ישראל 2',
    'http://127.0.0.1:19999/live/102.m3u8'
  ].join('\n') + '\n';

  const { server, port } = await createStaticServer({ webRoot, sampleM3u: sampleM3u25.slice(0, 500) });
  try {
    const { page, pageErrors, consoleErrors } = await openConfiguredPage(browser, port, {
      width: 1920,
      height: 1080,
      interceptFn: (req, corsHeaders) => {
        if (req.url().indexOf('iptv-org.github.io/iptv/countries/il.m3u') !== -1) {
          req.respond({
            status: 200,
            headers: corsHeaders,
            contentType: 'text/plain; charset=utf-8',
            body: defaultDemoM3u
          });
          return true;
        }
        return false;
      },
      setupFn: (sampleUrl) => {
        window.webOSSystem = { close: function () {} };
        localStorage.setItem(
          'zenplay_iptv_sources_v2',
          JSON.stringify([{ id: 'user_custom_1', name: 'מקור פרטי שלי', url: sampleUrl, enabled: true }])
        );
      },
      setupArgs: ['http://127.0.0.1:' + port + '/sample.m3u']
    });

    await page.waitForFunction(() => window.app && window.app.allChannels && window.app.allChannels.length >= 2, { timeout: 6000 });

    const beforeCount = await page.evaluate(() => window.app.allChannels.length);

    await page.evaluate(() => {
      window.app.openSettingsModal();
      window.app.switchSettingsTab('sources');
      document.getElementById('btn-append-default-source').click();
    });
    await page.waitForFunction(
      (prev) => window.app && window.app.allChannels && window.app.allChannels.length > prev,
      { timeout: 6000 },
      beforeCount
    );

    const afterAppend = await page.evaluate(() => {
      const sources = window.app.store.sources.slice();
      const customPreserved = sources.some((s) => s.id === 'user_custom_1' && s.enabled === true);
      const defaultAdded = sources.some((s) => s.url.indexOf('iptv-org.github.io/iptv/countries/il.m3u') !== -1 && s.enabled === true);
      const renderedRows = document.querySelectorAll('#m3u-sources-list .source-item-row').length;

      // Disable default and click again -> re-enables without duplicating
      const defSrc = sources.find((s) => s.url.indexOf('iptv-org.github.io/iptv/countries/il.m3u') !== -1);
      if (defSrc) defSrc.enabled = false;
      document.getElementById('btn-append-default-source').click();
      const countAfterSecondClick = window.app.store.sources.length;
      const defReenabled = Boolean(defSrc && defSrc.enabled === true);
      window.app.closeModals();

      return {
        sourceCount: sources.length,
        customPreserved,
        defaultAdded,
        renderedRows,
        totalChannelsAfter: window.app.allChannels.length,
        countAfterSecondClick,
        defReenabled
      };
    });

    assert.strictEqual(afterAppend.sourceCount, 2, 'Should have 2 sources after non-destructive append');
    assert(afterAppend.customPreserved && afterAppend.defaultAdded, 'Custom source must stay preserved while default is appended');
    assert.strictEqual(afterAppend.renderedRows, 2);
    assert(afterAppend.totalChannelsAfter >= beforeCount + 2, 'Merged channels must include both custom and default sources');
    assert.strictEqual(afterAppend.countAfterSecondClick, 2, 'Re-clicking must not duplicate default source');
    assert.strictEqual(afterAppend.defReenabled, true, 'Disabled default source must re-enable cleanly');

    assert.strictEqual(pageErrors.length, 0, 'Append default source pageerrors: ' + pageErrors.join('; '));
    assert.strictEqual(consoleErrors.length, 0, 'Append default source console errors: ' + consoleErrors.join('; '));
    await page.close();
    pass('non-destructive-append-default-source', 'Default M3U source appended & re-enabled cleanly while preserving existing user sources');
  } finally {
    server.close();
  }
}

async function verifyInstantProgramEpisodesSuite(browser, webRoot, sampleM3u25, cached25, pass) {
  const catchupM3u = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="keshet12" catchup="default" catchup-days="7" catchup-source="http://127.0.0.1:19999/catchup/ch12/{utc}-{duration}.m3u8",קשת 12',
    'http://127.0.0.1:19999/live/ch12.m3u8',
    '#EXTINF:-1 tvg-id="kan11",כאן 11',
    'http://127.0.0.1:19999/live/ch11.m3u8'
  ].join('\n') + '\n';

  function fmtXmltvDate(ms) {
    const d = new Date(ms);
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    return (
      d.getUTCFullYear() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) +
      ' +0000'
    );
  }

  const nowMs = Date.now();
  const xmltvBody = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tv>',
    '<channel id="keshet12"><display-name>קשת 12</display-name></channel>',
    '<channel id="kan11"><display-name>כאן 11</display-name></channel>',
    '<programme start="' + fmtXmltvDate(nowMs - 6 * 86400000 - 3600000) + '" stop="' + fmtXmltvDate(nowMs - 6 * 86400000) + '" channel="keshet12"><title>ארץ נהדרת - עונה 22 פרק 9</title><desc>פרק מלפני 6 ימים</desc></programme>',
    '<programme start="' + fmtXmltvDate(nowMs - 3 * 86400000 - 3600000) + '" stop="' + fmtXmltvDate(nowMs - 3 * 86400000) + '" channel="keshet12"><title>ארץ נהדרת (שידור חוזר)</title><desc>שידור חוזר</desc></programme>',
    '<programme start="' + fmtXmltvDate(nowMs - 86400000 - 3600000) + '" stop="' + fmtXmltvDate(nowMs - 86400000) + '" channel="keshet12"><title>ארץ נהדרת - פרק 11</title><desc>פרק מאתמול</desc></programme>',
    '<programme start="' + fmtXmltvDate(nowMs - 15 * 60000) + '" stop="' + fmtXmltvDate(nowMs + 45 * 60000) + '" channel="keshet12"><title>ארץ נהדרת - פרק 12</title><desc>הפרק המשודר כעת</desc></programme>',
    '<programme start="' + fmtXmltvDate(nowMs - 1800000) + '" stop="' + fmtXmltvDate(nowMs + 1800000) + '" channel="kan11"><title>חדשות הערב - מהדורה</title><desc>מהדורה</desc></programme>',
    '</tv>'
  ].join('\n');

  const { server, port } = await createStaticServer({ webRoot, sampleM3u: catchupM3u });
  try {
    const { page, pageErrors, consoleErrors } = await openConfiguredPage(browser, port, {
      width: 1920,
      height: 1080,
      interceptFn: (req, corsHeaders) => {
        if (req.url().indexOf('epg-il.xml') !== -1 || req.url().indexOf('/test-ep-epg.xml') !== -1) {
          req.respond({
            status: 200,
            headers: corsHeaders,
            contentType: 'application/xml; charset=utf-8',
            body: xmltvBody
          });
          return true;
        }
        return false;
      },
      setupFn: (sampleUrl, epgUrl) => {
        window.webOSSystem = { close: function () {} };
        localStorage.setItem('zenplay_iptv_sources_v2', JSON.stringify([{ id: 'src_1', name: 'Test', url: sampleUrl, enabled: true }]));
        localStorage.setItem('zenplay_custom_epg_url', epgUrl);
      },
      setupArgs: ['http://127.0.0.1:' + port + '/sample.m3u', 'http://127.0.0.1:' + port + '/test-ep-epg.xml']
    });

    await page.waitForFunction(
      () => window.app && window.app.allChannels && window.app.allChannels.length === 2 && window.app.epg,
      { timeout: 8000 }
    );
    await page.evaluate((xml) => {
      if (window.app.epg.programmesByChannel) window.app.epg.programmesByChannel.clear();
      if (typeof window.app.epg.clearCaches === 'function') window.app.epg.clearCaches();
      window.app.epg.parseXMLTV(xml);
      window.app.epg.rebuildAliasesFromLoadedChannels();
      window.app.refreshVisibleEPGLabels();
    }, xmltvBody);

    const hiddenOnBoot = await page.evaluate(() =>
      document.getElementById('program-episodes-modal').classList.contains('hidden')
    );
    assert.strictEqual(hiddenOnBoot, true, '#program-episodes-modal must start hidden on clean boot');

    // 1. In BROWSE mode on Keshet 12, press Blue remote key (keyCode 406) -> opens 4 episodes immediately
    await page.evaluate(() => {
      window.app.focusedChannelIndex = 0;
      window.app.updateChannelFocusFast();
      const ev = new KeyboardEvent('keydown', { key: 'Blue', bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'keyCode', { get: function () { return 406; } });
      Object.defineProperty(ev, 'which', { get: function () { return 406; } });
      window.dispatchEvent(ev);
    });
    await new Promise((r) => setTimeout(r, 120));

    const modalState = await page.evaluate(() => {
      const titles = Array.from(document.querySelectorAll('#program-episodes-list .ep-title')).map((el) => el.textContent);
      return {
        mode: window.app.mode,
        modalVisible: !document.getElementById('program-episodes-modal').classList.contains('hidden'),
        seriesHeader: document.getElementById('program-episodes-title').textContent,
        countText: document.getElementById('program-episodes-count').textContent,
        titles: titles,
        focusedIndex: window.app.programEpisodesIndex
      };
    });
    assert.strictEqual(modalState.mode, 'PROGRAM_EPISODES', 'Blue key must immediately open PROGRAM_EPISODES');
    assert.strictEqual(modalState.modalVisible, true);
    assert(modalState.seriesHeader.indexOf('ארץ נהדרת') !== -1, 'Header should strip episode suffix to base title: ' + modalState.seriesHeader);
    assert.strictEqual(modalState.titles.length, 4, 'Must find all 4 episodes across last 7 days: ' + JSON.stringify(modalState.titles));
    assert(modalState.titles.every((t) => t.indexOf('חדשות') === -1), 'Must exclude unrelated shows');

    // 2. Navigate Down to episode #2 (yesterday's episode) and press Enter -> plays catchup start-over!
    await page.evaluate(() => {
      window.__lastPlayedCatchupTitle = '';
      const orig = window.app.player.playProgrammeStartOver.bind(window.app.player);
      window.app.player.playProgrammeStartOver = function (ch, prog) {
        window.__lastPlayedCatchupTitle = prog ? prog.title : '';
        return orig(ch, prog);
      };
    });
    await page.keyboard.press('ArrowDown');
    await new Promise((r) => setTimeout(r, 80));
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 120));

    const playRes = await page.evaluate(() => ({
      mode: window.app.mode,
      modalHidden: document.getElementById('program-episodes-modal').classList.contains('hidden'),
      catchupTitle: window.__lastPlayedCatchupTitle
    }));
    assert.strictEqual(playRes.mode, 'FULLSCREEN', 'Selecting past episode should start playback in FULLSCREEN');
    assert.strictEqual(playRes.modalHidden, true);
    assert.strictEqual(playRes.catchupTitle, 'ארץ נהדרת - פרק 11');

    // 3. In FULLSCREEN, press keyboard 'E' -> opens episodes modal again; Escape closes back to FULLSCREEN cleanly
    await page.keyboard.press('KeyE');
    await new Promise((r) => setTimeout(r, 120));
    const fsModalOpen = await page.evaluate(() => ({
      mode: window.app.mode,
      visible: !document.getElementById('program-episodes-modal').classList.contains('hidden'),
      len: window.app.programEpisodes.length
    }));
    assert.strictEqual(fsModalOpen.mode, 'PROGRAM_EPISODES');
    assert.strictEqual(fsModalOpen.visible, true);
    assert.strictEqual(fsModalOpen.len, 4);

    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 100));
    const afterEsc = await page.evaluate(() => ({
      mode: window.app.mode,
      hidden: document.getElementById('program-episodes-modal').classList.contains('hidden')
    }));
    assert.strictEqual(afterEsc.mode, 'FULLSCREEN');
    assert.strictEqual(afterEsc.hidden, true);

    assert.strictEqual(pageErrors.length, 0, 'Instant episodes pageerrors: ' + pageErrors.join('; '));
    assert.strictEqual(consoleErrors.length, 0, 'Instant episodes console errors: ' + consoleErrors.join('; '));
    await page.close();
    pass('instant-program-episodes-vod', '1-key Blue/E instant 7-day series episodes modal, suffix stripping, D-pad/Enter start-over & Esc restore verified');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('\n[FAIL]', err && err.stack ? err.stack : err);
  process.exit(1);
});
