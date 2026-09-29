/**
 * Pure parts of the manual native mtcute capability E2E. Results are
 * transports, error categories, and counts; never identities, message text,
 * or credentials.
 */

import { classifyTelegramError } from '../src/index.js';

export const CAPABILITY_SCENARIOS = [
  'user-only',
  'combined',
  'degraded',
  'fallback',
  'ambiguous-send',
];

export const NATIVE_SESSION_FORMAT = 'mtcute/session-string-v1';

// Steps that must pass and steps that must fail closed in every scenario.
// A degraded runtime has no usable user session: bot capabilities keep
// working and the user-only ones fail. An ambiguous send must not reach the
// fallback client.
export const SCENARIO_STEPS = {
  'ambiguous-send': { fail: ['send'], pass: [] },
  combined: {
    fail: [],
    pass: [
      'identity',
      'resolveEntity',
      'popularity',
      'membership',
      'history',
      'media',
      'liveUpdates',
      'send',
      'availability',
      'restartIdempotency',
    ],
  },
  degraded: {
    fail: ['history', 'liveUpdates'],
    pass: ['identity', 'resolveEntity', 'popularity', 'send'],
  },
  fallback: { fail: [], pass: ['send'] },
  'user-only': {
    fail: [],
    pass: [
      'identity',
      'resolveEntity',
      'popularity',
      'membership',
      'history',
      'media',
      'liveUpdates',
      'send',
      'availability',
    ],
  },
};

const FALLBACK_CATEGORIES = new Set(['blocked', 'capability', 'entity']);
const USERNAME = /^@?([A-Za-z][A-Za-z\d_]{4,31})$/u;

function boundedInteger(value, name, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

export function parseCapabilityArguments(values) {
  const options = { scenarios: CAPABILITY_SCENARIOS, timeoutMs: 60_000 };
  const valued = new Map([
    ['--bot-env', 'botEnv'],
    ['--driver-env', 'driverEnv'],
    ['--scenarios', 'scenarios'],
    ['--source', 'source'],
    ['--timeout-ms', 'timeoutMs'],
    ['--user-env', 'userEnv'],
  ]);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--help') {
      options.help = true;
      continue;
    }
    const property = valued.get(value);
    if (!property || values[index + 1] === undefined) {
      throw new TypeError(`Unknown or incomplete option: ${value}`);
    }
    options[property] = values[index + 1];
    index += 1;
  }
  if (options.help) {
    return options;
  }
  for (const name of ['botEnv', 'driverEnv', 'source', 'userEnv']) {
    if (!options[name]) {
      throw new TypeError(
        '--bot-env, --user-env, --driver-env, and --source are required.'
      );
    }
  }
  const source = USERNAME.exec(options.source);
  if (!source) {
    throw new TypeError('--source must be a public channel @username.');
  }
  options.source = `@${source[1]}`;
  options.timeoutMs = boundedInteger(
    options.timeoutMs,
    '--timeout-ms',
    5_000,
    600_000
  );
  if (typeof options.scenarios === 'string') {
    options.scenarios = options.scenarios.split(',').filter(Boolean);
  }
  if (
    !options.scenarios.length ||
    options.scenarios.some((name) => !CAPABILITY_SCENARIOS.includes(name))
  ) {
    throw new TypeError(
      `--scenarios must list ${CAPABILITY_SCENARIOS.join(', ')}.`
    );
  }
  return options;
}

/**
 * The runtime user must bring a declared native mtcute session. Any other
 * format (such as a GramJS test-driver session) is refused, never converted.
 */
export function requireNativeSessionFormat(environment = {}) {
  const format = environment.TELEGRAM_USER_SESSION_FORMAT || '';
  if (format !== NATIVE_SESSION_FORMAT) {
    throw new Error(
      `The runtime user needs TELEGRAM_USER_SESSION_FORMAT=${NATIVE_SESSION_FORMAT}; other sessions are not converted.`
    );
  }
  return format;
}

export function publicUsername(value) {
  const match = USERNAME.exec(String(value || ''));
  return match ? `@${match[1]}` : undefined;
}

/**
 * Wrap a provider so every capability call records its transport and the
 * classified outcome. `afterSend` injects a lost response after a real send:
 * the message exists, but the router cannot know it.
 */
export function recordingProvider(provider, { afterSend, calls }) {
  const recorded = {
    capabilities: provider.capabilities,
    destroyed: 0,
    transport: provider.transport || 'bot-api',
  };
  const methods = [
    'history',
    'identity',
    'liveUpdates',
    'media',
    'membership',
    'popularity',
    'resolveEntity',
    'send',
  ];
  for (const method of methods) {
    if (typeof provider[method] !== 'function') {
      continue;
    }
    recorded[method] = async (...arguments_) => {
      const call = { capability: method, transport: recorded.transport };
      calls.push(call);
      try {
        const result = await provider[method](...arguments_);
        if (method === 'send' && afterSend) {
          call.injected = true;
          call.sentMessage = result;
          throw afterSend();
        }
        call.outcome = 'ok';
        return result;
      } catch (error) {
        call.outcome ??= classifyTelegramError(error).category;
        throw error;
      }
    };
  }
  recorded.destroy = async () => {
    recorded.destroyed += 1;
    await provider.destroy?.();
  };
  return recorded;
}

export function lostResponseError() {
  return Object.assign(new Error('Injected response loss after a send.'), {
    code: 'ETIMEDOUT',
  });
}

/** Group recorded calls as `transport:outcome` paths per capability. */
export function summarizeCalls(calls) {
  const summary = {};
  for (const { capability, injected, outcome, transport } of calls) {
    summary[capability] = [
      ...(summary[capability] || []),
      `${transport}:${outcome}${injected ? ':injected' : ''}`,
    ];
  }
  return summary;
}

function routingFailures({ botCapabilities, calls, mode }) {
  const failures = [];
  const previous = new Map();
  for (const call of calls) {
    const prior = previous.get(call.capability);
    previous.set(call.capability, call);
    if (call.transport !== 'mtproto') {
      if (mode === 'user-only') {
        failures.push(`${call.capability} used the bot in user-only mode`);
      }
      continue;
    }
    if (mode === 'user-only' || !botCapabilities.has(call.capability)) {
      continue;
    }
    if (
      !prior ||
      prior.transport === 'mtproto' ||
      !FALLBACK_CATEGORIES.has(prior.outcome)
    ) {
      failures.push(
        `${call.capability} reached the user client without a pre-send bot failure`
      );
    }
    if (call.capability === 'send' && prior?.injected) {
      failures.push('an ambiguous send fell back to the user client');
    }
  }
  return failures;
}

/**
 * A scenario passes only when its steps have the expected outcomes, routing
 * stays bot-first by capability, every test message is delivered exactly one
 * time, both clients are destroyed, and no test message remains.
 */
// eslint-disable-next-line complexity -- Each scenario invariant is one flat check.
export function evaluateCapabilityScenario({
  botCapabilities = new Set(),
  calls = [],
  cleanup = {},
  deliveries = {},
  name,
  steps = [],
}) {
  const expected = SCENARIO_STEPS[name];
  const failures = [];
  const outcome = new Map(steps.map((step) => [step.name, step]));
  for (const step of expected.pass) {
    if (!outcome.get(step)?.ok) {
      failures.push(
        `${step} failed${outcome.get(step)?.category ? ` (${outcome.get(step).category})` : ' or did not run'}`
      );
    }
  }
  for (const step of expected.fail) {
    if (outcome.get(step)?.ok !== false) {
      failures.push(`${step} did not fail closed`);
    }
  }
  failures.push(
    ...routingFailures({
      botCapabilities,
      calls,
      mode: name === 'user-only' ? 'user-only' : 'both',
    })
  );
  if (name === 'fallback') {
    const sends = calls.filter((call) => call.capability === 'send');
    if (
      sends.length !== 2 ||
      sends[0].transport === 'mtproto' ||
      sends[1].transport !== 'mtproto' ||
      sends[1].outcome !== 'ok'
    ) {
      failures.push('the send did not fall back from the bot to the user');
    }
  }
  if (name === 'ambiguous-send') {
    const sends = calls.filter((call) => call.capability === 'send');
    if (sends.length !== 1 || !sends[0].injected) {
      failures.push('the ambiguous send was retried or rerouted');
    }
  }
  for (const [marker, count] of Object.entries(deliveries)) {
    if (count !== 1) {
      failures.push(`${marker} arrived ${count} times`);
    }
  }
  for (const [client, { created = 0, destroyed = 0 } = {}] of Object.entries(
    cleanup.clients || {}
  )) {
    if (destroyed < created) {
      failures.push(`the ${client} client was not destroyed`);
    }
  }
  if (cleanup.leftovers) {
    failures.push(`${cleanup.leftovers} test messages were left behind`);
  }
  return failures;
}
