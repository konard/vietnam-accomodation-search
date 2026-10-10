// Self-authored native ingestion control. Requires the actual Rust clink.
// Deliberately exits nonzero if graph loss is reported as complete history.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LinksStore, TelegramIngestionService } from '../src/index.js';

async function probe(maxEvents) {
  const directory = await mkdtemp(join(tmpdir(), 'vac-native-graph-e2e-'));
  const store = new LinksStore({ directory, binaryMirror: true });
  const source = { id: 'telegram:qa_fixture' };
  const messages = [1, 2].map((id) => ({
    id,
    sourceId: source.id,
    date: new Date().toISOString(),
    text: 'Self-authored unrelated QA control',
  }));
  const provider = {
    async *history() {
      yield* messages;
    },
    liveUpdates: () => Promise.resolve({ stop() {} }),
    destroy: () => Promise.resolve(),
  };
  const service = new TelegramIngestionService({ store, provider, maxEvents });
  try {
    await service.start([source]);
    const fresh = new LinksStore({ directory, binaryMirror: true });
    const graph = await fresh.loadRecords('domain-records');
    const entities = new Set(
      graph
        .filter((item) => item.type !== 'semantic-link')
        .map((item) => item.id)
    );
    const danglingSubjects = graph.filter(
      (item) => item.type === 'semantic-link' && !entities.has(item.subject)
    );
    const danglingEvents = graph.filter(
      (item) =>
        item.predicate === 'raw-material.eventId' && !entities.has(item.object)
    );
    const [checkpoint] = await fresh.loadRecords(
      'telegram-ingestion-checkpoints'
    );
    return {
      maxEvents,
      events: (await fresh.loadRecords('telegram-events')).length,
      records: graph.length,
      danglingSubjects: danglingSubjects.length,
      danglingEvents: danglingEvents.length,
      complete: checkpoint.complete,
      state: checkpoint.state,
      pass:
        (!danglingSubjects.length && !danglingEvents.length) ||
        !checkpoint.complete,
    };
  } finally {
    await service.destroy();
    await rm(directory, { recursive: true, force: true });
  }
}

const control = await probe(100);
assert(
  control.complete && control.pass,
  'Unbounded control must retain a complete graph.'
);
const bounded = await probe(2);
assert.equal(bounded.events, 2, 'No raw event was evicted in this control.');
console.log(JSON.stringify({ control, bounded, pass: bounded.pass }));
assert(
  bounded.pass,
  'Graph eviction must not silently tear references while reporting complete.'
);
