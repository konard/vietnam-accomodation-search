/**
 * Pure parts of the manual deploy cutover drill. Results are aggregates:
 * counts, digests, and durations; never message text, identities, or data.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { LinksStore } from '../src/index.js';
import { readDataSchemaVersion } from '../scripts/deploy-state.mjs';

// Every deploy transition the drill exercises, in run order. The Docker daemon
// restart needs the operator's privileges and runs only when selected.
export const DRILL_TRANSITIONS = [
  'first-deploy',
  'redeploy',
  'failed-preflight',
  'rollback',
  'unhealthy-candidate',
  'recreate',
  'docker-restart',
];
export const DEFAULT_TRANSITIONS = DRILL_TRANSITIONS.filter(
  (name) => name !== 'docker-restart'
);
export const PRODUCTION_PROJECT = 'vietnam-accommodation-search';
const PROJECT_NAME = /^[a-z0-9][a-z0-9_-]*$/u;

function boundedInteger(value, name, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

// eslint-disable-next-line complexity -- One parser owns every live drill boundary.
export function parseDrillArguments(values, { cwd = process.cwd() } = {}) {
  const options = {
    healthPort: 18_080,
    markerIntervalMs: 2_000,
    restoreSnapshot: false,
    settleMs: 20_000,
    transitions: DEFAULT_TRANSITIONS,
  };
  const valued = new Map([
    ['--bot-env', 'botEnv'],
    ['--candidate-image', 'candidateImage'],
    ['--data-directory', 'dataDirectory'],
    ['--health-port', 'healthPort'],
    ['--image', 'image'],
    ['--marker-interval-ms', 'markerIntervalMs'],
    ['--project-name', 'projectName'],
    ['--settle-ms', 'settleMs'],
    ['--transitions', 'transitions'],
    ['--user-env', 'userEnv'],
  ]);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--help') {
      options.help = true;
      continue;
    }
    if (value === '--restore-snapshot') {
      options.restoreSnapshot = true;
      continue;
    }
    const property = valued.get(value);
    if (!property || values[index + 1] === undefined) {
      throw new TypeError(`Unknown or incomplete option: ${value}`);
    }
    options[property] = values[index + 1];
    index += 1;
  }
  if (options.help) {
    return options;
  }
  for (const name of ['botEnv', 'dataDirectory', 'projectName', 'userEnv']) {
    if (!options[name]) {
      throw new TypeError(
        '--bot-env, --user-env, --project-name, and --data-directory are required.'
      );
    }
  }
  if (
    !PROJECT_NAME.test(options.projectName) ||
    !options.projectName.includes('drill') ||
    options.projectName === PRODUCTION_PROJECT
  ) {
    throw new Error(
      'The drill needs its own Compose project whose name contains "drill".'
    );
  }
  options.dataDirectory = resolve(cwd, options.dataDirectory);
  if (
    !isAbsolute(options.dataDirectory) ||
    !/drill/iu.test(options.dataDirectory)
  ) {
    throw new Error('The drill data directory path must contain "drill".');
  }
  options.healthPort = boundedInteger(
    options.healthPort,
    '--health-port',
    1_024,
    65_535
  );
  options.markerIntervalMs = boundedInteger(
    options.markerIntervalMs,
    '--marker-interval-ms',
    500,
    30_000
  );
  options.settleMs = boundedInteger(
    options.settleMs,
    '--settle-ms',
    5_000,
    300_000
  );
  if (typeof options.transitions === 'string') {
    options.transitions = options.transitions.split(',').filter(Boolean);
  }
  const unknown = options.transitions.find(
    (name) => !DRILL_TRANSITIONS.includes(name)
  );
  if (unknown || !options.transitions.length) {
    throw new TypeError(
      `--transitions must list ${DRILL_TRANSITIONS.join(', ')}.`
    );
  }
  return options;
}

/** A read-only command whose reply echoes a unique marker. */
export function markerCommand(run, sequence) {
  return `/preset show drill-${run}-${sequence}`;
}

export function markerSequence(text, run) {
  const match = new RegExp(`drill-${run}-(\\d+)`, 'u').exec(String(text));
  return match ? Number(match[1]) : undefined;
}

/**
 * Match every marker command with the bot replies that echo it. Telegram
 * server timestamps (seconds) measure the interruption independently of the
 * deploy host's clock.
 */
export function analyzeMarkers({ replies, run, sent }) {
  const answers = new Map();
  for (const reply of replies) {
    const sequence = markerSequence(reply.text, run);
    if (sequence !== undefined) {
      answers.set(sequence, [...(answers.get(sequence) || []), reply.date]);
    }
  }
  let maxReplyLatencySeconds = 0;
  let lost = 0;
  let duplicated = 0;
  for (const { date, sequence } of sent) {
    const dates = answers.get(sequence) || [];
    if (!dates.length) {
      lost += 1;
      continue;
    }
    if (dates.length > 1) {
      duplicated += 1;
    }
    maxReplyLatencySeconds = Math.max(
      maxReplyLatencySeconds,
      Math.min(...dates) - date
    );
  }
  const expected = new Set(sent.map(({ sequence }) => sequence));
  return {
    answered: sent.length - lost,
    duplicated,
    lost,
    maxReplyLatencySeconds,
    sent: sent.length,
    unexpectedReplies: [...answers.keys()].filter(
      (sequence) => !expected.has(sequence)
    ).length,
  };
}

/**
 * Count bot messages outside the markers (subscription deliveries) whose
 * text arrives more than once in one transition window.
 */
export function countDuplicateDeliveries(texts) {
  const seen = new Map();
  for (const text of texts) {
    const key = digest(String(text));
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return [...seen.values()].filter((count) => count > 1).length;
}

export function countRunningContainers(output) {
  return String(output)
    .split('\n')
    .filter((line) => line.trim()).length;
}

export function summarizePollerSamples(samples) {
  return {
    maxRunning: Math.max(0, ...samples),
    samples: samples.length,
    zeroRunningSamples: samples.filter((count) => count === 0).length,
  };
}

function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  }
  return value;
}

function digest(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

async function countFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return 0;
    }
    throw error;
  }
  let count = 0;
  for (const entry of entries) {
    count += entry.isDirectory()
      ? await countFiles(join(directory, entry.name))
      : 1;
  }
  return count;
}

async function countOfferProjectionFiles(dataDirectory) {
  const root = join(dataDirectory, 'offers.chunks');
  let names;
  try {
    names = await readdir(root);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return 0;
    }
    throw error;
  }
  let count = 0;
  for (const name of names) {
    count += await countFiles(join(root, name, '.binary'));
  }
  return count;
}

/**
 * Digest the decoded records of every canonical collection, so a text
 * migration that preserves the records keeps the fingerprint.
 */
export async function stateFingerprint(dataDirectory) {
  const store = new LinksStore({ directory: dataDirectory });
  const collections = {};
  const entries = await readdir(dataDirectory);
  const names = entries.filter((name) => name.endsWith('.lino'));
  if (entries.includes('offers.index.json') && !names.includes('offers.lino')) {
    names.push('offers.lino');
  }
  names.sort();
  for (const name of names) {
    const kind = name.slice(0, -'.lino'.length);
    if (kind === 'offers') {
      const offers = await store.listOffers();
      collections[kind] = {
        digest: digest(
          [...offers].sort((left, right) =>
            String(left.id).localeCompare(String(right.id))
          )
        ),
        records: offers.length,
      };
      continue;
    }
    if (kind === 'search-state') {
      collections[kind] = { digest: digest(await store.loadSearchState()) };
      continue;
    }
    if (!/^[a-z][a-z\d-]*s$/u.test(kind)) {
      collections[kind] = {
        digest: digest(await readFile(join(dataDirectory, name), 'utf8')),
      };
      continue;
    }
    const records = await store.loadRecords(kind);
    collections[kind] = {
      digest: digest(
        [...records].sort((left, right) =>
          String(left.id).localeCompare(String(right.id))
        )
      ),
      records: records.length,
    };
  }
  return {
    binaryFiles:
      (await countFiles(join(dataDirectory, '.binary'))) +
      (await countOfferProjectionFiles(dataDirectory)),
    collections,
    dataSchema: await readDataSchemaVersion(dataDirectory),
    mediaFiles: await countFiles(join(dataDirectory, 'media')),
  };
}

/**
 * Collections whose decoded records differ, lost media files, and a binary
 * projection that did not come back.
 */
export function compareFingerprints(before, after) {
  const names = new Set([
    ...Object.keys(before.collections),
    ...Object.keys(after.collections),
  ]);
  return {
    binaryMirrorMissing: before.binaryFiles > 0 && after.binaryFiles === 0,
    changedCollections: [...names]
      .filter(
        (name) =>
          before.collections[name]?.digest !== after.collections[name]?.digest
      )
      .sort(),
    mediaFilesLost: Math.max(0, before.mediaFiles - after.mediaFiles),
  };
}

/**
 * The unhealthy-candidate transition deploys with a Compose file that extends
 * the production service and replaces its health check. Compose interpolates
 * APP_IMAGE, which the deploy helper sets per container: every image fails
 * except the helper's `:rollback-` tag of the prior image, so the candidate is
 * rejected and the restored prior image becomes healthy.
 */
export function unhealthyComposeFile(baseComposeFile) {
  const check =
    "if(!'${APP_IMAGE}'.includes(':rollback-'))process.exit(1);fetch('http://127.0.0.1:8080/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))";
  return [
    'services:',
    '  app:',
    '    extends:',
    `      file: ${JSON.stringify(baseComposeFile)}`,
    '      service: app',
    '    healthcheck:',
    '      test:',
    '        - CMD',
    '        - node',
    '        - -e',
    `        - ${JSON.stringify(check)}`,
    '      interval: 2s',
    '      timeout: 5s',
    '      start_period: 10s',
    '      retries: 2',
    '',
  ].join('\n');
}

/**
 * What each transition must show. A failed preflight must leave the old
 * container serving; an unhealthy candidate must end on the exact previous
 * image; a rollback must end on the image the first deploy ran.
 */
export function transitionExpectation(name) {
  return {
    failure: name === 'failed-preflight' || name === 'unhealthy-candidate',
    image: {
      'failed-preflight': 'unchanged',
      rollback: 'first-deploy',
      'unhealthy-candidate': 'unchanged',
    }[name],
    uninterrupted: name === 'failed-preflight',
  };
}

/** A transition passes only with every invariant of the drill. */
// eslint-disable-next-line complexity -- Each invariant is one flat check.
export function transitionFailures({
  comparison,
  deliveries = 0,
  exitCode,
  expectation = transitionExpectation(''),
  images = {},
  markers,
  pollers,
}) {
  const failures = [];
  if (expectation.failure ? exitCode === 0 : exitCode !== 0) {
    failures.push(
      expectation.failure
        ? 'the bad candidate was accepted'
        : `the deploy command exited ${exitCode}`
    );
  }
  if (expectation.image && images.after !== images.expected) {
    failures.push(`the running image is not the ${expectation.image} image`);
  }
  if (expectation.uninterrupted && pollers.zeroRunningSamples) {
    failures.push('the old service stopped before the candidate was proven');
  }
  if (pollers.maxRunning > 1) {
    failures.push('more than one app container ran at once');
  }
  if (markers.lost) {
    failures.push(`${markers.lost} marker commands were never answered`);
  }
  if (markers.duplicated) {
    failures.push(`${markers.duplicated} marker commands were answered twice`);
  }
  if (deliveries) {
    failures.push(`${deliveries} deliveries arrived more than once`);
  }
  if (comparison?.changedCollections.length) {
    failures.push(
      `collections changed: ${comparison.changedCollections.join(', ')}`
    );
  }
  if (comparison?.mediaFilesLost) {
    failures.push(`${comparison.mediaFilesLost} media files were lost`);
  }
  if (comparison?.binaryMirrorMissing) {
    failures.push('the binary projection was not rebuilt');
  }
  return failures;
}
