#!/usr/bin/env node
// Checks that offers read back from Links Notation equal their JSON shape,
// and times one parse of the collection the audit replay stores.
//   node experiments/issue-100-offer-roundtrip.mjs
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { deserializeOffers, serializeOffers } from '../src/index.js';
import { boundStoredOffer } from '../src/offer-bounds.js';
import { auditReplay } from './audit-search-service.mjs';
import { loadCorpus } from './field-corpus-metrics.mjs';

const directory = await mkdtemp(join(tmpdir(), 'vac-roundtrip-'));
try {
  await auditReplay({ corpus: await loadCorpus(), directory });
  const notation = await readFile(join(directory, 'offers.lino'), 'utf8');
  let started = globalThis.performance.now();
  const offers = deserializeOffers(notation);
  console.log('parse ms', Math.round(globalThis.performance.now() - started));
  const bounded = offers.map(boundStoredOffer);
  started = globalThis.performance.now();
  const again = deserializeOffers(serializeOffers(bounded));
  console.log(
    'roundtrip ms',
    Math.round(globalThis.performance.now() - started)
  );
  const json = JSON.parse(JSON.stringify(bounded));
  const differing = again.filter(
    (offer, i) => !isDeepStrictEqual(offer, json[i])
  );
  console.log(
    'offers',
    offers.length,
    'differing from JSON shape',
    differing.length
  );
} finally {
  await rm(directory, { force: true, recursive: true });
}
