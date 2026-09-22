export interface Price {
  amount: number;
  currency: string;
  period: 'night' | 'week' | 'month' | 'year';
}

export interface PopularityEvidence {
  metric: string;
  value: number;
  evidenceUrl: string;
  observedAt: string;
}

export interface AccommodationSource {
  id: string;
  name: string;
  type: 'web' | 'telegram';
  url: string;
  searchUrl: string;
  popularity: PopularityEvidence;
  focus?: 'nha-trang';
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
  depositMonths?: number;
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
  location?: string;
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
  location?: string;
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
export declare function parseListingText(text?: string): {
  attributes: AccommodationAttributes;
  contacts: AccommodationContacts;
  kind: string;
  location?: string;
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
  source: Pick<AccommodationSource, 'searchUrl'>,
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
  update(options?: { count?: number }): Promise<{
    web: AccommodationSource[];
    telegram: AccommodationSource[];
  }>;
}

export declare class BrowserCollector {
  constructor(options?: Record<string, unknown>);
  collect(
    sources: AccommodationSource[],
    query?: string
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
}): { mode: 'bot-only' | 'user-only' | 'both' };

export declare function resolveTelegramSecrets(
  env?: Record<string, string | undefined>
): Promise<{
  apiHash?: string;
  apiId?: string;
  botToken?: string;
  session?: string;
}>;

export declare function preflightTelegram(
  options?: Record<string, unknown>
): Promise<{
  identities: Record<string, { id: number; username?: string }>;
  mode: 'bot-only' | 'user-only' | 'both';
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
  history(
    source: AccommodationSource,
    options?: { since?: Date }
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
  updateDeduplicator: UpdateDeduplicator;
};
