#!/usr/bin/env node

// Resume a private audit and retain only safe failure metadata. Raw reports
// stay in the ignored state directory; no post, source, identity, or secret
// is printed. This experiment is manual/local-only and must never run in CI.
//
// Usage:
//   VAC_AUDIT_USER_ENV=PATH VAC_AUDIT_BOT_ENV=PATH \
//     node experiments/diagnose-telegram-audit.mjs STATE_DIRECTORY

import { appendFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { runAudit } from './audit-telegram-accommodations.mjs';
import { assertManualLocalRun } from './telegram-accommodation-audit-lib.mjs';
import { createAuditDiagnostics, timerWarning } from './audit-diagnostics.mjs';

assertManualLocalRun(process.env);
if (!process.argv[2] || !process.env.VAC_AUDIT_USER_ENV) {
  throw new TypeError('Pass a private state directory and VAC_AUDIT_USER_ENV.');
}

const stateDirectory = resolve(process.argv[2]);
const metricsPath = join(
  stateDirectory,
  `resource-diagnostic-${Date.now()}.jsonl`
);
const emit = (event) =>
  appendFile(metricsPath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
const diagnostics = createAuditDiagnostics({
  directory: stateDirectory,
  emit,
  ...(process.env.VAC_AUDIT_MIN_FREE_BYTES
    ? { minFreeBytes: Number(process.env.VAC_AUDIT_MIN_FREE_BYTES) }
    : {}),
  ...(process.env.VAC_AUDIT_MAX_ALLOCATED_BYTES
    ? { maxAllocatedBytes: Number(process.env.VAC_AUDIT_MAX_ALLOCATED_BYTES) }
    : {}),
});
let warningWrite = Promise.resolve();
let warningCount = 0;
const onWarning = (warning) => {
  const event = timerWarning(warning);
  if (event) {
    warningCount += 1;
    if (warningCount <= 10) {
      warningWrite = warningWrite.then(() => emit(event)).catch(() => {});
    }
  }
};
process.on('warning', onWarning);
let sampling;
const monitor = globalThis.setInterval(() => {
  sampling ||= diagnostics
    .sample()
    .catch(() => {})
    .finally(() => {
      sampling = undefined;
    });
}, 5_000);
const options = {
  measurePhase: diagnostics.measure,
  botEnv: process.env.VAC_AUDIT_BOT_ENV,
  folder: 'Нячанг жильё',
  maxMessages: 3_000,
  maxSources: 40,
  months: 2,
  redactedExcerpts: false,
  stateDirectory,
  tesseractCommand: process.env.VAC_AUDIT_TESSERACT || 'tesseract',
  userEnv: process.env.VAC_AUDIT_USER_ENV,
};

function safeFrame(line) {
  const match = line.match(/([\w./-]+\.(?:m?js|ts)):(\d+):(\d+)/u);
  return match ? `${basename(match[1])}:${match[2]}:${match[3]}` : undefined;
}

function category(message) {
  if (/maximum call stack size exceeded/iu.test(message)) {
    return 'call-stack-limit';
  }
  if (/invalid array length/iu.test(message)) {
    return 'array-length';
  }
  if (/invalid string length/iu.test(message)) {
    return 'string-length';
  }
  if (/out of range|outside.*range/iu.test(message)) {
    return 'out-of-range';
  }
  return 'other';
}

try {
  const report = await runAudit(options);
  await writeFile(
    join(stateDirectory, `report-${Date.now()}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 }
  );
  console.log(
    JSON.stringify({
      acceptance: report.acceptance?.pass,
      selectedSources: report.discovery?.selectedSources,
      sourceCount: report.sources?.length,
    })
  );
} catch (error) {
  const diagnostic = {
    category: category(String(error?.message || '')),
    code: typeof error?.code === 'string' ? error.code : undefined,
    frames: String(error?.stack || '')
      .split('\n')
      .slice(1, 6)
      .map(safeFrame)
      .filter(Boolean),
    type: error?.constructor?.name || 'Error',
  };
  await writeFile(
    join(stateDirectory, `failure-diagnostic-${Date.now()}.json`),
    `${JSON.stringify(diagnostic)}\n`,
    { mode: 0o600 }
  );
  console.error(JSON.stringify(diagnostic));
  process.exitCode = 1;
} finally {
  globalThis.clearInterval(monitor);
  process.off('warning', onWarning);
  await sampling;
  await diagnostics.sample().catch(() => {});
  await warningWrite;
  await emit({ type: 'negative-timer-summary', count: warningCount });
}
