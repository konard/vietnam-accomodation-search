// Finite, self-authored descendant that holds inherited stdout open. The
// parent reaps it on SIGTERM; a watchdog limits even a broken test runner.
import { spawn } from 'node:child_process';
const child = spawn(
  process.execPath,
  ['-e', 'setTimeout(() => process.exit(0), 10000)'],
  { stdio: 'inherit' }
);
const closed = new Promise((resolve) => child.once('close', resolve));
const stop = async () => {
  child.kill('SIGTERM');
  await closed;
  process.exit(0);
};
process.once('SIGTERM', () => {
  void stop();
});
const watchdog = setTimeout(() => {
  void stop();
}, 10_000);
console.log(JSON.stringify({ childPid: child.pid }));
await closed;
clearTimeout(watchdog);
