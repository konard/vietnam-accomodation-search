// Smoke check: a collection larger than a lowered parse bound is written,
// appended, evicted and read back without any single parse over the bound.
// Usage: node experiments/issue-90-chunked-smoke.mjs
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setNotationLimit } from '../src/link-cli-mirror.js';
import { LinksStore, serializeRecords } from '../src/links-store.js';

const limit = 64 * 1024;
setNotationLimit(limit);
const directory = await mkdtemp(join(tmpdir(), 'issue-90-'));
const record = (index) => ({
  id: `subject:${index}#values.text`,
  object: `Căn hộ ${index} — view biển`,
  predicate: 'values.text',
  subject: `subject:${index}`,
  type: 'semantic-link',
});
try {
  const store = new LinksStore({ directory, maxRecordChunkBytes: 8 * 1024 });
  const records = Array.from({ length: 400 }, (_, index) => record(index));
  console.log(
    'full text bytes',
    Buffer.byteLength(serializeRecords('domain-record', records))
  );
  await store.saveRecords('domain-records', records);
  const index = JSON.parse(
    await readFile(join(directory, 'domain-records.index.json'), 'utf8')
  );
  console.log(
    'chunks',
    index.chunks.length,
    'count',
    index.count,
    'bytes',
    index.bytes,
    'max chunk',
    Math.max(...index.chunks.map((c) => c.bytes))
  );
  const loaded = await store.loadRecords('domain-records');
  console.log('round trip', JSON.stringify(loaded) === JSON.stringify(records));
  await store.appendRecords(
    'domain-records',
    [record(5), record(1000)].map((r) => ({ ...r, object: 'changed' })),
    { maxRecords: 300 }
  );
  const after = await store.loadRecords('domain-records');
  console.log(
    'after append',
    after.length,
    after[0].id,
    after.at(-1).id,
    after.find((r) => r.id === 'subject:5#values.text')
  );
  const expected = [
    ...new Map(records.map((r) => [r.id, r]))
      .set(record(1000).id, { ...record(1000), object: 'changed' })
      .values(),
  ].slice(-300);
  console.log(
    'matches map semantics',
    JSON.stringify(after) === JSON.stringify(expected)
  );
  console.log(
    'query',
    (
      await store.queryRecords('domain-records', {
        path: 'subject',
        value: 'subject:399',
      })
    ).length
  );
  console.log(
    'chunk dirs',
    (await readdir(join(directory, 'domain-records.chunks'))).length
  );
} finally {
  await rm(directory, { force: true, recursive: true });
}
