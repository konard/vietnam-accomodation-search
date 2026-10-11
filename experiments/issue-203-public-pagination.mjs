// Manual public DOM investigation; material stays in an ignored private pack.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApplication } from '../src/application.js';
import { buildSearchUrl } from '../src/browser-collector.js';
import { launchSettings } from '../src/utils.js';
import { acquireQaBrowser, launchQaBrowser } from './qa-browser.mjs';
import { qaTemporaryDirectory, withQaCleanup } from './qa-cleanup.mjs';
import { assertManualLocalRun } from './telegram-accommodation-audit-lib.mjs';

assertManualLocalRun(process.env);
const output = resolve('.deploy/issue-203-pagination-dom.json');
await mkdir(resolve('.deploy'), { recursive: true, mode: 0o700 });
await withQaCleanup(async (scope, signal) => {
  const root = await qaTemporaryDirectory(scope, 'vac-pagination-dom-');
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = root;
  scope.defer('browser temporary environment', () => {
    if (previous === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = previous;
    }
  });
  const { page } = await acquireQaBrowser(
    scope,
    (profile) =>
      launchQaBrowser(
        launchSettings({ userDataDir: profile, args: ['--no-sandbox'] })
      ),
    { signal, temporaryRoot: root }
  );
  const sources = (await createApplication().registry.inventory()).filter(
    (source) =>
      source.type === 'web' &&
      source.capability === 'supported' &&
      (!process.argv[2] || source.id === process.argv[2])
  );
  const results = [];
  for (const source of sources) {
    signal.throwIfAborted();
    const row = { sourceId: source.id };
    try {
      await page.goto(buildSearchUrl(source, ''), {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      row.controls = await page.evaluate(() =>
        [
          ...globalThis.document.querySelectorAll(
            'a,button,nav,[class*="pagin"],[class*="pager"],[class*="paging"]'
          ),
        ]
          .filter(
            (element) =>
              /pagin|pager|paging|next|load.?more/iu.test(
                `${element.className} ${element.getAttribute('aria-label')} ${element.getAttribute('rel')}`
              ) ||
              /^(?:\d+|next|previous|load more|xem thêm|tiếp|sau|следующая|далее|[»›→])$/iu.test(
                element.textContent.trim()
              )
          )
          .slice(0, 120)
          .map((element) => ({
            tag: element.tagName,
            classes: element.className,
            rel: element.getAttribute('rel'),
            href: element.getAttribute('href'),
            aria: element.getAttribute('aria-label'),
            text: element.textContent.trim().slice(0, 500),
            html: element.outerHTML.slice(0, 3000),
            parent: /^\d+$/u.test(element.textContent.trim())
              ? element.parentElement.parentElement.parentElement.outerHTML.slice(
                  0,
                  5000
                )
              : undefined,
          }))
      );
    } catch {
      row.unavailable = true;
    }
    results.push(row);
    await writeFile(output, `${JSON.stringify(results, null, 2)}\n`, {
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        inspected: results.length,
        controls: row.controls?.length,
        unavailable: row.unavailable === true,
      })
    );
  }
});
