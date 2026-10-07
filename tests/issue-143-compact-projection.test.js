import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'test-anywhere';
import {
  LinkCliMirror,
  parseNotation,
  splitNotation,
  verifyExport,
} from '../src/link-cli-mirror.js';
import { serializeRecords } from '../src/links-store.js';
import { Link, formatLinks } from 'links-notation';
import {
  compactProjectionNames,
  expandProjectionNames,
} from '../src/clink-projection-names.js';

describe('full-body ledger projection cost (#143)', () => {
  it('bounds binary name lengths while verifying the complete canonical ledger and alias integrity', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return; // The Deno CI suite intentionally has read-only permissions.
    }
    const directory = await mkdtemp(join(tmpdir(), 'compact-projection-'));
    const notation = serializeRecords('domain-record', [
      {
        id: `parser-run:qa#${'segment-path-'.repeat(20)}`,
        object:
          'Original source body with Unicode Нячанг and full field provenance '.repeat(
            20
          ),
      },
    ]);
    let runs = 0;
    const mirror = new LinkCliMirror({
      run: async (_command, args) => {
        runs += 1;
        const input = await readFile(
          args[args.indexOf('--import') + 1],
          'utf8'
        );
        const links = parseNotation(input);
        expect(
          Math.max(
            ...links.flatMap((link) => [
              link.id.length,
              ...link.values.map(({ id }) => id.length),
            ])
          )
        ).toBeLessThan(32);
        await writeFile(args[args.indexOf('--db') + 1], 'binary');
        await writeFile(args[args.indexOf('--export') + 1], input);
      },
    });
    try {
      await mirror.ensure({
        directory,
        kind: 'domain-records',
        notation,
      });
      const pointer = JSON.parse(
        await readFile(
          join(directory, '.binary', 'domain-records.current.json'),
          'utf8'
        )
      );
      verifyExport(
        notation,
        await readFile(join(pointer.directory, 'verified.lino'), 'utf8')
      );
      await mirror.ensure({ directory, kind: 'domain-records', notation });
      expect(runs).toBe(1);
      await writeFile(join(pointer.directory, 'aliases.json'), 'corrupt');
      await mirror.ensure({ directory, kind: 'domain-records', notation });
      expect(runs).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('restores numeric-looking, Unicode and unnamed references and rejects invalid export addresses', () => {
    const links = [
      new Link('1', [new Link('Unicode Нячанг '.repeat(10)), new Link('2')]),
    ];
    const compact = compactProjectionNames(links);
    expect(
      expandProjectionNames(parseNotation(compact.notation), compact.aliases)
    ).toBe(formatLinks(links));
    for (const id of ['0', 'bad', '01', '999999999999999999999999', '999']) {
      let code;
      try {
        expandProjectionNames([new Link(id)], compact.aliases);
      } catch (error) {
        code = error.code;
      }
      expect(code).toBe('storage-verification-failed');
    }
    expect(compactProjectionNames([new Link('short')])).toBe(undefined);
    expect(
      expandProjectionNames([new Link(null, [new Link('1')])], ['original'])
    ).toBe(formatLinks([new Link(null, [new Link('original')])]));
  });

  it('amortizes numeric projection overhead without enlarging ordinary named shards or explicit bounds', () => {
    const notation = formatLinks(
      Array.from(
        { length: 256 },
        (_, index) =>
          new Link(`${'long-field-reference-'.repeat(4)}${index}`, [
            new Link('owner'),
            new Link(`value-${index}`),
          ])
      )
    );
    expect(splitNotation(notation).length > 1).toBe(true);
    expect(splitNotation(notation, { compactNames: true }).length).toBe(1);
    expect(
      splitNotation(notation, { compactNames: true, maxLinks: 128 }).length > 1
    ).toBe(true);
    const ordinary = formatLinks(
      Array.from(
        { length: 256 },
        (_, index) =>
          new Link(`r${index}`, [new Link('owner'), new Link(`v${index}`)])
      )
    );
    expect(splitNotation(ordinary, { compactNames: true }).length > 1).toBe(
      true
    );
  });
});
