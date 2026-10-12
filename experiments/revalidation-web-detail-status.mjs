// Finite, offline browser control; it never requests a source listing.
/* eslint local/no-changelog-comments: ["warn", {allowDatesInStrings:true}] -- Fixed dates are synthetic browser inputs. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { extractDetailStatus, detailStatus } from '../src/web-detail-status.js';

const fixtures = [
  {
    status: 'expired',
    html: '<main><h1>Studio for rent</h1><p>Tin đăng đã hết hạn trên Homedy.com.</p><p>Giá: 5 triệu/tháng</p><p>Ngày đăng: 12/01/2023</p><p>Ngày hết hạn: 12/04/2024</p><section class="related-listings">Đang cho thuê. Ngày hết hạn: 12/04/2030</section></main>',
  },
  {
    status: 'active',
    html: '<main><h1>Studio for rent</h1><p>Đang cho thuê</p><time itemprop="datePublished" datetime="2023-01-01"></time><aside>Tin đăng đã hết hạn</aside></main>',
  },
  {
    status: 'unknown',
    html: '<main><h1>Studio for rent</h1><p>Giá: 5 triệu/tháng</p><section class="recommendations">Available now</section></main>',
  },
  {
    status: 'rented',
    html: '<article><h1>Studio for rent</h1><p>Đã cho thuê.</p><p>Giá: 5 triệu/tháng</p><div class="similar">Available now</div></article>',
  },
];
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  await page.route('**/*', (route) => route.abort());
  for (const fixture of fixtures) {
    await page.setContent(fixture.html);
    const evidence = await page.evaluate(extractDetailStatus);
    const result = detailStatus(evidence, new Date('2026-10-12T00:00:00Z'));
    assert.equal(result.status, fixture.status);
    assert.ok(!evidence.text.includes('Available now'));
    if (fixture.status === 'expired') {
      assert.equal(result.publishedAt, '2023-01-12T00:00:00.000Z');
      assert.equal(result.expiresAt, '2024-04-12T00:00:00.000Z');
    }
  }
  console.log(
    JSON.stringify({
      offline: true,
      primaryStatusVerified: true,
      relatedContentExcluded: true,
    })
  );
} finally {
  await browser.close();
}
