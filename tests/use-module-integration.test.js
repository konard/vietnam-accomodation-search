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
 * Both packages are installed from the lockfile. The installed use.js must
 * match the release loader's pinned CDN digest before evaluation. Resolving
 * the installed alias avoids network retries and global npm installation in
 * a timed test while retaining the real loader and CommonJS import boundary.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { describe, it, expect } from 'test-anywhere';

import { loadCommandStream, USE_M_SHA256 } from '../scripts/use-module.mjs';

// The read-only Deno matrix cannot import command-stream's environment-aware
// dependencies or launch commands. Register those permission limits as skips;
// Node/Bun and a permission-enabled Deno run always execute the real assertions.
const canImport =
  typeof Deno === 'undefined' ||
  (await Deno.permissions.query({ name: 'env' })).state === 'granted';
const canRun =
  typeof Deno === 'undefined' ||
  (await Deno.permissions.query({ name: 'run' })).state === 'granted';
const importIt = canImport ? it : it.skip;
const commandIt = canImport && canRun ? it : it.skip;

async function loadInstalled() {
  const require = createRequire(import.meta.url);
  const source = await readFile(
    new URL('../node_modules/use-m/use.js', import.meta.url),
    'utf8'
  );
  expect(createHash('sha256').update(source).digest('hex')).toBe(USE_M_SHA256);
  const makeUse = await eval(source);
  const use = await makeUse({
    scriptPath: import.meta.url,
    specifierResolver: (specifier) => {
      expect(specifier).toBe('command-stream@2.0.2');
      expect(require('command-stream-release/package.json').version).toBe(
        '2.0.2'
      );
      return require.resolve('command-stream-release');
    },
  });
  return loadCommandStream(use);
}

describe('use-m loads command-stream on this Node version', () => {
  importIt('exposes a callable $ from command-stream', async () => {
    const commandStream = await loadInstalled();

    console.log(`Loaded command-stream on ${process.version}`);
    expect(typeof commandStream.$).toBe('function');
  });

  commandIt('rejects when a command exits non-zero', async () => {
    const { $ } = await loadInstalled();
    const evalArgument = typeof Deno === 'undefined' ? '-e' : 'eval';
    const exitScript =
      typeof Deno === 'undefined' ? 'process.exit(3)' : 'Deno.exit(3)';

    let rejected = false;

    try {
      await $`${process.execPath} ${evalArgument} ${exitScript}`;
    } catch (error) {
      rejected = true;
      expect(error.code).toBe(3);
    }

    expect(rejected).toBe(true);
  });
});
