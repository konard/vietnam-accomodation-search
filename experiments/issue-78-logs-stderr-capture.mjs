// Does a command-stream template with a literal `2>&1` capture the child's
// stderr? The deploy settle window reads `docker logs` this way, and the
// runtime writes the polling-conflict line to stderr.
import { loadCommandStream } from '../scripts/use-module.mjs';

const { $ } = await loadCommandStream();
const run = $({ capture: true, mirror: false });
const script = "console.log('out'); console.error('telegram polling conflict')";
const result = await run`node -e ${script} 2>&1`;
console.log(JSON.stringify({ stderr: result.stderr, stdout: result.stdout }));
