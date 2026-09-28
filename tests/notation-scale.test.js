import { Parser } from 'links-notation';
import { describe, expect, it } from 'test-anywhere';

import {
  MAX_NOTATION_LENGTH,
  parseNotation,
  splitNotation,
  verifyExport,
} from '../src/link-cli-mirror.js';
import {
  deserializeRecords,
  queryRecords,
  serializeRecords,
} from '../src/links-store.js';

// Records every Parser bound used while `operation` runs. A >10 MiB input
// would take about 30 seconds to parse, so the bound is asserted directly;
// experiments/parser-size-limit.mjs demonstrates the real oversized input.
function parserBounds(operation) {
  const parse = Parser.prototype.parse;
  const bounds = [];
  Parser.prototype.parse = function (input) {
    bounds.push(this.maxInputSize);
    return parse.call(this, input);
  };
  try {
    operation();
  } finally {
    Parser.prototype.parse = parse;
  }
  return bounds;
}

describe('canonical notation at production scale', () => {
  it('parses canonical snapshots beyond the 10 MiB links-notation default', () => {
    expect(MAX_NOTATION_LENGTH > 16 * 1024 * 1024).toBe(true);
    const notation = serializeRecords('offer', [
      { id: 'a', price: { amount: 1 } },
      { id: 'b', price: { amount: 2 } },
    ]);
    const bounds = parserBounds(() => {
      parseNotation(notation);
      splitNotation(notation, { averageLinks: 2, maxLinks: 3, minLinks: 1 });
      verifyExport(notation, notation);
      deserializeRecords('offer', notation);
      queryRecords('offer', notation, { path: 'price/amount', value: 2 });
    });
    expect(bounds.length).toBe(6);
    expect(bounds.every((bound) => bound === MAX_NOTATION_LENGTH)).toBe(true);
  });

  it('decodes owned fields through the link index', () => {
    const records = [
      { id: 'a', nested: { list: [1, 'two'] }, text: 'Room\nA' },
      { id: 'b', nested: { list: [] }, text: 'Room B' },
    ];
    const notation = serializeRecords('offer', records);
    expect(deserializeRecords('offer', notation)).toEqual(records);
    expect(
      queryRecords('offer', notation, { path: 'text', value: 'Room B' })
    ).toEqual([{ id: 'b', nested: { list: [] }, text: 'Room B' }]);
  });
});
