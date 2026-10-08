// A building, catalog or agency page is useful provenance, but cannot by
// itself identify one rental unit. Detail links still need the identity
// conflict check: an arbitrary URL path is not proof that two units match.
function parseUrl(value) {
  try {
    return new globalThis.URL(value);
  } catch {
    return undefined;
  }
}

export function telegramPostUrl(value) {
  const url = parseUrl(value);
  return Boolean(
    url &&
    /^(?:t\.me|telegram\.me)$/iu.test(url.hostname) &&
    /^\/(?:c\/\d+|[\w]+)\/\d+\/?$/u.test(url.pathname)
  );
}

export function sharedOfferUrl(value) {
  const url = parseUrl(value);
  if (!url) {
    return true;
  }
  if (
    [...url.searchParams.keys()].some((key) =>
      /^(?:id|unit|unit_id|listing_id|property_id|hotel_id|apartment_id)$/iu.test(
        key
      )
    )
  ) {
    return false;
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (!segments.length) {
    return true;
  }
  if (/^(?:t\.me|telegram\.me)$/iu.test(url.hostname)) {
    return !/^\d+$/u.test(segments.at(-1));
  }
  return /^(?:index(?:\.html?)?|home|about|contact|agency|catalog|properties|apartments|rooms|units|rentals|listings|search)$/iu.test(
    segments.at(-1)
  );
}
