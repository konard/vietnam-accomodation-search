// Self-authored control for the observed original-host cutover preflight.
// No Docker, Telegram, credentials or external writes.
import assert from 'node:assert/strict';
import { assertQaSharedTokenBoundary } from './deploy-cutover-drill-lib.mjs';

const options = { allowSharedToken: true };
assertQaSharedTokenBoundary(options, { containers: [] });
let helperMistakenForPreexistingContainer = false;
try {
  // The guard's owned helper is present in the post-acquisition baseline.
  assertQaSharedTokenBoundary(options, {
    containers: ['self-authored-run-owned-capacity-helper'],
  });
} catch (error) {
  assert.equal(
    error.message,
    'QA shared-token override requires an empty container inventory.'
  );
  helperMistakenForPreexistingContainer = true;
}
console.log(
  JSON.stringify({
    selfAuthoredOnly: true,
    helperMistakenForPreexistingContainer,
  })
);
assert.equal(
  helperMistakenForPreexistingContainer,
  false,
  'Run-owned capacity acquisition must not invalidate the independent pre-acquisition poller boundary.'
);
