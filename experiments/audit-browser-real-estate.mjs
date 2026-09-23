#!/usr/bin/env node

/**
 * Manual/local-only real-data E2E probe for public Vietnam property websites.
 *
 * This file intentionally is not an npm script and is not imported by the
 * unit/integration test suites or GitHub Actions. It stores privacy-redacted
 * diagnostics beneath a private temporary directory and never attempts to
 * solve or bypass a CAPTCHA.
 *
 * Example:
 *   node experiments/audit-browser-real-estate.mjs --max-sites 3
 */

import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import { launchBrowser, makeBrowserCommander } from 'browser-commander';
import { browserAdapterFor } from '../src/browser-adapters.js';
import { extractPageListings } from '../src/browser-collector.js';

import {
  assessSourceCoverage,
  assertManualLocalRun,
  classifyPage,
  createPrivateTraceWriter,
  DomainPacer,
  runDomainQueues,
  sanitizedUrl,
  segmentLedger,
  siteDomain,
  summarizeStructuredCards,
} from './browser-real-estate-audit-lib.mjs';

const DEFAULT_MANIFEST = fileURLToPath(
  new URL('./fixtures/vietnam-real-estate-sites.json', import.meta.url)
);
const TRACE_PRIVACY = {
  redactPatterns: [
    /\+?\d[\d\s().-]{7,20}\d/gu,
    /[\p{L}\d.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)+/gu,
    /(?<![\p{L}\p{N}.])@[A-Za-z][A-Za-z\d_]{4,31}/gu,
  ],
  redactQueryParams: ['q', 'query', 'keyword', 'search'],
};

function parseArguments(argv) {
  const values = {
    concurrency: 3,
    headed: false,
    manifest: DEFAULT_MANIFEST,
    maxDelayMs: 8_000,
    maxSites: Number.POSITIVE_INFINITY,
    minDelayMs: 3_000,
    navigationTimeoutMs: 60_000,
    siteIds: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--headed') {
      values.headed = true;
      continue;
    }
    if (name === '--site' && argv[index + 1] !== undefined) {
      values.siteIds.push(argv[index + 1]);
      index += 1;
      continue;
    }
    const key = {
      '--concurrency': 'concurrency',
      '--cooldown-state': 'cooldownState',
      '--manifest': 'manifest',
      '--max-delay-ms': 'maxDelayMs',
      '--max-sites': 'maxSites',
      '--min-delay-ms': 'minDelayMs',
      '--navigation-timeout-ms': 'navigationTimeoutMs',
      '--output-dir': 'outputDir',
    }[name];
    if (!key || argv[index + 1] === undefined) {
      throw new Error(`Unknown or incomplete argument: ${name}`);
    }
    const value = argv[index + 1];
    values[key] =
      key === 'cooldownState' || key === 'manifest' || key === 'outputDir'
        ? value
        : Number(value);
    index += 1;
  }
  return values;
}

function extractPageEvidence(fields = {}) {
  const documentRef = globalThis.document;
  const semantic = Object.fromEntries(
    Object.entries(fields)
      // eslint-disable-next-line complexity -- Browser evidence fields have explicit DOM fallbacks.
      .map(([field, selector]) => {
        const selected = documentRef.querySelector(selector);
        const value =
          selected?.innerText ||
          selected?.textContent ||
          selected?.content ||
          selected?.getAttribute?.('content') ||
          selected?.getAttribute?.('href') ||
          selected?.getAttribute?.('aria-label');
        return [field, typeof value === 'string' ? value.trim() : undefined];
      })
      .filter(([, value]) => value)
  );
  return {
    semantic,
    text: (documentRef.body?.innerText || '').slice(0, 200_000),
    title: documentRef.title || '',
    url: documentRef.location.href,
  };
}

function errorKind(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/iu.test(message)) {
    return 'navigation_timeout';
  }
  return 'unexpected_error';
}

function safeError(error) {
  return {
    kind: errorKind(error),
    messageHash: segmentLedger(
      error instanceof Error ? error.message : String(error)
    ).segments[0]?.hash,
  };
}

async function politeWait(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function startSiteTrace(commander, outputDirectory, site) {
  const path = join(outputDirectory, `${site.id}.bc-trace`);
  const linksPath = join(outputDirectory, `${site.id}.lino`);
  const trace = await commander.startTrace({
    links: { output: linksPath },
    mode: 'checkpoints',
    output: path,
    privacy: TRACE_PRIVACY,
    screenshots: 'checkpoints',
  });
  return { linksPath, path, trace };
}

// eslint-disable-next-line complexity, max-lines-per-function -- One site owns its complete browser/trace cleanup boundary.
async function auditSite({ options, pacer, site, writer }) {
  const domain = siteDomain(site);
  const delayMs = pacer.delayFor(domain);
  const startedAt = Date.now();
  await writer.write({
    delayMs,
    domain,
    siteId: site.id,
    stage: 'site.queued',
  });
  await politeWait(delayMs);
  await writer.write({
    domain,
    siteId: site.id,
    stage: 'browser.launch.started',
  });

  let browser;
  let commander;
  let runningTrace;
  let runError;
  let outcome = 'unexpected_error';
  const network = { failed: 0, statuses: {} };
  try {
    const launched = await launchBrowser({
      channel: 'chrome',
      engine: 'playwright',
      headless: !options.headed,
      slowMo: 150,
      userDataDir: join(options.outputDirectory, 'browser-profile', site.id),
    });
    browser = launched.browser;
    commander = makeBrowserCommander({ page: launched.page });
    launched.page.on('requestfailed', () => {
      network.failed += 1;
    });
    launched.page.on('response', (response) => {
      const status = String(response.status());
      network.statuses[status] = (network.statuses[status] || 0) + 1;
    });
    runningTrace = await startSiteTrace(
      commander,
      options.outputDirectory,
      site
    );
    await writer.write({
      domain,
      siteId: site.id,
      stage: 'navigation.started',
      url: sanitizedUrl(site.url),
    });
    await commander.goto({
      timeout: options.navigationTimeoutMs,
      url: site.url,
      waitUntil: 'domcontentloaded',
    });
    await runningTrace.trace.checkpoint('loaded', {
      actor: 'local-e2e',
      reason: 'post-navigation-evidence',
    });
    const adapter = browserAdapterFor(site.url);
    const cards = await commander.evaluate(
      extractPageListings,
      'web',
      adapter.selectors || {}
    );
    const evidence = await commander.evaluate(
      extractPageEvidence,
      adapter.selectors?.fields || {}
    );
    const summary = summarizeStructuredCards(cards);
    const coverage = assessSourceCoverage({
      cards,
      finalUrl: evidence.url,
      pageSemantic: evidence.semantic,
      pageText: evidence.text,
      requestedUrl: site.url,
    });
    const classification = classifyPage({
      cardCount: summary.cardCount,
      text: evidence.text,
      title: evidence.title,
      url: evidence.url,
    });
    outcome = classification;
    if (
      classification === 'success' &&
      (summary.incompleteCards > 0 ||
        summary.unconsumed > 0 ||
        coverage.missing.length > 0)
    ) {
      outcome = 'parse_incomplete';
    }
    await writer.write({
      classification,
      domain,
      finalUrl: sanitizedUrl(evidence.url),
      languages: site.languages,
      network,
      outcome,
      parser: {
        cardCount: summary.cardCount,
        completeness: summary.completeness,
        consumed: summary.consumed,
        incompleteCards: summary.incompleteCards,
        total: summary.total,
        unconsumed: summary.unconsumed,
      },
      requirements: coverage,
      schemaVersion: adapter.schemaVersion,
      severity: outcome === 'success' ? 'info' : 'error',
      siteId: site.id,
      stage: 'site.classified',
    });
    for (const segment of summary.segmentEvidence) {
      await writer.write({
        ...segment,
        domain,
        severity: segment.consumed ? 'debug' : 'error',
        siteId: site.id,
        stage: segment.consumed
          ? 'parser.segment_consumed'
          : 'parser.segment_unconsumed',
      });
    }
  } catch (error) {
    runError = error;
    outcome = errorKind(error);
    await writer.write({
      domain,
      error: safeError(error),
      severity: 'error',
      siteId: site.id,
      stage: 'site.failed',
    });
  } finally {
    await pacer.record(domain, outcome);
    if (runningTrace) {
      try {
        await runningTrace.trace.stop({ error: runError });
      } catch (error) {
        await writer.write({
          domain,
          error: safeError(error),
          severity: 'error',
          siteId: site.id,
          stage: 'trace.stop_failed',
        });
      }
    }
    await commander?.destroy().catch(() => {});
    await browser?.close().catch(() => {});
  }
  const result = {
    durationMs: Date.now() - startedAt,
    outcome,
    siteId: site.id,
  };
  await writer.write({ ...result, domain, stage: 'site.finished' });
  return result;
}

async function main() {
  assertManualLocalRun(process.env);
  const options = parseArguments(process.argv.slice(2));
  const runId = randomUUID();
  const outputDirectory = options.outputDir
    ? join(options.outputDir, `run-${runId}`)
    : await mkdtemp(join(tmpdir(), 'vac-browser-e2e-'));
  await mkdir(outputDirectory, { mode: 0o700, recursive: true });
  await chmod(outputDirectory, 0o700);
  options.outputDirectory = outputDirectory;
  const manifestSites = JSON.parse(await readFile(options.manifest, 'utf8'));
  const selectedSites = options.siteIds.length
    ? manifestSites.filter(({ id }) => options.siteIds.includes(id))
    : manifestSites;
  const sites = selectedSites.slice(0, options.maxSites);
  if (sites.length === 0) {
    throw new Error('No sites matched the requested manual audit selection.');
  }
  const writer = await createPrivateTraceWriter(outputDirectory, runId);
  const cooldownState =
    options.cooldownState ||
    join(
      options.outputDir || join(tmpdir(), 'vietnam-accommodation-search'),
      'browser-audit-cooldowns.json'
    );
  const pacer = await DomainPacer.open({
    ...options,
    statePath: cooldownState,
  });
  await writer.write({
    concurrency: options.concurrency,
    cooldownStatePersisted: true,
    manualLocalOnly: true,
    siteCount: sites.length,
    stage: 'run.started',
  });
  const results = await runDomainQueues(sites, options.concurrency, (site) =>
    auditSite({ options, pacer, site, writer })
  );
  const outcomes = Object.fromEntries(
    [...new Set(results.map(({ outcome }) => outcome))].map((outcome) => [
      outcome,
      results.filter((result) => result.outcome === outcome).length,
    ])
  );
  await writer.write({ outcomes, stage: 'run.finished' });
  console.log(
    JSON.stringify({
      manualLocalOnly: true,
      outcomes,
      outputDirectory,
      trace: writer.path,
    })
  );
  const exitCode = results.some(({ outcome }) => outcome !== 'success') ? 1 : 0;
  process.exit(exitCode);
}

await main();
