#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Parser } from 'links-notation';

import { LinksStore, PresetService, serializeRecords } from '../src/index.js';

const owner = '123456789';
const marker = '0123456789';
const seededOffer = {
  collectedAt: '2026-09-23T00:00:00.000Z',
  id: `e2e-offer-${marker}`,
  location: 'Nha Trang',
  price: { amount: 1_234_567, currency: 'VND', period: 'month' },
  priceVnd: 1_234_567,
  sourceId: 'e2e-cache',
  title: `E2E synthetic offer ${marker}`,
  url: `https://audit.invalid/${marker}`,
};

const key = (link) =>
  JSON.stringify([link.id, link.values.map(({ id }) => id)]);

function relationDiff(imported, exported) {
  const expectedLinks = new Parser().parse(imported);
  const actualLinks = new Parser().parse(exported);
  const expected = new Map(expectedLinks.map((link) => [key(link), link]));
  const actual = new Set(actualLinks.map(key));
  const referenced = new Set(
    expectedLinks.flatMap((link) => link.values.map(({ id }) => id))
  );
  const missing = [...expected]
    .filter(([linkKey]) => !actual.has(linkKey))
    .map(([, link]) => ({
      id: link.id,
      values: link.values.map(({ id }) => id),
    }));
  const unexpected = actualLinks.filter(
    (link) =>
      !expected.has(key(link)) &&
      !(
        referenced.has(link.id) &&
        link.values.length === 2 &&
        link.values.every(({ id }) => id === link.id)
      )
  );
  return { missing, unexpected };
}

async function runClink(directory, name, notation) {
  const importPath = join(directory, `${name}.lino`);
  const databasePath = join(directory, `${name}.links`);
  const exportPath = join(directory, `${name}-export.lino`);
  await writeFile(importPath, notation, { mode: 0o600 });
  await new Promise((resolve, reject) => {
    const child = spawn(
      'clink',
      [
        '--db',
        databasePath,
        '--transactions',
        '--commit-mode',
        'sync',
        '--auto-create-missing-references',
        '--import',
        importPath,
        '--export',
        exportPath,
      ],
      { stdio: 'inherit' }
    );
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`clink exited with ${code}`))
    );
  });
  return relationDiff(notation, await readFile(exportPath, 'utf8'));
}

const directory = await mkdtemp(join(tmpdir(), 'vac-issue-31-'));

try {
  const store = new LinksStore({ binaryMirror: true, directory });
  let now = new Date('2026-09-23T00:00:00.000Z');
  const presets = new PresetService({ now: () => now, store });
  await store.saveOffers([seededOffer]);
  const [offer] = await store.listOffers();
  await presets.markDelivered(owner, [offer]);
  now = new Date('2026-09-23T00:01:00.000Z');
  await presets.markDelivered(owner, [offer]);

  const restarted = new LinksStore({ binaryMirror: true, directory });
  const records = await restarted.loadRecords('shown-offers');
  const pointer = JSON.parse(
    await readFile(
      join(directory, '.binary', 'shown-offers.current.json'),
      'utf8'
    )
  );
  const production = relationDiff(
    await readFile(join(directory, 'shown-offers.lino'), 'utf8'),
    await readFile(join(pointer.directory, 'verified.lino'), 'utf8')
  );
  if (
    records.length !== 1 ||
    production.missing.length ||
    production.unexpected.length
  ) {
    throw new Error('The production delivery cursor did not round-trip.');
  }

  const aliases = [
    ...(offer.identityKeys || []),
    offer.id,
    offer.url,
    ...(offer.variants || []).flatMap((variant) => [variant.id, variant.url]),
  ]
    .filter(Boolean)
    .map(String)
    .sort();
  const id = `${owner}:${aliases[0] || offer.id}`;
  const legacy = await runClink(
    directory,
    'legacy-duplicate-cursor',
    serializeRecords('shown-offer', [
      {
        aliases,
        deliveredAt: '2026-09-23T00:00:00.000Z',
        id,
        userId: owner,
      },
      {
        aliases,
        deliveredAt: '2026-09-23T00:01:00.000Z',
        id,
        userId: owner,
      },
    ])
  );
  if (
    legacy.missing.length !== 1 ||
    !legacy.missing[0].id.endsWith(':field:/deliveredAt:value')
  ) {
    throw new Error('The legacy duplicate-cursor defect was not reproduced.');
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        legacy,
        production: {
          missing: production.missing.length,
          records: records.length,
          unexpected: production.unexpected.length,
        },
      },
      null,
      2
    )}\n`
  );
} finally {
  await rm(directory, { force: true, recursive: true });
}
