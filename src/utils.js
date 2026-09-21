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
