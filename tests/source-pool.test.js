import { describe, expect } from 'test-anywhere';

import {
  SOURCE_STATUSES,
  SourceTimeoutError,
  describeFailures,
  failureCategory,
  isAbortError,
  runSourcePool,
  statusForFailure,
  summarizeOutcomes,
  untilAborted,
} from '../src/source-pool.js';
import { it } from './fixtures/held-it.mjs';

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const source = (id, host = `${id}.test`) => ({
  id,
  searchUrl: `https://${host}/search?q={query}`,
});

// Settles only when the source signal aborts, like a hung page load.
const hang = (signal) =>
  new Promise((_resolve, reject) =>
    signal.addEventListener('abort', () => reject(signal.reason), {
      once: true,
    })
  );

describe('runSourcePool concurrency', () => {
  it('keeps active sources within `concurrency` and returns every outcome', async () => {
    let active = 0;
    let peak = 0;
    const settled = [];
    const result = await runSourcePool(
      ['a', 'b', 'c', 'd', 'e'].map((id) => source(id)),
      {
        concurrency: 2,
        onSettled: (outcome) => settled.push(outcome.sourceId),
        run: async (current) => {
          active += 1;
          peak = Math.max(peak, active);
          await wait(5);
          active -= 1;
          return current.id === 'c' ? [] : [{ id: current.id }];
        },
      }
    );
    expect(peak).toBe(2);
    expect(settled.length).toBe(5);
    expect(result.budgetElapsed).toBe(false);
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      'offers',
      'offers',
      'empty',
      'offers',
      'offers',
    ]);
    expect(result.outcomes[0].offers).toBe(1);
  });

  it('starts sources on different hosts before a second one on a busy host', async () => {
    const started = [];
    await runSourcePool(
      [source('a1', 'same.test'), source('a2', 'same.test'), source('b')],
      {
        concurrency: 2,
        run: async (current) => {
          started.push(current.id);
          await wait(5);
          return [];
        },
      }
    );
    expect(started.slice(0, 2)).toEqual(['a1', 'b']);
  });

  it('runs serially when only one worker can be opened', async () => {
    let active = 0;
    let peak = 0;
    const opened = [];
    await runSourcePool([source('a'), source('b'), { id: 'no-url' }], {
      concurrency: 3,
      openWorker: (index) => {
        opened.push(index);
        return index === 0 ? { page: 'first' } : undefined;
      },
      run: async (_current, { worker }) => {
        expect(worker.page).toBe('first');
        active += 1;
        peak = Math.max(peak, active);
        await wait(2);
        active -= 1;
        return [];
      },
    });
    expect(peak).toBe(1);
    expect(opened.sort()).toEqual([0, 1, 2]);
  });

  it('accepts an empty source list', async () => {
    const result = await runSourcePool([], { run: () => [] });
    expect(result).toEqual({ budgetElapsed: false, outcomes: [] });
  });
});

describe('runSourcePool timeouts and budget', () => {
  it('times out a hung source, retires its worker, and continues', async () => {
    const opened = [];
    const retired = [];
    const result = await runSourcePool([source('hung'), source('next')], {
      openWorker: () => {
        const worker = { id: opened.length };
        opened.push(worker.id);
        return worker;
      },
      retireWorker: (worker) => retired.push(worker.id),
      run: (current, { signal }) =>
        current.id === 'hung' ? hang(signal) : [{ id: 'offer' }],
      sourceTimeoutMs: 20,
    });
    expect(result.outcomes[0].status).toBe(SOURCE_STATUSES.TIMEOUT);
    expect(result.outcomes[0].category).toBe('SOURCE_TIMEOUT');
    expect(result.outcomes[1].status).toBe(SOURCE_STATUSES.OFFERS);
    expect(retired).toEqual([0]);
    expect(opened).toEqual([0, 1]);
  });

  it('returns finished work when a source ignores its abort signal', async () => {
    const result = await runSourcePool([source('stuck')], {
      run: () => new Promise(() => {}),
      sourceTimeoutMs: 10,
    });
    expect(result.outcomes[0].status).toBe(SOURCE_STATUSES.TIMEOUT);
  });

  it('stops at the budget and reports unstarted sources as pending', async () => {
    const retired = [];
    let opened = 0;
    const result = await runSourcePool(
      [source('slow'), source('later'), source('last')],
      {
        budgetMs: 20,
        openWorker: () => {
          opened += 1;
          return {};
        },
        retireWorker: () => retired.push('retired'),
        run: (_current, { signal }) => hang(signal),
      }
    );
    expect(result.budgetElapsed).toBe(true);
    expect(result.outcomes[0].category).toBe('SEARCH_BUDGET_ELAPSED');
    expect(result.outcomes[0].status).toBe(SOURCE_STATUSES.TIMEOUT);
    expect(result.outcomes.slice(1)).toEqual([
      {
        category: 'SEARCH_BUDGET_ELAPSED',
        offers: 0,
        sourceId: 'later',
        status: SOURCE_STATUSES.PENDING,
      },
      {
        category: 'SEARCH_BUDGET_ELAPSED',
        offers: 0,
        sourceId: 'last',
        status: SOURCE_STATUSES.PENDING,
      },
    ]);
    expect(retired.length).toBe(1);
    expect(opened).toBe(1);
  });

  it('reports pending sources without a category when no worker opens', async () => {
    const result = await runSourcePool([source('a')], {
      openWorker: () => undefined,
      run: () => [],
    });
    expect(result.outcomes[0]).toEqual({
      category: undefined,
      offers: 0,
      sourceId: 'a',
      status: SOURCE_STATUSES.PENDING,
    });
  });
});

describe('runSourcePool cancellation', () => {
  it('aborts in-flight sources and rethrows the caller reason', async () => {
    const controller = new AbortController();
    const reason = Object.assign(new Error('stop'), { name: 'AbortError' });
    const seen = [];
    let caught;
    setTimeout(() => controller.abort(reason), 10);
    try {
      await runSourcePool([source('a'), source('b')], {
        onSettled: (outcome) => seen.push(outcome.status),
        retireWorker: () => {
          throw new Error('cancelled workers are not retired');
        },
        run: (_current, { signal }) => hang(signal),
        signal: controller.signal,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(reason);
    expect(seen).toEqual([SOURCE_STATUSES.CANCELLED]);
  });

  it('does not reopen a worker after a timeout once the caller aborted', async () => {
    const controller = new AbortController();
    let opened = 0;
    let caught;
    try {
      await runSourcePool([source('a'), source('b')], {
        openWorker: () => {
          opened += 1;
          return {};
        },
        run: (_current, { signal }) =>
          hang(signal).catch((error) => {
            controller.abort(new Error('caller stop'));
            throw error;
          }),
        signal: controller.signal,
        sourceTimeoutMs: 10,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught.message).toBe('caller stop');
    expect(opened).toBe(1);
  });

  it('stops before the next source when the caller aborts between sources', async () => {
    const controller = new AbortController();
    const started = [];
    let caught;
    try {
      await runSourcePool([source('a'), source('b')], {
        onSettled: () => controller.abort(new Error('between')),
        run: (current) => {
          started.push(current.id);
          return [];
        },
        signal: controller.signal,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught.message).toBe('between');
    expect(started).toEqual(['a']);
  });
});

describe('untilAborted', () => {
  it('rejects with the signal reason before or during the operation', async () => {
    const early = new AbortController();
    early.abort(new Error('already stopped'));
    let caught;
    try {
      await untilAborted(new Promise(() => {}), early.signal);
    } catch (error) {
      caught = error;
    }
    expect(caught.message).toBe('already stopped');

    const late = new AbortController();
    setTimeout(() => late.abort(new Error('stopped later')), 5);
    try {
      await untilAborted(new Promise(() => {}), late.signal);
    } catch (error) {
      caught = error;
    }
    expect(caught.message).toBe('stopped later');
    expect(
      await untilAborted(Promise.resolve(7), new AbortController().signal)
    ).toBe(7);
  });
});

describe('source failure classification', () => {
  it('maps collection failures to outcome statuses', async () => {
    const failures = {
      blocked: Object.assign(new Error('403'), { status: 403 }),
      budget: Object.assign(new Error('budget'), {
        code: 'BROWSER_DOMAIN_BUDGET_EXHAUSTED',
      }),
      challenge: Object.assign(new Error('captcha'), {
        classification: 'challenge',
      }),
      disabled: Object.assign(new Error('off'), {
        classification: 'disabled-adapter',
      }),
      empty: Object.assign(new Error('no rows'), { classification: 'empty' }),
      error: new Error('boom'),
      wall: Object.assign(new Error('cookies'), {
        classification: 'consent-wall',
      }),
      limited: Object.assign(new Error('429'), { status: 429 }),
      server: Object.assign(new Error('500'), { status: 500 }),
      stopped: Object.assign(new Error('aborted'), { name: 'AbortError' }),
    };
    const result = await runSourcePool(
      Object.keys(failures).map((id) => source(id)),
      {
        run: (current) => {
          throw failures[current.id];
        },
      }
    );
    expect(
      Object.fromEntries(
        result.outcomes.map((outcome) => [
          outcome.sourceId,
          [outcome.status, outcome.category],
        ])
      )
    ).toEqual({
      blocked: ['blocked', 'http-403'],
      budget: ['blocked', 'BROWSER_DOMAIN_BUDGET_EXHAUSTED'],
      challenge: ['challenge', 'challenge'],
      disabled: ['disabled', 'disabled-adapter'],
      empty: ['empty', 'empty'],
      error: ['error', 'collection-failure'],
      limited: ['blocked', 'http-429'],
      server: ['error', 'http-500'],
      stopped: ['cancelled', 'collection-failure'],
      wall: ['challenge', 'consent-wall'],
    });
    expect(
      result.outcomes.find((outcome) => outcome.sourceId === 'error').message
    ).toBe('boom');
  });

  it('exposes the classification helpers', () => {
    expect(isAbortError({ code: 'ABORT_ERR' })).toBe(true);
    expect(isAbortError(undefined)).toBe(false);
    expect(failureCategory(undefined)).toBe('collection-failure');
    expect(statusForFailure('login')).toBe('challenge');
    expect(statusForFailure('anything', 401)).toBe('blocked');
    expect(new SourceTimeoutError('source', 5).message).toContain('5 ms');
    expect(new SourceTimeoutError('budget', 7).code).toBe(
      'SEARCH_BUDGET_ELAPSED'
    );
  });
});

describe('outcome summaries', () => {
  it('counts statuses and failure categories', () => {
    const summary = summarizeOutcomes([
      { category: 'http-403', status: 'blocked' },
      { category: 'http-403', status: 'blocked' },
      { status: 'pending' },
      { category: 'SOURCE_TIMEOUT', status: 'timeout' },
    ]);
    expect(summary).toEqual({
      allFailed: true,
      byStatus: { blocked: 2, pending: 1, timeout: 1 },
      failed: 4,
      failedCategories: { 'http-403': 2, pending: 1, SOURCE_TIMEOUT: 1 },
      succeeded: 0,
      total: 4,
    });
    expect(describeFailures(summary)).toBe(
      'All 4 sources failed: http-403 ×2, pending ×1, SOURCE_TIMEOUT ×1.'
    );
  });

  it('treats empty results as success and an empty run as not failed', () => {
    const mixed = summarizeOutcomes([{ status: 'empty' }, { status: 'error' }]);
    expect([mixed.allFailed, mixed.failed, mixed.succeeded]).toEqual([
      false,
      1,
      1,
    ]);
    expect(summarizeOutcomes().allFailed).toBe(false);
  });
});
