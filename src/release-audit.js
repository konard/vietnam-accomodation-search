import { redactTraceValue } from './trace.js';

export const RELEASE_AUDIT_SCHEMA_VERSION = 2;

export const RELEASE_AUDIT_GATES = Object.freeze([
  'offline-quality-and-clean-install',
  'node-tests-and-coverage',
  'bun-full-suite',
  'deno-full-suite',
  'published-npm-package',
  'production-docker-runtime',
  'host-bind-disaster-recovery',
  'deploy-first-install',
  'deploy-redeploy-handoff',
  'deploy-failed-candidate-rollback',
  'deploy-operations',
  'cache-restart-and-deduplication',
  'bot-only-authentication',
  'user-only-authentication',
  'combined-routing-and-authentication',
  'telegram-auth-lifecycle',
  'bot-menu-presets-and-filters',
  'fresh-subscriptions',
  'multiple-subscriptions',
  'empty-result-ux',
  'private-dialog-filter',
  'nha-trang-40-discovery',
  'two-month-resume',
  'reviewed-parser-corpus',
  'typed-lino-clink',
  'telegram-terminal-accounting',
  'browser-en',
  'browser-ru',
  'browser-vi',
  'browser-details-and-pagination',
  'browser-scheduler-and-cooldowns',
  'correlated-traces',
  'sensitive-data-sanitization',
  'regression-issue-22',
  'regression-issue-23',
  'regression-issue-24',
  'regression-issue-25',
  'regression-issue-27',
  'regression-issue-28',
]);

const PASSING = new Set(['pass', 'success']);
const FULL_SHA = /^[\da-f]{40}$/u;
const DIGEST = /^(?:sha256:[\da-f]{64}|sha(?:256|512)-[A-Za-z\d+/=_-]+)$/u;
const HTTPS_URL = /^https:\/\//u;

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
  const packageIdentity = release.package || {};
  const docker = release.docker || {};
  return {
    tag: release.tag || release.tagName,
    commitSha: release.commitSha || release.sha || release.targetCommitish,
    tagTargetSha: release.tagTargetSha,
    draft: release.draft,
    prerelease: release.prerelease,
    ...(release.publishedAt ? { publishedAt: release.publishedAt } : {}),
    ...(release.releaseUrl ? { releaseUrl: release.releaseUrl } : {}),
    ...(release.workflowRunUrl
      ? { workflowRunUrl: release.workflowRunUrl }
      : {}),
    packageVersion: packageIdentity.version || release.packageVersion,
    package: {
      name: packageIdentity.name,
      version: packageIdentity.version || release.packageVersion,
      installedVersion: packageIdentity.installedVersion,
      integrity: packageIdentity.integrity,
      ...(packageIdentity.tarball ? { tarball: packageIdentity.tarball } : {}),
    },
    docker: {
      image: docker.image,
      version: docker.version,
      manifestDigest: docker.manifestDigest || release.imageDigest,
      platforms: docker.platforms,
    },
    runtimes: release.runtimes,
    schemas: release.schemas,
    baseline: release.baseline,
  };
}

function validDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function digestOf(value) {
  return typeof value === 'string' ? value : value?.digest;
}

// eslint-disable-next-line complexity -- Every immutable identity field has an independent missing/conflict verdict.
function releaseIdentityAssessment(identity, runtime) {
  const missing = [];
  const conflicts = [];
  const required = [
    ['release-tag', identity.tag],
    ['tested-commit-sha', identity.commitSha],
    ['tag-target-sha', identity.tagTargetSha],
    ['release-published-at', identity.publishedAt],
    ['release-url', identity.releaseUrl],
    ['workflow-run-url', identity.workflowRunUrl],
    ['npm-package-name', identity.package?.name],
    ['npm-package-version', identity.package?.version],
    ['installed-package-version', identity.package?.installedVersion],
    ['npm-package-integrity', identity.package?.integrity],
    ['docker-image', identity.docker?.image],
    ['docker-version', identity.docker?.version],
    ['docker-manifest-digest', identity.docker?.manifestDigest],
    [
      'docker-amd64-digest',
      digestOf(identity.docker?.platforms?.['linux/amd64']),
    ],
    [
      'docker-arm64-digest',
      digestOf(identity.docker?.platforms?.['linux/arm64']),
    ],
    ['node-version', runtime.node],
    ['bun-version', runtime.bun],
    ['deno-version', runtime.deno],
    ['schema-domain-graph', identity.schemas?.domainGraph],
    ['schema-links-notation', identity.schemas?.linksNotation],
    ['schema-release-audit', identity.schemas?.releaseAudit],
    ['schema-trace', identity.schemas?.trace],
    [
      'prior-release-baseline',
      identity.baseline?.tag || identity.baseline?.kind,
    ],
  ];
  for (const [name, value] of required) {
    if (value === undefined || value === null || value === '') {
      missing.push(name);
    }
  }
  if (identity.draft === true) {
    conflicts.push('release-is-draft');
  }
  if (identity.prerelease === true) {
    conflicts.push('release-is-prerelease');
  }
  if (identity.draft === undefined) {
    missing.push('release-draft-state');
  }
  if (identity.prerelease === undefined) {
    missing.push('release-prerelease-state');
  }
  if (identity.commitSha && !FULL_SHA.test(identity.commitSha)) {
    conflicts.push('tested-commit-sha-not-full');
  }
  if (identity.tagTargetSha && !FULL_SHA.test(identity.tagTargetSha)) {
    conflicts.push('tag-target-sha-not-full');
  }
  if (
    identity.commitSha &&
    identity.tagTargetSha &&
    identity.commitSha !== identity.tagTargetSha
  ) {
    conflicts.push('tag-target-does-not-match-tested-commit');
  }
  if (identity.publishedAt && !validDate(identity.publishedAt)) {
    conflicts.push('release-published-at-invalid');
  }
  if (identity.releaseUrl && !HTTPS_URL.test(identity.releaseUrl)) {
    conflicts.push('release-url-invalid');
  }
  if (identity.workflowRunUrl && !HTTPS_URL.test(identity.workflowRunUrl)) {
    conflicts.push('workflow-run-url-invalid');
  }
  if (
    identity.package?.name &&
    identity.package.name !== 'vietnam-accomodation-search'
  ) {
    conflicts.push('npm-package-name-mismatch');
  }
  if (
    identity.tag &&
    identity.package?.version &&
    identity.tag !== `v${identity.package.version}`
  ) {
    conflicts.push('tag-package-version-mismatch');
  }
  if (
    identity.package?.installedVersion &&
    identity.package?.version &&
    identity.package.installedVersion !== identity.package.version
  ) {
    conflicts.push('installed-package-version-mismatch');
  }
  if (
    identity.docker?.version &&
    identity.package?.version &&
    identity.docker.version !== identity.package.version
  ) {
    conflicts.push('docker-package-version-mismatch');
  }
  const digests = [
    identity.package?.integrity,
    identity.docker?.manifestDigest,
    digestOf(identity.docker?.platforms?.['linux/amd64']),
    digestOf(identity.docker?.platforms?.['linux/arm64']),
  ].filter(Boolean);
  if (digests.some((digest) => !DIGEST.test(digest))) {
    conflicts.push('artifact-digest-invalid');
  }
  if (
    identity.schemas?.releaseAudit &&
    identity.schemas.releaseAudit !== RELEASE_AUDIT_SCHEMA_VERSION
  ) {
    conflicts.push('release-audit-schema-mismatch');
  }
  return { conflicts, missing };
}

function evidenceAssessment(gates) {
  const problems = [];
  for (const name of RELEASE_AUDIT_GATES) {
    const gate = gates[name];
    if (!PASSING.has(gateStatus(gate))) {
      continue;
    }
    if (!validDate(gate?.observedAt)) {
      problems.push(`${name}:observed-at-missing`);
    }
    if (
      !Array.isArray(gate?.evidence) ||
      gate.evidence.length === 0 ||
      gate.evidence.some(
        (item) =>
          !HTTPS_URL.test(item?.url || '') || !DIGEST.test(item?.sha256 || '')
      )
    ) {
      problems.push(`${name}:immutable-evidence-missing`);
    }
  }
  return problems;
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
  const observedAt = now().toISOString();
  const runtimeIdentity = {
    node:
      runtime.node || identity.runtimes?.node || globalThis.process?.version,
    bun: runtime.bun || identity.runtimes?.bun,
    deno: runtime.deno || identity.runtimes?.deno,
    platform: runtime.platform || globalThis.process?.platform,
    ...(runtime.imageDigest ? { imageDigest: runtime.imageDigest } : {}),
  };
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
  if (mode !== 'live') {
    normalizedGates['release-identity'] = {
      reason: 'post-release-live-audit-required',
      status: 'pending',
    };
  } else {
    const assessment = releaseIdentityAssessment(identity, runtimeIdentity);
    normalizedGates['release-identity'] = assessment.conflicts.length
      ? {
          problems: assessment.conflicts,
          reason: 'release-identity-inconsistent',
          status: 'failure',
        }
      : assessment.missing.length
        ? {
            missing: assessment.missing,
            reason: 'release-identity-incomplete',
            status: 'pending',
          }
        : {
            reason: 'immutable-release-identity-verified',
            status: 'pass',
          };
    const evidenceProblems = evidenceAssessment(normalizedGates);
    normalizedGates['evidence-integrity'] = evidenceProblems.length
      ? {
          problems: evidenceProblems,
          reason: 'machine-generated-evidence-incomplete',
          status: 'pending',
        }
      : { reason: 'immutable-evidence-verified', status: 'pass' };
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
      observedAt,
      release: identity,
      runtime: runtimeIdentity,
      gates: normalizedGates,
      status,
      closureEligible: mode === 'live' && status === 'pass',
    })
  );
}
