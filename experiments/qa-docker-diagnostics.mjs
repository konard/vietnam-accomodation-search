// Public reports use only finite operation names and error categories. Raw
// Docker output belongs in private logs, never in an acceptance row.
const OPERATIONS = new Set([
  'pull',
  'start',
  'exec',
  'network create',
  'network ls',
  'network rm',
  'volume create',
  'volume ls',
  'volume rm',
  'image ls',
  'image rm',
  'image tag',
  'buildx create',
  'buildx build',
  'buildx du',
  'buildx ls',
  'buildx stop',
  'buildx rm',
  'ps',
  'create',
  'run',
  'rm',
  'info',
  'inspect',
]);
const CATEGORIES = new Set([
  'storage-io',
  'storage-capacity',
  'external-acquisition',
  'command-timeout',
  'command-failure',
  'assertion-failure',
  'cleanup-failure',
  'guard-rejection',
  'interrupted',
  'unknown',
]);
const CODES = new Set([
  'ENOENT',
  'EIO',
  'ENOSPC',
  'ETIMEDOUT',
  'ABORT_ERR',
  'ERR_ASSERTION',
  'QA_DISK_FLOOR',
  'QA_DISK_PREFLIGHT',
  'QA_CAPACITY_UNAVAILABLE',
  'QA_HEAVY_BUSY',
]);
const SIGNALS = new Set(['SIGINT', 'SIGTERM', 'SIGKILL']);

export function annotateDockerFailure(error, args) {
  const pair = args.slice(0, 2).join(' ');
  error.qaOperation = OPERATIONS.has(pair)
    ? pair
    : OPERATIONS.has(args[0])
      ? args[0]
      : 'unknown';
  const diagnostic = String(error.stderr || '').slice(0, 65_536);
  error.qaCategory =
    /input\/output error/iu.test(diagnostic) || error.code === 'EIO'
      ? 'storage-io'
      : /no space left|disk quota/iu.test(diagnostic) || error.code === 'ENOSPC'
        ? 'storage-capacity'
        : error.killed ||
            error.code === 'ETIMEDOUT' ||
            /timeout|timed out/iu.test(diagnostic)
          ? 'command-timeout'
          : /network|resolve|download|fetch|EOF/iu.test(diagnostic)
            ? 'external-acquisition'
            : 'command-failure';
  return error;
}

// eslint-disable-next-line complexity -- Each independent field and bounded cause must pass its own whitelist before publication.
export function safeQaFailure(error, depth = 0, seen = new Set()) {
  if (!error || seen.has(error) || depth > 2) {
    return { category: 'unknown' };
  }
  seen.add(error);
  const category = CATEGORIES.has(error.qaCategory)
    ? error.qaCategory
    : error.name === 'AggregateError'
      ? 'cleanup-failure'
      : error.name === 'AssertionError'
        ? 'assertion-failure'
        : String(error.code || '').startsWith('QA_')
          ? 'guard-rejection'
          : 'unknown';
  const report = {
    operation: OPERATIONS.has(error.qaOperation)
      ? error.qaOperation
      : 'unknown',
    category,
    ...(CODES.has(error.code) ||
    (Number.isInteger(error.code) && error.code >= 0 && error.code <= 255)
      ? { code: error.code }
      : {}),
    ...(typeof error.killed === 'boolean' ? { killed: error.killed } : {}),
    ...(SIGNALS.has(error.signal) ? { signal: error.signal } : {}),
    assertion: error.name === 'AssertionError',
  };
  const causes = Array.isArray(error.errors)
    ? error.errors
    : error.cause
      ? [error.cause]
      : [];
  if (causes.length && depth < 2) {
    report.causes = causes
      .slice(0, 4)
      .map((cause) => safeQaFailure(cause, depth + 1, seen));
  }
  return report;
}
