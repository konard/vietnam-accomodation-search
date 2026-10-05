// Times each step of the app's browser launch path.
import { launchBrowser, makeBrowserCommander } from 'browser-commander';

const started = Date.now();
const mark = (label) => console.log(`${Date.now() - started} ms ${label}`);
const { browser, page } = await launchBrowser({
  engine: 'playwright',
  headless: true,
});
mark('launched');
const commander = makeBrowserCommander({ page });
await commander.goto({
  url: 'data:text/html,<title>t</title>',
  waitForNetworkIdle: false,
});
mark('goto');
console.log(await commander.evaluate(() => globalThis.document.title));
mark('evaluate');
await commander.destroy();
mark('destroy');
await browser.close();
mark('close');
