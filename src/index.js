/**
 * Example module entry point
 * Replace this with your actual implementation
 */

/**
 * Example function that adds two numbers
 * @param {number} a - First number
 * @param {number} b - Second number
 * @returns {number} Sum of a and b
 */
export const add = (a, b) => a + b;

/**
 * Example function that multiplies two numbers
 * @param {number} a - First number
 * @param {number} b - Second number
 * @returns {number} Product of a and b
 */
export const multiply = (a, b) => a * b;

/**
 * Example async function
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
export const delay = (ms) =>
  new Promise((resolve) => globalThis.setTimeout(resolve, ms));

export { createApplication } from './application.js';
export { BrowserCollector, buildSearchUrl } from './browser-collector.js';
export { parseSearchCommand } from './commands.js';
export {
  LinksStore,
  deserializeOffers,
  deserializeSources,
  serializeOffers,
  serializeSources,
} from './links-store.js';
export { MediaCache } from './media-cache.js';
export { deduplicateOffers, normalizeOffer } from './offers.js';
export { ExchangeRateProvider, convertToVnd, parsePrice } from './pricing.js';
export { SearchService } from './search-service.js';
export { BrowserSourceDiscoverer } from './source-discovery.js';
export {
  DEFAULT_TELEGRAM_SOURCES,
  DEFAULT_WEB_SOURCES,
  SourceRegistry,
} from './sources.js';
export {
  createTelegramBot,
  formatSearchResults,
  registerTelegramHandlers,
} from './telegram-bot.js';
export { parseTelegramOffer } from './telegram-parser.js';
