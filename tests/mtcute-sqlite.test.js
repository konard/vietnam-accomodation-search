import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'test-anywhere';
import { createMtcuteClient } from '../src/telegram-user.js';

describe('maintained native SQLite used by mtcute', () => {
  it('resolves the upstream N-API addon with maintained installation dependencies', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const require = createRequire(import.meta.url);
    const mtcuteRequire = createRequire(require.resolve('@mtcute/node'));
    const sqlite = mtcuteRequire('better-sqlite3/package.json');
    assert.equal(sqlite.version, '13.0.3');
    assert.equal(sqlite.dependencies['prebuild-install'], undefined);
    for (const path of [
      '../package-lock.json',
      '../examples/universal-app/package-lock.json',
    ]) {
      const lock = JSON.parse(
        await readFile(new globalThis.URL(path, import.meta.url), 'utf8')
      );
      assert(
        !Object.keys(lock.packages).some((path) =>
          path.endsWith('/prebuild-install')
        )
      );
    }
  });

  it('runs actual mtcute schema migrations, WAL, key transactions, restart, and deletes', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const { NodePlatform, SqliteStorage } = await import('@mtcute/node');
    const { LogManager } = await import('@mtcute/core/utils.js');
    const directory = await mkdtemp(join(tmpdir(), 'mtcute-sqlite-'));
    const filename = join(directory, 'session.sqlite');
    const key = new Uint8Array([1, 2, 3, 255]);
    let storage;
    const open = async () => {
      storage = new SqliteStorage(filename);
      const platform = new NodePlatform();
      storage.driver.setup(new LogManager('qa', platform), platform);
      await storage.driver.load();
    };
    try {
      await open();
      assert.equal(
        storage.driver.db.pragma('journal_mode', { simple: true }),
        'wal'
      );
      storage.kv.set('qa-key', key);
      storage.authKeys.set(2, key);
      storage.authKeys.setTemp(2, 1, key, 1000);
      await storage.driver.save();
      await storage.driver.destroy();
      storage = undefined;
      await open();
      assert.deepEqual(new Uint8Array(storage.kv.get('qa-key')), key);
      assert.deepEqual(new Uint8Array(storage.authKeys.get(2)), key);
      assert.deepEqual(
        new Uint8Array(storage.authKeys.getTemp(2, 1, 999)),
        key
      );
      assert.equal(storage.authKeys.getTemp(2, 1, 1001), null);
      storage.kv.delete('qa-key');
      storage.authKeys.deleteByDc(2);
      assert.equal(storage.kv.get('qa-key'), null);
      assert.equal(storage.authKeys.get(2), null);
    } finally {
      await storage?.driver.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('constructs and destroys the production Telegram client without sending or authenticating', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const client = await createMtcuteClient({
      apiId: 1,
      apiHash: '0'.repeat(32),
    });
    assert.equal(typeof client.iterHistory, 'function');
    assert.equal(typeof client.downloadAsBuffer, 'function');
    await client.destroy();
  });
});
