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
  id: string;
  sourceId: string;
  sourceType?: 'web' | 'official-web' | 'telegram';
  title: string;
  url?: string;
  officialUrl?: string;
  price: Price | null;
  priceVnd: number | null;
  postedAt?: string;
  collectedAt: string;
  raw: unknown;
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
}

export interface SearchOptions {
  cheapest?: boolean;
  filters?: Record<string, boolean | number | string>;
  limit?: number;
  maxPricePerBedVnd?: number;
  maxPricePerRoomVnd?: number;
  maxRooms?: number;
  maxTotalPriceVnd?: number;
  minPricePerBedVnd?: number;
  minPricePerRoomVnd?: number;
  minRooms?: number;
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
  input?: string
): Required<Pick<SearchOptions, 'cheapest' | 'limit' | 'query'>> &
  Omit<SearchOptions, 'cheapest' | 'limit' | 'query' | 'refresh'>;
export declare function parseSearchOverrides(input?: string): SearchOptions;
export declare function buildSearchUrl(
  source: Pick<AccommodationSource, 'searchUrl'>,
  query?: string
): string;
export declare function formatSearchResults(
  offers: AccommodationOffer[]
): string;
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
  constructor(options?: { directory?: string; maxBytes?: number });
  listOffers(): Promise<AccommodationOffer[]>;
  saveOffers(offers: AccommodationOffer[]): Promise<void>;
  loadSearchState(): Promise<SearchState>;
  saveSearchState(state: SearchState): Promise<void>;
  loadSources(): Promise<AccommodationSource[]>;
  saveSources(sources: AccommodationSource[]): Promise<void>;
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
}

export declare function registerTelegramHandlers(
  bot: Record<string, unknown>,
  dependencies: Record<string, unknown>
): Record<string, unknown>;
export declare function createTelegramBot(
  token: string,
  dependencies: Record<string, unknown>
): Promise<Record<string, unknown>>;
export declare function createApplication(options?: Record<string, unknown>): {
  collector: BrowserCollector;
  createAvailabilityService: (
    credentials?: Record<string, unknown>
  ) => TelegramAvailabilityService;
  createBot: (
    token: string,
    credentials?: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
  mediaCache: MediaCache;
  rateProvider: ExchangeRateProvider;
  registry: SourceRegistry;
  service: SearchService;
  store: LinksStore;
};
