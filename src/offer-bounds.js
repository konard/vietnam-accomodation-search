// Persisted offers hold only bounded, JSON-safe data (#82). Provider objects
// such as GramJS `MessageMediaPhoto` carry thumbnail bytes and file
// references; associative storage would write one link per byte.

// Telegram limits message text and media captions to 4096 characters.
export const RAW_TEXT_LIMIT = 4096;
export const RAW_ARRAY_LIMIT = 20;
export const RAW_DEPTH_LIMIT = 4;
export const RAW_BYTE_LIMIT = 8 * 1024;
export const PHOTO_LIMIT = 10;
// Variants and price observations accumulate with every collection of a
// listing; only the newest are kept, so a merged offer stays bounded.
export const VARIANT_LIMIT = 32;
export const PRICE_HISTORY_LIMIT = 64;
// Photo entries are remote IDs or image URLs; longer strings are not IDs.
const PHOTO_ID_LIMIT = 2048;
// Fields duplicated elsewhere in the offer (`mediaIds` is `photos`), or
// holding nested provider data.
const DROPPED_RAW_KEYS = new Set(['mediaIds', 'members', 'photos', 'raw']);
// Fields kept when an otherwise safe raw subset still exceeds its budget.
const CORE_RAW_KEYS = [
  'id',
  'messageId',
  'messageIds',
  'sourceId',
  'url',
  'date',
  'editDate',
  'groupedId',
  'topicId',
  'media',
  'entities',
  'ocrState',
  'discoveredFrom',
  'caption',
  'text',
];

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Includes `{type: 'Buffer', data: [...]}`, the JSON form earlier releases
// persisted for GramJS file references and thumbnails.
function isBinary(value) {
  return (
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer ||
    (isPlainObject(value) &&
      value.type === 'Buffer' &&
      Array.isArray(value.data))
  );
}

// Returns a non-empty string for scalar identifiers, including bigint and the
// big-integer `Integer` objects GramJS uses for 64-bit IDs. Objects without a
// numeric string form, buffers, and empty values have no identity.
export function scalarId(value) {
  if (typeof value === 'string') {
    return value && value.length <= PHOTO_ID_LIMIT ? value : undefined;
  }
  if (
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  if (
    value &&
    typeof value === 'object' &&
    !isBinary(value) &&
    typeof value.toString === 'function' &&
    value.toString !== Object.prototype.toString
  ) {
    const text = value.toString();
    return /^-?\d{1,40}$/u.test(text) ? text : undefined;
  }
  return undefined;
}

function mediaContentId(media) {
  const content = media?.raw || media;
  return firstScalar([
    content?.photo?.id,
    content?.document?.id,
    content?.webpage?.photo?.id,
    content?.webpage?.document?.id,
    content?.id,
    media?.id,
  ]);
}

function firstScalar(values) {
  for (const value of values) {
    const id = scalarId(value);
    if (id !== undefined) {
      return id;
    }
  }
  return undefined;
}

// Stable scalar media identity for GramJS, mtcute, and normalized messages.
export function mediaIdentity(message) {
  return firstScalar([
    message.mediaId,
    mediaContentId(message.media),
    // Normalized fixtures may already carry a scalar media reference.
    message.media,
    message.photo?.id,
    message.document?.id,
    message.photos?.[0],
  ]);
}

export function boundedPhotos(photos) {
  const result = [];
  for (const photo of Array.isArray(photos) ? photos : []) {
    const id =
      typeof photo === 'object' && photo !== null
        ? firstScalar([mediaContentId(photo), photo.photo?.id])
        : scalarId(photo);
    if (id !== undefined && !result.includes(id)) {
      result.push(id);
    }
    if (result.length === PHOTO_LIMIT) {
      break;
    }
  }
  return result;
}

function mediaSummary(media) {
  const content = media?.raw || media;
  const id = mediaContentId(media);
  const type = [content?._, media?.type, content?.className].find(
    (value) => typeof value === 'string' && value
  );
  const mimeType = [
    media?.mimeType,
    content?.document?.mimeType,
    content?.mimeType,
  ].find((value) => typeof value === 'string' && value);
  const summary = {
    ...(id === undefined ? {} : { id }),
    ...(mimeType ? { mimeType } : {}),
    ...(type ? { type } : {}),
  };
  return Object.keys(summary).length ? summary : undefined;
}

function safeValue(value, depth) {
  if (typeof value === 'string') {
    return value.length > RAW_TEXT_LIMIT
      ? value.slice(0, RAW_TEXT_LIMIT)
      : value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'boolean' || value === null) {
    return value;
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
  }
  if (depth >= RAW_DEPTH_LIMIT) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, RAW_ARRAY_LIMIT)
      .map((item) => safeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!isPlainObject(value) || isBinary(value)) {
    // Buffers, typed arrays, class instances, maps, and functions are never
    // persisted. Scalar-like objects keep their numeric string form.
    return scalarId(value);
  }
  return safeEntries(value, depth);
}

function safeEntries(value, depth) {
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (DROPPED_RAW_KEYS.has(key)) {
      continue;
    }
    const safe =
      key === 'media' ? mediaSummary(item) : safeValue(item, depth + 1);
    if (safe !== undefined) {
      result[key] = safe;
    }
  }
  return result;
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

// Returns a bounded, JSON-safe copy of an offer's source record.
export function boundedRaw(raw) {
  if (
    raw === null ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    isBinary(raw)
  ) {
    return {};
  }
  // A provider message instance keeps its own fields; nested provider
  // objects are still reduced to scalar IDs.
  const safe = safeEntries(raw, 0);
  if (jsonBytes(safe) <= RAW_BYTE_LIMIT) {
    return safe;
  }
  const core = {};
  for (const key of CORE_RAW_KEYS) {
    if (safe[key] !== undefined) {
      core[key] = safe[key];
    }
  }
  // Text is kept for search, but never beyond the byte budget.
  while (jsonBytes(core) > RAW_BYTE_LIMIT && typeof core.text === 'string') {
    core.text = core.text.slice(0, Math.floor(core.text.length / 2));
  }
  return jsonBytes(core) <= RAW_BYTE_LIMIT ? core : {};
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function boundedRecord(record) {
  const photos = boundedPhotos(record.photos);
  const raw = record.raw === undefined ? undefined : boundedRaw(record.raw);
  const photosChanged = !sameJson(photos, record.photos || []);
  const rawChanged = raw !== undefined && !sameJson(raw, record.raw);
  if (!photosChanged && !rawChanged) {
    return record;
  }
  return {
    ...record,
    ...(record.photos === undefined && !photos.length ? {} : { photos }),
    ...(raw === undefined ? {} : { raw }),
  };
}

// Keeps the newest `limit` entries of a list ordered oldest first.
export function newestEntries(entries, limit) {
  return entries.length > limit ? entries.slice(-limit) : entries;
}

function boundedLists(offer) {
  const lists = {};
  for (const [key, limit] of [
    ['priceChanges', PRICE_HISTORY_LIMIT],
    ['priceHistory', PRICE_HISTORY_LIMIT],
    ['variants', VARIANT_LIMIT],
  ]) {
    if (Array.isArray(offer[key]) && offer[key].length > limit) {
      lists[key] = newestEntries(offer[key], limit);
    }
  }
  return lists;
}

// Rewrites a stored offer and its variants to the bounded shape. Returns the
// same object when nothing changes, so callers can detect a needed migration.
export function boundStoredOffer(offer) {
  const lists = boundedLists(offer);
  const source = Object.keys(lists).length ? { ...offer, ...lists } : offer;
  const bounded = boundedRecord(source);
  if (!Array.isArray(source.variants)) {
    return bounded;
  }
  const variants = source.variants.map(boundedRecord);
  if (variants.every((variant, index) => variant === source.variants[index])) {
    return bounded;
  }
  return { ...bounded, variants };
}
