import { chmod, mkdir, open, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { durableWrite } from './link-cli-mirror.js';
import {
  SESSION_FORMAT,
  createSessionEnvelope,
  inspectSessionFormat,
  inspectSessionEnvelope,
  nativeSessionPayload,
} from './session-envelope.js';
import { createMtcuteClient } from './telegram-user.js';

function sessionConfiguration(session, sessionFormat) {
  if (!session) {
    return { state: 'absent' };
  }
  if (!sessionFormat) {
    const inspection = inspectSessionEnvelope(session);
    if (inspection.state === 'active-unverified') {
      return { format: SESSION_FORMAT, state: 'supported' };
    }
    return {
      reason: 'session-format-required',
      state: 'format-required',
      userUnavailable:
        'Telegram raw session format must be declared explicitly. Re-login with mtcute if its origin cannot be proven.',
    };
  }
  if (sessionFormat === SESSION_FORMAT) {
    return { format: SESSION_FORMAT, state: 'supported' };
  }
  const format = inspectSessionFormat(sessionFormat);
  return {
    format: sessionFormat,
    reason:
      format.state === 'relogin-required'
        ? 'foreign-session-format'
        : 'unsupported-session-format',
    state: format.state,
    userUnavailable:
      format.state === 'relogin-required'
        ? `Telegram session format ${sessionFormat} cannot be converted losslessly. Re-login explicitly with mtcute, validate the pinned account, then revoke the old session.`
        : `Unsupported Telegram session format: ${sessionFormat}. Re-authenticate with mtcute.`,
  };
}

export function validateTelegramConfiguration({
  apiHash,
  apiId,
  botToken,
  session,
  sessionFormat,
} = {}) {
  const userValues = {
    TELEGRAM_API_HASH: apiHash,
    TELEGRAM_API_ID: apiId,
    TELEGRAM_USER_SESSION: session,
  };
  const hasUserValue = Object.values(userValues).some(Boolean);
  const missing = Object.entries(userValues)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (hasUserValue && missing.length) {
    const userUnavailable = `Incomplete Telegram user credentials; missing ${missing.join(', ')}.`;
    if (botToken) {
      return { mode: 'bot-only', userUnavailable };
    }
    throw new Error(userUnavailable);
  }
  const user = hasUserValue && !missing.length;
  const sessionStatus = sessionConfiguration(session, sessionFormat);
  if (user && sessionStatus.state !== 'supported') {
    const { userUnavailable } = sessionStatus;
    if (botToken) {
      return { mode: 'bot-only', userUnavailable };
    }
    throw new Error(userUnavailable);
  }
  return { mode: botToken && user ? 'both' : user ? 'user-only' : 'bot-only' };
}

async function secretValue(env, name) {
  const file = env[`${name}_FILE`];
  if (file && env[name]) {
    throw new Error(`${name} and ${name}_FILE cannot both be configured.`);
  }
  return file ? (await readFile(file, 'utf8')).trim() : env[name];
}

export async function resolveTelegramSecrets(env = process.env) {
  const session = await secretValue(env, 'TELEGRAM_USER_SESSION');
  const declaredSessionFormat = await secretValue(
    env,
    'TELEGRAM_USER_SESSION_FORMAT'
  );
  return {
    apiHash: await secretValue(env, 'TELEGRAM_API_HASH'),
    apiId: await secretValue(env, 'TELEGRAM_API_ID'),
    botToken: await secretValue(env, 'TELEGRAM_BOT_TOKEN'),
    session,
    sessionFormat:
      declaredSessionFormat || (session ? undefined : SESSION_FORMAT),
  };
}

function configuredUserCapability(credentials, configuration) {
  if (!credentials.session) {
    return { available: false, state: 'not-configured' };
  }
  if (configuration.mode !== 'bot-only' || !configuration.userUnavailable) {
    return { available: true, state: 'configured' };
  }
  const status = sessionConfiguration(
    credentials.session,
    credentials.sessionFormat
  );
  return {
    available: false,
    reason: status.reason || 'incomplete-credentials',
    state:
      status.state === 'relogin-required' ? 'relogin-required' : status.state,
  };
}

function unavailableUserCapability(error) {
  const message = String(error?.message || '');
  const code = String(error?.code || '');
  if (/identity mismatch/iu.test(message)) {
    throw new Error('Telegram user identity mismatch.');
  }
  const expired =
    /AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED|expired|revoked/iu.test(
      `${code} ${message}`
    );
  return {
    available: false,
    reason: /^[A-Z][A-Z0-9_]+$/u.test(code)
      ? code
      : expired
        ? 'SESSION_INVALID'
        : 'session-validation-failed',
    state: expired ? 'expired-or-revoked' : 'unavailable',
  };
}

function userPreflightError(capability) {
  const error = new Error(
    `Telegram user preflight failed (${capability.reason}).`
  );
  error.code = capability.reason;
  return error;
}

// eslint-disable-next-line complexity -- Preflight reports each independently configured credential boundary.
export async function preflightTelegram({
  authFactory = (options) => new TelegramAuthService(options),
  directory = '.vietnam-accomodation-search',
  env = process.env,
  fetchImpl = globalThis.fetch,
  mirror,
} = {}) {
  const credentials = await resolveTelegramSecrets(env);
  const configuration = validateTelegramConfiguration(credentials);
  let { mode } = configuration;
  if (!credentials.botToken && !credentials.session) {
    throw new Error('Configure a Telegram bot token, a user session, or both.');
  }
  const identities = {};
  const capabilities = {
    bot: credentials.botToken
      ? { available: true, state: 'configured' }
      : { available: false, state: 'not-configured' },
    user: configuredUserCapability(credentials, configuration),
  };
  if (credentials.botToken) {
    const response = await fetchImpl(
      `https://api.telegram.org/bot${credentials.botToken}/getMe`,
      { signal: AbortSignal.timeout(10_000) }
    );
    const result = await response.json();
    if (!response.ok || !result.ok || !result.result?.id) {
      throw new Error(
        `Telegram Bot API getMe failed with status ${response.status}.`
      );
    }
    if (
      env.TELEGRAM_EXPECTED_BOT_ID &&
      String(result.result.id) !== String(env.TELEGRAM_EXPECTED_BOT_ID)
    ) {
      throw new Error(
        `Telegram bot identity mismatch: expected ${env.TELEGRAM_EXPECTED_BOT_ID}, received ${result.result.id}.`
      );
    }
    identities.bot = {
      id: result.result.id,
      username: result.result.username,
    };
    capabilities.bot = { available: true, state: 'ready' };
  }
  if (credentials.session && capabilities.user.available) {
    try {
      identities.user = await authFactory({
        apiHash: credentials.apiHash,
        apiId: credentials.apiId,
        expectedUserId: env.TELEGRAM_EXPECTED_USER_ID,
        session: credentials.session,
        sessionFormat: credentials.sessionFormat,
      }).validate();
      capabilities.user = { available: true, state: 'ready' };
    } catch (error) {
      const unavailable = unavailableUserCapability(error);
      if (!credentials.botToken) {
        throw userPreflightError(unavailable);
      }
      capabilities.user = unavailable;
      mode = 'bot-only';
    }
  }
  await mirror?.preflight?.();
  await mkdir(directory, { recursive: true });
  const probePath = join(directory, `.preflight-${process.pid}`);
  const probe = await open(probePath, 'wx', 0o600);
  await probe.close();
  await rm(probePath, { force: true });
  capabilities.effectiveMode = mode;
  return { capabilities, identities, mode };
}

async function readOptional(path) {
  if (!path) {
    return undefined;
  }
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

export class TelegramAuthService {
  constructor({
    apiHash,
    apiId,
    clientFactory = createMtcuteClient,
    expectedUserId,
    onSession,
    onSessionEnvelope,
    prompt,
    qrCodeHandler,
    session,
    sessionFormat = SESSION_FORMAT,
    sessionFile,
  } = {}) {
    this.apiHash = apiHash;
    this.apiId = apiId;
    this.clientFactory = clientFactory;
    this.expectedUserId = expectedUserId;
    this.onSession = onSession;
    this.onSessionEnvelope = onSessionEnvelope;
    this.prompt = prompt;
    this.qrCodeHandler = qrCodeHandler;
    this.session = session;
    this.sessionFormat = sessionFormat;
    this.sessionFile = sessionFile;
  }

  credentials() {
    const apiId = Number(this.apiId);
    if (!Number.isInteger(apiId) || apiId < 1 || !this.apiHash) {
      throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH are required.');
    }
    return { apiHash: this.apiHash, apiId };
  }

  async #withClient(client, operation) {
    let failure;
    let result;
    try {
      result = await operation();
    } catch (error) {
      failure = error;
    }
    try {
      await client.destroy();
    } catch (cleanupError) {
      if (failure) {
        throw new AggregateError(
          [failure, cleanupError],
          'Telegram operation and client cleanup both failed.'
        );
      }
      throw cleanupError;
    }
    if (failure) {
      throw failure;
    }
    return result;
  }

  #identity(me) {
    if (
      this.expectedUserId !== undefined &&
      String(me.id) !== String(this.expectedUserId)
    ) {
      throw new Error(
        `Telegram identity mismatch: expected ${this.expectedUserId}, received ${me.id}.`
      );
    }
    return { id: me.id, username: me.username };
  }

  async #writeSession(session, identity) {
    const envelope = createSessionEnvelope(session, {
      expectedUserId: identity.id,
      provider: 'mtcute',
      sessionId: `telegram-user:${String(identity.id)}`,
    });
    if (this.onSessionEnvelope) {
      await this.onSessionEnvelope(envelope);
      return;
    }
    if (this.onSession) {
      // Retain the original callback contract for embedders. New callers that
      // persist session material should use onSessionEnvelope instead.
      await this.onSession(session);
      return;
    }
    if (!this.sessionFile) {
      throw new Error(
        'Choose an explicit session file or session output handler.'
      );
    }
    await durableWrite(this.sessionFile, envelope);
  }

  async login({ code, password, phone, qr = false } = {}) {
    const client = await this.clientFactory(this.credentials());
    let phoneValue = phone;
    let codeValue = code;
    let passwordValue = password;
    const ask = (label, existing) => {
      if (existing) {
        return existing;
      }
      if (!this.prompt) {
        throw new Error(`${label} is required in non-interactive mode.`);
      }
      return this.prompt({ label, secret: true });
    };
    try {
      return await this.#withClient(client, async () => {
        await client.start({
          code: async () => (codeValue = await ask('Code', codeValue)),
          password: async () =>
            (passwordValue = await ask('Password', passwordValue)),
          phone: async () => (phoneValue = await ask('Phone', phoneValue)),
          ...(qr && this.qrCodeHandler
            ? { qrCodeHandler: this.qrCodeHandler }
            : {}),
        });
        const identity = this.#identity(await client.getMe());
        await this.#writeSession(await client.exportSession(), identity);
        return identity;
      });
    } finally {
      phoneValue = undefined;
      codeValue = undefined;
      passwordValue = undefined;
    }
  }

  rotate(options) {
    return this.login(options);
  }

  async validate() {
    const session = this.session || (await readOptional(this.sessionFile));
    if (!session) {
      throw new Error('No Telegram user session is configured.');
    }
    // Validate representation locally before constructing a client. A bad or
    // foreign envelope must never trigger trial network logins.
    const payload = nativeSessionPayload(session, this.sessionFormat);
    const client = await this.clientFactory(this.credentials());
    return this.#withClient(client, async () => {
      await client.importSession(payload);
      const identity = this.#identity(await client.getMe());
      if (
        this.sessionFile &&
        inspectSessionEnvelope(session).state === 'malformed'
      ) {
        await durableWrite(
          this.sessionFile,
          createSessionEnvelope(session, {
            expectedUserId: identity.id,
            provider: 'mtcute',
            sessionId: `telegram-user:${String(identity.id)}`,
          })
        );
      }
      if (this.sessionFile) {
        await chmod(this.sessionFile, 0o600);
      }
      return identity;
    });
  }

  // eslint-disable-next-line complexity -- Status exposes each safe session classification without constructing a client unnecessarily.
  async status() {
    const session = this.session || (await readOptional(this.sessionFile));
    if (!session) {
      return { configured: false };
    }
    const declaredFormat = inspectSessionFormat(this.sessionFormat);
    if (declaredFormat.state !== 'supported') {
      return {
        configured: true,
        format: this.sessionFormat,
        reason: declaredFormat.reason,
        state: declaredFormat.state,
      };
    }
    const inspection = inspectSessionEnvelope(session);
    if (
      ['partial', 'unsupported'].includes(inspection.state) ||
      (inspection.state === 'malformed' && session.trimStart().startsWith('{'))
    ) {
      return {
        configured: true,
        ...(inspection.format ? { format: inspection.format } : {}),
        ...(inspection.reason ? { reason: inspection.reason } : {}),
        state:
          inspection.state === 'unsupported' &&
          inspectSessionFormat(inspection.format).state === 'relogin-required'
            ? 'relogin-required'
            : inspection.state,
      };
    }
    try {
      const identity = await this.validate();
      return {
        configured: true,
        identity,
        state:
          inspection.state === 'malformed'
            ? 'active-migrated-native'
            : 'active',
      };
    } catch (error) {
      const message = String(error?.message || '');
      const code = String(error?.code || '');
      const state = /identity mismatch/iu.test(message)
        ? 'identity-mismatch'
        : /AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED|expired|revoked/iu.test(
              `${code} ${message}`
            )
          ? 'expired-or-revoked'
          : 'degraded';
      return {
        configured: true,
        reason: code || 'session-validation-failed',
        state,
      };
    }
  }

  async logout({ revoke = true } = {}) {
    const session = this.session || (await readOptional(this.sessionFile));
    if (session && revoke) {
      const client = await this.clientFactory(this.credentials());
      await this.#withClient(client, async () => {
        await client.importSession(
          nativeSessionPayload(session, this.sessionFormat)
        );
        await client.logOut?.();
      });
    }
    if (this.sessionFile) {
      await rm(this.sessionFile, { force: true });
    }
    this.session = undefined;
  }
}
