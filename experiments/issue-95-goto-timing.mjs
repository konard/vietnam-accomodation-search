// Measures browser-commander goto() latency for http, data:, and about: URLs.
// VERBOSE=1 prints browser-commander's navigation trace.
import { createServer } from 'node:http';
import { launchBrowser, makeBrowserCommander } from 'browser-commander';

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<title>fixture</title><p>ok</p>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const { browser, page } = await launchBrowser({
  engine: 'playwright',
  headless: true,
});
const commander = makeBrowserCommander({
  page,
  verbose: process.env.VERBOSE === '1',
});
for (const url of [
  `${origin}/a`,
  `${origin}/b`,
  'data:text/html,<title>t</title>',
  'about:blank',
]) {
  const started = Date.now();
  await commander.goto({ url, waitForNetworkIdle: false });
  console.log(`${Date.now() - started} ms ${url}`);
}
await commander.destroy();
await browser.close();
server.close();
