// Compatibility folding is confined to lexical recognition. Each folded UTF-16
// position points back to its complete original grapheme for evidence spans.
export function listingLexemes(value) {
  const original = String(value);
  const starts = [];
  const ends = [];
  let text = '';
  for (const { segment, index } of new Intl.Segmenter(undefined, {
    granularity: 'grapheme',
  }).segment(original)) {
    const normalized = segment.normalize('NFKC');
    text += normalized;
    for (let offset = 0; offset < normalized.length; offset++) {
      starts.push(index);
      ends.push(index + segment.length);
    }
  }
  return {
    text,
    sourceSpan: (start, end) => ({ start: starts[start], end: ends[end - 1] }),
  };
}
