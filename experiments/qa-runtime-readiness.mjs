// A failed startup must win over readiness polling; all timers are bounded.
export async function waitForRuntimeReadiness({
  runtime,
  running,
  timeoutMs = 5000,
  signal,
}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('A finite readiness deadline is required.');
  }
  let settled = false;
  let startupError;
  const joined = Promise.resolve(running).then(
    () => {
      settled = true;
    },
    (error) => {
      settled = true;
      startupError = error;
    }
  );
  const controller = new AbortController();
  const interrupt = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', interrupt, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error('Runtime readiness deadline expired.')),
    timeoutMs
  );
  try {
    while (true) {
      signal?.throwIfAborted();
      controller.signal.throwIfAborted();
      const current = runtime();
      if (current?.health().status === 'ready') {
        return current;
      }
      if (settled) {
        throw startupError || new Error('Runtime exited before readiness.');
      }
      await new Promise((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(poll);
          reject(controller.signal.reason);
        };
        const poll = setTimeout(() => {
          controller.signal.removeEventListener('abort', onAbort);
          resolve();
        }, 10);
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', interrupt);
    // joined consumes startup rejection without turning it into unhandled work.
    if (settled) {
      await joined;
    }
  }
}
