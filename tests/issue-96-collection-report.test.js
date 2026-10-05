import { describe, expect } from 'test-anywhere';
import { URL } from 'node:url';

import { BrowserCollector } from '../src/index.js';
import { it } from './fixtures/held-it.mjs';

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function traceSink() {
  const events = [];
  return {
    events,
    persist: async () => {},
    record: (event) => events.push(event),
  };
}

const webSource = (id, extra = {}) => ({
  id,
  searchUrl: `https://${id}.example/search?q={query}`,
  type: 'web',
  ...extra,
});

// A browser whose pages answer each source by host: `rows` returns listing
// rows, `fail` rejects navigation, and `hang` never finishes loading.
function fakeBrowser({ behaviour = {}, newPage = true } = {}) {
  const events = [];
  const pages = [];
  const makePage = (name) => {
    const page = {
      close: async () => events.push(`close:${name}`),
      name,
    };
    pages.push(page);
    return page;
  };
  const browser = {
    close: async () => events.push('browser.close'),
  };
  if (newPage) {
    browser.newPage = async () => {
      if (behaviour.newPageFails) {
        throw new Error('no more tabs');
      }
      return makePage(`page-${pages.length}`);
    };
  }
  const runtime = {
    launchBrowser: async () => ({ browser, page: makePage('launched') }),
    makeBrowserCommander: ({ page }) => {
      let url;
      return {
        destroy: async () => {
          events.push(`destroy:${page.name}`);
          if (behaviour.destroyFails) {
            throw new Error('destroy failed');
          }
        },
        evaluate: async (operation) => {
          const host = new URL(url).hostname.split('.')[0];
          if (operation.name === 'extractPageState') {
            return { status: 200, url };
          }
          return host.startsWith('empty')
            ? []
            : [
                {
                  text: `${host} room 1,000,000 VND/night`,
                  title: `${host} room`,
                  url: `https://${host}.example/room`,
                },
              ];
        },
        goto: async ({ url: target }) => {
          url = target;
          events.push(`goto:${page.name}:${new URL(target).hostname}`);
          const host = new URL(target).hostname.split('.')[0];
          if (host.startsWith('hang')) {
            await new Promise(() => {});
          }
          if (host.startsWith('fail')) {
            throw Object.assign(new Error('forbidden'), { status: 403 });
          }
          await wait(2);
        },
      };
    },
  };
  return { browser, events, pages, runtime };
}

const collectorFor = (runtime, options = {}) =>
  new BrowserCollector({
    browserRuntime: runtime,
    logger: { debug: () => {} },
    rates: { VND: 1 },
    scheduler: { run: (_url, operation) => operation() },
    ...options,
  });

describe('BrowserCollector worker pool', () => {
  it('collects sources on separate pages and closes each one', async () => {
    const { events, runtime } = fakeBrowser();
    const trace = traceSink();
    const completions = [];
    const report = await collectorFor(runtime, {
      concurrency: 3,
    }).collectWithReport(
      [webSource('alpha'), webSource('beta'), webSource('gamma')],
      'Nha Trang',
      {
        onSourceComplete: (completion) =>
          completions.push(completion.outcome.sourceId),
        traceRecorder: trace,
      }
    );
    expect(report.offers.length).toBe(3);
    expect(report.summary.succeeded).toBe(3);
    expect(completions.sort()).toEqual(['alpha', 'beta', 'gamma']);
    const pagesUsed = new Set(
      events
        .filter((event) => event.startsWith('goto:'))
        .map((event) => event.split(':')[1])
    );
    expect(pagesUsed.size).toBe(3);
    expect(events).toContain('close:page-1');
    expect(events).toContain('close:page-2');
    expect(events).not.toContain('close:launched');
    expect(events.at(-1)).toBe('browser.close');
    const summary = trace.events.find(
      (event) => event.stage === 'collection-summary'
    );
    expect(summary.status).toBe('success');
    expect(summary.metadata.byStatus).toEqual({ offers: 3 });
  });

  it('runs serially on the launched page when tabs cannot be opened', async () => {
    for (const options of [
      { newPage: false },
      { behaviour: { newPageFails: true } },
    ]) {
      const { events, runtime } = fakeBrowser(options);
      const offers = await collectorFor(runtime, { concurrency: 4 }).collect([
        webSource('alpha'),
        webSource('beta'),
      ]);
      expect(offers.length).toBe(2);
      expect(
        events
          .filter((event) => event.startsWith('goto:'))
          .map((event) => event.split(':')[1])
      ).toEqual(['launched', 'launched']);
    }
  });

  it('keeps the collect() array API', async () => {
    const { runtime } = fakeBrowser();
    const offers = await collectorFor(runtime).collect([webSource('alpha')]);
    expect(Array.isArray(offers)).toBe(true);
    expect(offers[0].title).toBe('alpha room');
  });
});

describe('BrowserCollector per-source outcomes', () => {
  it('reports failures, timeouts, and empty sources and keeps finished offers', async () => {
    const { events, runtime } = fakeBrowser();
    const trace = traceSink();
    const report = await collectorFor(runtime, {
      concurrency: 2,
      sourceTimeoutMs: 30,
    }).collectWithReport(
      [
        webSource('hang'),
        webSource('fail'),
        webSource('empty'),
        webSource('alpha'),
        webSource('off', { enabled: false }),
      ],
      '',
      { runId: 'search-1', traceRecorder: trace }
    );
    expect(
      Object.fromEntries(
        report.outcomes.map((outcome) => [outcome.sourceId, outcome.status])
      )
    ).toEqual({
      alpha: 'offers',
      empty: 'empty',
      fail: 'blocked',
      hang: 'timeout',
    });
    expect(report.offers.map((offer) => offer.title)).toEqual(['alpha room']);
    expect(report.summary.failed).toBe(2);
    // The timed-out worker is retired and a fresh page takes over.
    expect(events).toContain('destroy:launched');
    const failure = trace.events.find(
      (event) => event.sourceId === 'hang' && event.status === 'failure'
    );
    expect(failure.metadata.category).toBe('SOURCE_TIMEOUT');
    expect(
      trace.events.find((event) => event.stage === 'collection-summary').status
    ).toBe('degraded');
  });

  it('marks unstarted sources pending when the budget elapses', async () => {
    const { runtime } = fakeBrowser();
    const trace = traceSink();
    const report = await collectorFor(runtime, {
      budgetMs: 30,
      concurrency: 1,
    }).collectWithReport([webSource('hang'), webSource('alpha')], '', {
      traceRecorder: trace,
    });
    expect(report.budgetElapsed).toBe(true);
    expect(report.outcomes.map((outcome) => outcome.status)).toEqual([
      'timeout',
      'pending',
    ]);
    expect(report.summary.allFailed).toBe(true);
    const pending = trace.events.find(
      (event) => event.sourceId === 'alpha' && event.status === 'degraded'
    );
    expect(pending.metadata).toEqual({
      category: 'SEARCH_BUDGET_ELAPSED',
      outcome: 'pending',
    });
    expect(
      trace.events.find((event) => event.stage === 'collection-summary').status
    ).toBe('failure');
  });

  it('continues when worker cleanup or result persistence fails', async () => {
    const { runtime } = fakeBrowser({ behaviour: { destroyFails: true } });
    const logged = [];
    let caught;
    try {
      await collectorFor(runtime, {
        concurrency: 1,
        logger: { debug: (message) => logged.push(message) },
        sourceTimeoutMs: 20,
      }).collectWithReport([webSource('hang'), webSource('alpha')], '', {
        onSourceComplete: () => {
          throw new Error('disk full');
        },
        traceRecorder: traceSink(),
      });
    } catch (error) {
      caught = error;
    }
    expect(logged).toContain('Retiring a browser worker failed');
    expect(logged).toContain('Persisting alpha results failed');
    // The final cleanup still reports the failing destroy.
    expect(caught.message).toBe('Browser collection cleanup was incomplete.');
  });

  it('cancels in-flight sources and closes the browser on abort', async () => {
    const { events, runtime } = fakeBrowser();
    const controller = new AbortController();
    const reason = Object.assign(new Error('Search interrupted by SIGINT.'), {
      name: 'AbortError',
    });
    setTimeout(() => controller.abort(reason), 20);
    let caught;
    try {
      await collectorFor(runtime).collectWithReport([webSource('hang')], '', {
        signal: controller.signal,
        traceRecorder: traceSink(),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(reason);
    expect(events.at(-1)).toBe('browser.close');
  });
});

describe('BrowserCollector official price checks within the budget', () => {
  const officialRuntime = (officialGoto) => {
    const { runtime } = fakeBrowser();
    const makeCommander = runtime.makeBrowserCommander;
    runtime.makeBrowserCommander = (options) => {
      const commander = makeCommander(options);
      const goto = commander.goto;
      commander.goto = async (arguments_) =>
        arguments_.url.includes('official.example')
          ? officialGoto(arguments_)
          : goto(arguments_);
      const evaluate = commander.evaluate;
      commander.evaluate = async (operation) => {
        const rows = await evaluate(operation);
        return Array.isArray(rows)
          ? rows.map((row) => ({
              ...row,
              officialUrl: 'https://official.example/room',
            }))
          : rows;
      };
      return commander;
    };
    return runtime;
  };

  it('stops official checks at the remaining budget', async () => {
    const logged = [];
    const runtime = officialRuntime(() => new Promise(() => {}));
    const collector = collectorFor(runtime, {
      budgetMs: 60,
      logger: { debug: (message) => logged.push(message) },
    });
    const offers = await collector.collect([webSource('alpha')]);
    expect(offers.length).toBe(1);
    expect(logged).toContain('Official price checks stopped at the budget');
  });

  it('rethrows when the caller aborts during official checks', async () => {
    const controller = new AbortController();
    const runtime = officialRuntime(() => {
      controller.abort(new Error('caller stop'));
      throw new Error('navigation aborted');
    });
    let caught;
    try {
      await collectorFor(runtime).collectWithReport([webSource('alpha')], '', {
        signal: controller.signal,
        traceRecorder: traceSink(),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught.message).toBe('caller stop');
  });

  it('skips official checks when no budget remains', async () => {
    const visits = [];
    const runtime = officialRuntime((arguments_) => visits.push(arguments_));
    await collectorFor(runtime, { budgetMs: 30, concurrency: 1 }).collect([
      webSource('alpha'),
      webSource('hang'),
    ]);
    expect(visits).toEqual([]);
  });
});
