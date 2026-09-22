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

function extractFilters(tokens) {
  const filters = {};
  for (let index = 0; index < tokens.length; ) {
    if (tokens[index] !== '--filter') {
      index += 1;
      continue;
    }
    const expression = tokens[index + 1] || '';
    const separator = expression.indexOf('=');
    const key = expression.slice(0, separator);
    const rawValue = expression.slice(separator + 1);
    if (separator < 1 || !validFilterKey(key) || !rawValue) {
      throw new TypeError('Filters must use --filter field=value.');
    }
    filters[key] = filterValue(rawValue);
    tokens.splice(index, 2);
  }
  return filters;
}

const NAMED_OPTIONS = new Map([
  ['--max-per-bed-vnd', 'maxPerBedVnd'],
  ['--max-per-room-vnd', 'maxPerRoomVnd'],
  ['--max-rooms', 'maxRooms'],
  ['--max-total-vnd', 'maxTotalVnd'],
  ['--min-per-bed-vnd', 'minPerBedVnd'],
  ['--min-per-room-vnd', 'minPerRoomVnd'],
  ['--min-rooms', 'minRooms'],
  ['--min-total-vnd', 'minTotalVnd'],
]);

function extractNamedOptions(tokens) {
  const options = {};
  for (let index = 0; index < tokens.length; ) {
    const key = NAMED_OPTIONS.get(tokens[index]);
    if (!key) {
      index += 1;
      continue;
    }
    const raw = tokens[index + 1];
    const value = Number(raw);
    const rooms = key === 'minRooms' || key === 'maxRooms';
    if (
      !raw ||
      !Number.isFinite(value) ||
      value < 0 ||
      (rooms && !Number.isInteger(value))
    ) {
      throw new TypeError(`${tokens[index]} requires a non-negative number.`);
    }
    options[key] = value;
    tokens.splice(index, 2);
  }

  const typesIndex = tokens.indexOf('--types');
  if (typesIndex >= 0) {
    const types = (tokens[typesIndex + 1] || '')
      .split(',')
      .map((type) => type.trim().toLocaleLowerCase('en'))
      .filter(Boolean);
    if (!types.length) {
      throw new TypeError('--types requires a comma-separated list.');
    }
    options.types = [...new Set(types)];
    tokens.splice(typesIndex, 2);
  }

  for (const [minimum, maximum] of [
    ['minRooms', 'maxRooms'],
    ['minTotalVnd', 'maxTotalVnd'],
    ['minPerRoomVnd', 'maxPerRoomVnd'],
    ['minPerBedVnd', 'maxPerBedVnd'],
  ]) {
    if (options[minimum] > options[maximum]) {
      throw new RangeError(`${minimum} cannot exceed ${maximum}.`);
    }
  }
  return options;
}

// eslint-disable-next-line complexity -- Each independent CLI bound has a small parsing branch in this single grammar.
export function parseSearchCommand(input = '', { defaults = true } = {}) {
  const body = String(input)
    .replace(/^\/search(?:@\w+)?\s*/u, '')
    .trim();
  const tokens = body ? body.split(/\s+/u) : [];
  const optionIndex = tokens.indexOf('--cheapest');
  const hasCheapest = optionIndex >= 0;
  let limit = 10;
  let cheapest = false;

  if (optionIndex >= 0) {
    cheapest = true;
    limit = 1;
    const value = tokens[optionIndex + 1];
    if (value && /^-?\d+$/u.test(value)) {
      limit = Number(value);
      tokens.splice(optionIndex, 2);
    } else {
      tokens.splice(optionIndex, 1);
    }
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError('The result count must be between 1 and 50.');
  }

  const filters = extractFilters(tokens);
  const named = extractNamedOptions(tokens);

  return {
    ...(defaults || hasCheapest ? { cheapest } : {}),
    ...(Object.keys(filters).length ? { filters } : {}),
    ...(defaults || hasCheapest ? { limit } : {}),
    ...named,
    ...(defaults || tokens.length ? { query: tokens.join(' ') } : {}),
  };
}
