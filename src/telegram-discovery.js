import { retryTelegramOperation } from './telegram-errors.js';
import { TraceRecorder } from './trace.js';

export const TELEGRAM_DISCOVERY_SCHEMA_VERSION = 1;

export const TELEGRAM_DISCOVERY_QUERIES = Object.freeze({
  version: TELEGRAM_DISCOVERY_SCHEMA_VERSION,
  // eslint-disable-next-line local/no-changelog-comments -- Reproducible discovery evidence requires its observation date.
  reviewedAt: '2026-09-22',
  queries: Object.freeze([
    {
      id: 'en-rent-nha-trang',
      language: 'en',
      text: 'Nha Trang apartment rent',
    },
    {
      id: 'en-housing-nha-trang',
      language: 'en',
      text: 'Nha Trang housing rental',
    },
    {
      id: 'en-property-nha-trang',
      language: 'en',
      text: 'Nha Trang property for rent',
    },
    { id: 'en-vietnam-rent', language: 'en', text: 'Vietnam apartment rent' },
    { id: 'ru-rent-nha-trang', language: 'ru', text: 'Нячанг аренда квартиры' },
    { id: 'ru-housing-nha-trang', language: 'ru', text: 'Нячанг аренда жилья' },
    {
      id: 'ru-property-nha-trang',
      language: 'ru',
      text: 'Нячанг недвижимость аренда',
    },
    { id: 'ru-vietnam-rent', language: 'ru', text: 'Вьетнам аренда квартиры' },
    {
      id: 'vi-rent-nha-trang',
      language: 'vi',
      text: 'Nha Trang căn hộ cho thuê',
    },
    {
      id: 'vi-housing-nha-trang',
      language: 'vi',
      text: 'Nha Trang nhà ở cho thuê',
    },
    {
      id: 'vi-room-nha-trang',
      language: 'vi',
      text: 'Nha Trang phòng cho thuê',
    },
    { id: 'vi-vietnam-rent', language: 'vi', text: 'Việt Nam căn hộ cho thuê' },
  ]),
});

export function classifyTelegramEntity(entity) {
  const constructor = String(entity?._ || entity?.type || '').toLocaleLowerCase(
    'en'
  );
  if (
    constructor === 'user' ||
    constructor === 'userempty' ||
    constructor.startsWith('user')
  ) {
    return { accepted: false, reason: 'private-user' };
  }
  if (constructor === 'chat' || constructor === 'chatforbidden') {
    return constructor === 'chatforbidden'
      ? { accepted: false, reason: 'inaccessible-chat' }
      : { accepted: true, kind: 'chat' };
  }
  if (constructor === 'channel' || constructor === 'channelforbidden') {
    if (constructor === 'channelforbidden') {
      return { accepted: false, reason: 'inaccessible-channel' };
    }
    return {
      accepted: true,
      kind: entity.megagroup ? 'megagroup' : 'channel',
    };
  }
  return { accepted: false, reason: 'unsupported-entity' };
}

function normalizedUsername(entity) {
  return String(entity.username || '')
    .replace(/^@/u, '')
    .toLocaleLowerCase('en');
}

function normalizedAliases(entity) {
  const aliases = [
    entity.username,
    ...(entity.usernames || []).map((item) => item?.username || item),
  ];
  return [
    ...new Set(
      aliases
        .map((value) =>
          String(value || '')
            .replace(/^@/u, '')
            .toLocaleLowerCase('en')
        )
        .filter(Boolean)
    ),
  ];
}

function sourceKey(entity) {
  if (entity.id !== undefined) {
    return `peer:${String(entity.id)}`;
  }
  const username = normalizedUsername(entity);
  return username ? `username:${username}` : undefined;
}

function identityKeys(entity) {
  const keys = [];
  if (entity.id !== undefined) {
    keys.push(`peer:${String(entity.id)}`);
  }
  const username = normalizedUsername(entity);
  if (username) {
    keys.push(`username:${username}`);
  }
  for (const migratedId of [entity.migratedToId, entity.migratedFromChatId]) {
    if (migratedId !== undefined && migratedId !== null) {
      keys.push(`peer:${String(migratedId)}`);
    }
  }
  return [...new Set(keys)];
}

// eslint-disable-next-line complexity -- One normalization boundary maps all Telegram entity and evidence variants.
function sourceFrom(candidate, kind, focus, observedAt) {
  const { entity, evidence = {}, transport } = candidate;
  const username = normalizedUsername(entity);
  const peerId = entity.id === undefined ? undefined : String(entity.id);
  const key = sourceKey(entity);
  if (!key || (!username && peerId === undefined)) {
    return null;
  }
  const audience = Number(evidence.audience || entity.participantsCount || 0);
  return {
    id: username ? `telegram:${username}` : `telegram:peer:${peerId}`,
    name: entity.title || entity.username || `Telegram ${kind}`,
    type: 'telegram',
    access:
      transport === 'public-preview'
        ? 'public-preview'
        : transport === 'bot-api'
          ? 'bot-membership'
          : transport === 'mtproto'
            ? 'user-session-visible'
            : 'configured',
    accessCapabilities: [transport],
    languages: [
      ...new Set(
        [...(evidence.languages || []), evidence.language].filter(Boolean)
      ),
    ],
    lastSuccessfulScan: observedAt,
    telegram: { kind, peerId, ...(username ? { username } : {}) },
    ...(username
      ? {
          url: `https://t.me/${username}`,
          searchUrl: `https://t.me/s/${username}`,
        }
      : {}),
    ...(focus ? { focus } : {}),
    popularity: {
      metric: 'members-or-subscribers',
      value: Number.isFinite(audience) ? audience : 0,
      evidenceUrl:
        evidence.url || (username ? `https://t.me/${username}` : undefined),
      observedAt,
      limitations:
        'Audience values are volatile and inaccessible communities remain degraded, never inferred.',
    },
    provenance: [
      {
        transport,
        ...(evidence.queryId ? { queryId: evidence.queryId } : {}),
        ...(evidence.language ? { language: evidence.language } : {}),
        observedAt,
      },
    ],
    aliases: normalizedAliases(entity),
    identityKeys: identityKeys(entity),
    key,
  };
}

function mergeSource(previous, next) {
  const provenanceKeys = new Set(
    previous.provenance.map(
      ({ queryId, transport }) => `${transport}:${queryId || ''}`
    )
  );
  const provenance = [...previous.provenance];
  for (const item of next.provenance) {
    const key = `${item.transport}:${item.queryId || ''}`;
    if (!provenanceKeys.has(key)) {
      provenanceKeys.add(key);
      provenance.push(item);
    }
  }
  return {
    ...previous,
    ...(next.popularity.value > previous.popularity.value
      ? { popularity: next.popularity }
      : {}),
    aliases: [...new Set([...previous.aliases, ...next.aliases])],
    accessCapabilities: [
      ...new Set([...previous.accessCapabilities, ...next.accessCapabilities]),
    ],
    identityKeys: [
      ...new Set([...previous.identityKeys, ...next.identityKeys]),
    ],
    provenance,
    languages: [...new Set([...previous.languages, ...next.languages])],
    telegram: { ...previous.telegram, ...next.telegram },
  };
}

function publicSources(byKey, maxResults) {
  return [...byKey.values()]
    .sort(
      (left, right) =>
        right.popularity.value - left.popularity.value ||
        left.id.localeCompare(right.id)
    )
    .slice(0, maxResults)
    .map((source) => {
      const publicSource = { ...source };
      delete publicSource.identityKeys;
      delete publicSource.key;
      return publicSource;
    });
}

function restoreCheckpointSource(source) {
  const peerId = source.telegram?.peerId;
  const username = source.telegram?.username;
  const identities = [
    ...(peerId === undefined ? [] : [`peer:${String(peerId)}`]),
    ...(username
      ? [`username:${String(username).toLocaleLowerCase('en')}`]
      : []),
    ...(source.aliases || []).map(
      (alias) => `username:${String(alias).toLocaleLowerCase('en')}`
    ),
  ];
  return {
    ...source,
    identityKeys: [...new Set(identities)],
    key:
      identities[0] ||
      (source.id ? `source:${String(source.id)}` : 'source:checkpoint'),
  };
}

function usernameFromSource(source) {
  return (
    source.telegram?.username ||
    source.url?.match(/t\.me\/(?:s\/)?([^/?#]+)/iu)?.[1]
  );
}

export class ConfiguredTelegramDiscoveryProvider {
  constructor({ focusSources = [], sources = [] } = {}) {
    this.focusSources = focusSources;
    this.name = 'configured';
    this.sources = sources;
  }

  discover({ focus } = {}) {
    const sources = focus === 'nha-trang' ? this.focusSources : this.sources;
    return sources.map((source) => ({
      entity: {
        _: source.telegram?.kind === 'chat' ? 'chat' : 'channel',
        id: source.telegram?.peerId,
        participantsCount: source.popularity?.value,
        title: source.name,
        username: usernameFromSource(source),
      },
      evidence: {
        audience: source.popularity?.value,
        languages: source.languages,
        url: source.popularity?.evidenceUrl || source.url,
      },
      transport: this.name,
    }));
  }
}

export class PublicPreviewTelegramDiscoveryProvider {
  constructor({ candidates = [], discover, focusCandidates = [] } = {}) {
    this.candidates = candidates;
    this.discoverPublic = discover;
    this.focusCandidates = focusCandidates;
    this.name = 'public-preview';
  }

  async discover({ focus, signal } = {}) {
    const candidates =
      focus === 'nha-trang' ? this.focusCandidates : this.candidates;
    const sources =
      (await this.discoverPublic?.('telegram', {
        candidates,
        focus,
        signal,
      })) || [];
    return sources.map((source) => ({
      entity: {
        _: 'channel',
        id: source.telegram?.peerId,
        participantsCount: source.popularity?.value,
        title: source.name,
        username: usernameFromSource(source),
      },
      evidence: {
        audience: source.popularity?.value,
        languages: source.languages,
        language: source.provenance?.at(-1)?.language,
        queryId: source.provenance?.at(-1)?.queryId,
        url: source.popularity?.evidenceUrl || source.url,
      },
      transport: this.name,
    }));
  }
}

function botEntity(chat) {
  // Bot API private chats are Users. Do not read any other property first.
  if (chat?.type === 'private') {
    return { _: 'user' };
  }
  if (chat?.type === 'group') {
    return {
      _: 'chat',
      id: chat.id,
      title: chat.title,
    };
  }
  if (chat?.type === 'supergroup' || chat?.type === 'channel') {
    return {
      _: 'channel',
      id: chat.id,
      megagroup: chat.type === 'supergroup',
      title: chat.title,
      username: chat.username,
    };
  }
  return { _: 'unsupported' };
}

export class BotApiTelegramDiscoveryProvider {
  constructor({
    api,
    candidates = [],
    concurrency = 4,
    focusCandidates = [],
  } = {}) {
    this.api = api;
    this.candidates = candidates;
    this.concurrency = Math.max(1, concurrency);
    this.focusCandidates = focusCandidates;
    this.name = 'bot-api';
  }

  async discover({ focus, signal } = {}) {
    const candidates =
      focus === 'nha-trang' ? this.focusCandidates : this.candidates;
    const queue = [...candidates];
    const results = [];
    results.failures = [];
    const worker = async () => {
      while (queue.length) {
        if (signal?.aborted) {
          throw signal.reason || new Error('Telegram discovery cancelled.');
        }
        const source = queue.shift();
        const username = usernameFromSource(source);
        if (!username) {
          continue;
        }
        try {
          const chat = await retryTelegramOperation(
            () => this.api.getChat(`@${username}`),
            {
              idempotent: true,
              maxAttempts: 3,
              operationName: 'bot-api-discovery-get-chat',
              signal,
              sourceId: source.id,
              transport: this.name,
            }
          );
          results.push({
            entity: botEntity(chat),
            evidence: {
              audience: source.popularity?.value,
              url: source.url,
            },
            transport: this.name,
          });
        } catch (error) {
          if (signal?.aborted) {
            throw error;
          }
          results.failures.push({
            reason: error?.code || 'chat-unavailable',
            sourceId: source.id,
          });
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(this.concurrency, candidates.length) },
        worker
      )
    );
    return results;
  }
}

export class TelegramSourceDiscovery {
  constructor({
    checkpoint,
    now = () => new Date(),
    providers = [],
    store,
    traceRecorder,
  } = {}) {
    this.checkpoint = checkpoint;
    this.now = now;
    this.providers = providers;
    this.store = store;
    this.trace = traceRecorder || new TraceRecorder({ now, store });
  }

  addProvider(provider, { before = 'mtproto' } = {}) {
    this.providers = this.providers.filter(
      ({ name }) => name !== provider.name
    );
    const index = this.providers.findIndex(({ name }) => name === before);
    this.providers.splice(
      index < 0 ? this.providers.length : index,
      0,
      provider
    );
  }

  // eslint-disable-next-line complexity, max-lines-per-function -- Discovery keeps provider checkpoints, identity merging, and trace terminal states atomic.
  async discover({
    focus,
    maxResults = focus === 'nha-trang' ? 40 : 20,
    queries = TELEGRAM_DISCOVERY_QUERIES.queries,
    signal,
  } = {}) {
    const byKey = new Map();
    const identityIndex = new Map();
    const rejected = [];
    const failures = [];
    const checkpointKey = focus || 'nationwide';
    const savedCheckpoints =
      (await this.store?.loadRecords?.('telegram-discovery-checkpoint')) || [];
    const saved = savedCheckpoints.find(
      ({ complete, id }) => id === checkpointKey && complete === false
    );
    const completedProviders = new Set(saved?.completedProviders || []);
    for (const publicSource of saved?.sources || []) {
      const source = restoreCheckpointSource(publicSource);
      byKey.set(source.key, source);
      for (const identity of source.identityKeys) {
        identityIndex.set(identity, source.key);
      }
    }
    for (const provider of this.providers) {
      if (completedProviders.has(provider.name)) {
        continue;
      }
      const runId = `telegram-discovery:${focus || 'nationwide'}:${provider.name}`;
      this.trace.record({
        runId,
        stage: 'capability-selection',
        status: 'start',
        metadata: { provider: provider.name },
      });
      this.trace.record({
        runId,
        stage: 'capability-selection',
        status: 'success',
        metadata: { provider: provider.name },
      });
      this.trace.record({
        runId,
        stage: 'discovery',
        status: 'start',
        metadata: { provider: provider.name },
      });
      if (signal?.aborted) {
        await this.checkpoint?.({
          complete: false,
          completedProviders: [...completedProviders],
          focus: checkpointKey,
          reason: 'cancelled',
          provider: provider.name,
          sources: publicSources(byKey, maxResults),
        });
        this.trace.record({
          runId,
          stage: 'discovery',
          status: 'cancelled',
        });
        await this.trace.persist();
        throw signal.reason || new Error('Telegram discovery cancelled.');
      }
      let candidates;
      try {
        candidates =
          (await provider.discover({ focus, queries, signal })) || [];
      } catch (error) {
        failures.push({
          provider: provider.name,
          reason: error?.code || 'provider-failure',
        });
        await this.checkpoint?.({
          complete: false,
          completedProviders: [...completedProviders],
          focus: checkpointKey,
          provider: provider.name,
          reason: 'provider-failure',
          sources: publicSources(byKey, maxResults),
        });
        this.trace.record({
          runId,
          stage: 'discovery',
          status: 'failure',
          metadata: {
            category: error?.code || 'provider-failure',
            provider: provider.name,
          },
        });
        continue;
      }
      for (const failure of candidates.failures || []) {
        failures.push({ provider: provider.name, ...failure });
      }
      for (const candidate of candidates) {
        const classification = classifyTelegramEntity(candidate.entity);
        if (!classification.accepted) {
          rejected.push({
            reason: classification.reason,
            transport: candidate.transport || provider.name,
          });
          continue;
        }
        const observedAt = this.now().toISOString();
        const source = sourceFrom(
          { ...candidate, transport: candidate.transport || provider.name },
          classification.kind,
          focus,
          observedAt
        );
        if (!source) {
          rejected.push({
            reason: 'missing-public-identity',
            transport: candidate.transport || provider.name,
          });
          continue;
        }
        const existingKey = source.identityKeys
          .map((key) => identityIndex.get(key))
          .find(Boolean);
        const selectedKey = existingKey || source.key;
        const merged = byKey.has(selectedKey)
          ? mergeSource(byKey.get(selectedKey), source)
          : source;
        byKey.set(selectedKey, merged);
        for (const identity of merged.identityKeys) {
          identityIndex.set(identity, selectedKey);
        }
      }
      if (!candidates.failures?.length) {
        completedProviders.add(provider.name);
      }
      await this.checkpoint?.({
        complete: false,
        completedProviders: [...completedProviders],
        focus: checkpointKey,
        provider: provider.name,
        sourceCount: byKey.size,
        sources: publicSources(byKey, maxResults),
      });
      this.trace.record({
        runId,
        stage: 'discovery',
        status: candidates.failures?.length ? 'degraded' : 'success',
        metadata: {
          failures: candidates.failures?.length || 0,
          provider: provider.name,
          sourceCount: byKey.size,
        },
      });
    }
    const sources = publicSources(byKey, maxResults);
    const complete = failures.length === 0;
    await this.checkpoint?.({
      complete,
      completedProviders: [...completedProviders],
      failures,
      focus: checkpointKey,
      sourceCount: sources.length,
      sources,
    });
    await this.trace.persist();
    return { complete, failures, rejected, sources };
  }
}
