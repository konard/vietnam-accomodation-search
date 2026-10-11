#!/usr/bin/env node
// Manual owner-only real-credential control. Never writes to public sources.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Api } from 'grammy';
import { writeStringSession } from '@mtcute/core/utils.js';
import { MtcuteTelegramProvider, TelegramAuthService } from '../src/index.js';
import { createMtcuteClient } from '../src/telegram-user.js';
import { qaTemporaryDirectory, withQaCleanup } from './qa-cleanup.mjs';
import { QaOwnedMessages } from './qa-owned-messages.mjs';
import {
  botCredentials,
  environmentFile,
  getBotIdentity,
  userCredentials,
  withDeadline,
} from './telegram-bot-conversation-e2e.mjs';

const phases = ['isolated', 'overlap', 'after-overlap'];
const silent = { debug() {}, info() {}, warn() {}, error() {} };

function options() {
  const values = {};
  const keys = {
    '--bot-env': 'botEnv',
    '--user-env': 'userEnv',
    '--converter-module': 'converter',
    '--validation-first': 'validationFirst',
  };
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = keys[process.argv[index]];
    assert(key && process.argv[index + 1], 'Explicit QA paths required.');
    values[key] = process.argv[index + 1];
  }
  assert(values.botEnv && values.userEnv && values.converter);
  assert(
    values.validationFirst === undefined || values.validationFirst === '1'
  );
  return values;
}

// Hold the validation lease after its normal import/getMe/update-loop setup.
// The real ingestion provider must borrow that transport without a new start.
async function validationFirst(settings, scope) {
  let opened;
  let release;
  let ready;
  const released = new Promise((done) => (release = done));
  const acquired = new Promise((done) => (ready = done));
  settings.clientFactory = async (options) => {
    assert.equal(opened, undefined);
    opened = await createMtcuteClient(options);
    const getMe = opened.getMe.bind(opened);
    let calls = 0;
    opened.getMe = async (...args) => {
      if (++calls === 2) {
        ready();
        await released;
      }
      return getMe(...args);
    };
    return opened;
  };
  const pending = new TelegramAuthService(settings).validate();
  pending.catch(() => {});
  scope.defer('validation-first lease', async () => {
    release();
    await pending;
  });
  await withDeadline(() => acquired, 20_000, 'validation-first readiness');
  return { client: opened, release, pending };
}

function capture(target, marker) {
  return (message) => {
    const text = message?.text || '';
    if (text.startsWith(`${marker}\n`)) {
      const phase = phases.find((value) => text.endsWith(`phase=${value}`));
      if (phase) {
        target.add(phase);
      }
    }
  };
}

async function probe(api, owner, phase, observations, signal) {
  signal.throwIfAborted();
  await withDeadline(
    () =>
      api.sendMessage(Number(owner), `Self-authored QA update phase=${phase}`),
    20_000,
    'owner-only probe send'
  );
  for (let index = 0; index < 40 && !observations.primary.has(phase); index++) {
    await delay(250, undefined, { signal });
  }
  return {
    phase,
    primaryReceived: observations.primary.has(phase),
    primaryRawReceived: observations.raw.has(phase),
    secondaryReceived: observations.secondary.has(phase),
  };
}

async function overlap({
  primary,
  settings,
  target,
  ledger,
  api,
  owner,
  seen,
  signal,
}) {
  signal.throwIfAborted();
  const secondary = new MtcuteTelegramProvider(settings);
  let stop = false;
  let reader;
  const receive = capture(seen.secondary, ledger.marker);
  try {
    assert.equal(String((await secondary.identity()).id), owner);
    secondary.client.onNewMessage.add(receive);
    await secondary.client.getHistory(target, { limit: 1 });
    reader = (async () => {
      while (!stop) {
        await withDeadline(
          () => secondary.client.getHistory(target, { limit: 1 }),
          10_000,
          'secondary owner-only read'
        );
        await delay(250, undefined, { signal });
      }
    })();
    // Attach a rejection handler immediately; teardown still awaits the reader.
    reader.catch(() => {});
    return await probe(api, owner, 'overlap', seen, signal);
  } finally {
    stop = true;
    try {
      await reader;
    } finally {
      secondary.client?.onNewMessage.remove(receive);
      await secondary.destroy();
      await primary.client.getMe();
    }
  }
}

async function run(scope, signal, result) {
  const paths = options();
  const supplied = await userCredentials(await environmentFile(paths.userEnv));
  const secret = await botCredentials(await environmentFile(paths.botEnv));
  const identity = await getBotIdentity(
    secret.token,
    secret.token.split(':')[0]
  );
  const converter = await import(pathToFileURL(resolve(paths.converter)).href);
  const settings = {
    ...supplied,
    session: writeStringSession(
      converter.convertFromGramjsSession(supplied.session)
    ),
    sessionFormat: 'mtcute/session-string-v1',
    logger: silent,
  };
  const validation = paths.validationFirst
    ? await validationFirst(settings, scope)
    : undefined;
  const primary = new MtcuteTelegramProvider(settings);
  scope.defer('primary native provider', () => primary.destroy());
  const owner = String((await primary.identity()).id);
  if (validation) {
    result.validationFirstTransportShared =
      primary.client === validation.client;
    assert(result.validationFirstTransportShared);
  }
  assert.notEqual(owner, identity.id);
  const target = await primary.resolveEntity(`@${identity.username}`);
  let lastRead;
  const read = () =>
    withDeadline(
      async () => {
        const rows = [];
        for await (const row of primary.client.iterHistory(target)) {
          rows.push(row);
        }
        lastRead = rows;
        return rows;
      },
      20_000,
      'independent owner readback'
    );
  const before = await read();
  const directory = await qaTemporaryDirectory(
    scope,
    'vac-native-update-sharing-'
  );
  const ledger = new QaOwnedMessages({
    marker: `qa-native-${randomBytes(8).toString('hex')}`,
    baseline: before.reduce((maximum, row) => Math.max(maximum, row.id), 0),
    journal: join(directory, 'owned.json'),
  });
  await ledger.save();
  scope.defer('exact owned messages', async () => {
    const cleanup = await ledger.cleanup({
      read,
      remove: (ids) =>
        primary.client.deleteMessagesById(target, ids, { revoke: true }),
    });
    result.cleanupPass = cleanup.pass;
    result.zeroOwnedMessageLeftovers = cleanup.leftovers === 0;
    assert(cleanup.pass && cleanup.leftovers === 0);
    // cleanup's terminal readback already proves deletion independently.
    // Reuse that same snapshot to verify preservation without another RPC.
    result.unownedMessagesPreserved = before.every((row) =>
      lastRead.some((remaining) => remaining.id === row.id)
    );
    assert(result.unownedMessagesPreserved);
  });
  const api = new Api(secret.token);
  ledger.install(api, owner);
  const seen = { primary: new Set(), raw: new Set(), secondary: new Set() };
  const receive = capture(seen.primary, ledger.marker);
  const subscription = await primary.liveUpdates(
    (event) => receive(event.message),
    {
      sources: [
        { id: 'qa-owner-bot', username: identity.username, type: 'telegram' },
      ],
    }
  );
  scope.defer('primary live subscription', () => subscription.stop());
  const raw = capture(seen.raw, ledger.marker);
  primary.client.onNewMessage.add(raw);
  scope.defer('primary raw observer', () =>
    primary.client.onNewMessage.remove(raw)
  );
  if (validation) {
    validation.release();
    assert.equal(String((await validation.pending).id), owner);
    result.validationFirstOwnerVerified = true;
  }
  result.phases = [await probe(api, owner, 'isolated', seen, signal)];
  result.phases.push(
    await overlap({
      primary,
      settings,
      target,
      ledger,
      api,
      owner,
      seen,
      signal,
    })
  );
  result.phases.push(await probe(api, owner, 'after-overlap', seen, signal));
  result.pass = result.phases.every((phase) => phase.primaryReceived);
  assert(
    result.pass,
    'Primary native updates must survive a same-session secondary client.'
  );
}

assert.equal(process.env.QA_NATIVE_UPDATE_SHARING, '1');
const result = { ownerOnly: true, publicSourcesWritten: false, pass: false };
try {
  await withQaCleanup((scope, signal) => run(scope, signal, result));
} catch (error) {
  result.failureCategory = String(error.message).startsWith(
    'QA cleanup failed:'
  )
    ? 'OWNED_TEARDOWN_FAILURE'
    : 'ACCEPTANCE_FAILURE';
  process.exitCode = 1;
} finally {
  console.log(JSON.stringify(result));
}
