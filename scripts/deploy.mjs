#!/usr/bin/env node

import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { syncDirectory } from '../src/link-cli-mirror.js';
import { bootstrapDependencies } from './bootstrap-dependencies.mjs';
import { validateDataDirectory } from './data-directory.mjs';
import { loadCommandStream, loadLinoArguments } from './use-module.mjs';

let command;
let makeConfig;

async function loadDependencies() {
  if (command && makeConfig) {
    return;
  }
  const [commandStream, argumentsModule] = await bootstrapDependencies([
    loadCommandStream,
    loadLinoArguments,
  ]);
  command = commandStream.$;
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
        .option('project-name', {
          default: getenv(
            'COMPOSE_PROJECT_NAME',
            'vietnam-accommodation-search'
          ),
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
  return command({
    capture,
    env,
    mirror: !capture,
  });
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

export async function inspectImageLabels(run, image) {
  const format = '{{json .Config.Labels}}';
  return JSON.parse(
    await text(await run`docker image inspect --format=${format} ${image}`)
  );
}

async function checkedOutBuildIdentity() {
  const run = command({ capture: true, mirror: false });
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
  if (config.image) {
    await run`docker pull ${image}`;
  } else {
    await run`docker compose -f ${config.composeFile} -p ${config.projectName} build app`;
  }
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
  const storagePreflight =
    "import { open, rename, rm } from 'node:fs/promises'; const a='/data/.container-write-probe'; const b=a+'.renamed'; const f=await open(a,'wx',0o600); await f.writeFile('probe'); await f.sync(); await f.close(); await rename(a,b); await rm(b);";
  await run`docker compose -f ${config.composeFile} -p ${config.projectName} run --rm --no-deps --entrypoint node app --input-type=module -e ${storagePreflight}`;
  await run`docker compose -f ${config.composeFile} -p ${config.projectName} run --rm --no-deps --entrypoint node app bin/vietnam-accomodation-search.js telegram preflight`;
  return image;
}

async function rollbackTo(config, image) {
  const run = runner(config, image);
  await run`docker compose -f ${config.composeFile} -p ${config.projectName} stop -t 30 app`;
  await run`docker compose -f ${config.composeFile} -p ${config.projectName} up -d --no-build --pull never app`;
  await waitHealthy(config, image);
}

export async function deploymentStateMachine({
  inspectPrevious,
  prepare,
  record,
  restore,
  start,
  stop,
  wait,
}) {
  const candidate = await prepare();
  const previous = await inspectPrevious();
  if (previous) {
    await stop();
  }
  try {
    await start(candidate);
    await wait(candidate);
  } catch (error) {
    if (previous) {
      await restore(previous);
    }
    throw new Error(
      `Candidate readiness failed; previous image restored: ${error.message}`
    );
  }
  await record({ candidate, previous });
  return candidate;
}

async function deploy(config, statePath) {
  let existing;
  let run;
  const candidate = await deploymentStateMachine({
    prepare: () => prepareCandidate(config),
    inspectPrevious: async () => {
      existing = await currentContainer(config);
      if (!existing) {
        return undefined;
      }
      const inspect = command({ capture: true, mirror: false });
      const imageId = await text(
        await inspect`docker inspect --format={{.Image}} ${existing}`
      );
      const rollbackImage = `${config.projectName}:rollback-${Date.now()}`;
      await command`docker image tag ${imageId} ${rollbackImage}`;
      return rollbackImage;
    },
    record: ({ candidate: currentImage, previous: previousImage }) =>
      durableJson(statePath, {
        currentImage,
        deployedAt: new Date().toISOString(),
        previousImage,
      }),
    restore: (previous) => rollbackTo(config, previous),
    start: async (image) => {
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

export async function runDeployCli(argv = process.argv.slice(2)) {
  await loadDependencies();
  const [action = 'status'] = argv;
  const config = configuration(argv.slice(1));
  config.buildIdentity = await checkedOutBuildIdentity();
  config.dataDirectory = await validateDataDirectory(config.dataDirectory);
  const stateDirectory = '.deploy';
  const statePath = `${stateDirectory}/state.json`;
  const lockPath = `${stateDirectory}/operation.lock`;
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });

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
      throw new Error('Another deployment operation is already running.');
    }
    throw error;
  }
  try {
    if (action === 'deploy') {
      await deploy(config, statePath);
    } else if (action === 'rollback') {
      const state = await optionalJson(statePath);
      if (!state.previousImage) {
        throw new Error('No rollback image is recorded.');
      }
      await rollbackTo(config, state.previousImage);
      await durableJson(statePath, {
        currentImage: state.previousImage,
        deployedAt: new Date().toISOString(),
        previousImage: state.currentImage,
      });
    } else if (action === 'stop') {
      const run = runner(config);
      await run`docker compose -f ${config.composeFile} -p ${config.projectName} stop -t 30 app`;
    } else {
      throw new Error(
        'Usage: deploy.mjs deploy|status|logs|stop|rollback [options]'
      );
    }
  } finally {
    await rm(lockPath, { force: true, recursive: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runDeployCli();
}
