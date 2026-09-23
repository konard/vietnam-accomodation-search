#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Api, TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';

import {
  GRAMJS_SESSION_FORMAT,
  LinksStore,
  classifyTelegramPost,
} from '../src/index.js';
import {
  auditTelegramBatch,
  collectTelegramWindow,
  loadAuditCheckpoint,
  retryTelegramFloodWait,
  saveAuditCheckpoint,
  sourceCompletion,
  verifyAuditStorage,
} from './telegram-live-audit-runtime.mjs';
import {
  DEFAULT_DISCOVERY_QUERIES,
  anonymizeListing,
  assertManualLocalRun,
  classifyAccommodationPost,
  countBy,
  isNhaTrangSource,
  isTelegramCommunity,
  isTelegramPrivateDialog,
  loadCredentialEnvironment,
  missingExpectedDetails,
  normalized,
  publicSourceRecord,
  publicUsername,
  sourceScore,
  telegramCredentials,
  textValue,
} from './telegram-accommodation-audit-lib.mjs';

const DEFAULT_FOLDER = 'Нячанг жильё';

function parseArguments(values) {
  const result = {
    folder: DEFAULT_FOLDER,
    maxMessages: 3_000,
    maxSources: 40,
    months: 2,
    redactedExcerpts: false,
    stateDirectory: '.vietnam-accomodation-search/telegram-live-audit',
  };
  const valued = new Map([
    ['--bot-env', 'botEnv'],
    ['--folder', 'folder'],
    ['--max-messages', 'maxMessages'],
    ['--max-sources', 'maxSources'],
    ['--months', 'months'],
    ['--output', 'output'],
    ['--state-directory', 'stateDirectory'],
    ['--tesseract-command', 'tesseractCommand'],
    ['--user-env', 'userEnv'],
  ]);
  for (let index = 0; index < values.length; index += 1) {
    const option = values[index];
    if (option === '--redacted-excerpts') {
      result.redactedExcerpts = true;
      continue;
    }
    const property = valued.get(option);
    if (!property || !values[index + 1]) {
      throw new TypeError(`Unknown or incomplete option: ${option}`);
    }
    result[property] = values[index + 1];
    index += 1;
  }
  for (const property of ['maxMessages', 'maxSources', 'months']) {
    result[property] = Number(result[property]);
    if (!Number.isInteger(result[property]) || result[property] < 1) {
      throw new RangeError(`${property} must be a positive integer.`);
    }
  }
  if (result.maxSources > 40) {
    throw new RangeError(
      'maxSources must not exceed the audited 40-source limit.'
    );
  }
  return result;
}

function errorSummary(error) {
  return {
    code:
      typeof error?.code === 'number' || typeof error?.code === 'string'
        ? error.code
        : undefined,
    type: error?.constructor?.name || 'Error',
  };
}

function dateValue(value) {
  if (value instanceof Date) {
    return value;
  }
  return new Date(
    typeof value === 'number' && value < 1e12 ? value * 1000 : value
  );
}

function cutoffDate(now, months) {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}

function mediaIdentity(message) {
  return (
    message.mediaId ??
    message.media?.id ??
    message.media ??
    message.photo?.id ??
    message.document?.id ??
    message.photos?.[0]
  );
}

function tesseract(command, bytes) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      command,
      ['stdin', 'stdout', '--dpi', '150', '-l', 'eng+rus+vie'],
      { shell: false, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${chunk}`.slice(0, 1024 * 1024);
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4096);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        const error = new Error(
          `Media extraction exited with ${code}: ${stderr.trim()}`
        );
        error.code = 'MEDIA_EXTRACTION_FAILED';
        reject(error);
      }
    });
    child.stdin.end(bytes);
  });
}

function commandOutput(command, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${chunk}`.slice(0, 64 * 1024);
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4096);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        const error = new Error(
          `Tesseract language preflight exited with ${code}: ${stderr.trim()}`
        );
        error.code = 'OCR_PREFLIGHT_FAILED';
        reject(error);
      }
    });
  });
}

export async function verifyTesseractLanguages(
  command,
  execute = commandOutput
) {
  if (!command) {
    throw new TypeError('--tesseract-command is required for the live audit.');
  }
  const output = await execute(command, ['--list-langs']);
  const available = new Set(
    String(output)
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => /^[a-z]{3}$/u.test(line))
  );
  const required = ['eng', 'rus', 'vie'];
  const missing = required.filter((language) => !available.has(language));
  if (missing.length) {
    throw new Error(
      `Tesseract is missing required language models: ${missing.join(', ')}.`
    );
  }
  return required;
}

function mediaOcr(client, messages, command) {
  if (!command) {
    return undefined;
  }
  const byIdentity = new Map(
    messages
      .map((message) => [mediaIdentity(message), message.media])
      .filter(([identity, media]) => identity !== undefined && media)
  );
  return async (identity) => {
    const media = byIdentity.get(identity);
    if (!media) {
      const error = new Error('Telegram media was not present in the batch.');
      error.code = 'MEDIA_NOT_FOUND';
      throw error;
    }
    const bytes = await client.downloadMedia(media);
    return tesseract(command, bytes);
  };
}

async function corpusClassificationMetrics() {
  const corpus = JSON.parse(
    await readFile(
      new globalThis.URL(
        './fixtures/telegram-accommodation-parser-cases.json',
        import.meta.url
      ),
      'utf8'
    )
  );
  const counters = {
    falseNegative: 0,
    falsePositive: 0,
    trueNegative: 0,
    truePositive: 0,
  };
  for (const testCase of corpus.cases.filter(({ input }) => input.text)) {
    const expected = testCase.expected.relevant;
    const actual = classifyTelegramPost(testCase.input.text).eligible;
    const key = actual
      ? expected
        ? 'truePositive'
        : 'falsePositive'
      : expected
        ? 'falseNegative'
        : 'trueNegative';
    counters[key] += 1;
  }
  const precisionDenominator = counters.truePositive + counters.falsePositive;
  const recallDenominator = counters.truePositive + counters.falseNegative;
  return {
    ...counters,
    corpusSchemaVersion: corpus.schemaVersion,
    languages: [
      ...new Set(corpus.cases.map(({ language }) => language)),
    ].sort(),
    precision: precisionDenominator
      ? counters.truePositive / precisionDenominator
      : null,
    recall: recallDenominator
      ? counters.truePositive / recallDenominator
      : null,
  };
}

function folderTitle(filter) {
  return textValue(filter?.title);
}

function entityKey(entity) {
  const username = publicUsername(entity);
  if (username) {
    return `public:${username.toLocaleLowerCase('en')}`;
  }
  const className = entity?.className || entity?.constructor?.name || 'peer';
  return `private:${className}:${entity?.id?.toString?.() || 'unknown'}`;
}

function sourceEntity(entity, discoveredBy) {
  return {
    discoveredBy: new Set(discoveredBy),
    entity,
    public: publicSourceRecord(entity, discoveredBy),
  };
}

async function resolveFolderEntities(client, filter) {
  const resolved = new Map();
  const ignoredPrivateDialogs = new Set();
  const ignoredUnsupportedPeers = new Set();
  let resolutionErrors = 0;
  const add = (entity, method) => {
    const key = entityKey(entity);
    if (isTelegramCommunity(entity)) {
      const previous = resolved.get(key);
      if (previous) {
        previous.discoveredBy.add(method);
      } else {
        resolved.set(key, sourceEntity(entity, [method]));
      }
    } else if (isTelegramPrivateDialog(entity)) {
      ignoredPrivateDialogs.add(key);
    } else {
      ignoredUnsupportedPeers.add(key);
    }
  };
  const peers = [...(filter.pinnedPeers || []), ...(filter.includePeers || [])];
  for (const peer of peers) {
    try {
      add(
        await retryTelegramFloodWait(() => client.getEntity(peer)),
        'folder-filter'
      );
    } catch {
      // One inaccessible peer must not hide the remaining folder.
      resolutionErrors += 1;
    }
  }
  try {
    const dialogs = await retryTelegramFloodWait(() =>
      client.getDialogs({ folder: filter.id, limit: 500 })
    );
    for (const dialog of dialogs) {
      add(dialog.entity, 'folder-dialog');
    }
  } catch {
    // Custom folders may be fully represented by includePeers alone.
    resolutionErrors += 1;
  }
  return {
    entities: resolved,
    ignoredPrivateDialogs: ignoredPrivateDialogs.size,
    ignoredUnsupportedPeers: ignoredUnsupportedPeers.size,
    resolutionErrors,
  };
}

function mergePublicCandidate(candidates, entity, query) {
  if (!isTelegramCommunity(entity)) {
    return;
  }
  const record = publicSourceRecord(entity, [query]);
  if (!record || !isNhaTrangSource(`${record.title} ${record.username}`)) {
    return;
  }
  const key = record.username.toLocaleLowerCase('en');
  const previous = candidates.get(key);
  if (previous) {
    previous.record.discoveredBy = [
      ...new Set([...previous.record.discoveredBy, query]),
    ].sort();
    previous.record.participants ||= record.participants;
  } else {
    candidates.set(key, { entity, record });
  }
}

async function discoverPublicSources(client) {
  const candidates = new Map();
  const errors = [];
  for (const query of DEFAULT_DISCOVERY_QUERIES) {
    try {
      const found = await retryTelegramFloodWait(() =>
        client.invoke(new Api.contacts.Search({ limit: 100, q: query }))
      );
      for (const entity of found.chats || []) {
        mergePublicCandidate(candidates, entity, query);
      }
    } catch (error) {
      errors.push({ query, ...errorSummary(error) });
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
  }
  return { candidates, errors };
}

function combineSources(folderEntities, publicCandidates, maximum) {
  const combined = new Map(folderEntities);
  for (const { entity, record } of publicCandidates.values()) {
    const key = entityKey(entity);
    const previous = combined.get(key);
    if (previous) {
      for (const query of record.discoveredBy) {
        previous.discoveredBy.add(query);
      }
      previous.public = publicSourceRecord(entity, [...previous.discoveredBy]);
    } else {
      combined.set(key, {
        discoveredBy: new Set(record.discoveredBy),
        entity,
        public: record,
      });
    }
  }
  return [...combined.values()]
    .sort((left, right) => {
      const leftFolder = [...left.discoveredBy].some((item) =>
        item.startsWith('folder')
      );
      const rightFolder = [...right.discoveredBy].some((item) =>
        item.startsWith('folder')
      );
      return (
        Number(rightFolder) - Number(leftFolder) ||
        sourceScore(
          right.public || { discoveredBy: [], title: '', username: '' }
        ) -
          sourceScore(
            left.public || { discoveredBy: [], title: '', username: '' }
          )
      );
    })
    .slice(0, maximum);
}

function emptySourceAudit(alias) {
  return {
    alias,
    accommodationRequests: 0,
    mediaOnlyCandidates: 0,
    messagesScanned: 0,
    missingDetails: [],
    offersWithAllExpectedFields: 0,
    parserOffers: 0,
    relevantOffers: 0,
    terminalMaterials: {},
  };
}

function offerProblems(offer, text) {
  const problems = missingExpectedDetails(offer, text);
  if (!offer?.price) {
    problems.push('missing-price');
  }
  if (!offer?.location) {
    problems.push('missing-location');
  }
  if (offer?.kind === 'accommodation') {
    problems.push('generic-kind');
  }
  if (!Object.values(offer?.contacts || {}).some((values) => values.length)) {
    problems.push('missing-contact');
  }
  return [...new Set(problems)];
}

function addExamples(report, source, text, offer, problems, enabled) {
  if (!enabled || !problems.length || report.examples.length >= 40) {
    return;
  }
  const existing = report.examples.some(
    (example) => example.problems.join() === problems.join()
  );
  if (!existing) {
    report.examples.push({
      excerpt: anonymizeListing(text),
      parsed: {
        attributeKeys: Object.keys(offer?.attributes || {}).filter(
          (key) => key !== 'labeledFields'
        ),
        contactTypes: Object.entries(offer?.contacts || {})
          .filter(([, values]) => values.length)
          .map(([key]) => key),
        kind: offer?.kind,
        location: Boolean(offer?.location),
        price: Boolean(offer?.price),
      },
      problems,
      source,
    });
  }
}

function normalizedAuditMessage(message, alias) {
  return {
    chatId: `telegram:${alias}`,
    date: dateValue(message.date),
    editDate: message.editDate,
    groupedId: message.groupedId ?? message.grouped_id,
    id: message.id,
    mediaId: mediaIdentity(message),
    sourceId: `telegram:${alias}`,
    text: message.message || message.text || '',
  };
}

// eslint-disable-next-line complexity, max-lines-per-function, max-params, max-statements -- A source audit keeps retrieval, checkpoint, reconciliation, and durable commit in one ordered privacy boundary.
async function auditSource(
  client,
  source,
  options,
  report,
  privateIndex,
  checkpointStore,
  auditStore
) {
  const alias =
    source.public?.username || `private-folder-source-${privateIndex}`;
  const audit = emptySourceAudit(alias);
  const cutoff = cutoffDate(report.generatedAt, options.months);
  const previous = await loadAuditCheckpoint(checkpointStore, alias);
  const resume = previous?.complete === false ? previous : undefined;
  let offsetId = resume?.oldestMessageId;
  let messages = [];
  let exhausted = false;
  let hitCap = false;
  let reachedCutoff = false;
  let sourceError;
  try {
    const collected = await collectTelegramWindow({
      cutoff,
      iterate: (iteratorOptions) =>
        client.iterMessages(source.entity, iteratorOptions),
      maxMessages: options.maxMessages,
      offsetId,
    });
    ({ exhausted, hitCap, messages, offsetId, reachedCutoff } = collected);
  } catch (error) {
    sourceError = errorSummary(error);
  }
  const normalizedMessages = messages.map((message) =>
    normalizedAuditMessage(message, alias)
  );
  const batch = await auditTelegramBatch(normalizedMessages, {
    now: new Date(report.generatedAt),
    ocr: mediaOcr(client, messages, options.tesseractCommand),
    sourceAlias: alias,
  });
  for (const message of messages) {
    const classification = classifyAccommodationPost(
      message.message || message.text || '',
      Boolean(message.media)
    );
    audit.mediaOnlyCandidates += Number(classification.mediaOnlyCandidate);
    audit.accommodationRequests += Number(
      classification.demand && classification.accommodation
    );
  }
  for (const offer of batch.offers) {
    const text = offer.text || offer.raw?.text || '';
    const problems = offerProblems(offer, text);
    audit.missingDetails.push(...problems);
    audit.offersWithAllExpectedFields += Number(problems.length === 0);
    addExamples(report, alias, text, offer, problems, options.redactedExcerpts);
  }
  const completion = sourceCompletion({
    error: sourceError,
    exhausted,
    hitCap,
    reachedCutoff,
  });
  audit.completion = completion;
  audit.currentRunMessages = messages.length;
  audit.error = sourceError;
  audit.messagesScanned = (resume?.messagesScanned || 0) + messages.length;
  audit.parserOffers = batch.offers.length;
  audit.relevantOffers =
    batch.offers.length +
    batch.reviewQueue.filter(
      ({ reason }) => reason === 'offer-extraction-failed'
    ).length;
  audit.segments = batch.segments;
  audit.terminalMaterials = batch.materials.terminal;
  audit.traces = countBy(batch.traceRecords.map(({ status }) => status));
  audit.unaccountedMaterials = batch.materials.unaccounted;
  audit.unresolvedMediaOnly = batch.reviewQueue.filter(
    ({ reason }) =>
      reason === 'photo-only-ocr-unavailable' ||
      reason === 'photo-only-ocr-failed'
  ).length;
  audit.missingDetails = countBy(audit.missingDetails);
  if (resume?.metrics) {
    audit.accommodationRequests += resume.metrics.accommodationRequests || 0;
    audit.mediaOnlyCandidates += resume.metrics.mediaOnlyCandidates || 0;
    audit.offersWithAllExpectedFields +=
      resume.metrics.offersWithAllExpectedFields || 0;
    audit.parserOffers += resume.metrics.parserOffers || 0;
    audit.relevantOffers += resume.metrics.relevantOffers || 0;
    audit.unresolvedMediaOnly += resume.metrics.unresolvedMediaOnly || 0;
    audit.unaccountedMaterials += resume.metrics.unaccountedMaterials || 0;
    for (const [key, count] of Object.entries(
      resume.metrics.missingDetails || {}
    )) {
      audit.missingDetails[key] = (audit.missingDetails[key] || 0) + count;
    }
    for (const [state, count] of Object.entries(
      resume.metrics.segments || {}
    )) {
      audit.segments[state] = (audit.segments[state] || 0) + count;
    }
    for (const [state, count] of Object.entries(
      resume.metrics.terminalMaterials || {}
    )) {
      audit.terminalMaterials[state] =
        (audit.terminalMaterials[state] || 0) + count;
    }
    for (const [status, count] of Object.entries(resume.metrics.traces || {})) {
      audit.traces[status] = (audit.traces[status] || 0) + count;
    }
  }
  await auditStore.updateRecords('domain-records', (current) => {
    const byId = new Map(current.map((record) => [record.id, record]));
    for (const record of batch.domainRecords) {
      byId.set(record.id, record);
    }
    return [...byId.values()];
  });
  await auditStore.updateRecords('traces', (current) => {
    const byId = new Map(current.map((record) => [record.id, record]));
    for (const record of batch.traceRecords) {
      byId.set(record.id, record);
    }
    return [...byId.values()];
  });
  await auditStore.saveOffers(batch.offers);
  await saveAuditCheckpoint(checkpointStore, {
    complete: completion.pass,
    cutoff: cutoff.toISOString(),
    id: alias,
    messagesScanned: audit.messagesScanned,
    ...(offsetId === undefined
      ? {}
      : {
          oldestMessageDate: messages.at(-1)
            ? dateValue(messages.at(-1).date).toISOString()
            : resume?.oldestMessageDate,
          oldestMessageId: offsetId,
        }),
    metrics: {
      accommodationRequests: audit.accommodationRequests,
      mediaOnlyCandidates: audit.mediaOnlyCandidates,
      missingDetails: audit.missingDetails,
      offersWithAllExpectedFields: audit.offersWithAllExpectedFields,
      parserOffers: audit.parserOffers,
      relevantOffers: audit.relevantOffers,
      segments: audit.segments,
      terminalMaterials: audit.terminalMaterials,
      traces: audit.traces,
      unaccountedMaterials: audit.unaccountedMaterials,
      unresolvedMediaOnly: audit.unresolvedMediaOnly,
    },
    state: completion.state,
    updatedAt: new Date().toISOString(),
  });
  return { audit, domainRecords: batch.domainRecords, offers: batch.offers };
}

async function botStatus(token) {
  if (!token) {
    return { configured: false };
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const payload = await response.json();
    return response.ok && payload.ok
      ? {
          active: true,
          configured: true,
          id: String(payload.result.id),
          username: payload.result.username,
        }
      : { active: false, configured: true, errorCode: payload.error_code };
  } catch (error) {
    return { active: false, configured: true, error: errorSummary(error) };
  }
}

// eslint-disable-next-line complexity, max-lines-per-function, max-statements -- The live runner assembles a single evidence report across discovery, ingestion, storage, and acceptance gates.
export async function runAudit(options) {
  const ocrLanguages = await verifyTesseractLanguages(options.tesseractCommand);
  const environment = await loadCredentialEnvironment([
    options.userEnv,
    options.botEnv,
  ]);
  const credentials = telegramCredentials(environment);
  if (
    !credentials.session ||
    !credentials.apiHash ||
    !Number.isInteger(credentials.apiId)
  ) {
    throw new Error(
      'A complete Telegram user session and API credential set is required.'
    );
  }
  if (credentials.sessionFormat !== GRAMJS_SESSION_FORMAT) {
    throw new Error(
      `This read-only audit requires an explicitly declared ${GRAMJS_SESSION_FORMAT} session; it will not trial-convert raw or foreign sessions.`
    );
  }
  const checkpointStore = new LinksStore({
    binaryMirror: false,
    directory: join(options.stateDirectory, 'checkpoints'),
  });
  const auditStore = new LinksStore({
    binaryMirror: true,
    directory: join(options.stateDirectory, 'typed-results'),
  });
  await auditStore.mirror.preflight();
  const report = {
    bot: await botStatus(credentials.botToken),
    discovery: {},
    examples: [],
    folder: { requested: options.folder },
    generatedAt: new Date().toISOString(),
    limits: {
      maxMessagesPerSource: options.maxMessages,
      maxSources: options.maxSources,
      months: options.months,
    },
    links: {
      canonicalTypedAssociations: true,
      transactionalClinkMirror: true,
    },
    ocr: { languages: ocrLanguages },
    parser: {},
    user: { active: false },
  };
  const client = new TelegramClient(
    new StringSession(credentials.session),
    credentials.apiId,
    credentials.apiHash,
    { autoReconnect: false, connectionRetries: 2, requestRetries: 2 }
  );
  client.setLogLevel?.('none');
  try {
    await client.connect();
    report.user.active = await client.checkAuthorization();
    if (!report.user.active) {
      throw new Error('The Telegram user session is not authorized.');
    }
    const filtersResult = await retryTelegramFloodWait(() =>
      client.invoke(new Api.messages.GetDialogFilters())
    );
    const filters = filtersResult.filters || filtersResult;
    const filter = filters.find(
      (candidate) =>
        normalized(folderTitle(candidate)) === normalized(options.folder)
    );
    report.folder.found = Boolean(filter);
    report.folder.availableFolderCount = filters.filter((candidate) =>
      folderTitle(candidate)
    ).length;
    const folderResolution = filter
      ? await resolveFolderEntities(client, filter)
      : {
          entities: new Map(),
          ignoredPrivateDialogs: 0,
          ignoredUnsupportedPeers: 0,
          resolutionErrors: 0,
        };
    const folderEntities = folderResolution.entities;
    report.folder.ignoredPrivateDialogs =
      folderResolution.ignoredPrivateDialogs;
    report.folder.ignoredUnsupportedPeers =
      folderResolution.ignoredUnsupportedPeers;
    report.folder.resolutionErrors = folderResolution.resolutionErrors;
    report.folder.sourceCount = folderEntities.size;

    const discovery = await discoverPublicSources(client);
    report.discovery.errors = discovery.errors;
    report.discovery.publicCandidates = discovery.candidates.size;
    const sources = combineSources(
      folderEntities,
      discovery.candidates,
      options.maxSources
    );
    report.discovery.selectedSources = sources.length;
    report.discovery.publicSources = sources
      .filter((source) => source.public)
      .map((source) => ({
        ...source.public,
        discoveredBy: [...source.discoveredBy].sort(),
      }));
    report.discovery.privateFolderSources = sources.filter(
      (source) => !source.public
    ).length;
    report.discovery.recall = {
      reviewedGroundTruth: false,
      value: null,
      reason:
        'Live search results have no complete human-reviewed source universe; candidate and selected counts are reported separately.',
    };

    const audits = [];
    const domainRecords = [];
    const offers = [];
    let privateIndex = 0;
    for (const source of sources) {
      if (!source.public) {
        privateIndex += 1;
      }
      const result = await auditSource(
        client,
        source,
        options,
        report,
        privateIndex,
        checkpointStore,
        auditStore
      );
      audits.push(result.audit);
      domainRecords.push(...result.domainRecords);
      offers.push(...result.offers);
    }
    report.sources = audits;
    const mergeById = (records) => [
      ...new Map(records.map((record) => [record.id, record])).values(),
    ];
    const storedDomainRecords = await auditStore.loadRecords('domain-records');
    const mergedDomainRecords = mergeById([
      ...storedDomainRecords,
      ...domainRecords,
    ]);
    report.storage = mergedDomainRecords.length
      ? await verifyAuditStorage(
          auditStore,
          mergedDomainRecords,
          'domain-records'
        )
      : { delete: false, edit: false, query: false, roundTrip: false };
    await auditStore.saveOffers(offers);
    report.classification = await corpusClassificationMetrics();
    const fieldProblems = countBy(
      audits.flatMap((audit) =>
        Object.entries(audit.missingDetails).flatMap(([key, count]) =>
          Array.from({ length: count }, () => key)
        )
      )
    );
    const terminalMaterials = audits.reduce((totals, audit) => {
      for (const [state, count] of Object.entries(audit.terminalMaterials)) {
        totals[state] = (totals[state] || 0) + count;
      }
      return totals;
    }, {});
    report.fieldExtraction = {
      acceptedOffers: offers.length,
      missingExpectedFields: fieldProblems,
      offersWithAllExpectedFields: audits.reduce(
        (total, audit) => total + audit.offersWithAllExpectedFields,
        0
      ),
    };
    report.mediaHandling = {
      mediaOnlyCandidates: audits.reduce(
        (total, audit) => total + audit.mediaOnlyCandidates,
        0
      ),
      terminal: terminalMaterials,
      unaccounted: audits.reduce(
        (total, audit) => total + audit.unaccountedMaterials,
        0
      ),
      unresolvedMediaOnly: audits.reduce(
        (total, audit) => total + audit.unresolvedMediaOnly,
        0
      ),
    };
    const sourceErrors = audits.filter((audit) => audit.error).length;
    const incompleteSources = audits.filter(
      (audit) => !audit.completion.pass
    ).length;
    report.parser = {
      accommodationRequestsExcluded: audits.reduce(
        (total, audit) => total + audit.accommodationRequests,
        0
      ),
      messagesScanned: audits.reduce(
        (total, audit) => total + audit.messagesScanned,
        0
      ),
      missingDetails: fieldProblems,
      parserOffers: audits.reduce(
        (total, audit) => total + audit.parserOffers,
        0
      ),
      relevantOffers: audits.reduce(
        (total, audit) => total + audit.relevantOffers,
        0
      ),
      sourceErrors,
      incompleteSources,
      segments: audits.reduce((totals, audit) => {
        for (const [state, count] of Object.entries(audit.segments)) {
          totals[state] = (totals[state] || 0) + count;
        }
        return totals;
      }, {}),
      traces: audits.reduce((totals, audit) => {
        for (const [status, count] of Object.entries(audit.traces)) {
          totals[status] = (totals[status] || 0) + count;
        }
        return totals;
      }, {}),
    };
    report.acceptance = {
      checks: {
        botIdentity: report.bot.active === true,
        canonicalTypedStorage: Object.values(report.storage).every(Boolean),
        completeFortySourceCohort:
          options.maxSources === 40 && sources.length === 40,
        correlatedTerminalTraces:
          Object.values(report.parser.traces).reduce(
            (total, count) => total + count,
            0
          ) ===
          Object.values(terminalMaterials).reduce(
            (total, count) => total + count,
            0
          ),
        folderFound: report.folder.found === true,
        expectedFieldsExtracted:
          Object.values(fieldProblems).reduce(
            (total, count) => total + count,
            0
          ) === 0,
        noDiscoveryErrors: discovery.errors.length === 0,
        noFolderResolutionErrors: report.folder.resolutionErrors === 0,
        noSourceErrors: sourceErrors === 0,
        noTruncation: incompleteSources === 0,
        noTerminalErrors: (terminalMaterials.error || 0) === 0,
        noSegmentErrors: (report.parser.segments.error || 0) === 0,
        sourceLimitRespected: sources.length <= 40,
        reviewedPrecision: report.classification.precision === 1,
        reviewedRecall: report.classification.recall === 1,
        terminalMaterials: report.mediaHandling.unaccounted === 0,
        unresolvedMediaOnly: report.mediaHandling.unresolvedMediaOnly === 0,
        userIdentity: report.user.active === true,
      },
    };
    report.acceptance.pass = Object.values(report.acceptance.checks).every(
      Boolean
    );
  } finally {
    await client.disconnect().catch(() => {});
    await client.destroy?.().catch(() => {});
  }
  return report;
}

async function main() {
  assertManualLocalRun(process.env);
  const options = parseArguments(process.argv.slice(2));
  const report = await runAudit(options);
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) {
    await writeFile(options.output, output, { mode: 0o600 });
    console.log(
      JSON.stringify({
        folderFound: report.folder.found,
        output: options.output,
        parser: report.parser,
        selectedSources: report.discovery.selectedSources,
      })
    );
  } else {
    console.log(output);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ error: errorSummary(error) }));
    process.exitCode = 1;
  });
}
