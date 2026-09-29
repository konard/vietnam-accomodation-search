/**
 * Pure identity and cleanup rules for the manual Telegram conversation E2E.
 * Errors name the role only; a numeric identity is never included.
 */

export const CONVERSATION_MODES = ['bot-only', 'both', 'degraded'];

const NUMERIC_ID = /^[1-9]\d{0,19}$/u;

// Every role needs its own pin: the bot, the MTProto driver that plays the
// end user, and (in combined mode) the runtime user whose session the bot
// process loads. Two roles sharing one account would hide routing mistakes.
const ROLES = [
  {
    names: ['TELEGRAM_E2E_EXPECTED_BOT_ID', 'TELEGRAM_EXPECTED_BOT_ID'],
    role: 'bot',
    source: 'bot',
  },
  {
    names: ['TELEGRAM_E2E_EXPECTED_USER_ID', 'TELEGRAM_EXPECTED_USER_ID'],
    role: 'driver',
    source: 'driver',
  },
  {
    names: ['TELEGRAM_EXPECTED_USER_ID'],
    role: 'runtime user',
    source: 'runtimeUser',
  },
];

function pinFrom(environment, names) {
  for (const name of names) {
    const value = String(environment?.[name] ?? '').trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

/**
 * Read and check the independent numeric identity pins before any network
 * call. The runtime user is pinned only in combined mode, where the bot
 * process loads its session.
 */
export function requireIdentityPins({ bot, driver, mode, runtimeUser }) {
  if (!CONVERSATION_MODES.includes(mode)) {
    throw new TypeError(`--mode must be ${CONVERSATION_MODES.join(', ')}.`);
  }
  const environments = { bot, driver, runtimeUser };
  const pins = {};
  for (const { names, role, source } of ROLES) {
    if (source === 'runtimeUser' && mode !== 'both') {
      continue;
    }
    const pin = pinFrom(environments[source], names);
    if (!pin) {
      throw new Error(
        `The ${role} identity pin is required (${names.join(' or ')}).`
      );
    }
    if (!NUMERIC_ID.test(pin)) {
      throw new Error(
        `The ${role} identity pin must be a numeric Telegram ID.`
      );
    }
    const shared = Object.entries(pins).find(([, value]) => value === pin);
    if (shared) {
      throw new Error(
        `The ${role} and ${shared[0]} identity pins must name different accounts.`
      );
    }
    pins[role] = pin;
  }
  return pins;
}

/** Compare an observed identity with its pin without revealing either. */
export function assertPinnedIdentity(role, expected, actual) {
  if (!actual || String(actual) !== String(expected)) {
    throw new Error(`Telegram ${role} identity pin mismatch.`);
  }
  return String(actual);
}

/**
 * A degraded combined run configures an incomplete runtime user, so the bot
 * process must announce that it continues bot-only and still pass every
 * bot-owned step.
 */
export function degradedRuntimeEnvironment() {
  return {
    TELEGRAM_API_HASH: 'e2e-degraded-without-session',
    TELEGRAM_API_ID: '1',
  };
}

export function assertDegradedToBotOnly(redactedLog) {
  if (!String(redactedLog).includes('continuing in bot-only mode')) {
    throw new Error(
      'The degraded combined runtime did not report continuing bot-only.'
    );
  }
  return true;
}

/**
 * Count the messages that still exist after cleanup. The caller re-reads the
 * conversation after deletion; anything newer than the boundary is a
 * leftover of this run.
 */
export function countLeftovers(messages, baselineMessageId, messageId) {
  return messages.filter((message) => messageId(message) > baselineMessageId)
    .length;
}
