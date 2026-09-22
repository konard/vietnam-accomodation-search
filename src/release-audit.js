import { redactTraceValue } from './trace.js';

export const RELEASE_AUDIT_SCHEMA_VERSION = 1;

export const RELEASE_AUDIT_GATES = Object.freeze([
  'offline-fixtures',
  'bot-only',
  'user-only',
  'combined-routing',
  'private-dialog-filter',
  'nha-trang-40',
  'two-month-resume',
  'reviewed-parser-corpus',
  'typed-lino-clink',
  'fresh-subscriptions',
  'docker-handoff-rollback',
  'browser-en',
  'browser-ru',
  'browser-vi',
  'correlated-traces',
]);

const PASSING = new Set(['pass', 'success']);

function gateStatus(value) {
  return typeof value === 'string' ? value : value?.status;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested, seen);
  }
  return Object.freeze(value);
}

function releaseIdentity(release = {}) {
  return {
    tag: release.tag || release.tagName,
    commitSha: release.commitSha || release.sha || release.targetCommitish,
    packageVersion: release.packageVersion,
    ...(release.imageDigest ? { imageDigest: release.imageDigest } : {}),
    ...(release.publishedAt ? { publishedAt: release.publishedAt } : {}),
  };
}

export function compareReleaseAudit(baseline = {}, candidate = {}) {
  const regressions = [];
  const improvements = [];
  const gateNames = new Set([
    ...Object.keys(baseline.gates || {}),
    ...Object.keys(candidate.gates || {}),
  ]);
  for (const gate of gateNames) {
    const previous = gateStatus(baseline.gates?.[gate]);
    const next = gateStatus(candidate.gates?.[gate]);
    if (PASSING.has(previous) && !PASSING.has(next)) {
      regressions.push(gate);
    } else if (!PASSING.has(previous) && PASSING.has(next)) {
      improvements.push(gate);
    }
  }
  return deepFreeze({
    baselineRelease: releaseIdentity(baseline.release),
    candidateRelease: releaseIdentity(candidate.release),
    changed:
      JSON.stringify(releaseIdentity(baseline.release)) !==
      JSON.stringify(releaseIdentity(candidate.release)),
    improvements: improvements.sort(),
    regressions: regressions.sort(),
    schemaVersion: RELEASE_AUDIT_SCHEMA_VERSION,
  });
}

export function evaluateReleaseGate({
  credentials,
  mode = 'fixture',
  competingPoller = false,
} = {}) {
  if (mode === 'live' && !credentials) {
    return { reason: 'live-credentials-unavailable', status: 'pending' };
  }
  if (mode === 'live' && competingPoller) {
    return { reason: 'competing-live-poller', status: 'failure' };
  }
  if (!['fixture', 'dry-run', 'live'].includes(mode)) {
    return { reason: 'unsupported-mode', status: 'failure' };
  }
  return { reason: `${mode}-ready`, status: 'ready' };
}

export function selectReleaseForAudit(
  releases = [],
  { auditedTags = [], overrideTag } = {}
) {
  const candidates = releases
    .filter(({ draft }) => !draft)
    .sort((left, right) =>
      String(left.publishedAt || '').localeCompare(
        String(right.publishedAt || '')
      )
    );
  if (overrideTag) {
    return candidates.find(
      (release) => (release.tag || release.tagName) === overrideTag
    );
  }
  const audited = new Set(auditedTags);
  return candidates.find(
    (release) => !audited.has(release.tag || release.tagName)
  );
}

function normalizeGate(value) {
  if (typeof value === 'string') {
    return { status: value };
  }
  if (!value) {
    return { reason: 'evidence-not-recorded', status: 'pending' };
  }
  return redactTraceValue(value);
}

// eslint-disable-next-line complexity -- Audit creation enumerates independent release gates in one signed evidence record.
export function createReleaseAudit({
  competingPoller = false,
  credentials = false,
  gates = {},
  mode = 'fixture',
  now = () => new Date(),
  release = {},
  runtime = {},
} = {}) {
  const identity = releaseIdentity(release);
  const readiness = evaluateReleaseGate({
    competingPoller,
    credentials,
    mode,
  });
  const normalizedGates = Object.fromEntries(
    RELEASE_AUDIT_GATES.map((name) => [name, normalizeGate(gates[name])])
  );
  if (readiness.status !== 'ready') {
    normalizedGates['live-authorization'] = readiness;
  }
  if (
    mode === 'live' &&
    (!identity.tag || !identity.commitSha || !identity.packageVersion)
  ) {
    normalizedGates['release-identity'] = {
      reason: 'release-identity-incomplete',
      status: 'pending',
    };
  }
  const statuses = Object.values(normalizedGates).map(gateStatus);
  const status = statuses.includes('failure')
    ? 'failure'
    : statuses.every((value) => PASSING.has(value))
      ? 'pass'
      : 'pending';
  return deepFreeze(
    redactTraceValue({
      schemaVersion: RELEASE_AUDIT_SCHEMA_VERSION,
      auditMode: mode,
      observedAt: now().toISOString(),
      release: identity,
      runtime: {
        node: runtime.node || globalThis.process?.version,
        platform: runtime.platform || globalThis.process?.platform,
        ...(runtime.imageDigest ? { imageDigest: runtime.imageDigest } : {}),
      },
      gates: normalizedGates,
      status,
    })
  );
}
