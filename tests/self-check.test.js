import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'test-anywhere';

import { runCli } from '../bin/vietnam-accomodation-search.js';
import { BrowserCollector, createApplication } from '../src/index.js';
import {
  FIXTURE_LISTING_HTML,
  FIXTURE_SOURCE_ID,
  checkBrowser,
  runFixtureSearch,
  withFixtureServer,
} from '../src/self-check.js';

const isDeno = typeof globalThis.Deno !== 'undefined';

// A browser runtime that loads pages with fetch() and turns the fixture's
// listing card into one extracted row.
function fetchingRuntime({ events = [], title = 'browser-check' } = {}) {
  return {
    launchBrowser: async (options) => {
      events.push(['launch', options]);
      return {
        browser: { close: async () => events.push(['browser.close']) },
        page: {},
      };
    },
    makeBrowserCommander: () => {
      let url;
      let html = '';
      return {
        destroy: async () => events.push(['destroy']),
        evaluate: async (operation) => {
          if (operation.name === 'extractPageState') {
            return { status: 200, url };
          }
          if (url.startsWith('data:')) {
            return title;
          }
          const heading = html.match(/<h2>([^<]+)<\/h2>/u)?.[1];
          const text = html.match(/<p>([^<]+)<\/p>/u)?.[1];
          return heading
            ? [
                {
                  text: `${heading}\n${text}`,
                  title: heading,
                  url: new globalThis.URL('/room/1', url).href,
                },
              ]
            : [];
        },
        goto: async ({ url: target }) => {
          url = target;
          events.push(['goto', target]);
          if (!target.startsWith('data:')) {
            html = await (await globalThis.fetch(target)).text();
          }
        },
      };
    },
  };
}

const fixtureApplication = (runtime) => (options) =>
  createApplication({
    ...options,
    browserRuntime: runtime,
    rateProvider: { getRates: async () => ({ VND: 1 }) },
  });

describe('browser launch check', () => {
  it('launches with the collector options and renders a data: page', async () => {
    const events = [];
    const collector = new BrowserCollector({
      browserLaunchOptions: { args: ['--no-sandbox'] },
      browserRuntime: fetchingRuntime({ events }),
    });
    expect(await checkBrowser({ collector })).toEqual({
      check: 'browser',
      ok: true,
    });
    expect(events[0]).toEqual([
      'launch',
      { args: ['--no-sandbox'], engine: 'playwright', headless: true },
    ]);
    expect(events[1][1].startsWith('data:text/html,')).toBe(true);
    expect(events.slice(-2)).toEqual([['destroy'], ['browser.close']]);
  });

  it('fails on an unexpected page and when the browser cannot start', async () => {
    const wrong = new BrowserCollector({
      browserRuntime: fetchingRuntime({ title: 'about:blank' }),
    });
    let caught;
    try {
      await checkBrowser({ collector: wrong });
    } catch (error) {
      caught = error;
    }
    expect(caught.message).toBe(
      'Browser check rendered an unexpected page: about:blank'
    );

    const broken = new BrowserCollector({
      browserRuntime: {
        launchBrowser: async () => {
          throw new Error(
            'Browser exited before its DevTools endpoint was ready (exit 0)'
          );
        },
      },
    });
    const stderr = [];
    const code = await runCli(['self-check', 'browser'], {
      application: { collector: broken },
      stderr: (line) => stderr.push(line),
      stdout: () => {},
    });
    expect(code).toBe(1);
    expect(stderr).toEqual([
      'Browser exited before its DevTools endpoint was ready (exit 0)',
    ]);
  });

  it('reports a passing check on stdout and rejects unknown checks', async () => {
    const stdout = [];
    const stderr = [];
    expect(
      await runCli(['self-check', 'browser'], {
        applicationFactory: fixtureApplication(fetchingRuntime()),
        env: {},
        stderr: (line) => stderr.push(line),
        stdout: (line) => stdout.push(line),
      })
    ).toBe(0);
    expect(stdout).toEqual(['{"check":"browser","ok":true}']);
    expect(
      await runCli(['self-check', 'network'], {
        stderr: (line) => stderr.push(line),
        stdout: () => {},
      })
    ).toBe(1);
    expect(stderr).toEqual(['Usage: self-check browser|search']);
  });
});

describe('fixture search check', () => {
  it('serves the fixture page on a loopback port and closes it', async () => {
    if (isDeno) {
      return;
    }
    let origin;
    const body = await withFixtureServer(async (served) => {
      origin = served;
      return (await globalThis.fetch(`${served}/search?q=x`)).text();
    });
    expect(origin.startsWith('http://127.0.0.1:')).toBe(true);
    expect(body).toBe(FIXTURE_LISTING_HTML);
    let refused = false;
    try {
      await globalThis.fetch(origin);
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
  });

  it('searches the fixture through the application and finds an offer', async () => {
    if (isDeno) {
      return;
    }
    const stdout = [];
    const code = await runCli(['self-check', 'search'], {
      applicationFactory: fixtureApplication(fetchingRuntime()),
      env: { DATA_DIRECTORY: '/nonexistent/production-data' },
      stderr: (line) => stdout.push(line),
      stdout: (line) => stdout.push(line),
    });
    expect(stdout).toEqual(['{"check":"search","offers":1,"ok":true}']);
    expect(code).toBe(0);
  });

  it('fails with the source outcome when the fixture yields no offers', async () => {
    if (isDeno) {
      return;
    }
    const runtime = fetchingRuntime();
    const makeCommander = runtime.makeBrowserCommander;
    runtime.makeBrowserCommander = (options) => ({
      ...makeCommander(options),
      goto: async () => {
        throw Object.assign(new Error('blocked'), { status: 403 });
      },
    });
    let caught;
    try {
      await runFixtureSearch({
        createApplication: fixtureApplication(runtime),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught.message).toBe(
      'Fixture search found no offers (blocked: blocked).'
    );

    try {
      await runFixtureSearch({
        createApplication: () => ({
          service: {
            searchWithReport: async () => ({ offers: [] }),
          },
        }),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught.message).toBe('Fixture search found no offers (no outcome).');
  });

  it('keeps only offers from the fixture source', async () => {
    if (isDeno) {
      return;
    }
    let caught;
    try {
      await runFixtureSearch({
        createApplication: () => ({
          service: {
            searchWithReport: async () => ({
              offers: [{ sourceId: 'cached-elsewhere' }],
              report: {
                outcomes: [{ sourceId: FIXTURE_SOURCE_ID, status: 'empty' }],
              },
            }),
          },
        }),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught.message).toBe('Fixture search found no offers (empty).');
  });
});

describe('deployment browser checks', () => {
  it('runs both self-checks in CI with the Compose security options', async () => {
    const workflow = await readFile(
      new globalThis.URL('../.github/workflows/release.yml', import.meta.url),
      'utf8'
    );
    expect(workflow).not.toContain('chromium.launch');
    expect(workflow).toContain('--cap-drop ALL');
    expect(workflow).toContain('--security-opt no-new-privileges:true');
    expect(workflow).toContain('--read-only');
    expect(workflow).toContain(
      'bin/vietnam-accomodation-search.js self-check browser'
    );
    expect(workflow).toContain(
      'bin/vietnam-accomodation-search.js self-check search'
    );
  });
});
