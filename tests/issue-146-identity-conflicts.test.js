import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'test-anywhere';
import {
  LinksStore,
  SearchService,
  deduplicateOffers,
  parseTelegramOffer,
} from '../src/index.js';

const now = new Date('2026-10-07T12:00:00Z');
function unit(id, propertyId = 'A1702', floor = 17) {
  const offer = parseTelegramOffer(
    {
      id,
      sourceId: 'telegram:qa-units',
      date: now,
      text: `For rent: Ocean Home apartment in Nha Trang.\nID: ${propertyId}\n50 m², 1 bedroom, floor: ${floor}.\n8 million VND/month. Contact: @qa_rental_agent`,
    },
    { now }
  );
  return { ...offer, id: `${offer.sourceId}:${id}` };
}

describe('explicit identities veto weak unit matches (#146)', () => {
  it('retains both parsed units and still merges a same-unit repost in either order', () => {
    const first = unit(1);
    const second = unit(2, 'A1802', 18);
    expect(first.attributes.propertyId).toBe('A1702');
    expect(second.attributes.propertyId).toBe('A1802');
    for (const input of [
      [first, second],
      [second, first],
    ]) {
      expect(deduplicateOffers(input).length).toBe(2);
    }
    expect(deduplicateOffers([first, unit(3)]).length).toBe(1);
  });

  it('vetoes conflicts independently in scoped property IDs, external IDs, and floors', () => {
    for (const [left, right] of [
      [unit(1), unit(2, 'A1802', 17)],
      [
        { ...unit(1), attributes: {}, identifiers: { booking: '42' } },
        { ...unit(2), attributes: {}, identifiers: { booking: '43' } },
      ],
      [
        { ...unit(1), attributes: { floor: 17, areaM2: 50, bedrooms: 1 } },
        { ...unit(2), attributes: { floor: 18, areaM2: 50, bedrooms: 1 } },
      ],
    ]) {
      expect(deduplicateOffers([left, right]).length).toBe(2);
      expect(deduplicateOffers([right, left]).length).toBe(2);
    }
  });

  it('preserves cross-source reposts whose identifiers belong to different namespaces', () => {
    const first = { ...unit(1), identifiers: { booking: '42' } };
    const second = {
      ...unit(2, 'OTHER-1702'),
      sourceId: 'telegram:other-agent',
      identifiers: { agoda: '99' },
    };
    expect(deduplicateOffers([first, second]).length).toBe(1);
  });

  it('keeps colon-containing property IDs in their original source namespace', () => {
    const first = {
      ...unit(1),
      attributes: { ...unit(1).attributes, propertyId: 'building-a:1702' },
    };
    const second = {
      ...unit(2),
      attributes: { ...unit(2).attributes, propertyId: 'building-b:1802' },
    };
    expect(deduplicateOffers([first, second]).length).toBe(2);
  });

  it('vetoes named unit discriminators and retains learned IDs after variants rotate out', () => {
    for (const field of ['unit', 'unitNumber', 'apartmentNumber']) {
      const first = {
        ...unit(1),
        attributes: { areaM2: 50, bedrooms: 1, [field]: '1702' },
      };
      const second = {
        ...unit(2),
        attributes: { areaM2: 50, bedrooms: 1, [field]: '1802' },
      };
      expect(deduplicateOffers([first, second]).length).toBe(2);
    }
    const learned = {
      ...unit(1),
      attributes: { areaM2: 50, bedrooms: 1 },
      identityKeys: [
        'source-property:telegram:qa-units:a1702',
        'external:booking:42',
      ],
    };
    expect(deduplicateOffers([learned, unit(2, 'A1802')]).length).toBe(2);
    expect(
      deduplicateOffers([
        learned,
        {
          ...unit(3),
          attributes: { areaM2: 50, bedrooms: 1 },
          identifiers: { booking: '43' },
        },
      ]).length
    ).toBe(2);
  });

  it('does not let an unidentified bridge join two conflicting known units', () => {
    const bridge = { ...unit(3), attributes: { areaM2: 50, bedrooms: 1 } };
    for (const input of [
      [unit(1), bridge, unit(2, 'A1802')],
      [bridge, unit(2, 'A1802'), unit(1)],
      [unit(2, 'A1802'), unit(1), bridge],
    ]) {
      expect(deduplicateOffers(input).length).toBe(3);
    }
  });

  it('retains strong aliases and their constraints across merged variants', () => {
    const first = { ...unit(1), identifiers: { booking: '42' } };
    const alias = {
      ...unit(2),
      sourceId: 'telegram:alias',
      identifiers: { booking: '42' },
    };
    const learned = deduplicateOffers([first, alias])[0];
    const conflict = { ...unit(3, 'A1802'), sourceId: 'telegram:qa-units' };
    expect(deduplicateOffers([learned, conflict]).length).toBe(2);
    const compatible = { ...unit(4), contacts: undefined };
    expect(deduplicateOffers([learned, compatible]).length).toBe(1);
  });

  it('preserves distinct units across independent writes, fresh readback, and search', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'issue-146-'));
    try {
      const store = new LinksStore({ directory, binaryMirror: true });
      await store.saveOffers([unit(1)]);
      await store.saveOffers([unit(2, 'A1802', 18), unit(3)]);
      const restarted = new LinksStore({ directory, binaryMirror: true });
      expect((await restarted.listOffers()).length).toBe(2);
      const search = new SearchService({
        store: restarted,
        registry: { list: async () => [] },
        now: () => now,
      });
      expect(
        (await search.search({ query: 'Nha Trang', sources: [] })).length
      ).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
