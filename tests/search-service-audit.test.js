import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'test-anywhere';

import { auditReplay } from '../experiments/audit-search-service.mjs';
import { FIELDS, loadCorpus } from '../experiments/field-corpus-metrics.mjs';

describe('search service field accuracy on the reviewed web sample', () => {
  it('stores every reviewed web offer with its reviewed fields', async () => {
    if (typeof Deno !== 'undefined') {
      return;
    }
    const corpus = await loadCorpus();
    const directory = await mkdtemp(join(tmpdir(), 'vac-search-audit-'));
    try {
      const result = await auditReplay({ corpus, directory });
      const web = corpus.cases.filter(
        ({ input }) => input.sourceType === 'web'
      );
      expect(Object.values(result.outcomes)).toEqual(
        [...new Set(web.map(({ input }) => input.sourceId))].map(() => 'offers')
      );
      expect(result.stored).toBe(
        web.filter(({ expected }) => expected.offer).length
      );
      expect(result.metrics.misses).toEqual([]);
      for (const field of FIELDS) {
        expect([field, result.metrics.fields[field].pass]).toEqual([
          field,
          true,
        ]);
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
