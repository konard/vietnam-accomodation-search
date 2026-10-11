import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'test-anywhere';
import { withQaCleanup } from '../experiments/qa-cleanup.mjs';
import { acquireQaStorageGuard } from '../experiments/qa-storage-guard.mjs';

describe('bounded storage-heavy QA acceptance', () => {
  it('rejects OCR language acquisition after the capacity signal aborts', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const { verifyTesseractLanguages } =
      await import('../experiments/audit-telegram-accommodations.mjs');
    const controller = new AbortController();
    const reason = Object.assign(new Error('QA_DISK_FLOOR'), {
      code: 'QA_DISK_FLOOR',
    });
    controller.abort(reason);
    let acquired = false;
    await assert.rejects(
      verifyTesseractLanguages(
        'self-authored-ocr-command',
        async () => {
          acquired = true;
          return 'eng\nrus\nvie';
        },
        { signal: controller.signal }
      ),
      (error) => error === reason
    );
    assert.equal(acquired, false);
  });
  it('rejects an older retained audit before OCR or native acquisition when its storage guard fails', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const { runAudit } =
      await import('../experiments/audit-telegram-accommodations.mjs');
    const root = await mkdtemp(join(tmpdir(), 'vac-storage-audit-'));
    const reason = Object.assign(new Error('QA_DISK_PREFLIGHT'), {
      code: 'QA_DISK_PREFLIGHT',
    });
    try {
      await assert.rejects(
        runAudit(
          {
            stateDirectory: root,
            tesseractCommand: 'self-authored-ocr-command-that-does-not-exist',
          },
          {
            storageGuard: async () => {
              throw reason;
            },
          }
        ),
        (error) => error === reason
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('keeps the heavy-run lock for explicit recovery when producer cleanup fails', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'vac-storage-test-'));
    const lockDirectory = join(root, 'heavy.lock');
    try {
      await assert.rejects(
        withQaCleanup(async (scope) => {
          await acquireQaStorageGuard(scope, {
            paths: [root],
            lockDirectory,
            statfsImpl: async () => ({ bavail: 20n * 1024n ** 3n, bsize: 1n }),
          });
          scope.defer('owned producer', () => {
            throw new Error('self-authored producer cleanup failure');
          });
        }),
        /QA cleanup failed/u
      );
      await access(join(lockDirectory, 'owner.json'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('rejects low space and unreadable capacity before acquiring a producer', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'vac-storage-test-'));
    try {
      for (const statfsImpl of [
        async () => ({ bavail: 1n, bsize: 1n }),
        async () => {
          throw new Error('private path and storage details');
        },
        async () => ({ bavail: NaN, bsize: 1 }),
        () => new Promise(() => {}),
      ]) {
        let acquired = false;
        await assert.rejects(
          withQaCleanup(async (scope) => {
            await acquireQaStorageGuard(scope, {
              paths: [root],
              lockDirectory: join(root, 'heavy.lock'),
              statfsImpl,
              checkTimeoutMs: 10,
            });
            acquired = true;
          }),
          /QA_DISK_PREFLIGHT|QA_CAPACITY_UNAVAILABLE/u
        );
        assert.equal(acquired, false);
        await assert.rejects(access(join(root, 'heavy.lock')));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('serializes participating processes and never steals an existing lock', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'vac-storage-test-'));
    const lockDirectory = join(root, 'heavy.lock');
    const options = {
      paths: [root],
      lockDirectory,
      statfsImpl: async () => ({ bavail: 20n * 1024n ** 3n, bsize: 1n }),
    };
    try {
      await withQaCleanup(async (scope) => {
        const guard = await acquireQaStorageGuard(scope, options);
        await assert.rejects(
          withQaCleanup((second) => acquireQaStorageGuard(second, options)),
          /QA_HEAVY_BUSY/u
        );
        await access(lockDirectory);
        await guard.check();
      });
      await assert.rejects(access(lockDirectory));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('aborts an acquired producer and retains its recovery journal while exact cleanup runs', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'vac-storage-test-'));
    const owned = join(root, 'owned-producer');
    const journal = join(root, 'recovery.json');
    const unrelated = join(root, 'unrelated');
    let available = 20n * 1024n ** 3n;
    let stopped = false;
    try {
      await writeFile(unrelated, 'preserve');
      await assert.rejects(
        withQaCleanup(async (scope) => {
          const guard = await acquireQaStorageGuard(scope, {
            paths: [root],
            lockDirectory: join(root, 'heavy.lock'),
            pollMs: 5,
            statfsImpl: async () => ({ bavail: available, bsize: 1n }),
          });
          await writeFile(journal, '{}');
          await writeFile(owned, 'bounded producer fixture');
          scope.defer('exact producer', async () => {
            assert.equal(stopped, true);
            await rm(owned);
          });
          available = 1n;
          await new Promise((resolve) =>
            guard.signal.addEventListener(
              'abort',
              () => {
                stopped = true;
                resolve();
              },
              { once: true }
            )
          );
          guard.signal.throwIfAborted();
        }),
        /QA_DISK_FLOOR/u
      );
      await assert.rejects(access(owned));
      assert.equal(await readFile(unrelated, 'utf8'), 'preserve');
      assert.equal(await readFile(journal, 'utf8'), '{}');
      await assert.rejects(access(join(root, 'heavy.lock')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
