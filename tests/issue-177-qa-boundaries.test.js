/* eslint local/no-changelog-comments: ["warn", {"allowDatesInStrings": true}] -- Dates are fixed fixture inputs. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'test-anywhere';
import { QaOwnedMessages } from '../experiments/qa-owned-messages.mjs';
import { QaDockerCleanup } from '../experiments/qa-docker-cleanup.mjs';

it('marks actual grammY sends, recovers a lost response and strips only the owner command suffix', async () => {
  if (typeof Deno !== 'undefined') {
    return;
  }
  const { Api } = await import('grammy');
  const { installQaApiBoundary } =
    await import('../experiments/qa-bot-preload.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'qa-preload-'));
  const marker = 'qa-preload-self-authored-1234';
  const journal = join(directory, 'messages.json');
  let restore;
  try {
    restore = installQaApiBoundary({ marker, owner: '123', journal });
    const sends = [];
    const api = new Api('456:self-authored', {
      fetch: async (url, request) => {
        const method = url.split('/').at(-1);
        let result;
        if (method === 'getUpdates') {
          result = [
            {
              message: {
                chat: { id: 123 },
                text: `/search Nha Trang\n${marker}`,
              },
            },
            { message: { chat: { id: 999 }, text: `unrelated\n${marker}` } },
          ];
        } else {
          sends.push(JSON.parse(request.body));
          assert(JSON.parse(await readFile(journal, 'utf8')).marker === marker);
          result =
            method === 'sendMediaGroup'
              ? [{ message_id: 2 }, { message_id: 3 }]
              : { message_id: 1 };
        }
        return new globalThis.Response(JSON.stringify({ ok: true, result }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    await api.sendMessage(123, 'reply');
    await api.sendPhoto(123, 'remote-photo');
    await api.sendMediaGroup(123, [
      { type: 'photo', media: 'remote-a' },
      { type: 'photo', media: 'remote-b' },
    ]);
    assert(sends[0].text.startsWith(marker));
    assert(sends[1].caption.startsWith(marker));
    assert(sends[2].media.every((item) => item.caption.startsWith(marker)));
    assert.deepEqual(
      [...(await QaOwnedMessages.restore(journal)).botIds],
      [1, 2, 3]
    );
    const updates = await api.getUpdates();
    assert.equal(updates[0].message.text, '/search Nha Trang');
    assert.equal(updates[1].message.text, `unrelated\n${marker}`);
    await assert.rejects(api.sendMessage(999, 'foreign owner'));
    const ambiguous = new Api('456:self-authored', {
      fetch: async () => {
        throw new Error('lost send response');
      },
    });
    await assert.rejects(ambiguous.sendMessage(123, 'notification'));
    const recovered = await QaOwnedMessages.restore(journal);
    assert(recovered.owns({ id: 100, message: `${marker}\nnotification` }));
    assert(!recovered.owns({ id: 101, message: 'unrelated notification' }));
  } finally {
    restore?.();
    await rm(directory, { recursive: true, force: true });
  }
});

it('durably reserves Docker tags and builders before acquisition and restores ownership after process loss', async () => {
  if (typeof Deno !== 'undefined') {
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), 'qa-docker-journal-'));
  try {
    const baseline = {
      containers: [],
      networks: [],
      volumes: [],
      images: [],
      builders: ['default'],
    };
    const journal = join(directory, 'owned.json');
    const original = new QaDockerCleanup({
      runId: 'vac-qa-journal-self-authored-1234',
      baseline,
      journal,
      projectName: 'qa-drill-1234',
    });
    original.ownImage('qa-drill-1234:candidate');
    original.ownBuilder(`${original.runId}-builder`);
    await original.save();
    const restored = await QaDockerCleanup.restore(journal);
    assert.deepEqual(restored.baseline, baseline);
    assert.deepEqual([...restored.imageRefs], ['qa-drill-1234:candidate']);
    assert.deepEqual([...restored.builders], [`${original.runId}-builder`]);
    assert.equal(restored.projectName, 'qa-drill-1234');
    await assert.rejects(
      QaDockerCleanup.restore(join(directory, 'absent.json'))
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('removes the known Bun compiler cache but fails acceptance on a similarly named fixture', async () => {
  if (typeof Deno !== 'undefined') {
    return;
  }
  const { runCleanTests } = await import('../scripts/test-with-cleanup.mjs');
  for (const [name, expected] of [
    ['bunx-1001-node-gyp@latest', 0],
    ['bunx-1001-owned-fixture', 1],
  ]) {
    const code = await runCleanTests([
      process.execPath,
      '-e',
      `require('node:fs').mkdirSync(require('node:path').join(process.env.TMPDIR, '${name}'));`,
    ]);
    assert.equal(code, expected);
  }
});
