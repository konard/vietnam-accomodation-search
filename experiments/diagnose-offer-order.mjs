#!/usr/bin/env node

// Local, synthetic regression probe for indexed offer insertion order.
// No credentials or real accommodation records are read.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LinksStore } from '../src/index.js';

const directory = await mkdtemp(join(tmpdir(), 'vac-offer-order-'));
try {
  const input = Array.from({ length: 60 }, (_, index) => ({
    id: `offer-${index}`,
    title: `Synthetic ${index}`,
  }));
  const store = new LinksStore({ directory });
  await store.saveRecords('offers', input);
  const output = await store.loadRecords('offers');
  const firstMismatch = input.findIndex(
    (offer, index) => offer.id !== output[index]?.id
  );
  console.log(
    JSON.stringify({
      count: output.length,
      firstMismatch,
      inputAtMismatch: input[firstMismatch]?.id,
      outputAtMismatch: output[firstMismatch]?.id,
      sameOrder: firstMismatch === -1,
    })
  );
  if (firstMismatch !== -1) {
    process.exitCode = 1;
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
