import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LinksStore } from '../src/links-store.js';
import {
  stateFingerprint,
  compareFingerprints,
} from '../experiments/deploy-cutover-drill-lib.mjs';

describe('live cutover state preservation', () => {
  it('permits additions while detecting changed and lost protected records', async () => {
    if (typeof Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'vac-live-state-'));
    try {
      const store = new LinksStore({ directory });
      const preset = { id: 'protected', name: 'unchanged' };
      await store.saveRecords('presets', [preset]);
      const before = await stateFingerprint(directory);
      await store.saveRecords('presets', [
        preset,
        { id: 'new', name: 'live addition' },
      ]);
      await store.saveRecords('search-traces', [
        { id: 'new-trace', stage: 'completed' },
      ]);
      assert.deepEqual(
        compareFingerprints(before, await stateFingerprint(directory))
          .changedCollections,
        []
      );
      await store.saveRecords('presets', [{ ...preset, name: 'altered' }]);
      assert.deepEqual(
        compareFingerprints(before, await stateFingerprint(directory))
          .changedCollections,
        ['presets']
      );
      await store.saveRecords('presets', []);
      assert.deepEqual(
        compareFingerprints(before, await stateFingerprint(directory))
          .changedCollections,
        ['presets']
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
