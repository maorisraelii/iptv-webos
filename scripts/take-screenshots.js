const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function run() {
  const outDir = path.resolve('docs/screenshots');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('Launching Chrome via puppeteer-core...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--allow-file-access-from-files',
      '--window-size=1920,1080'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  const localUrl = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');
  console.log('Navigating to ' + localUrl + ' ...');
  await page.goto(localUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for app initialization and boot splash dismissal (or initial channel fetch)
  await page.waitForFunction(() => Boolean(window.app), { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 3200));

  // Ensure realistic UI showcase state if headless network/video is unavailable
  await page.evaluate(() => {
    const app = window.app;
    if (!app) return;

    if (typeof app.hideBootSplash === 'function') {
      app.hideBootSplash();
    }
    const splash = document.getElementById('boot-splash');
    if (splash) splash.classList.add('hidden');

    if (!app.allChannels || app.allChannels.length === 0) {
      const sampleChannels = [
        { id: 'ch11', number: 11, name: 'כאן 11 HD', group: 'חדשות וציבורי', sourceName: 'שידור ישיר', logo: '' },
        { id: 'ch12', number: 12, name: 'קשת 12 HD', group: 'בידור וחדשות', sourceName: 'שידור ישיר', logo: '' },
        { id: 'ch13', number: 13, name: 'רשת 13 HD', group: 'בידור וחדשות', sourceName: 'שידור ישיר', logo: '' },
        { id: 'ch14', number: 14, name: 'עכשיו 14 HD', group: 'חדשות ואקטואליה', sourceName: 'שידור ישיר', logo: '' },
        { id: 'ch55', number: 55, name: 'ספורט 5 HD', group: 'ספורט', sourceName: 'שידור ישיר', logo: '' },
        { id: 'ch56', number: 56, name: 'ספורט 5 PLUS', group: 'ספורט', sourceName: 'שידור ישיר', logo: '' },
        { id: 'ch24', number: 24, name: 'ערוץ 24 מוזיקה', group: 'מוזיקה', sourceName: 'שידור ישיר', logo: '' },
        { id: 'ch9', number: 9, name: 'ערוץ 9', group: 'בידור', sourceName: 'שידור ישיר', logo: '' }
      ];
      app.allChannels = sampleChannels;
      app.applyChannelFilter();
      app.focusedChannelIndex = 0;
      app.selectedChannel = sampleChannels[0];
      app.previewedChannel = sampleChannels[0];
    }

    const firstCh = app.selectedChannel || app.visibleChannels[0];
    if (firstCh) {
      app.selectedChannel = firstCh;
      app.previewChannelInfo(firstCh);
      app.refreshVisibleEPGLabels();
    }

    // Hide spinner/error overlays and paint a subtle broadcast backdrop inside #video-surface for clean screenshots
    const loader = document.getElementById('video-loader');
    const errBadge = document.getElementById('video-error-badge');
    if (loader) loader.classList.add('hidden');
    if (errBadge) errBadge.classList.add('hidden');

    const surface = document.getElementById('video-surface');
    if (surface && !document.getElementById('screenshot-video-backdrop')) {
      const bg = document.createElement('div');
      bg.id = 'screenshot-video-backdrop';
      bg.style.cssText =
        'position:absolute;inset:0;z-index:1;pointer-events:none;' +
        'background:radial-gradient(circle at 30% 35%, rgba(56,189,248,0.28), transparent 55%),' +
        'radial-gradient(circle at 75% 65%, rgba(16,185,129,0.22), transparent 50%),' +
        'linear-gradient(135deg, #0b1528 0%, #102542 48%, #091326 100%);' +
        'display:flex;align-items:center;justify-content:center;';
      bg.innerHTML =
        '<div style="text-align:center;color:rgba(241,245,249,0.86);font-family:sans-serif;">' +
          '<div style="font-size:44px;font-weight:800;letter-spacing:1px;margin-bottom:10px;">' +
            (firstCh ? firstCh.name : 'IPTV Live TV') +
          '</div>' +
          '<div style="font-size:20px;color:#38bdf8;">HD LIVE BROADCAST PREVIEW</div>' +
        '</div>';
      surface.insertBefore(bg, surface.firstChild);
    }

    if (typeof app.exitFullscreen === 'function') app.exitFullscreen();
    if (typeof app.closeModals === 'function') app.closeModals();
    app.updateVideoSurfacePosition(true);
  });
  await new Promise((r) => setTimeout(r, 700));

  // 1. Main Split Browse Workspace
  console.log('Capturing browse-workspace.png...');
  await page.screenshot({ path: path.join(outDir, 'browse-workspace.png') });

  // 2. Fullscreen Info Bar OSD
  console.log('Capturing fullscreen-osd.png...');
  await page.evaluate(() => {
    const app = window.app;
    if (!app) return;
    app.enterFullscreen();
    app.showOSD(30000);
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(outDir, 'fullscreen-osd.png') });

  // 3. 7-Day Program Guide Modal
  console.log('Capturing guide-modal.png...');
  await page.evaluate(() => {
    const app = window.app;
    if (!app) return;
    app.exitFullscreen();
    app.openGuideModal();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(outDir, 'guide-modal.png') });

  // 4. Settings Modal (M3U Sources / Phone QR Sync)
  console.log('Capturing settings-modal.png...');
  await page.evaluate(() => {
    const app = window.app;
    if (!app) return;
    app.closeModals();
    app.openSettingsModal();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(outDir, 'settings-modal.png') });

  console.log('All 4 screenshots captured successfully into docs/screenshots/!');
  await browser.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('Screenshot generation error:', err);
  process.exit(1);
});
