// Disposable audit profiles have a different lifetime from retained evidence.
import { access, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { onceQaCleanup } from './qa-cleanup.mjs';

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
  { signal, temporaryRoot = tmpdir() } = {}
) {
  signal?.throwIfAborted();
  const profile = await mkdtemp(join(temporaryRoot, 'vac-audit-profile-'));
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
