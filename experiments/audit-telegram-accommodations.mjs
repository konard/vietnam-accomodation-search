#!/usr/bin/env node

import {
  folderContainsDialog,
  folderUsesCategories,
} from './telegram-folder-filter.mjs';
import { telegramHistoryWindow } from '../src/telegram-window.js';
import { createTelegramOcr } from '../src/telegram-ocr.js';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Api, TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { runClink } from '../src/link-cli-mirror.js';
// Shared scalar media identity; GramJS media objects carry bytes (#82).
import { mediaIdentity } from '../src/telegram-pipeline.js';

import {
  GRAMJS_SESSION_FORMAT,
  LinkCliMirror,
  LinksStore,
} from '../src/index.js';
import { fieldMetrics, loadCorpus } from './field-corpus-metrics.mjs';
import {
  completedAudit,
  createSourceTimings,
  mergeSourceAudits,
  parseSourceSelection,
} from './audit-progress.mjs';
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
  loadSourceJournal,
  removeSourceJournal,
  saveCollectedSourceBatch,
  sourceJournalCommitted,
} from './telegram-audit-journal.mjs';
import {
  DEFAULT_DISCOVERY_QUERIES,
  anonymizeListing,
  assertManualLocalRun,
  botStatus,
  classifyAccommodationPost,
  countBy,
  errorSummary,
  isNhaTrangSource,
  isTelegramCommunity,
  isTelegramPrivateDialog,
  loadCredentialEnvironment,
  missingExpectedDetails,
  normalized,
  publicSourceRecord,
  publicUsername,
  selectPublicAuditSources,
  sourceScore,
  telegramCredentials,
  textValue,
} from './telegram-accommodation-audit-lib.mjs';

const DEFAULT_FOLDER = 'Нячанг жильё';
// Storage CRUD is verified on a bounded sample in its own collection, so the
// final step never holds or rewrites the whole domain-record collection.
const STORAGE_SAMPLE_RECORDS = 200;

export function parseArguments(values) {
  const result = {
    folder: DEFAULT_FOLDER,
    maxMessages: Number.MAX_SAFE_INTEGER,
    maxSources: 100,
    months: 3,
    redactedExcerpts: false,
    stateDirectory: '.vietnam-accomodation-search/telegram-live-audit',
  };
  const valued = new Map([
    ['--bot-env', 'botEnv'],
    ['--folder', 'folder'],
    ['--max-messages', 'maxMessages'],
    ['--max-sources', 'maxSources'],
    ['--sources', 'sources'],
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
    if (option === '--new-pass') {
      result.newPass = true;
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
  if (result.maxSources > 100) {
    throw new RangeError(
      'maxSources must not exceed the 100-source safety limit.'
    );
  }
  parseSourceSelection(result.sources, result.maxSources);
  return result;
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
  const minimum = telegramHistoryWindow({ now }).since;
  return months >= 3 && cutoff > minimum ? minimum : cutoff;
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
  return createTelegramOcr(
    {
      photo: async (identity, { signal, maxBytes = 16 * 1024 * 1024 }) => {
        const media = byIdentity.get(identity);
        if (!media) {
          const error = new Error(
            'Telegram media was not present in the batch.'
          );
          error.code = 'MEDIA_NOT_FOUND';
          throw error;
        }
        if (!media.photo) {
          throw Object.assign(
            new Error('Only Telegram photos are supported for rental OCR.'),
            { code: 'OCR_MEDIA_UNSUPPORTED' }
          );
        }
        if (
          (media.photo.sizes || []).some(
            (size) =>
              Number(
                size.size ||
                  Math.max(0, ...(size.sizes || [])) ||
                  size.bytes?.byteLength ||
                  0
              ) > maxBytes
          )
        ) {
          throw Object.assign(
            new Error('Telegram photo exceeds the OCR input budget.'),
            { code: 'OCR_INPUT_BUDGET' }
          );
        }
        return await client.downloadMedia(media, {
          signal,
          requestTimeout: 15000,
          progressCallback: (downloaded, total) => {
            if (Number(downloaded) > maxBytes || Number(total) > maxBytes) {
              throw Object.assign(
                new Error('Telegram photo exceeds the OCR input budget.'),
                { code: 'OCR_INPUT_BUDGET' }
              );
            }
          },
        });
      },
    },
    { command }
  );
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

export async function resolveFolderEntities(client, filter) {
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
      const entity = await retryTelegramFloodWait(() => client.getEntity(peer));
      if (folderContainsDialog(filter, { entity })) {
        add(entity, 'folder-filter');
      }
    } catch {
      // One inaccessible peer must not hide the remaining folder.
      resolutionErrors += 1;
    }
  }
  if (folderUsesCategories(filter)) {
    for (const folder of [0, 1]) {
      try {
        const dialogs = await retryTelegramFloodWait(() =>
          client.getDialogs({ folder })
        );
        for (const dialog of dialogs) {
          if (folderContainsDialog(filter, dialog)) {
            add(dialog.entity, 'folder-dialog');
          }
        }
      } catch {
        resolutionErrors += 1;
      }
    }
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
  const ranked = [...combined.values()].sort((left, right) => {
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
  });
  return selectPublicAuditSources(ranked, maximum);
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
export async function auditSource(
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
  const retained = await loadAuditCheckpoint(checkpointStore, alias);
  const previous =
    !retained?.auditPass || retained.auditPass === options.auditPass
      ? retained
      : undefined;
  const savedAudit = completedAudit(previous);
  if (savedAudit) {
    if (!previous.auditPass) {
      await saveAuditCheckpoint(checkpointStore, {
        ...previous,
        audit: savedAudit,
        auditPass: options.auditPass,
      });
    }
    await removeSourceJournal(options.stateDirectory, alias);
    return { audit: savedAudit, domainRecords: [], offers: [], reused: true };
  }
  const timing = createSourceTimings();
  options.setSourceTimings?.(timing);
  const resume = previous?.complete === false ? previous : undefined;
  let journal = await loadSourceJournal(options.stateDirectory, alias);
  if (sourceJournalCommitted(journal, previous)) {
    await removeSourceJournal(options.stateDirectory, alias);
    journal = undefined;
  }
  if (journal && journal.resumeId !== resume?.oldestMessageId) {
    throw new Error('The private source journal checkpoint does not match.');
  }
  const cutoff = new Date(
    journal?.cutoff ||
      resume?.cutoff ||
      report.cutoff ||
      cutoffDate(report.generatedAt, options.months)
  );
  const journalKey = {
    alias,
    batchId: journal?.batchId || randomUUID(),
    cutoff: cutoff.toISOString(),
    resumeId: resume?.oldestMessageId,
  };
  let offsetId = resume?.oldestMessageId;
  let messages = [];
  let exhausted = false;
  let hitCap = false;
  let reachedCutoff = false;
  let sourceError;
  let batch;
  let oldestMessageDate;
  if (journal) {
    ({ batch, exhausted, hitCap, offsetId, reachedCutoff } = journal);
    oldestMessageDate = journal.oldestMessageDate;
    audit.currentRunMessages = journal.messagesCount;
    audit.mediaOnlyCandidates = journal.mediaOnlyCandidates;
    audit.accommodationRequests = journal.accommodationRequests;
  } else {
    try {
      const collected = await timing.measure('fetch', () =>
        collectTelegramWindow({
          cutoff,
          iterate: (iteratorOptions) =>
            client.iterMessages(
              source.entity || source.public.username,
              iteratorOptions
            ),
          maxMessages: options.maxMessages,
          offsetId,
        })
      );
      ({ exhausted, hitCap, messages, offsetId, reachedCutoff } = collected);
    } catch (error) {
      sourceError = errorSummary(error);
    }
    const normalizedMessages = messages.map((message) =>
      normalizedAuditMessage(message, alias)
    );
    const ocr = mediaOcr(client, messages, options.tesseractCommand);
    batch = await timing.measure('parse', () =>
      auditTelegramBatch(normalizedMessages, {
        now: new Date(report.generatedAt),
        since: report.cutoff,
        ocr: (...args) => timing.measure('ocr', () => ocr(...args)),
        sourceAlias: alias,
      })
    );
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
    audit.currentRunMessages = messages.length;
    oldestMessageDate = messages.at(-1)
      ? dateValue(messages.at(-1).date).toISOString()
      : resume?.oldestMessageDate;
    if (!sourceError) {
      await saveCollectedSourceBatch({
        checkpointStore,
        payload: {
          ...journalKey,
          auditPass: options.auditPass,
          accommodationRequests: audit.accommodationRequests,
          batch,
          exhausted,
          hitCap,
          mediaOnlyCandidates: audit.mediaOnlyCandidates,
          messagesCount: messages.length,
          offsetId,
          oldestMessageDate,
          reachedCutoff,
          version: 1,
        },
        previous: resume,
        stateDirectory: options.stateDirectory,
      });
    }
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
  audit.error = sourceError;
  audit.messagesScanned =
    (resume?.messagesScanned || 0) + audit.currentRunMessages;
  audit.parserOffers = batch.offers.length;
  audit.relevantOffers = batch.eligibleAttempts;
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
  await timing.measure('store', async () => {
    await auditStore.appendRecords('domain-records', batch.domainRecords);
    await auditStore.appendRecords('traces', batch.traceRecords);
    if (batch.offers.length) {
      await auditStore.saveOffers(batch.offers);
    }
  });
  audit.timingsMs = timing.summary();
  await saveAuditCheckpoint(checkpointStore, {
    audit,
    auditPass: options.auditPass,
    batchId: journalKey.batchId,
    complete: completion.pass,
    cutoff: cutoff.toISOString(),
    id: alias,
    messagesScanned: audit.messagesScanned,
    ...(offsetId === undefined
      ? {}
      : {
          oldestMessageDate,
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
    phase: 'projection-complete',
    state: completion.state,
    updatedAt: new Date().toISOString(),
  });
  if (journal || !sourceError) {
    await removeSourceJournal(options.stateDirectory, alias);
  }
  return { audit, domainRecords: batch.domainRecords, offers: batch.offers };
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
  const measurePhase =
    options.measurePhase || ((_event, operation) => operation());
  let sourceTimings;
  const project = (operation) =>
    sourceTimings ? sourceTimings.measure('project', operation) : operation();
  const auditStore = new LinksStore({
    binaryMirror: true,
    directory: join(options.stateDirectory, 'typed-results'),
    // Preserve the app's chunk/shard boundaries on retained stores. Changing
    // their size here would repartition offers and defeat verified reuse.
    mirror: new LinkCliMirror({
      run: (...args) =>
        project(() =>
          measurePhase({ phase: 'projection' }, () => runClink(...args))
        ),
      onProgress: (event) => process.stderr.write(`${JSON.stringify(event)}\n`),
    }),
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
    const retainedCohort = (
      await checkpointStore.loadRecords('audit-cohorts')
    )[0];
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
    const folderResolution =
      filter && !retainedCohort
        ? await resolveFolderEntities(client, filter)
        : {
            entities: new Map(),
            ignoredPrivateDialogs: 0,
            ignoredUnsupportedPeers: 0,
            resolutionErrors: 0,
          };
    const folderEntities = folderResolution.entities;
    Object.assign(
      report.folder,
      retainedCohort?.folder || {
        ignoredPrivateDialogs: folderResolution.ignoredPrivateDialogs,
        ignoredUnsupportedPeers: folderResolution.ignoredUnsupportedPeers,
        resolutionErrors: folderResolution.resolutionErrors,
        sourceCount: folderEntities.size,
      }
    );

    const discovery = retainedCohort
      ? { candidates: new Map(), errors: retainedCohort.discoveryErrors || [] }
      : await discoverPublicSources(client);
    report.discovery.errors = discovery.errors;
    report.discovery.publicCandidates =
      retainedCohort?.publicCandidates ?? discovery.candidates.size;
    const discovered = combineSources(
      folderEntities,
      discovery.candidates,
      options.maxSources
    );
    if (
      retainedCohort &&
      (retainedCohort.months !== options.months ||
        retainedCohort.maximum !== options.maxSources)
    ) {
      throw new Error(
        'The retained cohort has different window/source limits; use a separate state directory.'
      );
    }
    if (options.newPass && retainedCohort && !retainedCohort.complete) {
      throw new Error(
        'Complete the retained source cohort before starting --new-pass.'
      );
    }
    const cohort =
      retainedCohort && !options.newPass
        ? retainedCohort
        : {
            id: 'cohort',
            auditPass: randomUUID(),
            startedAt: report.generatedAt,
            months: options.months,
            maximum: options.maxSources,
            completedPasses: retainedCohort?.completedPasses || [],
            discoveryErrors:
              retainedCohort?.discoveryErrors || discovery.errors,
            publicCandidates: report.discovery.publicCandidates,
            folder: {
              ignoredPrivateDialogs: report.folder.ignoredPrivateDialogs,
              ignoredUnsupportedPeers: report.folder.ignoredUnsupportedPeers,
              resolutionErrors: report.folder.resolutionErrors,
              sourceCount: report.folder.sourceCount,
            },
            sources:
              retainedCohort?.sources ||
              discovered.map((source) => source.public),
          };
    if (options.redactedExcerpts) {
      report.examples = [...(cohort.examples || [])];
    }
    await checkpointStore.saveRecords('audit-cohorts', [cohort]);
    report.auditPass = cohort.auditPass;
    report.cutoff = cutoffDate(cohort.startedAt, options.months).toISOString();
    const sources = [];
    for (const record of cohort.sources) {
      const known = discovered.find(
        (source) => source.public.username === record.username
      );
      sources.push(
        known || {
          public: record,
          discoveredBy: new Set(record.discoveredBy || []),
        }
      );
    }
    const selectedOrdinals = parseSourceSelection(
      options.sources,
      sources.length
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
    report.discovery.excludedPrivateFolderSources = [
      ...folderEntities.values(),
    ].filter((source) => !source.public).length;
    report.discovery.recall = {
      reviewedGroundTruth: false,
      value: null,
      reason:
        'Live search results have no complete human-reviewed source universe; candidate and selected counts are reported separately.',
    };

    const audits = [];
    const storageSample = [];
    let privateIndex = 0;
    for (const [index, source] of sources.entries()) {
      const ordinal = index + 1;
      if (!selectedOrdinals.includes(ordinal)) {
        continue;
      }
      if (!source.public) {
        privateIndex += 1;
      }
      const result = await measurePhase({ phase: 'source', ordinal }, () =>
        auditSource(
          client,
          source,
          {
            ...options,
            auditPass: cohort.auditPass,
            setSourceTimings: (timings) => {
              sourceTimings = timings;
            },
          },
          report,
          privateIndex,
          checkpointStore,
          auditStore
        )
      );
      sourceTimings = undefined;
      audits.push(result.audit);
      storageSample.push(
        ...result.domainRecords.slice(
          0,
          STORAGE_SAMPLE_RECORDS - storageSample.length
        )
      );
    }
    audits.splice(
      0,
      audits.length,
      ...mergeSourceAudits(
        cohort.sources,
        await checkpointStore.loadRecords('audit-checkpoints'),
        cohort.auditPass
      )
    );
    report.sources = audits;
    report.storage = storageSample.length
      ? {
          ...(await verifyAuditStorage(auditStore, storageSample)),
          // appendRecords commits canonical text only after the new binary
          // batch has been verified. Avoid scanning/reprojecting the entire
          // retained collection just to find one sampled record.
          persisted: true,
        }
      : {
          delete: false,
          edit: false,
          persisted: false,
          query: false,
          roundTrip: false,
        };
    // Per-field precision and recall on the reviewed live corpus; the list of
    // individual misses stays in `node experiments/field-corpus-metrics.mjs
    // --misses`.
    const { misses, ...fields } = await fieldMetrics(await loadCorpus());
    report.fieldAccuracy = { ...fields, misses: misses.length };
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
      acceptedOffers: audits.reduce(
        (total, audit) => total + audit.parserOffers,
        0
      ),
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
        completePublicSourceCohort:
          sources.length >= 40 &&
          sources.every((source) => Boolean(source.public)),
        rollingThreeMonthWindow: options.months >= 3,
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
        reviewedFieldAccuracy: report.fieldAccuracy.pass,
        terminalMaterials: report.mediaHandling.unaccounted === 0,
        unresolvedMediaOnly: report.mediaHandling.unresolvedMediaOnly === 0,
        userIdentity: report.user.active === true,
      },
    };
    report.acceptance.pass = Object.values(report.acceptance.checks).every(
      Boolean
    );
    report.chunks = {
      selectedOrdinals,
      completedSources: audits.filter((audit) => audit.completion.pass).length,
      totalSources: sources.length,
    };
    // Completed selections use the cohort's persisted storage verification.
    if (!storageSample.length && cohort.storage) {
      report.storage = cohort.storage;
      report.acceptance.checks.canonicalTypedStorage = Object.values(
        report.storage
      ).every(Boolean);
      report.acceptance.pass = Object.values(report.acceptance.checks).every(
        Boolean
      );
    }
    cohort.storage = report.storage;
    if (options.redactedExcerpts) {
      cohort.examples = report.examples;
    }
    cohort.complete =
      sources.length > 0 && audits.every((audit) => audit.completion.pass);
    if (
      cohort.complete &&
      !cohort.completedPasses.some((pass) => pass.id === cohort.auditPass)
    ) {
      cohort.completedPasses.push({
        id: cohort.auditPass,
        startedAt: cohort.startedAt,
        completedAt: new Date().toISOString(),
        sourceCount: sources.length,
        acceptance: report.acceptance.pass,
      });
    }
    report.completedPasses = cohort.completedPasses;
    await checkpointStore.saveRecords('audit-cohorts', [cohort]);
    await checkpointStore.updateRecords('audit-pass-reports', (current) => [
      ...current.filter(({ id }) => id !== cohort.auditPass),
      { id: cohort.auditPass, report },
    ]);
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
