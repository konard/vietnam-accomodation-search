/* eslint local/no-changelog-comments: "off" */

/**
 * End-to-end guard for the use-m interop shim.
 *
 * The unit tests in use-module.test.js pin the shapes we normalise; this file
 * loads pinned `command-stream` through the verified use-m bundle on the same Node
 * version the release jobs run (`node-version: '24.x'`) and asserts `$` is
 * callable. Without it the interop breakage only surfaces on `main`, inside a
 * job that pushes tags and publishes to npm.
 *
 * The test needs network access. When the fetch of use.js or the package
 * install fails, it logs the reason and passes, so offline development and
 * sandboxed runs are not blocked by an unreachable CDN.
 *
 * use-m 8.16.4 converts resolved paths with pathToFileURL, so Windows runs
 * exercise the same pinned loader instead of retaining the obsolete skip.
 */

import { describe, it, expect } from 'test-anywhere';

import { loadCommandStream, USE_M_URL } from '../scripts/use-module.mjs';

async function hasNetwork() {
  try {
    const response = await fetch(USE_M_URL, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Load command-stream through the real use-m, or return null after logging
 * why the test environment cannot (offline or sandboxed fetch).
 * @returns {Promise<Record<string, unknown>|null>} command-stream exports
 */
async function loadOrSkip() {
  if (!(await hasNetwork())) {
    console.log(
      `Skipping: ${USE_M_URL} is unreachable, so use-m cannot be evaluated.`
    );
    return null;
  }

  try {
    return await loadCommandStream();
  } catch (error) {
    if (/SHA-256|byte limit|callable/.test(error.cause?.message || '')) {
      throw error;
    }
    if (
      /fetch|network|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|registry/i.test(
        error.message
      )
    ) {
      console.log(`Skipping: ${error.message}`);
      return null;
    }
    throw error;
  }
}

describe('use-m loads command-stream on this Node version', () => {
  it('exposes a callable $ from command-stream', async () => {
    const commandStream = await loadOrSkip();

    if (!commandStream) {
      return;
    }

    console.log(`Loaded command-stream on ${process.version}`);
    expect(typeof commandStream.$).toBe('function');
  });

  it('rejects when a command exits non-zero', async () => {
    const { $ } = (await loadOrSkip()) ?? {};

    if (!$) {
      return;
    }

    let rejected = false;

    try {
      await $`exit 3`;
    } catch (error) {
      rejected = true;
      expect(error.code).toBe(3);
    }

    expect(rejected).toBe(true);
  });
});
