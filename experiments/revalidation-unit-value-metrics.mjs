import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCorpus, fieldMetrics } from './field-corpus-metrics.mjs';
import { auditReplay } from './audit-search-service.mjs';

const unit = await loadCorpus(
  new globalThis.URL('./fixtures/unit-value-corpus.json', import.meta.url)
);
const live = await loadCorpus();
const directory = await mkdtemp(join(tmpdir(), 'qa-value-corpus-'));
try {
  const report = {
    observedAt: new Date().toISOString(),
    legacyTruthMigration:
      'Legacy expected.rooms was bedroom truth. Values preserved as expected.bedrooms; live rooms and beds remain not evaluated.',
    reviewedLiveParser: await fieldMetrics(live),
    reviewedLiveStored: (
      await auditReplay({ corpus: live, directory: join(directory, 'live') })
    ).metrics,
    selfAuthoredParser: await fieldMetrics(unit),
    selfAuthoredStored: (
      await auditReplay({ corpus: unit, directory: join(directory, 'unit') })
    ).metrics,
  };
  for (const value of [
    report.reviewedLiveParser,
    report.reviewedLiveStored,
    report.selfAuthoredParser,
    report.selfAuthoredStored,
  ]) {
    assert(value.pass, JSON.stringify(value.misses));
  }
  console.log(JSON.stringify(report, null, 2));
  if (process.argv[2]) {
    await writeFile(process.argv[2], `${JSON.stringify(report, null, 2)}\n`);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
