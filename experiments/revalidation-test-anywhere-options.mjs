#!/usr/bin/env node

// Node diagnostic for the options overload recommended by setDefaultTimeout.
// Emits native TAP as well as aggregate JSON; exits 1 if a body is skipped.
import { test } from 'test-anywhere';

let controlCalls = 0;
let optionsCalls = 0;
await test('self-authored two-argument control', () => {
  controlCalls += 1;
});
await test(
  'self-authored recommended timeout overload',
  { timeout: 100 },
  () => {
    optionsCalls += 1;
  }
);
const result = {
  mode: 'self-authored-node-diagnostic',
  controlCalls,
  optionsCalls,
  pass: controlCalls === 1 && optionsCalls === 1,
};
console.log(JSON.stringify(result));
process.exitCode = result.pass ? 0 : 1;
