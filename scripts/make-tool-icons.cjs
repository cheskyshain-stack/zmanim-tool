// Rebuild only the Calendar and Seating artwork, using the Playwright/Chrome test setup.
// The original Zmanim and admin icons still belong to make-icons.py.
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/chromium'),
    headless: true,
  });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const tool of ['calendar', 'seats']) {
      const directory = path.join(root, 'icons', tool), source = fs.readFileSync(path.join(directory, 'source.svg'), 'utf8');
      const variants = [
        ['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180],
        ['icon-maskable-512.png', 512, 'maskable'], ['icon-maskable-192.png', 192, 'maskable'],
        ['favicon-32.png', 32, 'mark'], ['favicon-16.png', 16, 'mark'],
      ];
      for (const [name, size, variant] of variants) {
        let svg = source;
        // All lettering stays inside Android's central 80%-diameter safe circle.
        if (variant === 'maskable') svg = svg.replace('<g id="artwork">', '<g id="artwork" transform="translate(46.08 46.08) scale(.82)">');
        if (variant === 'mark') svg = svg.replace('viewBox="0 0 512 512"', 'viewBox="104 48 304 304"').replace(/<g id="wordmark"[\s\S]*?<\/g>/, '');
        svg = svg.replace('width="512" height="512"', `width="${size}" height="${size}"`);
        await page.setViewportSize({ width: size, height: size });
        await page.setContent(`<style>html,body{margin:0;background:#071433}svg{display:block}</style>${svg}`);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: path.join(directory, name) });
      }
      console.log(`Built ${tool}: ${variants.length} icon sizes and variants`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
