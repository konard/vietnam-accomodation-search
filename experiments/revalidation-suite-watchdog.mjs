// Finite parent watchdog contains a deliberately escaped timer in its child.
import { runCleanTests } from '../scripts/test-with-cleanup.mjs';
if (process.argv.includes('--child')) {
  console.log('synthetic test started');
  globalThis.setInterval(() => {}, 1000);
} else {
  process.exitCode = await runCleanTests(
    [process.execPath, import.meta.filename, '--child'],
    { idleTimeoutMs: 200, terminateGraceMs: 200 }
  );
}
