import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'test-anywhere';

import { deploymentStateMachine } from '../scripts/deploy.mjs';

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
    expect(compose).toContain('accommodation-data:/data');
    expect(compose).toContain('stop_grace_period: 30s');
    expect(compose).toContain('read_only: true');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).toContain('cap_drop:');
    expect(compose).toContain('required: true');
    expect(compose).toContain('${ENV_FILE:-.env}');
  });

  it('preflights a unique candidate and preserves an exact rollback image', async () => {
    const deploy = await source('scripts/deploy.mjs');
    expect(deploy).toContain('loadCommandStream');
    expect(deploy).toContain('loadLinoArguments');
    expect(await source('scripts/use-module.mjs')).toContain(
      "useModule('command-stream'"
    );
    expect(deploy).toContain('operation.lock');
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
