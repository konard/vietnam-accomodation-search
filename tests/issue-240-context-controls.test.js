import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { normalizeOffer, deduplicateOffers } from '../src/offers.js';
import { classifyTelegramPost } from '../src/telegram-pipeline.js';
import { BrowserCollector } from '../src/browser-collector.js';

it('preserves a concrete rental quote before an informational footer', () => {
  for (const footer of [
    'Market guide: how to rent in Nha Trang.',
    'Cleaning advice: how to clean your apartment.',
    'Мифы о студиях: сколько стоит аренда в Нячанге?',
  ]) {
    const text = `Studio for rent in Nha Trang. Price: 5 million VND/month.\n${footer}`;
    assert.equal(classifyTelegramPost(text).eligible, true);
    assert.notEqual(normalizeOffer({ text }).attributes.reviewRequired, true);
  }
  assert.equal(
    classifyTelegramPost(
      'Market guide: rental price myths. Studio for rent: 5 million VND/month.'
    ).eligible,
    false
  );
});

it('keeps another variant official link as an alternative to the chosen quote', () => {
  const lower = normalizeOffer({
    id: 'synthetic-lower',
    sourceId: 'synthetic-lower',
    title: 'Lower rent',
    text: 'Apartment for rent. 5 million VND/month.',
    url: 'https://example.com/lower-quote',
    identifiers: { property: 'synthetic-unit' },
  });
  const other = normalizeOffer({
    id: 'synthetic-other',
    sourceId: 'synthetic-other',
    title: 'Other rent',
    text: 'Apartment for rent. 18 million VND/month.',
    url: 'https://example.com/other-quote',
    officialUrl: 'https://example.com/other-official-quote',
    identifiers: { property: 'synthetic-unit' },
  });
  const [merged] = deduplicateOffers([lower, other]);
  assert.equal(merged.priceVnd, 5000000);
  assert.equal(merged.url, lower.url);
  assert.equal(merged.officialUrl, undefined);
  assert(merged.alternativeUrls.includes(other.officialUrl));
});

it('retains a known expired status beyond the fresh-detail request budget', async () => {
  const rows = Array.from({ length: 6 }, (_, index) => ({
    title: `Studio ${index} for rent`,
    text: 'Studio for rent. 5 million VND/month.',
    url: `https://homedy.com/cho-thue-studio-es${index + 1}`,
  }));
  const collector = new BrowserCollector();
  collector.collectListingRows = async () => rows;
  let requested = '';
  let navigations = 0;
  collector.navigate = async (_commander, url) => {
    requested = url;
    navigations++;
  };
  const commander = {
    evaluate: async (operation) =>
      operation.name === 'extractPageState'
        ? { status: 200, url: requested }
        : { text: 'Available now' },
  };
  await collector.detailStatuses.inspect(rows[5].url, async () => ({
    text: 'Tin đăng đã hết hạn.',
  }));
  const offers = await collector.collectSource(
    commander,
    { id: 'synthetic', type: 'web', searchUrl: 'https://homedy.com/results' },
    '',
    { VND: 1 }
  );
  assert.equal(navigations, 5);
  assert.equal(offers[5].attributes.availableNow, false);
  assert.equal(offers[5].attributes.detailStatus, 'expired');
});
