#!/usr/bin/env node

// Manual read-only Telegram history audit. Private pages are checksummed and
// checkpointed independently of product storage. No history/message cap is
// silently counted as complete. Parser evidence distinguishes the production
// age gate from historical text extraction; neither is human-labelled recall.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import {
  assembleTelegramAlbums,
  classifyTelegramPost,
  LinksStore,
  parseTelegramOffer,
} from '../src/index.js';
import { mediaIdentity } from '../src/telegram-pipeline.js';
import {
  assertManualLocalRun,
  errorSummary,
  missingExpectedDetails,
} from './telegram-accommodation-audit-lib.mjs';
import {
  environmentFile,
  userCredentials,
} from './telegram-bot-conversation-e2e.mjs';
import { retryTelegramFloodWait } from './telegram-live-audit-runtime.mjs';

const DAY_MS = 86_400_000;
const USAGE =
  'TELEGRAM_HISTORY_AUDIT=1 node experiments/telegram-90-day-coverage-audit.mjs ' +
  '--user-env PATH --cohort-directory CHECKPOINT_DIRECTORY ' +
  '--state-directory PRIVATE_DIRECTORY [--days 90] [--concurrency 1]';

export function parseHistoryAuditArguments(values) {
  const options = { days: 90, concurrency: 1 };
  const names = {
    '--user-env': 'userEnv',
    '--cohort-directory': 'cohortDirectory',
    '--state-directory': 'stateDirectory',
    '--days': 'days',
    '--concurrency': 'concurrency',
  };
  for (let index = 0; index < values.length; index++) {
    if (values[index] === '--help') {
      return { help: true };
    }
    const name = names[values[index]];
    if (!name || !values[index + 1]) {
      throw new TypeError(`Unknown or incomplete option: ${values[index]}`);
    }
    options[name] = values[++index];
  }
  options.days = Number(options.days);
  if (!Number.isInteger(options.days) || options.days < 90) {
    throw new RangeError('--days must be an integer of at least 90.');
  }
  options.concurrency = Number(options.concurrency);
  if (
    !Number.isInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > 4
  ) {
    throw new RangeError('--concurrency must be an integer from 1 to 4.');
  }
  if (!options.userEnv || !options.cohortDirectory || !options.stateDirectory) {
    throw new TypeError(
      '--user-env, --cohort-directory and --state-directory are required.'
    );
  }
  return options;
}

export async function historySourceWorkers(sources, concurrency, operation) {
  let next = 0;
  const results = [];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, sources.length) }, async () => {
      while (next < sources.length) {
        const index = next++;
        results[index] = await operation(sources[index], index);
      }
    })
  );
  return results;
}

export function historySourcePlan(sources) {
  // Public channels finish before high-volume discussion groups, without
  // changing frozen source ordinals or excluding any retained source.
  return sources
    .map((source, index) => ({ source, index }))
    .sort(
      (left, right) =>
        Number(left.source.type === 'group') -
        Number(right.source.type === 'group')
    );
}

async function jsonFile(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function saveJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function normalizedHistoryMessage(message, username) {
  const date = new Date(
    typeof message.date === 'number' ? message.date * 1000 : message.date
  );
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) {
    throw new Error('Telegram returned an invalid message date.');
  }
  const groupedId = message.groupedId ?? message.grouped_id;
  const mediaId = mediaIdentity(message);
  return {
    id: Number(message.id),
    date: date.toISOString(),
    editDate: message.editDate,
    chatId: `telegram:${username}`,
    sourceId: `telegram:${username}`,
    ...(groupedId === undefined ? {} : { groupedId: String(groupedId) }),
    ...(mediaId === undefined ? {} : { mediaId: String(mediaId) }),
    mediaType: message.media?.className,
    service: message.className === 'MessageService',
    text: message.message || message.text || '',
  };
}

export function analyzeHistoryMessages(
  messages,
  { username, now, targetLocation = 'nha-trang' }
) {
  const materials = assembleTelegramAlbums(messages);
  const counts = {
    messages: messages.length,
    uniqueMessageIds: new Set(messages.map(({ id }) => id)).size,
    materials: materials.length,
    accountedMessages: materials.reduce(
      (sum, material) => sum + material.messageIds.length,
      0
    ),
    productionOffers: 0,
    historicalTextOffers: 0,
    ageGateRejections: 0,
    parserErrors: 0,
    photoOnlyUnresolved: 0,
    multipleDifferentAlbumCaptions: 0,
    labels: {},
    missingExpectedFields: {},
  };
  const findings = [];
  for (const material of materials) {
    const differentCaptions = new Set(
      material.members.map(({ text }) => text.trim()).filter(Boolean)
    );
    if (differentCaptions.size > 1) {
      counts.multipleDifferentAlbumCaptions++;
    }
    if (!material.text.trim() && material.mediaIds.length) {
      counts.photoOnlyUnresolved++;
      findings.push({
        id: material.id,
        kind: 'unresolved-media-only',
        messageIds: material.messageIds,
      });
      continue;
    }
    const relevance = classifyTelegramPost(material.text, { targetLocation });
    counts.labels[relevance.label] = (counts.labels[relevance.label] || 0) + 1;
    if (!relevance.eligible) {
      findings.push({
        id: material.id,
        kind: 'classified-exclusion',
        label: relevance.label,
        reason: relevance.reason,
      });
      continue;
    }
    const message = {
      ...material,
      chat: { username },
      messageId: material.messageIds[0],
      photos: material.mediaIds,
    };
    try {
      const production = parseTelegramOffer(message, { now });
      // Parsing at publication time tests text extraction without changing
      // the product's 2-month age gate or claiming old offers are current.
      const historical = parseTelegramOffer(message, {
        now: new Date(material.date),
      });
      counts.productionOffers += Number(Boolean(production));
      counts.historicalTextOffers += Number(Boolean(historical));
      counts.ageGateRejections += Number(Boolean(historical) && !production);
      if (historical) {
        const missing = missingExpectedDetails(historical, material.text);
        for (const field of missing) {
          counts.missingExpectedFields[field] =
            (counts.missingExpectedFields[field] || 0) + 1;
        }
        findings.push({
          id: material.id,
          kind: 'eligible-offer',
          ageGateRejected: !production,
          missing,
          priceVnd: historical.priceVnd,
          price: historical.price,
          attributes: historical.attributes,
          location: historical.location,
        });
      } else {
        findings.push({ id: material.id, kind: 'empty-parser-result' });
      }
    } catch (error) {
      counts.parserErrors++;
      findings.push({
        id: material.id,
        kind: 'parser-error',
        ...errorSummary(error),
      });
    }
  }
  return {
    counts,
    findings,
    limitation:
      'Classifier agreement and expected-field heuristics are not independently reviewed precision or recall. Media OCR has not run in this coverage collector.',
  };
}

export async function retainedMessages(directory, pages) {
  const messages = [];
  for (let ordinal = 1; ordinal <= pages; ordinal++) {
    const page = await jsonFile(
      join(directory, `page-${String(ordinal).padStart(6, '0')}.json`)
    );
    if (!page || digest(page.payload) !== page.digest) {
      throw new Error(
        'Private history page is missing or has a checksum mismatch.'
      );
    }
    messages.push(...page.payload.messages);
  }
  return messages;
}

export async function resolvePublicHistoryCommunity(client, source) {
  const entity = await retryTelegramFloodWait(() =>
    client.getEntity(source.username)
  );
  if (entity.className !== 'Channel' || !entity.username) {
    throw new Error(
      'The selected source no longer resolves to a public Telegram community.'
    );
  }
  return entity;
}

// eslint-disable-next-line complexity -- One resumable source boundary owns public-peer verification, page evidence and its durable checkpoint.
export async function collectSource(
  client,
  source,
  cohort,
  directory,
  ordinal
) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'checkpoint.json');
  const checkpoint = (await jsonFile(path)) || {
    username: source.username,
    pages: 0,
    messages: 0,
    cutoff: cohort.cutoff,
    startedAt: cohort.startedAt,
    complete: false,
  };
  if (
    checkpoint.cutoff !== cohort.cutoff ||
    checkpoint.startedAt !== cohort.startedAt ||
    checkpoint.username !== source.username
  ) {
    throw new Error(
      'Source checkpoint does not match its frozen history cohort.'
    );
  }
  const entity = await resolvePublicHistoryCommunity(client, source);
  while (!checkpoint.complete) {
    const page = await retryTelegramFloodWait(() =>
      client.getMessages(entity, {
        limit: 100,
        offsetId: checkpoint.offsetId || 0,
      })
    );
    const normalized = page.map((message) =>
      normalizedHistoryMessage(message, source.username)
    );
    const ids = normalized.map(({ id }) => id);
    if (
      ids.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
      ids.some((id, index) => index > 0 && id >= ids[index - 1])
    ) {
      throw new Error(
        'Telegram history IDs are invalid, duplicated or non-descending.'
      );
    }
    if (checkpoint.offsetId && ids.length && ids[0] >= checkpoint.offsetId) {
      throw new Error('Telegram pagination did not advance to older messages.');
    }
    const boundary = normalized.find(({ date }) => date < cohort.cutoff);
    const messages = normalized.filter(
      ({ date }) => date >= cohort.cutoff && date <= cohort.startedAt
    );
    const payload = {
      offsetId: checkpoint.offsetId,
      nextOffsetId: ids.at(-1),
      boundaryDate: boundary?.date,
      messages,
    };
    const nextPage = checkpoint.pages + 1;
    await saveJson(
      join(directory, `page-${String(nextPage).padStart(6, '0')}.json`),
      { payload, digest: digest(payload) }
    );
    checkpoint.pages = nextPage;
    checkpoint.messages += messages.length;
    checkpoint.offsetId = ids.at(-1) || checkpoint.offsetId;
    checkpoint.oldestRetrievedAt =
      normalized.at(-1)?.date || checkpoint.oldestRetrievedAt;
    checkpoint.complete = Boolean(boundary) || normalized.length === 0;
    checkpoint.reason = boundary
      ? cohort.cutoffReason || '90-day-cutoff-reached'
      : normalized.length === 0
        ? 'history-exhausted'
        : 'in-progress';
    checkpoint.updatedAt = new Date().toISOString();
    await saveJson(path, checkpoint);
    if (checkpoint.pages % 10 === 0 || checkpoint.complete) {
      console.log(
        JSON.stringify({
          stage: 'history-page',
          ordinal,
          pages: checkpoint.pages,
          messages: checkpoint.messages,
          complete: checkpoint.complete,
        })
      );
    }
    await delay(250);
  }
  const analysis = analyzeHistoryMessages(
    await retainedMessages(directory, checkpoint.pages),
    {
      username: source.username,
      now: new Date(cohort.startedAt),
      ...(source.geographicFocus
        ? { targetLocation: source.focus === 'nha-trang' ? 'nha-trang' : null }
        : {}),
    }
  );
  await saveJson(join(directory, 'analysis.json'), analysis);
  return { ...checkpoint, counts: analysis.counts };
}

export async function runHistoryCoverageAudit(options) {
  assertManualLocalRun(process.env);
  if (Number(process.versions.node.split('.')[0]) < 22) {
    throw new Error(
      'The local history audit requires supported Node.js 22 or newer.'
    );
  }
  if (process.env.TELEGRAM_HISTORY_AUDIT !== '1') {
    throw new Error(
      'Set TELEGRAM_HISTORY_AUDIT=1 for the manual read-only history audit.'
    );
  }
  const stateDirectory = resolve(options.stateDirectory);
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const store = new LinksStore({ directory: options.cohortDirectory });
  const sourceCohort = (await store.loadRecords('audit-cohorts'))[0];
  if (
    !sourceCohort?.sources?.length ||
    sourceCohort.sources.some(
      ({ username }) => !/^[A-Za-z][A-Za-z\d_]{3,31}$/u.test(username)
    )
  ) {
    throw new Error('A retained cohort of named public sources is required.');
  }
  const cohortPath = join(stateDirectory, 'cohort.json');
  const startedAt = new Date().toISOString();
  const cohort = (await jsonFile(cohortPath)) || {
    startedAt,
    cutoff: new Date(
      new Date(startedAt).getTime() - options.days * DAY_MS
    ).toISOString(),
    days: options.days,
    sources: sourceCohort.sources.map(
      ({ username, type, geographicFocus, focus }) => ({
        username,
        type,
        ...(geographicFocus ? { geographicFocus } : {}),
        ...(focus ? { focus } : {}),
      })
    ),
  };
  if (cohort.days !== options.days) {
    throw new Error(
      'Use a new state directory for a different history window.'
    );
  }
  await saveJson(cohortPath, cohort);
  const credentials = await userCredentials(
    await environmentFile(options.userEnv)
  );
  const client = new TelegramClient(
    new StringSession(credentials.session),
    credentials.apiId,
    credentials.apiHash,
    { autoReconnect: false, connectionRetries: 2, requestRetries: 2 }
  );
  client.setLogLevel?.('none');
  const results = [];
  let reportWrites = Promise.resolve();
  const parserRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
  }).trim();
  try {
    await client.connect();
    if (!(await client.checkAuthorization())) {
      throw new Error('The existing user session is not authorized.');
    }
    console.log(
      JSON.stringify({
        stage: 'history-started',
        days: cohort.days,
        cutoff: cohort.cutoff,
        sources: cohort.sources.length,
        concurrency: options.concurrency,
      })
    );
    await historySourceWorkers(
      historySourcePlan(cohort.sources),
      options.concurrency,
      async ({ source, index }) => {
        const ordinal = index + 1;
        console.log(JSON.stringify({ stage: 'source-started', ordinal }));
        try {
          results[index] = await collectSource(
            client,
            source,
            cohort,
            join(stateDirectory, `source-${String(ordinal).padStart(2, '0')}`),
            ordinal
          );
        } catch (error) {
          results[index] = {
            username: source.username,
            complete: false,
            ...errorSummary(error),
          };
        }
        // Serialize report writes so a slow earlier rename cannot overwrite a
        // later snapshot. Source checkpoints remain independent and atomic.
        reportWrites = reportWrites.then(() =>
          saveJson(join(stateDirectory, 'report.json'), {
            cohort,
            runtimeNode: process.versions.node,
            parserRevision,
            results: results.filter(Boolean),
            complete:
              results.filter(Boolean).length === cohort.sources.length &&
              results.filter(Boolean).every(({ complete }) => complete),
          })
        );
        await reportWrites;
        console.log(
          JSON.stringify({
            stage: 'source-finished',
            ordinal,
            complete: results[index].complete,
            messages: results[index].messages,
            counts: results[index].counts,
            error: results[index].type,
          })
        );
        return results[index];
      }
    );
    return {
      cohort,
      results,
      complete: results.every(({ complete }) => complete),
    };
  } finally {
    await client.disconnect().catch(() => {});
    await client.destroy?.().catch(() => {});
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const options = parseHistoryAuditArguments(process.argv.slice(2));
    if (options.help) {
      console.log(USAGE);
    } else {
      process.exitCode = (await runHistoryCoverageAudit(options)).complete
        ? 0
        : 1;
    }
  } catch (error) {
    console.error(
      JSON.stringify({ stage: 'history-failed', ...errorSummary(error) })
    );
    process.exitCode = 1;
  }
}
