import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { errorSummary } from '../experiments/telegram-accommodation-audit-lib.mjs';

it('retains owned private gate evidence in the real source command', async () => {
  if (typeof globalThis.Deno !== 'undefined') {
    return;
  }
  await import('../experiments/revalidation-source-acceptance-diagnostics.mjs');
});

it('requires complete numeric history accounting', async () => {
  if (typeof globalThis.Deno !== 'undefined') {
    return;
  }
  const { historyCoverageComplete } =
    await import('../experiments/telegram-90-day-coverage-audit.mjs');
  const valid = {
    complete: true,
    messages: 0,
    counts: {
      messages: 0,
      uniqueMessageIds: 0,
      accountedMessages: 0,
      parserErrors: 0,
    },
  };
  assert(historyCoverageComplete([valid], 1));
  assert(!historyCoverageComplete([], 0));
  assert(!historyCoverageComplete(new Array(1), 1));
  assert(!historyCoverageComplete([{ complete: true }], 1));
  assert(!historyCoverageComplete([{ ...valid, counts: undefined }], 1));
  assert(!historyCoverageComplete([{ ...valid, messages: 1 }], 1));
  assert(
    !historyCoverageComplete(
      [{ ...valid, counts: { ...valid.counts, parserErrors: 1 } }],
      1
    )
  );
  assert(!historyCoverageComplete([valid], 2));
});

it('keeps finite guard and nested cleanup diagnostics without private metadata', () => {
  const original = Object.assign(new Error('/private/source/token'), {
    code: 'QA_HEAVY_BUSY',
    qaPhase: 'storage-guard',
  });
  const summary = errorSummary(
    new AggregateError([original], 'private disposer')
  );
  assert.equal(summary.category, 'cleanup-failure');
  assert.equal(summary.causes[0].code, 'QA_HEAVY_BUSY');
  assert.equal(summary.causes[0].phase, 'storage-guard');
  assert(!JSON.stringify(summary).includes('private'));
  assert(
    !JSON.stringify(
      errorSummary({
        code: 'PRIVATE_SOURCE_TOKEN',
        constructor: { name: 'PRIVATE_SOURCE_TOKEN' },
      })
    ).includes('PRIVATE')
  );
});

it('classifies generic transport errors and Telegram RPC errors with finite phases', () => {
  const transport = errorSummary(
    Object.assign(new Error('connect ETIMEDOUT private.endpoint'), {
      qaPhase: 'history-page',
    })
  );
  assert.equal(transport.category, 'transport-failure');
  assert.equal(transport.phase, 'history-page');
  const rpc = errorSummary({
    errorMessage: 'CHANNEL_PRIVATE',
    qaPhase: 'source-resolution',
  });
  assert.equal(rpc.code, 'CHANNEL_PRIVATE');
  assert.equal(rpc.category, 'source-unavailable');
  const error = new AggregateError([], 'secret');
  error.errors.push(error, ...Array.from({ length: 100 }, () => error));
  assert(JSON.stringify(errorSummary(error)).length < 2000);
});
