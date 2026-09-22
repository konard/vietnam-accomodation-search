export const DOMAIN_GRAPH_SCHEMA_VERSION = 1;

export const DOMAIN_ENTITY_TYPES = new Set([
  'telegram-identity',
  'transport',
  'community',
  'topic',
  'message',
  'edit',
  'deletion',
  'album',
  'media',
  'discovery',
  'raw-material',
  'offer',
  'property',
  'price',
  'contact',
  'unknown',
  'parser-run',
  'delivery',
  'trace-run',
  'trace-stage',
  'trace-segment',
  'retry-decision',
  'completeness-summary',
]);

export const SEMANTIC_STATES = new Set([
  'known',
  'not-mentioned',
  'missing',
  'explicitly-false',
  'inherited',
  'unknown',
  'ambiguous',
  'irrelevant',
  'unresolved',
  'parser-failed',
  'extraction-failed',
  'transport-unavailable',
  'deleted',
]);

export function createSemanticValue(state, value, metadata = {}) {
  if (!SEMANTIC_STATES.has(state)) {
    throw new TypeError(`Unsupported semantic state: ${state}`);
  }
  return {
    state,
    ...(value === undefined ? {} : { value }),
    ...metadata,
  };
}

function leafRecords(subject, prefix, value, records) {
  if (value === undefined) {
    return;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, nested] of Object.entries(value)) {
      leafRecords(subject, `${prefix}.${key}`, nested, records);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((nested, index) =>
      leafRecords(subject, `${prefix}.${index}`, nested, records)
    );
    return;
  }
  records.push({
    id: `${subject}#${prefix}`,
    object: value,
    predicate: prefix,
    schemaVersion: DOMAIN_GRAPH_SCHEMA_VERSION,
    subject,
    type: 'semantic-link',
  });
}

export function createDomainRecords({ id, type, values = {} }) {
  if (!id || !DOMAIN_ENTITY_TYPES.has(type)) {
    throw new TypeError(
      'A stable id and supported domain entity type are required.'
    );
  }
  validatePublicRecord(values);
  const records = [
    {
      id,
      schemaVersion: DOMAIN_GRAPH_SCHEMA_VERSION,
      type,
    },
  ];
  for (const [key, value] of Object.entries(values)) {
    leafRecords(id, `${type}.${key}`, value, records);
  }
  return records;
}

const PRIVATE_KEY =
  /(?:access.?hash|session|authorization|cookie|password|private.?peer|raw.?phone|raw.?email)/iu;

export function validatePublicRecord(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') {
    return true;
  }
  if (seen.has(value)) {
    return true;
  }
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (PRIVATE_KEY.test(key)) {
      throw new Error(`Private graph field is forbidden: ${key}`);
    }
    validatePublicRecord(nested, seen);
  }
  return true;
}
