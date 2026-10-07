// Public synthetic poster: verifies the installed engine, never private media.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { recognizeRentalPhoto } from '../src/telegram-ocr.js';
import { parsePrice } from '../src/pricing.js';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 600 },
  });
  await page.setContent(`<!doctype html><html><body style="margin:60px;font:48px Arial;background:white;color:black">
    <p>FOR RENT</p><p>Studio in Nha Trang</p><p>13 million VND / month</p>
    </body></html>`);
  const result = await recognizeRentalPhoto(await page.screenshot());
  assert.equal(result.status, 'extracted');
  assert.equal(result.pageSegmentation, 11);
  assert.equal(parsePrice(result.text)?.amount, 13000000);
  process.stdout.write(
    'Synthetic poster: Tesseract psm 11 extracted 13 million VND/month.\n'
  );
} finally {
  await browser.close();
}
