import assert from 'node:assert/strict';
import { mkdtemp, access, rm, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'test-anywhere';
import {
  QaCleanup,
  qaTemporaryDirectory,
  withQaCleanup,
} from '../experiments/qa-cleanup.mjs';
import {
  QaOwnedMessages,
  readQaHistory,
} from '../experiments/qa-owned-messages.mjs';

describe('QA teardown acceptance', () => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    it(`removes child-owned fixtures after ${signal}`, async () => {
      if (typeof Deno !== 'undefined' || typeof Bun !== 'undefined') {
        return;
      }
      const parent = await mkdtemp(join(tmpdir(), 'qa-signal-'));
      let child;
      try {
        const url = new globalThis.URL(
          '../experiments/qa-cleanup.mjs',
          import.meta.url
        ).href;
        const code = `import {withQaCleanup,qaTemporaryDirectory} from ${JSON.stringify(url)};try{await withQaCleanup(async(scope,signal)=>{await qaTemporaryDirectory(scope);const timer=setInterval(()=>{},1000);scope.defer('timer',()=>clearInterval(timer));console.log('ready');await new Promise((resolve)=>signal.addEventListener('abort',resolve,{once:true}));});}catch{process.exitCode=1;}`;
        child = spawn(process.execPath, ['--input-type=module', '-e', code], {
          env: { ...process.env, TMPDIR: parent, TMP: parent, TEMP: parent },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const ended = new Promise((resolve) => child.once('close', resolve));
        await new Promise((resolve, reject) => {
          child.stdout.once('data', resolve);
          child.once('error', reject);
          child.once('exit', () =>
            reject(new Error('signal fixture exited before readiness'))
          );
        });
        child.kill(signal);
        assert.equal(await ended, 1);
        assert.deepEqual(await readdir(parent), []);
      } finally {
        if (child && child.exitCode === null) {
          child.kill('SIGKILL');
        }
        await rm(parent, { force: true, recursive: true });
      }
    });
  }
  it('attempts all disposers, in reverse order, and rejects false success', async () => {
    const scope = new QaCleanup();
    const calls = [];
    scope.defer('first', () => calls.push('first'));
    scope.defer('broken', () => {
      calls.push('broken');
      throw new Error('private error');
    });
    scope.defer('producer', () => calls.push('producer'));
    assert.deepEqual(await scope.close(), {
      pass: false,
      failures: ['broken'],
    });
    assert.deepEqual(calls, ['producer', 'broken', 'first']);
    await scope.close();
    assert.equal(calls.length, 3);
  });
  it('continues teardown when one disposer stalls', async () => {
    const scope = new QaCleanup({ timeoutMs: 10 });
    let completed = false;
    scope.defer('remaining resource', () => {
      completed = true;
    });
    scope.defer('stalled resource', () => new Promise(() => {}));
    assert.deepEqual(await scope.close(), {
      pass: false,
      failures: ['stalled resource'],
    });
    assert.equal(completed, true);
  });

  it('removes a newly acquired fixture after an assertion failure', async () => {
    if (typeof Deno !== 'undefined') {
      return;
    }
    let directory;
    await assert.rejects(
      withQaCleanup(
        async (scope) => {
          directory = await qaTemporaryDirectory(scope);
          throw new Error('injected assertion');
        },
        { signals: false }
      ),
      /injected assertion/u
    );
    await assert.rejects(access(directory));
  });

  it('a cleanup exception fails an otherwise successful action', async () => {
    await assert.rejects(
      withQaCleanup(
        (scope) => {
          scope.defer('deletion', () => {
            throw new Error('injected deletion');
          });
          return 'passed assertions';
        },
        { signals: false }
      ),
      /cleanup failed: deletion/u
    );
  });

  it('marks texts, photos and every album item before sending', async () => {
    const ledger = new QaOwnedMessages({ marker: 'qa-self-authored-1234' });
    let transformer;
    ledger.install(
      {
        config: {
          use: (fn) => {
            transformer = fn;
          },
        },
      },
      'owner'
    );
    const payloads = [];
    const send = async (_method, payload) => {
      payloads.push(payload);
      return { ok: true, result: { message_id: payloads.length } };
    };
    await transformer(send, 'sendMessage', {
      chat_id: 'owner',
      text: 'rental',
    });
    await transformer(send, 'sendPhoto', {
      chat_id: 'owner',
      photo: 'fixture',
    });
    await transformer(send, 'sendMediaGroup', {
      chat_id: 'owner',
      media: [
        { type: 'photo', media: 'a' },
        { type: 'photo', media: 'b', caption: 'offer' },
      ],
    });
    assert(payloads[0].text.includes(ledger.marker));
    assert(payloads[1].caption.includes(ledger.marker));
    assert(
      payloads[2].media.every((item) => item.caption.includes(ledger.marker))
    );
    await assert.rejects(
      transformer(send, 'sendMessage', { chat_id: 'other', text: 'no' })
    );
    assert.equal(payloads.length, 3);
    assert.equal(ledger.botIds.size, 3);
    assert.equal(ledger.ids.size, 0);
    assert.equal(
      ledger.owns({ id: 1, message: 'unrelated native message' }),
      false
    );
  });

  it('recovers ambiguous sends and preserves unrelated same-window messages', async () => {
    const ledger = new QaOwnedMessages({
      marker: 'qa-self-authored-1234',
      baseline: 5,
    });
    let messages = [
      { id: 1, message: ledger.marker },
      { id: 6, message: 'unrelated user message' },
      { id: 7, message: `${ledger.marker}\nnotification` },
      { id: 8, message: '', className: 'MessageService' },
      { id: 9, message: '' },
    ];
    await ledger.record({ id: 9 });
    const removed = [];
    const result = await ledger.cleanup({
      read: async () => messages,
      remove: async (ids) => {
        removed.push(...ids);
        messages = messages.filter((message) => !ids.includes(message.id));
      },
    });
    assert.equal(result.pass, true);
    assert.deepEqual(removed, [7, 9]);
    assert.deepEqual(
      messages.map((message) => message.id),
      [1, 6, 8]
    );
  });

  it('does not trust an accepted deletion with surviving messages', async () => {
    const ledger = new QaOwnedMessages({ marker: 'qa-self-authored-1234' });
    const result = await ledger.cleanup({
      read: async () => [{ id: 4, message: ledger.marker }],
      remove: async () => {},
    });
    assert.equal(result.pass, false);
    assert.equal(result.leftovers, 1);
  });

  it('retries failed deletions and independently verifies success', async () => {
    const ledger = new QaOwnedMessages({ marker: 'qa-self-authored-1234' });
    let messages = [{ id: 4, message: ledger.marker }];
    let attempts = 0;
    const result = await ledger.cleanup({
      read: async () => messages,
      remove: async () => {
        if (++attempts === 1) {
          throw new Error('transient');
        }
        messages = [];
      },
    });
    assert.equal(result.pass, true);
    assert.equal(attempts, 2);
  });

  it('pages beyond the first 100 messages and rejects stuck pagination', async () => {
    const values = Array.from({ length: 230 }, (_unused, index) => ({
      id: 230 - index,
    }));
    const client = {
      getMessages: async (_target, { offsetId, limit }) =>
        values.filter(({ id }) => !offsetId || id < offsetId).slice(0, limit),
    };
    assert.equal((await readQaHistory(client, 'owner')).length, 230);
    await assert.rejects(
      readQaHistory({ getMessages: async () => [{ id: 1 }] }, 'owner'),
      /did not advance/u
    );
  });

  it('restores an ownership journal after a lost process', async () => {
    if (typeof Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'qa-journal-'));
    try {
      const journal = join(directory, 'owned.json');
      const ledger = new QaOwnedMessages({
        marker: 'qa-self-authored-1234',
        journal,
      });
      await ledger.record({ id: 4 });
      const restored = await QaOwnedMessages.restore(journal);
      assert(restored.owns({ id: 4, message: '' }));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
