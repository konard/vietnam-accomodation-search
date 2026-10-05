export function firstPresent(...values) {
  const found = values.find(
    (value) => value !== undefined && value !== null && value !== ''
  );
  return found === undefined ? values.at(-1) : found;
}

export function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export async function settleCleanup(operations, message) {
  const results = await Promise.allSettled(
    operations.map((operation) => operation())
  );
  const failures = results
    .filter(({ status }) => status === 'rejected')
    .map(({ reason }) => reason);
  if (failures.length) {
    throw new AggregateError(failures, message);
  }
}

const TRACKING_PARAMETERS = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'referrer',
  'source',
]);

export function canonicalizeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  try {
    const url = new globalThis.URL(value.trim());
    if (!/^https?:$/u.test(url.protocol)) {
      return undefined;
    }
    url.protocol = url.protocol.toLocaleLowerCase('en');
    url.hostname = url.hostname.toLocaleLowerCase('en').replace(/^www\./u, '');
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.toLocaleLowerCase('en').startsWith('utm_') ||
        TRACKING_PARAMETERS.has(key.toLocaleLowerCase('en'))
      ) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    url.pathname =
      url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/u, '');
    return url.toString().replace(/\/$/u, '');
  } catch {
    return undefined;
  }
}

// browser-commander's network tracker waits for 30 s without any request after
// every goto(), and its goto() ignores `waitForNetworkIdle: false`. Readiness
// then rests on the URL settling, and each caller reads the DOM it needs.
export function openCommander(runtime, page) {
  return runtime.makeBrowserCommander({ enableNetworkTracking: false, page });
}

// browser-commander's goto() waits up to 240 s for a page that never answers.
// Requests to one domain run one at a time, so a single stalled response
// would hold every later request to that domain.
export const NAVIGATION_TIMEOUT_MS = 30_000;

export function gotoPage(commander, url, timeout = NAVIGATION_TIMEOUT_MS) {
  return commander.goto({ timeout, url, waitForNetworkIdle: false });
}

// Playwright's own Chromium launcher adds --disable-dev-shm-usage, but
// browser-commander starts Chrome with a minimal command line. Containers give
// /dev/shm 64 MB by default; heavy booking pages then exhaust it, the browser
// reports ERR_INSUFFICIENT_RESOURCES and closes every page it holds.
export function launchSettings(options = {}) {
  const args = ['--disable-dev-shm-usage', ...(options.args || [])];
  return {
    engine: 'playwright',
    headless: true,
    ...options,
    args: [...new Set(args)],
  };
}

const LOST_PAGE_PATTERN =
  /Target crashed|Target closed|Target page, context or browser has been closed|Session closed|Page closed|Browser closed/iu;

// A crashed or closed page fails every later call, so its worker is retired.
export function isLostPageError(error) {
  return LOST_PAGE_PATTERN.test(String(error?.message || ''));
}
