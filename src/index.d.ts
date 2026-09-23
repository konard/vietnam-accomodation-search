export interface Price {
  amount: number;
  currency: string;
  period: 'night' | 'week' | 'month' | 'year';
}

export interface PopularityEvidence {
  metric: string;
  value: number;
  evidenceUrl?: string;
  observedAt: string;
}

export interface AccommodationSource {
  access?:
    | 'public-web'
    | 'public-preview'
    | 'bot-membership'
    | 'user-session-visible'
    | 'configured';
  accessCapabilities?: string[];
  aliases?: string[];
  enabled?: boolean;
  focus?: 'nha-trang';
  id: string;
  languages?: Array<'en' | 'ru' | 'vi'>;
  lastScannedAt?: string;
  lastSuccessfulScan?: string;
  name: string;
  type: 'web' | 'telegram';
  url?: string;
  searchUrl?: string;
  popularity: PopularityEvidence;
  provenance?: Array<Record<string, unknown>>;
  reason?: string;
  telegram?: {
    kind: 'channel' | 'chat' | 'megagroup';
    peerId?: string;
    username?: string;
  };
}

export interface AccommodationAttributes {
  propertyId?: string;
  rooms?: number;
  bedrooms?: number;
  bathrooms?: number;
  areaM2?: number;
  floor?: number;
  district?: string;
  beds?: number;
  guests?: number;
  availableFrom?: string;
  minimumStayMonths?: number;
  maximumStayMonths?: number;
  depositMonths?: number;
  deposit?: Price;
  prepaymentMonths?: number;
  prepayment?: Price;
  availableNow?: boolean;
  furnished?: boolean;
  petsAllowed?: boolean;
  utilitiesIncluded?: boolean;
  agencyFeePercent?: number;
  rating?: number;
  reviewCount?: number;
  checkIn?: string;
  checkOut?: string;
  latitude?: number;
  longitude?: number;
  amenities?: string[];
  utilityCharges?: string[];
  fees?: Array<{ label: string; price: Price }>;
  labeledFields?: Record<string, string[]>;
  [key: string]: unknown;
}

export interface AccommodationContacts {
  email?: string[];
  telegram: string[];
  phone: string[];
}

export interface PriceObservation {
  amount?: number;
  currency?: string;
  period?: Price['period'];
  priceVnd: number;
  sourceId: string;
  sourceType?: 'web' | 'official-web' | 'telegram';
  observedAt: string;
  url?: string;
  official: boolean;
}

export interface PriceChange {
  sourceId: string;
  direction: 'down' | 'up';
  previousPriceVnd: number;
  currentPriceVnd: number;
  deltaVnd: number;
  percent: number;
  detectedAt: string;
  url?: string;
}

export interface AccommodationOfferVariant {
  attributes?: AccommodationAttributes;
  contacts?: AccommodationContacts;
  id: string;
  identifiers?: Record<string, string>;
  identityKeys?: string[];
  kind?: string;
  intent?: 'rental-offer';
  language?: ListingLanguage;
  location?: string;
  locationProvenance?: Record<string, unknown>;
  photos?: string[];
  sourceId: string;
  sourceType?: 'web' | 'official-web' | 'telegram';
  title: string;
  url?: string;
  officialUrl?: string;
  price: Price | null;
  priceVnd: number | null;
  postedAt?: string;
  collectedAt: string;
  provenance?: AccommodationOffer['provenance'];
  raw: unknown;
  searchQuery?: string;
}

export interface AccommodationOffer {
  id: string;
  sourceId: string;
  sourceIds?: string[];
  sourceType?: 'web' | 'official-web' | 'telegram';
  sourceTypes?: Array<'web' | 'official-web' | 'telegram'>;
  title: string;
  kind?: string;
  intent?: 'rental-offer';
  language?: ListingLanguage;
  location?: string;
  locationProvenance?: Record<string, unknown>;
  attributes?: AccommodationAttributes;
  contacts?: AccommodationContacts;
  price: Price | null;
  priceVnd: number | null;
  url?: string;
  officialUrl?: string;
  identifiers?: Record<string, string>;
  identityKeys?: string[];
  searchQuery?: string;
  searchQueries?: string[];
  photos: string[];
  postedAt?: string;
  collectedAt: string;
  raw: unknown;
  variants?: AccommodationOfferVariant[];
  priceHistory?: PriceObservation[];
  priceChanges?: PriceChange[];
  priceChange?: PriceChange;
  cachedPhotos?: Array<{
    cachedAt: string;
    path: string;
    size: number;
    url: string;
  }>;
  provenance?: {
    editedAt?: number | string;
    groupedId?: number | string;
    messageId?: number | string;
    messageIds?: Array<number | string>;
    sourceId: string;
    topicId?: number | string;
    transport: 'bot-api' | 'browser-preview' | 'mtproto';
  };
}

export interface SearchOptions {
  cheapest?: boolean;
  filters?: Record<string, boolean | number | string>;
  limit?: number;
  maxPerBedVnd?: number;
  maxPerRoomVnd?: number;
  maxRooms?: number;
  maxTotalVnd?: number;
  minPerBedVnd?: number;
  minPerRoomVnd?: number;
  minRooms?: number;
  minTotalVnd?: number;
  maxPricePerBedVnd?: number;
  maxPricePerRoomVnd?: number;
  maxTotalPriceVnd?: number;
  minPricePerBedVnd?: number;
  minPricePerRoomVnd?: number;
  minTotalPriceVnd?: number;
  query?: string;
  refresh?: boolean;
  traceRunId?: string;
  types?: string[];
}

export declare const add: (a: number, b: number) => number;
export declare const multiply: (a: number, b: number) => number;
export declare const delay: (ms: number) => Promise<void>;

export declare function parsePrice(text?: string): Price | null;
export declare function convertToVnd(
  price: Price | null,
  rates?: Record<string, number>
): number | null;
export declare function normalizeOffer(
  input: Partial<AccommodationOffer> & { text?: string },
  options?: { now?: Date; rates?: Record<string, number> }
): AccommodationOffer;
export declare function canonicalizeOfferUrl(
  value?: string
): string | undefined;
export declare function offerIdentityKeys(offer: AccommodationOffer): string[];
export declare function removeOfferMessageVariants(
  offer: AccommodationOffer,
  sourceId: string,
  messageIds: Set<string>
): AccommodationOffer | undefined;
export declare function parseLabeledFields(
  text?: string
): Record<string, string[]>;
export declare function parseListingText(
  text?: string,
  options?: { referenceDate?: Date | string | number }
): {
  attributes: AccommodationAttributes;
  contacts: AccommodationContacts;
  kind: string;
  language: ListingLanguage;
  location?: string;
  locationProvenance: Record<string, unknown>;
  officialUrl?: string;
};
export declare function parseTelegramOffer(
  message: Record<string, unknown>,
  options?: { now?: Date; rates?: Record<string, number> }
): AccommodationOffer | null;
export declare function parseSearchCommand(
  input?: string,
  options?: { defaults?: true }
): Required<Pick<SearchOptions, 'cheapest' | 'limit' | 'query'>> &
  Omit<SearchOptions, 'cheapest' | 'limit' | 'query' | 'refresh'>;
export declare function parseSearchCommand(
  input: string,
  options: { defaults: false }
): SearchOptions;
export declare function parseSearchOverrides(input?: string): SearchOptions;
export declare function buildSearchUrl(
  source: { searchUrl: string },
  query?: string
): string;
export declare function formatSearchResults(
  offers: AccommodationOffer[]
): string;
export declare function serializeRecords<T>(kind: string, records: T[]): string;
export declare function deserializeRecords<T = Record<string, unknown>>(
  kind: string,
  value: string
): T[];
export declare function queryRecords<T = Record<string, unknown>>(
  kind: string,
  value: string,
  query: { path: string; value: unknown }
): T[];
export declare function serializeOffers(offers: AccommodationOffer[]): string;
export declare function deserializeOffers(value: string): AccommodationOffer[];
export declare function serializeSources(
  sources: AccommodationSource[]
): string;
export declare function deserializeSources(
  value: string
): AccommodationSource[];
export declare function serializeSearchState(state: SearchState): string;
export declare function deserializeSearchState(value: string): SearchState;
export declare function deduplicateOffers(
  offers: AccommodationOffer[]
): AccommodationOffer[];

export interface ListingLanguage {
  confidence: number;
  language: 'en' | 'ru' | 'vi' | 'unknown';
  method: 'reviewed-keyword-script-v1';
  schemaVersion: 1;
}

export declare const LANGUAGE_DETECTION_SCHEMA_VERSION: 1;
export declare function detectListingLanguage(text?: string): ListingLanguage;

export declare const BROWSER_ADAPTER_SCHEMA_VERSION: 1;
export declare const PAGE_CLASSIFICATIONS: Readonly<{
  CHALLENGE: 'challenge';
  CONSENT: 'consent-wall';
  EMPTY: 'empty';
  LANDING: 'landing';
  LOGIN: 'login';
  NAVIGATION_LOOP: 'navigation-loop';
  RENTAL: 'rental';
  SALE: 'sale';
  SELECTOR_DRIFT: 'selector-drift';
  WRONG_LOCATION: 'wrong-location';
}>;
export interface BrowserSourceAdapter {
  domains?: string[];
  enabled: boolean;
  id: string;
  reason?: string;
  schemaVersion: 1;
  searchPath?: string;
}
export declare const BROWSER_SOURCE_ADAPTERS: Readonly<
  Record<string, BrowserSourceAdapter>
>;
export declare function browserAdapterFor(value: string): BrowserSourceAdapter;
export declare function classifyListingPage(options?: {
  cards?: number;
  expectedLocation?: string;
  status?: number;
  title?: string;
  url?: string;
}): (typeof PAGE_CLASSIFICATIONS)[keyof typeof PAGE_CLASSIFICATIONS];
export declare function classifyBrowserFailure(error: unknown): {
  category: string;
  retryable: boolean;
  stopDomain: boolean;
};
export declare class BrowserPageError extends Error {
  classification: string;
  code: string;
  url: string;
}
export declare class DomainScheduler {
  constructor(options?: {
    delay?: (
      milliseconds: number,
      options?: { signal?: AbortSignal }
    ) => Promise<void>;
    maxAttempts?: number;
    maxBackoffMs?: number;
    maxCooldownMs?: number;
    maxConcurrentDomains?: number;
    maxDelayMs?: number;
    maxRequestsPerDomain?: number;
    minDelayMs?: number;
    now?: () => number;
    random?: () => number;
    retryCooldownMs?: number;
    store?: Record<string, unknown>;
  });
  run<T>(
    url: string,
    operation: (options: { attempt: number }) => Promise<T> | T,
    options?: { signal?: AbortSignal }
  ): Promise<T>;
}

export declare const DOMAIN_GRAPH_SCHEMA_VERSION: 1;
export declare const DOMAIN_ENTITY_TYPES: Set<string>;
export declare const SEMANTIC_STATES: Set<string>;
export interface SemanticValue<T = unknown> {
  state: string;
  value?: T;
  [key: string]: unknown;
}
export declare function createSemanticValue<T>(
  state: string,
  value?: T,
  metadata?: Record<string, unknown>
): SemanticValue<T>;
export declare function createDomainRecords(options: {
  id: string;
  type: string;
  values?: Record<string, unknown>;
}): Array<Record<string, unknown>>;
export declare function validatePublicRecord(value: unknown): true;

export declare const RELEASE_AUDIT_SCHEMA_VERSION: 2;
export declare const RELEASE_AUDIT_GATES: readonly string[];
export declare function compareReleaseAudit(
  baseline?: Record<string, unknown>,
  candidate?: Record<string, unknown>
): {
  baselineRelease: unknown;
  candidateRelease: unknown;
  changed: boolean;
  improvements: string[];
  regressions: string[];
  schemaVersion: 2;
};
export declare function evaluateReleaseGate(options?: {
  competingPoller?: boolean;
  credentials?: boolean;
  mode?: 'fixture' | 'dry-run' | 'live' | string;
}): { reason: string; status: 'failure' | 'pending' | 'ready' };
export declare function selectReleaseForAudit(
  releases?: Array<Record<string, unknown>>,
  options?: { auditedTags?: string[]; overrideTag?: string }
): Record<string, unknown> | undefined;
export declare function createReleaseAudit(
  options?: Record<string, unknown>
): Readonly<Record<string, unknown>>;

export declare const SESSION_SCHEMA_VERSION: 1;
export declare const SESSION_FORMAT: 'mtcute/session-string-v1';
export declare const GRAMJS_SESSION_FORMAT: 'gramjs/string-session-v1';
export declare function inspectSessionFormat(format?: string): {
  provider?: string;
  reason?: string;
  state: 'supported' | 'relogin-required' | 'unsupported';
};
export declare function createSessionEnvelope(
  payload: string,
  metadata?: {
    createdAt?: string;
    dcId?: number;
    expectedUserId?: number | string;
    provider?: 'mtcute';
    rotatedAt?: string;
    sessionId?: string;
  }
): string;
export declare function inspectSessionEnvelope(value?: unknown): {
  createdAt?: string;
  expectedUserId?: string;
  format?: string;
  provider?: string;
  reason?: string;
  schemaVersion?: number;
  sessionId?: string;
  state:
    | 'absent'
    | 'active-unverified'
    | 'malformed'
    | 'partial'
    | 'unsupported';
};
export declare function sessionPayload(value: unknown): string;
export declare function nativeSessionPayload(
  value: string,
  format?: string
): string;

export interface TelegramDiscoveryQuery {
  id: string;
  language: 'en' | 'ru' | 'vi';
  text: string;
}
export interface TelegramDiscoveryCandidate {
  entity: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  transport?: string;
}
export declare const TELEGRAM_DISCOVERY_SCHEMA_VERSION: 1;
export declare const TELEGRAM_DISCOVERY_QUERIES: Readonly<{
  version: 1;
  reviewedAt: string;
  queries: readonly TelegramDiscoveryQuery[];
}>;
export declare function classifyTelegramEntity(
  entity: Record<string, unknown>
): { accepted: boolean; kind?: string; reason?: string };
export declare class TelegramSourceDiscovery {
  constructor(options?: Record<string, unknown>);
  addProvider(
    provider: { name: string; discover(options?: unknown): unknown },
    options?: { before?: string }
  ): void;
  discover(options?: {
    focus?: 'nha-trang';
    maxResults?: number;
    queries?: TelegramDiscoveryQuery[];
    signal?: AbortSignal;
  }): Promise<{
    complete: boolean;
    failures: Array<Record<string, unknown>>;
    rejected: Array<Record<string, unknown>>;
    sources: AccommodationSource[];
  }>;
}
export declare class ConfiguredTelegramDiscoveryProvider {
  constructor(options?: {
    focusSources?: AccommodationSource[];
    sources?: AccommodationSource[];
  });
  name: 'configured';
  discover(options?: { focus?: 'nha-trang' }): TelegramDiscoveryCandidate[];
}
export declare class PublicPreviewTelegramDiscoveryProvider {
  constructor(options?: Record<string, unknown>);
  name: 'public-preview';
  discover(options?: {
    focus?: 'nha-trang';
    signal?: AbortSignal;
  }): Promise<TelegramDiscoveryCandidate[]>;
}
export declare class BotApiTelegramDiscoveryProvider {
  constructor(options?: Record<string, unknown>);
  name: 'bot-api';
  discover(options?: {
    focus?: 'nha-trang';
    signal?: AbortSignal;
  }): Promise<TelegramDiscoveryCandidate[]>;
}

export declare const TELEGRAM_LABELS: Set<string>;
export declare function classifyTelegramPost(
  value: unknown,
  options?: { duplicate?: boolean; targetLocation?: string | null }
): { eligible: boolean; label: string; reason: string };
export declare function assembleTelegramAlbums(
  messages: Array<Record<string, unknown>>
): Array<Record<string, unknown>>;
export declare function reconcileTelegramMaterials<T = Record<string, unknown>>(
  messages: Array<Record<string, unknown>>,
  options?: {
    extract?: (material: Record<string, unknown>) => T | Promise<T>;
    maxOcrPhotos?: number;
    ocr?: (mediaId: unknown) => string | Promise<string>;
    targetLocation?: string | null;
  }
): Promise<{
  accepted: T[];
  complete: boolean;
  reviewQueue: Array<Record<string, unknown>>;
}>;

export declare const TRACE_SCHEMA_VERSION: 1;
export declare const TRACE_STATUSES: Set<string>;
export declare function redactTraceValue(value: unknown): unknown;
export declare function createSegmentLedger(
  value: unknown,
  classify?: (segment: {
    index: number;
    text: string;
  }) => Record<string, unknown>
): {
  segments: Array<Record<string, unknown>>;
  summary: {
    coverage: number;
    error: number;
    mapped: number;
    reviewedUnknown: number;
  };
};
export declare class TraceRecorder {
  constructor(options?: Record<string, unknown>);
  record(event: Record<string, unknown>): Record<string, unknown>;
  export(): {
    dropped: number;
    events: Array<Record<string, unknown>>;
    schemaVersion: 1;
  };
  persist(): Promise<Record<string, unknown>>;
}

export declare const DEFAULT_WEB_SOURCES: AccommodationSource[];
export declare const DEFAULT_TELEGRAM_SOURCES: AccommodationSource[];
export declare const DEFAULT_NHA_TRANG_TELEGRAM_SOURCES: AccommodationSource[];

export declare class ExchangeRateProvider {
  constructor(options?: { fetchImpl?: typeof fetch; maxAgeMs?: number });
  getRates(): Promise<Record<string, number>>;
}

export declare class LinksStore {
  constructor(options?: {
    binaryMirror?: boolean;
    directory?: string;
    maxBytes?: number;
    mirror?: Pick<LinkCliMirror, 'stage'> &
      Partial<Pick<LinkCliMirror, 'ensure'>>;
  });
  loadRecords<T = Record<string, unknown>>(kind: string): Promise<T[]>;
  saveRecords<T = Record<string, unknown>>(
    kind: string,
    records: T[]
  ): Promise<void>;
  updateRecords<T = Record<string, unknown>>(
    kind: string,
    update: (records: T[]) => T[] | Promise<T[]>
  ): Promise<T[]>;
  queryRecords<T = Record<string, unknown>>(
    kind: string,
    query: { path: string; value: unknown }
  ): Promise<T[]>;
  listOffers(): Promise<AccommodationOffer[]>;
  saveOffers(offers: AccommodationOffer[]): Promise<void>;
  deleteOffersByMessages(
    sourceId: string,
    messageIds: Array<number | string>
  ): Promise<void>;
  loadSearchState(): Promise<SearchState>;
  saveSearchState(state: SearchState): Promise<void>;
  loadSources(): Promise<AccommodationSource[]>;
  saveSources(sources: AccommodationSource[]): Promise<void>;
}

export declare class LinkCliMirror {
  constructor(options?: {
    command?: string;
    run?: (command: string, arguments_: string[]) => Promise<void>;
  });
  preflight(): Promise<void>;
  ensure(options: {
    directory: string;
    kind: string;
    notation: string;
  }): Promise<{ sha256: string }>;
  stage(options: {
    directory: string;
    kind: string;
    notation: string;
  }): Promise<{ activate: () => Promise<void>; sha256: string }>;
}

export interface SearchPreset {
  active: boolean;
  name: string;
  options: SearchOptions;
  subscribed: boolean;
}

export interface SearchState {
  id?: string;
  users: Record<
    string,
    {
      activePreset: string;
      presets: Record<string, SearchOptions>;
      shownOfferIds: string[];
      subscription?: { preset: string; startedAt: string };
    }
  >;
}

export declare function normalizePresetName(value: string): string;
export declare function mergeSearchOptions(
  base?: SearchOptions,
  overrides?: SearchOptions
): SearchOptions;
export declare class SearchPresetService {
  constructor(options?: {
    now?: () => Date;
    store?: Pick<LinksStore, 'loadSearchState' | 'saveSearchState'>;
  });
  resolve(
    userId: string | number,
    overrides?: SearchOptions,
    presetName?: string
  ): Promise<SearchOptions>;
  list(userId: string | number): Promise<SearchPreset[]>;
  save(
    userId: string | number,
    presetName: string,
    overrides?: SearchOptions
  ): Promise<{ name: string; options: SearchOptions }>;
  use(
    userId: string | number,
    presetName: string
  ): Promise<{ name: string; options: SearchOptions }>;
  remove(userId: string | number, presetName: string): Promise<string>;
  subscribe(
    userId: string | number,
    presetName?: string
  ): Promise<{ name: string; options: SearchOptions }>;
  unsubscribe(userId: string | number): Promise<
    | {
        preset: string;
        startedAt: string;
      }
    | undefined
  >;
  markShown(
    userId: string | number,
    offers: AccommodationOffer[]
  ): Promise<void>;
}

export declare class TelegramSubscriptionService {
  constructor(options: {
    delivery: (userId: string, offers: AccommodationOffer[]) => Promise<void>;
    intervalMs?: number;
    logger?: Pick<Console, 'error'>;
    presets: SearchPresetService;
    search: SearchService;
  });
  runFor(
    userId: string | number,
    presetName?: string
  ): Promise<AccommodationOffer[]>;
  runOnce(): Promise<void>;
  start(): void;
  stop(): void;
}

export declare class MediaCache {
  constructor(options?: {
    directory?: string;
    fetchImpl?: typeof fetch;
    maxBytes?: number;
  });
  cacheOffers(offers: AccommodationOffer[]): Promise<AccommodationOffer[]>;
  enforceBudget(offers?: AccommodationOffer[]): Promise<{
    removed: string[];
    usage: number;
  }>;
}

export declare class SourceRegistry {
  constructor(options?: Record<string, unknown>);
  list(type?: 'web' | 'telegram'): Promise<AccommodationSource[]>;
  update(options?: {
    count?: number;
    focusCount?: number;
    telegramCount?: number;
    webCount?: number;
  }): Promise<{
    web: AccommodationSource[];
    telegram: AccommodationSource[];
  }>;
}

export declare class BrowserCollector {
  constructor(options?: Record<string, unknown>);
  collect(
    sources: AccommodationSource[],
    query?: string,
    options?: {
      runId?: string;
      signal?: AbortSignal;
      traceRecorder?: TraceRecorder;
    }
  ): Promise<AccommodationOffer[]>;
}

export declare class BrowserSourceDiscoverer {
  constructor(options?: Record<string, unknown>);
  discover(
    type: 'web' | 'telegram',
    options: { candidates: AccommodationSource[]; focus?: 'nha-trang' }
  ): Promise<AccommodationSource[]>;
}

export declare class SearchService {
  constructor(options: Record<string, unknown>);
  search(options?: SearchOptions): Promise<AccommodationOffer[]>;
}

export declare function createAvailabilityMessage(
  offer: Pick<AccommodationOffer, 'title' | 'url'>
): string;

export declare class TelegramAvailabilityService {
  constructor(options?: {
    apiHash?: string;
    apiId?: number | string;
    clientFactory?: (options: {
      apiHash: string;
      apiId: number;
    }) => Promise<Record<string, unknown>>;
    now?: () => Date;
    router?: TelegramCapabilityRouter;
    session?: string;
    store?: Pick<LinksStore, 'listOffers'>;
  });
  check(
    offerId: string,
    options?: { message?: string; recipient?: string }
  ): Promise<{
    messageId?: number;
    offerId: string;
    recipient: string;
    sentAt: string;
  }>;
  destroy(): Promise<void> | undefined;
}

export declare function registerTelegramHandlers(
  bot: Record<string, unknown>,
  dependencies: Record<string, unknown>
): Record<string, unknown>;
export declare function createTelegramBot(
  token: string,
  dependencies: Record<string, unknown>
): Promise<Record<string, unknown>>;
export declare function telegramRuntimeMiddleware(bot: {
  runtime?: { middleware(context: unknown, next: () => unknown): unknown };
}): (context: unknown, next: () => unknown) => unknown;
export declare function telegramDeduplicationMiddleware(updateDeduplicator: {
  accept(update: unknown): Promise<boolean>;
}): (context: { update: unknown }, next: () => unknown) => Promise<unknown>;
export declare function deliverSubscriptionOffers(
  api: {
    sendMediaGroup(chatId: string, media: unknown[]): Promise<unknown>;
    sendMessage(chatId: string, text: string): Promise<unknown>;
  },
  chatId: string,
  offers: AccommodationOffer[],
  options?: { maxProgress?: number; store?: LinksStore }
): Promise<void>;

export declare class PresetService {
  constructor(options: {
    maxShownPerUser?: number;
    now?: () => Date;
    store: LinksStore;
  });
  list(
    userId: string
  ): Promise<Array<{ name: string; options: SearchOptions }>>;
  show(
    userId: string,
    name: string
  ): Promise<{ name: string; options: SearchOptions }>;
  activeName(userId: string): Promise<string | undefined>;
  activeOptions(userId: string): Promise<SearchOptions>;
  save(userId: string, name: string, options?: SearchOptions): Promise<unknown>;
  use(userId: string, name: string): Promise<void>;
  delete(userId: string, name: string): Promise<void>;
  resolveSearch(
    userId: string,
    overrides: SearchOptions
  ): Promise<SearchOptions>;
  subscribe(userId: string, name?: string): Promise<unknown>;
  unsubscribe(userId: string): Promise<void>;
}

export declare class SubscriptionScheduler {
  constructor(options: Record<string, unknown>);
  start(): void;
  stop(): Promise<void>;
  tick(): Promise<void>;
}

export declare class TelegramAuthService {
  constructor(options?: Record<string, unknown>);
  login(
    options?: Record<string, unknown>
  ): Promise<{ id: number; username?: string }>;
  rotate(
    options?: Record<string, unknown>
  ): Promise<{ id: number; username?: string }>;
  validate(): Promise<{ id: number; username?: string }>;
  status(): Promise<Record<string, unknown>>;
  logout(options?: { revoke?: boolean }): Promise<void>;
}

export declare function validateTelegramConfiguration(options?: {
  apiHash?: string;
  apiId?: number | string;
  botToken?: string;
  session?: string;
  sessionFormat?: string;
}): {
  mode: 'bot-only' | 'user-only' | 'both';
  userUnavailable?: string;
};

export declare function resolveTelegramSecrets(
  env?: Record<string, string | undefined>
): Promise<{
  apiHash?: string;
  apiId?: string;
  botToken?: string;
  session?: string;
  sessionFormat?: string;
}>;

export declare function preflightTelegram(
  options?: Record<string, unknown>
): Promise<{
  identities: Record<string, { id: number; username?: string }>;
  mode: 'bot-only' | 'user-only' | 'both';
  capabilities: {
    effectiveMode: 'bot-only' | 'user-only' | 'both';
    bot: { available: boolean; state: string; reason?: string };
    user: { available: boolean; state: string; reason?: string };
  };
}>;

export declare class TelegramAccessPolicy {
  constructor(options?: Record<string, unknown>);
  authorize(
    context: Record<string, unknown>,
    options?: { action?: string; privileged?: boolean }
  ): { chatId?: string; userId?: string };
}

export declare class TelegramCapabilityRouter {
  constructor(options?: Record<string, unknown>);
  diagnostics(): Record<string, unknown>;
  send(
    destination: unknown,
    message: unknown,
    options?: { idempotencyKey?: string }
  ): Promise<unknown>;
  identity(...arguments_: unknown[]): Promise<unknown>;
  liveUpdates(...arguments_: unknown[]): Promise<unknown>;
  history(...arguments_: unknown[]): Promise<unknown>;
  resolveEntity(...arguments_: unknown[]): Promise<unknown>;
  media(...arguments_: unknown[]): Promise<unknown>;
  membership(...arguments_: unknown[]): Promise<unknown>;
  popularity(...arguments_: unknown[]): Promise<unknown>;
  destroy(): Promise<void>;
}

export declare class BotApiTelegramProvider {
  constructor(
    api: Record<string, (...arguments_: unknown[]) => unknown>,
    options?: {
      fetchImpl?: typeof fetch;
      token?: string;
    }
  );
  capabilities: Set<string>;
  transport: 'bot-api';
  identity(): Promise<unknown>;
  resolveEntity(chatId: unknown): Promise<unknown>;
  media(
    fileId: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<Uint8Array>;
  membership(chatId: unknown, userId?: unknown): Promise<unknown>;
  popularity(chatId: unknown): Promise<{ members: number }>;
  send(
    destination: unknown,
    message: unknown,
    options?: Record<string, unknown>
  ): Promise<unknown>;
}

export declare class MtcuteTelegramProvider {
  constructor(options?: Record<string, unknown>);
  capabilities: Set<string>;
  transport: 'mtproto';
  identity(): Promise<{ id: number; username?: string }>;
  discover(options?: {
    focus?: 'nha-trang';
    queries?: TelegramDiscoveryQuery[];
    signal?: AbortSignal;
  }): Promise<TelegramDiscoveryCandidate[]>;
  history(
    source: AccommodationSource,
    options?: {
      resume?: {
        oldestMessageDate: string;
        oldestMessageId: number | string;
      };
      since?: Date;
    }
  ): Promise<AsyncIterable<Record<string, unknown>>>;
  liveUpdates(
    handler: (event: Record<string, unknown>) => unknown,
    options?: { sources?: AccommodationSource[] }
  ): Promise<{ stop(): void }>;
  resolveEntity(value: unknown): Promise<unknown>;
  media(location: unknown, options?: Record<string, unknown>): Promise<unknown>;
  membership(chatId: unknown, userId?: unknown): Promise<unknown>;
  popularity(chatId: unknown): Promise<{ members: number | null }>;
  send(
    destination: unknown,
    message: unknown,
    options?: Record<string, unknown>
  ): Promise<unknown>;
  destroy(): Promise<void>;
}

export declare function normalizeMtcuteMessage(
  message: Record<string, unknown>,
  source: AccommodationSource
): Record<string, unknown>;

export declare class TelegramIngestionService {
  constructor(options: Record<string, unknown>);
  start(
    sources: AccommodationSource[]
  ): Promise<{ backfilled: number; sources: number }>;
  destroy(): Promise<void>;
}

export declare class TelegramRuntime {
  constructor(options?: Record<string, unknown>);
  exitCode: number;
  polling?: Promise<unknown>;
  start(): Promise<this>;
  stop(reason?: string): Promise<void>;
  middleware(context: unknown, next: () => Promise<unknown>): Promise<unknown>;
  health(kind?: 'live' | 'ready'): { status: string };
  installSignalHandlers(processLike?: {
    exitCode?: number;
    off(event: string, listener: () => void): unknown;
    once(event: string, listener: () => void): unknown;
  }): () => void;
}

export declare class UpdateDeduplicator {
  constructor(options: Record<string, unknown>);
  accept(update: Record<string, unknown>): Promise<boolean>;
}

export declare class TelegramHistoryCollector {
  constructor(options?: Record<string, unknown>);
  collect(sources: AccommodationSource[]): Promise<AccommodationOffer[]>;
}
export declare function createApplication(options?: Record<string, unknown>): {
  accessPolicy: TelegramAccessPolicy;
  collector: BrowserCollector;
  createAvailabilityService: (
    credentials?: Record<string, unknown>
  ) => TelegramAvailabilityService;
  createBot: (
    token: string,
    credentials?: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
  createTelegramIngestionService: (
    credentials?: Record<string, unknown>
  ) => TelegramIngestionService;
  mediaCache: MediaCache;
  presetService: PresetService;
  rateProvider: ExchangeRateProvider;
  registry: SourceRegistry;
  service: SearchService;
  store: LinksStore;
  traceRecorder: TraceRecorder;
  updateDeduplicator: UpdateDeduplicator;
};
