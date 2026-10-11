// Finite self-authored control: a slow historical tail must not hide a
// received current offer indefinitely. No credentials or public writes.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { LinksStore, TelegramIngestionService } from '../src/index.js';
import { qaTemporaryDirectory, withQaCleanup } from './qa-cleanup.mjs';

await withQaCleanup(async (scope, signal) => {
  const directory = await qaTemporaryDirectory(scope, 'vac-native-progress-');
  const store = new LinksStore({ directory, binaryMirror: false });
  const source = { id: 'telegram:qa_progress', focus: 'nha-trang' };
  let releaseTail;
  let firstPage;
  const tail = new Promise((resolve) => {
    releaseTail = resolve;
  });
  const received = new Promise((resolve) => {
    firstPage = resolve;
  });
  const provider = {
    async *history() {
      yield {
        id: 1,
        sourceId: source.id,
        date: new Date().toISOString(),
        text: 'Apartment for rent in Nha Trang: 12 million VND/month. 2 bedrooms, 3 rooms, 4 beds.',
      };
      firstPage();
      await tail;
    },
    liveUpdates: () => Promise.resolve({ stop() {} }),
    destroy: () => Promise.resolve(),
  };
  const ingestion = new TelegramIngestionService({ store, provider });
  scope.defer('ingestion', () => ingestion.destroy());
  scope.defer('historical tail', () => releaseTail());
  const started = ingestion.start([source], { signal });
  try {
    await received;
    await delay(30);
    const latestVisibleDuringHistory = (await store.listOffers()).length > 0;
    releaseTail();
    await started;
    const positiveControl = (await store.listOffers()).length === 1;
    console.log(
      JSON.stringify({
        firstPageReceived: true,
        latestVisibleDuringHistory,
        positiveControl,
        pass: positiveControl && latestVisibleDuringHistory,
      })
    );
    assert(positiveControl, 'The completed-history extraction must work.');
    assert(
      latestVisibleDuringHistory,
      'Latest offers remain invisible until the entire historical tail ends.'
    );
  } finally {
    releaseTail();
    await started.catch(() => {});
  }
});
