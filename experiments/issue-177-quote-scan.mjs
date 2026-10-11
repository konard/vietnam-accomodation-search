#!/usr/bin/env node
// Finite, memory-limited reproduction of quadratic rent-line classification.
import { performance } from 'node:perf_hooks';
import { URL } from 'node:url';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import { quoteBasis } from '../src/value-pricing.js';

if (!isMainThread) {
  parentPort.postMessage(quoteBasis('0'.repeat(131072)));
} else {
  const started = performance.now();
  const worker = new Worker(new URL(import.meta.url), {
    resourceLimits: { maxOldGenerationSizeMb: 32, stackSizeMb: 2 },
  });
  let timer;
  try {
    const basis = await new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      timer = setTimeout(
        () => reject(new Error('Quote scan exceeded its five-second budget.')),
        5000
      );
    });
    if (basis !== 'property') {
      throw new Error('Digit-only input incorrectly establishes a unit quote.');
    }
    console.log(
      JSON.stringify({ pass: true, elapsedMs: performance.now() - started })
    );
  } catch (error) {
    console.log(JSON.stringify({ pass: false, reason: error.message }));
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}
