/* eslint local/no-changelog-comments: ["warn", {allowDatesInStrings:true}] -- Fixed dates are synthetic test inputs. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { MtcuteTelegramProvider } from '../src/telegram-mtcute.js';
import { TelegramIngestionService } from '../src/telegram-ingestion.js';
import { safeAcceptanceFailure } from '../experiments/qa-acceptance-diagnostics.mjs';

it('retries an idempotent source resolution transport error, and keeps fatal phase evidence', async () => {
  let attempts = 0;
  const client = {
    start: async () => {},
    destroy: async () => {},
    getMe: async () => ({ id: 1 }),
    resolvePeer: async () => {
      attempts++;
      if (attempts === 1) {
        throw Object.assign(new Error('private source transport'), {
          code: 'ECONNRESET',
        });
      }
      return { userId: 2 };
    },
    async *iterHistory() {},
  };
  const provider = new MtcuteTelegramProvider({
    apiId: 1,
    apiHash: 'synthetic',
    session: 'synthetic',
    clientFactory: async () => client,
  });
  try {
    const history = await provider.history(
      { id: 'telegram:synthetic' },
      { retry: { sleep: async () => {} } }
    );
    for await (const ignored of history) {
      void ignored;
    }
    assert.equal(attempts, 2);
    client.resolvePeer = async () => {
      throw Object.assign(new Error('private membership'), {
        code: 'CHANNEL_PRIVATE',
      });
    };
    let failure;
    try {
      await provider.history({ id: 'telegram:synthetic' });
    } catch (error) {
      failure = error;
    }
    assert.equal(safeAcceptanceFailure(failure).phase, 'source-resolution');
    assert.equal(safeAcceptanceFailure(failure).category, 'source-unavailable');
    assert.ok(
      !JSON.stringify(safeAcceptanceFailure(failure)).includes('membership')
    );
  } finally {
    await provider.destroy();
  }
});

it('persists an incomplete source checkpoint before a resolution failure without losing progress', async () => {
  const collections = new Map([
    [
      'telegram-ingestion-checkpoints',
      [
        {
          id: 'synthetic',
          complete: false,
          oldestMessageId: 7,
          oldestMessageDate: '2026-10-01',
        },
      ],
    ],
  ]);
  const store = {
    loadRecords: async (kind) => collections.get(kind) || [],
    saveRecords: async (kind, rows) => collections.set(kind, rows),
  };
  const service = new TelegramIngestionService({
    store,
    provider: {
      history: async () => {
        throw Object.assign(new Error('private'), {
          code: 'ECONNRESET',
          qaPhase: 'source-resolution',
        });
      },
      destroy: async () => {},
    },
    now: () => new Date('2026-10-12'),
  });
  await assert.rejects(service.start([{ id: 'synthetic' }]), /private/u);
  const checkpoint = collections.get('telegram-ingestion-checkpoints')[0];
  assert.equal(checkpoint.complete, false);
  assert.equal(checkpoint.oldestMessageId, 7);
  assert.equal(checkpoint.failure.phase, 'source-resolution');
});
