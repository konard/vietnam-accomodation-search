import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

// Verify fixture migration against a retained Git revision without printing
// message content. Run from the repository root; optionally pass the base ref.
const base = process.argv[2] || 'origin/main';
const file = 'experiments/fixtures/reviewed-live-corpus.json';
const original = JSON.parse(
  execFileSync('git', ['show', `${base}:${file}`], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
);
const current = JSON.parse(await readFile(file, 'utf8'));
for (const entry of original.cases) {
  const migrated = current.cases.find(({ id }) => id === entry.id);
  assert(migrated, `Missing original case: ${entry.id}`);
  assert.deepEqual(migrated.input, entry.input);
  for (const [field, expected] of Object.entries(entry.expected)) {
    if (field !== 'priceVnd') {
      assert.deepEqual(migrated.expected[field], expected);
    } else if (expected === null) {
      assert.equal(migrated.expected.price, undefined);
    } else {
      const native = migrated.expected.price;
      assert.equal(native.amount * original.rates[native.currency], expected);
    }
  }
}
console.log(
  `Preserved all ${original.cases.length} original inputs and non-price expectations; native prices reproduce the original converted expectations.`
);
