/* eslint local/no-changelog-comments: "off" -- Reproducible evidence contracts require fixed observation dates and historical-state wording. */

import { describe, expect, it } from 'test-anywhere';

import {
  PAGE_CLASSIFICATIONS,
  DomainScheduler,
  classifyListingPage,
} from '../src/browser-adapters.js';
import {
  createDomainRecords,
  createSemanticValue,
  validatePublicRecord,
} from '../src/domain-graph.js';
import {
  compareReleaseAudit,
  createReleaseAudit,
  evaluateReleaseGate,
  selectReleaseForAudit,
} from '../src/release-audit.js';
import {
  GRAMJS_SESSION_FORMAT,
  SESSION_FORMAT,
  createSessionEnvelope,
  inspectSessionFormat,
  inspectSessionEnvelope,
  sessionPayload,
} from '../src/session-envelope.js';
import {
  TELEGRAM_DISCOVERY_QUERIES,
  TelegramSourceDiscovery,
  classifyTelegramEntity,
} from '../src/telegram-discovery.js';
import {
  assembleTelegramAlbums,
  classifyTelegramPost,
  reconcileTelegramMaterials,
} from '../src/telegram-pipeline.js';
import {
  TRACE_STATUSES,
  TraceRecorder,
  createSegmentLedger,
  redactTraceValue,
} from '../src/trace.js';
import {
  deserializeRecords,
  queryRecords,
  serializeRecords,
} from '../src/links-store.js';
import { evaluatePagesPolicy } from '../scripts/pages-policy.mjs';
import { SubscriptionScheduler } from '../src/presets.js';
import { SearchService } from '../src/search-service.js';

describe('issue 20 Telegram discovery contract', () => {
  it('uses a reviewed, versioned EN/RU/VI query set', () => {
    expect(TELEGRAM_DISCOVERY_QUERIES.version).toBe(1);
    expect(TELEGRAM_DISCOVERY_QUERIES.queries.length >= 9).toBe(true);
    expect(
      new Set(
        TELEGRAM_DISCOVERY_QUERIES.queries.map(({ language }) => language)
      )
    ).toEqual(new Set(['en', 'ru', 'vi']));
  });

  it('rejects users from the constructor tag before reading identity fields', () => {
    const user = new Proxy(
      { _: 'user' },
      {
        get(target, key) {
          if (key !== '_') {
            throw new Error(`private field read: ${String(key)}`);
          }
          return target[key];
        },
      }
    );
    expect(classifyTelegramEntity(user)).toEqual({
      accepted: false,
      reason: 'private-user',
    });
    expect(classifyTelegramEntity({ _: 'chat', id: 4 })).toEqual({
      accepted: true,
      kind: 'chat',
    });
    expect(
      classifyTelegramEntity({ _: 'channel', id: 5, megagroup: true })
    ).toEqual({
      accepted: true,
      kind: 'megagroup',
    });
  });

  it('deduplicates transport aliases, preserves provenance, checkpoints, and caps focus at 40', async () => {
    const checkpoints = [];
    const source = (index, transport, username = `rent_${index}`) => ({
      entity: { _: 'channel', id: index, username },
      evidence: { audience: 1_000 - index, queryId: `q-${index % 3}` },
      transport,
    });
    const discovery = new TelegramSourceDiscovery({
      checkpoint: async (value) => checkpoints.push(value),
      providers: [
        { name: 'bot-api', discover: async () => [source(1, 'bot-api')] },
        {
          name: 'public-preview',
          discover: async () => [
            source(1, 'public-preview', 'RENT_1'),
            ...Array.from({ length: 45 }, (_, i) =>
              source(i + 2, 'public-preview')
            ),
          ],
        },
        {
          name: 'mtproto',
          discover: async () => [
            { entity: { _: 'user', id: 99 }, transport: 'mtproto' },
          ],
        },
      ],
    });

    const result = await discovery.discover({
      focus: 'nha-trang',
      maxResults: 40,
    });
    expect(result.sources.length).toBe(40);
    expect(
      result.sources[0].provenance.map(({ transport }) => transport)
    ).toEqual(['bot-api', 'public-preview']);
    expect(result.rejected).toEqual([
      { reason: 'private-user', transport: 'mtproto' },
    ]);
    expect(checkpoints.at(-1).complete).toBe(true);
  });

  it('resumes an incomplete discovery after its last successful provider', async () => {
    const records = new Map();
    const store = {
      loadRecords: async (kind) => records.get(kind) || [],
      updateRecords: async (kind, update) => {
        const next = await update(records.get(kind) || []);
        records.set(kind, next);
        return next;
      },
    };
    const checkpoint = async (value) =>
      store.updateRecords('telegram-discovery-checkpoint', (existing) => [
        ...existing.filter(({ id }) => id !== value.focus),
        { id: value.focus, ...value },
      ]);
    let configuredCalls = 0;
    let flakyCalls = 0;
    const discovery = new TelegramSourceDiscovery({
      checkpoint,
      providers: [
        {
          name: 'configured',
          discover: async () => {
            configuredCalls += 1;
            return [
              {
                entity: { _: 'channel', id: 1, username: 'configured' },
                transport: 'configured',
              },
            ];
          },
        },
        {
          name: 'flaky',
          discover: async () => {
            flakyCalls += 1;
            if (flakyCalls === 1) {
              throw new Error('temporary failure');
            }
            return [
              {
                entity: { _: 'channel', id: 2, username: 'recovered' },
                transport: 'public-preview',
              },
            ];
          },
        },
      ],
      store,
    });

    expect((await discovery.discover({ focus: 'nha-trang' })).complete).toBe(
      false
    );
    const resumed = await discovery.discover({ focus: 'nha-trang' });
    expect(resumed.complete).toBe(true);
    expect(resumed.sources.map(({ id }) => id)).toEqual([
      'telegram:configured',
      'telegram:recovered',
    ]);
    expect(configuredCalls).toBe(1);
    expect(flakyCalls).toBe(2);
  });
});

describe('issue 20 Telegram reconciliation contract', () => {
  it('labels multilingual offers and hard negatives separately from extraction', () => {
    expect(
      classifyTelegramPost('Apartment for rent in Nha Trang, 12m VND/month')
        .label
    ).toBe('offer');
    expect(classifyTelegramPost('Ищу квартиру в Нячанге').label).toBe(
      'request'
    );
    expect(classifyTelegramPost('Bán căn hộ tại Nha Trang').label).toBe('sale');
    expect(classifyTelegramPost('Apartment for rent in Da Nang').label).toBe(
      'wrong-location'
    );
    expect(classifyTelegramPost('Visa service in Nha Trang').label).toBe(
      'service'
    );
    expect(classifyTelegramPost('Nice day!').label).toBe('unrelated');
  });

  it('reconstructs edited albums and unique media without re-emitting deleted members', () => {
    const album = assembleTelegramAlbums([
      {
        chatId: 7,
        groupedId: 'g',
        id: 1,
        text: 'Old caption',
        editDate: 1,
        mediaId: 'a',
      },
      {
        chatId: 7,
        groupedId: 'g',
        id: 1,
        text: 'Apartment for rent',
        editDate: 2,
        mediaId: 'a',
      },
      { chatId: 7, groupedId: 'g', id: 2, mediaId: 'b' },
      { chatId: 7, groupedId: 'g', id: 3, deleted: true, mediaId: 'c' },
    ])[0];
    expect(album.id).toBe('telegram-album:7:g');
    expect(album.text).toBe('Apartment for rent');
    expect(album.mediaIds).toEqual(['a', 'b']);
    expect(album.messageIds).toEqual([1, 2]);
  });

  it('bounds photo OCR and records explicit degraded work instead of fake offers', async () => {
    const photoOnly = [{ chatId: 1, groupedId: 'photo', id: 1, mediaId: 'p1' }];
    const degraded = await reconcileTelegramMaterials(photoOnly);
    expect(degraded.complete).toBe(false);
    expect(degraded.reviewQueue[0].reason).toBe('photo-only-ocr-unavailable');

    const calls = [];
    const parsed = await reconcileTelegramMaterials(photoOnly, {
      ocr: async (mediaId) => {
        calls.push(mediaId);
        return 'Apartment for rent in Nha Trang, 9 million VND/month';
      },
    });
    expect(parsed.accepted.length).toBe(1);
    expect(parsed.accepted[0].ocrState).toBe('completed');
    expect(calls).toEqual(['p1']);
  });
});

describe('issue 20 observability and graph contract', () => {
  it('correlates collection, normalization, search, and delivery without recipient identities', async () => {
    const records = new Map();
    const offers = [];
    const store = {
      listOffers: async () => [...offers],
      saveOffers: async (values) => offers.push(...values),
      updateRecords: async (kind, update) => {
        const next = await update(records.get(kind) || []);
        records.set(kind, next);
        return next;
      },
    };
    const now = () => new Date('2026-09-22T10:00:00Z');
    const traceRecorder = new TraceRecorder({ now, store });
    const service = new SearchService({
      collector: {
        collect: async (_sources, _query, { runId, traceRecorder: trace }) => {
          for (const stage of ['collection', 'normalization']) {
            trace.record({ runId, stage, status: 'start' });
            trace.record({ runId, stage, status: 'success' });
          }
          return [
            {
              collectedAt: '2026-09-22T09:00:00Z',
              id: 'offer-1',
              priceVnd: 1_000_000,
              sourceId: 'source-1',
              title: 'Room',
            },
          ];
        },
      },
      now,
      registry: { list: async () => [{ id: 'source-1' }] },
      store,
      traceRecorder,
    });
    const scheduler = new SubscriptionScheduler({
      deliver: async () => {},
      now,
      presets: {
        listSubscriptions: async () => [{ options: {}, userId: 'private-777' }],
        markDelivered: async () => {},
        markSuccessfulRun: async () => {},
        unseen: async (_userId, values) => values,
      },
      search: (options) => service.search(options),
      store,
      traceRecorder,
    });

    await scheduler.tick();
    const correlated = traceRecorder.export().events;
    expect(new Set(correlated.map(({ runId }) => runId)).size).toBe(1);
    expect(new Set(correlated.map(({ stage }) => stage))).toEqual(
      new Set([
        'collection',
        'delivery',
        'normalization',
        'search',
        'subscription-search',
      ])
    );
    expect(JSON.stringify(correlated)).not.toContain('private-777');
    expect((records.get('traces') || []).length > 0).toBe(true);
  });

  it('accounts for every meaningful segment and never reports 100% on errors', () => {
    const ledger = createSegmentLedger(
      'Price: 12m\nunknown phrase\n\nContact: @owner',
      ({ text }) =>
        text.startsWith('unknown')
          ? { state: 'error', reason: 'unsupported' }
          : { state: 'mapped' }
    );
    expect(ledger.segments.length).toBe(3);
    expect(ledger.segments[0].hash.length).toBe(64);
    expect(ledger.segments[0].text).toBe(undefined);
    expect(ledger.summary).toEqual({
      error: 1,
      mapped: 2,
      reviewedUnknown: 0,
      coverage: 2 / 3,
    });
  });

  it('redacts unknown nested and cyclic values before bounded persistence', () => {
    const secret = {
      authorization: 'Bearer token-value',
      email: 'owner@example.com',
    };
    secret.self = secret;
    const recorder = new TraceRecorder({
      maxEvents: 2,
      now: () => new Date('2026-09-22T00:00:00Z'),
    });
    recorder.record({
      runId: 'r',
      stage: 'fetch',
      status: 'start',
      metadata: secret,
    });
    recorder.record({
      runId: 'r',
      stage: 'fetch',
      status: 'failure',
      metadata: { phone: '+84 123 456 789' },
    });
    recorder.record({ runId: 'r', stage: 'fetch', status: 'cancelled' });
    expect(TRACE_STATUSES.has('degraded')).toBe(true);
    expect(JSON.stringify(recorder.export())).not.toContain('token-value');
    expect(JSON.stringify(recorder.export())).not.toContain(
      'owner@example.com'
    );
    expect(recorder.export().events.length).toBe(2);
    expect(recorder.export().dropped).toBe(1);
  });

  it('retains causal error details while redacting secrets embedded in messages', () => {
    const cause = Object.assign(
      new Error('session=private-session rejected for owner@example.com'),
      { code: 'AUTH_FAILED' }
    );
    const error = new Error(
      'token=123456789:abcdefghijklmnopqrstuvwxyzABCDE failed',
      { cause }
    );
    const redacted = redactTraceValue(error);
    expect(redacted.name).toBe('Error');
    expect(redacted.code).toBe(undefined);
    expect(redacted.cause.code).toBe('AUTH_FAILED');
    expect(redacted.cause.message).toContain('[REDACTED]');
    expect(JSON.stringify(redacted)).not.toContain('private-session');
    expect(JSON.stringify(redacted)).not.toContain(
      'abcdefghijklmnopqrstuvwxyz'
    );
    expect(JSON.stringify(redacted)).not.toContain('owner@example.com');
  });

  it('stores typed, addressable semantic values and blocks private graph data', () => {
    const value = createSemanticValue('known', 'Nha Trang', {
      confidence: 0.95,
      language: 'en',
      source: 'message:1',
    });
    const records = createDomainRecords({
      id: 'offer:1',
      type: 'offer',
      values: { location: value },
    });
    expect(
      records.some(({ predicate }) => predicate === 'offer.location.value')
    ).toBe(true);
    expect(() =>
      validatePublicRecord({ accessHash: 'secret', type: 'offer' })
    ).toThrow();
    expect(() =>
      createDomainRecords({
        id: 'offer:private',
        type: 'offer',
        values: { accessHash: 'secret' },
      })
    ).toThrow();
  });

  it('round-trips and queries typed graph links through canonical LiNo records', () => {
    const records = createDomainRecords({
      id: 'offer:1',
      type: 'offer',
      values: {
        location: createSemanticValue('known', 'Nha Trang', {
          language: 'en',
          source: 'message:1',
        }),
      },
    });
    const notation = serializeRecords('domain-record', records);

    expect(deserializeRecords('domain-record', notation)).toEqual(records);
    expect(
      queryRecords('domain-record', notation, {
        path: 'predicate',
        value: 'offer.location.value',
      })
    ).toEqual([
      records.find(({ predicate }) => predicate === 'offer.location.value'),
    ]);
  });
});

describe('issue 20 session contract', () => {
  it('uses an explicit native mtcute envelope and classifies states without exposing payloads', () => {
    const envelope = createSessionEnvelope('secret-session', {
      createdAt: '2026-09-22T00:00:00Z',
      dcId: 2,
      expectedUserId: '44',
      provider: 'mtcute',
    });
    expect(sessionPayload(envelope)).toBe('secret-session');
    expect(inspectSessionEnvelope(envelope)).toEqual({
      createdAt: '2026-09-22T00:00:00Z',
      expectedUserId: '44',
      format: SESSION_FORMAT,
      provider: 'mtcute',
      schemaVersion: 1,
      sessionId: 'telegram-user:44',
      state: 'active-unverified',
    });
    expect(JSON.stringify(inspectSessionEnvelope(envelope))).not.toContain(
      'secret-session'
    );
    expect(inspectSessionEnvelope('{bad').state).toBe('malformed');
    expect(
      inspectSessionEnvelope({
        format: SESSION_FORMAT,
        payload: 'x',
        provider: 'mtcute',
        schemaVersion: 2,
        sessionId: 'telegram-user:44',
      })
    ).toEqual({
      format: SESSION_FORMAT,
      provider: 'mtcute',
      reason: 'unsupported-schema-version',
      schemaVersion: 2,
      state: 'unsupported',
    });
    expect(inspectSessionFormat(GRAMJS_SESSION_FORMAT).state).toBe(
      'relogin-required'
    );
    expect(() =>
      sessionPayload(
        JSON.stringify({
          schemaVersion: 1,
          format: 'gramjs/string-session-v1',
          payload: 'x',
        })
      )
    ).toThrow();
  });
});

describe('issue 20 browser, release, and Pages gates', () => {
  it('classifies redirects/challenges instead of treating them as empty success', () => {
    expect(
      classifyListingPage({
        status: 403,
        title: 'Cloudflare',
        url: 'https://x.test',
      })
    ).toBe(PAGE_CLASSIFICATIONS.CHALLENGE);
    expect(
      classifyListingPage({
        status: 200,
        title: 'Login',
        url: 'https://x.test/login',
      })
    ).toBe(PAGE_CLASSIFICATIONS.LOGIN);
    expect(
      classifyListingPage({
        status: 200,
        title: 'Căn hộ bán',
        url: 'https://x.test/sale',
      })
    ).toBe(PAGE_CLASSIFICATIONS.SALE);
    expect(
      classifyListingPage({
        cards: 3,
        status: 200,
        title: 'Cho thuê',
        url: 'https://x.test/rent',
      })
    ).toBe(PAGE_CLASSIFICATIONS.RENTAL);
  });

  it('serializes a domain while allowing independent domains to overlap', async () => {
    const scheduler = new DomainScheduler({
      delay: async () => {},
      maxConcurrentDomains: 2,
    });
    const active = new Map();
    let overlap = false;
    const run = (url) =>
      scheduler.run(url, async () => {
        const domain = new globalThis.URL(url).hostname;
        expect(active.get(domain) || 0).toBe(0);
        active.set(domain, 1);
        overlap ||=
          [...active.values()].reduce((sum, value) => sum + value, 0) > 1;
        await Promise.resolve();
        active.set(domain, 0);
        return domain;
      });
    await Promise.all([
      run('https://a.test/1'),
      run('https://a.test/2'),
      run('https://b.test/1'),
    ]);
    expect(overlap).toBe(true);
  });

  it('keeps release baselines immutable and marks missing live credentials pending', () => {
    const baseline = {
      release: { tag: 'v1', sha: 'abc' },
      gates: { parser: 'pass' },
    };
    const candidate = {
      release: { tag: 'v2', sha: 'def' },
      gates: { parser: 'failure' },
    };
    expect(compareReleaseAudit(baseline, candidate).regressions).toEqual([
      'parser',
    ]);
    expect(
      evaluateReleaseGate({ mode: 'live', credentials: false }).status
    ).toBe('pending');
    expect(baseline.release.tag).toBe('v1');
  });

  it('selects each release once and emits a sanitized pending audit without live evidence', () => {
    const selected = selectReleaseForAudit(
      [
        { tag: 'v1', publishedAt: '2026-01-01' },
        { tag: 'v2', publishedAt: '2026-02-01' },
      ],
      { auditedTags: ['v1'] }
    );
    expect(selected.tag).toBe('v2');
    const report = createReleaseAudit({
      mode: 'live',
      credentials: false,
      release: { tag: 'v2', commitSha: 'abc', packageVersion: '1.0.0' },
      runtime: { token: 'must-not-persist' },
      now: () => new Date('2026-09-22T00:00:00Z'),
    });
    expect(report.status).toBe('pending');
    expect(JSON.stringify(report)).not.toContain('must-not-persist');
    expect(Object.isFrozen(report)).toBe(true);
  });

  it('makes Pages optional, read-only on PRs, and actionable when required', () => {
    expect(
      evaluatePagesPolicy({ eventName: 'pull_request', required: true })
    ).toEqual({ reason: 'pull-request-read-only', status: 'skipped' });
    expect(evaluatePagesPolicy({ eventName: 'push', required: false })).toEqual(
      { reason: 'deployment-optional', status: 'skipped' }
    );
    expect(
      evaluatePagesPolicy({ eventName: 'push', required: true, apiStatus: 404 })
    ).toEqual({
      reason: 'enable-pages-in-repository-settings',
      status: 'failure',
    });
    expect(
      evaluatePagesPolicy({
        eventName: 'push',
        required: true,
        apiStatus: 200,
        buildType: 'workflow',
      })
    ).toEqual({ reason: 'pages-enabled', status: 'enabled' });
  });
});
