// QA-only resource ownership. Every disposer is attempted, even if another
// fails. Callers must stop producers before message/resource deletion.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class QaCleanup {
  #actions = [];
  #closing;
  #started = false;
  constructor({ timeoutMs = 10_000 } = {}) {
    this.timeoutMs = timeoutMs;
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
