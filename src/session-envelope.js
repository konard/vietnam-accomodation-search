export const SESSION_SCHEMA_VERSION = 1;
export const SESSION_FORMAT = 'mtcute/session-string-v1';
export const GRAMJS_SESSION_FORMAT = 'gramjs/string-session-v1';

export function inspectSessionFormat(format) {
  if (format === SESSION_FORMAT) {
    return { provider: 'mtcute', state: 'supported' };
  }
  if (
    format === GRAMJS_SESSION_FORMAT ||
    format === 'teleproto/string-session-v1'
  ) {
    return {
      provider: format.split('/')[0],
      reason: 'lossless-conversion-not-guaranteed-use-explicit-relogin',
      state: 'relogin-required',
    };
  }
  return { reason: 'unknown-session-format', state: 'unsupported' };
}

function parse(value) {
  if (typeof value === 'object' && value) {
    return value;
  }
  return JSON.parse(String(value));
}

export function createSessionEnvelope(payload, metadata = {}) {
  if (typeof payload !== 'string' || !payload.trim()) {
    throw new TypeError('A non-empty mtcute session payload is required.');
  }
  return JSON.stringify({
    schemaVersion: SESSION_SCHEMA_VERSION,
    provider: 'mtcute',
    format: SESSION_FORMAT,
    sessionId:
      metadata.sessionId ||
      (metadata.expectedUserId === undefined
        ? 'telegram-user:unverified'
        : `telegram-user:${String(metadata.expectedUserId)}`),
    createdAt: metadata.createdAt || new Date().toISOString(),
    ...(metadata.rotatedAt === undefined
      ? {}
      : { rotatedAt: metadata.rotatedAt }),
    ...(metadata.dcId === undefined ? {} : { dcId: metadata.dcId }),
    ...(metadata.expectedUserId === undefined
      ? {}
      : { expectedUserId: String(metadata.expectedUserId) }),
    payload,
  });
}

export function inspectSessionEnvelope(value) {
  if (!value) {
    return { state: 'absent' };
  }
  let envelope;
  try {
    envelope = parse(value);
  } catch {
    return { state: 'malformed' };
  }
  if (
    typeof envelope.schemaVersion !== 'number' ||
    typeof envelope.provider !== 'string' ||
    typeof envelope.format !== 'string' ||
    typeof envelope.sessionId !== 'string' ||
    typeof envelope.payload !== 'string' ||
    !envelope.payload
  ) {
    return { state: 'partial' };
  }
  if (envelope.schemaVersion !== SESSION_SCHEMA_VERSION) {
    return {
      format: envelope.format,
      provider: envelope.provider,
      reason: 'unsupported-schema-version',
      schemaVersion: envelope.schemaVersion,
      state: 'unsupported',
    };
  }
  if (envelope.provider !== 'mtcute' || envelope.format !== SESSION_FORMAT) {
    return {
      format: envelope.format,
      provider: envelope.provider,
      reason: 'unsupported-session-format',
      schemaVersion: envelope.schemaVersion,
      state: 'unsupported',
    };
  }
  return {
    createdAt: envelope.createdAt,
    ...(envelope.expectedUserId === undefined
      ? {}
      : { expectedUserId: String(envelope.expectedUserId) }),
    format: envelope.format,
    provider: envelope.provider,
    schemaVersion: envelope.schemaVersion,
    sessionId: envelope.sessionId,
    state: 'active-unverified',
  };
}

export function sessionPayload(value) {
  let envelope;
  try {
    envelope = parse(value);
  } catch {
    throw new Error('Telegram session envelope is malformed.');
  }
  const status = inspectSessionEnvelope(envelope);
  if (status.state !== 'active-unverified') {
    throw new Error(
      status.state === 'unsupported'
        ? `Unsupported Telegram session format: ${status.format}`
        : `Telegram session envelope is ${status.state}.`
    );
  }
  return envelope.payload;
}

export function nativeSessionPayload(value, format = SESSION_FORMAT) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('No Telegram user session is configured.');
  }
  if (value.trimStart().startsWith('{')) {
    return sessionPayload(value);
  }
  if (format !== SESSION_FORMAT) {
    throw new Error(
      `Unsupported Telegram session format: ${format}. Re-authenticate with mtcute.`
    );
  }
  return value;
}
