// Times each step of the app's browser launch path.
import { launchBrowser, makeBrowserCommander } from 'browser-commander';
import { withQaCleanup } from './qa-cleanup.mjs';

await withQaCleanup(async (scope) => {
  const started = Date.now();
  const mark = (label) => console.log(`${Date.now() - started} ms ${label}`);
  const { browser, page } = await launchBrowser({
    engine: 'playwright',
    headless: true,
  });
  scope.defer('browser', () => browser.close());
  mark('launched');
  const commander = makeBrowserCommander({ page });
  scope.defer('commander', () => commander.destroy());
  await commander.goto({
    url: 'data:text/html,<title>t</title>',
    waitForNetworkIdle: false,
  });
  mark('goto');
  console.log(await commander.evaluate(() => globalThis.document.title));
  mark('evaluate');
});
