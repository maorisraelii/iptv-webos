const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function run() {
  console.log('Launching Chrome via puppeteer-core...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // 1. Render App Icons
  console.log('Rendering app icons from SVG...');
  await page.goto(`file:///${path.resolve('assets/icon.svg').replace(/\\/g, '/')}`);
  
  await page.setViewport({ width: 130, height: 130 });
  await page.screenshot({ path: 'largeIcon.png' });
  console.log('Saved largeIcon.png (130x130)');

  await page.setViewport({ width: 80, height: 80 });
  await page.screenshot({ path: 'icon.png' });
  console.log('Saved icon.png (80x80)');

  // 2. Load live GitHub Pages deployment
  await page.setViewport({ width: 1920, height: 1080 });
  console.log('Navigating to live web app at https://maorisraelii.github.io/iptv-webos/ ...');
  await page.goto('https://maorisraelii.github.io/iptv-webos/', { waitUntil: 'networkidle2', timeout: 30000 });

  await new Promise(r => setTimeout(r, 3000));

  // Screenshot 1: Browse & Live Preview
  console.log('Capturing Screenshot 1: Live TV Browse & Preview...');
  await page.screenshot({ path: 'screenshots/1-browse-live.png' });

  // Screenshot 2: Category Rail Opened
  console.log('Capturing Screenshot 2: Category Rail...');
  await page.evaluate(() => {
    if (window.app) window.app.openCategoryRail();
  });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: 'screenshots/2-category-rail.png' });

  // Screenshot 3: Settings Modal with Virtual Keyboard
  console.log('Capturing Screenshot 3: Settings Modal...');
  await page.evaluate(() => {
    if (window.app) {
      window.app.closeCategoryRail();
      window.app.openSettingsModal();
    }
  });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: 'screenshots/3-settings-modal.png' });

  // Screenshot 4: Search Modal
  console.log('Capturing Screenshot 4: Search Modal...');
  await page.evaluate(() => {
    if (window.app) {
      window.app.closeModals();
      window.app.openSearchModal();
    }
  });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: 'screenshots/4-search-modal.png' });

  console.log('All screenshots captured successfully!');
  await browser.close();
  process.exit(0);
}

run().catch(err => {
  console.error('Screenshot generation error:', err);
  process.exit(1);
});
