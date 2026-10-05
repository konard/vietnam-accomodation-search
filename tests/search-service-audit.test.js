import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'test-anywhere';

import {
  auditLive,
  auditReplay,
  replayRuntime,
  replaySources,
} from '../experiments/audit-search-service.mjs';
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
          field === 'availability' ? null : true,
        ]);
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

describe('search service field accuracy on live results', () => {
  it('scores the stored offers that match a reviewed card', async () => {
    if (typeof Deno !== 'undefined') {
      return;
    }
    const corpus = await loadCorpus();
    const web = corpus.cases.filter(({ input }) => input.sourceType === 'web');
    // One reviewed card is gone from the live site and one new card appears.
    const live = [
      ...web.slice(1),
      {
        id: 'new-card',
        input: { ...web[0].input, text: 'Studio for rent, 6 triệu/tháng' },
      },
    ];
    const directory = await mkdtemp(join(tmpdir(), 'vac-search-audit-'));
    try {
      const result = await auditLive({
        browserRuntime: replayRuntime(live),
        corpus,
        directory,
        environment: {
          BROWSER_MAX_INTERVAL_MS: '1',
          BROWSER_MIN_INTERVAL_MS: '1',
        },
        rateProvider: { getRates: () => Promise.resolve(corpus.rates) },
        sources: replaySources(live),
      });
      const offers = web.slice(1).filter(({ expected }) => expected.offer);
      expect(result.matchedReviewedCards).toBe(offers.length);
      expect(result.metrics.misses).toEqual([]);
      expect(result.metrics.pass).toBe(true);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
