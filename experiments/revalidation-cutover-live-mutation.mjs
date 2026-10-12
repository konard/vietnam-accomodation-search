// Self-authored live-state preservation control; no network or Docker.
import assert from 'node:assert/strict';
import { LinksStore } from '../src/links-store.js';
import {
  compareFingerprints,
  stateFingerprint,
  transitionFailures,
} from './deploy-cutover-drill-lib.mjs';
import { qaTemporaryDirectory, withQaCleanup } from './qa-cleanup.mjs';

await withQaCleanup(async (scope) => {
  const directory = await qaTemporaryDirectory(scope, 'vac-live-mutation-');
  const store = new LinksStore({ directory });
  const preserved = { id: 'qa-existing-trace', event: 'existing' };
  await store.saveRecords('traces', [preserved]);
  const before = await stateFingerprint(directory);
  await store.saveRecords('traces', [
    preserved,
    { id: 'qa-normal-incoming-update', event: 'received' },
  ]);
  assert.deepEqual((await store.loadRecords('traces'))[0], preserved);
  const comparison = compareFingerprints(
    before,
    await stateFingerprint(directory)
  );
  const failures = transitionFailures({
    comparison,
    exitCode: 0,
    markers: { lost: 0, duplicated: 0 },
    pollers: { maxRunning: 1, zeroRunningSamples: 0 },
  });
  console.log(
    JSON.stringify({
      selfAuthoredOnly: true,
      existingRecordsPreserved: true,
      legitimateIncomingRecordAdded: true,
      liveTransitionRejected: failures.length > 0,
    })
  );
  assert.deepEqual(
    failures,
    [],
    'Live cutover must distinguish legitimate additive activity from lost or altered protected records.'
  );
});
