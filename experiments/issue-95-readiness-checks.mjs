// Times browser-commander's default readiness checks one by one on a real page,
// to find which check holds every goto() for about 31 seconds.
import { launchBrowser } from 'browser-commander';
import {
  createDeadline,
  networkIdleFor,
  urlStableFor,
} from '../node_modules/browser-commander/src/core/readiness.js';
import { createNetworkTracker } from '../node_modules/browser-commander/src/core/network-tracker.js';

const { browser, page } = await launchBrowser({
  engine: 'playwright',
  headless: true,
  args: ['--no-sandbox'],
});
const log = { debug: (message) => console.log(`  ${message()}`) };
const networkTracker = createNetworkTracker({
  engine: 'playwright',
  log,
  page,
});
networkTracker.startTracking();
await page.goto('data:text/html,<title>t</title>');
for (const check of [urlStableFor({ intervalMs: 200 }), networkIdleFor()]) {
  const started = Date.now();
  const outcome = await check.run({
    deadline: createDeadline({ timeout: 60000 }),
    networkTracker,
    page,
  });
  console.log(check.name, Date.now() - started, 'ms', JSON.stringify(outcome));
}
networkTracker.stopTracking();
await browser.close();
