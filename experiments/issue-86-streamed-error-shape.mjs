// What a command-stream failure carries when a command is streamed
// (mirror only) and when it is streamed and captured (mirror + capture, a
// tee). With `{ capture: false, mirror: true }` the rejection has no stdout
// or stderr, so a deploy summary can only say "Command failed with exit
// code 1"; with capture on it keeps Docker's "pull access denied" line.
//
// Run: node experiments/issue-86-streamed-error-shape.mjs
import { $, shell } from 'command-stream';

shell.errexit(true);

for (const options of [
  { capture: false, mirror: true },
  { capture: true, mirror: false },
  { capture: true, mirror: true },
]) {
  const run = $(options);
  try {
    await run`sh -c ${'echo out-line; echo "pull access denied for vac-local" >&2; exit 1'}`;
  } catch (error) {
    console.log(JSON.stringify(options), {
      exitCode: error.exitCode,
      message: error.message,
      stderr: error.stderr,
      stdout: error.stdout,
    });
  }
}
