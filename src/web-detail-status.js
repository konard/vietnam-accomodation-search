// Availability comes from the primary listing, never recommendations or age alone.
import { stableHash } from './utils.js';

export function extractDetailStatus() {
  const root = (
    globalThis.document.querySelector(
      '[itemtype*="RealEstateListing"], .product-detail, .detail-page, main, article'
    ) || globalThis.document.body
  ).cloneNode(true);
  root
    .querySelectorAll(
      '[class*="related"], [class*="recommend"], [class*="similar"], aside, footer, script, style'
    )
    .forEach((node) => node.remove());
  const text = String(root.innerText || root.textContent || '').slice(0, 65536);
  const labeledDate = (label) => {
    const match = text.match(
      new RegExp(
        `${label}\\s*[:：]?\\s*(\\d{1,2})[/-](\\d{1,2})[/-](\\d{4})`,
        'iu'
      )
    );
    return match
      ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}T00:00:00Z`
      : undefined;
  };
  const date = (name, label) =>
    root
      .querySelector(`[itemprop="${name}"], time[datetime][data-${name}]`)
      ?.getAttribute('datetime') ||
    root.querySelector(`[itemprop="${name}"]`)?.getAttribute('content') ||
    labeledDate(label);
  return {
    text,
    publishedAt: date('datePublished', 'Ngày\\s*đăng'),
    expiresAt: date('validThrough', 'Ngày\\s*hết\\s*hạn'),
  };
}

export function detailStatus(evidence, now = new Date()) {
  const text = String(evidence.text || '').slice(0, 65536);
  const expired =
    /(?:tin\s*(?:đăng|này).{0,25}(?:đã\s*)?hết\s*hạn|listing\s*(?:has\s*)?expired|объявление\s*(?:уже\s*)?истекло)/iu.test(
      text
    );
  const rented =
    /(?:đã\s*(?:cho\s*)?thuê|đã\s*có\s*khách\s*thuê|already\s*rented|сдан[оа]\s*(?:в\s*аренду)?)/iu.test(
      text
    );
  const active =
    /(?:còn\s*(?:phòng|trống)|đang\s*cho\s*thuê|available\s*(?:now|for\s*rent)|listing\s*active)/iu.test(
      text
    );
  const date = (value) =>
    Number.isFinite(Date.parse(value))
      ? new Date(value).toISOString()
      : undefined;
  const publishedAt = date(evidence.publishedAt);
  const expiresAt = date(evidence.expiresAt);
  const status =
    expired || (expiresAt && Date.parse(expiresAt) <= now.getTime())
      ? 'expired'
      : rented
        ? 'rented'
        : active
          ? 'active'
          : 'unknown';
  return {
    status,
    ...(publishedAt ? { publishedAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    checkedAt: now.toISOString(),
  };
}

export class WebDetailStatusCache {
  constructor({
    store,
    now = () => new Date(),
    ttlMs = 6 * 60 * 60 * 1000,
  } = {}) {
    this.store = store;
    this.now = now;
    this.ttlMs = ttlMs;
    this.memory = new Map();
  }
  async inspect(url, fetch, { signal } = {}) {
    signal?.throwIfAborted();
    const id = stableHash(url);
    const records = this.store
      ? await this.store.loadRecords('web-detail-statuses')
      : [...this.memory.values()];
    const cached = records.find((record) => record.id === id);
    if (
      cached &&
      cached.url === url &&
      Date.parse(cached.checkedAt) <= this.now().getTime() &&
      this.now().getTime() - Date.parse(cached.checkedAt) < this.ttlMs
    ) {
      return cached;
    }
    const evidence = await fetch();
    signal?.throwIfAborted();
    const record = { id, url, ...detailStatus(evidence, this.now()) };
    const next = [...records.filter((item) => item.id !== id), record].slice(
      -1000
    );
    if (this.store) {
      await this.store.saveRecords('web-detail-statuses', next);
    } else {
      this.memory = new Map(next.map((item) => [item.id, item]));
    }
    return record;
  }
}

export function applyDetailStatus(offer, detail) {
  const terminal = ['expired', 'rented'].includes(detail.status);
  return {
    ...offer,
    attributes: {
      ...offer.attributes,
      detailStatus: detail.status,
      detailCheckedAt: detail.checkedAt,
      ...(detail.publishedAt ? { detailPublishedAt: detail.publishedAt } : {}),
      ...(detail.expiresAt ? { detailExpiresAt: detail.expiresAt } : {}),
      availability: terminal
        ? 'unavailable'
        : detail.status === 'active'
          ? 'available'
          : 'unknown',
      availableNow: terminal
        ? false
        : detail.status === 'active'
          ? true
          : undefined,
    },
  };
}
