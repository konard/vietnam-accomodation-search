// Self-authored real SDK error shape: no credentials, network or source data.
import assert from 'node:assert/strict';
import { FloodWaitError } from 'teleproto/errors/RPCErrorList.js';
import { safeAcceptanceFailure } from './qa-acceptance-diagnostics.mjs';

const error = new FloodWaitError({
  capture: '600',
  request: { className: 'contacts.ResolveUsername' },
});
const direct = safeAcceptanceFailure(error, 'source-resolution');
const nested = safeAcceptanceFailure(
  new Error('Self-authored bounded retry exhaustion', { cause: error }),
  'source-resolution'
);
const recognized = (summary) =>
  summary.category === 'rate-limited' && summary.code === 'FLOOD_WAIT';
const pass = recognized(direct) && recognized(nested.causes?.[0]);
assert.equal(error.code, 420);
assert(!JSON.stringify({ direct, nested }).includes('600'));
console.log(
  JSON.stringify({
    selfAuthoredOnly: true,
    actualSdkErrorShape: true,
    sourceDataAndCredentialsUnused: true,
    direct,
    nested,
    pass,
  })
);
assert(pass, 'Known SDK flood waits must retain finite rate-limit metadata.');
