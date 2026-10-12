// Disposable audit profiles have a different lifetime from retained evidence.
import { access, readdir, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { onceQaCleanup, qaRecoveryDirectory } from './qa-cleanup.mjs';

const execute = promisify(execFile);

export function browserPidsForProfile(snapshot, profile) {
  const argument = `--user-data-dir=${profile}`;
  const forms = [
    argument,
    `"${argument}"`,
    `'${argument}'`,
    `--user-data-dir="${profile}"`,
    `--user-data-dir='${profile}'`,
  ];
  return String(snapshot)
    .split('\n')
    .flatMap((line) => {
      const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
      if (!match) {
        return [];
      }
      const command = ` ${match[2]} `;
      return forms.some((form) => command.includes(` ${form} `))
        ? [Number(match[1])]
        : [];
    });
}

// Read process arguments only to prove ownership of this exact disposable
// profile. Never terminate processes or inspect a person's browser state.
export async function qaBrowserProfilePids(profile) {
  if (process.platform === 'linux') {
    const rows = await Promise.all(
      (await readdir('/proc'))
        .filter((entry) => /^\d+$/u.test(entry))
        .map(async (entry) => {
          const args = await readFile(`/proc/${entry}/cmdline`, 'utf8').catch(
            () => ''
          );
          return args.split('\0').includes(`--user-data-dir=${profile}`)
            ? [Number(entry)]
            : [];
        })
    );
    return rows.flat();
  }
  if (process.platform !== 'darwin') {
    throw new Error('The browser process oracle supports Linux and macOS.');
  }
  const { stdout } = await execute('ps', ['-axo', 'pid=,command='], {
    timeout: 5000,
    maxBuffer: 4 * 1024 ** 2,
  });
  return browserPidsForProfile(stdout, profile);
}

// Engine/CLI signal handlers can force process.exit before our finally runs.
// The QA scope owns signals, and Playwright owns a bounded browser launch.
export async function launchQaBrowser(options) {
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(options.userDataDir, {
    args: options.args,
    channel: options.channel,
    headless: options.headless,
    slowMo: options.slowMo,
    timeout: 30_000,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
  return {
    browser: context,
    page: context.pages()[0] || (await context.newPage()),
  };
}

export async function acquireQaBrowser(
  scope,
  launch,
  { signal, temporaryRoot } = {}
) {
  signal?.throwIfAborted();
  // A failed browser close leaves an external producer that can still write
  // here. Keep its exact profile outside an enclosing runner's disposable root.
  const profile = await qaRecoveryDirectory(scope, 'vac-audit-profile-', {
    environment: temporaryRoot
      ? { ...process.env, VAC_QA_RECOVERY_DIRECTORY: temporaryRoot }
      : process.env,
  });
  const resource = {};
  let commander;
  let trace;
  const close = onceQaCleanup(async () => {
    const failures = [];
    for (const [name, action] of [
      ['trace', () => trace?.stop()],
      ['commander', () => commander?.destroy()],
      ['browser', () => resource.browser?.close()],
    ]) {
      try {
        await action();
      } catch {
        failures.push(name);
      }
    }
    // A browser that did not close may still be writing into its profile.
    if (!failures.includes('browser')) {
      try {
        await rm(profile, { recursive: true, force: true });
        const exists = await access(profile).then(
          () => true,
          () => false
        );
        if (exists) {
          failures.push('profile verification');
        }
      } catch {
        failures.push('profile');
      }
    }
    if (failures.length) {
      throw new Error(`QA browser cleanup failed: ${failures.join(', ')}`);
    }
  });
  try {
    scope.defer('audit browser and profile', close);
  } catch (error) {
    await close();
    throw error;
  }
  const launched = await launch(profile);
  resource.browser = launched.browser;
  signal?.throwIfAborted();
  return {
    ...launched,
    profile,
    close,
    setCommander: (value) => {
      commander = value;
    },
    setTrace: (value) => {
      trace = value;
    },
  };
}
