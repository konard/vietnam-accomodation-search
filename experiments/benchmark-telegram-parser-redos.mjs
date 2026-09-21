import { performance } from 'node:perf_hooks';

import { parseTelegramOffer } from '../src/index.js';

const whitespaceLength = Number(process.argv[2] || 10_000);
const cases = ['этаж', 'mã'];

for (const prefix of cases) {
  const startedAt = performance.now();
  parseTelegramOffer(
    {
      chat: { username: 'redos_benchmark' },
      date: '2026-09-20T00:00:00Z',
      messageId: 1,
      text: `${prefix}${' '.repeat(whitespaceLength)}!`,
    },
    { now: new Date('2026-09-21T00:00:00Z') }
  );
  const durationMs = performance.now() - startedAt;
  console.log(`${prefix}: ${durationMs.toFixed(2)} ms`);
}
