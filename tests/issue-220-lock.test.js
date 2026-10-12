import { describe, it, expect } from 'test-anywhere';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireOperationLock,
  recoverOperationLock,
} from '../scripts/owned-operation-lock.mjs';

describe('exact deployment lock recovery', () => {
  it('rejects competitors and recovery of live, foreign or changed owners', async () => {
    if (typeof Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'vac-lock-'));
    try {
      const path = join(directory, 'operation.lock');
      const lock = await acquireOperationLock(path);
      let rejected = false;
      try {
        await acquireOperationLock(path);
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
      const evidence = join(directory, 'recovery.json');
      await writeFile(evidence, JSON.stringify(lock.owner), { mode: 0o600 });
      for (const changed of [
        { ...lock.owner, token: '0'.repeat(64) },
        { ...lock.owner, host: 'different-host' },
      ]) {
        await writeFile(evidence, JSON.stringify(changed));
        let denied = false;
        try {
          await recoverOperationLock(path, evidence, {
            producersStopped: true,
            alive: () => false,
          });
        } catch {
          denied = true;
        }
        expect(denied).toBe(true);
      }
      await writeFile(evidence, JSON.stringify(lock.owner));
      for (const options of [
        {},
        { producersStopped: true, alive: () => true },
      ]) {
        rejected = false;
        try {
          await recoverOperationLock(path, evidence, options);
        } catch {
          rejected = true;
        }
        expect(rejected).toBe(true);
      }
      await recoverOperationLock(path, evidence, {
        producersStopped: true,
        alive: () => false,
      });
      const next = await acquireOperationLock(path);
      expect(next.owner.token === lock.owner.token).toBe(false);
      await next.release();
      await writeFile(join(directory, 'unrelated'), 'kept');
      expect(await readFile(join(directory, 'unrelated'), 'utf8')).toBe('kept');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
