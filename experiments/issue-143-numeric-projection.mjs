// Finite probe of real clink numeric references; no private data.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Link, formatLinks } from 'links-notation';
import {
  parseNotation,
  runClink,
  verifyExport,
} from '../src/link-cli-mirror.js';
import { serializeRecords } from '../src/links-store.js';

const notation = serializeRecords('domain-record', [
  {
    id: 'qa',
    text: 'Full original rental text. '.repeat(80),
    amount: 13000000,
  },
]);
const names = new Map();
const links = parseNotation(notation);
for (const link of links) {
  for (const value of [link, ...link.values]) {
    if (!names.has(value.id)) {
      names.set(value.id, String(names.size + 1));
    }
  }
}
const compact = formatLinks(
  links.map(
    (link) =>
      new Link(
        names.get(link.id),
        link.values.map((value) => new Link(names.get(value.id)))
      )
  )
);
const directory = await mkdtemp(join(tmpdir(), 'numeric-clink-'));
try {
  const input = join(directory, 'input.lino');
  const output = join(directory, 'output.lino');
  await writeFile(input, compact);
  await runClink(process.env.CLINK_COMMAND || 'clink', [
    '--db',
    join(directory, 'data.links'),
    '--auto-create-missing-references',
    '--import',
    input,
    '--export',
    output,
  ]);
  const exported = await readFile(output, 'utf8');
  console.log(JSON.stringify(verifyExport(compact, exported)));
} finally {
  await rm(directory, { recursive: true, force: true });
}
