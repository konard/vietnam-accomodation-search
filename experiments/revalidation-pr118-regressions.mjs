#!/usr/bin/env node
/* eslint local/no-changelog-comments: ["warn", { "allowDatesInStrings": true }] -- Dates are diagnostic inputs and expected output data. */

// Offline diagnostic examples independently reduced from live audit findings.
// Exit 1 means a reported defect remains, not that the fixture unit gate failed.
import { pathToFileURL } from 'node:url';
import {
  assembleTelegramAlbums,
  classifyTelegramPost,
  parseListingText,
  parseTelegramOffer,
} from '../src/index.js';
import { missingExpectedDetails } from './telegram-accommodation-audit-lib.mjs';
import { auditTelegramBatch } from './telegram-live-audit-runtime.mjs';

const NOW = new Date('2026-10-07T00:00:00Z');
const HOUSE = `СДАЁТСЯ ДОМ В НЯЧАНГЕ.
5 отдельные спальни / 3 санузла.
1415$ в месяц.
Аренда от 1 года.`;
const FLOOR_VARIANTS = `Квартира с 1 спальней в Нячанге.
О квартире:
1 Спальня
40 м²
Балкон
Условия аренды:
Цена: 13 млн VND / месяц (первый этаж)
При аренде квартиры на 2–3 этаже: 13.5 млн VND / месяц
Депозит: 1 месяц.`;

function result(issue, name, expected, actual) {
  return {
    issue,
    name,
    expected,
    actual: actual ?? null,
    pass: actual === expected,
  };
}

function fieldNotationChecks(parse) {
  const mapText = 'Sample Villa\n€ 19 phút - 9,3 km\nAdd stop. Save.';
  const mapOffer = classifyTelegramPost(mapText).eligible
    ? parse(mapText)
    : undefined;
  return [
    result(
      132,
      'styled-unicode-rent-preserves-amount',
      18000000,
      parse('For rent: 1 bedroom apartment in Nha Trang.\n𝟏𝟖𝐦𝐢𝐥𝐥𝐢𝐨𝐧 𝐕𝐍𝐃/𝐦𝐨𝐧𝐭𝐡')
        ?.priceVnd
    ),
    result(
      133,
      'ordinal-floor-does-not-consume-next-bedroom-count',
      17,
      parseListingText(
        'For rent: 3-bedroom apartment in Nha Trang.\nUnit 1702 is on 17th floor\n3 bedrooms 2 bathrooms'
      ).attributes.floor
    ),
    result(
      134,
      'named-month-availability-date',
      '2026-10-09',
      parse(
        'For rent: apartment in Nha Trang, 9 million VND/month. Available on 9th October.'
      )?.attributes.availableFrom
    ),
    result(
      134,
      'iso-availability-date',
      '2026-10-09',
      parse(
        'For rent: apartment in Nha Trang, 9 million VND/month. Available from 2026-10-09.'
      )?.attributes.availableFrom
    ),
    result(
      135,
      'map-travel-duration-is-not-monthly-rent',
      null,
      mapOffer?.price?.amount ?? null
    ),
  ];
}

function diagnosticControls(parse) {
  return [
    result(
      null,
      'actual-rental-request-stays-excluded',
      false,
      classifyTelegramPost('Ищу квартиру в Нячанге, бюджет 8 млн VND.').eligible
    ),
    result(
      null,
      'actual-other-city-rental-stays-excluded',
      false,
      classifyTelegramPost(
        'Сдаётся квартира. Локация: Дананг. Цена: 8 млн VND / месяц.'
      ).eligible
    ),
    result(
      null,
      'plain-ascii-rent-control',
      18000000,
      parse('For rent: 1 bedroom apartment in Nha Trang.\n18 million VND/month')
        ?.priceVnd
    ),
    result(
      null,
      'numeric-day-first-availability-control',
      '2026-10-09',
      parse(
        'For rent: apartment in Nha Trang, 9 million VND/month. Available on 09/10/2026.'
      )?.attributes.availableFrom
    ),
    result(
      null,
      'genuine-apartment-with-motorbike-travel-reference',
      true,
      classifyTelegramPost(
        'For rent: studio apartment in Nha Trang, 8 million VND/month. 10 minutes to the beach by motorbike.'
      ).eligible
    ),
  ];
}

export async function reproducePr118Regressions() {
  const house = parseListingText(HOUSE);
  const floorVariants = parseListingText(FLOOR_VARIANTS);
  const floorText =
    'Сдаётся студия в Нячанге. Высокий этаж. 50m². Аренда 8 млн VND/месяц.';
  const depositText =
    'For rent: studio in Nha Trang, 8 million VND/month.\nDeposit: 20 million VND.';
  const parse = (text) => parseTelegramOffer({ date: NOW, text }, { now: NOW });
  const seekers =
    'Сдаётся вилла в Нячанге. Подходит для семей, ищущих тихое место. Цена: 70 млн VND / месяц.';
  const view =
    'Сдаётся дом в Нячанге. Локация: Север Нячанга. Вид на Далат. Цена: 30 млн VND / месяц.';
  const historical = parseTelegramOffer(
    {
      date: new Date('2026-07-10T00:00:00Z'),
      text: 'For rent: apartment in Nha Trang, 8 million VND/month.',
    },
    { now: NOW }
  );
  const ledger = await auditTelegramBatch(
    [
      {
        id: 1,
        chatId: 'qa-ledger',
        date: NOW,
        text: 'For rent: apartment in Nha Trang, 8 million VND/month.\nBedrooms: 2.',
      },
    ],
    { now: NOW, sourceAlias: 'qa-ledger' }
  );
  const secondCaption = 'For rent: apartment B in Nha Trang, 525 USD/month.';
  const multiListingAlbum = assembleTelegramAlbums([
    {
      id: 1,
      chatId: 'qa-album',
      date: NOW,
      groupedId: 'two-properties',
      text: 'For rent: apartment A in Nha Trang, 655 USD/month.',
    },
    {
      id: 2,
      chatId: 'qa-album',
      date: NOW,
      groupedId: 'two-properties',
      text: secondCaption,
    },
  ])[0];
  const propertyId = parseListingText(
    'Квартира в Нячанге. Аренда 655 USD/месяц.\nКод объекта: 414–75414.'
  ).attributes.propertyId;
  return {
    mode: 'offline-diagnostic',
    independentExamples: true,
    checks: [
      result(
        119,
        'rental-within-90-days-is-text-parseable',
        true,
        Boolean(historical)
      ),
      result(
        121,
        'qualitative-floor-does-not-demand-number',
        false,
        missingExpectedDetails(parse(floorText), floorText).includes('floor')
      ),
      result(
        121,
        'monetary-deposit-does-not-demand-month-count',
        false,
        missingExpectedDetails(parse(depositText), depositText).includes(
          'depositMonths'
        )
      ),
      result(
        123,
        'qualified-russian-bedroom-count',
        5,
        house.attributes.bedrooms
      ),
      result(
        123,
        'one-year-minimum-is-twelve-months',
        12,
        house.attributes.minimumStayMonths
      ),
      result(
        124,
        'floor-price-variants-retain-shared-bedroom',
        1,
        floorVariants.attributes.bedrooms
      ),
      result(
        125,
        'families-seeking-is-not-a-rental-request',
        true,
        classifyTelegramPost(seekers).eligible
      ),
      result(
        125,
        'view-reference-does-not-change-explicit-location',
        true,
        classifyTelegramPost(view).eligible
      ),
      result(
        126,
        'ledger-accounts-for-two-real-source-lines',
        2,
        ledger.segments.total
      ),
      result(
        126,
        'ledger-maps-explicit-rent-and-bedroom-lines',
        2,
        ledger.segments.mapped
      ),
      result(
        130,
        'second-independent-album-caption-survives',
        true,
        multiListingAlbum.text.includes(secondCaption)
      ),
      result(
        131,
        'full-en-dash-property-code-survives',
        '414-75414',
        propertyId?.replace(/[–—‑]/gu, '-')
      ),
      ...fieldNotationChecks(parse),
      result(
        136,
        'vehicle-rental-is-not-housing',
        false,
        classifyTelegramPost('Сдам байк в аренду 50сс. 2.5 млн VND/месяц.')
          .eligible
      ),
      result(
        136,
        'vehicle-sale-with-negated-rental-history-is-not-housing',
        false,
        classifyTelegramPost(
          'Продаю Honda SCR. Байк не сдавался в аренду. Цена 10 млн VND.'
        ).eligible
      ),
    ],
    negativeControls: diagnosticControls(parse),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const report = await reproducePr118Regressions();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = [...report.checks, ...report.negativeControls].every(
    ({ pass }) => pass
  )
    ? 0
    : 1;
}
