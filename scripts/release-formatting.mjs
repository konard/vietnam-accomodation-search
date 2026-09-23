const FORMATTABLE_EXTENSION = /\.(m?js|json|md|ts)$/u;

/**
 * Parse Git's NUL-delimited staged-path output without interpreting quoting,
 * whitespace, or control characters in a valid pathname.
 *
 * @param {string | Uint8Array} output
 * @returns {string[]}
 */
export function formattableStagedFiles(output) {
  const value =
    typeof output === 'string'
      ? output
      : new globalThis.TextDecoder().decode(output);
  return value
    .split('\0')
    .filter(Boolean)
    .filter((file) => FORMATTABLE_EXTENSION.test(file));
}
