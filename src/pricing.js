const CURRENCY_ALIASES = new Map([
  ['$', 'USD'],
  ['US$', 'USD'],
  ['USD', 'USD'],
  ['€', 'EUR'],
  ['EUR', 'EUR'],
  ['£', 'GBP'],
  ['GBP', 'GBP'],
  ['VND', 'VND'],
  ['VNĐ', 'VND'],
  ['ДОНГ', 'VND'],
  ['ДОНГА', 'VND'],
  ['ДОНГОВ', 'VND'],
  ['Đ', 'VND'],
  ['₫', 'VND'],
]);

function parseNumber(value, scaled = false) {
  const compact = value.replace(/\s/g, '');

  if (scaled) {
    return Number(compact.replace(',', '.'));
  }

  const separators = compact.match(/[.,]/g) || [];
  if (
    separators.length > 1 ||
    (separators.length === 1 && /[.,]\d{3}$/.test(compact))
  ) {
    return Number(compact.replace(/[.,]/g, ''));
  }

  return Number(compact.replace(',', '.'));
}

function detectPeriod(text) {
  if (/(?:\/|per\s+|mỗi\s+|по\s*)?(?:night|đêm|ночь)/iu.test(text)) {
    return 'night';
  }
  if (/(?:\/|per\s+|mỗi\s+|за\s*)?(?:week|tuần|недел)/iu.test(text)) {
    return 'week';
  }
  if (/(?:\/|per\s+|mỗi\s+|за\s*)?(?:year|năm|год)/iu.test(text)) {
    return 'year';
  }
  return 'month';
}

function currencyFrom(value) {
  return CURRENCY_ALIASES.get(value.toUpperCase()) || 'VND';
}

function scaledCandidates(text) {
  const candidates = [];
  const pattern =
    /(?<![\d.,])(\d{1,12}(?:[.,]\d{1,4})?)(?![\d.,])\s*(triệu|tr(?:iệu)?|million|mio|млн|tỷ|billion)(?:\s*(VND|VNĐ|донг(?:а|ов)?|₫|đ|USD|US\$|\$|EUR|€|GBP|£))?/giu;

  for (const match of text.matchAll(pattern)) {
    const unit = match[2].toLocaleLowerCase('vi');
    const multiplier = /tỷ|billion/u.test(unit) ? 1_000_000_000 : 1_000_000;
    candidates.push({
      amount: parseNumber(match[1], true) * multiplier,
      currency: match[3] ? currencyFrom(match[3]) : 'VND',
      period: detectPeriod(text.slice(match.index, match.index + 80)),
    });
  }

  return candidates;
}

function explicitCurrencyCandidates(text) {
  const candidates = [];
  const currency = '(VND|VNĐ|донг(?:а|ов)?|₫|đ|USD|US\\$|\\$|EUR|€|GBP|£)';
  const number = '(?<!\\d)(\\d(?:[\\d.,\\s]{0,20}\\d)?)(?!\\d)';
  const patterns = [
    new RegExp(`${currency}\\s*${number}`, 'giu'),
    new RegExp(`${number}\\s*${currency}`, 'giu'),
  ];

  for (const [patternIndex, pattern] of patterns.entries()) {
    for (const match of text.matchAll(pattern)) {
      const currencyIndex = patternIndex === 0 ? 1 : 2;
      const numberIndex = patternIndex === 0 ? 2 : 1;
      const amount = parseNumber(match[numberIndex]);
      if (Number.isFinite(amount)) {
        candidates.push({
          amount,
          currency: currencyFrom(match[currencyIndex]),
          period: detectPeriod(text.slice(match.index, match.index + 80)),
        });
      }
    }
  }

  return candidates;
}

export function parsePrice(text = '') {
  const candidates = [
    ...scaledCandidates(String(text)),
    ...explicitCurrencyCandidates(String(text)),
  ].filter(
    (candidate) => Number.isFinite(candidate.amount) && candidate.amount > 0
  );

  return (
    candidates.find((candidate) => candidate.currency === 'VND') ||
    candidates[0] ||
    null
  );
}

export function convertToVnd(price, rates = {}) {
  if (!price) {
    return null;
  }
  if (price.currency === 'VND') {
    return Math.round(price.amount);
  }

  const rate = rates[price.currency];
  return Number.isFinite(rate) ? Math.round(price.amount * rate) : null;
}

export class ExchangeRateProvider {
  constructor({ fetchImpl = globalThis.fetch, maxAgeMs = 86_400_000 } = {}) {
    this.fetchImpl = fetchImpl;
    this.maxAgeMs = maxAgeMs;
    this.cached = { VND: 1 };
    this.updatedAt = 0;
  }

  async getRates() {
    if (Date.now() - this.updatedAt < this.maxAgeMs) {
      return this.cached;
    }

    try {
      const response = await this.fetchImpl(
        'https://open.er-api.com/v6/latest/VND'
      );
      if (!response.ok) {
        return this.cached;
      }

      const payload = await response.json();
      const currencies = ['USD', 'EUR', 'GBP'];
      this.cached = { VND: 1 };
      for (const currency of currencies) {
        const vndPerUnit = 1 / payload.rates?.[currency];
        if (Number.isFinite(vndPerUnit)) {
          this.cached[currency] = vndPerUnit;
        }
      }
      this.updatedAt = Date.now();
    } catch {
      return this.cached;
    }
    return this.cached;
  }
}
