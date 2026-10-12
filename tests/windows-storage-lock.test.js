import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import { staleLock } from '../src/links-store.js';

describe('Windows storage lock metadata contention', () => {
  for (const code of ['EPERM', 'EACCES']) {
    it(`keeps an unreadable ${code} owner occupied until the next attempt`, async () => {
      const error = Object.assign(new Error('owner is pending deletion'), {
        code,
      });
      let reads = 0;
      const readOwner = async () => {
        reads += 1;
        if (reads === 1) {
          throw error;
        }
        return JSON.stringify({ pid: process.pid });
      };
      const statPath = () => {
        throw new Error('Unreadable ownership must never authorize recovery.');
      };
      assert.equal(
        await staleLock('/contended-lock', statPath, {
          platform: 'win32',
          readOwner,
        }),
        false
      );
      assert.equal(reads, 1);
      assert.equal(
        await staleLock('/contended-lock', statPath, {
          platform: 'win32',
          readOwner,
        }),
        false
      );
      assert.equal(reads, 2);
    });
  }

  it('preserves permission and unexpected errors outside Windows contention', async () => {
    for (const [platform, code] of [
      ['linux', 'EPERM'],
      ['darwin', 'EACCES'],
      ['win32', 'EIO'],
    ]) {
      const error = Object.assign(new Error('inspection failed'), { code });
      await assert.rejects(
        staleLock('/unreadable-lock', undefined, {
          platform,
          readOwner: async () => {
            throw error;
          },
        }),
        (caught) => caught === error
      );
    }
  });
});
