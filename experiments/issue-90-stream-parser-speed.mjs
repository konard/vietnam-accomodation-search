// Compares links-notation Parser on one string with StreamParser over the same
// text, to choose how canonical text above the parser cap is read.
// Usage: node experiments/issue-90-stream-parser-speed.mjs [records]
import { performance } from 'node:perf_hooks';
import { Parser, StreamParser } from 'links-notation';
import { serializeRecords } from '../src/links-store.js';

const count = Number(process.argv[2] || 4_000);
const text = serializeRecords(
  'domain-record',
  Array.from({ length: count }, (_, index) => ({
    id: `subject:${index}#values.text`,
    object: `Căn hộ ${index} — view biển`,
    predicate: 'values.text',
    subject: `subject:${index}`,
    type: 'semantic-link',
  }))
);
let started = performance.now();
const whole = new Parser({ maxInputSize: text.length + 1 }).parse(text);
const parserMs = performance.now() - started;
started = performance.now();
const streamed = [...StreamParser.parse([text], { maxInputSize: 64 * 1024 })];
const streamMs = performance.now() - started;
console.log(
  JSON.stringify({
    bytes: Buffer.byteLength(text),
    links: whole.length,
    parserMs: Math.round(parserMs),
    sameLinks: streamed.length === whole.length,
    streamMs: Math.round(streamMs),
  })
);
