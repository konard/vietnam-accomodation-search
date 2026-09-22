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

export function parseSearchCommand(input = '') {
  const body = String(input)
    .replace(/^\/search(?:@\w+)?\s*/u, '')
    .trim();
  const tokens = body ? body.split(/\s+/u) : [];
  const optionIndex = tokens.indexOf('--cheapest');
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

  return {
    cheapest,
    ...(Object.keys(filters).length ? { filters } : {}),
    limit,
    query: tokens.join(' '),
  };
}
