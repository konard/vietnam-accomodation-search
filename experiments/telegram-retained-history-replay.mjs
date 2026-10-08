// Manual local checksum/window/full-parser replay of retained private history.
// Public output has no source identities, raw messages, contacts or images.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  analyzeHistoryMessages,
  retainedMessages,
} from './telegram-90-day-coverage-audit.mjs';
import { assertManualLocalRun } from './telegram-accommodation-audit-lib.mjs';

function options(values) {
  const result = { baselines: [], deltas: [] };
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    assert(value, 'Every replay flag needs a value.');
    if (flag === '--baseline-directory') {
      result.baselines.push(value);
    } else if (flag === '--delta-directory') {
      result.deltas.push(value);
    } else if (flag === '--output') {
      result.output = value;
    } else {
      throw new TypeError('Unknown replay flag.');
    }
  }
  assert(result.baselines.length && result.deltas.length && result.output);
  return result;
}

async function report(directory) {
  const value = JSON.parse(await readFile(join(directory, 'report.json')));
  assert(value.complete, 'Partial histories cannot pass replay.');
  return { directory, value };
}

async function phaseMessages(phase, index) {
  const path = join(
    phase.directory,
    `source-${String(index + 1).padStart(2, '0')}`
  );
  const checkpoint = JSON.parse(await readFile(join(path, 'checkpoint.json')));
  assert(checkpoint.complete);
  assert.equal(checkpoint.cutoff, phase.value.cohort.cutoff);
  assert.equal(checkpoint.startedAt, phase.value.cohort.startedAt);
  const messages = await retainedMessages(path, checkpoint.pages);
  assert.equal(messages.length, checkpoint.messages);
  assert(
    messages.every(
      (message) =>
        message.date >= checkpoint.cutoff &&
        message.date <= checkpoint.startedAt
    )
  );
  return messages;
}

async function sourceReplay(
  source,
  baseline,
  baselineIndex,
  deltas,
  ordinal,
  through
) {
  const all = [];
  const ids = new Set();
  for (const [phase, index] of [
    [baseline, baselineIndex],
    ...deltas.map((delta) => [delta, ordinal]),
  ]) {
    assert.equal(phase.value.cohort.sources[index].username, source.username);
    for (const message of await phaseMessages(phase, index)) {
      assert(
        !ids.has(message.id),
        'Frozen windows must not double-count messages.'
      );
      ids.add(message.id);
      all.push(message);
    }
  }
  const { counts } = analyzeHistoryMessages(all, {
    username: source.username,
    now: new Date(through),
    ...(source.geographicFocus
      ? { targetLocation: source.focus === 'nha-trang' ? 'nha-trang' : null }
      : {}),
  });
  assert.equal(counts.accountedMessages, counts.messages);
  assert.equal(counts.parserErrors, 0);
  return counts;
}

async function run(paths) {
  assertManualLocalRun(process.env);
  const baselines = await Promise.all(paths.baselines.map(report));
  const deltas = await Promise.all(paths.deltas.map(report));
  const endpoint = baselines[0].value.cohort;
  for (const baseline of baselines) {
    assert.equal(baseline.value.cohort.cutoff, endpoint.cutoff);
    assert.equal(baseline.value.cohort.startedAt, endpoint.startedAt);
  }
  let previous = endpoint.startedAt;
  for (const delta of deltas) {
    assert.equal(delta.value.cohort.cutoff, previous);
    previous = delta.value.cohort.startedAt;
  }
  assert((Date.parse(previous) - Date.parse(endpoint.cutoff)) / 86400000 >= 90);
  const result = {
    sources: 0,
    messages: 0,
    materials: 0,
    parserErrors: 0,
    accountedMessages: 0,
    photoOnlyUnresolved: 0,
    productionOffers: 0,
    historicalTextOffers: 0,
    ageGateRejections: 0,
    cutoff: endpoint.cutoff,
    through: previous,
    pass: false,
  };
  for (const baseline of baselines) {
    for (const [index, source] of baseline.value.cohort.sources.entries()) {
      const counts = await sourceReplay(
        source,
        baseline,
        index,
        deltas,
        result.sources,
        previous
      );
      result.sources += 1;
      for (const field of [
        'messages',
        'materials',
        'parserErrors',
        'accountedMessages',
        'photoOnlyUnresolved',
        'productionOffers',
        'historicalTextOffers',
        'ageGateRejections',
      ]) {
        result[field] += counts[field];
      }
      process.stderr.write(
        `${JSON.stringify({
          stage: 'retained-source-replayed',
          ordinal: result.sources,
        })}\n`
      );
    }
  }
  result.pass = true;
  await writeFile(paths.output, `${JSON.stringify(result, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  console.log(JSON.stringify(result));
}

await run(options(process.argv.slice(2)));
