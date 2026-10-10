#!/usr/bin/env node
// Owner-only real subscription delivery + assertion-failure cleanup check.
// --remove-legacy-cutover authorizes deletion only of the exact self-authored
// fixture shown by the user, and only when sent by the verified credential bot.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { InputFile } from 'grammy';
import { chromium } from 'playwright';
import { createApplication } from '../src/index.js';
import { assertManualLocalRun } from './telegram-accommodation-audit-lib.mjs';
import {
  botCredentials,
  environmentFile,
  getBotIdentity,
  userCredentials,
  withDeadline,
} from './telegram-bot-conversation-e2e.mjs';
import { qaTemporaryDirectory, withQaCleanup } from './qa-cleanup.mjs';
import { QaOwnedMessages, readQaHistory } from './qa-owned-messages.mjs';

assertManualLocalRun(process.env);
assert.equal(process.env.QA_CLEANUP_LIVE, '1');
const args = process.argv.slice(2);
const paths = {};
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--remove-legacy-cutover') {
    paths.legacy = true;
  } else if (args[index] === '--media') {
    paths.media = true;
  } else if (args[index] === '--recover-owned-markers') {
    paths.recover = true;
  } else {
    assert(['--bot-env', '--user-env', '--outcome'].includes(args[index]));
    paths[args[index].slice(2)] = args[++index];
  }
}
assert(paths['bot-env'] && paths['user-env']);
const outcome = paths.outcome || 'assertion-failure';
assert(
  ['success', 'assertion-failure', 'SIGINT', 'SIGTERM', 'audit'].includes(
    outcome
  )
);
const result = { pass: false, outcome };
async function recoverOwned(client, target, identity, read) {
  const found = (await read()).filter(
    (message) =>
      !message.out &&
      String(message.senderId) === identity.id &&
      /^qa-cleanup-[0-9a-f]{16}\n/u.test(message.message || '')
  );
  if (found.length) {
    await client.deleteMessages(
      target,
      found.map((message) => message.id),
      { revoke: true }
    );
  }
  const fresh = await read();
  assert(
    !fresh.some((message) => found.some((owned) => message.id === owned.id))
  );
  return found.length;
}
try {
  // eslint-disable-next-line max-lines-per-function, max-statements -- One owner-chat lifecycle keeps all cleanup on a single scope.
  await withQaCleanup(async (scope, signal) => {
    const directory = await qaTemporaryDirectory(scope, 'vac-live-cleanup-');
    const secret = await botCredentials(
      await environmentFile(paths['bot-env'])
    );
    const identity = await getBotIdentity(
      secret.token,
      secret.token.split(':')[0]
    );
    const user = await userCredentials(
      await environmentFile(paths['user-env'])
    );
    const client = new TelegramClient(
      new StringSession(user.session),
      user.apiId,
      user.apiHash,
      { autoReconnect: false, connectionRetries: 2, requestRetries: 2 }
    );
    client.setLogLevel('none');
    scope.defer('driver destroy', () =>
      withDeadline(() => client.destroy(), 10_000, 'driver destroy')
    );
    scope.defer('driver disconnect', () =>
      withDeadline(() => client.disconnect(), 10_000, 'driver disconnect')
    );
    await withDeadline(() => client.connect(), 20_000, 'driver connect');
    assert(await client.checkAuthorization());
    const owner = String((await client.getMe()).id);
    assert.notEqual(owner, identity.id);
    const target = await client.getEntity(`@${identity.username}`);
    const read = () =>
      withDeadline(() => readQaHistory(client, target), 20_000, 'history');
    if (paths.recover) {
      result.recoveredOwnedMessages = await recoverOwned(
        client,
        target,
        identity,
        read
      );
    }
    const before = await read();
    if (outcome === 'audit') {
      result.remainingKnownQaMessages = before.filter((message) =>
        /qa-cleanup-[0-9a-f]{16}|real-source-e2e-[0-9a-f]{16}|Self-authored QA rental|E2E synthetic offer [0-9a-f]{10}|cutover-[0-9a-f]{12}/u.test(
          message.message || ''
        )
      ).length;
      assert.equal(result.remainingKnownQaMessages, 0);
      return;
    }
    if (paths.legacy) {
      const old = before.filter(
        (message) =>
          !message.out &&
          String(message.senderId) === identity.id &&
          message.message === '1. Self-authored QA rental\n13,000,000 VND/month'
      );
      if (old.length) {
        await client.deleteMessages(
          target,
          old.map((message) => message.id),
          { revoke: true }
        );
      }
      result.legacyDeleted = old.length;
      const fresh = await read();
      assert(
        !fresh.some((message) => old.some((owned) => owned.id === message.id))
      );
      result.legacyReadbackClean = true;
    }
    const baseline = Math.max(0, ...before.map((message) => message.id));
    const marker = `qa-cleanup-${randomBytes(8).toString('hex')}`;
    const ledger = new QaOwnedMessages({
      marker,
      baseline,
      journal: join(directory, 'owned.json'),
    });
    await ledger.save();
    scope.defer('owned messages', async () => {
      // Reconstruct the ledger as a restarted/recovery process would.
      const restored = await QaOwnedMessages.restore(ledger.journal);
      result.cleanup = await restored.cleanup({
        read,
        remove: (ids) => client.deleteMessages(target, ids, { revoke: true }),
      });
      assert(result.cleanup.pass);
      const after = await read();
      result.unrelatedPreserved = before
        .filter(
          (message) =>
            message.className === 'Message' &&
            !(
              !message.out &&
              message.message ===
                '1. Self-authored QA rental\n13,000,000 VND/month' &&
              paths.legacy
            )
        )
        .every((original) =>
          after.some((message) => message.id === original.id)
        );
      assert(result.unrelatedPreserved);
    });
    const application = createApplication({ directory, binaryMirror: false });
    await application.store.saveOffers([
      {
        id: 'self-authored-cleanup',
        sourceId: 'qa-cleanup',
        title: `Self-authored QA rental ${marker}`,
        priceVnd: 13_000_000,
        price: { amount: 13_000_000, currency: 'VND', period: 'month' },
        collectedAt: new Date().toISOString(),
      },
    ]);
    await application.presetService.save(owner, marker, {
      query: '',
      refresh: false,
      limit: 1,
    });
    await application.presetService.subscribe(owner, marker);
    const bot = await application.createBot(secret.token);
    ledger.install(bot.api, owner);
    scope.defer('subscription producer', () =>
      bot.subscriptionScheduler.stop()
    );
    await bot.subscriptionScheduler.tick();
    assert(ledger.botIds.size > 0);
    result.actualSubscriptionDelivered = true;
    if (paths.media) {
      const browser = await chromium.launch({
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
      });
      scope.defer('self-authored image browser', () => browser.close());
      const page = await browser.newPage({
        viewport: { width: 160, height: 100 },
      });
      await page.setContent(
        '<body style="background:#abcdef">Self-authored QA cleanup image</body>'
      );
      const bytes = await page.screenshot();
      await bot.api.sendPhoto(owner, new InputFile(bytes, 'qa-cleanup.png'), {
        caption: 'Self-authored QA cleanup photo',
      });
      await bot.api.sendMediaGroup(owner, [
        {
          type: 'photo',
          media: new InputFile(bytes, 'qa-cleanup-a.png'),
          caption: 'Self-authored QA cleanup album A',
        },
        {
          type: 'photo',
          media: new InputFile(bytes, 'qa-cleanup-b.png'),
          caption: 'Self-authored QA cleanup album B',
        },
      ]);
      result.actualPhotoAndAlbumDelivered = true;
    }
    // Simulate Telegram accepting a request whose caller loses its response:
    // delete the ID from the journal, then recover by the durable send marker.
    await bot.api.sendMessage(
      owner,
      'Self-authored ambiguous-response cleanup control'
    );
    const latest = Math.max(...ledger.botIds);
    ledger.botIds.delete(latest);
    await ledger.save();
    let recovered = false;
    for (let attempt = 0; attempt < 10 && !recovered; attempt += 1) {
      recovered = (await read()).some(
        (message) =>
          ledger.owns(message) &&
          message.message.includes(
            'Self-authored ambiguous-response cleanup control'
          )
      );
      if (!recovered) {
        await delay(500);
      }
    }
    assert(recovered, 'QA_AMBIGUOUS_RECOVERY_CONTROL');
    result.ambiguousResponseRecoveryControl = true;
    signal.throwIfAborted();
    if (outcome === 'assertion-failure') {
      throw new Error('QA_INJECTED_ASSERTION_FAILURE');
    }
    if (outcome.startsWith('SIG')) {
      await new Promise((_resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('QA_SIGNAL_NOT_DELIVERED')),
          5_000
        );
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(signal.reason);
          },
          { once: true }
        );
        process.kill(process.pid, outcome);
      });
    }
  });
  result.expectedFailureObserved = outcome === 'success';
} catch (error) {
  result.expectedFailureObserved =
    (outcome === 'assertion-failure' &&
      error.message === 'QA_INJECTED_ASSERTION_FAILURE') ||
    error.message === `QA interrupted by ${outcome}.`;
  result.failureType = result.expectedFailureObserved
    ? undefined
    : error.constructor.name;
}
result.pass =
  outcome === 'audit'
    ? result.remainingKnownQaMessages === 0
    : Boolean(
        result.actualSubscriptionDelivered &&
        result.ambiguousResponseRecoveryControl &&
        result.expectedFailureObserved &&
        result.cleanup?.pass &&
        result.unrelatedPreserved
      );
console.log(JSON.stringify(result));
process.exitCode = result.pass ? 0 : 1;
