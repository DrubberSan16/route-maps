// Renders the app icons of the web viewer (PWA), Android and iOS from logo.svg and logo-square.svg.
//
//   NODE_PATH="$(npm root -g)" node design-system/route-maps/brand/render-icons.mjs
//
// Needs the playwright package with its Chromium (npm install -g playwright && npx playwright
// install chromium). The PNG files are committed: run it again only when the logo changes.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const rounded = readFileSync(join(here, 'logo.svg'), 'utf8');
const square = readFileSync(join(here, 'logo-square.svg'), 'utf8');

const web = join(root, 'infrastructure', 'nginx', 'html', 'icons');
const android = join(root, 'mobile', 'android', 'app', 'src', 'main', 'res');
const ios = join(root, 'mobile', 'ios', 'Runner', 'Assets.xcassets', 'AppIcon.appiconset');

const targets = [
  // Web: browser tab and install prompt (transparent corners), maskable (full bleed), iOS home screen.
  [rounded, join(web, 'icon-192.png'), 192],
  [rounded, join(web, 'icon-512.png'), 512],
  [square, join(web, 'icon-maskable-512.png'), 512],
  [square, join(web, 'apple-touch-icon.png'), 180],
  [rounded, join(web, 'favicon-32.png'), 32],
  // Android before 8.0 (adaptive icons are vector drawables in res/drawable).
  ...[['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]
    .map(([density, size]) => [rounded, join(android, `mipmap-${density}`, 'ic_launcher.png'), size]),
  // Android launch screen (a bitmap cannot point to the adaptive icon): 96 dp.
  [rounded, join(android, 'drawable-xxhdpi', 'launch_logo.png'), 288],
  // iOS: opaque squares, the system rounds them.
  ...[['20x20@1x', 20], ['20x20@2x', 40], ['20x20@3x', 60], ['29x29@1x', 29], ['29x29@2x', 58], ['29x29@3x', 87],
    ['40x40@1x', 40], ['40x40@2x', 80], ['40x40@3x', 120], ['60x60@2x', 120], ['60x60@3x', 180],
    ['76x76@1x', 76], ['76x76@2x', 152], ['83.5x83.5@2x', 167], ['1024x1024@1x', 1024]]
    .map(([name, size]) => [square, join(ios, `Icon-App-${name}.png`), size]),
];

const browser = await chromium.launch();
for (const [svg, path, size] of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await page.screenshot({ path, omitBackground: svg === rounded });
  await page.close();
  console.log(`${size}px ${path.slice(root.length + 1)}`);
}
await browser.close();
