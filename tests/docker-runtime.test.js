import {
  lstat,
  mkdtemp,
  mkdir,
  realpath,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'test-anywhere';

import {
  assertComposeDataMount,
  assertImageIdentity,
  deploymentStateMachine,
} from '../scripts/deploy.mjs';
import { validateDataDirectory } from '../scripts/data-directory.mjs';

async function source(path) {
  return readFile(new globalThis.URL(`../${path}`, import.meta.url), 'utf8');
}

describe('container runtime contract', () => {
  it('pins multi-architecture bases and runs the production image unprivileged', async () => {
    const dockerfile = await source('Dockerfile');
    expect(dockerfile).toContain('FROM rust@sha256:');
    expect(dockerfile).toContain('FROM node@sha256:');
    expect(dockerfile).toContain(
      'cargo install link-cli --version 0.2.10 --locked'
    );
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/bin/tini"');
    expect(dockerfile).toContain('VOLUME ["/data"]');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('org.opencontainers.image.revision');
  });

  it('persists data, binds health locally, and hardens Compose defaults', async () => {
    const compose = await source('compose.yaml');
    expect(compose).toContain('127.0.0.1:${HEALTH_PORT:-8080}:8080');
    expect(compose).toContain('HEALTH_HOST: 0.0.0.0');
    expect(compose).toContain('type: bind');
    expect(compose).toContain(
      'source: ${DATA_DIRECTORY_HOST:-./.vietnam-accomodation-search}'
    );
    expect(compose).toContain('target: /data');
    expect(compose).toContain('create_host_path: false');
    expect(compose).not.toContain('accommodation-data:/data');
    expect(compose).toContain('stop_grace_period: 30s');
    expect(compose).toContain('read_only: true');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).toContain('cap_drop:');
    expect(compose).toContain('required: true');
    expect(compose).toContain('${ENV_FILE:-.env}');
    expect(compose).not.toContain('init: true');
    expect(compose).toContain('NPM_PACKAGE_VERSION: ${NPM_PACKAGE_VERSION:?');
    expect(compose).toContain('VCS_REF: ${VCS_REF:?');
    expect(compose).toContain('BUILD_DATE: ${BUILD_DATE:?');
  });

  it('rejects stale image labels before starting a candidate', async () => {
    const expected = {
      buildDate: '2026-09-24T12:00:00+00:00',
      revision: 'a'.repeat(40),
      version: '0.12.1',
    };
    const labels = {
      'org.opencontainers.image.created': expected.buildDate,
      'org.opencontainers.image.revision': expected.revision,
      'org.opencontainers.image.version': expected.version,
    };
    expect(assertImageIdentity(labels, expected)).toBe(true);
    for (const name of Object.keys(labels)) {
      let failure;
      try {
        assertImageIdentity({ ...labels, [name]: 'stale' }, expected);
      } catch (error) {
        failure = error;
      }
      expect(failure.message).toContain(name);
    }
  });

  it('preflights a unique candidate and preserves an exact rollback image', async () => {
    const deploy = await source('scripts/deploy.mjs');
    expect(deploy).toContain('loadCommandStream');
    expect(deploy).toContain('loadLinoArguments');
    expect(await source('scripts/use-module.mjs')).toContain(
      "useModule('command-stream'"
    );
    expect(deploy).toContain('operation.lock');
    expect(deploy).toContain("option('data-directory'");
    expect(deploy).toContain('DATA_DIRECTORY_HOST');
    expect(deploy).toContain('validateDataDirectory');
    expect(deploy).toContain('storagePreflight');
    expect(deploy).toContain('candidate-${Date.now()}');
    expect(deploy).toContain('telegram preflight');
    expect(deploy).toContain('chromium.launch');
    expect(deploy).toContain('await syncDirectory(dirname(path))');
    expect(deploy).toContain('docker image tag ${imageId} ${rollbackImage}');
    expect(deploy).toContain(
      'Candidate readiness failed; previous image restored'
    );
    expect(deploy.indexOf('prepareCandidate(config)')).toBeLessThan(
      deploy.indexOf('stop -t 30 app')
    );
    expect(deploy).not.toContain('console.log(process.env');
  });

  it('validates a private durable host directory and rejects unsafe targets', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    // macOS exposes /var as a system symlink. Resolve the temporary root so
    // this success fixture does not accidentally exercise the rejection path.
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'accommodation-data-'))
    );
    try {
      const directory = join(root, 'state');
      expect(await validateDataDirectory(directory)).toBe(directory);
      if (process.platform !== 'win32') {
        expect((await lstat(directory)).mode & 0o777).toBe(0o700);
      }

      await writeFile(
        join(directory, '.state-schema.json'),
        '{"schemaVersion":999}\n'
      );
      let incompatible;
      try {
        await validateDataDirectory(directory);
      } catch (error) {
        incompatible = error;
      }
      expect(incompatible.message).toContain('newer schema');

      const file = join(root, 'file');
      await writeFile(file, 'not a directory');
      let fileFailure;
      try {
        await validateDataDirectory(file);
      } catch (error) {
        fileFailure = error;
      }
      expect(fileFailure.message).toContain('directory');

      const target = join(root, 'target');
      const link = join(root, 'link');
      await mkdir(target);
      await symlink(
        target,
        link,
        process.platform === 'win32' ? 'junction' : undefined
      );
      let linkFailure;
      try {
        await validateDataDirectory(join(link, 'escaped'));
      } catch (error) {
        linkFailure = error;
      }
      expect(linkFailure.message).toContain('symbolic link');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects empty, filesystem-root, home, and secret host paths', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    for (const directory of ['', '/', tmpdir(), join(tmpdir(), '.ssh')]) {
      let error;
      try {
        await validateDataDirectory(directory, {
          homeDirectory: tmpdir(),
        });
      } catch (caught) {
        error = caught;
      }
      expect(error instanceof Error).toBe(true);
    }
  });

  it('requires the rendered Compose model to use the exact validated bind', () => {
    const dataDirectory = resolve('accommodation-compose-state');
    expect(
      assertComposeDataMount(
        {
          services: {
            app: {
              volumes: [
                { source: dataDirectory, target: '/data', type: 'bind' },
              ],
            },
          },
        },
        dataDirectory
      )
    ).toBe(dataDirectory);

    for (const volume of [
      { source: 'legacy-volume', target: '/data', type: 'volume' },
      {
        source: resolve('accommodation-wrong'),
        target: '/data',
        type: 'bind',
      },
    ]) {
      let error;
      try {
        assertComposeDataMount(
          { services: { app: { volumes: [volume] } } },
          dataDirectory
        );
      } catch (caught) {
        error = caught;
      }
      expect(error.message).toContain('exact bind mount');
    }
  });

  it('never stops the current service for a broken candidate', async () => {
    const calls = [];
    let error;
    try {
      await deploymentStateMachine({
        inspectPrevious: async () => calls.push('inspect'),
        prepare: async () => {
          calls.push('prepare');
          throw new Error('offline smoke failed');
        },
        record: async () => calls.push('record'),
        restore: async () => calls.push('restore'),
        start: async () => calls.push('start'),
        stop: async () => calls.push('stop'),
        wait: async () => calls.push('wait'),
      });
    } catch (caught) {
      error = caught;
    }
    expect(error.message).toContain('offline smoke failed');
    expect(calls).toEqual(['prepare']);
  });

  it('restores the exact prior image after candidate readiness failure', async () => {
    const calls = [];
    let error;
    try {
      await deploymentStateMachine({
        inspectPrevious: async () => 'sha256:prior-image',
        prepare: async () => 'candidate:unique',
        record: async () => calls.push('record'),
        restore: async (image) => calls.push(`restore:${image}`),
        start: async (image) => calls.push(`start:${image}`),
        stop: async () => calls.push('stop'),
        wait: async () => {
          throw new Error('health failed');
        },
      });
    } catch (caught) {
      error = caught;
    }
    expect(error.message).toContain('previous image restored');
    expect(calls).toEqual([
      'stop',
      'start:candidate:unique',
      'restore:sha256:prior-image',
    ]);
  });
});
