import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// One listing card that the generic web adapter parses into a priced offer.
export const FIXTURE_LISTING_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Nha Trang rentals</title></head>
  <body>
    <main>
      <article class="listing">
        <a href="/room/1"><h2>Nha Trang sea view apartment</h2></a>
        <p>Studio apartment for monthly rent in Nha Trang, 8,000,000 VND/month</p>
      </article>
    </main>
  </body>
</html>`;

export const FIXTURE_SOURCE_ID = 'self-check-fixture';

// Serves the fixture page on a loopback port for the duration of `operation`.
export async function withFixtureServer(
  operation,
  html = FIXTURE_LISTING_HTML
) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await operation(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Launches the browser through the application's own collector and options.
export async function checkBrowser(application) {
  const title = await application.collector.checkLaunch();
  if (title !== 'browser-check') {
    throw new Error(`Browser check rendered an unexpected page: ${title}`);
  }
  return { check: 'browser', ok: true };
}

// Runs one real search against the local fixture page in a throwaway data
// directory, so the check never writes into the deployment's /data.
export async function runFixtureSearch({
  createApplication,
  environment = {},
  query = 'Nha Trang apartment',
}) {
  const directory = await mkdtemp(join(tmpdir(), 'self-check-'));
  try {
    return await withFixtureServer(async (origin) => {
      const application = createApplication({
        environment: {
          ...environment,
          BROWSER_MAX_INTERVAL_MS: '1',
          BROWSER_MIN_INTERVAL_MS: '1',
          DATA_DIRECTORY: directory,
        },
        registry: {
          list: () =>
            Promise.resolve([
              {
                id: FIXTURE_SOURCE_ID,
                searchUrl: `${origin}/search?q={query}`,
                type: 'web',
              },
            ]),
        },
      });
      const { offers: found, report } =
        await application.service.searchWithReport({
          query,
          refresh: true,
        });
      const offers = found.filter(
        (offer) => offer.sourceId === FIXTURE_SOURCE_ID
      );
      if (!offers.length) {
        const outcome = report?.outcomes?.[0];
        throw new Error(
          `Fixture search found no offers (${outcome?.status || 'no outcome'}${
            outcome?.message ? `: ${outcome.message}` : ''
          }).`
        );
      }
      return { check: 'search', offers: offers.length, ok: true };
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
