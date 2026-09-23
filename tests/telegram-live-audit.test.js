import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LinksStore } from '../src/links-store.js';
import { reconcileTelegramMaterials } from '../src/telegram-pipeline.js';
import {
  auditTelegramBatch,
  collectTelegramWindow,
  loadAuditCheckpoint,
  retryTelegramFloodWait,
  saveAuditCheckpoint,
  sourceCompletion,
  verifyAuditStorage,
} from '../experiments/telegram-live-audit-runtime.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

describe('Telegram live-audit runtime', () => {
  it('never reports a source that exhausted its hard cap as passing', () => {
    assert.deepEqual(
      sourceCompletion({ hitCap: true, messagesScanned: 3_000 }),
      {
        pass: false,
        reason: 'message-cap-exhausted',
        state: 'incomplete',
      }
    );
    assert.deepEqual(sourceCompletion({ reachedCutoff: true }), {
      pass: true,
      reason: 'rolling-window-complete',
      state: 'complete',
    });
    assert.equal(sourceCompletion({ error: { code: 'AUTH' } }).pass, false);
  });

  it('honors bounded Telegram flood waits and retries the operation', async () => {
    const waits = [];
    let attempts = 0;
    const result = await retryTelegramFloodWait(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error('FLOOD_WAIT_2');
          error.seconds = 2;
          throw error;
        }
        return 'ok';
      },
      {
        maxWaitSeconds: 10,
        sleep: async (milliseconds) => waits.push(milliseconds),
      }
    );
    assert.equal(result, 'ok');
    assert.deepEqual(waits, [2_000]);

    await assert.rejects(
      retryTelegramFloodWait(
        async () => {
          const error = new Error('FLOOD_WAIT_60');
          error.seconds = 60;
          throw error;
        },
        { maxWaitSeconds: 10, sleep: async () => {} }
      ),
      /exceeds the 10 second audit limit/u
    );
  });

  it('stops one item beyond a page cap and resumes from the checkpoint', async () => {
    const calls = [];
    const messages = [
      { date: new Date('2026-09-20T00:00:00Z'), id: 12 },
      { date: new Date('2026-09-19T00:00:00Z'), id: 11 },
      { date: new Date('2026-09-18T00:00:00Z'), id: 10 },
    ];
    const result = await collectTelegramWindow({
      cutoff: new Date('2026-07-20T00:00:00Z'),
      iterate: ({ limit, offsetId }) => {
        calls.push({ limit, offsetId });
        return messages;
      },
      maxMessages: 2,
      offsetId: 13,
    });

    assert.deepEqual(calls, [{ limit: 3, offsetId: 13 }]);
    assert.deepEqual(
      result.messages.map(({ id }) => id),
      [12, 11]
    );
    assert.equal(result.hitCap, true);
    assert.equal(result.exhausted, false);
    assert.equal(result.offsetId, 11);
    assert.equal(sourceCompletion(result).pass, false);
  });

  it('runs albums and photo-only material through production reconciliation', async () => {
    const result = await auditTelegramBatch(
      [
        {
          chatId: 'public:nha-trang',
          groupedId: 'album-1',
          id: 1,
          mediaId: 'photo-1',
          text: 'Apartment for rent in Nha Trang, 12 million VND/month',
        },
        {
          chatId: 'public:nha-trang',
          groupedId: 'album-1',
          id: 2,
          mediaId: 'photo-2',
        },
        {
          chatId: 'public:nha-trang',
          id: 3,
          mediaId: 'photo-3',
        },
      ],
      { sourceAlias: 'nha-trang' }
    );

    assert.equal(result.offers.length, 1);
    assert.equal(result.materials.total, 2);
    assert.deepEqual(result.materials.terminal, {
      accepted: 1,
      degraded: 1,
      error: 0,
      excluded: 0,
      review: 0,
    });
    assert.equal(result.materials.unaccounted, 0);
    assert.equal(
      result.domainRecords.some(({ type }) => type === 'album'),
      true
    );
    assert.equal(
      result.domainRecords.some(({ type }) => type === 'offer'),
      true
    );
    assert.equal(
      result.domainRecords.some(({ type }) => type === 'parser-run'),
      true
    );
    assert.equal(result.traceRecords.length, result.materials.total);
    assert.deepEqual(
      new Set(result.traceRecords.map(({ status }) => status)),
      new Set(['degraded', 'success'])
    );
  });

  it('makes a parser failure a terminal error while retaining the batch', async () => {
    const result = await reconcileTelegramMaterials(
      [
        {
          chatId: 'public:nha-trang',
          id: 1,
          text: 'Apartment for rent in Nha Trang, 12 million VND/month',
        },
      ],
      {
        extract: async () => {
          const error = new Error('synthetic parser failure');
          error.code = 'PARSER_FAILED';
          throw error;
        },
      }
    );

    assert.deepEqual(result.accepted, []);
    assert.deepEqual(result.reviewQueue, [
      {
        error: 'PARSER_FAILED',
        id: 'telegram-message:public:nha-trang:1',
        reason: 'offer-extraction-failed',
        state: 'error',
      },
    ]);
    assert.equal(result.complete, false);
  });

  it('round-trips, queries, edits, and deletes typed audit links', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'telegram-audit-'));
    temporaryDirectories.push(directory);
    const store = new LinksStore({ binaryMirror: false, directory });
    const batch = await auditTelegramBatch(
      [
        {
          chatId: 'public:nha-trang',
          id: 1,
          text: 'Studio for rent in Nha Trang, 9 million VND/month',
        },
      ],
      { sourceAlias: 'nha-trang' }
    );

    const evidence = await verifyAuditStorage(store, batch.domainRecords);

    assert.deepEqual(evidence, {
      delete: true,
      edit: true,
      query: true,
      roundTrip: true,
    });
    assert.deepEqual(
      await store.loadRecords('audit-records'),
      batch.domainRecords
    );
  });

  it('persists the oldest source position for a later audit run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'telegram-checkpoint-'));
    temporaryDirectories.push(directory);
    const store = new LinksStore({ binaryMirror: false, directory });
    const checkpoint = {
      complete: false,
      id: 'public-source',
      messagesScanned: 3_000,
      oldestMessageDate: '2026-08-01T00:00:00.000Z',
      oldestMessageId: 42,
      state: 'incomplete',
    };

    await saveAuditCheckpoint(store, checkpoint);

    assert.deepEqual(
      await loadAuditCheckpoint(
        new LinksStore({ binaryMirror: false, directory }),
        'public-source'
      ),
      checkpoint
    );
  });
});
