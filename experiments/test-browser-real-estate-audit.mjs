import { describe, expect, it } from 'test-anywhere';

import {
  assertManualLocalRun,
  classifyPage,
  DomainPacer,
  groupSitesByDomain,
  nextDelayMilliseconds,
  runDomainQueues,
  sanitizedUrl,
  segmentLedger,
  summarizeCards,
} from './browser-real-estate-audit-lib.mjs';

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

  it('redacts query strings and credentials from recorded URLs', () => {
    expect(
      sanitizedUrl('https://user:pass@example.com/rent?q=Nha+Trang#x')
    ).toBe('https://example.com/rent');
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
