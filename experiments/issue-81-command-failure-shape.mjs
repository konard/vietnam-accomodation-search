// Shows what a failing command-stream command produces, so the deploy CLI
// can print one line for it (#81). Run: node experiments/issue-81-command-failure-shape.mjs
import { loadCommandStream } from '../scripts/use-module.mjs';

const { $ } = await loadCommandStream();
const run = $({ capture: true, mirror: false });
try {
  const result =
    await run`sh -c ${'echo "Error response from daemon: pull access denied" >&2; exit 1'}`;
  console.log('resolved', {
    code: result.code,
    keys: Object.keys(result),
    stderr: result.stderr,
  });
} catch (error) {
  console.log('rejected', {
    code: error.code,
    keys: Object.keys(error),
    message: error.message,
  });
}
