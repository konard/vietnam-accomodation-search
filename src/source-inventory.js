import { freshAt, collectionKey } from './search-refresh.js';

export function canonicalSource(source) {
  if (!['telegram', 'channel', 'chat', 'megagroup'].includes(source.type)) {
    return { ...source };
  }
  const handle =
    source.username ||
    source.telegram?.username ||
    String(source.url || '').match(
      /t\.me\/(?:s\/)?([a-z][a-z\d_]+)(?:[/?#]|$)/iu
    )?.[1] ||
    source.id.replace(/^telegram:/u, '');
  const username = handle.replace(/^@/u, '').toLowerCase();
  const id = /^(?:peer:)?-?\d+$/u.test(username)
    ? `telegram:peer:${username.replace(/^peer:/u, '')}`
    : `telegram:${username}`;
  return {
    ...source,
    type: 'telegram',
    id,
    aliases: [...new Set([...(source.aliases || []), source.id, id])],
    ...(/^-?\d|^peer:/u.test(username) ? {} : { username }),
  };
}

// eslint-disable-next-line complexity -- Canonicalization merges identity, cohort and disabled-state provenance atomically.
export function sourceInventory(seeds, stored = []) {
  const map = new Map();
  const peers = new Map();
  for (const entry of [...seeds, ...stored]) {
    const source = canonicalSource(entry);
    const peer = source.peerId || source.telegram?.peerId;
    if (source.type === 'telegram' && peer) {
      if (peers.has(String(peer))) {
        source.aliases = [...new Set([...(source.aliases || []), source.id])];
        source.id = peers.get(String(peer));
      } else {
        peers.set(String(peer), source.id);
      }
    }
    const previous = map.get(source.id);
    if (source.type === 'telegram') {
      source.focuses = [
        ...new Set([
          ...(previous?.focuses || []),
          ...(source.focuses || []),
          source.focus || 'nationwide',
        ]),
      ];
    }
    // Manifest-disabled entries cannot be revived by a stale persisted copy.
    map.set(source.id, {
      ...previous,
      ...source,
      aliases: [
        ...new Set([...(previous?.aliases || []), ...(source.aliases || [])]),
      ],
      ...(previous?.enabled === false
        ? { enabled: false, reason: previous.reason }
        : {}),
    });
  }
  return [...map.values()]
    .map((source) => ({
      ...source,
      capability: source.retired
        ? 'retired'
        : source.enabled === false
          ? 'disabled'
          : ['web', 'telegram', 'official-web'].includes(source.type)
            ? 'supported'
            : 'unsupported',
      catalogueState: source.retired
        ? 'retired'
        : source.enabled === false
          ? 'disabled'
          : 'enabled',
      coverage: 'unverified',
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function coverageFields(cards) {
  return Object.fromEntries(
    ['bedrooms', 'rooms', 'beds'].map((field) => [
      field,
      {
        known: cards.filter((offer) =>
          Number.isSafeInteger(offer.attributes?.[field])
        ).length,
        positive: cards.filter((offer) => offer.attributes?.[field] > 0).length,
        total: cards.length,
        accuracy: 'not-evaluated',
      },
    ])
  );
}

function collectionFlags(source, outcome, fresh) {
  const enabled =
    source.catalogueState === 'enabled' && source.capability === 'supported';
  const fetched =
    !!fresh &&
    ['offers', 'empty'].includes(outcome?.status) &&
    outcome?.historyComplete !== false;
  const parseComplete = outcome?.parseComplete === true;
  const paginationComplete =
    outcome?.paginationComplete === true ||
    (source.type === 'telegram' && outcome?.historyComplete === true);
  return { enabled, fetched, parseComplete, paginationComplete };
}

function accessClassification(outcome) {
  return outcome?.category || outcome?.status || 'pending';
}

// eslint-disable-next-line complexity -- The row exposes independent freshness, collection and review evidence without defaulting unknown values to complete.
function completenessRow(
  source,
  { byId, current, offers, query, now, maxAgeMs }
) {
  const identities = [source.id, ...(source.aliases || [])];
  const state = identities
    .map((id) => byId.get(collectionKey(id, query)))
    .find(Boolean);
  const outcome =
    identities.map((id) => current.get(id)).find(Boolean) || state;
  const cards = offers.filter((offer) =>
    (offer.sourceIds || [offer.sourceId]).some((id) => identities.includes(id))
  );
  const fresh = state && freshAt(state.collectedAt, now, maxAgeMs);
  const { enabled, fetched, parseComplete, paginationComplete } =
    collectionFlags(source, outcome, fresh);
  const fieldCoverage = coverageFields(cards);
  return {
    sourceId: source.id,
    type: source.type,
    capability: source.capability,
    catalogueState: source.catalogueState,
    access: enabled
      ? accessClassification(outcome)
      : source.reason || source.catalogueState,
    observedAt: state?.attemptedAt || null,
    fresh: !!fresh,
    fetchComplete: fetched,
    parseComplete,
    paginationComplete,
    window: outcome?.historyCheckpoint || null,
    offers: cards.length,
    fieldCoverage,
    collectionComplete:
      enabled && fetched && parseComplete && paginationComplete,
    reviewComplete: outcome?.reviewComplete === true,
    complete:
      enabled &&
      fetched &&
      parseComplete &&
      paginationComplete &&
      outcome?.reviewComplete === true,
  };
}

export function sourceCompleteness({
  inventory,
  states,
  outcomes = [],
  offers,
  query,
  now,
  maxAgeMs,
}) {
  const current = new Map(
    outcomes.map((outcome) => [outcome.sourceId, outcome])
  );
  const byId = new Map(states.map((state) => [state.id, state]));
  const rows = inventory.map((source) =>
    completenessRow(source, { byId, current, offers, query, now, maxAgeMs })
  );
  const supported = rows.filter((row) => row.capability === 'supported');
  const outstandingSources = supported
    .filter((row) => !row.complete)
    .map((row) => row.sourceId);
  return {
    mode: 'exhaustive',
    observedAt: now.toISOString(),
    inventory: rows,
    outstandingSources,
    excludedSources: rows
      .filter((row) => row.capability !== 'supported')
      .map((row) => ({ sourceId: row.sourceId, reason: row.access })),
    complete: supported.length > 0 && outstandingSources.length === 0,
    verdict:
      supported.length > 0 && outstandingSources.length === 0
        ? 'complete'
        : 'incomplete',
    rankingScope:
      'best comparable offers among observed eligible results; global optimality unverified',
  };
}
