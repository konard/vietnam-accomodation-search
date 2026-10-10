// Self-authored current/legacy/detail DOMs; no live bodies or contacts.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';
import { browserAdapterFor } from '../src/browser-adapters.js';
import { extractPageListings } from '../src/browser-collector.js';

const phase = process.argv[2] || 'after';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const commander = makeBrowserCommander({ page });
const card = (id) =>
  `<div class="good-item"><a class="good-item__img" href="/property/o${id}/"><img src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="220" height="150"><rect width="220" height="150" fill="#bbd8c4"/><text x="45" y="80">QA rental unit</text></svg>')}"></a><div><a class="good-item__desc" href="https://vietnam-real.estate/ru/property/o${id}/">Studio for rent in Nha Trang</a><div class="good-item__top--rental"><span class="good-item__price">₫ 13 000 000</span> / в месяц</div><div class="good-item__tags"><span class="tag"><i class="kit-icon bed"></i><p>1 Спальня</p></span><span class="tag"><i class="kit-icon bath"></i><p>1 Ванная</p></span><span class="tag"><i class="kit-icon ruler"></i><p>35 m²</p></span></div><a href="tel:+84900000000">QA contact</a></div><a class="good-item__logo" href="/agency/qa/"><img alt="QA agency" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></a></div>`;
try {
  await page.setContent(
    `<style>body{font:20px system-ui;background:#f4f7f5;color:#173d2b;padding:30px}.good-item{display:flex;gap:24px;margin:24px 0;background:white;padding:20px;border-radius:12px}.good-item__logo{display:none}.tag{display:inline-block;margin-right:20px}a{color:#173d2b}h1{font-size:26px}#status{padding:12px;background:#dae9df}</style><h1>Vietnam Real Estate · current rental-card fixture</h1><div id="status"></div><div class="catalogy__items-blocks">${card(123)}${card(124)}</div>`
  );
  const selectors = browserAdapterFor(
    'https://vietnam-real.estate/ru/rent/'
  ).selectors;
  const rows = await commander.evaluate(extractPageListings, 'web', selectors);
  await page.locator('#status').evaluate((element, count) => {
    element.textContent = `Structured rental cards: ${count} of 2`;
  }, rows.length);
  await mkdir('docs/screenshots/issue-163', { recursive: true });
  await page.screenshot({ path: `docs/screenshots/issue-163/${phase}.png` });
  console.log(JSON.stringify({ phase, cards: rows.length }));
  if (phase === 'after') {
    assert.equal(rows.length, 2);
    assert.notEqual(
      rows[0].attributes.propertyId,
      rows[1].attributes.propertyId
    );
    for (const row of rows) {
      assert.equal(row.attributes.bedrooms, 1);
      assert.equal(row.attributes.bathrooms, 1);
      assert.equal(row.photos.length, 1);
      assert.match(row.semantic.price, /в месяц/);
    }
    await page.setContent(
      `<main><div class="object"><div class="object-bottom"><h1>QA studio for rent in Nha Trang</h1><div class="object-bottom__badges"><span class="badge-decor"><i class="bed"></i>1 Спальня</span><span class="badge-decor"><i class="bath"></i>1 Ванная</span><span class="badge-decor"><i class="ruler"></i>35 m²</span></div></div><div class="object-bottom__top-boxs"><div class="price__top">₫ 13 000 000</div><div class="price__block"><p class="medium-font">/ в месяц</p></div></div><div class="gallery-simple__img-box"><img src="https://example.com/qa.jpg"></div></div><div class="catalogy__items-blocks">${card(999)}</div></main>`
    );
    const details = await commander.evaluate(extractPageListings, 'web', {
      ...selectors,
      // setContent keeps about:blank; force the detail path for this fixture.
      detailPath: '.*',
    });
    assert.equal(details.length, 1);
    assert.equal(details[0].photos.length, 1);
    assert.equal(details[0].attributes.bedrooms, 1);
    assert.equal(details[0].attributes.bathrooms, 1);
    assert.match(details[0].title, /QA studio/);
    console.log(JSON.stringify({ detailCards: details.length, pass: true }));
  }
} finally {
  await commander.destroy();
  await browser.close();
}
