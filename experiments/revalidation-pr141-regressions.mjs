#!/usr/bin/env node
// Sanitized acceptance examples, not a network test or CI gate. A nonzero
// exit reports an unresolved production defect, without changing the product.
import {
  classifyTelegramPost,
  formatSearchFailures,
  parseTelegramOffer,
  reconcileTelegramMaterials,
} from '../src/index.js';
import { rentalPriceOptions } from '../src/pricing.js';

const now = new Date('2026-10-07T00:00:00Z');
const poster =
  'Свободно: с 01/10/26\nЛокация: Центр Нячанга\nСтудия\n35 м2\nЦена: 13 млн VND / месяц.';
const message = (text) => ({
  id: 1,
  chatId: 'qa-pr141',
  date: now,
  text,
});
const photo = { ...message(''), mediaId: 'qa-photo' };
const ocr = await reconcileTelegramMaterials([photo], {
  ocr: () => Promise.resolve(poster),
  extract: (material) => parseTelegramOffer(material, { now }),
});
const map = await reconcileTelegramMaterials([photo], {
  ocr: () => Promise.resolve('Panorama Nha Trang\n€ 19 phút\n9,3 km'),
  extract: (material) => parseTelegramOffer(material, { now }),
});
const check = (issue, name, expected, actual) => ({
  issue,
  name,
  expected,
  actual,
  pass: Object.is(expected, actual),
});
const checks = [
  check(
    129,
    'poster-text-price-control',
    13000000,
    parseTelegramOffer(message(poster), { now })?.priceVnd
  ),
  check(
    129,
    'poster-has-monthly-rental-price-evidence',
    true,
    rentalPriceOptions(poster).some(
      (option) => option.rent && option.period === 'month'
    )
  ),
  check(
    129,
    'actual-poster-ocr-acceptance',
    13000000,
    ocr.accepted[0]?.priceVnd ?? null
  ),
  check(135, 'navigation-map-remains-unaccepted', 0, map.accepted.length),
  check(
    136,
    'studio-with-motorbike-reference-remains-eligible',
    true,
    classifyTelegramPost(
      'For rent: studio apartment in Nha Trang, 8 million VND/month. Ten minutes by motorbike.'
    ).eligible
  ),
  check(
    142,
    'incomplete-history-produces-user-visible-warning',
    true,
    Boolean(
      formatSearchFailures({
        summary: { failed: 0, succeeded: 1, total: 1, allFailed: false },
        outcomes: [
          {
            sourceId: 'telegram:qa-partial-history',
            status: 'offers',
            offers: 12,
            historyComplete: false,
          },
        ],
      })
    )
  ),
];
console.log(JSON.stringify({ mode: 'offline-diagnostic', checks }, null, 2));
process.exitCode = checks.every((result) => result.pass) ? 0 : 1;
