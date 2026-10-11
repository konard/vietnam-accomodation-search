import { readFile, stat, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const unavailable = () =>
  Object.assign(new Error('QA_CAPACITY_UNAVAILABLE'), {
    code: 'QA_CAPACITY_UNAVAILABLE',
  });

function desktopSettingsPath(platform, home) {
  if (platform === 'darwin') {
    return join(
      home,
      'Library',
      'Group Containers',
      'group.com.docker',
      'settings-store.json'
    );
  }
  if (platform === 'linux') {
    return join(home, '.docker', 'desktop', 'settings-store.json');
  }
  throw unavailable();
}

function diskCandidates(platform, home, folder) {
  if (folder) {
    if (
      typeof folder !== 'string' ||
      !isAbsolute(folder) ||
      /[\r\n]/u.test(folder)
    ) {
      throw unavailable();
    }
    return [
      join(folder, 'Docker.raw'),
      join(folder, 'vms', '0', 'data', 'Docker.raw'),
    ];
  }
  const base =
    platform === 'darwin'
      ? join(home, 'Library', 'Containers', 'com.docker.docker', 'Data')
      : join(home, '.docker', 'desktop');
  return [join(base, 'vms', '0', 'data', 'Docker.raw')];
}

async function findDiskImage(candidates, statImpl) {
  for (const candidate of candidates) {
    try {
      if ((await statImpl(candidate)).isFile()) {
        return candidate;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw unavailable();
      }
    }
  }
  throw unavailable();
}

export async function desktopDiskImage({
  platform = process.platform,
  environment = process.env,
  home = homedir(),
  readFileImpl = readFile,
  statImpl = stat,
} = {}) {
  let image = environment.QA_DOCKER_DISK_IMAGE;
  if (!image) {
    const settingsPath = desktopSettingsPath(platform, home);
    let settings;
    try {
      settings = JSON.parse(await readFileImpl(settingsPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw unavailable();
      }
    }
    // A configured disk location must never fall back to a different drive.
    image = await findDiskImage(
      diskCandidates(platform, home, settings?.dataFolder),
      statImpl
    );
  }
  if (!image || !isAbsolute(image) || /[\r\n]/u.test(image)) {
    throw unavailable();
  }
  return findDiskImage([image], statImpl);
}

async function localProbeImage(run, configured) {
  for (const ref of configured
    ? [configured]
    : ['moby/buildkit:buildx-stable-1', 'busybox:1.37.0']) {
    let image;
    try {
      image = JSON.parse(
        await run(['image', 'inspect', ref, '--format', '{{json .}}'])
      );
    } catch {
      continue;
    }
    const volumes = Object.keys(image.Config?.Volumes || {});
    if (
      /^sha256:[a-f0-9]{64}$/u.test(image.Id || '') &&
      volumes.length <= 8 &&
      volumes.every((path) => /^\/[a-zA-Z0-9/_-]+$/u.test(path))
    ) {
      return { id: image.Id, volumes };
    }
  }
  throw unavailable();
}

export async function recoverDockerCapacityProbe(run, journal) {
  const { name, token } = JSON.parse(await readFile(journal, 'utf8'));
  if (
    !/^vac-qa-capacity-[a-f0-9]{32}$/u.test(name) ||
    !/^[a-f0-9]{32}$/u.test(token) ||
    name !== `vac-qa-capacity-${token}`
  ) {
    throw unavailable();
  }
  const list = [
    'ps',
    '-aq',
    '--no-trunc',
    '--filter',
    `name=^/${name}$`,
    '--filter',
    `label=foundation.qa.capacity=${token}`,
  ];
  const ids = (await run(list)).trim().split(/\s+/u).filter(Boolean);
  if (ids.length) {
    await run(['rm', '-f', ...ids]);
  }
  if ((await run(list)).trim()) {
    throw unavailable();
  }
  await rm(journal);
}

// Use a locally cached image only. This tiny read-only helper measures the
// guest overlay filesystem; it mounts no Docker socket or source data. Its
// reservation is journalled before creation and recovered by exact labels.
export async function prepareDockerCapacityProbe(
  run,
  scope,
  lockDirectory,
  signal,
  environment = process.env
) {
  const image = await localProbeImage(
    run,
    environment.QA_DOCKER_CAPACITY_IMAGE
  );
  const token = randomBytes(16).toString('hex');
  const name = `vac-qa-capacity-${token}`;
  const journal = join(lockDirectory, 'docker-capacity.json');
  await writeFile(journal, JSON.stringify({ name, token, imageId: image.id }), {
    mode: 0o600,
    flag: 'wx',
  });
  scope.defer('Docker capacity probe', () =>
    recoverDockerCapacityProbe(run, journal)
  );
  await run(
    [
      'create',
      '--name',
      name,
      '--label',
      `foundation.qa.capacity=${token}`,
      '--pull',
      'never',
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--memory',
      '32m',
      '--memory-swap',
      '32m',
      '--cpus',
      '0.1',
      '--pids-limit',
      '16',
      '--no-healthcheck',
      '--user',
      '0',
      ...image.volumes.flatMap((path) => [
        '--mount',
        `type=tmpfs,destination=${path},tmpfs-size=1048576`,
      ]),
      '--entrypoint',
      '/bin/sh',
      image.id,
      '-c',
      'exec sleep 2147483647',
    ],
    { signal }
  );
  await run(['start', name], { signal });
  return async (timeoutMs, checkSignal) => {
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = checkSignal
      ? AbortSignal.any([checkSignal, deadline])
      : deadline;
    let output;
    try {
      output = await run(['exec', name, 'df', '-Pk', '/'], { signal });
    } catch {
      throw unavailable();
    }
    const rows = output.trim().split(/\r?\n/u);
    const fields = rows.at(-1)?.trim().split(/\s+/u);
    if (
      rows.length !== 2 ||
      fields?.length !== 6 ||
      fields[5] !== '/' ||
      !/^\d+$/u.test(fields[3])
    ) {
      throw unavailable();
    }
    return BigInt(fields[3]) * 1024n;
  };
}
