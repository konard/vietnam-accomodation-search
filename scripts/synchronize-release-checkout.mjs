/**
 * Synchronize a queued release checkout before it mutates changesets.
 *
 * Release jobs are serialized, but checkout happens before a queued job enters
 * the concurrency group. A previous run can therefore publish its version
 * commit while the next runner still has the older main commit checked out.
 * This helper fast-forwards that clean checkout and re-counts changesets so an
 * already-landed version bump becomes an idempotent publish retry.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { runCommand, runStrict } from './run-command.mjs';

/**
 * Count pending Markdown changesets, excluding the directory README.
 * Validation remains the responsibility of check-changesets.mjs.
 * @param {string} cwd
 * @param {string} jsRoot
 * @returns {number}
 */
export function countPendingChangesets(cwd, jsRoot = '.') {
  const directory = path.resolve(cwd, jsRoot, '.changeset');
  if (!existsSync(directory)) {
    return 0;
  }
  return readdirSync(directory).filter(
    (file) => file.endsWith('.md') && file !== 'README.md'
  ).length;
}

function localVersion(cwd, jsRoot) {
  return JSON.parse(
    readFileSync(path.resolve(cwd, jsRoot, 'package.json'), 'utf8')
  ).version;
}

/**
 * Fast-forward a clean release checkout to the current remote branch.
 * @param {object} options
 * @param {string} [options.cwd]
 * @param {string} [options.remote]
 * @param {string} [options.branch]
 * @param {string} [options.jsRoot]
 * @param {'changeset'|'instant'} [options.mode]
 * @param {Function} [options.runner]
 * @param {Console} [options.logger]
 * @returns {Promise<{status: 'current'|'advanced'|'already-released', version: string, changesets: number}>}
 */
export async function synchronizeReleaseCheckout({
  cwd = process.cwd(),
  remote = 'origin',
  branch = 'main',
  jsRoot = '.',
  mode = 'changeset',
  runner = runCommand,
  logger = console,
} = {}) {
  const remoteRef = `${remote}/${branch}`;
  await runStrict('git', ['fetch', remote, branch], { cwd, runner, logger });

  const status = await runStrict('git', ['status', '--porcelain'], {
    cwd,
    runner,
    logger,
  });
  if (status.stdout.trim()) {
    throw new Error(
      'Release checkout has local changes before synchronization; changesets must be merged only after synchronization.'
    );
  }

  const localHead = (
    await runStrict('git', ['rev-parse', 'HEAD'], { cwd, runner, logger })
  ).stdout.trim();
  const remoteHead = (
    await runStrict('git', ['rev-parse', remoteRef], {
      cwd,
      runner,
      logger,
    })
  ).stdout.trim();

  if (localHead === remoteHead) {
    const changesets = countPendingChangesets(cwd, jsRoot);
    return {
      status: 'current',
      version: localVersion(cwd, jsRoot),
      changesets,
    };
  }

  logger.log(
    `Remote ${branch} advanced from ${localHead} to ${remoteHead}; synchronizing before changeset mutation.`
  );
  const ancestor = await runner(
    'git',
    ['merge-base', '--is-ancestor', 'HEAD', remoteRef],
    { cwd, logger }
  );
  if (ancestor.code !== 0) {
    throw new Error(
      `Release checkout cannot fast-forward to ${remoteRef}; refusing to rewrite a divergent release candidate.`
    );
  }

  await runStrict('git', ['merge', '--ff-only', remoteRef], {
    cwd,
    runner,
    logger,
  });

  const changesets = countPendingChangesets(cwd, jsRoot);
  return {
    status:
      mode === 'changeset' && changesets === 0
        ? 'already-released'
        : 'advanced',
    version: localVersion(cwd, jsRoot),
    changesets,
  };
}
