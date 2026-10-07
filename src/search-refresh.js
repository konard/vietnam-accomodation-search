import { stableHash } from './utils.js';

const CITIES = [
  ['nha-trang', /nha\s*trang|nhatrang|нячанг|nyachang|niachang/iu],
  ['da-nang', /da\s*nang|danang|дананг/iu],
  ['phu-quoc', /phu\s*quoc|phuquoc|фукуок/iu],
  ['ha-noi', /ha\s*noi|hanoi|ханой/iu],
  ['ho-chi-minh', /ho\s*chi\s*minh|saigon|sai\s*gon|сайгон/iu],
  ['mui-ne', /mui\s*ne|muine|муйне/iu],
  ['da-lat', /da\s*lat|dalat|далат/iu],
];

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/gu, 'd')
    .toLocaleLowerCase('en');
}

export function citiesIn(value) {
  const text = fold(value);
  return CITIES.filter(
    ([slug, pattern]) => text.includes(slug) || pattern.test(text)
  ).map(([slug]) => slug);
}

export function matchingSources(sources, query) {
  const cities = citiesIn(query);
  return sources.filter((source) => {
    if (source.enabled === false) {
      return false;
    }
    const metadata = source.focus || source.geographicFocus;
    const focus = citiesIn(
      metadata && metadata !== 'vietnam'
        ? metadata
        : `${source.id} ${source.name || ''}`
    );
    return (
      !cities.length ||
      !focus.length ||
      cities.some((city) => focus.includes(city))
    );
  });
}

export function collectionKey(sourceId, query) {
  return `collection:${stableHash([sourceId, fold(query.trim())].join('\n'))}`;
}

export function freshAt(value, now, maxAgeMs) {
  const age = now.getTime() - new Date(value).getTime();
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
}

// Success timestamps include empty results. A source with no offer is still
// collected; attempted/error timestamps only affect fair scheduling.
export function refreshSources({
  offers,
  sources,
  query,
  states,
  now,
  maxAgeMs,
  force,
}) {
  const byId = new Map(states.map((state) => [state.id, state]));
  const fresh = new Set(
    offers
      .filter((offer) => {
        const queries = offer.searchQueries || [offer.searchQuery];
        return (
          queries.every((value) => !value) ||
          queries.some((value) => fold(value) === fold(query))
        );
      })
      .filter((offer) => freshAt(offer.collectedAt, now, maxAgeMs))
      .flatMap((offer) => offer.sourceIds || [offer.sourceId])
  );
  const stateOf = (source) => byId.get(collectionKey(source.id, query));
  const isFresh = (source) =>
    stateOf(source)
      ? stateOf(source).historyComplete !== false &&
        freshAt(stateOf(source).collectedAt, now, maxAgeMs)
      : fresh.has(source.id);
  const focused = (source) =>
    citiesIn(query).some((city) =>
      citiesIn(source.focus || source.geographicFocus).includes(city)
    );
  return sources
    .filter((source) => force || !isFresh(source))
    .sort(
      (a, b) =>
        Number(isFresh(a)) - Number(isFresh(b)) ||
        (Date.parse(stateOf(a)?.attemptedAt) || 0) -
          (Date.parse(stateOf(b)?.attemptedAt) || 0) ||
        Number(focused(b)) - Number(focused(a))
    );
}
