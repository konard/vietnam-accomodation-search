import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'test-anywhere';

import {
  commandOptions,
  describeDeployFailure,
  recoveredFailure,
  removeAttemptResidue,
} from '../scripts/deploy-guards.mjs';
import { deploymentStateMachine } from '../scripts/deploy.mjs';

const isDeno = typeof globalThis.Deno !== 'undefined';
const repository = new globalThis.URL('..', import.meta.url);
const deploySource = await readFile(
  new globalThis.URL('scripts/deploy.mjs', repository),
  'utf8'
);

async function rejection(action) {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return undefined;
}

async function withRoot(test) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'issue-86-')));
  try {
    await test(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

describe('streamed command failures', () => {
  it('captures streamed commands while mirroring them', () => {
    expect(commandOptions()).toEqual({
      capture: true,
      env: undefined,
      mirror: true,
    });
    expect(commandOptions({ env: { A: '1' }, quiet: true })).toEqual({
      capture: true,
      env: { A: '1' },
      mirror: false,
    });
    // Every command the deploy runs goes through the same options.
    expect(/command\(\s*\{/u.test(deploySource)).toBe(false);
    expect(deploySource.includes('mirror: !capture')).toBe(false);
  });

  it('keeps the cause of a streamed failure for the summary and the log', async () => {
    // Deno runs the suite without permission to spawn processes, and the
    // command-stream shell is POSIX.
    if (isDeno || process.platform === 'win32') {
      return;
    }
    const { $, shell } = await import('command-stream');
    shell.errexit(true);
    let error;
    try {
      error = await rejection(
        () =>
          $(
            commandOptions()
          )`sh -c ${'echo "Pulling app"; echo "Error response from daemon: pull access denied for vac-local" >&2; exit 1'}`
      );
    } finally {
      shell.errexit(false);
    }
    const { detail, summary } = describeDeployFailure(error, {
      step: 'pulling the image',
    });
    expect(summary).toBe(
      'Deploy failed during pulling the image: Error response from daemon: pull access denied for vac-local'
    );
    expect(detail.exitCode).toBe(1);
    expect(detail.stderr.includes('pull access denied')).toBe(true);
    expect(detail.stdout).toBe('Pulling app\n');
  });

  it('records the exit code of a failure without captured output', () => {
    const error = Object.assign(
      new Error('Command failed with exit code 125'),
      { code: 125, exitCode: 125, result: {} }
    );
    const { detail, summary } = describeDeployFailure(error, {
      step: 'pulling the image',
    });
    expect(summary).toBe(
      'Deploy failed during pulling the image: Command failed with exit code 125'
    );
    expect(detail.exitCode).toBe(125);
    expect(detail.stderr).toBe(undefined);
    expect(detail.stdout).toBe(undefined);
  });
});

describe('failed step after a recovery', () => {
  const hooks = (overrides = {}) => ({
    capture: async () => ({ directory: 'snapshot-1' }),
    discard: async () => {},
    inspectPrevious: async () => 'app:rollback-1',
    prepare: async () => 'app:candidate',
    record: async () => {},
    restore: async () => {},
    settle: async () => {},
    start: async () => {},
    stop: async () => {},
    wait: async () => {},
    ...overrides,
  });

  it('names the readiness check, not the restore, and reports the recovery apart', async () => {
    const error = await rejection(() =>
      deploymentStateMachine(
        hooks({
          wait: async () => {
            throw new Error(
              'Candidate did not become ready before the deployment deadline.'
            );
          },
        })
      )
    );
    expect(error.message).toBe(
      'Candidate readiness failed; previous image and state restored: Candidate did not become ready before the deployment deadline.'
    );
    const { detail, recovery, summary } = describeDeployFailure(error, {
      step: 'restoring the previous service',
    });
    expect(summary).toBe(
      'Deploy failed during waiting for readiness: Candidate did not become ready before the deployment deadline.'
    );
    expect(recovery).toBe('Recovered: previous image and state restored.');
    expect(detail.step).toBe('waiting for readiness');
    expect(detail.recovery).toBe('previous image and state restored');
  });

  it('names the settle window when a first deploy is removed', async () => {
    const calls = [];
    const error = await rejection(() =>
      deploymentStateMachine(
        hooks({
          discard: async () => calls.push('discard'),
          inspectPrevious: async () => undefined,
          settle: async () => {
            throw new Error(
              'Candidate failed during the 30 s settle window: 1 Telegram polling conflict(s): another poller holds this bot token.'
            );
          },
        })
      )
    );
    expect(calls).toEqual(['discard']);
    const { recovery, summary } = describeDeployFailure(error);
    expect(summary).toBe(
      'Deploy failed during observing the settle window: Candidate failed during the 30 s settle window: 1 Telegram polling conflict(s): another poller holds this bot token.'
    );
    expect(recovery).toBe(
      "Recovered: the new project's containers were removed."
    );
  });

  it('names the snapshot step when the snapshot fails', async () => {
    const error = await rejection(() =>
      deploymentStateMachine(
        hooks({
          capture: async () => {
            throw new Error('disk full');
          },
        })
      )
    );
    expect(describeDeployFailure(error).summary).toBe(
      'Deploy failed during snapshotting state: disk full'
    );
    expect(error.step).toBe('snapshotting state');
  });

  it('names the restore when the recovery itself fails', async () => {
    const error = await rejection(() =>
      deploymentStateMachine(
        hooks({
          restore: async () => {
            throw new Error('rollback image is gone');
          },
          wait: async () => {
            throw new Error('health failed');
          },
        })
      )
    );
    expect(error.message).toBe('rollback image is gone');
    expect(error.recovery).toBe(undefined);
    expect(
      describeDeployFailure(error, { step: 'restoring the previous service' })
        .summary
    ).toBe(
      'Deploy failed during restoring the previous service: rollback image is gone'
    );
  });

  it('keeps a redacted, bounded cause from a recovered command failure', () => {
    const token = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const failure = Object.assign(
      new Error('Command failed with exit code 3'),
      {
        exitCode: 3,
        stderr: `bad token ${token}\n`,
        stdout: '',
      }
    );
    const error = recoveredFailure(failure, {
      prefix: 'Candidate readiness failed',
      recovery: 'previous image and state restored',
      step: 'starting the candidate',
    });
    const described = describeDeployFailure(error);
    expect(described.summary.startsWith('Deploy failed during starting')).toBe(
      true
    );
    expect(described.detail.exitCode).toBe(3);
    expect(JSON.stringify(described).includes(token)).toBe(false);
  });
});

describe('residue of a failed attempt', () => {
  it('removes an attempt-created data directory that holds no data', async () => {
    // Deno runs the suite with read-only permissions.
    if (isDeno) {
      return;
    }
    await withRoot(async (root) => {
      const data = join(root, 'data');
      await mkdir(data);
      await writeFile(join(data, '.state-schema.json'), '{}\n');
      await writeFile(join(data, '.write-probe-1'), 'probe');
      const project = join(root, '.deploy', 'project');
      await mkdir(project, { recursive: true });
      expect(
        await removeAttemptResidue({
          dataDirectory: data,
          stateDirectories: [project, join(root, '.deploy')],
        })
      ).toEqual([data, project, join(root, '.deploy')]);
      expect(await readdir(root)).toEqual([]);
    });
  });

  it('keeps data and state that are not empty', async () => {
    if (isDeno) {
      return;
    }
    await withRoot(async (root) => {
      const data = join(root, 'data');
      await mkdir(data);
      await writeFile(join(data, 'offers.lino'), '(a: b c)\n');
      const project = join(root, '.deploy', 'project');
      await mkdir(project, { recursive: true });
      await writeFile(join(root, '.deploy', 'deploy.log'), '{}\n');
      expect(
        await removeAttemptResidue({
          dataDirectory: data,
          stateDirectories: [project, join(root, '.deploy')],
        })
      ).toEqual([project]);
      expect((await readdir(root)).sort()).toEqual(['.deploy', 'data']);
      expect(await readdir(join(root, '.deploy'))).toEqual(['deploy.log']);
      expect(
        await removeAttemptResidue({
          dataDirectory: join(root, 'missing'),
          stateDirectories: [join(root, 'missing-state')],
        })
      ).toEqual([]);
    });
  });

  it('cleans up whatever a failed deploy created before reporting it', () => {
    const order = [
      'await mkdir(dirname(statePath)',
      'await runAction(action, config, statePath, lockPath, residue);',
      'await removeResidue(residue);',
    ].map((marker) => deploySource.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(
      deploySource.includes('residue.dataDirectory = prepared.directory')
    ).toBe(true);
    expect(deploySource.includes('which the failed attempt created.')).toBe(
      true
    );
  });
});

describe('runtime data in the working tree', () => {
  const runtime = [
    '.vietnam-accomodation-search/browser-profile/Default/Extensions/a/1/content.js',
    '.deploy/project/snapshots/1/script.js',
  ];

  it('is ignored by ESLint', async () => {
    // Deno runs the suite with read-only permissions; ESLint is a Node tool.
    if (isDeno) {
      return;
    }
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({ cwd: fileURLToPath(repository) });
    for (const path of runtime) {
      expect(await eslint.isPathIgnored(path)).toBe(true);
    }
    expect(await eslint.isPathIgnored('scripts/deploy.mjs')).toBe(false);
  });

  it('is ignored by Prettier and jscpd', async () => {
    const prettier = (
      await readFile(new globalThis.URL('.prettierignore', repository), 'utf8')
    )
      .replaceAll('\r\n', '\n')
      .split('\n');
    const jscpd = JSON.parse(
      await readFile(new globalThis.URL('.jscpd.json', repository), 'utf8')
    ).ignore;
    for (const directory of ['.vietnam-accomodation-search', '.deploy']) {
      expect(prettier.includes(`${directory}/`)).toBe(true);
      expect(jscpd.includes(`**/${directory}/**`)).toBe(true);
    }
  });
});
