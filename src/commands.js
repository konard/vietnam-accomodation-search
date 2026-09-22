const RANGE_OPTIONS = new Map([
  ['--min-rooms', 'minRooms'],
  ['--max-rooms', 'maxRooms'],
  ['--min-price-per-room', 'minPricePerRoomVnd'],
  ['--max-price-per-room', 'maxPricePerRoomVnd'],
  ['--min-price-per-bed', 'minPricePerBedVnd'],
  ['--max-price-per-bed', 'maxPricePerBedVnd'],
  ['--min-total-price', 'minTotalPriceVnd'],
  ['--max-total-price', 'maxTotalPriceVnd'],
]);

function filterValue(rawValue) {
  if (/^-?\d+(?:\.\d+)?$/u.test(rawValue)) {
    return Number(rawValue);
  }
  if (/^(?:true|false)$/iu.test(rawValue)) {
    return rawValue.toLocaleLowerCase('en') === 'true';
  }
  return rawValue;
}

function validFilterKey(key) {
  const unsafe = new Set(['__proto__', 'constructor', 'prototype']);
  return key
    .split('.')
    .every(
      (segment) =>
        /^[\p{L}][\p{L}\p{N}_-]{0,63}$/u.test(segment) && !unsafe.has(segment)
    );
}

function takeOption(tokens, index, message) {
  const value = tokens[index + 1];
  if (!value || value.startsWith('--')) {
    throw new TypeError(message);
  }
  tokens.splice(index, 2);
  return value;
}

function extractFilters(tokens) {
  const filters = {};
  for (let index = 0; index < tokens.length; ) {
    if (tokens[index] !== '--filter') {
      index += 1;
      continue;
    }
    const expression = takeOption(
      tokens,
      index,
      'Filters must use --filter field=value.'
    );
    const separator = expression.indexOf('=');
    const key = expression.slice(0, separator);
    const rawValue = expression.slice(separator + 1);
    if (separator < 1 || !validFilterKey(key) || !rawValue) {
      throw new TypeError('Filters must use --filter field=value.');
    }
    filters[key] = filterValue(rawValue);
  }
  return filters;
}

function extractTypes(tokens) {
  const types = [];
  for (let index = 0; index < tokens.length; ) {
    if (tokens[index] !== '--type') {
      index += 1;
      continue;
    }
    const value = takeOption(
      tokens,
      index,
      'Accommodation types must use --type TYPE.'
    );
    for (const type of value.split(',').map((entry) => entry.trim())) {
      if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,31}$/u.test(type)) {
        throw new TypeError(`Invalid accommodation type: ${type}`);
      }
      types.push(type.toLocaleLowerCase('en'));
    }
  }
  return [...new Set(types)];
}

function extractRanges(tokens) {
  const ranges = {};
  for (let index = 0; index < tokens.length; ) {
    const field = RANGE_OPTIONS.get(tokens[index]);
    if (!field) {
      index += 1;
      continue;
    }
    const option = tokens[index];
    const rawValue = takeOption(
      tokens,
      index,
      `${option} requires a non-negative number.`
    );
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${option} requires a non-negative number.`);
    }
    if (
      (field === 'minRooms' || field === 'maxRooms') &&
      !Number.isInteger(value)
    ) {
      throw new RangeError(`${option} requires a whole number.`);
    }
    ranges[field] = value;
  }
  return ranges;
}

function validateRange(options, minimum, maximum, label) {
  if (
    Number.isFinite(options[minimum]) &&
    Number.isFinite(options[maximum]) &&
    options[minimum] > options[maximum]
  ) {
    throw new RangeError(`${label} minimum cannot exceed its maximum.`);
  }
}

function validateRanges(options) {
  validateRange(options, 'minRooms', 'maxRooms', 'Room count');
  validateRange(
    options,
    'minPricePerRoomVnd',
    'maxPricePerRoomVnd',
    'Price per room'
  );
  validateRange(
    options,
    'minPricePerBedVnd',
    'maxPricePerBedVnd',
    'Price per bed'
  );
  validateRange(options, 'minTotalPriceVnd', 'maxTotalPriceVnd', 'Total price');
}

function extractOrdering(tokens, partial) {
  const result = partial ? {} : { cheapest: false, limit: 10 };
  const cheapestIndex = tokens.indexOf('--cheapest');
  const newestIndex = tokens.indexOf('--newest');

  if (cheapestIndex >= 0 && newestIndex >= 0) {
    throw new TypeError('--cheapest and --newest cannot be used together.');
  }
  if (cheapestIndex >= 0) {
    result.cheapest = true;
    result.limit = 1;
    const value = tokens[cheapestIndex + 1];
    if (value && /^-?\d+$/u.test(value)) {
      result.limit = Number(value);
      tokens.splice(cheapestIndex, 2);
    } else {
      tokens.splice(cheapestIndex, 1);
    }
  } else if (newestIndex >= 0) {
    result.cheapest = false;
    tokens.splice(newestIndex, 1);
  }

  const limitIndex = tokens.indexOf('--limit');
  if (limitIndex >= 0) {
    result.limit = Number(
      takeOption(tokens, limitIndex, '--limit requires a result count.')
    );
  }
  if (
    result.limit !== undefined &&
    (!Number.isInteger(result.limit) || result.limit < 1 || result.limit > 50)
  ) {
    throw new RangeError('The result count must be between 1 and 50.');
  }
  return result;
}

function parseSearchTokens(input, { partial = false } = {}) {
  const body = String(input)
    .replace(/^\/search(?:@\w+)?\s*/u, '')
    .trim();
  const tokens = body ? body.split(/\s+/u) : [];
  const result = extractOrdering(tokens, partial);

  const filters = extractFilters(tokens);
  const types = extractTypes(tokens);
  Object.assign(result, extractRanges(tokens));
  if (Object.keys(filters).length) {
    result.filters = filters;
  }
  if (types.length) {
    result.types = types;
  }
  const query = tokens.join(' ');
  if (!partial || query) {
    result.query = query;
  }
  validateRanges(result);
  return result;
}

export function parseSearchCommand(input = '') {
  return parseSearchTokens(input);
}

export function parseSearchOverrides(input = '') {
  return parseSearchTokens(input, { partial: true });
}
