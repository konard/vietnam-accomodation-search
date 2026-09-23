/* eslint local/no-changelog-comments: "off" -- Reproducible envelope, release, and edit fixtures require fixed dates. */

import { describe, expect, it } from 'test-anywhere';

import {
  BrowserCollector,
  BrowserPageError,
} from '../src/browser-collector.js';
import {
  DomainScheduler,
  PAGE_CLASSIFICATIONS,
  browserAdapterFor,
  classifyBrowserFailure,
  classifyListingPage,
} from '../src/browser-adapters.js';
import {
  createDomainRecords,
  createSemanticValue,
  validatePublicRecord,
} from '../src/domain-graph.js';
import {
  RELEASE_AUDIT_GATES,
  compareReleaseAudit,
  createReleaseAudit,
  evaluateReleaseGate,
  selectReleaseForAudit,
} from '../src/release-audit.js';

import {
  GRAMJS_SESSION_FORMAT,
  SESSION_FORMAT,
  createSessionEnvelope,
  inspectSessionEnvelope,
  inspectSessionFormat,
  nativeSessionPayload,
  sessionPayload,
} from '../src/session-envelope.js';
import {
  BotApiTelegramDiscoveryProvider,
  ConfiguredTelegramDiscoveryProvider,
  PublicPreviewTelegramDiscoveryProvider,
  TelegramSourceDiscovery,
  classifyTelegramEntity,
} from '../src/telegram-discovery.js';
import {
  assembleTelegramAlbums,
  classifyTelegramPost,
  reconcileTelegramMaterials,
} from '../src/telegram-pipeline.js';
import {
  TraceRecorder,
  createSegmentLedger,
  redactTraceValue,
} from '../src/trace.js';

const auditDigest = `sha256:${'a'.repeat(64)}`;
const auditRunId = '123456789012';
const auditSha = 'b'.repeat(40);

function passingReleaseEvidence() {
  return Object.fromEntries(
    RELEASE_AUDIT_GATES.map((gate) => [
      gate,
      {
        evidence: [
          {
            sha256: auditDigest,
            url: `https://github.com/konard/vietnam-accomodation-search/actions/runs/${auditRunId}#${gate}`,
          },
        ],
        observedAt: '2026-09-22T00:00:00.000Z',
        status: 'pass',
      },
    ])
  );
}

function immutableReleaseIdentity() {
  return {
    baseline: { tag: 'v0.11.30' },
    commitSha: auditSha,
    docker: {
      image: 'ghcr.io/konard/vietnam-accomodation-search',
      manifestDigest: auditDigest,
      platforms: {
        'linux/amd64': { digest: `sha256:${'c'.repeat(64)}` },
        'linux/arm64': { digest: `sha256:${'d'.repeat(64)}` },
      },
      version: '1.0.0',
    },
    draft: false,
    package: {
      integrity: auditDigest,
      installedVersion: '1.0.0',
      name: 'vietnam-accomodation-search',
      version: '1.0.0',
    },
    prerelease: false,
    publishedAt: '2026-09-22T00:00:00.000Z',
    releaseUrl:
      'https://github.com/konard/vietnam-accomodation-search/releases/tag/v1.0.0',
    runtimes: {
      bun: '1.2.23',
      deno: '2.5.2',
      node: 'v24.9.0',
    },
    schemas: {
      domainGraph: 1,
      linksNotation: 1,
      releaseAudit: 2,
      trace: 1,
    },
    tag: 'v1.0.0',
    tagTargetSha: auditSha,
    workflowRunUrl: `https://github.com/konard/vietnam-accomodation-search/actions/runs/${auditRunId}`,
  };
}

async function failureOf(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to fail.');
}

describe('issue 20 browser edge contracts', () => {
  it('classifies every non-success page outcome and generic adapter path', () => {
    const cases = [
      [{ title: 'Cookie consent' }, PAGE_CLASSIFICATIONS.CONSENT],
      [
        {
          expectedLocation: 'nha-trang',
          title: 'Da Nang rentals',
        },
        PAGE_CLASSIFICATIONS.WRONG_LOCATION,
      ],
      [{ url: 'https://x.test/for-rent' }, PAGE_CLASSIFICATIONS.SELECTOR_DRIFT],
      [{ url: 'https://x.test/search' }, PAGE_CLASSIFICATIONS.EMPTY],
      [{ title: 'Welcome' }, PAGE_CLASSIFICATIONS.LANDING],
    ];
    for (const [value, expected] of cases) {
      expect(classifyListingPage(value)).toBe(expected);
    }
    expect(browserAdapterFor('not a URL').id).toBe('generic-rental-v1');
    expect(browserAdapterFor('https://sub.booking.com/search').id).toBe(
      'booking-rental-v1'
    );
  });

  it('classifies scheduler failures and persists through the storage fallback', async () => {
    const failureCases = [
      [
        { classification: PAGE_CLASSIFICATIONS.EMPTY },
        { category: 'empty', retryable: false, stopDomain: false },
      ],
      [
        { status: 429 },
        { category: 'rate-limit', retryable: true, stopDomain: false },
      ],
      [
        { message: 'navigation timeout' },
        { category: 'timeout', retryable: true, stopDomain: false },
      ],
      [
        { code: 'ECONNRESET' },
        { category: 'transport', retryable: true, stopDomain: false },
      ],
      [
        new Error('temporary'),
        { category: 'transient', retryable: true, stopDomain: false },
      ],
    ];
    for (const [error, expected] of failureCases) {
      expect(classifyBrowserFailure(error)).toEqual(expected);
    }

    const typedScheduler = new DomainScheduler({ maxAttempts: 2 });
    const emptyPage = Object.assign(new Error('empty page'), {
      classification: PAGE_CLASSIFICATIONS.EMPTY,
    });
    expect(
      (
        await failureOf(() =>
          typedScheduler.run('https://empty.test/search', async () => {
            throw emptyPage;
          })
        )
      ).classification
    ).toBe(PAGE_CLASSIFICATIONS.EMPTY);

    const writes = [];
    const scheduler = new DomainScheduler({
      delay: async () => {},
      maxAttempts: 1,
      now: () => 1_000,
      store: {
        loadRecords: async () => [
          {
            blockedUntil: 0,
            consecutiveFailures: 1,
            domain: 'fallback.test',
            id: 'fallback.test',
          },
        ],
        saveRecords: async (kind, records) => writes.push({ kind, records }),
      },
    });
    const rateLimit = Object.assign(new Error('limited'), {
      retryAfterMs: 4_000,
      status: 429,
    });
    expect(
      (
        await failureOf(() =>
          scheduler.run('https://fallback.test/search', async () => {
            throw rateLimit;
          })
        )
      ).message
    ).toBe('limited');
    expect(writes[0].kind).toBe('browser-domain-cooldown');
    expect(writes[0].records.at(-1)).toEqual({
      blockedUntil: 5_000,
      category: 'rate-limit',
      consecutiveFailures: 2,
      domain: 'fallback.test',
      id: 'fallback.test',
      schemaVersion: 1,
    });
  });

  it('cancels before and during scheduler delays and releases queued domains', async () => {
    const before = new AbortController();
    before.abort();
    const scheduler = new DomainScheduler();
    expect(
      (
        await failureOf(() =>
          scheduler.run('https://a.test', () => 1, {
            signal: before.signal,
          })
        )
      ).message
    ).toContain('aborted');

    const during = new AbortController();
    const delayed = new DomainScheduler({ maxDelayMs: 50, minDelayMs: 50 });
    const operation = delayed.run('https://b.test', () => 1, {
      signal: during.signal,
    });
    during.abort(new Error('operator cancel'));
    expect((await failureOf(() => operation)).message).toBe('operator cancel');

    let release;
    let markStarted;
    const started = new Promise((resolve) => (markStarted = resolve));
    const first = new DomainScheduler({ maxConcurrentDomains: 1 });
    const held = first.run(
      'https://one.test',
      () =>
        new Promise((resolve) => {
          release = resolve;
          markStarted();
        })
    );
    const queued = first.run('https://two.test', () => 'second');
    await started;
    release('first');
    expect(await held).toBe('first');
    expect(await queued).toBe('second');
  });

  it('surfaces typed page, disabled-adapter, and pagination-loop failures', async () => {
    const collector = new BrowserCollector({ rates: { VND: 1 } });
    const pageError = await failureOf(() =>
      collector.assertListingPage(
        { evaluate: async () => [] },
        'https://x.test/search',
        0
      )
    );
    expect(pageError instanceof BrowserPageError).toBe(true);
    expect(pageError.code).toBe('BROWSER_PAGE_EMPTY');

    expect(
      (
        await failureOf(() =>
          collector.collectSource(
            {},
            {
              id: 'chotot',
              searchUrl: 'https://chotot.com/mua-ban-bat-dong-san',
              type: 'web',
            },
            '',
            { VND: 1 }
          )
        )
      ).classification
    ).toBe('disabled-adapter');

    const firstUrl = 'https://t.me/s/rentals?before=1';
    const loop = await failureOf(() =>
      collector.collectTelegramRows(
        {
          evaluate: async () => [
            {
              date: '2026-09-22T00:00:00Z',
              text: 'Room for rent',
              url: 'https://t.me/rentals/1',
            },
          ],
          goto: async () => {},
        },
        { id: 'telegram:rentals', searchUrl: firstUrl },
        ''
      )
    );
    expect(loop.classification).toBe(PAGE_CLASSIFICATIONS.NAVIGATION_LOOP);

    expect(
      (
        await collector.collectTelegramRows(
          {
            evaluate: async () => [
              { date: 'invalid', text: 'no public message identity' },
            ],
            goto: async () => {},
          },
          { id: 'telegram:no-id', searchUrl: 'https://t.me/s/no-id' },
          ''
        )
      ).length
    ).toBe(1);
  });
});

describe('issue 20 semantic, trace, session, and release edges', () => {
  it('rejects invalid graph values and handles arrays, undefined, primitives, and cycles', () => {
    expect(() => createSemanticValue('invented')).toThrow();
    expect(() => createDomainRecords({ id: '', type: 'offer' })).toThrow();
    const records = createDomainRecords({
      id: 'offer:array',
      type: 'offer',
      values: { ignored: undefined, labels: ['one', 'two'] },
    });
    expect(
      records.some(({ predicate }) => predicate === 'offer.labels.1')
    ).toBe(true);
    expect(validatePublicRecord('public')).toBe(true);
    const cyclic = {};
    cyclic.self = cyclic;
    expect(validatePublicRecord(cyclic)).toBe(true);
  });

  it('validates recorder inputs, bigint redaction, empty ledgers, and fallback persistence', async () => {
    expect(redactTraceValue({ count: 9n })).toEqual({ count: '9' });
    expect(createSegmentLedger('').summary.coverage).toBe(0);
    expect(() => new TraceRecorder({ maxEvents: 0 })).toThrow();
    const recorder = new TraceRecorder({
      maxEvents: 1,
      now: () => new Date('2026-09-22T00:00:00Z'),
    });
    expect(() => recorder.record({ stage: 'x', status: 'start' })).toThrow();
    recorder.record({ runId: 'r', stage: 'x', status: 'start' });
    recorder.record({ runId: 'r', stage: 'x', status: 'success' });
    const written = [];
    recorder.store = {
      loadRecords: async () => [{ id: 'old' }],
      saveRecords: async (kind, records) => written.push({ kind, records }),
    };
    const snapshot = await recorder.persist();
    expect(snapshot.dropped).toBe(1);
    expect(written[0].records.some(({ id }) => id === 'trace-retention')).toBe(
      true
    );
  });

  it('classifies all session representations without trial network behavior', () => {
    expect(inspectSessionFormat(SESSION_FORMAT).state).toBe('supported');
    expect(inspectSessionFormat('teleproto/string-session-v1').provider).toBe(
      'teleproto'
    );
    expect(inspectSessionFormat('unknown').state).toBe('unsupported');
    expect(() => createSessionEnvelope('')).toThrow();
    expect(inspectSessionEnvelope('').state).toBe('absent');
    expect(inspectSessionEnvelope({}).state).toBe('partial');
    const foreign = JSON.stringify({
      format: GRAMJS_SESSION_FORMAT,
      payload: 'fixture',
      provider: 'gramjs',
      schemaVersion: 1,
      sessionId: 'telegram-user:1',
    });
    expect(inspectSessionEnvelope(foreign).state).toBe('unsupported');
    expect(() => sessionPayload('{bad')).toThrow();
    expect(() => sessionPayload('{}')).toThrow();
    expect(() => nativeSessionPayload('')).toThrow();
    expect(() => nativeSessionPayload('raw', GRAMJS_SESSION_FORMAT)).toThrow();
    expect(
      nativeSessionPayload(
        createSessionEnvelope('native', { rotatedAt: '2026-09-22', dcId: 4 })
      )
    ).toBe('native');
  });

  it('covers ready, failure, improvement, override, and passing release audits', () => {
    expect(
      evaluateReleaseGate({
        competingPoller: true,
        credentials: true,
        mode: 'live',
      }).reason
    ).toBe('competing-live-poller');
    expect(evaluateReleaseGate({ mode: 'unknown' }).status).toBe('failure');
    expect(evaluateReleaseGate({ mode: 'dry-run' }).status).toBe('ready');
    const comparison = compareReleaseAudit(
      { gates: { fixed: 'failure' } },
      { gates: { fixed: { status: 'success' } } }
    );
    expect(comparison.improvements).toEqual(['fixed']);
    expect(Object.isFrozen(comparison)).toBe(true);
    expect(
      selectReleaseForAudit(
        [
          { draft: true, tag: 'draft' },
          { publishedAt: '2', tagName: 'v2' },
        ],
        { overrideTag: 'v2' }
      ).tagName
    ).toBe('v2');
    const passing = createReleaseAudit({
      credentials: true,
      gates: passingReleaseEvidence(),
      mode: 'live',
      now: () => new Date('2026-09-22T00:00:00Z'),
      release: immutableReleaseIdentity(),
      runtime: { platform: 'linux' },
    });
    expect(passing.status).toBe('pass');
    expect(passing.closureEligible).toBe(true);
    expect(passing.release.commitSha).toBe(auditSha);
    expect(passing.runtime.bun).toBe('1.2.23');
    expect(passing.gates['release-identity'].status).toBe('pass');
    expect(passing.observedAt).toBe('2026-09-22T00:00:00.000Z');
    expect(passing.release.workflowRunUrl).toBe(
      `https://github.com/konard/vietnam-accomodation-search/actions/runs/${auditRunId}`
    );
    expect(
      passing.gates['offline-quality-and-clean-install'].evidence[0].url
    ).toContain(`/actions/runs/${auditRunId}#`);

    const fixtureOnly = createReleaseAudit({
      gates: passingReleaseEvidence(),
      release: immutableReleaseIdentity(),
    });
    expect(fixtureOnly.status).toBe('pending');
    expect(fixtureOnly.closureEligible).toBe(false);
    expect(fixtureOnly.gates['release-identity'].reason).toBe(
      'post-release-live-audit-required'
    );

    const inconsistent = immutableReleaseIdentity();
    inconsistent.package.installedVersion = '0.9.0';
    const inconsistentAudit = createReleaseAudit({
      credentials: true,
      gates: passingReleaseEvidence(),
      mode: 'live',
      release: inconsistent,
      runtime: { bun: '1', deno: '2', node: 'v24' },
    });
    expect(inconsistentAudit.status).toBe('failure');
    expect(inconsistentAudit.gates['release-identity'].problems).toContain(
      'installed-package-version-mismatch'
    );

    const contradictory = immutableReleaseIdentity();
    contradictory.draft = true;
    contradictory.prerelease = true;
    contradictory.commitSha = 'short-sha';
    contradictory.tagTargetSha = 'other-short-sha';
    contradictory.publishedAt = 'not-a-date';
    contradictory.releaseUrl = 'http://unsafe.example/release';
    contradictory.workflowRunUrl = 'invalid';
    contradictory.tag = 'v9.0.0';
    contradictory.package = {
      installedVersion: '8.0.0',
      integrity: 'bad-digest',
      name: 'wrong-package',
      version: '7.0.0',
    };
    contradictory.docker = {
      image: 'owner/image',
      manifestDigest: 'bad-digest',
      platforms: {
        'linux/amd64': { digest: 'bad-digest' },
        'linux/arm64': { digest: 'bad-digest' },
      },
      version: '6.0.0',
    };
    contradictory.schemas.releaseAudit = 1;
    const contradictoryAudit = createReleaseAudit({
      credentials: true,
      gates: passingReleaseEvidence(),
      mode: 'live',
      release: contradictory,
    });
    expect(contradictoryAudit.status).toBe('failure');
    expect(contradictoryAudit.gates['release-identity'].problems).toEqual([
      'release-is-draft',
      'release-is-prerelease',
      'tested-commit-sha-not-full',
      'tag-target-sha-not-full',
      'tag-target-does-not-match-tested-commit',
      'release-published-at-invalid',
      'release-url-invalid',
      'workflow-run-url-invalid',
      'npm-package-name-mismatch',
      'tag-package-version-mismatch',
      'installed-package-version-mismatch',
      'docker-package-version-mismatch',
      'artifact-digest-invalid',
      'release-audit-schema-mismatch',
    ]);

    const unprovenGates = createReleaseAudit({
      credentials: true,
      gates: Object.fromEntries(
        RELEASE_AUDIT_GATES.map((gate) => [gate, 'pass'])
      ),
      mode: 'live',
      release: immutableReleaseIdentity(),
      runtime: { bun: '1', deno: '2', node: 'v24' },
    });
    expect(unprovenGates.status).toBe('pending');
    expect(unprovenGates.gates['evidence-integrity'].status).toBe('pending');
    const missingRelease = createReleaseAudit({
      credentials: true,
      gates: Object.fromEntries(
        RELEASE_AUDIT_GATES.map((gate) => [gate, 'pass'])
      ),
      mode: 'live',
    });
    expect(missingRelease.status).toBe('pending');
    expect(missingRelease.gates['release-identity'].reason).toBe(
      'release-identity-incomplete'
    );
    expect(
      createReleaseAudit({ gates: { 'bot-only-authentication': 'failure' } })
        .status
    ).toBe('failure');
  });
});

describe('issue 20 discovery and reconciliation edges', () => {
  it('classifies forbidden/unsupported Telegram constructors', () => {
    expect(classifyTelegramEntity({ _: 'chatForbidden' }).reason).toBe(
      'inaccessible-chat'
    );
    expect(classifyTelegramEntity({ _: 'channelForbidden' }).reason).toBe(
      'inaccessible-channel'
    );
    expect(classifyTelegramEntity({ _: 'peerUnknown' }).reason).toBe(
      'unsupported-entity'
    );
  });

  it('normalizes configured and public-preview source providers', async () => {
    const source = {
      id: 'telegram:fixture',
      languages: ['en'],
      name: 'Fixture',
      popularity: { evidenceUrl: 'https://t.me/fixture', value: 9 },
      telegram: { kind: 'chat', peerId: '7', username: 'fixture' },
      url: 'https://t.me/fixture',
    };
    const configured = new ConfiguredTelegramDiscoveryProvider({
      focusSources: [source],
    }).discover({ focus: 'nha-trang' });
    expect(configured[0].entity._).toBe('chat');
    const preview = new PublicPreviewTelegramDiscoveryProvider({
      discover: async (_type, options) => {
        expect(Boolean(options.signal)).toBe(true);
        return [
          {
            ...source,
            provenance: [{ language: 'en', queryId: 'q' }],
          },
        ];
      },
      focusCandidates: [source],
    });
    const signal = new AbortController().signal;
    expect(
      (await preview.discover({ focus: 'nha-trang', signal }))[0].transport
    ).toBe('public-preview');
    expect(
      await new PublicPreviewTelegramDiscoveryProvider().discover()
    ).toEqual([]);

    const sorted = await new TelegramSourceDiscovery({
      providers: [
        {
          discover: async () => [
            {
              entity: {
                _: 'channel',
                participantsCount: 10,
                username: 'zeta',
              },
            },
            {
              entity: {
                _: 'channel',
                participantsCount: 10,
                username: 'alpha',
              },
            },
          ],
          name: 'tie-fixture',
        },
      ],
      traceRecorder: { persist: async () => {}, record: () => {} },
    }).discover();
    expect(sorted.sources.map(({ id }) => id)).toEqual([
      'telegram:alpha',
      'telegram:zeta',
    ]);
  });

  it('bounds Bot API discovery and reports skip, failure, cancellation, and chat kinds', async () => {
    const provider = new BotApiTelegramDiscoveryProvider({
      api: {
        getChat: async (username) => {
          if (username === '@broken') {
            const error = new Error('missing');
            error.code = 'CHAT_MISSING';
            throw error;
          }
          if (username === '@group') {
            return { id: 1, title: 'Group', type: 'group' };
          }
          if (username === '@super') {
            return {
              id: 2,
              title: 'Super',
              type: 'supergroup',
              username: 'super',
            };
          }
          return { type: 'unsupported' };
        },
      },
      candidates: [
        { id: 'skip' },
        { id: 'group', url: 'https://t.me/group' },
        { id: 'super', url: 'https://t.me/super' },
        { id: 'unknown', url: 'https://t.me/unknown' },
        { id: 'broken', url: 'https://t.me/broken' },
      ],
      concurrency: 0,
    });
    const results = await provider.discover();
    expect(results.map(({ entity }) => entity._)).toEqual([
      'chat',
      'channel',
      'unsupported',
    ]);
    expect(results.failures[0].reason).toBe('CHAT_MISSING');

    const controller = new AbortController();
    controller.abort(new Error('stop discovery'));
    expect(
      (await failureOf(() => provider.discover({ signal: controller.signal })))
        .message
    ).toBe('stop discovery');
  });

  it('records cancellation, provider failures, degraded results, and identity variants', async () => {
    const checkpoints = [];
    const controller = new AbortController();
    controller.abort(new Error('cancelled fixture'));
    const cancelled = new TelegramSourceDiscovery({
      checkpoint: async (value) => checkpoints.push(value),
      providers: [{ discover: async () => [], name: 'cancelled' }],
    });
    expect(
      (await failureOf(() => cancelled.discover({ signal: controller.signal })))
        .message
    ).toBe('cancelled fixture');
    expect(checkpoints[0].reason).toBe('cancelled');

    const failed = new TelegramSourceDiscovery({
      now: () => new Date('2026-09-22T00:00:00Z'),
      providers: [
        {
          discover: async () => {
            const error = new Error('provider failed');
            error.code = 'PROVIDER_DOWN';
            throw error;
          },
          name: 'failed',
        },
        {
          discover: async () => {
            const values = [
              {
                entity: {
                  _: 'channel',
                  migratedFromChatId: 4,
                  participantsCount: Number.NaN,
                  title: 'Peer only',
                  id: 3,
                },
              },
              { entity: { _: 'channel' } },
              {
                entity: {
                  _: 'channel',
                  participantsCount: 50,
                  username: '@Alias',
                  usernames: [{ username: 'OldAlias' }, '@Alias'],
                },
                evidence: {
                  language: 'ru',
                  queryId: 'q',
                  url: 'https://e.test',
                },
              },
            ];
            values.failures = [{ reason: 'partial-query' }];
            return values;
          },
          name: 'partial',
        },
      ],
    });
    const result = await failed.discover({ maxResults: 10 });
    expect(result.complete).toBe(false);
    expect(result.failures.map(({ reason }) => reason)).toEqual([
      'PROVIDER_DOWN',
      'partial-query',
    ]);
    expect(result.rejected[0].reason).toBe('missing-public-identity');
    expect(result.sources.some(({ id }) => id === 'telegram:peer:3')).toBe(
      true
    );
    expect(result.sources.some(({ id }) => id === 'telegram:alias')).toBe(true);
  });

  it('covers duplicate, uncertain, OCR failure, empty extraction, and alternate album fields', async () => {
    expect(classifyTelegramPost('anything', { duplicate: true }).label).toBe(
      'duplicate'
    );
    expect(classifyTelegramPost('Apartment available').label).toBe('uncertain');
    const album = assembleTelegramAlbums([
      {
        caption: 'Room for rent 2 million VND/month',
        chat: { id: 1 },
        document: { id: 'document' },
        edit_date: '2026-09-22',
        grouped_id: 'alternate',
        messageId: 2,
      },
    ])[0];
    expect(album.mediaIds).toEqual(['document']);
    const failedOcr = await reconcileTelegramMaterials(
      [{ id: 1, mediaId: 'photo', sourceId: 's' }],
      {
        ocr: async () => {
          const error = new Error('OCR unavailable');
          error.code = 'OCR_DOWN';
          throw error;
        },
      }
    );
    expect(failedOcr.reviewQueue[0].error).toBe('OCR_DOWN');
    const uncertain = await reconcileTelegramMaterials([
      { id: 1, sourceId: 's', text: 'Apartment available' },
    ]);
    expect(uncertain.reviewQueue[0].state).toBe('review');
    const filtered = await reconcileTelegramMaterials(
      [{ id: 1, sourceId: 's', text: 'Room for rent, 2m VND/month' }],
      { extract: async () => null }
    );
    expect(filtered.accepted).toEqual([]);
    expect(filtered.reviewQueue).toEqual([
      {
        id: 'telegram-message:s:1',
        reason: 'offer-extraction-empty',
        state: 'error',
      },
    ]);
  });
});
