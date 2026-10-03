import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'test-anywhere';

import {
  appendDeployLog,
  assertPortsAvailable,
  describeDeployFailure,
  parsePortBinding,
  probePort,
  publishedPorts,
  trackCommands,
} from '../scripts/deploy-guards.mjs';
import { deploymentStateMachine, main } from '../scripts/deploy.mjs';

const isDeno = typeof globalThis.Deno !== 'undefined';
const deploySource = await readFile(
  new globalThis.URL('../scripts/deploy.mjs', import.meta.url),
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

// The error command-stream rejects with: the child process rides along as
// `result`, which printed as ~100 lines of internals.
function commandFailure(stderr, exitCode = 1) {
  const result = { child: { pid: 1 }, [Symbol('internal')]: true };
  result.self = result;
  return Object.assign(new Error(`Command failed with exit code ${exitCode}`), {
    code: exitCode,
    exitCode,
    result,
    stderr,
    stdout: 'Pulling app\n',
  });
}

describe('deploy failure output', () => {
  it('reduces a command failure to one line naming the step and cause', () => {
    const progress = {
      command: 'docker compose -f compose.yaml -p vac pull app',
      step: 'pulling the image',
    };
    const error = commandFailure(
      'Pulling app\nError response from daemon: pull access denied for vac-local\n\n'
    );
    const { detail, summary } = describeDeployFailure(error, progress);
    expect(summary).toBe(
      'Deploy failed during pulling the image: Error response from daemon: pull access denied for vac-local'
    );
    expect(summary.includes('\n')).toBe(false);
    expect(Object.keys(detail).sort()).toEqual([
      'at',
      'command',
      'exitCode',
      'message',
      'stack',
      'stderr',
      'stdout',
      'step',
    ]);
    expect(detail.command).toBe(progress.command);
    expect(detail.exitCode).toBe(1);
    expect(JSON.stringify(detail).includes('child')).toBe(false);
  });

  it('keeps the context of a wrapped failure and redacts tokens', () => {
    const token = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const error = new Error(
      'Candidate readiness failed; previous image and state restored: Command failed with exit code 3',
      { cause: commandFailure(`bad token ${token}\n`, 3) }
    );
    const { detail, summary } = describeDeployFailure(error, {
      step: 'restoring the previous service',
    });
    expect(summary.startsWith('Deploy failed during restoring')).toBe(true);
    expect(summary.includes('previous image and state restored: bad')).toBe(
      true
    );
    expect(JSON.stringify({ detail, summary }).includes(token)).toBe(false);
    expect(detail.exitCode).toBe(3);
  });

  it('bounds the output kept for the log', () => {
    const { detail } = describeDeployFailure(
      commandFailure(`${'x'.repeat(20_000)}\nlast line\n`)
    );
    expect(detail.stderr.length <= 8 * 1024).toBe(true);
    expect(detail.stderr.endsWith('last line\n')).toBe(true);
    expect(detail.step).toBe('setup');
    expect(describeDeployFailure('plain').summary).toBe(
      'Deploy failed during setup: plain'
    );
    expect(describeDeployFailure(new Error('a\nb')).summary).toBe(
      'Deploy failed during setup: a'
    );
  });

  it('records the command each tagged call runs', async () => {
    const calls = [];
    const progress = {};
    const run = (strings, ...values) => {
      if (Array.isArray(strings) && 'raw' in strings) {
        calls.push(values);
        return Promise.resolve('ran');
      }
      return run;
    };
    const tracked = trackCommands(run, progress);
    const image = 'vac:1';
    expect(await tracked`docker   pull\n ${image}`).toBe('ran');
    expect(progress.command).toBe('docker pull vac:1');
    const long = 'x'.repeat(400);
    await tracked({ capture: true })`echo ${long}`;
    expect(progress.command.length).toBe(160);
    expect(progress.command.endsWith('…')).toBe(true);
    expect(calls).toEqual([[image], [long]]);
  });

  it('writes the private log with owner-only permissions', async () => {
    // Deno runs the suite with read-only permissions.
    if (isDeno) {
      return;
    }
    const root = await realpath(await mkdtemp(join(tmpdir(), 'issue-81-')));
    try {
      const path = join(root, 'deploy.log');
      await writeFile(path, '', { mode: 0o644 });
      await appendDeployLog(path, { step: 'a' });
      await appendDeployLog(path, { step: 'b' });
      // Windows has no POSIX permission bits.
      if (process.platform !== 'win32') {
        expect((await stat(path)).mode & 0o777).toBe(0o600);
      }
      expect(
        (await readFile(path, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      ).toEqual([{ step: 'a' }, { step: 'b' }]);

      const printed = [];
      const logPath = join(root, 'project', 'deploy.log');
      expect(
        await main(['bogus'], { log: (line) => printed.push(line), logPath })
      ).toBe(1);
      expect(printed).toEqual([
        'Deploy failed during reading options: Usage: deploy.mjs deploy|status|logs|stop|rollback [--restore-snapshot] [options]',
        `Full details: ${logPath}`,
      ]);
      expect(JSON.parse(await readFile(logPath, 'utf8')).step).toBe(
        'reading options'
      );

      const unwritable = [];
      await main(['bogus'], {
        log: (line) => unwritable.push(line),
        logPath: join(path, 'deploy.log'),
      });
      expect(unwritable[1].startsWith('The deploy log ')).toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe('failed first deploy', () => {
  it('removes the containers it created', async () => {
    const calls = [];
    const error = await rejection(() =>
      deploymentStateMachine({
        discard: async () => calls.push('discard'),
        inspectPrevious: async () => undefined,
        prepare: async () => 'vac:candidate',
        record: async () => calls.push('record'),
        restore: async () => calls.push('restore'),
        start: async () => {
          calls.push('start');
          throw new Error('port is already allocated');
        },
        stop: async () => calls.push('stop'),
        wait: async () => calls.push('wait'),
      })
    );
    expect(calls).toEqual(['start', 'discard']);
    expect(error.message).toBe(
      "Candidate readiness failed; the new project's containers were removed: port is already allocated"
    );
  });

  it('keeps volumes when it removes them', () => {
    expect(deploySource.includes('-p ${config.projectName} down`')).toBe(true);
    expect(/\bdown\s+-v\b|--volumes/u.test(deploySource)).toBe(false);
  });
});

describe('host port preflight', () => {
  const model = {
    services: {
      app: {
        ports: [
          { host_ip: '127.0.0.1', published: '18476', target: 8080 },
          { published: 9000, target: 9000 },
          { target: 7000 },
        ],
      },
    },
  };

  it('reads the published ports from the rendered Compose model', () => {
    expect(publishedPorts(model)).toEqual([
      { host: '127.0.0.1', port: 18476, target: 8080 },
      { host: '0.0.0.0', port: 9000, target: 9000 },
    ]);
    expect(publishedPorts({})).toEqual([]);
    expect(parsePortBinding('127.0.0.1:18476\n')).toEqual([{ port: 18476 }]);
    expect(parsePortBinding('')).toEqual([]);
  });

  it('refuses a taken port unless this project already publishes it', async () => {
    const ports = publishedPorts(model);
    const probe = async ({ port }) => port !== 18476;
    expect(
      (await rejection(() => assertPortsAvailable({ ports, probe }))).message
    ).toBe(
      'Host port 127.0.0.1:18476 is already in use; set HEALTH_PORT to a free port.'
    );
    expect(
      await assertPortsAvailable({ owned: [{ port: 18476 }], ports, probe })
    ).toBe(undefined);
  });

  it('detects a port another process listens on', async () => {
    // Deno runs the suite without network permissions.
    if (isDeno) {
      return;
    }
    const server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      expect(await probePort({ host: '127.0.0.1', port })).toBe(false);
      expect(
        (
          await rejection(() =>
            assertPortsAvailable({ ports: [{ host: '127.0.0.1', port }] })
          )
        ).message.includes(`127.0.0.1:${port} is already in use`)
      ).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    expect(await probePort({ host: '127.0.0.1', port })).toBe(true);
    expect(
      (await rejection(() => probePort({ host: '203.0.113.1', port: 0 })))?.code
    ).toBe('EADDRNOTAVAIL');
  });

  it('checks ports before anything is built, pulled, or stopped', () => {
    const order = [
      'assertComposeDataMount(renderedCompose',
      'await assertPortsAvailable(',
      "progress.step = config.image ? 'pulling the image'",
      'assertTokenNotShared({',
      'const candidate = await prepare();',
      'await stop();',
    ].map((marker) => deploySource.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
