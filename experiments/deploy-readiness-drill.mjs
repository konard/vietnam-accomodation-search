import { pathToFileURL } from 'node:url';
import { waitForReadiness } from '../scripts/deploy-readiness.mjs';

// Model slow application startup and delayed Docker health with a virtual
// clock, without allocating a large store or requiring a private bot.
export async function runReadinessDrill() {
  const applicationReadyMs = 40_000;
  const dockerHealthyMs = 60_000;
  const run = async (timeoutSeconds) => {
    let elapsed = 0;
    const options = {
      inspect: () =>
        Promise.resolve(elapsed >= dockerHealthyMs ? 'healthy' : 'starting'),
      now: () => elapsed,
      sleep: (ms) => {
        elapsed += ms;
        return Promise.resolve();
      },
      ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
    };
    try {
      const result = await waitForReadiness(options);
      return { healthy: true, elapsedMs: result.elapsedMs };
    } catch (error) {
      return { healthy: false, elapsedMs: elapsed, error: error.message };
    }
  };
  return {
    mode: 'synthetic-health-timing',
    reference:
      'https://github.com/konard/vietnam-accomodation-search/issues/107',
    referenceStoreSize: '3.5 GB (reported by issue; not created by this drill)',
    applicationReadyMs,
    dockerHealthyMs,
    formerDeadline: await run(40),
    defaultDeadline: await run(),
    limitation:
      'Does not measure actual startup or projection performance on a protected store.',
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log(JSON.stringify(await runReadinessDrill(), null, 2));
}
