// Deadline includes application startup and the next Docker health probe.
// Injected elapsed time keeps the realistic 40s/60s startup drill deterministic.
export async function waitForReadiness({
  inspect,
  now = () => globalThis.performance.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutSeconds = 300,
}) {
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new RangeError(
      '--ready-timeout must be a positive number of seconds.'
    );
  }
  const started = now();
  const timeoutMs = timeoutSeconds * 1000;
  while (now() - started < timeoutMs) {
    const status = await inspect();
    if (status === 'healthy') {
      return { elapsedMs: now() - started };
    }
    if (['unhealthy', 'exited', 'dead'].includes(status)) {
      throw new Error(
        `Candidate became ${status} while waiting for readiness.`
      );
    }
    await sleep(Math.min(1000, Math.max(0, timeoutMs - (now() - started))));
  }
  throw new Error(
    `Candidate did not become ready before the ${timeoutSeconds}s deployment deadline.`
  );
}
