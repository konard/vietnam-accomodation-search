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

  return { cheapest, limit, query: tokens.join(' ') };
}
