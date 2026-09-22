#!/usr/bin/env node

import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

import { syncDirectory } from '../src/link-cli-mirror.js';
import { bootstrapDependencies } from './bootstrap-dependencies.mjs';
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
  const env = { ...process.env };
  if (image) {
    env.APP_IMAGE = image;
  }
  return command({
    capture,
    env,
    mirror: !capture,
  });
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
  const revisionRun = command({ capture: true, mirror: false });
  const revision = await text(await revisionRun`git rev-parse --short=12 HEAD`);
  const image =
    config.image ||
    `${config.projectName}:candidate-${Date.now()}-${revision || 'unknown'}`;
  const run = runner(config, image);
  if (config.image) {
    await run`docker pull ${image}`;
  } else {
    await run`docker compose -f ${config.composeFile} -p ${config.projectName} build app`;
  }
  await run`docker run --rm --entrypoint node ${image} bin/vietnam-accomodation-search.js --help`;
  await run`docker run --rm --entrypoint clink ${image} --help`;
  const browserSmoke =
    "import { chromium } from 'playwright'; const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }); await browser.close();";
  await run`docker run --rm --entrypoint node ${image} --input-type=module -e ${browserSmoke}`;
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
