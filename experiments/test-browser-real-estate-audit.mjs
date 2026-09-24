import { describe, expect, it } from 'test-anywhere';
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertManualLocalRun,
  assessSourceCoverage,
  classifyPage,
  DomainPacer,
  groupSitesByDomain,
  nextDelayMilliseconds,
  runDomainQueues,
  sanitizedUrl,
  segmentLedger,
  summarizeCards,
  summarizeStructuredCards,
} from './browser-real-estate-audit-lib.mjs';

// eslint-disable-next-line max-lines-per-function -- The audit contract is reviewed as one cohesive behavior suite.
describe('manual browser real-estate audit helpers', () => {
  it('refuses to start the real-data E2E audit in CI/CD', () => {
    expect(() => assertManualLocalRun({ GITHUB_ACTIONS: 'true' })).toThrow(
      /manual\/local/iu
    );
    expect(() => assertManualLocalRun({})).not.toThrow();
  });

  it('classifies challenges, sale routes, empty pages, and useful pages', () => {
    expect(classifyPage({ text: 'Just a moment… Cloudflare' })).toBe(
      'challenge'
    );
    expect(classifyPage({ text: 'Mua bán bất động sản' })).toBe(
      'wrong_intent_sale'
    );
    expect(classifyPage({ text: 'Cho thuê căn hộ' })).toBe('zero_cards');
    expect(classifyPage({ status: 403, text: 'Cho thuê căn hộ' })).toBe(
      'challenge'
    );
    expect(classifyPage({ status: 429, text: 'For rent' })).toBe(
      'rate_limited'
    );
    expect(
      classifyPage({ cardCount: 2, text: 'For rent', url: 'https://site.test' })
    ).toBe('success');
  });

  it('keeps raw listing text out of recorded segment evidence', () => {
    const privateLine = 'Contact +84 123 456 789';
    const ledger = segmentLedger(
      `Apartment for rent\n${privateLine}\nNice view`
    );
    expect(ledger.total).toBe(3);
    expect(ledger.consumed).toBe(2);
    expect(ledger.unconsumed).toBe(1);
    expect(JSON.stringify(ledger)).not.toContain(privateLine);
  });

  it('marks every card with unconsumed segments as incomplete', () => {
    const summary = summarizeCards([
      { text: 'For rent\nUSD 500\nUnclassified prose' },
      { text: 'Cho thuê\n2 phòng\n10 triệu VND' },
    ]);
    expect(summary.cardCount).toBe(2);
    expect(summary.incompleteCards).toBe(1);
    expect(summary.unconsumed).toBe(1);
    expect(summary.completeness).toBeLessThan(1);
  });

  it('accepts fully accounted semantic cards and page-level contact evidence', () => {
    const cards = [
      {
        attributes: { bedrooms: 2, propertyId: 'A902' },
        photos: ['https://rent.example/a902.jpg'],
        semantic: {
          availability: 'For Rent',
          bedrooms: '2',
          location: 'North Nha Trang',
          price: '$420/mo',
        },
        segments: [
          { category: 'title', text: 'Apartment ID A902' },
          { category: 'price', text: '$420/mo' },
        ],
        title: 'Apartment ID A902',
        url: 'https://rent.example/listings/A902',
      },
    ];
    const summary = summarizeStructuredCards(cards);
    const coverage = assessSourceCoverage({
      cards,
      finalUrl: 'https://rent.example/nha-trang/rentals',
      pageSemantic: { contact: 'Contact +84 123 456 789' },
      pageText: 'Nha Trang apartments for rent',
      requestedUrl: 'https://rent.example/nha-trang/rentals',
    });

    expect(summary.incompleteCards).toBe(0);
    expect(summary.unconsumed).toBe(0);
    expect(coverage.missing).toEqual([]);
    expect(JSON.stringify(summary)).not.toContain('Apartment ID A902');
    expect(JSON.stringify(coverage)).not.toContain('+84 123 456 789');
  });

  it('keeps unknown card segments and missing price periods actionable', () => {
    const cards = [
      {
        attributes: { propertyId: '42' },
        photos: ['https://rent.example/42.jpg'],
        semantic: {
          availability: 'available',
          location: 'Nha Trang',
          price: '500 USD',
        },
        segments: [{ category: 'unknown', text: 'Unmapped control' }],
        title: 'Apartment',
        url: 'https://rent.example/listings/42',
      },
    ];
    expect(summarizeStructuredCards(cards).incompleteCards).toBe(1);
    expect(
      assessSourceCoverage({
        cards,
        finalUrl: 'https://rent.example/rentals',
        pageSemantic: { contact: 'Contact form' },
        pageText: 'Nha Trang rental',
        requestedUrl: 'https://rent.example/rentals',
      }).missing
    ).toContain('price-period');
  });

  it('redacts query strings and credentials from recorded URLs', () => {
    const unsafeUrl = new globalThis.URL(
      'https://example.com/rent?q=Nha+Trang#x'
    );
    unsafeUrl.username = 'example-user';
    unsafeUrl.password = ['example', 'value'].join('-');
    expect(sanitizedUrl(unsafeUrl.toString())).toBe('https://example.com/rent');
  });

  it('backs off after challenge outcomes and resets after success', () => {
    const pacer = new DomainPacer({ minDelayMs: 1_000, maxDelayMs: 2_000 });
    expect(pacer.delayFor('example.com', () => 0)).toBe(1_000);
    pacer.record('example.com', 'challenge');
    expect(pacer.delayFor('example.com', () => 0)).toBe(2_000);
    pacer.record('example.com', 'success');
    expect(pacer.delayFor('example.com', () => 0)).toBe(1_000);
    expect(
      nextDelayMilliseconds(
        { failures: 3, minDelayMs: 1_000, maxDelayMs: 2_000 },
        () => 1
      )
    ).toBe(16_000);
  });

  it('persists challenge cooldown state privately across audit restarts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'browser-pacer-'));
    const statePath = join(directory, 'cooldowns.json');
    try {
      const first = await DomainPacer.open({
        maxDelayMs: 2_000,
        minDelayMs: 1_000,
        now: () => 10_000,
        statePath,
      });
      await first.record('challenged.example', 'challenge');

      const restarted = await DomainPacer.open({
        maxDelayMs: 2_000,
        minDelayMs: 1_000,
        now: () => 10_500,
        statePath,
      });
      expect(restarted.delayFor('challenged.example', () => 0)).toBeGreaterThan(
        1_000
      );
      expect((await stat(statePath)).mode & 0o777).toBe(0o600);
      expect(JSON.stringify(restarted.snapshot())).not.toContain('http');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('never tightens permissions on a caller-owned state directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'browser-pacer-parent-'));
    const statePath = join(directory, 'cooldowns.json');
    try {
      await chmod(directory, 0o755);
      const pacer = await DomainPacer.open({ statePath });
      await pacer.record('example.test', 'success');

      expect((await stat(directory)).mode & 0o777).toBe(0o755);
      expect((await stat(statePath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('serializes each domain while allowing distinct-domain workers', async () => {
    const sites = [
      { id: 'a1', url: 'https://a.test/one' },
      { id: 'b1', url: 'https://b.test/one' },
      { id: 'a2', url: 'https://a.test/two' },
    ];
    expect(groupSitesByDomain(sites).map(({ domain }) => domain)).toEqual([
      'a.test',
      'b.test',
    ]);
    const active = new Set();
    let crossDomainOverlap = false;
    await runDomainQueues(sites, 2, async (site, domain) => {
      expect(active.has(domain)).toBe(false);
      active.add(domain);
      crossDomainOverlap ||= active.size > 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      active.delete(domain);
      return site.id;
    });
    expect(crossDomainOverlap).toBe(true);
  });
});
