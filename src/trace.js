import { createHash } from 'node:crypto';

const SENSITIVE_KEY =
  /(?:authorization|cookie|token|secret|session|password|phone|email|address|handle|username|access.?hash|private.?peer)/iu;
const EMAIL = /[\p{L}\d.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)+/giu;
// A slash-delimited numeric path is an immutable artifact/run identifier, not
// a phone number. Requiring a non-slash boundary keeps those URLs intact while
// preserving redaction for ordinary prose and key/value contacts.
const PHONE = /(?<![/\d])\+?\d[\d\s().-]{7,20}\d/gu;
const AUTHORIZATION = /\b(?:Basic|Bearer)\s+[A-Za-z\d._~+/=-]+/giu;
const BOT_TOKEN = /\b\d{6,12}:[A-Za-z\d_-]{20,}\b/gu;
const SECRET_ASSIGNMENT =
  /\b(?:api[_-]?hash|authorization|cookie|password|secret|session|token)\s*=\s*[^\s,;]+/giu;

export const TRACE_SCHEMA_VERSION = 1;
export const TRACE_STATUSES = new Set([
  'start',
  'success',
  'degraded',
  'failure',
  'cancelled',
]);

function redactString(value) {
  return value
    .replace(AUTHORIZATION, '[REDACTED]')
    .replace(BOT_TOKEN, '[REDACTED]')
    .replace(SECRET_ASSIGNMENT, '[REDACTED]')
    .replace(EMAIL, '[REDACTED]')
    .replace(PHONE, (candidate) =>
      /^\d{4}-\d{2}-\d{2}$/u.test(candidate) ? candidate : '[REDACTED]'
    );
}

// eslint-disable-next-line complexity -- Recursive redaction handles each scalar, error, cycle, array, and object boundary explicitly.
export function redactTraceValue(value, seen = new WeakSet(), key = '') {
  if (SENSITIVE_KEY.test(key)) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);
  if (value instanceof Error) {
    return {
      name: redactString(value.name || 'Error'),
      message: redactString(value.message || ''),
      ...['code', 'status', 'statusCode'].reduce((result, field) => {
        if (value[field] !== undefined) {
          result[field] = redactTraceValue(value[field], seen, field);
        }
        return result;
      }, {}),
      ...(value.cause === undefined
        ? {}
        : { cause: redactTraceValue(value.cause, seen, 'cause') }),
      ...(Array.isArray(value.errors)
        ? { errors: redactTraceValue(value.errors, seen, 'errors') }
        : {}),
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactTraceValue(item, seen));
  }
  const result = {};
  for (const [nestedKey, nestedValue] of Object.entries(value)) {
    result[nestedKey] = redactTraceValue(nestedValue, seen, nestedKey);
  }
  return result;
}

function normalizeSegmentState(state) {
  if (state === 'mapped' || state === 'error') {
    return state;
  }
  return 'reviewed-unknown';
}

export function createSegmentLedger(value, classify = () => ({})) {
  const segments = String(value)
    .split(/\r?\n/gu)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => {
      const decision = classify({ index, text }) || {};
      const metadata = { ...decision };
      delete metadata.state;
      delete metadata.text;
      return {
        id: `segment:${index + 1}`,
        hash: createHash('sha256').update(text.normalize('NFC')).digest('hex'),
        length: [...text].length,
        position: index,
        state: normalizeSegmentState(decision.state),
        ...metadata,
      };
    });
  const counts = { error: 0, mapped: 0, reviewedUnknown: 0 };
  for (const { state } of segments) {
    if (state === 'reviewed-unknown') {
      counts.reviewedUnknown += 1;
    } else {
      counts[state] += 1;
    }
  }
  const coverage = segments.length
    ? (counts.mapped + counts.reviewedUnknown) / segments.length
    : 0;
  return { segments, summary: { ...counts, coverage } };
}

export class TraceRecorder {
  constructor({ maxEvents = 2_000, now = () => new Date(), store } = {}) {
    if (!Number.isInteger(maxEvents) || maxEvents < 1) {
      throw new TypeError('maxEvents must be a positive integer.');
    }
    this.events = [];
    this.dropped = 0;
    this.maxEvents = maxEvents;
    this.now = now;
    this.store = store;
  }

  record({ metadata = {}, runId, stage, status, ...identifiers }) {
    if (!runId || !stage || !TRACE_STATUSES.has(status)) {
      throw new TypeError(
        'Trace events require runId, stage, and a valid status.'
      );
    }
    const event = redactTraceValue({
      schemaVersion: TRACE_SCHEMA_VERSION,
      type: 'trace-event',
      sequence: this.dropped + this.events.length + 1,
      observedAt: this.now().toISOString(),
      runId,
      stage,
      status,
      ...identifiers,
      metadata,
    });
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
      this.dropped += 1;
    }
    return event;
  }

  export() {
    return {
      schemaVersion: TRACE_SCHEMA_VERSION,
      dropped: this.dropped,
      events: this.events.map((event) => ({ ...event })),
    };
  }

  async persist() {
    const snapshot = this.export();
    const dropNotice = snapshot.dropped
      ? [
          {
            id: 'trace-retention',
            schemaVersion: TRACE_SCHEMA_VERSION,
            dropped: snapshot.dropped,
            retained: snapshot.events.length,
            type: 'trace-retention',
          },
        ]
      : [];
    const records = [
      ...dropNotice,
      ...snapshot.events.map((event) => ({
        ...event,
        id: `trace:${event.runId}:${event.sequence}`,
      })),
    ];
    const merge = (existing = []) => {
      const byId = new Map(existing.map((record) => [record.id, record]));
      for (const record of records) {
        byId.set(record.id, record);
      }
      return [...byId.values()].slice(-this.maxEvents - 1);
    };
    if (typeof this.store?.updateRecords === 'function') {
      await this.store.updateRecords('traces', merge);
    } else if (this.store?.saveRecords) {
      const existing = (await this.store.loadRecords?.('traces')) || [];
      await this.store.saveRecords('traces', merge(existing));
    }
    return snapshot;
  }
}
