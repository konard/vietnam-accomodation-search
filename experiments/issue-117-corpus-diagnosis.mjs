import { fieldMetrics, loadCorpus } from './field-corpus-metrics.mjs';

const corpus = await loadCorpus();
const report = await fieldMetrics(corpus);
for (const miss of report.misses) {
  console.log(
    JSON.stringify({
      miss,
      text: corpus.cases.find((sample) => sample.id === miss.id)?.input.text,
    })
  );
}
console.log(JSON.stringify(report.fields));
process.exitCode = report.pass && !report.misses.length ? 0 : 1;
