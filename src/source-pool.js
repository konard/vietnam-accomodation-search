// Runs sources through a bounded set of workers. Each source has a hard
// timeout and the whole run has a budget; when either expires the affected
// sources are reported and the run returns whatever already finished.

import { PAGE_CLASSIFICATIONS, untilAborted } from './browser-adapters.js';

export { untilAborted };

export const SOURCE_STATUSES = Object.freeze({
  BLOCKED: 'blocked',
  CANCELLED: 'cancelled',
  CHALLENGE: 'challenge',
  DISABLED: 'disabled',
  EMPTY: 'empty',
  ERROR: 'error',
  OFFERS: 'offers',
  PENDING: 'pending',
  TIMEOUT: 'timeout',
});

const CHALLENGE_CATEGORIES = new Set([
  'BROWSER_DOMAIN_CHALLENGED',
  PAGE_CLASSIFICATIONS.CHALLENGE,
  PAGE_CLASSIFICATIONS.CONSENT,
  PAGE_CLASSIFICATIONS.LOGIN,
]);

const BLOCKED_CATEGORIES = new Set([
  'BROWSER_DOMAIN_BUDGET_EXHAUSTED',
  'auth',
  'blocked',
  'forbidden',
  'rate-limit',
]);

export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

export function failureCategory(error) {
  return (
    error?.classification ||
    error?.code ||
    (error?.status ? `http-${error.status}` : undefined) ||
    'collection-failure'
  );
}

export function statusForFailure(category, status) {
  // A results page that loaded and listed nothing is a successful answer.
  if (category === PAGE_CLASSIFICATIONS.EMPTY) {
    return SOURCE_STATUSES.EMPTY;
  }
  if (category === 'disabled-adapter') {
    return SOURCE_STATUSES.DISABLED;
  }
  if (CHALLENGE_CATEGORIES.has(category)) {
    return SOURCE_STATUSES.CHALLENGE;
  }
  if (
    BLOCKED_CATEGORIES.has(category) ||
    status === 401 ||
    status === 403 ||
    status === 429
  ) {
    return SOURCE_STATUSES.BLOCKED;
  }
  return SOURCE_STATUSES.ERROR;
}

export class SourceTimeoutError extends Error {
  constructor(kind, milliseconds) {
    super(
      kind === 'budget'
        ? `Search budget of ${milliseconds} ms elapsed.`
        : `Source exceeded its ${milliseconds} ms timeout.`
    );
    this.code = kind === 'budget' ? 'SEARCH_BUDGET_ELAPSED' : 'SOURCE_TIMEOUT';
    this.name = 'SourceTimeoutError';
  }
}

function hostOf(source) {
  try {
    return new globalThis.URL(
      String(source.searchUrl || '').replaceAll('{query}', 'q')
    ).hostname;
  } catch {
    return source.id;
  }
}

function startTimer(milliseconds, onElapsed) {
  if (!(milliseconds > 0) || !Number.isFinite(milliseconds)) {
    return () => {};
  }
  const timer = setTimeout(onElapsed, milliseconds);
  timer.unref?.();
  return () => clearTimeout(timer);
}

// `run(source, { signal, worker })` collects one source; `openWorker(index)`
// returns the per-worker context (for example a browser page) or undefined
// when no further worker can be opened. `isWorkerLost(error)` marks failures
// that leave the worker unusable. `onSettled(outcome, value)` sees
// every finished source before the pool moves on.
export async function runSourcePool(
  sources,
  {
    budgetMs = Infinity,
    concurrency = 1,
    isWorkerLost = () => false,
    now = Date.now,
    onSettled = () => {},
    openWorker = () => ({}),
    retireWorker = () => {},
    run,
    signal,
    sourceTimeoutMs = Infinity,
  }
) {
  const pending = [...sources];
  const activeHosts = new Map();
  const outcomes = new Map();
  const budget = new AbortController();
  const stopBudget = startTimer(budgetMs, () =>
    budget.abort(new SourceTimeoutError('budget', budgetMs))
  );

  const nextSource = () => {
    const index = pending.findIndex(
      (source) => !activeHosts.get(hostOf(source))
    );
    return pending.splice(index === -1 ? 0 : index, 1)[0];
  };

  const settle = async (source, outcome, value) => {
    outcomes.set(source.id, outcome);
    await onSettled(outcome, value);
  };

  const runOne = async (source, worker) => {
    const host = hostOf(source);
    activeHosts.set(host, (activeHosts.get(host) || 0) + 1);
    const startedAt = now();
    const controller = new AbortController();
    const stopTimeout = startTimer(sourceTimeoutMs, () =>
      controller.abort(new SourceTimeoutError('source', sourceTimeoutMs))
    );
    const relay = () => controller.abort(budget.signal.reason);
    const relayUser = () => controller.abort(signal.reason);
    budget.signal.addEventListener('abort', relay, { once: true });
    signal?.addEventListener('abort', relayUser, { once: true });
    try {
      const value = await untilAborted(
        Promise.resolve().then(() =>
          run(source, { signal: controller.signal, worker })
        ),
        controller.signal
      );
      await settle(
        source,
        {
          durationMs: now() - startedAt,
          offers: value.length,
          sourceId: source.id,
          status: value.length ? SOURCE_STATUSES.OFFERS : SOURCE_STATUSES.EMPTY,
        },
        value
      );
      return { abandoned: false };
    } catch (error) {
      const timeout = error instanceof SourceTimeoutError;
      const cancelled = !timeout && (signal?.aborted || isAbortError(error));
      const category = timeout ? error.code : failureCategory(error);
      await settle(
        source,
        {
          category,
          durationMs: now() - startedAt,
          message: error?.message,
          offers: 0,
          sourceId: source.id,
          status: timeout
            ? SOURCE_STATUSES.TIMEOUT
            : cancelled
              ? SOURCE_STATUSES.CANCELLED
              : statusForFailure(category, error?.status),
        },
        error
      );
      return { abandoned: timeout || isWorkerLost(error) };
    } finally {
      stopTimeout();
      budget.signal.removeEventListener('abort', relay);
      signal?.removeEventListener('abort', relayUser);
      activeHosts.set(host, activeHosts.get(host) - 1);
    }
  };

  const work = async (index) => {
    let worker = await openWorker(index);
    while (worker && pending.length && !budget.signal.aborted) {
      if (signal?.aborted) {
        return;
      }
      const { abandoned } = await runOne(nextSource(), worker);
      if (abandoned) {
        // A timed-out source may still be using this worker, and a lost
        // worker fails every later source, so a fresh one takes its place.
        await retireWorker(worker);
        worker =
          budget.signal.aborted || signal?.aborted
            ? undefined
            : await openWorker(index);
      }
    }
  };

  try {
    // Every in-flight source rejects as soon as its signal aborts, so the
    // workers settle promptly after a timeout, the budget, or cancellation.
    await Promise.all(
      Array.from({ length: Math.max(1, concurrency) }, (_, index) =>
        work(index)
      )
    );
    if (signal?.aborted) {
      throw signal.reason;
    }
  } finally {
    stopBudget();
  }
  for (const source of sources) {
    if (!outcomes.has(source.id)) {
      outcomes.set(source.id, {
        category: budget.signal.aborted ? 'SEARCH_BUDGET_ELAPSED' : undefined,
        offers: 0,
        sourceId: source.id,
        status: SOURCE_STATUSES.PENDING,
      });
    }
  }
  return {
    budgetElapsed: budget.signal.aborted,
    outcomes: sources.map((source) => outcomes.get(source.id)),
  };
}

export function summarizeOutcomes(outcomes = []) {
  const byStatus = {};
  const failedCategories = {};
  for (const outcome of outcomes) {
    byStatus[outcome.status] = (byStatus[outcome.status] || 0) + 1;
    if (
      ![SOURCE_STATUSES.OFFERS, SOURCE_STATUSES.EMPTY].includes(outcome.status)
    ) {
      const category = outcome.category || outcome.status;
      failedCategories[category] = (failedCategories[category] || 0) + 1;
    }
  }
  const succeeded =
    (byStatus[SOURCE_STATUSES.OFFERS] || 0) +
    (byStatus[SOURCE_STATUSES.EMPTY] || 0);
  return {
    allFailed: outcomes.length > 0 && succeeded === 0,
    byStatus,
    failed: outcomes.length - succeeded,
    failedCategories,
    succeeded,
    total: outcomes.length,
  };
}

export function describeFailures(summary) {
  const categories = Object.entries(summary.failedCategories)
    .sort((left, right) => right[1] - left[1])
    .map(([category, count]) => `${category} ×${count}`)
    .join(', ');
  return `All ${summary.total} sources failed: ${categories}.`;
}
