import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Link, formatLinks } from 'links-notation';
import { describe, expect, it } from 'test-anywhere';

import { LinkCliMirror, LinksStore } from '../src/index.js';
import {
  compareExport,
  parseNotation,
  sha256,
  verifyExport,
} from '../src/link-cli-mirror.js';
import {
  RECORDS_SCHEMA,
  decodeName,
  deserializeRecords,
  encodeName,
  isCurrentSchema,
  serializeRecords,
} from '../src/links-store.js';

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'clink-normalization-shard-v2.lino'
);

// Values that clink 0.2.10 and 0.2.11 rewrite on import, or that
// links-notation cannot round-trip, when written without escaping (#55).
const sensitive = [
  '',
  'a ',
  ' a',
  'a  b',
  'a\n',
  'a\r\nb',
  'a\n  b',
  'a\n\n\nb',
  'a\tb',
  'a:',
  'a :',
  ' a ',
  'a\u0085b',
  'It\'s "nice"',
  "a\\'b",
  'a`b',
  '100%',
  '%41',
  'Căn hộ 2 phòng ngủ, gần biển',
  'Квартира у моря',
  '🏠 (2PN) #rent: 500$',
];

// Models link-cli 0.2.10 src/lino_database_input.rs: normalize_links_notation
// trims every line of the document and drops empty lines, and
// normalize_identifier trims each name and then its trailing colons. Like
// clink, it exports a point link for each referenced name it did not import.
function normalizingClink({ drop } = {}) {
  const run = async (_command, arguments_) => {
    const argument = (name) => arguments_[arguments_.indexOf(name) + 1];
    const text = (await readFile(argument('--import'), 'utf8'))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
    const name = (id) => id.trim().replace(/:+$/u, '');
    const links = parseNotation(text)
      .filter((link) => !drop?.(link))
      .map((link) => ({
        id: name(link.id),
        values: link.values.map((value) => name(value.id)),
      }));
    const defined = new Set(links.map((link) => link.id));
    const points = [...new Set(links.flatMap((link) => link.values))]
      .filter((id) => !defined.has(id))
      .map((id) => ({ id, values: [id, id] }));
    const exported = formatLinks(
      [...points, ...links].map(
        ({ id, values }) =>
          new Link(
            id,
            values.map((value) => new Link(value))
          )
      )
    );
    const database = argument('--db');
    await writeFile(database, `binary:${sha256(text)}`);
    await writeFile(database.replace(/data\.links$/u, 'data.names.links'), '');
    await writeFile(argument('--export'), exported);
  };
  return { run };
}

const isDeno = typeof globalThis.Deno !== 'undefined';

function realClink() {
  if (isDeno) {
    return undefined;
  }
  const command = process.env.CLINK_COMMAND || 'clink';
  const probe = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return probe.status === 0 ? command : undefined;
}

function sensitiveOffers(count = sensitive.length) {
  return Array.from({ length: count }, (_, index) => ({
    id: `offer-${index}${sensitive[index % sensitive.length]}`,
    [`key ${sensitive[(index + 3) % sensitive.length]}`]: index,
    price: { amount: index * 10, currency: 'VND' },
    text: sensitive[index % sensitive.length],
  }));
}

async function failedStage(mirror, directory, notation) {
  return mirror.stage({ directory, kind: 'offers', notation }).then(
    () => undefined,
    (error) => error
  );
}

// The schema v2 writer: one record, names written without escaping.
function v2Text(kind, id, fields) {
  const reference = `record:${kind}:${id}`;
  const node = (path) => new Link(`${reference}:field:${path}:value`);
  return formatLinks([
    new Link(kind, [
      new Link('schema:associative-records-v2'),
      new Link(`kind:${kind}`),
    ]),
    new Link(reference, [
      new Link(`kind:${kind}`),
      new Link(`value:string:${id}`),
    ]),
    ...fields.flatMap(([path, value]) => [
      new Link(`${reference}:field:${path}`, [new Link(reference), node(path)]),
      new Link(node(path).id, [node(path), new Link(value)]),
    ]),
  ]);
}

const v2Offer = (text) =>
  v2Text('offer', 'r1', [
    ['/', 'value:object'],
    ['/id', 'value:string:r1'],
    ['/text', `value:string:${text}`],
  ]);

describe('clink-safe associative names (#55)', () => {
  it('reproduces the retained failure shape from the schema v2 fixture', async () => {
    // Deno runs the suite with read-only permissions.
    if (isDeno) {
      return;
    }
    const notation = await readFile(fixture, 'utf8');
    const directory = await mkdtemp(join(tmpdir(), 'clink-names-'));
    const error = await failedStage(
      new LinkCliMirror(normalizingClink()),
      directory,
      notation
    );
    expect(error.message).toBe(
      'clink export verification failed (1 links missing, 2 unexpected links)'
    );
    expect(error.code).toBe('storage-verification-failed');
    expect(error.diagnostics).toEqual({
      canonicalLinks: 73,
      exportedLinks: 100,
      missingLinks: 1,
      rewrittenLinks: 1,
      unexpectedLinks: 2,
      unreferencedUnexpectedLinks: 1,
    });
    const [candidate] = (await readdir(join(directory, '.binary'))).filter(
      (entry) => entry.startsWith('offers-')
    );
    const failure = await readFile(
      join(directory, '.binary', candidate, 'failure.json'),
      'utf8'
    );
    expect(JSON.parse(failure).diagnostics).toEqual(error.diagnostics);
    expect(failure).not.toContain('offer-');
    expect(failure).not.toContain('text');
  });

  it('projects every sensitive value exactly once written as schema v3', async () => {
    // Deno runs the suite with read-only permissions.
    if (isDeno) {
      return;
    }
    const records = sensitiveOffers(80);
    const notation = serializeRecords('offer', records);
    expect(parseNotation(notation).length > 128).toBe(true);
    const directory = await mkdtemp(join(tmpdir(), 'clink-names-'));
    await new LinkCliMirror(normalizingClink()).ensure({
      directory,
      kind: 'offers',
      notation,
    });
    expect(deserializeRecords('offer', notation)).toEqual(records);
    expect(isCurrentSchema('offer', notation)).toBe(true);
  });

  it('still rejects an export that genuinely drops a link', async () => {
    // Deno runs the suite with read-only permissions.
    if (isDeno) {
      return;
    }
    const notation = serializeRecords('offer', sensitiveOffers(3));
    const directory = await mkdtemp(join(tmpdir(), 'clink-names-'));
    const error = await failedStage(
      new LinkCliMirror(
        normalizingClink({ drop: (link) => link.id.endsWith('/text:value') })
      ),
      directory,
      notation
    );
    expect(error.code).toBe('storage-verification-failed');
    expect(error.diagnostics.missingLinks).toBe(3);
    expect(error.diagnostics.rewrittenLinks).toBe(0);
    expect(verifyExport(notation, notation).missingLinks).toBe(0);
  });

  it('encodes only characters clink or links-notation could rewrite', () => {
    expect(encodeName('value:string:Căn hộ 2 phòng')).toBe(
      'value:string:Căn hộ 2 phòng'
    );
    expect(encodeName('value:string:')).toBe('value:string%3A');
    expect(encodeName(' a  b\n%')).toBe('%20a%20 b%0A%25');
    for (const value of sensitive) {
      const name = `value:string:${value}`;
      expect(decodeName(encodeName(name))).toBe(name);
      expect(encodeName(name).trim()).toBe(encodeName(name));
      expect(/['"\n\r\t]|: *$/u.test(encodeName(name))).toBe(false);
    }
    const mixed = serializeRecords('offer', [
      { id: 'r1', text: sensitive[13] },
    ]);
    expect(deserializeRecords('offer', mixed)).toEqual([
      { id: 'r1', text: sensitive[13] },
    ]);
    expect(mixed.split('\n')[0]).toContain(RECORDS_SCHEMA);
  });

  it('migrates schema v2 text to v3 when the mirror reads it', async () => {
    // Deno runs the suite with read-only permissions.
    if (isDeno) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'clink-names-'));
    const legacy = v2Offer('Room near the beach\n');
    const path = join(directory, 'offers.lino');
    await writeFile(path, legacy);
    const plain = new LinksStore({ directory });
    expect(await plain.loadRecords('offers')).toEqual([
      { id: 'r1', text: 'Room near the beach\n' },
    ]);
    expect(await readFile(path, 'utf8')).toBe(legacy);

    const store = new LinksStore({
      directory,
      mirror: new LinkCliMirror(normalizingClink()),
    });
    expect(await store.listOffers()).toEqual([
      { id: 'r1', text: 'Room near the beach\n' },
    ]);
    const migrated = await readFile(path, 'utf8');
    expect(isCurrentSchema('offer', migrated)).toBe(true);
    const pointer = JSON.parse(
      await readFile(join(directory, '.binary', 'offers.current.json'), 'utf8')
    );
    expect(pointer.sha256).toBe(sha256(migrated));
    expect(
      await store.queryRecords('offers', { path: 'id', value: 'r1' })
    ).toEqual([{ id: 'r1', text: 'Room near the beach\n' }]);
    expect(await readFile(path, 'utf8')).toBe(migrated);

    const state = { users: { 7: { query: 'Nha Trang ' } } };
    const statePath = join(directory, 'search-state.lino');
    await writeFile(
      statePath,
      v2Text('search-state', 'telegram', [
        ['/', 'value:object'],
        ['/id', 'value:string:telegram'],
        ['/users', 'value:object'],
        ['/users/7', 'value:object'],
        ['/users/7/query', 'value:string:Nha Trang '],
      ])
    );
    expect(await store.loadSearchState()).toEqual({ id: 'telegram', ...state });
    expect(
      isCurrentSchema('search-state', await readFile(statePath, 'utf8'))
    ).toBe(true);
    await store.saveSearchState({ users: {} });
    expect(await store.loadSearchState()).toEqual({
      id: 'telegram',
      users: {},
    });
  });

  const command = realClink();
  const required = !isDeno && process.env.REQUIRE_REAL_CLINK === '1';
  if (required && !command) {
    throw new Error('Required real-clink integration cannot find clink.');
  }
  if (required) {
    const version = spawnSync(command, ['--version'], { encoding: 'utf8' });
    if (version.stdout?.trim() !== 'clink 0.2.11') {
      throw new Error('Required real-clink integration needs clink 0.2.11.');
    }
  }
  if (command) {
    it('matches the real clink binary on the fixture and on schema v3', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'clink-names-'));
      const mirror = new LinkCliMirror({ command });
      const error = await failedStage(
        mirror,
        directory,
        await readFile(fixture, 'utf8')
      );
      expect(error.diagnostics).toEqual({
        canonicalLinks: 73,
        exportedLinks: 100,
        missingLinks: 1,
        rewrittenLinks: 1,
        unexpectedLinks: 2,
        unreferencedUnexpectedLinks: 1,
      });
      const store = new LinksStore({ directory, mirror });
      const records = sensitiveOffers(60);
      await store.saveRecords('offers', records);
      expect(await store.loadRecords('offers')).toEqual(records);
      expect(
        compareExport(
          serializeRecords('offer', records),
          serializeRecords('offer', records)
        ).missingLinks
      ).toBe(0);
    });
  }
});
