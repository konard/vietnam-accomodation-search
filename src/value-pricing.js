// Explicit billing conventions for optional stay comparisons. Quoted rent
// remains intact; these arithmetic estimates do not imply bookable rates.
const NIGHTS = Object.freeze({ night: 1, week: 7, month: 30, year: 365 });
export const VALUE_SORTS = Object.freeze([
  'totalVnd',
  'pricePerBedroomVnd',
  'pricePerRoomVnd',
  'pricePerBedVnd',
]);

function currencyQuote(line) {
  const digit = line.search(/\d/u);
  // The first digit bounds one suffix scan, including long numeric lines
  // without a currency token.
  return (
    (digit >= 0 &&
      /(?:million|triệu|trieu|tr\b|k\b|млн|тыс|VND|VNĐ|USD|EUR|GBP|RUB|₫|đồng|доллар|руб|\$|€|£|₽|M\b)/iu.test(
        line.slice(digit + 1)
      )) ||
    /(?:USD|EUR|GBP|RUB|VND|VNĐ|\$|€|£|₽|₫)\s*\d/iu.test(line)
  );
}

export function quoteBasis(text = '') {
  // Currency-bearing rent lines exclude standalone utility quotes.
  const quote = String(text)
    .split(/\n|;/u)
    .filter(
      (line) =>
        currencyQuote(line) &&
        !/^\s*(?:electric\p{L}*|water|utility|utilities|điện|nước)\b/iu.test(
          line
        )
    )
    .join('\n');
  const unit = quote
    .match(
      /(?:\/|\bper\s+|за\s+|mỗi\s+)(bedroom|room|bed|person|pax|người|phòng|giường|человек|комнат|кровать|койк)(?:s|\p{L}*)(?!\p{L})/iu
    )?.[1]
    ?.toLowerCase();
  if (!unit) {
    return 'property';
  }
  if (/person|pax|người|человек/u.test(unit)) {
    return 'person';
  }
  if (/bedroom/u.test(unit)) {
    return 'bedroom';
  }
  return /room|phòng|комнат/u.test(unit) ? 'room' : 'bed';
}

export function offerDenominator(offer, field) {
  const direct = offer.attributes?.[field];
  if (Number.isFinite(direct)) {
    return { count: direct, provenance: `attributes.${field}` };
  }
  const label = offer.attributes?.labeledFields?.[field];
  const first = Array.isArray(label) ? label[0] : label;
  const count = /^\d+$/u.test(String(first ?? '')) ? Number(first) : undefined;
  return {
    count,
    provenance:
      count === undefined ? 'unknown' : `attributes.labeledFields.${field}`,
  };
}

export function validateComparison(options = {}) {
  if (
    options.comparisonBasis !== undefined &&
    !['property', 'bedroom', 'room', 'bed'].includes(options.comparisonBasis)
  ) {
    throw new TypeError('Unknown comparison basis.');
  }
  if (options.sortBy !== undefined && !VALUE_SORTS.includes(options.sortBy)) {
    throw new TypeError('Unknown value sort.');
  }
  if (
    options.comparisonPeriod !== undefined &&
    !['quoted', ...Object.keys(NIGHTS)].includes(options.comparisonPeriod)
  ) {
    throw new TypeError('Unknown comparison period.');
  }
  if (
    options.stayNights !== undefined &&
    (!Number.isInteger(options.stayNights) ||
      options.stayNights < 1 ||
      options.stayNights > 3650)
  ) {
    throw new RangeError('stayNights must be between 1 and 3650.');
  }
}

function quoteTotal(offer, { basis, converted, quotedPeriod, nights }) {
  const exclusions = [];
  if (basis !== 'property') {
    exclusions.push(`quote-per-${basis}`);
  }
  if (!Number.isFinite(offer.priceVnd) || offer.priceVnd <= 0) {
    exclusions.push('missing-positive-rent');
  }
  if (converted && !NIGHTS[quotedPeriod]) {
    exclusions.push('unknown-billing-period');
  }
  const totalVnd = exclusions.length
    ? undefined
    : converted
      ? (offer.priceVnd * nights) / NIGHTS[quotedPeriod]
      : offer.priceVnd;
  return { totalVnd, exclusions };
}

function unitValues(offer, totalVnd, basis, unitQuote) {
  const units = { metricProvenance: {} };
  for (const [field, key, unit] of [
    ['bedrooms', 'pricePerBedroomVnd', 'bedroom'],
    ['rooms', 'pricePerRoomVnd', 'room'],
    ['beds', 'pricePerBedVnd', 'bed'],
  ]) {
    const denominator = offerDenominator(offer, field);
    const valid =
      Number.isSafeInteger(denominator.count) && denominator.count > 0;
    units[field] = { ...denominator, status: valid ? 'known' : 'excluded' };
    units[key] =
      basis === unit
        ? unitQuote
        : valid && totalVnd !== undefined
          ? totalVnd / denominator.count
          : undefined;
    units.metricProvenance[key] = Number.isFinite(units[key])
      ? basis === unit
        ? 'explicit-unit-quote'
        : 'property-total-divided-by-count'
      : 'unknown';
  }
  return units;
}

function selectedQuote(offer) {
  const variant = offer.variants?.findLast(
    (entry) =>
      entry.sourceId === offer.sourceId &&
      entry.priceVnd === offer.priceVnd &&
      entry.price?.period === offer.price?.period
  );
  return variant ? { ...offer, ...variant } : offer;
}

// eslint-disable-next-line complexity -- The comparison exposes quote, stay, unit and currency evidence as independent fields.
export function compareOfferValue(offer, options = {}) {
  validateComparison(options);
  // Quote, counts and exchange rate belong to the same source variant.
  offer = selectedQuote(offer);
  const basis =
    offer.price?.basis ||
    offer.priceBasis ||
    quoteBasis(offer.raw?.text || offer.title);
  const quotedPeriod = offer.price?.period || 'unknown';
  const converted =
    options.stayNights !== undefined ||
    (options.comparisonPeriod && options.comparisonPeriod !== 'quoted');
  const nights = options.stayNights ?? NIGHTS[options.comparisonPeriod];
  const { totalVnd, exclusions } = quoteTotal(offer, {
    basis,
    converted,
    quotedPeriod,
    nights,
  });
  // Reuse rent/period validation while keeping a unit quote separate from
  // whole-property arithmetic. Counts never imply cross-unit conversion.
  const unitQuote = quoteTotal(offer, {
    basis: 'property',
    converted,
    quotedPeriod,
    nights,
  }).totalVnd;
  const units = unitValues(offer, totalVnd, basis, unitQuote);
  return {
    basis,
    comparisonPool: `quote-per-${basis}`,
    basisProvenance:
      offer.priceBasisProvenance ||
      (offer.price?.basis || offer.priceBasis
        ? 'declared'
        : 'inferred-from-quote'),
    totalVnd,
    ...units,
    quotedPeriod,
    comparisonPeriod: converted ? 'stay' : quotedPeriod,
    ...(converted ? stayPolicy(nights) : {}),
    currencyProvenance: exchangeProvenance(offer),
    exclusions,
  };
}

function stayPolicy(nights) {
  return {
    stayNights: nights,
    billingPolicy:
      'linear estimate: night=1, week=7, month=30, year=365 nights; availability and minimum stay unverified',
  };
}

function exchangeProvenance(offer) {
  return (
    offer.currencyProvenance || {
      status:
        offer.price?.currency === 'VND'
          ? 'original-VND'
          : 'unverified-conversion',
    }
  );
}

export function formatOfferValue(value) {
  if (!value) {
    return undefined;
  }
  const lines = [];
  if (value.stayNights) {
    lines.push(
      Number.isFinite(value.totalVnd)
        ? `Estimated ${value.stayNights}-night total: ${Math.round(value.totalVnd).toLocaleString('en-US')} VND (${value.billingPolicy})`
        : `Stay total excluded: ${value.exclusions.join(', ')}.`
    );
  }
  for (const [field, key, label] of [
    ['bedrooms', 'pricePerBedroomVnd', 'bedroom'],
    ['rooms', 'pricePerRoomVnd', 'room'],
    ['beds', 'pricePerBedVnd', 'bed'],
  ]) {
    const denominator = value[field];
    lines.push(
      Number.isFinite(value[key])
        ? `${Math.round(value[key]).toLocaleString('en-US')} VND/${label}/${value.comparisonPeriod} ${value.metricProvenance?.[key] === 'explicit-unit-quote' ? '(explicit unit quote)' : `÷ ${denominator.count} (${denominator.provenance})`}`
        : `${label}: excluded (${denominator?.count ?? 'unknown'} denominator or non-property quote)`
    );
  }
  lines.push(
    `Quote basis: ${value.basis} (${value.basisProvenance}); FX: ${JSON.stringify(value.currencyProvenance)}`
  );
  return lines.join('\n');
}
