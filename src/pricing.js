import { listingLexemes } from './listing-lexemes.js';
const CURRENCY_ALIASES = new Map([
  ['$', 'USD'],
  ['US$', 'USD'],
  ['USD', 'USD'],
  ['€', 'EUR'],
  ['EUR', 'EUR'],
  ['EURO', 'EUR'],
  ['EUROS', 'EUR'],
  ['ЕВРО', 'EUR'],
  ['£', 'GBP'],
  ['₽', 'RUB'],
  ['RUB', 'RUB'],
  ['GBP', 'GBP'],
  ['美元', 'USD'],
  ['美金', 'USD'],
]);

const CURRENCY =
  'VND|VNĐ|донг(?:а|ов)?|đồng|₫|đ(?!\\p{L})|USD|US\\$|\\$|долл(?:ар\\p{L}{0,3})?|dollars?|EUR|€|евро|euros?|GBP|£|₽|RUB|руб(?:л\\p{L}{0,3}|\\.)?|美元|美金|越盾';
const NUMBER = '\\d{1,12}(?:[.,\\u00a0 ]\\d{3}){0,4}(?:[.,]\\d{1,4})?';
const SCALE =
  'triệu|tr|million|mio|mln|млн|мл|миллион\\p{L}{0,3}|tỷ|billion|млрд|миллиард\\p{L}{0,3}|k|к|тыс|nghìn|ngàn|thousand|m|萬|万';
// A money token is a number or range with an optional scale word and a
// currency on either side. The scale and currency must end at a word
// boundary, so "60 Trần Phú" or "60 m²" never read as millions. Chinese
// text has no spaces, so a Han character next to a token is not a word.
const LETTER = '(?!\\p{sc=Han})\\p{L}';
const MONEY = new RegExp(
  `(?<![\\d.,+]|${LETTER})(?:(${CURRENCY})\\s?)?(${NUMBER})(?:\\s?[-–—]\\s?(${NUMBER}))?(?!\\d)(?:(\\s?)(${SCALE})(?![\\d²³]|${LETTER}))?(?:\\.?\\s{0,6}\\/?\\s?(${CURRENCY})(?!${LETTER}))?`,
  'giu'
);

const PERIODS = [
  [
    'night',
    /(?<!\p{L})(?:ноч\p{L}*|сут(?:ки|ок|ка)?|день|дн(?:я|ей)|nights?|days?|đêm|ngày)(?!\p{L})/iu,
  ],
  ['week', /(?<!\p{L})(?:недел\p{L}*|weeks?|tuần)(?!\p{L})/iu],
  [
    'month',
    /(?<!\p{L})(?:месяц\p{L}*|мес|months?|tháng)(?!\p{L})|每月|月租|[個个]月/iu,
  ],
  ['year', /(?<!\p{L})(?:год(?:а|ов)?|years?|năm)(?!\p{L})/iu],
];
const PERIOD_WORDS = new RegExp(
  PERIODS.map(([, pattern]) => pattern.source).join('|'),
  'giu'
);

// Labels that name the rent itself. An amount under one of them outranks
// every unlabelled amount in the post.
const RENT_LABEL =
  /стоимост\p{L}*|цен[аыуе](?!\p{L})|аренд\p{L}*|price|rent|giá|租金/iu;
// Contract duration labels identify rent options. Their numbers are not money
// (Vietnamese "đồng 6" otherwise looks like a currency followed by an amount).
const RENT_TERM =
  /(?<!\p{L})(?:(?:договор|contract|lease|hợp\s+đồng)\s*(?:(?:от|from|từ)\s*)?)?\d{1,3}(?:\s*[-–—]\s*\d{1,3})?\s*(?:месяц\p{L}*|months?|tháng)\s*:/iu;
const OCCUPANCY_OPTION =
  /(?:(?:для|for|cho)\s*)?\d{1,3}\s*(?:человек\p{L}*|persons?|people|occupants?|người)/iu;
const EXTRA_CHARGE =
  /надбав\p{L}*|доплат\p{L}*|surcharge|extra(?=\s*(?:rent\b|charges?\b|fees?\b|costs?\b|[:\d]|$))|additional\s+(?:rent|charges?|fees?|costs?)|phụ\s*thu|(?:trả|cộng)\s*thêm/iu;
const ADDITIVE_AMOUNT = /(?:[+＋]|(?<!\p{L})plus)\s*$/iu;
// Labels for amounts that are not the rent: utilities, building fees,
// deposits, extras, vehicle rental offered next to the apartment, and sale
// prices.
const FEE_LABEL =
  /receipt|invoice|total|balance|phone|продаж\p{L}*|for\s+sale|sale\s+price|(?<!\p{L})giá\s+bán|электр\p{L}*|свет(?!\p{L})|вод[аыуе](?!\p{L})|интернет|wi-?fi|вай-?фай|управлен\p{L}*|обслужив\p{L}*|охран\p{L}*|услуг\p{L}*|сервис\p{L}*|депозит|залог|комисси\p{L}*|уборк\p{L}*|клининг|стирк\p{L}*|парков\p{L}*|питом\p{L}*|животн\p{L}*|доплат\p{L}*|газ(?!\p{L})|мусор|коммунал\p{L}*|байк\p{L}*|скутер\p{L}*|автомоб\p{L}*|трансфер|electric\p{L}*|water|internet|management|service|deposit|cleaning|laundry|parking|(?<!\p{L})pets?(?!\p{L})|commission|agency|utilit\p{L}*|motorbike|scooter|(?<!\p{L})bike|transfer|điện|nước|phí|cọc|dọn|giặt|gửi\s*xe|xe\s*máy|押金|管理[費费]|水[電电]/iu;
// Unit rates such as "4.500 VND / кВт⋅ч" or "100.000 VND / человек".
const PER_UNIT =
  /^\s?(?:\/|за|per|mỗi|một)?\s?(?:кв?т|kwh|kw(?!\p{L})|số(?!\p{L})|человек\p{L}*|чел(?!\p{L})|person|pax|người|minutes?|mins?|phút|минут\p{L}*|km|км|м³|m³|m3|куб\p{L}*|khối|кг|kg|ký(?!\p{L})|m²|m2|м²|м2)/iu;
// "до 10 млн" or "up to $500" states a budget ceiling, not a listed rent.
// Headings such as "Дополнительные расходы:" that open a list of fees.
const FEE_SECTION =
  /дополнительн\p{L}*|расход\p{L}*|additional|extra\s*(?:costs|fees|charges)|chi\s*phí\s*khác|phát\s*sinh/iu;
const CEILING = /(?:(?<!\p{L})до|up\s+to|under|dưới|не\s+дороже)\s*$/iu;
// Floor words qualify one option of a per-floor rent ("tầng 2 8tr") rather
// than label it, and the number right after one is the floor, so
// "floor 2 - 8,000,000 VND" is no range from 2.
const FLOOR_WORDS =
  /(?<!\p{L})(?:floors?|levels?|этаж\p{L}*|tầng|lầu)(?!\p{L})/giu;
const FLOOR_BEFORE =
  /(?<!\p{L})(?:floors?|levels?|этаж\p{L}*|tầng|lầu)\s*(?:№\s*)?$/iu;

function currencyFrom(value) {
  if (!value) {
    return undefined;
  }
  const upper = value.toUpperCase();
  if (/^(?:ДОЛЛ|DOLLAR)/u.test(upper)) {
    return 'USD';
  }
  if (upper.startsWith('РУБ')) {
    return 'RUB';
  }
  return CURRENCY_ALIASES.get(upper) || 'VND';
}

function parseNumber(value, scaled) {
  const compact = value.replace(/\s/gu, '');
  const separators = compact.match(/[.,]/g) || [];
  if (
    separators.length > 1 ||
    (!scaled && separators.length === 1 && /[.,]\d{3}$/.test(compact))
  ) {
    return Number(compact.replace(/[.,]/g, ''));
  }
  return Number(compact.replace(',', '.'));
}

function multiplier(scale) {
  if (!scale) {
    return 1;
  }
  const unit = scale.toLocaleLowerCase('vi');
  if (/^(?:tỷ|billion|млрд|миллиард)/u.test(unit)) {
    return 1_000_000_000;
  }
  if (/^(?:k|к|тыс|nghìn|ngàn|thousand)$/u.test(unit)) {
    return 1_000;
  }
  if (/^[萬万]$/u.test(unit)) {
    return 10_000;
  }
  return 1_000_000;
}

function periodIn(text) {
  let found;
  for (const [period, pattern] of PERIODS) {
    const index = text.search(pattern);
    if (index >= 0 && (!found || index < found.index)) {
      found = { index, period };
    }
  }
  return found?.period;
}

function clauses(text) {
  return text
    .split(/\r?\n|[;|•]|(?<=[.!?])\s+(?=\p{Lu})/u)
    .filter((clause) => clause.trim());
}

function nearestLabel(text) {
  const comma = text.lastIndexOf(', ');
  return comma >= 0 ? text.slice(comma + 2) : text;
}

// Currency and period words alone ("/сутки", "VND / месяц") do not label an
// amount; the amount then shares the label of the amount before it.
function hasLabelWords(label) {
  if (FEE_LABEL.test(label) || RENT_LABEL.test(label)) {
    return true;
  }
  return /\p{L}{3,}/u.test(
    label
      .replace(new RegExp(CURRENCY, 'giu'), '')
      .replace(PERIOD_WORDS, '')
      .replace(FLOOR_WORDS, '')
      .replace(/(?<!\p{L})(?:в|за|per|a|an|mỗi|một|от|from|từ)(?!\p{L})/giu, '')
  );
}

// "m" alone means metres, and "5 к" with a space is usually a preposition, so
// only "M" and an attached "k"/"к" scale the number.
function scaleOf(match) {
  const [space, scale] = [match[4], match[5]];
  if (scale === 'm' || (/^[kк]$/iu.test(scale || '') && space)) {
    return undefined;
  }
  return scale;
}

function tokenAmounts(match, scale) {
  const scaled = Boolean(scale);
  const factor = multiplier(scale);
  const floorFirst =
    Boolean(match[3]) && FLOOR_BEFORE.test(match.input.slice(0, match.index));
  const [first, second] = floorFirst ? [match[3]] : [match[2], match[3]];
  const low = parseNumber(first, scaled) * factor;
  const high = second ? parseNumber(second, scaled) * factor : low;
  return high > low ? { high, low } : { high: low, low };
}

function moneyMatches(clause) {
  const terms = [...clause.matchAll(new RegExp(RENT_TERM, 'giu'))];
  return [...clause.matchAll(MONEY)].filter(
    (match) =>
      !terms.some(
        (term) =>
          match.index < term.index + term[0].length &&
          match.index + match[0].length > term.index
      )
  );
}

function moneyTokens(clause) {
  const tokens = [];
  for (const match of moneyMatches(clause)) {
    const scale = scaleOf(match);
    const { high, low } = tokenAmounts(match, scale);
    const currency = currencyFrom(match[1] || match[6]);
    const bare = !currency && !scale;
    if (
      !Number.isFinite(low) ||
      low <= 0 ||
      // "0,0055 Triệu" is a card typo; no rent in dong is that small.
      (scale && (currency || 'VND') === 'VND' && low < 50_000) ||
      (bare &&
        (low < 100_000 || !/[.,]\d{3}/u.test(match[2]) || /^0/u.test(match[2])))
    ) {
      continue;
    }
    tokens.push({
      amount: low,
      bare,
      currency: currency || 'VND',
      explicitCurrency: Boolean(currency),
      end: match.index + match[0].length,
      high,
      start: match.index,
    });
  }
  return tokens;
}

function classifyTokens(clause, tokens, section) {
  let previous = section;
  let cursor = 0;
  return tokens.map((token, index) => {
    const before = clause.slice(cursor, token.start);
    const label = nearestLabel(before);
    const next = tokens[index + 1]?.start ?? clause.length;
    const after = clause.slice(token.end, Math.min(next, token.end + 40));
    const leading = after.replace(/^[\s:–—-]*/u, '').split(/\s/u)[0];
    const own = hasLabelWords(label);
    const labeledFee = own
      ? FEE_LABEL.test(label)
      : previous.fee || FEE_LABEL.test(leading);
    const fee =
      labeledFee ||
      ADDITIVE_AMOUNT.test(before) ||
      EXTRA_CHARGE.test(label) ||
      EXTRA_CHARGE.test(
        after
          .replace(PERIOD_WORDS, '')
          .split(/[,;+＋]|(?<!\p{L})plus(?!\p{L})/iu)[0]
      );
    const rent =
      !fee &&
      (RENT_TERM.test(label) ||
        OCCUPANCY_OPTION.test(label) ||
        (own ? RENT_LABEL.test(label) : previous.rent));
    cursor = token.end;
    previous = { fee, rent };
    return {
      ...token,
      ceiling: CEILING.test(before),
      fee: fee || PER_UNIT.test(after),
      period: periodIn(after.slice(0, 24)) || periodIn(label),
      rent,
    };
  });
}

// A clause without amounts that ends with a colon is a heading; the bullets
// under it share its label until the next heading.
function headingSection(clause) {
  const fee = FEE_SECTION.test(clause) || FEE_LABEL.test(clause);
  return { fee, rent: !fee && RENT_LABEL.test(clause) };
}

function optionContext(clause, tokens, index) {
  const token = tokens[index];
  const previous = tokens[index - 1];
  const next = tokens[index + 1];
  const before = previous ? clause.lastIndexOf(', ', token.start) : -1;
  const after = next ? clause.indexOf(', ', token.end) : -1;
  const start = previous && before >= previous.end ? before + 2 : 0;
  const end = next && after >= 0 && after < next.start ? after : clause.length;
  return clause.slice(start, end);
}

function candidates(text) {
  let section = { fee: false, rent: false };
  const parts = clauses(text);
  let sourceOffset = 0;
  return parts.flatMap((clause, index) => {
    const clauseStart = text.indexOf(clause, sourceOffset);
    sourceOffset = clauseStart + clause.length;
    const tokens = moneyTokens(clause);
    if (!tokens.length) {
      if (/:[\s\p{S}\p{P}]*$/u.test(clause)) {
        section = headingSection(clause);
      }
      return [];
    }
    const preceding =
      index > 0 && !moneyTokens(parts[index - 1]).length
        ? parts[index - 1]
        : '';
    return classifyTokens(clause, tokens, section).map(
      (candidate, tokenIndex) => ({
        ...candidate,
        context: optionContext(clause, tokens, tokenIndex),
        preceding,
        clauseIndex: index,
        lexicalStart: clauseStart + candidate.start,
        lexicalEnd: clauseStart + candidate.end,
      })
    );
  });
}

function preferredOptions(pool) {
  const priced = pool.some(({ bare }) => !bare)
    ? pool.filter(({ bare }) => !bare)
    : pool;
  const periods = priced.map(({ period }) => period || 'month');
  const period = periods.includes('month') ? 'month' : periods[0];
  const samePeriod = priced.filter(
    (candidate) => (candidate.period || 'month') === period
  );
  const currency = samePeriod.some(({ currency }) => currency === 'VND')
    ? 'VND'
    : samePeriod[0].currency;
  return samePeriod.filter((candidate) => candidate.currency === currency);
}

function preferred(options) {
  const { currency } = options[0];
  const period = options[0].period || 'month';
  const amount = Math.min(...options.map(({ amount }) => amount));
  const maximum = Math.max(...options.map(({ high }) => high));
  return {
    amount,
    currency,
    period,
    ...(maximum > amount ? { range: { max: maximum, min: amount } } : {}),
  };
}

// The rent is chosen clause by clause. Amounts labelled as utilities, fees,
// deposits, unit rates, or budget ceilings are ignored, and amounts under a
// rent label outrank unlabelled ones. Monthly rent wins over other periods
// and VND over other currencies in the same post. When a post lists several
// rent options (by floor or contract length) the price is the lowest one and
// `range` spans all of them.
export function rentalPriceOptions(
  text = '',
  { includeUnlabeled = false } = {}
) {
  const lexemes = listingLexemes(text);
  const all = candidates(lexemes.text)
    .filter(({ ceiling, fee }) => !fee && !ceiling)
    .map((option) => ({
      ...option,
      sourceSpan: lexemes.sourceSpan(option.lexicalStart, option.lexicalEnd),
    }));
  const rent = all.filter((candidate) => candidate.rent);
  const pool = rent.length
    ? all.filter(
        (candidate) =>
          candidate.rent ||
          (includeUnlabeled &&
            !candidate.bare &&
            (candidate.explicitCurrency || candidate.period))
      )
    : all.filter(({ bare }) => !bare);
  return pool.length ? preferredOptions(pool) : [];
}

export function parsePrice(text = '') {
  const options = rentalPriceOptions(text);
  return options.length ? preferred(options) : null;
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
