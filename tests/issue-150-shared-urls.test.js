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
import { sharedOfferUrl, telegramPostUrl } from '../src/offer-url-identity.js';

const now = new Date('2026-10-08T00:00:00Z');
function unit(id, propertyId = 'A1702', floor = 17, website = '/') {
  return parseTelegramOffer(
    {
      id,
      messageId: id,
      chat: { username: 'qa_unit_source' },
      sourceId: 'telegram:qa-unit-source',
      date: now,
      text: `For rent: Ocean Home apartment in Nha Trang.
ID: ${propertyId}
50 m², 1 bedroom, floor: ${floor}.
8 million VND/month. Contact: @qa_rental_agent
Official website: https://ocean-home.example.invalid${website}`,
    },
    { now }
  );
}

describe('shared property URLs cannot identify a rental unit (#150)', () => {
  it('classifies shared pages, listing identifiers, malformed evidence, and Telegram message aliases', () => {
    for (const url of [
      'not a URL',
      'https://agency.example.invalid/',
      'https://agency.example.invalid/catalog/',
      'https://t.me/rental_agency',
    ]) {
      expect(sharedOfferUrl(url)).toBe(true);
    }
    for (const url of [
      'https://agency.example.invalid/?unit_id=1702',
      'https://agency.example.invalid/units/1702',
      'https://t.me/rental_agency/77',
    ]) {
      expect(sharedOfferUrl(url)).toBe(false);
    }
    expect(telegramPostUrl('not a URL')).toBe(false);
    expect(telegramPostUrl('https://t.me/rental_agency')).toBe(false);
    expect(telegramPostUrl('https://t.me/rental_agency/77')).toBe(true);
    expect(telegramPostUrl('https://t.me/c/12345/77')).toBe(true);
  });

  it('preserves distinct parsed IDs and floors in both orders, including legacy learned URL keys', () => {
    for (const website of ['/', '/apartments', '/catalog/', '/agency']) {
      const first = unit(1, 'A1702', 17, website);
      const second = unit(2, 'A1802', 18, website);
      expect(first.attributes.propertyId).toBe('A1702');
      expect(second.attributes.propertyId).toBe('A1802');
      expect(first.url === second.url).toBe(false);
      expect(first.officialUrl).toBe(second.officialUrl);
      first.identityKeys = [`url:${first.officialUrl}`];
      for (const input of [
        [first, second],
        [second, first],
      ]) {
        expect(deduplicateOffers(input).length).toBe(2);
      }
    }
  });

  it('does not merge unrelated listings merely because they advertise the same homepage or catalog', () => {
    for (const website of ['/', '/apartments', '/catalog/', '/agency']) {
      const first = {
        ...unit(1, 'A1702', 17, website),
        attributes: {},
        contacts: {},
      };
      const second = {
        ...unit(2, 'A1802', 18, website),
        attributes: {},
        contacts: {},
      };
      expect(deduplicateOffers([first, second]).length).toBe(2);
    }
  });

  it('vetoes conflicting identities before even a detail URL can union them, without an unidentified bridge', () => {
    const first = unit(1, 'A1702', 17, '/listing/shared');
    const second = unit(2, 'A1802', 18, '/listing/shared');
    const bridge = {
      ...unit(3, 'A1702', 17, '/listing/shared'),
      attributes: {},
    };
    for (const input of [
      [first, bridge, second],
      [bridge, second, first],
      [second, first, bridge],
    ]) {
      expect(deduplicateOffers(input).length).toBe(3);
    }
  });

  it('retains same-unit price updates, cross-source aliases, and established official detail links', () => {
    const first = unit(1);
    const update = {
      ...unit(3),
      price: { amount: 9_000_000, currency: 'VND', period: 'month' },
      priceVnd: 9_000_000,
    };
    expect(deduplicateOffers([first, update]).length).toBe(1);
    const alias = {
      ...unit(4, 'OTHER-1702'),
      sourceId: 'telegram:other-agent',
    };
    expect(deduplicateOffers([first, alias]).length).toBe(1);
    const official = {
      ...unit(5),
      sourceId: 'official:ocean-home',
      sourceType: 'official-web',
      officialUrl: 'https://ocean-home.example.invalid/units/1702',
    };
    const repost = {
      ...unit(6),
      sourceId: 'telegram:other-agent',
      officialUrl: official.officialUrl,
      contacts: {},
      attributes: {},
    };
    expect(deduplicateOffers([official, repost]).length).toBe(1);
  });

  it('retains edits of the same message even when its explicit identity changes', () => {
    const first = unit(1);
    const edit = { ...unit(1, 'A1802', 18), updatedAt: '2026-10-08T01:00:00Z' };
    for (const input of [
      [first, edit],
      [edit, first],
    ]) {
      const merged = deduplicateOffers(input);
      expect(merged.length).toBe(1);
      expect(merged[0].attributes.propertyId).toBe('A1802');
    }
  });

  it('retains both units through independent writes, fresh binary readback, and search in both orders', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    for (const input of [
      [unit(1), unit(2, 'A1802', 18)],
      [unit(2, 'A1802', 18), unit(1)],
    ]) {
      const directory = await mkdtemp(join(tmpdir(), 'issue-150-'));
      const options = {
        directory,
        binaryMirror: process.env.REQUIRE_REAL_CLINK === '1',
      };
      try {
        await new LinksStore(options).saveOffers([input[0]]);
        await new LinksStore(options).saveOffers([input[1]]);
        await new LinksStore(options).saveOffers([unit(3)]);
        const restarted = new LinksStore(options);
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
    }
  });
});
