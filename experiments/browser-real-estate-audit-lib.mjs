import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { URL } from 'node:url';

const CHALLENGE_PATTERN =
  /captcha|cloudflare|checking your browser|just a moment|verify (?:you are|that you are) human|security check/iu;
const RATE_LIMIT_PATTERN = /too many requests|rate limit|try again later/iu;
const ACCESS_DENIED_PATTERN =
  /access denied|forbidden|request blocked|not authorized/iu;
const RENT_PATTERN =
  /for rent|rental|lease|cho thuê|thuê căn hộ|аренд|снять|сда[её]т/iu;
const SALE_PATTERN = /for sale|mua bán|bán nhà|bán căn hộ|продаж/iu;

const SEGMENT_PATTERNS = [
  [
    'price',
    /(?:\d[\d\s.,]{0,15}\s*(?:₫|đ|vnd|usd|\$|triệu|million|млн)|(?:vnd|usd|\$)\s*\d)/iu,
  ],
  [
    'rooms',
    /(?:bedrooms?|rooms?|studio|phòng ngủ|phòng|спальн|комнат|студи)/iu,
  ],
  [
    'location',
    /address|location|district|ward|địa chỉ|quận|phường|адрес|район/iu,
  ],
  [
    'availability',
    /available|vacant|from\s+\d|còn trống|có sẵn|свобод|доступ/iu,
  ],
  [
    'contact',
    /contact|phone|zalo|whatsapp|telegram|liên hệ|điện thoại|телефон|контакт/iu,
  ],
  [
    'amenity',
    /furnished|pool|parking|wifi|balcony|nội thất|hồ bơi|мебел|бассейн/iu,
  ],
  ['area', /\d{1,4}(?:[.,]\d{1,2})?\s*(?:m²|m2|м²)/iu],
  ['intent', RENT_PATTERN],
];

export const AUDIT_SCHEMA_VERSION = 1;

export function assertManualLocalRun(environment = {}) {
  const ciMarkers = [
    'CI',
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'BUILDKITE',
    'CIRCLECI',
    'JENKINS_URL',
  ];
  if (ciMarkers.some((name) => environment[name])) {
    throw new Error(
      'Real-data browser E2E is manual/local-only and refuses to run in CI/CD.'
    );
  }
}

export function hashText(value = '') {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

export function sanitizedUrl(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[invalid-url]';
  }
}

export function siteDomain(site) {
  return new URL(site.url).hostname.replace(/^www\./u, '').toLowerCase();
}

export function classifyPage({
  cardCount = 0,
  text = '',
  title = '',
  url = '',
}) {
  const content = `${title}\n${text}`;
  if (CHALLENGE_PATTERN.test(content)) {
    return 'challenge';
  }
  if (RATE_LIMIT_PATTERN.test(content)) {
    return 'rate_limited';
  }
  if (ACCESS_DENIED_PATTERN.test(content)) {
    return 'access_denied';
  }
  if (SALE_PATTERN.test(content) && !RENT_PATTERN.test(content)) {
    return 'wrong_intent_sale';
  }
  if (cardCount === 0) {
    return 'zero_cards';
  }
  if (!/^https?:/u.test(url)) {
    return 'unexpected_navigation';
  }
  return 'success';
}

function meaningfulLines(value) {
  return String(value)
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter((line) => line.length >= 2 && line.length <= 500)
    .slice(0, 200);
}

export function segmentLedger(value) {
  const segments = meaningfulLines(value).map((line, index) => {
    const categories = SEGMENT_PATTERNS.filter(([, pattern]) =>
      pattern.test(line)
    ).map(([category]) => category);
    return {
      categories,
      consumed: categories.length > 0,
      hash: hashText(line),
      index,
      length: line.length,
    };
  });
  const consumed = segments.filter((segment) => segment.consumed).length;
  return {
    completeness: segments.length === 0 ? 0 : consumed / segments.length,
    consumed,
    segments,
    total: segments.length,
    unconsumed: segments.length - consumed,
  };
}

export function summarizeCards(cards = []) {
  const ledgers = cards.slice(0, 100).map((card) => segmentLedger(card.text));
  const totals = ledgers.reduce(
    (result, ledger) => ({
      consumed: result.consumed + ledger.consumed,
      total: result.total + ledger.total,
      unconsumed: result.unconsumed + ledger.unconsumed,
    }),
    { consumed: 0, total: 0, unconsumed: 0 }
  );
  return {
    cardCount: cards.length,
    completeness: totals.total === 0 ? 0 : totals.consumed / totals.total,
    incompleteCards: ledgers.filter((ledger) => ledger.unconsumed > 0).length,
    ...totals,
    segmentEvidence: ledgers.flatMap((ledger, cardIndex) =>
      ledger.segments.map((segment) => ({ ...segment, cardIndex }))
    ),
  };
}

export function nextDelayMilliseconds(
  { failures = 0, minDelayMs = 3_000, maxDelayMs = 8_000 } = {},
  random = Math.random
) {
  const minimum = Math.max(0, Number(minDelayMs));
  const maximum = Math.max(minimum, Number(maxDelayMs));
  const jittered = minimum + Math.floor(random() * (maximum - minimum + 1));
  return Math.min(maximum * 8, jittered * 2 ** Math.min(failures, 3));
}

export class DomainPacer {
  constructor(options = {}) {
    this.options = options;
    this.states = new Map();
  }

  delayFor(domain, random) {
    const state = this.states.get(domain) || { failures: 0 };
    return nextDelayMilliseconds({ ...this.options, ...state }, random);
  }

  record(domain, outcome) {
    const previous = this.states.get(domain) || { failures: 0 };
    const limited = ['challenge', 'rate_limited', 'access_denied'].includes(
      outcome
    );
    this.states.set(domain, {
      failures: limited ? Math.min(previous.failures + 1, 3) : 0,
    });
  }
}

export function groupSitesByDomain(sites) {
  const groups = new Map();
  for (const site of sites) {
    const domain = siteDomain(site);
    groups.set(domain, [...(groups.get(domain) || []), site]);
  }
  return [...groups.entries()].map(([domain, entries]) => ({
    domain,
    sites: entries,
  }));
}

export async function runDomainQueues(sites, concurrency, handler) {
  const groups = groupSitesByDomain(sites);
  let cursor = 0;
  const results = [];
  const worker = async () => {
    while (cursor < groups.length) {
      const group = groups[cursor];
      cursor += 1;
      for (const site of group.sites) {
        results.push(await handler(site, group.domain));
      }
    }
  };
  const count = Math.max(1, Math.min(Number(concurrency) || 1, groups.length));
  await Promise.all(Array.from({ length: count }, worker));
  return results;
}

export async function createPrivateTraceWriter(
  directory,
  runId = randomUUID()
) {
  await mkdir(directory, { mode: 0o700, recursive: true });
  const path = `${directory}/events.jsonl`;
  const handle = await open(path, 'wx', 0o600);
  await handle.close();
  let sequence = 0;
  let pending = Promise.resolve();
  return {
    path,
    runId,
    write: async (event) => {
      sequence += 1;
      const record = `${JSON.stringify({
        schemaVersion: AUDIT_SCHEMA_VERSION,
        runId,
        sequence,
        timestamp: new Date().toISOString(),
        ...event,
      })}\n`;
      pending = pending.then(() => appendFile(path, record, { mode: 0o600 }));
      await pending;
    },
  };
}

export async function ensurePrivateParent(path) {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
}
