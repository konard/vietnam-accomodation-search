import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'test-anywhere';
import { withQaCleanup } from '../experiments/qa-cleanup.mjs';
import {
  acquireQaBrowser,
  browserPidsForProfile,
} from '../experiments/qa-browser.mjs';

describe('audit profile ownership', () => {
  it('matches exact owned profile arguments in macOS process snapshots', () => {
    const profile = '/private/tmp/self-authored QA.profile';
    const argument = `--user-data-dir=${profile}`;
    const snapshot = [
      `101 /self-authored-browser ${argument} --headless`,
      `102 /self-authored-browser "${argument}"`,
      `103 /self-authored-browser --user-data-dir="${profile}"`,
      `104 /self-authored-browser '${argument}'`,
      `105 /self-authored-browser --user-data-dir='${profile}'`,
      `201 /unrelated-browser ${argument}-unrelated`,
      `202 /unrelated-browser --other=${argument}`,
      '203 /unrelated-browser --user-data-dir=/private/tmp/unrelated',
      'not a process row',
    ].join('\n');
    assert.deepEqual(
      browserPidsForProfile(snapshot, profile),
      [101, 102, 103, 104, 105]
    );
    assert.deepEqual(browserPidsForProfile('', profile), []);
  });

  for (const outcome of [
    'success',
    'launch-failure',
    'navigation-failure',
    'SIGINT',
    'SIGTERM',
  ]) {
    it(`removes only the owned profile on ${outcome}`, async () => {
      if (typeof Deno !== 'undefined') {
        return;
      }
      const root = await mkdtemp(join(tmpdir(), 'vac-profile-test-'));
      const calls = [];
      try {
        await writeFile(join(root, 'evidence.txt'), 'retained');
        await writeFile(join(root, 'unrelated-profile'), 'retained');
        let failure;
        try {
          await withQaCleanup(async (scope, signal) => {
            const resource = await acquireQaBrowser(
              scope,
              async (profile) => {
                await writeFile(join(profile, 'cache'), 'disposable');
                if (outcome === 'launch-failure') {
                  throw new Error('launch failed');
                }
                return {
                  browser: {
                    close: async () => {
                      calls.push('browser');
                    },
                  },
                };
              },
              { signal, temporaryRoot: root }
            );
            resource.setCommander({
              destroy: async () => {
                calls.push('commander');
              },
            });
            resource.setTrace({
              stop: async () => {
                calls.push('trace');
              },
            });
            if (outcome.startsWith('SIG')) {
              process.emit(outcome);
              signal.throwIfAborted();
            }
            if (outcome === 'navigation-failure') {
              throw new Error('navigation failed');
            }
            await resource.close();
          });
        } catch (error) {
          failure = error;
        }
        assert.equal(!!failure, outcome !== 'success');
        assert.deepEqual((await readdir(root)).sort(), [
          'evidence.txt',
          'unrelated-profile',
        ]);
        assert.deepEqual(
          calls,
          outcome === 'launch-failure' ? [] : ['trace', 'commander', 'browser']
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  it('fails acceptance when close fails, and preserves a still-owned live profile', async () => {
    if (typeof Deno !== 'undefined') {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'vac-profile-error-'));
    try {
      await assert.rejects(
        withQaCleanup(
          async (scope) => {
            const resource = await acquireQaBrowser(
              scope,
              async () => ({
                browser: {
                  close: async () => {
                    throw new Error('close failed');
                  },
                },
              }),
              { temporaryRoot: root }
            );
            await resource.close();
          },
          { signals: false }
        ),
        /QA cleanup failed/u
      );
      assert.equal((await readdir(root)).length, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
