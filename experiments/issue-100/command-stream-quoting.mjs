// Checks that command-stream quotes an interpolated commit message safely.
import { $ } from 'command-stream';

const message = `v1.0.0 "q" $(echo pwned) \`id\` \\ 's`;
const result = await $`printf %s ${message}`.run({
  capture: true,
  mirror: false,
});
console.log(JSON.stringify(message));
console.log(typeof result.stdout, JSON.stringify(String(result.stdout)));
console.log(String(result.stdout) === message ? 'SAFE' : 'MISMATCH');
