import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'test-anywhere';
import * as progress from '../experiments/audit-progress.mjs';

describe('stable audit chunks and phase timing (#108)', () => {
  it('merges disjoint chunks into one cohort without accepting an incomplete or previous pass', () => {
    const sources = ['a', 'b', 'c', 'd'].map((username) => ({ username }));
    const summary = (id, auditPass = 'one') => ({
      id,
      auditPass,
      complete: true,
      audit: {
        ...progress.pendingSourceAudit(id),
        parserOffers: 2,
        completion: { pass: true },
      },
    });
    const first = [summary('a'), summary('b')];
    const partial = progress.mergeSourceAudits(sources, first, 'one');
    expect(partial.map(({ completion }) => completion.pass)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    const full = progress.mergeSourceAudits(
      sources,
      [...first, summary('c'), summary('d')],
      'one'
    );
    expect(full.reduce((total, audit) => total + audit.parserOffers, 0)).toBe(
      8
    );
    expect(full.every(({ completion }) => completion.pass)).toBe(true);
    expect(
      progress
        .mergeSourceAudits(sources, first, 'two')
        .every(({ completion }) => completion.pass === false)
    ).toBe(true);
    expect(
      progress.completedAudit({
        id: 'legacy',
        complete: true,
        messagesScanned: 10,
        metrics: { parserOffers: 3 },
      }).parserOffers
    ).toBe(3);
  });
  it('selects explicit ordinal ranges and rejects ambiguous or out-of-cohort ordinals', () => {
    expect(progress.parseSourceSelection('1-10,12,14-15', 40)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 15,
    ]);
    expect(progress.parseSourceSelection(undefined, 3)).toEqual([1, 2, 3]);
    for (const value of ['0', '41', '10-1', '1,1', 'a', '1-', '']) {
      let error;
      try {
        progress.parseSourceSelection(value, 40);
      } catch (caught) {
        error = caught;
      }
      expect(error instanceof RangeError).toBe(true);
    }
  });

  it('reports exclusive phase time even with concurrent projections nested in store and OCR in parse', async () => {
    let clock = 0;
    const timing = progress.createSourceTimings(() => clock);
    await timing.measure('fetch', async () => {
      clock += 10;
    });
    await timing.measure('parse', async () => {
      clock += 5;
      await timing.measure('ocr', async () => {
        clock += 20;
      });
      clock += 5;
    });
    await timing.measure('store', async () => {
      clock += 5;
      const a = timing.measure('project', async () => {
        clock += 10;
      });
      const b = timing.measure('project', async () => {
        clock += 10;
      });
      await Promise.all([a, b]);
      clock += 5;
    });
    expect(timing.summary()).toEqual({
      fetch: 10,
      ocr: 20,
      parse: 10,
      store: 10,
      project: 20,
      total: 70,
    });
  });

  it('resumes a completed source without fetching or projecting its retained batch', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const { auditSource } =
      await import('../experiments/audit-telegram-accommodations.mjs');
    expect(typeof auditSource).toBe('function');
    const directory = await mkdtemp(join(tmpdir(), 'audit-progress-'));
    const checkpoint = {
      id: 'public_source',
      complete: true,
      auditPass: 'pass-1',
      audit: {
        alias: 'public_source',
        completion: { pass: true },
        parserOffers: 3,
      },
    };
    const store = { queryRecords: async () => [checkpoint] };
    try {
      const result = await auditSource(
        {
          iterMessages: () => {
            throw new Error('unexpected refetch');
          },
        },
        { public: { username: 'public_source' } },
        { stateDirectory: directory, auditPass: 'pass-1' },
        {},
        0,
        store,
        {
          appendRecords: () => {
            throw new Error('unexpected projection');
          },
        }
      );
      expect(result.audit).toEqual(checkpoint.audit);
      expect(result.reused).toBe(true);
      expect(result.offers).toEqual([]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('replays an interrupted projection without fetching again and re-collects on a new pass', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const { auditSource } =
      await import('../experiments/audit-telegram-accommodations.mjs');
    const directory = await mkdtemp(join(tmpdir(), 'audit-replay-'));
    let checkpoints = [];
    const checkpointStore = {
      queryRecords: async () => checkpoints,
      updateRecords: async (_kind, update) => {
        checkpoints = update(checkpoints);
        return checkpoints;
      },
    };
    let fetches = 0;
    const client = {
      async *iterMessages() {
        fetches += 1;
        yield {
          id: 10,
          date: new Date(Date.UTC(2026, 9, 4)),
          message:
            'Nha Trang apartment for rent: 7 million VND/month, 1 bedroom, 1 bathroom, 40 m2. Address: 10 Tran Phu.',
        };
      },
    };
    let fail = true;
    let savedOffers = [];
    const auditStore = {
      appendRecords: async () => {
        if (fail) {
          throw new Error('projection interrupted');
        }
      },
      saveOffers: async (offers) => {
        savedOffers = offers;
      },
    };
    const options = {
      stateDirectory: directory,
      auditPass: 'one',
      months: 3,
      maxMessages: 100,
    };
    const report = { generatedAt: '2026-10-05T00:00:00Z', examples: [] };
    const source = { public: { username: 'source' } };
    try {
      const error = await auditSource(
        client,
        source,
        options,
        report,
        0,
        checkpointStore,
        auditStore
      ).catch((caught) => caught);
      expect(error.message).toBe('projection interrupted');
      expect(checkpoints[0].auditPass).toBe('one');
      expect(checkpoints[0].phase).toBe('projection-pending');
      fail = false;
      const resumed = await auditSource(
        client,
        source,
        options,
        report,
        0,
        checkpointStore,
        auditStore
      );
      expect(fetches).toBe(1);
      expect(resumed.audit.completion.pass).toBe(true);
      expect(savedOffers.length).toBe(1);
      expect(resumed.audit.timingsMs.fetch).toBe(0);
      expect(typeof resumed.audit.timingsMs.project).toBe('number');
      expect(
        (
          await auditSource(
            client,
            source,
            options,
            report,
            0,
            checkpointStore,
            auditStore
          )
        ).reused
      ).toBe(true);
      await auditSource(
        client,
        source,
        { ...options, auditPass: 'two' },
        report,
        0,
        checkpointStore,
        auditStore
      );
      expect(fetches).toBe(2);
      expect(checkpoints[0].auditPass).toBe('two');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
