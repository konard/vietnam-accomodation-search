import { it as baseIt } from 'test-anywhere';

// Deno ends a test as soon as only unreferenced timers are pending, and the
// source timeout, search budget, and scheduler waits are unreferenced so they
// never keep the CLI alive. A referenced timer keeps the event loop running
// until the test settles, as the Node and Bun runners already do.
export function it(name, test) {
  return baseIt(name, async () => {
    const timer = globalThis.setInterval(() => {}, 1_000);
    try {
      await test();
    } finally {
      globalThis.clearInterval(timer);
    }
  });
}
