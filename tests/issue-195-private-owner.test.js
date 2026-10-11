import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseEnv } from 'node:util';
import { describe, it } from 'test-anywhere';
import { configurePrivateOwner } from '../src/telegram-operator.js';
import {
  TelegramAccessPolicy,
  registerTelegramHandlers,
} from '../src/index.js';

describe('private operator owner configuration', () => {
  it('requires an explicit original configuration path', async () => {
    await assert.rejects(configurePrivateOwner(), /--env-file/u);
  });

  it('rejects mismatches, invalid allowlists, failed sessions and concurrent edits without overwriting them', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'vac-owner-validation-'));
    const envFile = join(directory, '.env');
    try {
      for (const [original, identityProvider, expected] of [
        [
          'TELEGRAM_EXPECTED_USER_ID=98\n',
          async () => ({ id: 99 }),
          /does not match/u,
        ],
        [
          'TELEGRAM_ALLOWED_USER_IDS=unapproved\n',
          async () => ({ id: 99 }),
          /numeric/u,
        ],
        ['', undefined, /validation failed/u],
        [
          '',
          async () => {
            throw new Error('private credential content');
          },
          /validation failed/u,
        ],
      ]) {
        await writeFile(envFile, original);
        await assert.rejects(
          configurePrivateOwner({ envFile, identityProvider }),
          expected
        );
        assert.equal(await readFile(envFile, 'utf8'), original);
      }
      await writeFile(
        envFile,
        'TELEGRAM_BOT_TOKEN_FILE=token.txt\nTELEGRAM_ALLOWED_USER_IDS=11, 11,22\n'
      );
      await writeFile(join(directory, 'token.txt'), 'self-authored-token');
      await configurePrivateOwner({
        envFile,
        identityProvider: async ({ credentials }) => {
          assert.equal(credentials.botToken, 'self-authored-token');
          return { id: 99 };
        },
      });
      assert.equal(
        parseEnv(await readFile(envFile, 'utf8')).TELEGRAM_ALLOWED_USER_IDS,
        '11,22,99'
      );
      await assert.rejects(
        configurePrivateOwner({
          envFile,
          identityProvider: async () => {
            await writeFile(envFile, '# Concurrent private edit\n');
            return { id: 99 };
          },
        }),
        /not overwritten/u
      );
      assert.equal(
        await readFile(envFile, 'utf8'),
        '# Concurrent private edit\n'
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('derives the supplied session owner, writes privately and authorizes a real registered command', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'vac-owner-test-'));
    const envFile = join(directory, '.env');
    try {
      await writeFile(
        envFile,
        '# Self-authored private fixture\nTELEGRAM_BOT_TOKEN=fictitious\nTELEGRAM_ACCESS_MODE=private\nTELEGRAM_ALLOWED_USER_IDS=\nTELEGRAM_ALLOWED_CHAT_IDS=\n'
      );
      let validations = 0;
      const result = await configurePrivateOwner({
        envFile,
        identityProvider: async () => {
          validations += 1;
          return { id: 99 };
        },
      });
      assert.equal(validations, 1);
      assert.equal(JSON.stringify(result).includes('99'), false);
      assert.equal(result.liveCommandVerified, false);
      const environment = parseEnv(await readFile(envFile, 'utf8'));
      const policy = new TelegramAccessPolicy({
        mode: environment.TELEGRAM_ACCESS_MODE,
        allowedUserIds: [environment.TELEGRAM_ALLOWED_USER_IDS],
        allowedChatIds: [environment.TELEGRAM_ALLOWED_CHAT_IDS],
      });
      const commands = new Map();
      registerTelegramHandlers(
        {
          command: (name, handler) => commands.set(name, handler),
          on: () => {},
        },
        {
          accessPolicy: policy,
          registry: {
            list: async () => [],
            update: async () => ({ web: [], telegram: [] }),
          },
        }
      );
      const replies = [];
      await commands.get('update_sources')({
        from: { id: 99 },
        chat: { id: 99 },
        reply: async (text) => replies.push(text),
      });
      assert.equal(
        replies.some((text) => /Updated/u.test(text)),
        true
      );
      assert.throws(
        () =>
          policy.authorize(
            { from: { id: 100 }, chat: { id: 100 } },
            { privileged: true }
          ),
        /not authorized/u
      );
      assert.equal(environment.TELEGRAM_BOT_TOKEN, 'fictitious');
      if (process.platform !== 'win32') {
        assert.equal((await stat(envFile)).mode & 0o777, 0o600);
      }
      await configurePrivateOwner({
        envFile,
        identityProvider: async () => ({ id: 99 }),
      });
      assert.equal(
        parseEnv(await readFile(envFile, 'utf8')).TELEGRAM_ALLOWED_USER_IDS,
        '99'
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('leaves the original configuration intact when identity validation fails', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'vac-owner-test-'));
    const envFile = join(directory, '.env');
    const original =
      'TELEGRAM_ACCESS_MODE=private\nTELEGRAM_ALLOWED_USER_IDS=\n';
    try {
      await writeFile(envFile, original);
      await assert.rejects(
        configurePrivateOwner({
          envFile,
          identityProvider: async () => ({ id: 'invalid' }),
        }),
        /identity/u
      );
      assert.equal(await readFile(envFile, 'utf8'), original);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
