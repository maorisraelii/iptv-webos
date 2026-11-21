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
    return Boolean(link && !link.disabled && link.sheet);
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

    window.app.closeModals();

    out.tabs.performance = {
      resetOnSwitch,
      clientH: perfEl.clientHeight,
      scrollH: perfEl.scrollHeight,
      overflows: perfEl.scrollHeight > perfEl.clientHeight,
      maxScrollAfterDown,
      scrollAfterUp,
      seenBottomRefreshBtn,
      afterPageDown,
      channelUnchangedOnPageDown: prevChId === chAfterPageDown,
      badItems: perfVis.filter((v) => !v.topOk || !v.bottomOk)
    };

    return out;
  }, theme);

  // Also test real mouse wheel scrolling in #settings-tab-performance
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
  await page.evaluate(() => window.app.closeModals());

  result.tabs.performance.wheelScrollTop = wheelScrollTop;
  return result;
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

        // Live theme toggle Classic <-> Glass & back to Classic
        const themeCheck = await page.evaluate(() => {
          window.app.applyTheme('glass', true);
          const gActive = document.documentElement.classList.contains('theme-glass');
          const gLinkOn = !document.getElementById('theme-css-glass').disabled;
          const cLinkOff = document.getElementById('theme-css-classic').disabled;
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

        // Settings Modal Scroll Suite on 1920x1080 Classic & Glass
        for (const t of ['classic', 'glass']) {
          const scrollRes = await verifySettingsScrollingForTheme(page, t);
          assert(scrollRes.tabs.channels.scrollTopAfterDown > 0, t + ' channels editor list did not scroll on ArrowDown');
          assert(scrollRes.tabs.channels.allVisibleInViewport, t + ' channels editor focused item outside viewport');
          assert.strictEqual(scrollRes.tabs.performance.resetOnSwitch, 0, t + ' perf tab scrollTop did not reset to 0');
          assert.strictEqual(scrollRes.tabs.performance.badItems.length, 0, t + ' perf tab clipped focused item(s): ' + JSON.stringify(scrollRes.tabs.performance.badItems));
          if (scrollRes.tabs.performance.overflows) {
            assert(scrollRes.tabs.performance.maxScrollAfterDown > 0, t + ' perf tab failed to scroll down when overflowing');
            assert(scrollRes.tabs.performance.wheelScrollTop > 0, t + ' perf tab failed to scroll via mouse wheel');
            assert(scrollRes.tabs.performance.afterPageDown > 0, t + ' perf tab failed to scroll via PageDown');
          }
          assert.strictEqual(scrollRes.tabs.performance.scrollAfterUp, 0, t + ' perf tab failed to scroll back to top');
          assert.strictEqual(scrollRes.tabs.performance.seenBottomRefreshBtn, true, t + ' bottom refresh/clear buttons not reachable');
          assert.strictEqual(scrollRes.tabs.performance.channelUnchangedOnPageDown, true, t + ' PageDown inside modal must not zap TV channel');
          assert(scrollRes.tabs.sources.allVisibleInViewport, t + ' sources tab focused item outside viewport');
          pass('settings-scroll-1080p-' + t, 'All Settings tabs scroll cleanly via D-pad, PageDown, and Mouse Wheel');
        }

        // Settings Modal Scroll Suite on 1280x720 (CSS zoom = 1280/1920)
        await page.setViewport({ width: 1280, height: 720 });
        await page.evaluate(() => {
          if (typeof window.applyTvViewportScale === 'function') window.applyTvViewportScale();
        });
        await new Promise((r) => setTimeout(r, 150));
        const zoomScroll = await verifySettingsScrollingForTheme(page, 'glass');
        assert.strictEqual(zoomScroll.tabs.performance.badItems.length, 0, '720p zoomed perf tab clipped items: ' + JSON.stringify(zoomScroll.tabs.performance.badItems));
        assert(zoomScroll.tabs.channels.scrollTopAfterDown > 0, '720p zoomed channel editor must scroll');
        pass('settings-scroll-720p-zoomed', 'Settings scroll math accurate under CSS zoom (1280x720)');

        await page.close();
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
            },
            setupArgs: ['http://127.0.0.1:' + port + '/sample.m3u', cached25, isSafe]
          });

          const atv = await page.evaluate(() => ({
            isAtv: window.__IPTV_IS_ANDROID_TV === true,
            readyCalls: window.__testReadyCalls,
            domRows: document.querySelectorAll('#channel-list .channel-item').length,
            splashHidden: document.getElementById('boot-splash').classList.contains('hidden')
          }));
          assert.strictEqual(atv.isAtv, true, 'Android TV flag not detected');
          assert(atv.readyCalls >= 1, 'AndroidTvHost.notifyAppReady() must be invoked');
          assert.strictEqual(atv.domRows, 25, 'Android TV must render all 25 channels');
          assert.strictEqual(atv.splashHidden, true, 'Android TV boot splash must dismiss');

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

          return {
            domRows: document.querySelectorAll('#channel-list .channel-item').length,
            hasRowEls: Array.isArray(app._channelRowEls),
            hasPreviewCache: Boolean(app._previewHeaderCache),
            hasOsdCache: Boolean(app._osdLastCache)
          };
        }, otaManifest.jsPatch);

        assert.strictEqual(synthRes.domRows, 5, 'Synthetic legacy OTA upgrade must keep all 5 channels');
        assert.strictEqual(synthRes.hasRowEls, true, '_channelRowEls must be backfilled');
        assert.strictEqual(synthRes.hasPreviewCache, true, '_previewHeaderCache must be backfilled');
        assert.strictEqual(synthRes.hasOsdCache, true, '_osdLastCache must be backfilled');
        assert.strictEqual(pageErrors.length, 0, 'Synthetic OTA pageerrors: ' + pageErrors.join('; '));
        assert.strictEqual(consoleErrors.length, 0, 'Synthetic OTA console errors: ' + consoleErrors.join('; '));
        await page.close();
        pass('synthetic-legacy-ota-upgrade', 'Legacy instance missing v5.2 caches upgraded cleanly with 0 errors');
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
                cssGlassPatch: m.cssGlassPatch,
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
          assert.strictEqual(pageErrors.length, 0, tag + ' OTA cold boot pageerrors: ' + pageErrors.join('; '));
          assert.strictEqual(consoleErrors.length, 0, tag + ' OTA cold boot console errors: ' + consoleErrors.join('; '));
          await page.close();
          pass('git-ota-cold-boot-' + tag, tag + ' + cached EPG + v' + otaManifest.version + ' OTA kept all 3 channels with 0 errors');
        }

        // 5b: Live performOTAUpdate() from old tag -> v5.2.1
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
          const liveRes = await page.evaluate(() => ({
            domRows: document.querySelectorAll('#channel-list .channel-item').length,
            runningVer: window.app.otaManager.getRunningVersion()
          }));
          assert.strictEqual(liveRes.domRows, 4, tag + ' live OTA install lost channels');
          assert.strictEqual(liveRes.runningVer, otaManifest.version, tag + ' live OTA did not activate version');
          assert.strictEqual(pageErrors.length, 0, tag + ' live OTA pageerrors: ' + pageErrors.join('; '));
          assert.strictEqual(consoleErrors.length, 0, tag + ' live OTA console errors: ' + consoleErrors.join('; '));
          await page.close();
          pass('git-ota-live-install-' + tag, tag + ' live OTA upgrade preserved 4 channels with 0 errors');
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
