import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import {
  annotateDockerFailure,
  safeQaFailure,
} from '../experiments/qa-docker-diagnostics.mjs';

describe('bounded Docker failure diagnostics', () => {
  it('identifies image pull lease failures and start/exec without exposing arguments', () => {
    for (const operation of ['pull', 'start', 'exec']) {
      const error = annotateDockerFailure(
        Object.assign(new Error('private image'), {
          stderr: 'lease does not exist: not found',
          code: 1,
        }),
        [operation, 'private-image-or-container']
      );
      const report = safeQaFailure(error);
      assert.equal(report.operation, operation);
      assert.equal(report.category, 'command-failure');
      assert(!JSON.stringify(report).includes('private'));
    }
  });
  it('preserves operation and cause categories without raw resource or credential material', () => {
    const privateValue = 'private-resource-path-token';
    for (const [stderr, category] of [
      [`write ${privateValue}: input/output error`, 'storage-io'],
      [`${privateValue}: no space left on device`, 'storage-capacity'],
      [`failed to fetch ${privateValue}: EOF`, 'external-acquisition'],
      [`${privateValue} timed out`, 'command-timeout'],
    ]) {
      const error = Object.assign(new Error(privateValue), { stderr, code: 1 });
      annotateDockerFailure(error, ['buildx', 'build', '--tag', privateValue]);
      const report = safeQaFailure(error);
      assert.equal(report.operation, 'buildx build');
      assert.equal(report.category, category);
      assert.equal(report.code, 1);
      assert.equal(JSON.stringify(report).includes(privateValue), false);
    }
  });

  it('keeps the original acquisition failure when teardown adds a nested failure', () => {
    const original = annotateDockerFailure(
      Object.assign(new Error('private output'), {
        stderr: 'input/output error',
        code: 1,
      }),
      ['buildx', 'build']
    );
    const error = new AggregateError([original], 'private cleanup names');
    const report = safeQaFailure(error);
    assert.equal(report.category, 'cleanup-failure');
    assert.equal(report.causes[0].operation, 'buildx build');
    assert.equal(report.causes[0].category, 'storage-io');
    assert.equal(JSON.stringify(report).includes('private'), false);
  });

  it('bounds recursive diagnostics and rejects arbitrary error metadata', () => {
    const error = new AggregateError([], 'private');
    error.errors.push(
      error,
      ...Array.from({ length: 100 }, () => ({
        qaOperation: 'private-resource',
        qaCategory: 'private-token',
        code: 'PRIVATE_TOKEN',
        signal: 'PRIVATE_SIGNAL',
      }))
    );
    const report = safeQaFailure(error);
    assert(report.causes.length <= 4);
    assert(JSON.stringify(report).length < 1500);
    assert(!JSON.stringify(report).includes('PRIVATE'));
    assert(!JSON.stringify(report).includes('private'));
  });
});
