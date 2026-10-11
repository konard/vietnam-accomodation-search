import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it } from 'test-anywhere';
import { resolveTelegramSecrets } from '../src/telegram-auth.js';
import { configurePrivateOwner } from '../src/telegram-operator.js';
import { inlineTelegramCredentials } from '../src/telegram-secrets.js';
import { withQaCleanup } from '../experiments/qa-cleanup.mjs';
import { SESSION_FORMAT } from '../src/session-envelope.js';
import { runReleaseAudit } from '../experiments/run-release-audit.mjs';

// The read-only Deno suite does not authorize CLI driver environment access.
// Production normalization below runs there; owned-file/CLI controls run in
// the Node and Bun suites, following the private-owner test boundary.
const isDeno = typeof globalThis.Deno !== 'undefined';
const { userCredentials } = isDeno
  ? {}
  : await import('../experiments/telegram-bot-conversation-e2e.mjs');
const { deriveSuppliedOwner, resolveOwnerCredentials } = isDeno
  ? {}
  : await import('../experiments/configure-private-owner.mjs');

describe('consistent supplied Telegram credentials', () => {
  it('recognizes legacy credentials in offline release evidence readiness', async () => {
    if (isDeno) {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'vac-release-alias-'));
    try {
      const result = await runReleaseAudit(
        ['--live', '--output', join(root, 'report.json')],
        {
          RELEASE_AUDIT_LIVE: '1',
          TELEGRAM_USER_BOT_API_ID: '123',
          TELEGRAM_USER_BOT_API_HASH: 'self-authored-hash',
          TELEGRAM_BOT_TOKEN: 'self-authored-token',
          TELEGRAM_USER_SESSION: 'self-authored-session',
        }
      );
      assert.equal(
        Object.hasOwn(result.report.gates, 'live-authorization'),
        false
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('does not treat an unrelated environment key as an unconfigured secret', async () => {
    const environment = { undefined: 'unrelated-self-authored-value' };
    assert.equal((await resolveTelegramSecrets(environment)).apiId, undefined);
    assert.equal(inlineTelegramCredentials(environment).session, undefined);
  });
  it('checks both environment pins before authentication and applies the selected pin to either session format', async () => {
    if (isDeno) {
      return;
    }
    const credentials = {
      apiId: '123',
      apiHash: 'self-authored-hash',
      session: 'self-authored-session',
    };
    await assert.rejects(
      resolveOwnerCredentials(
        credentials,
        { TELEGRAM_EXPECTED_USER_ID: '99' },
        { TELEGRAM_EXPECTED_USER_ID: '100' }
      ),
      /pins conflict/u
    );
    const selected = await resolveOwnerCredentials(credentials, {
      TELEGRAM_EXPECTED_USER_ID: '99',
    });
    assert.equal(selected.expectedUserId, '99');
    let destroyed = 0;
    const legacyFactory = async (options) => {
      assert.equal(options.session, credentials.session);
      return {
        setLogLevel: () => {},
        connect: async () => {},
        checkAuthorization: async () => true,
        getMe: async () => ({ id: 99 }),
        destroy: async () => {
          destroyed += 1;
        },
      };
    };
    await withQaCleanup(async (scope) => {
      assert.deepEqual(
        await deriveSuppliedOwner(selected, scope, { legacyFactory }),
        { id: '99' }
      );
    });
    await assert.rejects(
      withQaCleanup((scope) =>
        deriveSuppliedOwner({ ...selected, expectedUserId: '100' }, scope, {
          legacyFactory,
        })
      ),
      /owner pin does not match/u
    );
    assert.equal(destroyed, 2);
    await withQaCleanup(async (scope) => {
      assert.deepEqual(
        await deriveSuppliedOwner(
          { ...selected, sessionFormat: SESSION_FORMAT },
          scope,
          {
            authFactory: (options) => {
              assert.equal(options.expectedUserId, '99');
              assert.equal(options.session, credentials.session);
              return { validate: async () => ({ id: '99' }) };
            },
          }
        ),
        { id: '99' }
      );
    });
    const supplied = await resolveOwnerCredentials(
      credentials,
      {},
      {
        TELEGRAM_USER_BOT_API_ID: '123',
        TELEGRAM_USER_BOT_API_HASH: 'self-authored-hash',
        TELEGRAM_USER_SESSION: 'self-authored-session',
        TELEGRAM_EXPECTED_USER_ID: '99',
      }
    );
    assert.equal(supplied.expectedUserId, '99');
    assert.equal(supplied.session, credentials.session);
  });
  it('accepts legacy API names in production and QA without changing the supplied session', async () => {
    const environment = {
      TELEGRAM_USER_BOT_API_ID: '123',
      TELEGRAM_USER_BOT_API_HASH: 'self-authored-hash',
      TELEGRAM_USER_SESSION: 'self-authored-session',
    };
    const production = await resolveTelegramSecrets(environment);
    if (!isDeno) {
      const qa = await userCredentials(environment);
      assert.equal(production.apiId, String(qa.apiId));
      assert.equal(production.apiHash, qa.apiHash);
    }
    assert.equal(production.apiId, '123');
    assert.equal(production.apiHash, 'self-authored-hash');
    assert.equal(production.session, environment.TELEGRAM_USER_SESSION);
    assert.equal(
      inlineTelegramCredentials(environment).apiId,
      production.apiId
    );
  });

  it('supports legacy secret files and rejects every competing credential representation', async () => {
    if (isDeno) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'vac-alias-test-'));
    const hashFile = join(directory, 'hash');
    try {
      await writeFile(hashFile, 'self-authored-hash\n');
      const environment = {
        TELEGRAM_USER_BOT_API_ID: '123',
        TELEGRAM_USER_BOT_API_HASH_FILE: hashFile,
        TELEGRAM_USER_SESSION: 'self-authored-session',
      };
      assert.equal(
        (await resolveTelegramSecrets(environment)).apiHash,
        'self-authored-hash'
      );
      for (const conflict of [
        { TELEGRAM_API_ID: '456' },
        { TELEGRAM_API_ID_FILE: hashFile },
        { TELEGRAM_API_HASH: 'competing-hash' },
        { TELEGRAM_API_HASH_FILE: hashFile },
        { TELEGRAM_USER_BOT_API_HASH: 'competing-hash' },
      ]) {
        await assert.rejects(
          resolveTelegramSecrets({ ...environment, ...conflict }),
          /cannot both|conflict/u
        );
        assert.throws(
          () => inlineTelegramCredentials({ ...environment, ...conflict }),
          /conflict/u
        );
        await assert.rejects(
          userCredentials({ ...environment, ...conflict }),
          /cannot both|conflict/u
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('resolves aliases relative to the original private configuration and preserves its owner pin', async () => {
    if (isDeno) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'vac-owner-alias-'));
    const envFile = join(directory, '.env');
    const original =
      'TELEGRAM_USER_BOT_API_ID=123\nTELEGRAM_USER_BOT_API_HASH_FILE=hash\nTELEGRAM_USER_SESSION=self-authored-session\nTELEGRAM_EXPECTED_USER_ID=99\n';
    try {
      await writeFile(join(directory, 'hash'), 'self-authored-hash');
      await writeFile(envFile, original);
      await assert.rejects(
        configurePrivateOwner({
          envFile,
          identityProvider: async ({ credentials }) => {
            assert.equal(credentials.apiId, '123');
            assert.equal(credentials.apiHash, 'self-authored-hash');
            return { id: 100 };
          },
        }),
        /does not match/u
      );
      assert.equal(await readFile(envFile, 'utf8'), original);
      await configurePrivateOwner({
        envFile,
        identityProvider: async () => ({ id: 99 }),
      });
      const configured = await readFile(envFile, 'utf8');
      assert(configured.includes('TELEGRAM_ACCESS_MODE=private'));
      assert(configured.includes('TELEGRAM_ALLOWED_USER_IDS=99'));
      assert(configured.includes('TELEGRAM_ALLOWED_CHAT_IDS=99'));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
