#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { Api, TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';

import { parseTelegramOffer, serializeOffers } from '../src/index.js';
import {
  DEFAULT_DISCOVERY_QUERIES,
  anonymizeListing,
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
  };
  const valued = new Map([
    ['--bot-env', 'botEnv'],
    ['--folder', 'folder'],
    ['--max-messages', 'maxMessages'],
    ['--max-sources', 'maxSources'],
    ['--months', 'months'],
    ['--output', 'output'],
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
      add(await client.getEntity(peer), 'folder-filter');
    } catch {
      // One inaccessible peer must not hide the remaining folder.
    }
  }
  try {
    const dialogs = await client.getDialogs({ folder: filter.id, limit: 500 });
    for (const dialog of dialogs) {
      add(dialog.entity, 'folder-dialog');
    }
  } catch {
    // Custom folders may be fully represented by includePeers alone.
  }
  return {
    entities: resolved,
    ignoredPrivateDialogs: ignoredPrivateDialogs.size,
    ignoredUnsupportedPeers: ignoredUnsupportedPeers.size,
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
      const found = await client.invoke(
        new Api.contacts.Search({ limit: 100, q: query })
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
    linksSerialized: 0,
    mediaOnlyCandidates: 0,
    messagesScanned: 0,
    missingDetails: [],
    parserOffers: 0,
    relevantOffers: 0,
    truncated: false,
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

function recordMessage(audit, message, source, options, report, alias) {
  const text = message.message || message.text || '';
  const classification = classifyAccommodationPost(
    text,
    Boolean(message.media)
  );
  if (classification.mediaOnlyCandidate) {
    audit.mediaOnlyCandidates += 1;
  }
  if (classification.demand && classification.accommodation) {
    audit.accommodationRequests += 1;
  }
  if (!classification.relevant) {
    return;
  }
  audit.relevantOffers += 1;
  const offer = parseTelegramOffer({
    chat: { username: source.public?.username },
    date: dateValue(message.date),
    messageId: message.id,
    sourceId: `telegram:${alias}`,
    text,
  });
  if (!offer) {
    return;
  }
  audit.parserOffers += 1;
  const problems = offerProblems(offer, text);
  audit.missingDetails.push(...problems);
  try {
    serializeOffers([offer]);
    audit.linksSerialized += 1;
  } catch {
    audit.missingDetails.push('links-serialization-failed');
  }
  addExamples(report, alias, text, offer, problems, options.redactedExcerpts);
}

async function auditSource(client, source, options, report, privateIndex) {
  const alias =
    source.public?.username || `private-folder-source-${privateIndex}`;
  const audit = emptySourceAudit(alias);
  const cutoff = cutoffDate(report.generatedAt, options.months);
  try {
    for await (const message of client.iterMessages(source.entity, {
      limit: options.maxMessages,
    })) {
      const date = dateValue(message.date);
      if (!Number.isFinite(date.getTime()) || date < cutoff) {
        break;
      }
      audit.messagesScanned += 1;
      recordMessage(audit, message, source, options, report, alias);
    }
    audit.truncated = audit.messagesScanned >= options.maxMessages;
  } catch (error) {
    audit.error = errorSummary(error);
  }
  audit.missingDetails = countBy(audit.missingDetails);
  return audit;
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

export async function runAudit(options) {
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
      canonicalTypedAssociations: false,
      note: 'Links Notation output stores an opaque JSON data link, so a typed binary/text projection is still required.',
    },
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
    const filtersResult = await client.invoke(
      new Api.messages.GetDialogFilters()
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
        };
    const folderEntities = folderResolution.entities;
    report.folder.ignoredPrivateDialogs =
      folderResolution.ignoredPrivateDialogs;
    report.folder.ignoredUnsupportedPeers =
      folderResolution.ignoredUnsupportedPeers;
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

    const audits = [];
    let privateIndex = 0;
    for (const source of sources) {
      if (!source.public) {
        privateIndex += 1;
      }
      audits.push(
        await auditSource(client, source, options, report, privateIndex)
      );
    }
    report.sources = audits;
    report.parser = {
      accommodationRequestsExcluded: audits.reduce(
        (total, audit) => total + audit.accommodationRequests,
        0
      ),
      linksSerialized: audits.reduce(
        (total, audit) => total + audit.linksSerialized,
        0
      ),
      mediaOnlyCandidates: audits.reduce(
        (total, audit) => total + audit.mediaOnlyCandidates,
        0
      ),
      messagesScanned: audits.reduce(
        (total, audit) => total + audit.messagesScanned,
        0
      ),
      missingDetails: countBy(
        audits.flatMap((audit) =>
          Object.entries(audit.missingDetails).flatMap(([key, count]) =>
            Array.from({ length: count }, () => key)
          )
        )
      ),
      parserOffers: audits.reduce(
        (total, audit) => total + audit.parserOffers,
        0
      ),
      relevantOffers: audits.reduce(
        (total, audit) => total + audit.relevantOffers,
        0
      ),
      sourceErrors: audits.filter((audit) => audit.error).length,
      truncatedSources: audits.filter((audit) => audit.truncated).length,
    };
  } finally {
    await client.disconnect().catch(() => {});
    await client.destroy?.().catch(() => {});
  }
  return report;
}

async function main() {
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
