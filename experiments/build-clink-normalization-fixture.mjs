#!/usr/bin/env node

// Builds the anonymized structural fixture for #55: one content-defined shard
// written with the schema v2 encoding, with the same shape as the retained
// private failure (73 canonical links, 100 exported, 1 missing, 2 unexpected).
// Every value is synthetic; only the structure and the one trailing newline in
// an offer text are taken from the failure. Pass --check to also project the
// fixture with the real clink binary and print the aggregate comparison.
//
// Usage: node experiments/build-clink-normalization-fixture.mjs [--check]

import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Link, formatLinks } from 'links-notation';

import { compareExport } from '../src/link-cli-mirror.js';

const output = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'tests',
  'fixtures',
  'clink-normalization-shard-v2.lino'
);

// The schema v2 writer, kept verbatim: names were written without escaping.
function v2Links(kind, fields) {
  const links = [];
  for (const { id, values } of fields) {
    const reference = `record:${kind}:${id}`;
    links.push(
      new Link(reference, [
        new Link(`kind:${kind}`),
        new Link(`value:string:${id}`),
      ])
    );
    for (const [path, value] of values) {
      const field = `${reference}:field:${path}`;
      const valueNode = `${field}:value`;
      links.push(
        new Link(field, [new Link(reference), new Link(valueNode)]),
        new Link(valueNode, [new Link(valueNode), new Link(value)])
      );
    }
  }
  return links;
}

function offer(index, text) {
  return {
    id: `offer-${index}`,
    values: [
      ['/', 'value:object'],
      ['/collectedAt', `value:string:2026-01-0${index}T00:00:00.000Z`],
      ['/id', `value:string:offer-${index}`],
      ['/price', 'value:object'],
      ['/price/amount', `value:number:${index * 100}`],
      ['/price/currency', 'value:string:VND'],
      ['/sourceId', `value:string:source-${index % 3}`],
      ['/text', `value:string:${text}`],
      ['/url', `value:string:https://example.invalid/${index}`],
    ],
  };
}

const links = v2Links('offer', [
  offer(1, 'text 1'),
  offer(2, 'text 2'),
  offer(3, 'text 3\n'),
  offer(4, 'text 4'),
]);
// A content-defined shard starts at any link boundary: this one begins after
// the record link and root field of the first offer.
const notation = formatLinks(links.slice(3));
await writeFile(output, notation);

if (process.argv.includes('--check')) {
  const directory = await mkdtemp(join(tmpdir(), 'clink-fixture-'));
  try {
    await writeFile(join(directory, 'canonical.lino'), notation);
    execFileSync(process.env.CLINK_COMMAND || 'clink', [
      '--db',
      join(directory, 'data.links'),
      '--auto-create-missing-references',
      '--import',
      join(directory, 'canonical.lino'),
      '--export',
      join(directory, 'verified.lino'),
    ]);
    const exported = await readFile(join(directory, 'verified.lino'), 'utf8');
    console.log(JSON.stringify(compareExport(notation, exported)));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
