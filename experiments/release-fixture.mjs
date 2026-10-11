// Release fixtures use local Git remotes and fake gh only. Runtime preloads,
// global Git hooks/signing, network bootstrap and credentials are unrelated.
import { spawn, spawnSync } from 'node:child_process';

const INHERITED_KEYS = [
  'PATH',
  'Path',
  'SystemRoot',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
];

export function isolatedReleaseEnvironment(
  overrides = {},
  inherited = process.env
) {
  return {
    ...Object.fromEntries(
      INHERITED_KEYS.filter((key) => inherited[key] !== undefined).map(
        (key) => [key, inherited[key]]
      )
    ),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    ...overrides,
  };
}

export function runReleaseFixtureSync(
  command,
  args,
  { cwd, env, timeoutMs = 5000, ...options } = {}
) {
  const result = spawnSync(command, args, {
    cwd,
    env: isolatedReleaseEnvironment(env),
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    encoding: 'utf8',
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function signalOwnedTree(child, signal) {
  if (!child.pid) {
    return;
  }
  if (process.platform === 'win32') {
    if (child.exitCode === null) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        timeout: 2000,
        stdio: 'ignore',
      });
    }
  } else {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') {
        throw error;
      }
    }
  }
}

export function runReleaseFixtureCommand(
  command,
  args,
  { cwd, env, timeoutMs = 10_000, signal } = {}
) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: isolatedReleaseEnvironment(env),
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let force;
    const stop = () => {
      signalOwnedTree(child, 'SIGTERM');
      force ||= setTimeout(() => signalOwnedTree(child, 'SIGKILL'), 250);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code, exitSignal) => {
      clearTimeout(timer);
      clearTimeout(force);
      signal?.removeEventListener('abort', stop);
      // Pipes have closed and the owned parent has been reaped. The finite
      // descendant control independently verifies the recorded child PID.
      resolve({
        code: code ?? 1,
        status: code,
        stdout,
        stderr,
        signal: exitSignal,
        timedOut,
        teardownVerified: child.exitCode !== null || child.signalCode !== null,
      });
    });
  });
}
