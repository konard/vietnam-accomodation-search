// Numbers and their field labels must share a clause. Horizontal whitespace
// avoids borrowing the next line's count; area/ranges are never a single floor.
export const FLOOR_PATTERN =
  /(?<![\p{L}\d])(?:(\d{1,3})(?:st|nd|rd|th|[- ]?(?:й|ый|ой))?[ \t]+(?:floor|этаж\p{L}*)|(?:floor|этаж|tầng)(?!\p{L})[ \t]{0,8}[:#-]?[ \t]{0,8}(\d{1,3}))(?!\d|[ \t]*(?:[-–—]\s*\d|m[²2]|м[²2]|кв\.?|bedrooms?|bathrooms?|спальн|сануз))/iu;

export function listingFloor(text) {
  const match = text.match(FLOOR_PATTERN);
  return match ? Number(match[1] || match[2]) : undefined;
}

export function minimumLeaseMonths(text) {
  const match = text.match(
    /(?:minimum(?:[ \t]+(?:stay|lease|contract))?|аренд\p{L}*[ \t]+от|tối[ \t]*thiểu|hợp[ \t]*đồng|contract|контракт)[ \t\p{L}:#-]{0,24}?(\d{1,3})[ \t]*(months?|месяц\p{L}*|tháng|years?|год(?:а|ов)?|лет|năm)(?!\p{L})/iu
  );
  if (!match) {
    return undefined;
  }
  return Number(match[1]) * (/years?|год|лет|năm/iu.test(match[2]) ? 12 : 1);
}

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
const MONTH =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const ENGLISH_DATE = new RegExp(
  `(?:(\\d{1,2})(?:st|nd|rd|th)?[ \\t]+(${MONTH})|(${MONTH})[ \\t]+(\\d{1,2})(?:st|nd|rd|th)?)(?:[ \\t,]+(\\d{4}))?`,
  'iu'
);

// Omitted years use the publication year, rolling forward once when the date
// precedes publication. Explicit years never roll. Ranges are left unknown:
// a date interval requires separate review of its endpoints.
// eslint-disable-next-line complexity -- Calendar validation and explicit versus inferred years share one UTC parsing boundary.
export function listingAvailabilityDate(text, referenceDate = new Date()) {
  const clause = text.match(
    /(?:свобод\p{L}*|available|доступ\p{L}*|có[ \t]*sẵn)[^\n\r;]{0,100}/iu
  )?.[0];
  if (
    !clause ||
    /\b(?:through|until|to)\b|\s(?:до|по|đến)\s|\d\s*[–—]\s*\d/iu.test(
      clause
    ) ||
    new RegExp(
      `\\d{1,2}(?:st|nd|rd|th)?[ \\t]*-[ \\t]*\\d{1,2}(?:st|nd|rd|th)?[ \\t]+${MONTH}`,
      'iu'
    ).test(clause) ||
    [...clause.matchAll(/\b\d{4}-\d{2}-\d{2}\b/gu)].length > 1 ||
    [...clause.matchAll(new RegExp(ENGLISH_DATE.source, 'giu'))].length > 1
  ) {
    return undefined;
  }
  const iso = clause.match(/\b(\d{4})-(\d{2})-(\d{2})(?!\d)/u);
  const numeric = clause.match(
    /(?<!\d)(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?!\d)/u
  );
  const named = clause.match(ENGLISH_DATE);
  if (!iso && !numeric && !named) {
    return undefined;
  }
  const suppliedYear = iso?.[1] || numeric?.[3] || named?.[5];
  let year = suppliedYear
    ? Number(suppliedYear) + (suppliedYear.length === 2 ? 2000 : 0)
    : new Date(referenceDate).getUTCFullYear();
  const month = iso
    ? Number(iso[2])
    : numeric
      ? Number(numeric[2])
      : MONTHS.indexOf((named[2] || named[3]).slice(0, 3).toLowerCase()) + 1;
  const day = Number(iso?.[3] || numeric?.[1] || named?.[1] || named?.[4]);
  let date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  if (
    !suppliedYear &&
    date.toISOString().slice(0, 10) <
      new Date(referenceDate).toISOString().slice(0, 10)
  ) {
    year += 1;
    date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1) {
      return undefined;
    }
  }
  return date.toISOString().slice(0, 10);
}
