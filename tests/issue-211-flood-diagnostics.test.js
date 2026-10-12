import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import {
  FloodWaitError,
  FrozenMethodInvalidError,
  SlowModeWaitError,
  TwoFaConfirmWaitError,
} from 'teleproto/errors/RPCErrorList.js';
import { tl } from '@mtcute/core';
import { safeAcceptanceFailure } from '../experiments/qa-acceptance-diagnostics.mjs';
import {
  classifyTelegramError,
  retryTelegramOperation,
} from '../src/telegram-errors.js';

const flood = (seconds = '600') => new FloodWaitError({ capture: seconds });
const recognized = (error) => {
  const summary = safeAcceptanceFailure(error, 'source-resolution');
  assert.equal(summary.code, 'FLOOD_WAIT');
  assert.equal(summary.category, 'rate-limited');
  assert.equal(summary.phase, 'source-resolution');
  assert(!JSON.stringify(summary).includes('600'));
  return summary;
};

it('normalizes actual Teleproto and mtcute waits directly and in bounded causes', () => {
  for (const error of [
    flood(),
    tl.RpcError.fromTl({ errorCode: 420, errorMessage: 'FLOOD_WAIT_600' }),
  ]) {
    recognized(error);
    const summary = safeAcceptanceFailure(
      new Error('private', { cause: error }),
      'source-resolution'
    );
    assert.equal(summary.causes[0].category, 'rate-limited');
    assert.equal(summary.causes[0].code, 'FLOOD_WAIT');
    assert.equal(classifyTelegramError(error).delayMs, 600_000);
  }
});

it('rejects other numeric flood subclasses and malformed SDK fields', () => {
  const other = [
    FrozenMethodInvalidError,
    SlowModeWaitError,
    TwoFaConfirmWaitError,
  ];
  for (const error of [
    ...other.map((Type) => new Type({ capture: '600' })),
    { code: 420 },
    {
      code: '420',
      name: 'FloodWaitError',
      seconds: 600,
      errorMessage: 'FLOOD',
    },
    ...['NaN', 'Infinity', '-1', '1.5', '1000000'].map(flood),
    { code: 420, name: 'UnrecognizedError', seconds: 600 },
    {
      code: 420,
      name: 'FloodWaitError',
      seconds: 600,
      errorMessage: 'PRIVATE',
    },
  ]) {
    const summary = safeAcceptanceFailure(error, 'source-resolution');
    assert.equal(summary.category, 'unknown');
    assert.equal(summary.code, undefined);
  }
});

it('never invokes custom getters or coercions and bounds cyclic cause metadata', () => {
  const unsafe = {
    toString() {
      throw new Error('private coercion');
    },
  };
  const accessor = Object.defineProperty({}, 'code', {
    get() {
      throw new Error('private getter');
    },
  });
  for (const error of [
    accessor,
    { code: unsafe, message: unsafe, name: unsafe },
    new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('private proxy');
        },
      }
    ),
  ]) {
    assert.equal(safeAcceptanceFailure(error).category, 'unknown');
  }
  const cycle = new AggregateError([], 'private');
  cycle.errors.push(cycle, ...Array.from({ length: 100 }, () => flood()));
  const summary = safeAcceptanceFailure(cycle, 'source-resolution');
  assert.equal(summary.causes.length, 4);
  assert.equal(summary.causes[1].code, 'FLOOD_WAIT');
  assert(JSON.stringify(summary).length < 2000);
  assert(!JSON.stringify(summary).includes('private'));
});

it('preserves cancellation and defers actual long SDK waits within existing retry bounds', async () => {
  const error = flood();
  let attempts = 0;
  let sleeps = 0;
  const operation = () => {
    attempts += 1;
    throw error;
  };
  await assert.rejects(
    retryTelegramOperation(operation, {
      idempotent: true,
      sleep: async () => {
        sleeps += 1;
      },
    }),
    (failure) => failure === error
  );
  assert.equal(attempts, 1);
  assert.equal(sleeps, 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    retryTelegramOperation(operation, { signal: controller.signal }),
    { name: 'AbortError' }
  );
  assert.equal(attempts, 1);
});
