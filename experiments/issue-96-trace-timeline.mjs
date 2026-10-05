// Prints the trace timeline of one data directory: seconds since the first
// event, source, stage, status, and outcome. Use it after
// experiments/issue-96-live-search.mjs to see where a search spent its time.
// Usage: node experiments/issue-96-trace-timeline.mjs <data-directory>
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deserializeRecords } from '../src/links-store.js';

const directory = process.argv[2];
const records = deserializeRecords(
  'trace',
  await readFile(join(directory, 'traces.lino'), 'utf8')
)
  .filter(({ observedAt }) => observedAt)
  .sort((left, right) => left.sequence - right.sequence);
const start = new Date(records[0].observedAt).getTime();
for (const event of records) {
  const seconds = (new Date(event.observedAt).getTime() - start) / 1000;
  console.log(
    [
      seconds.toFixed(1).padStart(7),
      event.sourceId || '-',
      event.stage,
      event.status,
      event.metadata?.outcome || event.metadata?.category || '',
    ].join('\t')
  );
}
