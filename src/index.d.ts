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
  bedrooms?: number;
  bathrooms?: number;
  areaM2?: number;
  floor?: number;
  district?: string;
  availableFrom?: string;
  minimumStayMonths?: number;
  depositMonths?: number;
  furnished?: boolean;
  petsAllowed?: boolean;
  amenities?: string[];
  labeledFields?: Record<string, string[]>;
  [key: string]: unknown;
}

export interface AccommodationContacts {
  telegram: string[];
  phone: string[];
}

export interface AccommodationOffer {
  id: string;
  sourceId: string;
  sourceType?: 'web' | 'telegram';
  title: string;
  kind?: string;
  location?: string;
  attributes?: AccommodationAttributes;
  contacts?: AccommodationContacts;
  price: Price | null;
  priceVnd: number | null;
  url?: string;
  searchQuery?: string;
  photos: string[];
  postedAt?: string;
  collectedAt: string;
  raw: unknown;
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
  query?: string;
  refresh?: boolean;
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
export declare function parseTelegramOffer(
  message: Record<string, unknown>,
  options?: { now?: Date; rates?: Record<string, number> }
): AccommodationOffer | null;
export declare function parseSearchCommand(
  input?: string
): Required<Pick<SearchOptions, 'cheapest' | 'limit' | 'query'>> &
  Pick<SearchOptions, 'filters'>;
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
  loadSources(): Promise<AccommodationSource[]>;
  saveSources(sources: AccommodationSource[]): Promise<void>;
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
