#!/usr/bin/env node

import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { syncDirectory } from '../src/link-cli-mirror.js';
import { bootstrapDependencies } from './bootstrap-dependencies.mjs';
import {
  DATA_SCHEMA_VERSION,
  resolveDataDirectory,
  validateDataDirectory,
} from './data-directory.mjs';
import {
  appendDeployLog,
  assertPortsAvailable,
  assertTokenNotShared,
  commandOptions,
  describeDeployFailure,
  inspectDataDirectory,
  observeSettle,
  parsePortBinding,
  parseSettleSample,
  planDataDirectory,
  publishedPorts,
  readTokenFingerprints,
  recoveredFailure,
  removeAttemptResidue,
  SETTLE_INSPECT_FORMAT,
  TOKEN_FINGERPRINT_SCRIPT,
  trackCommands,
} from './deploy-guards.mjs';
import {
  planRollback,
  projectStateDirectory,
  pruneSnapshots,
  readDataSchemaVersion,
  restoreState,
  snapshotState,
  writeDataSchemaMarker,
} from './deploy-state.mjs';
import { loadCommandStream, loadLinoArguments } from './use-module.mjs';

let command;
let makeConfig;
// The step and command in progress, reported when a deploy fails.
const progress = {};
const ACTIONS = new Set(['deploy', 'logs', 'rollback', 'status', 'stop']);
const USAGE =
  'Usage: deploy.mjs deploy|status|logs|stop|rollback [--restore-snapshot] [options]';
const STATE_ROOT = '.deploy';

async function loadDependencies() {
  if (command && makeConfig) {
    return;
  }
  const [commandStream, argumentsModule] = await bootstrapDependencies([
    loadCommandStream,
    loadLinoArguments,
  ]);
  command = trackCommands(commandStream.$, progress);
  makeConfig = argumentsModule.makeConfig;
}

function configuration(argv) {
  return makeConfig({
    argv: ['node', 'deploy', ...argv],
    env: { enabled: false },
    lenv: { enabled: true, path: '.lenv' },
    yargs: ({ getenv, yargs }) =>
      yargs
        .option('data-directory', {
          default: getenv(
            'DATA_DIRECTORY_HOST',
            '.vietnam-accomodation-search'
          ),
          type: 'string',
        })
        .option('compose-file', {
          default: getenv('COMPOSE_FILE', 'compose.yaml'),
          type: 'string',
        })
        .option('image', { type: 'string' })
        .option('move-data-directory', { default: false, type: 'boolean' })
        .option('allow-empty-data-directory', {
          default: false,
          type: 'boolean',
        })
        .option('allow-shared-token', { default: false, type: 'boolean' })
        .option('settle-seconds', { default: 30, type: 'number' })
        .option('restore-snapshot', { default: false, type: 'boolean' })
        .option('project-name', {
          default: getenv('COMPOSE_PROJECT_NAME', DEFAULT_PROJECT),
          type: 'string',
        }),
  });
}

async function durableJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

const DEFAULT_PROJECT = 'vietnam-accommodation-search';

async function optionalJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

function runner(config, image, { capture = false } = {}) {
  const env = {
    ...process.env,
    BUILD_DATE: config.buildIdentity?.buildDate,
    DATA_DIRECTORY_HOST: config.dataDirectory,
    NPM_PACKAGE_VERSION: config.buildIdentity?.version,
    VCS_REF: config.buildIdentity?.revision,
  };
  if (image) {
    env.APP_IMAGE = image;
  }
  return command(commandOptions({ env, quiet: capture }));
}

export function assertImageIdentity(labels, { buildDate, revision, version }) {
  const expected = {
    'org.opencontainers.image.created': buildDate,
    'org.opencontainers.image.revision': revision,
    'org.opencontainers.image.version': version,
  };
  for (const [name, value] of Object.entries(expected)) {
    if (labels?.[name] !== value) {
      throw new Error(
        `Image label ${name} does not match the checked-out commit.`
      );
    }
  }
  return true;
}

// command-stream runs commands through a login shell (`/bin/sh -l -c`), whose
// profile may reorder PATH (macOS path_helper does). Callers that must select
// one exact executable, such as the argv regression fixture, pass its path.
export async function inspectImageLabels(
  run,
  image,
  { docker = 'docker' } = {}
) {
  const format = '{{json .Config.Labels}}';
  return JSON.parse(
    await text(await run`${docker} image inspect --format=${format} ${image}`)
  );
}

async function checkedOutBuildIdentity() {
  const run = command(commandOptions({ quiet: true }));
  const [packageContents, revision, buildDate] = await Promise.all([
    readFile('package.json', 'utf8'),
    text(await run`git rev-parse HEAD`),
    text(await run`git show -s --format=%cI HEAD`),
  ]);
  return {
    buildDate,
    revision,
    version: JSON.parse(packageContents).version,
  };
}

async function text(result) {
  return (await result.text()).trim();
}

async function currentContainer(config, image) {
  const run = runner(config, image, { capture: true });
  return text(
    await run`docker compose -f ${config.composeFile} -p ${config.projectName} ps -q app`
  );
}

export function assertComposeDataMount(model, dataDirectory) {
  const mount = model?.services?.app?.volumes?.find(
    (volume) => volume.target === '/data'
  );
  if (
    mount?.type !== 'bind' ||
    resolve(String(mount.source || '')) !== resolve(dataDirectory)
  ) {
    throw new Error(
      `Compose app /data must be the exact bind mount ${resolve(dataDirectory)}.`
    );
  }
  return resolve(mount.source);
}

async function waitHealthy(config, image, attempts = 40) {
  const container = await currentContainer(config, image);
  if (!container) {
    throw new Error('Compose did not create the app container.');
  }
  const run = runner(config, image, { capture: true });
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await text(
      await run`docker inspect --format={{.State.Health.Status}} ${container}`
    );
    if (status === 'healthy') {
      return;
    }
    if (status === 'unhealthy') {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    'Candidate did not become ready before the deployment deadline.'
  );
}

async function prepareCandidate(config) {
  const revision = config.buildIdentity.revision.slice(0, 12);
  const image =
    config.image ||
    `${config.projectName}:candidate-${Date.now()}-${revision || 'unknown'}`;
  const run = runner(config, image);
  const renderedRun = runner(config, image, { capture: true });
  const renderedCompose = JSON.parse(
    await text(
      await renderedRun`docker compose -f ${config.composeFile} -p ${config.projectName} config --format json`
    )
  );
  assertComposeDataMount(renderedCompose, config.dataDirectory);
  progress.step = 'checking the health port';
  const ports = publishedPorts(renderedCompose);
  await assertPortsAvailable({
    owned: await ownedPorts(config, ports),
    ports,
  });
  progress.step = config.image ? 'pulling the image' : 'building the image';
  if (config.image) {
    await run`docker pull ${image}`;
  } else {
    await run`docker compose -f ${config.composeFile} -p ${config.projectName} build app`;
  }
  progress.step = 'checking the bot token';
  const fingerprint = await text(
    await renderedRun`docker compose -f ${config.composeFile} -p ${config.projectName} run --rm --no-deps --entrypoint node app --input-type=module -e ${TOKEN_FINGERPRINT_SCRIPT}`
  );
  config.tokenFingerprint = /^[a-f0-9]{64}$/u.test(fingerprint)
    ? fingerprint
    : undefined;
  assertTokenNotShared({
    allowSharedToken: config.allowSharedToken,
    fingerprint: config.tokenFingerprint,
    projectName: config.projectName,
    records: await readTokenFingerprints(STATE_ROOT),
  });
  progress.step = 'smoke-testing the image';
  const labels = await inspectImageLabels(renderedRun, image);
  assertImageIdentity(labels, config.buildIdentity);
  const cliVersion = await text(
    await renderedRun`docker run --rm --entrypoint node ${image} bin/vietnam-accomodation-search.js --version`
  );
  if (cliVersion !== config.buildIdentity.version) {
    throw new Error(
      'Image CLI version does not match the checked-out package.'
    );
  }
  await run`docker run --rm --entrypoint node ${image} bin/vietnam-accomodation-search.js --help`;
  await run`docker run --rm --entrypoint clink ${image} --help`;
  const browserSmoke =
    "import { chromium } from 'playwright'; const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }); await browser.close();";
  await run`docker run --rm --entrypoint node ${image} --input-type=module -e ${browserSmoke}`;
  progress.step = 'checking storage and Telegram credentials';
  const storagePreflight =
    "import { open, rename, rm } from 'node:fs/promises'; const a='/data/.container-write-probe'; const b=a+'.renamed'; const f=await open(a,'wx',0o600); await f.writeFile('probe'); await f.sync(); await f.close(); await rename(a,b); await rm(b);";
  await run`docker compose -f ${config.composeFile} -p ${config.projectName} run --rm --no-deps --entrypoint node app --input-type=module -e ${storagePreflight}`;
  await run`docker compose -f ${config.composeFile} -p ${config.projectName} run --rm --no-deps --entrypoint node app bin/vietnam-accomodation-search.js telegram preflight`;
  return image;
}

// Ports this project's running container already publishes are not taken by
// someone else: the cutover releases them.
async function ownedPorts(config, ports) {
  const run = runner(config, undefined, { capture: true });
  const owned = [];
  for (const { target } of ports) {
    try {
      owned.push(
        ...parsePortBinding(
          await text(
            await run`docker compose -f ${config.composeFile} -p ${config.projectName} port app ${target}`
          )
        )
      );
    } catch {
      // No running container publishes this port.
    }
  }
  return owned;
}

async function settleCandidate(config, image, since) {
  if (!(config.settleSeconds > 0)) {
    return;
  }
  const container = await currentContainer(config, image);
  const inspect = command(commandOptions({ quiet: true }));
  await observeSettle({
    durationMs: config.settleSeconds * 1000,
    sample: async () =>
      parseSettleSample(
        await text(
          await inspect`docker inspect --format=${SETTLE_INSPECT_FORMAT} ${container}`
        ),
        await text(
          await inspect`docker logs --since ${since} ${container} 2>&1`
        )
      ),
  });
}

// After a failed move to a new data directory, the previous image starts
// again on the directory it used before.
async function rollbackTo(
  config,
  image,
  snapshot,
  dataDirectory = config.dataDirectory
) {
  const run = runner(config, image);
  await run`docker compose -f ${config.composeFile} -p ${config.projectName} stop -t 30 app`;
  if (snapshot) {
    await restoreState(config.dataDirectory, snapshot);
  }
  await runner(
    { ...config, dataDirectory },
    image
  )`docker compose -f ${config.composeFile} -p ${config.projectName} up -d --no-build --pull never app`;
  await waitHealthy(config, image);
}

// A recovery runs under its own step name. When it succeeds, the failure is
// reported against the step that failed, with the recovery on its own line.
async function recover(error, { action, prefix, recovery, step }) {
  const failedStep = progress.step;
  progress.step = step;
  await action();
  return recoveredFailure(error, { prefix, recovery, step: failedStep });
}

export async function deploymentStateMachine({
  capture = () => Promise.resolve(undefined),
  discard = () => Promise.resolve(),
  inspectPrevious,
  prepare,
  record,
  restore,
  settle = () => Promise.resolve(),
  start,
  stop,
  wait,
}) {
  progress.step = 'preparing the candidate';
  const candidate = await prepare();
  progress.step = 'inspecting the running service';
  const previous = await inspectPrevious();
  let snapshot;
  if (previous) {
    progress.step = 'stopping the previous service';
    await stop();
    progress.step = 'snapshotting state';
    try {
      snapshot = await capture();
    } catch (error) {
      throw await recover(error, {
        action: () => restore(previous),
        prefix: 'State snapshot failed',
        recovery: 'previous image restored',
        step: 'restoring the previous service',
      });
    }
  }
  try {
    progress.step = 'starting the candidate';
    await start(candidate);
    progress.step = 'waiting for readiness';
    await wait(candidate);
    progress.step = 'observing the settle window';
    await settle(candidate);
  } catch (error) {
    throw await recover(
      error,
      previous
        ? {
            action: () => restore(previous, snapshot),
            prefix: 'Candidate readiness failed',
            recovery: 'previous image and state restored',
            step: 'restoring the previous service',
          }
        : {
            action: discard,
            prefix: 'Candidate readiness failed',
            recovery: "the new project's containers were removed",
            step: 'removing the failed first deployment',
          }
    );
  }
  progress.step = 'recording the deployment';
  await record({ candidate, previous, snapshot });
  return candidate;
}

async function readDeployState(config, statePath) {
  const state = await optionalJson(statePath);
  if (Object.keys(state).length || config.projectName !== DEFAULT_PROJECT) {
    return state;
  }
  // Records written before they were kept per Compose project.
  return optionalJson(join(dirname(dirname(statePath)), 'state.json'));
}

async function deploy(config, statePath) {
  let existing;
  let run;
  let startedAt;
  const snapshots = join(dirname(statePath), 'snapshots');
  const candidate = await deploymentStateMachine({
    capture: async () => {
      const directory = join(
        snapshots,
        new Date().toISOString().replace(/[:.]/gu, '-')
      );
      const manifest = await snapshotState(config.dataDirectory, directory);
      return { dataSchema: manifest.dataSchema, directory };
    },
    discard: () =>
      runner(
        config
      )`docker compose -f ${config.composeFile} -p ${config.projectName} down`,
    prepare: () => prepareCandidate(config),
    inspectPrevious: async () => {
      existing = await currentContainer(config);
      if (!existing) {
        return undefined;
      }
      const inspect = command(commandOptions({ quiet: true }));
      const imageId = await text(
        await inspect`docker inspect --format={{.Image}} ${existing}`
      );
      const rollbackImage = `${config.projectName}:rollback-${Date.now()}`;
      await command`docker image tag ${imageId} ${rollbackImage}`;
      return rollbackImage;
    },
    record: async ({
      candidate: currentImage,
      previous: previousImage,
      snapshot,
    }) => {
      await durableJson(statePath, {
        currentDataSchema: DATA_SCHEMA_VERSION,
        currentImage,
        dataDirectory: config.dataDirectory,
        deployedAt: new Date().toISOString(),
        previousDataSchema: snapshot?.dataSchema,
        previousImage,
        projectName: config.projectName,
        snapshot: snapshot?.directory,
        tokenFingerprint: config.tokenFingerprint,
      });
      await pruneSnapshots(snapshots);
    },
    restore: (previous, snapshot) =>
      rollbackTo(
        config,
        previous,
        snapshot?.directory,
        config.previousDataDirectory
      ),
    settle: (image) => settleCandidate(config, image, startedAt),
    start: async (image) => {
      startedAt = new Date().toISOString();
      await writeDataSchemaMarker(config.dataDirectory);
      run = runner(config, image);
      await run`docker compose -f ${config.composeFile} -p ${config.projectName} up -d --no-build --pull never app`;
    },
    stop: async () => {
      await runner(
        config
      )`docker compose -f ${config.composeFile} -p ${config.projectName} stop -t 30 app`;
    },
    wait: (image) => waitHealthy(config, image),
  });
  console.log(`Deployment healthy: ${candidate}`);
}

async function prepareDataDirectory(config, action, state) {
  const requested = resolveDataDirectory(config.dataDirectory);
  const plan = planDataDirectory({
    action,
    allowEmptyDataDirectory: config.allowEmptyDataDirectory,
    moveDataDirectory: config.moveDataDirectory,
    previous: state.dataDirectory
      ? await inspectDataDirectory(state.dataDirectory)
      : undefined,
    requested,
    state,
    target: await inspectDataDirectory(requested),
  });
  if (!plan.validate) {
    return { directory: requested };
  }
  const directory = await validateDataDirectory(requested, {
    create: plan.create,
  });
  if (plan.create) {
    console.log(`Created data directory ${directory}`);
  }
  return { created: plan.create, directory };
}

// The state directories `mkdir -p` created, innermost first.
function createdStateDirectories(projectDirectory, firstCreated) {
  if (!firstCreated) {
    return [];
  }
  const created = [projectDirectory];
  for (let path = projectDirectory; path !== firstCreated;) {
    path = dirname(path);
    created.push(path);
  }
  return created;
}

export async function runDeployCli(argv = process.argv.slice(2)) {
  progress.step = 'reading options';
  progress.removed = [];
  const [action = 'status'] = argv;
  if (!ACTIONS.has(action)) {
    throw new Error(USAGE);
  }
  await loadDependencies();
  const config = configuration(argv.slice(1));
  config.buildIdentity = await checkedOutBuildIdentity();
  const stateDirectory = STATE_ROOT;
  const statePath = join(
    projectStateDirectory(config.projectName, stateDirectory),
    'state.json'
  );
  const lockPath = `${stateDirectory}/operation.lock`;
  const residue = {
    stateDirectories: createdStateDirectories(
      dirname(statePath),
      await mkdir(dirname(statePath), { recursive: true, mode: 0o700 })
    ),
  };
  progress.logPath = join(dirname(statePath), 'deploy.log');
  try {
    await runAction(action, config, statePath, lockPath, residue);
  } catch (error) {
    await removeResidue(residue);
    throw error;
  }
}

// A failed attempt leaves nothing it created behind: not an empty data
// directory, and not an empty `.deploy/PROJECT/`. Its log then goes to the
// state root.
async function removeResidue(residue) {
  try {
    progress.removed = await removeAttemptResidue(residue);
  } catch {
    progress.removed = [];
  }
  if (
    residue.stateDirectories.some((path) => progress.removed.includes(path))
  ) {
    progress.logPath = join(STATE_ROOT, 'deploy.log');
  }
}

async function runAction(action, config, statePath, lockPath, residue) {
  progress.step = 'validating the data directory';
  const recorded = await readDeployState(config, statePath);
  config.previousDataDirectory = recorded.dataDirectory;
  const prepared = await prepareDataDirectory(config, action, recorded);
  config.dataDirectory = prepared.directory;
  if (prepared.created) {
    residue.dataDirectory = prepared.directory;
  }

  if (action === 'status' || action === 'logs') {
    const run = runner(config);
    if (action === 'status') {
      await run`docker compose -f ${config.composeFile} -p ${config.projectName} ps`;
    } else {
      await run`docker compose -f ${config.composeFile} -p ${config.projectName} logs --tail=200 app`;
    }
    return;
  }

  try {
    await mkdir(lockPath);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error('Another deployment operation is already running.', {
        cause: error,
      });
    }
    throw error;
  }
  try {
    if (action === 'deploy') {
      await deploy(config, statePath);
    } else if (action === 'rollback') {
      const state = await readDeployState(config, statePath);
      const plan = planRollback(state, {
        dataDirectory: config.dataDirectory,
        dataSchema: await readDataSchemaVersion(config.dataDirectory),
        restore: config.restoreSnapshot,
      });
      await rollbackTo(config, plan.image, plan.snapshot);
      await durableJson(statePath, {
        currentDataSchema: state.previousDataSchema ?? 1,
        currentImage: state.previousImage,
        dataDirectory: config.dataDirectory,
        deployedAt: new Date().toISOString(),
        previousDataSchema: state.currentDataSchema ?? 1,
        previousImage: state.currentImage,
        projectName: config.projectName,
        tokenFingerprint: state.tokenFingerprint,
      });
    } else {
      const run = runner(config);
      await run`docker compose -f ${config.composeFile} -p ${config.projectName} stop -t 30 app`;
    }
  } finally {
    await rm(lockPath, { force: true, recursive: true });
  }
}

/**
 * Run the CLI and turn any failure into one line naming the cause and the
 * failing step. The full detail goes to the project's private deploy log.
 */
export async function main(
  argv = process.argv.slice(2),
  { log = console.error, logPath } = {}
) {
  try {
    await runDeployCli(argv);
    return 0;
  } catch (error) {
    const { detail, recovery, summary } = describeDeployFailure(
      error,
      progress
    );
    log(summary);
    if (recovery) {
      log(recovery);
    }
    for (const path of progress.removed || []) {
      log(`Removed ${path}, which the failed attempt created.`);
    }
    const path = logPath || progress.logPath || join(STATE_ROOT, 'deploy.log');
    try {
      await mkdir(dirname(path), { mode: 0o700, recursive: true });
      await appendDeployLog(path, detail);
      log(`Full details: ${path}`);
    } catch (logError) {
      log(`The deploy log ${path} could not be written: ${logError.message}`);
    }
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
