import { parseListingText } from './listing-parser.js';
import { convertToVnd, parsePrice } from './pricing.js';
import { canonicalizeUrl, firstPresent, stableHash } from './utils.js';

function compact(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optional(key, value) {
  return value === undefined ? {} : { [key]: value };
}

function optionalDate(value) {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined))];
}

function mergeArrays(...values) {
  return unique(values.flat().filter(Boolean));
}

function mergeLabeledFields(...fields) {
  const merged = {};
  for (const group of fields.filter(Boolean)) {
    for (const [key, values] of Object.entries(group)) {
      merged[key] = mergeArrays(merged[key] || [], values);
    }
  }
  return merged;
}

function mergeAttributes(offers) {
  const merged = {};
  for (const offer of offers) {
    for (const [key, value] of Object.entries(offer.attributes || {})) {
      if (key === 'amenities') {
        merged.amenities = mergeArrays(merged.amenities || [], value).sort();
      } else if (key === 'labeledFields') {
        merged.labeledFields = mergeLabeledFields(merged.labeledFields, value);
      } else if (value !== undefined) {
        merged[key] = value;
      }
    }
  }
  return Object.keys(merged).length ? merged : undefined;
}

function mergeContacts(offers) {
  const contacts = {};
  for (const offer of offers) {
    for (const [type, values] of Object.entries(offer.contacts || {})) {
      contacts[type] = mergeArrays(contacts[type] || [], values).sort();
    }
  }
  return Object.keys(contacts).length ? contacts : undefined;
}

function normalizedIdentityValue(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizedPhone(value) {
  return String(value || '').replace(/\D/gu, '');
}

function normalizedIdentifier(value) {
  return String(value || '')
    .normalize('NFC')
    .toLocaleLowerCase('en')
    .trim()
    .replace(/\s+/gu, '-');
}

function fingerprintKey(offer) {
  const location = normalizedIdentityValue(offer.location);
  if (!location) {
    return undefined;
  }
  const phones = (offer.contacts?.phone || [])
    .map(normalizedPhone)
    .filter((phone) => phone.length >= 8)
    .sort();
  const telegram = (offer.contacts?.telegram || [])
    .map(normalizedIdentityValue)
    .filter(Boolean)
    .sort();
  const contact = firstPresent(phones[0], telegram[0]);
  const area = offer.attributes?.areaM2;
  const bedrooms = offer.attributes?.bedrooms;
  const structure =
    Number.isFinite(area) && Number.isFinite(bedrooms)
      ? `${area}:${bedrooms}`
      : undefined;
  const title = normalizedIdentityValue(offer.title);
  const discriminator = contact
    ? `${contact}\n${firstPresent(structure, title)}`
    : structure && title
      ? `${structure}\n${title}`
      : undefined;
  return discriminator
    ? `fingerprint:${stableHash(
        contact
          ? `${location}\ncontact:${discriminator}`
          : `${location}\nstructure:${discriminator}`
      )}`
    : undefined;
}

export function canonicalizeOfferUrl(value) {
  return canonicalizeUrl(value);
}

function urlIdentityKeys(offer) {
  return [offer, ...(offer.variants || [])]
    .flatMap((variant) => [variant.officialUrl, variant.url])
    .map(canonicalizeOfferUrl)
    .filter(Boolean)
    .map((url) => `url:${url}`);
}

function externalIdentityKeys(identifiers) {
  return Object.entries(identifiers || {})
    .map(([namespace, value]) => [
      normalizedIdentityValue(namespace),
      normalizedIdentityValue(value),
    ])
    .filter(([namespace, value]) => namespace && value)
    .map(([namespace, value]) => `external:${namespace}:${value}`);
}

export function offerIdentityKeys(offer) {
  const keys = [
    ...(offer.identityKeys || []),
    ...urlIdentityKeys(offer),
    ...externalIdentityKeys(offer.identifiers),
  ];
  const propertyId = normalizedIdentifier(offer.attributes?.propertyId);
  const sourceId = normalizedIdentifier(offer.sourceId);
  if (propertyId && sourceId) {
    keys.push(`source-property:${sourceId}:${propertyId}`);
  }
  const fingerprint = fingerprintKey(offer);
  if (fingerprint) {
    keys.push(fingerprint);
  }
  return unique(keys);
}

function mergeParsedAttributes(parsed, explicit) {
  if (!explicit) {
    return parsed;
  }
  return {
    ...parsed,
    ...explicit,
    amenities: mergeArrays(
      parsed?.amenities || [],
      explicit.amenities || []
    ).sort(),
    labeledFields: mergeLabeledFields(
      parsed?.labeledFields,
      explicit.labeledFields
    ),
  };
}

function mergeParsedContacts(parsed, explicit) {
  if (!explicit) {
    return parsed;
  }
  const merged = {};
  for (const type of new Set([
    ...Object.keys(parsed || {}),
    ...Object.keys(explicit),
  ])) {
    merged[type] = mergeArrays(parsed?.[type] || [], explicit[type] || []);
  }
  return merged;
}

export function normalizeOffer(input, options = {}) {
  const text = firstPresent(compact(input.text), compact(input.title), '');
  const parsed = parseListingText(text);
  const price = firstPresent(input.price, parsePrice(text));
  const rates = firstPresent(options.rates, { VND: 1 });
  const url = canonicalizeOfferUrl(compact(input.url));
  const sourceId = firstPresent(compact(input.sourceId), 'unknown');
  const officialUrl = canonicalizeOfferUrl(
    firstPresent(compact(input.officialUrl), parsed.officialUrl)
  );
  const generatedId = `${sourceId}:${stableHash(
    `${firstPresent(url, '')}\n${text}\n${firstPresent(input.postedAt, '')}`
  )}`;
  const id = firstPresent(compact(input.id), generatedId);
  const attributes = mergeParsedAttributes(parsed.attributes, input.attributes);
  const contacts = mergeParsedContacts(parsed.contacts, input.contacts);

  return {
    id,
    sourceId,
    ...optional('sourceType', compact(input.sourceType)),
    title: firstPresent(
      compact(input.title),
      text.split(/\r?\n/u)[0],
      'Accommodation'
    ),
    ...optional('intent', firstPresent(compact(input.intent), 'rental-offer')),
    ...optional('kind', firstPresent(compact(input.kind), parsed.kind)),
    ...optional('language', firstPresent(input.language, parsed.language)),
    ...optional(
      'location',
      firstPresent(compact(input.location), parsed.location)
    ),
    ...optional(
      'locationProvenance',
      firstPresent(input.locationProvenance, parsed.locationProvenance)
    ),
    ...optional('attributes', attributes),
    ...optional('contacts', contacts),
    ...optional('identifiers', input.identifiers),
    price,
    priceVnd: convertToVnd(price, rates),
    ...optional('url', url),
    ...optional('officialUrl', officialUrl),
    ...optional('searchQuery', compact(input.searchQuery)),
    photos: unique(firstPresent(input.photos, [])).filter(Boolean).slice(0, 10),
    ...optional('postedAt', optionalDate(input.postedAt)),
    collectedAt: firstPresent(options.now, new Date()).toISOString(),
    raw: firstPresent(input.raw, { ...input }),
  };
}

function timestamp(value) {
  const result = new Date(value || 0).getTime();
  return Number.isFinite(result) ? result : 0;
}

function sourceVariant(offer) {
  return {
    id: offer.id,
    sourceId: offer.sourceId,
    ...optional('sourceType', offer.sourceType),
    title: offer.title,
    ...optional('kind', offer.kind),
    ...optional('location', offer.location),
    ...optional('attributes', offer.attributes),
    ...optional('contacts', offer.contacts),
    ...optional('identifiers', offer.identifiers),
    ...optional('identityKeys', offer.identityKeys),
    ...optional('url', offer.url),
    ...optional('officialUrl', offer.officialUrl),
    price: offer.price,
    priceVnd: offer.priceVnd,
    photos: offer.photos || [],
    ...optional('searchQuery', offer.searchQuery),
    ...optional('postedAt', offer.postedAt),
    collectedAt: offer.collectedAt,
    ...optional('provenance', offer.provenance),
    raw: offer.raw,
  };
}

function variantsFrom(offer) {
  return offer.variants?.length ? offer.variants : [sourceVariant(offer)];
}

function observationFromVariant(variant) {
  if (!Number.isFinite(variant.priceVnd)) {
    return undefined;
  }
  return {
    amount: variant.price?.amount,
    currency: variant.price?.currency,
    period: variant.price?.period,
    priceVnd: variant.priceVnd,
    sourceId: variant.sourceId,
    sourceType: variant.sourceType,
    observedAt: variant.collectedAt,
    ...optional('url', variant.officialUrl || variant.url),
    official: variant.sourceType === 'official-web',
  };
}

function priceHistory(offers, variants) {
  const observations = offers
    .flatMap((offer) => offer.priceHistory || [])
    .concat(variants.map(observationFromVariant).filter(Boolean));
  const uniqueObservations = new Map();
  for (const observation of observations) {
    const key = [
      observation.sourceId,
      observation.observedAt,
      observation.priceVnd,
      observation.currency,
      observation.period,
    ].join('\n');
    uniqueObservations.set(key, observation);
  }
  return [...uniqueObservations.values()].sort(
    (left, right) => timestamp(left.observedAt) - timestamp(right.observedAt)
  );
}

function detectPriceChanges(history) {
  const bySource = new Map();
  for (const observation of history) {
    if (observation.official) {
      bySource.set(observation.sourceId, [
        ...(bySource.get(observation.sourceId) || []),
        observation,
      ]);
    }
  }
  const changes = [];
  for (const [sourceId, observations] of bySource) {
    for (let index = 1; index < observations.length; index += 1) {
      const previous = observations[index - 1];
      const current = observations[index];
      if (current.priceVnd === previous.priceVnd) {
        continue;
      }
      const deltaVnd = current.priceVnd - previous.priceVnd;
      changes.push({
        sourceId,
        direction: deltaVnd < 0 ? 'down' : 'up',
        previousPriceVnd: previous.priceVnd,
        currentPriceVnd: current.priceVnd,
        deltaVnd,
        percent: (deltaVnd / previous.priceVnd) * 100,
        detectedAt: current.observedAt,
        ...optional('url', current.url),
      });
    }
  }
  return changes.sort(
    (left, right) => timestamp(left.detectedAt) - timestamp(right.detectedAt)
  );
}

function currentPrice(history) {
  const latestBySource = new Map();
  for (const observation of history) {
    latestBySource.set(observation.sourceId, observation);
  }
  return [...latestBySource.values()].sort(
    (left, right) => left.priceVnd - right.priceVnd
  )[0];
}

function deduplicateVariants(offers) {
  const variants = new Map();
  for (const variant of offers.flatMap(variantsFrom)) {
    const key = [variant.id, variant.sourceId, variant.collectedAt].join('\n');
    variants.set(key, variant);
  }
  return [...variants.values()].sort(
    (left, right) => timestamp(left.collectedAt) - timestamp(right.collectedAt)
  );
}

function mergeIdentifiers(offers) {
  return Object.assign({}, ...offers.map((offer) => offer.identifiers || {}));
}

function mergeOfferGroup(group) {
  const offers = [...group].sort(
    (left, right) => timestamp(left.collectedAt) - timestamp(right.collectedAt)
  );
  const oldest = offers[0];
  const newest = offers.at(-1);
  const variants = deduplicateVariants(offers);
  const history = priceHistory(offers, variants);
  const changes = detectPriceChanges(history);
  const current = currentPrice(history);
  const sourceIds = unique(
    offers.flatMap((offer) => offer.sourceIds || [offer.sourceId])
  ).sort();
  const sourceTypes = unique(
    offers.flatMap((offer) => offer.sourceTypes || [offer.sourceType])
  )
    .filter(Boolean)
    .sort();
  const searchQueries = unique(
    offers.flatMap((offer) => offer.searchQueries || [offer.searchQuery])
  ).filter(Boolean);
  const identifiers = mergeIdentifiers(offers);
  const identityKeys = unique(offers.flatMap(offerIdentityKeys)).sort();
  const officialUrl = offers.findLast(
    (offer) => offer.officialUrl
  )?.officialUrl;

  return {
    ...newest,
    id: oldest.id,
    sourceId: current?.sourceId || newest.sourceId,
    sourceIds,
    identityKeys,
    ...optional('officialUrl', officialUrl),
    ...optional('sourceTypes', sourceTypes.length ? sourceTypes : undefined),
    ...optional('attributes', mergeAttributes(offers)),
    ...optional('contacts', mergeContacts(offers)),
    ...optional(
      'identifiers',
      Object.keys(identifiers).length ? identifiers : undefined
    ),
    ...optional(
      'searchQueries',
      searchQueries.length ? searchQueries : undefined
    ),
    photos: mergeArrays(...offers.map((offer) => offer.photos || [])).slice(
      0,
      10
    ),
    price:
      current?.amount !== undefined && current.currency && current.period
        ? {
            amount: current.amount,
            currency: current.currency,
            period: current.period,
          }
        : newest.price,
    priceVnd: current?.priceVnd ?? newest.priceVnd,
    priceHistory: history,
    priceChanges: changes,
    ...optional('priceChange', changes.at(-1)),
    variants,
    collectedAt: newest.collectedAt,
  };
}

function find(parents, index) {
  if (parents[index] !== index) {
    parents[index] = find(parents, parents[index]);
  }
  return parents[index];
}

function union(parents, left, right) {
  const leftRoot = find(parents, left);
  const rightRoot = find(parents, right);
  if (leftRoot !== rightRoot) {
    parents[rightRoot] = leftRoot;
  }
}

export function deduplicateOffers(offers) {
  const parents = offers.map((_, index) => index);
  const keyedOffer = new Map();
  const ids = new Map();
  for (const [index, offer] of offers.entries()) {
    if (ids.has(offer.id)) {
      union(parents, index, ids.get(offer.id));
    } else {
      ids.set(offer.id, index);
    }
    for (const key of offerIdentityKeys(offer)) {
      if (keyedOffer.has(key)) {
        union(parents, index, keyedOffer.get(key));
      } else {
        keyedOffer.set(key, index);
      }
    }
  }
  const groups = new Map();
  for (const [index, offer] of offers.entries()) {
    const root = find(parents, index);
    groups.set(root, [...(groups.get(root) || []), offer]);
  }
  return [...groups.values()].map(mergeOfferGroup);
}

export function removeOfferMessageVariants(offer, sourceId, messageIds) {
  const matches = (variant) => {
    const provenance = variant.provenance;
    const variantMessageIds = [
      provenance?.messageId,
      ...(provenance?.messageIds || []),
    ].filter((value) => value !== undefined);
    return (
      String(provenance?.sourceId || variant.sourceId) === String(sourceId) &&
      variantMessageIds.some((messageId) => messageIds.has(String(messageId)))
    );
  };
  const variants = variantsFrom(offer);
  const remaining = variants.filter((variant) => !matches(variant));
  if (remaining.length === variants.length) {
    return offer;
  }
  if (!remaining.length) {
    return undefined;
  }
  const rebuilt = deduplicateOffers(remaining)[0];
  return { ...rebuilt, id: offer.id };
}
