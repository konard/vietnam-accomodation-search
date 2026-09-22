import { setTimeout as wait } from 'node:timers/promises';

function errorText(error) {
  return [
    error?.message,
    error?.description,
    error?.errorMessage,
    error?.cause?.message,
  ]
    .filter(Boolean)
    .join(' ');
}

// eslint-disable-next-line complexity -- The classifier deliberately enumerates mutually exclusive Telegram failure classes.
export function classifyTelegramError(error) {
  const status = Number(
    error?.error_code ??
      error?.status ??
      error?.statusCode ??
      (typeof error?.code === 'number' ? error.code : undefined)
  );
  const code = String(error?.code || '');
  const text = errorText(error);
  const flood = text.match(/FLOOD_WAIT_?(\d+)/iu);
  const retryAfter = Number(error?.parameters?.retry_after ?? flood?.[1]);

  if (status === 429 || flood) {
    return {
      category: 'rate-limit',
      delayMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
      fatal: false,
      retryable: true,
    };
  }
  if (status === 409) {
    return { category: 'conflict', fatal: true, retryable: false };
  }
  if (
    status === 401 ||
    /AUTH_KEY|SESSION_(?:REVOKED|EXPIRED)|USER_DEACTIVATED/iu.test(text)
  ) {
    return { category: 'auth', fatal: true, retryable: false };
  }
  if (status === 403) {
    return {
      category: /blocked|kicked/iu.test(text) ? 'blocked' : 'capability',
      fatal: false,
      retryable: false,
    };
  }
  if (
    /\b(?:USERNAME_[A-Z_]*|ENTITY(?:_[A-Z_]*)?|PEER_ID_INVALID)\b/iu.test(text)
  ) {
    return { category: 'entity', fatal: false, retryable: false };
  }
  if (
    [
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'ENETUNREACH',
    ].includes(code) ||
    status >= 500
  ) {
    return { category: 'transport', fatal: false, retryable: true };
  }
  if (error instanceof SyntaxError || status === 400) {
    return { category: 'malformed', fatal: false, retryable: false };
  }
  return { category: 'unknown', fatal: false, retryable: false };
}

function abortError() {
  const error = new Error('The Telegram operation was aborted.');
  error.name = 'AbortError';
  return error;
}

// eslint-disable-next-line complexity -- Retry policy keeps every safety and budget exit in one loop.
export async function retryTelegramOperation(
  operation,
  {
    baseDelayMs = 250,
    idempotent = false,
    jitter = Math.random,
    logger,
    maxAttempts = 4,
    maxDelayMs = 10_000,
    maxElapsedMs = 30_000,
    now = Date.now,
    operationName = 'telegram-operation',
    signal,
    sleep = (milliseconds) => wait(milliseconds, undefined, { signal }),
    sourceId,
    correlationId,
    transport = 'telegram',
  } = {}
) {
  const startedAt = now();
  let attempt = 1;
  let lastError;
  while (true) {
    if (signal?.aborted) {
      throw abortError();
    }
    if (lastError && now() - startedAt >= maxElapsedMs) {
      throw lastError;
    }
    try {
      return await operation({ attempt, signal });
    } catch (error) {
      lastError = error;
      const policy = classifyTelegramError(error);
      const safe = idempotent || error?.preSend === true;
      const exhausted =
        attempt >= maxAttempts || now() - startedAt >= maxElapsedMs;
      if (!safe || !policy.retryable || exhausted) {
        throw error;
      }
      const exponential = baseDelayMs * 2 ** (attempt - 1);
      const boundedJitter = Math.min(1, Math.max(0, jitter()));
      const requested =
        policy.delayMs ?? exponential + exponential * 0.25 * boundedJitter;
      const remainingMs = maxElapsedMs - (now() - startedAt);
      const delayMs = Math.min(maxDelayMs, requested, remainingMs);
      if (delayMs <= 0) {
        throw error;
      }
      logger?.warn?.('telegram operation retry', {
        attempt,
        category: policy.category,
        correlationId,
        delayMs,
        operation: operationName,
        sourceId,
        transport,
      });
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

const SENSITIVE_KEY =
  /^(?:api[_-]?hash|authorization|code|password|phone|session|token|raw[_-]?update|update)$/iu;

function redactString(value) {
  return value
    .replace(/\b\d{6,12}:[A-Za-z\d_-]{20,}\b/gu, '[REDACTED_TOKEN]')
    .replace(
      /\b(token|session|api[_-]?hash|password|authorization)=\S+/giu,
      '$1=[REDACTED]'
    );
}

export function redactTelegramValue(value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((child) => redactTelegramValue(child, seen));
  }
  const entries =
    value instanceof Error
      ? [
          ['name', value.name],
          ['message', value.message],
          ['cause', value.cause],
          ['errors', value.errors],
        ]
      : Object.entries(value);
  return Object.fromEntries(
    entries
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [
        key,
        SENSITIVE_KEY.test(key)
          ? '[REDACTED]'
          : redactTelegramValue(child, seen),
      ])
  );
}
