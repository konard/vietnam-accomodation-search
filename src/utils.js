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
