#!/usr/bin/env node

// Manual, offline reproductions of issues #111 and #112. This is a diagnostic
// experiment, not a passing acceptance gate. It exits 1 while a defect remains.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL, URL } from 'node:url';

import { LinksStore, parseTelegramOffer } from '../src/index.js';

const SURCHARGE_TEXT = `Квартира в Нячанге сдаётся.
Стоимость аренды: 7.800.000 VND / месяц
Для 1 человека: 6.800.000 VND / месяц
При аренде на 3 месяца: + 500.000 VND / месяц
Условия аренды:
Депозит: 1 месяц
Договор: 6 месяцев`;

export async function reproduceRegressions() {
  const directory = await mkdtemp(`${tmpdir()}/vac-pr110-regressions-`);
  try {
    const store = new LinksStore({ directory });
    const runner = await readFile(
      new URL('./audit-telegram-accommodations.mjs', import.meta.url),
      'utf8'
    );
    const collection = runner.match(
      /\.loadRecords\('(audit-cohorts?)'\)/u
    )?.[1];
    if (!collection) {
      throw new Error('Cannot identify the audit runner cohort collection.');
    }
    let collectionError;
    try {
      await store.loadRecords(collection);
    } catch (error) {
      collectionError = error.message;
    }
    const offer = parseTelegramOffer({
      date: new Date('2026-10-06T00:00:00Z'),
      messageId: 1,
      sourceId: 'telegram:synthetic-regression',
      text: SURCHARGE_TEXT,
    });
    return {
      mode: 'offline-diagnostic',
      checks: [
        {
          issue: 111,
          name: 'audit-cohort-storage-contract',
          pass: !collectionError,
          actualError: collectionError,
          collection,
          limitation: 'A storage-contract check does not replace a live audit.',
        },
        {
          issue: 112,
          name: 'additive-surcharge-is-not-base-rent',
          pass: offer?.priceVnd === 6_800_000,
          expectedPriceVnd: 6_800_000,
          actualPriceVnd: offer?.priceVnd,
          actualNativePrice: offer?.price,
        },
      ],
    };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const report = await reproduceRegressions();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.checks.every(({ pass }) => pass) ? 0 : 1;
}
