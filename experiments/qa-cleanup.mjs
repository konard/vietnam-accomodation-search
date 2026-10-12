// QA-only resource ownership. Every disposer is attempted, even if another
// fails. Callers must stop producers before message/resource deletion.
import { mkdir, mkdtemp, rm, rmdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

// A grouped teardown can be reached by both an action's finally block and
// its outer scope. Never repeat side effects after its producer has stopped.
export function onceQaCleanup(action) {
  let result;
  return () => (result ||= Promise.resolve().then(action));
}

export class QaCleanup {
  #actions = [];
  #closing;
  #started = false;
  #cleanupFailed = false;
  constructor({ timeoutMs = 10_000 } = {}) {
    this.timeoutMs = timeoutMs;
  }

  get cleanupFailed() {
    return this.#cleanupFailed;
  }

  defer(name, action) {
    if (this.#started) {
      throw new Error('Cannot register resources after cleanup starts.');
    }
    this.#actions.push({ name, action });
  }

  close() {
    if (!this.#closing) {
      this.#started = true;
      this.#closing = this.#dispose();
    }
    return this.#closing;
  }

  async #dispose() {
    const failures = [];
    for (const { name, action } of this.#actions.reverse()) {
      let timer;
      try {
        await Promise.race([
          Promise.resolve().then(action),
          new Promise((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error('QA disposer timed out.')),
              this.timeoutMs
            );
          }),
        ]);
      } catch {
        this.#cleanupFailed = true;
        // Never expose credential-bearing SDK errors in a public report.
        failures.push(name);
      } finally {
        clearTimeout(timer);
      }
    }
    return { pass: failures.length === 0, failures };
  }
}

export async function withQaCleanup(
  action,
  { signals = true, cleanupTimeoutMs = 10_000 } = {}
) {
  const scope = new QaCleanup({ timeoutMs: cleanupTimeoutMs });
  const controller = new AbortController();
  const handlers = new Map();
  if (signals) {
    for (const name of ['SIGINT', 'SIGTERM']) {
      const handler = () => {
        const error = new Error(`QA interrupted by ${name}.`);
        controller.abort(error);
      };
      handlers.set(name, handler);
      process.once(name, handler);
    }
  }
  let value;
  let failure;
  try {
    // Let the cancelled action quiesce before disposal. Racing the action
    // against the signal allowed late acquisitions and sends after cleanup.
    // Actions must propagate this signal and bound external operations.
    value = await action(scope, controller.signal);
    controller.signal.throwIfAborted();
  } catch (error) {
    failure = error;
  } finally {
    const cleanup = await scope.close();
    for (const [name, handler] of handlers) {
      process.removeListener(name, handler);
    }
    if (!cleanup.pass) {
      failure = new AggregateError(
        failure ? [failure] : [],
        `QA cleanup failed: ${cleanup.failures.join(', ')}`
      );
    }
  }
  if (failure) {
    throw failure;
  }
  return value;
}

export async function qaTemporaryDirectory(scope, prefix = 'vac-qa-') {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    scope.defer('temporary directory', () =>
      rm(directory, { force: true, recursive: true })
    );
  } catch (error) {
    // SIGTERM can arrive while asynchronous acquisition is completing.
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
  return directory;
}

function recoveryParent(environment) {
  return (
    environment.VAC_QA_RECOVERY_DIRECTORY ||
    join(homedir(), '.cache', 'vietnam-accomodation-search', 'qa-recovery')
  );
}

// Recovery journals must outlive every enclosing disposable TMPDIR. The
// outer runner owns a namespace; nested runners inherit it without deleting it.
export async function qaRecoveryNamespace(scope, environment = process.env) {
  const parent = recoveryParent(environment);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  if (environment.VAC_QA_RECOVERY_DIRECTORY) {
    return parent;
  }
  const directory = await mkdtemp(join(parent, 'vac-suite-recovery-'));
  try {
    scope.defer('recovery namespace', async () => {
      try {
        // Never recursively delete a namespace: interrupted children can leave
        // exact journals even without finishing their retention callback.
        await rmdir(directory);
      } catch (error) {
        if (!['ENOTEMPTY', 'EEXIST'].includes(error.code)) {
          throw error;
        }
      }
    });
  } catch (error) {
    await rmdir(directory);
    throw error;
  }
  return directory;
}

// Use only for explicitly owned external-resource evidence. Ordinary runtime
// data still belongs in qaTemporaryDirectory and always gets removed.
export async function qaRecoveryDirectory(
  scope,
  prefix = 'vac-recovery-',
  { retain = () => scope.cleanupFailed, environment = process.env } = {}
) {
  if (!/^[a-zA-Z0-9_-]+$/u.test(prefix)) {
    throw new Error('A recovery directory prefix must be a basename.');
  }
  const parent = recoveryParent(environment);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(parent, prefix));
  try {
    scope.defer('protected recovery directory', async () => {
      if (!retain()) {
        await rm(directory, { recursive: true, force: true });
      }
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return directory;
}
