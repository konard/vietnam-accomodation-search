// Runs a failing command through the tracked command-stream `$` the deploy
// helper uses and prints the one-line summary and the private log entry.
import {
  describeDeployFailure,
  trackCommands,
} from '../scripts/deploy-guards.mjs';
import { loadCommandStream } from '../scripts/use-module.mjs';

const { $ } = await loadCommandStream();
const progress = { step: 'pulling the image' };
const run = trackCommands($, progress);
const capture = run({ capture: true, mirror: false });
const merged = await capture`sh -c ${'echo out; echo err >&2'} 2>&1`;
console.log('2>&1 stdout:', JSON.stringify(await merged.text()));
try {
  await capture`sh -c ${'echo "Error response from daemon: pull access denied" >&2; exit 1'}`;
} catch (error) {
  const { detail, summary } = describeDeployFailure(error, progress);
  console.log(summary);
  console.log(
    'detail bytes:',
    JSON.stringify(detail).length,
    'raw error keys:',
    Object.keys(error)
  );
  console.log(JSON.stringify(detail, null, 2));
}
