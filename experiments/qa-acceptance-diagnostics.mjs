// Only finite metadata crosses the public/private diagnostic boundary.
import {
  telegramErrorField as field,
  sdkFloodWaitSeconds,
} from '../src/telegram-error-fields.js';

const PHASES = new Set([
  'setup',
  'source-selection',
  'storage-guard',
  'collection',
  'review',
  'inventory',
  'evidence-write',
  'source-resolution',
  'history-page',
  'history-checksum',
  'history-analysis',
  'cleanup',
]);
const CODES = new Set([
  'QA_HEAVY_BUSY',
  'QA_HEAVY_LOCK_UNAVAILABLE',
  'QA_HEAVY_LOCK_CHANGED',
  'QA_HEAVY_RECOVERY_REQUIRED',
  'QA_CAPACITY_UNAVAILABLE',
  'QA_CAPACITY_CONFIGURATION',
  'QA_DISK_PREFLIGHT',
  'QA_DISK_FLOOR',
  'ENOENT',
  'EACCES',
  'EIO',
  'ENOSPC',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ABORT_ERR',
  'ERR_ASSERTION',
  'CHANNEL_PRIVATE',
  'CHANNEL_INVALID',
  'USERNAME_NOT_OCCUPIED',
  'USERNAME_INVALID',
  'PEER_ID_INVALID',
  'AUTH_KEY_UNREGISTERED',
  'SESSION_REVOKED',
  'SESSION_EXPIRED',
  'RPC_CALL_FAIL',
  'INVALID_MESSAGE_DATE',
  'HISTORY_CHECKSUM_MISMATCH',
  'HISTORY_CHECKPOINT_MISMATCH',
  'HISTORY_PAGINATION_INVALID',
]);
const TYPES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'AggregateError',
  'AssertionError',
  'AbortError',
  'RpcError',
]);

const CODE_CATEGORIES = new Map([
  ['EIO', 'storage-failure'],
  ['ENOSPC', 'storage-failure'],
  ['ENOENT', 'configuration-failure'],
  ['EACCES', 'configuration-failure'],
  ['AUTH_KEY_UNREGISTERED', 'authentication-failure'],
  ['SESSION_REVOKED', 'authentication-failure'],
  ['SESSION_EXPIRED', 'authentication-failure'],
  ['FLOOD_WAIT', 'rate-limited'],
  ['INVALID_MESSAGE_DATE', 'evidence-invalid'],
  ['ABORT_ERR', 'interrupted'],
]);

function category(error, code) {
  if (field(error, 'name') === 'AggregateError') {
    return 'cleanup-failure';
  }
  if (code?.startsWith('QA_')) {
    return 'guard-rejection';
  }
  if (CODE_CATEGORIES.has(code)) {
    return CODE_CATEGORIES.get(code);
  }
  if (/^(?:CHANNEL|USERNAME|PEER)_/u.test(code || '')) {
    return 'source-unavailable';
  }
  if (code?.startsWith('HISTORY_')) {
    return 'evidence-invalid';
  }
  if (field(error, 'name') === 'AbortError') {
    return 'interrupted';
  }
  // Read bounded text only to classify; never retain or print it.
  const message = field(error, 'message');
  if (
    /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|timeout|timed out|disconnect|connection closed/iu.test(
      `${code || ''} ${typeof message === 'string' ? message.slice(0, 2048) : ''}`
    )
  ) {
    return 'transport-failure';
  }
  return 'unknown';
}

function safeCode(error) {
  if (sdkFloodWaitSeconds(error) !== undefined) {
    return 'FLOOD_WAIT';
  }
  for (const candidate of [
    field(error, 'code'),
    field(error, 'errorMessage'),
  ]) {
    if (typeof candidate !== 'string') {
      continue;
    }
    if (CODES.has(candidate)) {
      return candidate;
    }
    if (/^FLOOD_WAIT(?:_\d{1,6})?$/u.test(candidate)) {
      return 'FLOOD_WAIT';
    }
  }
  return undefined;
}

function nestedCauses(error) {
  const errors = field(error, 'errors');
  try {
    if (Array.isArray(errors)) {
      return Array.from(
        { length: Math.min(field(errors, 'length'), 4) },
        (_, index) => field(errors, index)
      );
    }
  } catch {
    // Even Array.isArray can throw for a revoked proxy; ignore unsafe causes.
  }
  const cause = field(error, 'cause');
  return cause ? [cause] : [];
}

export function safeAcceptanceFailure(
  error,
  phase = field(error, 'qaPhase'),
  depth = 0,
  seen = new Set()
) {
  if (!error || depth > 2 || seen.has(error)) {
    return { phase: 'unknown', category: 'unknown' };
  }
  seen.add(error);
  const code = safeCode(error);
  const type =
    field(field(error, 'constructor'), 'name') || field(error, 'name');
  const summary = {
    type: TYPES.has(type) ? type : 'Error',
    phase: PHASES.has(phase) ? phase : 'unknown',
    category: category(error, code),
    ...(code ? { code } : {}),
  };
  const causes = nestedCauses(error);
  if (causes.length && depth < 2) {
    summary.causes = causes
      .slice(0, 4)
      .map((cause) =>
        safeAcceptanceFailure(
          cause,
          field(cause, 'qaPhase') || phase,
          depth + 1,
          seen
        )
      );
  }
  return summary;
}

export async function acceptancePhase(phase, operation) {
  try {
    return await operation();
  } catch (error) {
    if (error && typeof error === 'object') {
      error.qaPhase = typeof phase === 'function' ? phase() : phase;
    }
    throw error;
  }
}
