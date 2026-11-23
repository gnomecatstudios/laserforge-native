/**
 * Renders PWA icons and the social preview image from the logo source with headless Chromium.
 * Run after changing public/logo-source.png or the README screenshot: `pnpm icons`.
 */
import { chromium } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const logo = `data:image/png;base64,${readFileSync(`${root}public/logo-source.png`).toString('base64')}`;
const mark = (size) => `<img src="${logo}" width="${size}" height="${size}" alt="Laser Forge">`;
const screenshot = `${root}docs/screenshot.png`;

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(html, width, height, out, transparent = true) {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">${html}</body></html>`,
  );
  await page.evaluate(() => Promise.all(Array.from(document.images, (img) => img.decode())));
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({
    ...(out ? { path: `${root}${out}` } : {}),
    omitBackground: transparent,
  });
  if (out) console.log('wrote', out);
  return png;
}

await render(mark(512), 512, 512, 'public/mark.png');
await render(mark(192), 192, 192, 'public/icon-192.png');
await render(mark(512), 512, 512, 'public/icon-512.png');
await render(mark(180), 180, 180, 'public/apple-touch-icon.png');

// Native icon containers reuse the same rendered PNGs; no separate artwork to drift.
const native = new Map();
for (const size of [16, 32, 48, 64, 128, 256, 512]) {
  native.set(size, await render(mark(size), size, size));
}
const sizes = [16, 32, 48, 64, 128, 256];
const icoHeader = Buffer.alloc(6 + sizes.length * 16);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(sizes.length, 4);
let offset = icoHeader.length;
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16;
  icoHeader[entry] = icoHeader[entry + 1] = size === 256 ? 0 : size;
  icoHeader.writeUInt16LE(1, entry + 4);
  icoHeader.writeUInt16LE(32, entry + 6);
  icoHeader.writeUInt32LE(native.get(size).length, entry + 8);
  icoHeader.writeUInt32LE(offset, entry + 12);
  offset += native.get(size).length;
}
writeFileSync(
  `${root}public/favicon.ico`,
  Buffer.concat([icoHeader, ...sizes.map((size) => native.get(size))]),
);
console.log('wrote public/favicon.ico');
// Keep the complete source image inside the maskable icon's circular safe zone.
await render(
  `<div style="width:512px;height:512px;background:#0E0F11;display:flex;align-items:center;justify-content:center">${mark(384)}</div>`,
  512,
  512,
  'public/icon-maskable-512.png',
  false,
);

const shot = existsSync(screenshot)
  ? `data:image/png;base64,${readFileSync(screenshot).toString('base64')}`
  : null;
const fonts = `${root}node_modules/@fontsource/geist-sans/files/geist-sans-latin-600-normal.woff2`;
await render(
  `<style>@font-face{font-family:G;src:url(file://${fonts})}</style>
  <div style="width:1200px;height:630px;background:#0E0F11;color:#ECEDEE;font-family:G,system-ui;display:flex;overflow:hidden;position:relative">
    <div style="padding:72px 0 0 72px;display:flex;flex-direction:column;gap:28px;width:560px;z-index:1">
      <div style="display:flex;align-items:center;gap:18px">${mark(72)}<span style="font-size:52px;font-weight:600;letter-spacing:-0.045em">Laser Forge</span></div>
      <div style="font-size:64px;line-height:1.02;font-weight:600;letter-spacing:-0.05em">Your laser,<br>one tab away.</div>
      <div style="font-size:24px;line-height:1.4;color:#C9CCCF">Free, open source laser control for GRBL machines. Runs in your browser and works offline.</div>
    </div>
    ${shot ? `<img src="${shot}" style="position:absolute;left:640px;top:70px;width:900px;border-radius:14px;border:1px solid #2A2E33">` : ''}
  </div>`,
  1200,
  630,
  'public/og-image.png',
  false,
);

await browser.close();
