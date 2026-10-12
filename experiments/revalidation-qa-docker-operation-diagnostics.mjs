// Sanitized real daemon failure grammar; no Docker/network/resources acquired.
import assert from 'node:assert/strict';
import {
  annotateDockerFailure,
  safeQaFailure,
} from './qa-docker-diagnostics.mjs';

const failure = (args) => {
  const error = Object.assign(new Error('Controlled command failure'), {
    code: 1,
    killed: false,
    stderr: 'Error response from daemon: lease does not exist: not found\n',
  });
  return safeQaFailure(annotateDockerFailure(error, args));
};

assert.equal(
  failure(['inspect', 'self-authored-fixture']).operation,
  'inspect'
);
const actual = failure(['pull', 'busybox:1.37.0']);
console.log(
  JSON.stringify({ mode: 'sanitized-daemon-operation-probe', actual })
);
assert.equal(
  actual.operation,
  'pull',
  'Known Docker acquisition operation must survive finite privacy sanitization.'
);
