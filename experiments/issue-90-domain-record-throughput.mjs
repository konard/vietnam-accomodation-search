// Measures links-notation parse/format and record (de)serialization throughput
// on synthetic semantic-link domain records shaped like the mtcute graph.
// Usage: node experiments/issue-90-domain-record-throughput.mjs [records]
import { performance } from 'node:perf_hooks';
import { parseNotation } from '../src/link-cli-mirror.js';
import { deserializeRecords, serializeRecords } from '../src/links-store.js';

const count = Number(process.argv[2] || 20_000);
const records = Array.from({ length: count }, (_, index) => ({
  id: `offer:telegram:source-${index % 40}:${index}#values.attributes.text.${index % 7}`,
  object: `Căn hộ ${index} phòng ngủ — view biển, giá ${index * 1000} VND, liên hệ`,
  predicate: `values.attributes.text.${index % 7}`,
  schemaVersion: 1,
  subject: `offer:telegram:source-${index % 40}:${index}`,
  type: 'semantic-link',
}));

const time = (label, task) => {
  const started = performance.now();
  const result = task();
  const ms = performance.now() - started;
  return { label, ms: Math.round(ms), result };
};
const formatted = time('serializeRecords', () =>
  serializeRecords('domain-record', records)
);
const bytes = Buffer.byteLength(formatted.result);
const parsed = time('parseNotation', () => parseNotation(formatted.result));
const decoded = time('deserializeRecords', () =>
  deserializeRecords('domain-record', formatted.result)
);
const mbps = (ms) => Number((bytes / 1024 / 1024 / (ms / 1000)).toFixed(2));
console.log(
  JSON.stringify(
    {
      bytes,
      bytesPerRecord: Math.round(bytes / count),
      links: parsed.result.length,
      records: count,
      roundTrip: decoded.result.length === count,
      serializeMs: formatted.ms,
      serializeMiBps: mbps(formatted.ms),
      parseMs: parsed.ms,
      parseMiBps: mbps(parsed.ms),
      deserializeMs: decoded.ms,
      deserializeMiBps: mbps(decoded.ms),
    },
    null,
    2
  )
);
