import { canonicalizeUrl } from './utils.js';
import { detectListingLanguage } from './language.js';
import { namesPlace, nhaTrangPlace } from './nha-trang-places.js';
import { parsePrice, rentalPriceOptions } from './pricing.js';

function matchedNumber(text, patterns) {
  for (const pattern of patterns) {
    const value = text.match(pattern)?.[1];
    if (value !== undefined) {
      const parsed = Number(value.replace(',', '.'));
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function matchedBoolean(text, positive, negative) {
  if (negative.test(text)) {
    return false;
  }
  return positive.test(text) || undefined;
}

function definedProperties(properties) {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined)
  );
}

function labelSegments(line) {
  const results = [];
  for (const segment of line.split(';')) {
    const candidates = [
      segment.indexOf(':'),
      segment.indexOf('：'),
      segment.indexOf(' - '),
      segment.indexOf(' – '),
      segment.indexOf(' — '),
    ].filter((index) => index > 0 && index <= 60);
    if (!candidates.length) {
      continue;
    }
    const index = Math.min(...candidates);
    const markerLength = segment[index] === ' ' ? 3 : 1;
    results.push([
      segment,
      segment.slice(0, index),
      segment.slice(index + markerLength),
    ]);
  }
  return results;
}

export function parseLabeledFields(value = '') {
  const text = String(value);
  const fields = {};
  for (const line of text.split(/\r?\n/u)) {
    for (const match of labelSegments(line)) {
      const label = match[1]
        .replace(/^[^\p{L}\p{N}]+/u, '')
        .trim()
        .toLocaleLowerCase();
      const value = match[2].trim();
      if (label && value) {
        fields[label] = [...(fields[label] || []), value];
      }
    }
  }
  return fields;
}

function firstLabeledValue(fields, labels) {
  for (const label of labels) {
    if (fields[label]?.[0]) {
      return fields[label][0];
    }
  }
  return undefined;
}

function isoDate(text, referenceDate = new Date()) {
  const match = text.match(
    /(?:свобод\p{L}*|available|доступ\p{L}*|có\s*sẵn)[^\d]{0,24}(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/iu
  );
  if (!match) {
    return undefined;
  }
  const suppliedYear = match[3];
  const year = suppliedYear
    ? Number(suppliedYear) + (suppliedYear.length === 2 ? 2000 : 0)
    : new Date(referenceDate).getUTCFullYear();
  const month = Number(match[2]);
  const day = Number(match[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : undefined;
}

function extractContacts(text) {
  const email = new Set();
  const phone = new Set();
  const telegram = new Set();
  for (const match of text.matchAll(
    /(?<![\p{L}\p{N}.])@([A-Za-z][A-Za-z\d_]{4,31})/gu
  )) {
    telegram.add(match[1]);
  }
  for (const match of text.matchAll(
    /https?:\/\/(?:t|telegram)\.me\/([A-Za-z][A-Za-z\d_]{4,31})/gu
  )) {
    telegram.add(match[1]);
  }
  for (const match of text.matchAll(
    /[\p{L}\d.!#$%&'*+/=?^_`{|}~-]{1,64}@[\p{L}\d-]{1,63}(?:\.[\p{L}\d-]{1,63}){1,10}/gu
  )) {
    email.add(match[0].toLocaleLowerCase('en'));
  }
  for (const line of text.split(/\r?\n/u)) {
    if (!/(?:contact|контакт|whatsapp|phone|телефон|liên\s*hệ)/iu.test(line)) {
      continue;
    }
    for (const match of line.matchAll(/\+?\d[\d\s().-]{7,20}\d/gu)) {
      const normalized = `${match[0].startsWith('+') ? '+' : ''}${match[0].replace(/\D/gu, '')}`;
      if (normalized.replace('+', '').length >= 8) {
        phone.add(normalized);
      }
    }
  }
  return { email: [...email], phone: [...phone], telegram: [...telegram] };
}

function extractAmenities(text) {
  const candidates = [
    ['air-conditioning', /air\s*condition|кондиционер|điều\s*hòa/iu],
    ['balcony', /balcony|балкон|ban\s*công/iu],
    ['elevator', /elevator|lift|лифт|thang\s*máy/iu],
    ['gym', /\bgym\b|тренажер|phòng\s*tập/iu],
    ['kitchen', /kitchen|кухн|bếp/iu],
    ['parking', /parking|парковк|bãi\s*đỗ/iu],
    ['pool', /pool|бассейн|hồ\s*bơi/iu],
    ['sea-view', /sea\s*view|ocean\s*view|вид\s*на\s*море|view\s*biển/iu],
    ['washing-machine', /washing\s*machine|стиральн|máy\s*giặt/iu],
    ['wifi', /wi-?fi|вай-?фай/iu],
  ];
  return candidates
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name)
    .sort();
}

function timeValue(text, label) {
  return text.match(
    new RegExp(`(?:${label})\\s{0,8}[:#-]?\\s{0,8}(\\d{1,2}:\\d{2})`, 'iu')
  )?.[1];
}

function coordinates(text) {
  const match = text.match(
    /(?:GPS|coordinates?|координат|tọa\s*độ)\s{0,8}[:#-]?\s{0,8}(-?\d{1,2}(?:[.,]\d{1,8})?)\s*[,;]\s*(-?\d{1,3}(?:[.,]\d{1,8})?)/iu
  );
  if (!match) {
    return {};
  }
  const latitude = Number(match[1].replace(',', '.'));
  const longitude = Number(match[2].replace(',', '.'));
  return latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
    ? { latitude, longitude }
    : {};
}

function wordNumber(text, expressions) {
  const words = [
    [1, /one|одн\p{L}*|một/iu],
    [2, /two|дв(?:е|умя)|hai/iu],
    [3, /three|тр(?:и|емя)|ba/iu],
    [4, /four|четыр\p{L}*|bốn/iu],
  ];
  for (const expression of expressions) {
    const nearby = text.match(expression)?.[1];
    if (nearby) {
      return words.find(([, pattern]) => pattern.test(nearby))?.[0];
    }
  }
  return undefined;
}

// A count stands on the same line as its label and is not the tail of a
// longer number, so "ID A902\nbathrooms: 1" or "bathrooms: 1\nbedrooms: 2"
// never lend their digits to the next label. "3-Bedroom" joins them by a dash.
function countBefore(label, digits = 2) {
  return new RegExp(
    `(?<!\\d[.,]?)(\\d{1,${digits}})[ \\t]*-?[ \\t]*(?:${label})(?!\\p{L})`,
    'iu'
  );
}

const CHINESE_DIGITS = { 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5 };
const RUSSIAN_ROOM_WORDS = [
  [1, /одно/iu],
  [2, /двух/iu],
  [3, /тр[её]х/iu],
  [4, /четыр[её]х/iu],
];

// "Комнатная" counts the rooms besides the kitchen; local agencies use it for
// the bedroom count, so it applies only when no bedroom count is stated.
function roomAdjectiveCount(text) {
  const digit = matchedNumber(text, [/(?<!\d)(\d)\s*-\s*комнатн/iu]);
  if (digit !== undefined) {
    return digit;
  }
  const word = text.match(/(\p{L}+)комнатн/iu)?.[1];
  return word
    ? RUSSIAN_ROOM_WORDS.find(([, pattern]) => pattern.test(word))?.[0]
    : undefined;
}

// A navigation footer such as "КВАРТИРЫ И СТУДИИ" names the agency's other
// listings, so only a singular "studio" marks the listing itself.
const STUDIO = /\bstudio\b|студи(?:я|ю|ей)(?!\p{L})/iu;
// Listing sites file a studio under "bedrooms: 1"; the property type wins.
const STUDIO_TYPE = /^type:[^\n]*studio/imu;

function bedroomCount(text) {
  if (STUDIO_TYPE.test(text)) {
    return 0;
  }
  const numeric = matchedNumber(text, [
    countBefore('bedrooms?|спальн\\p{L}*|phòng\\s*ngủ'),
    /(?:bedrooms?|спальн\p{L}*|phòng\s*ngủ)\s{0,8}[:#-]?\s{0,8}(\d{1,2})/iu,
    countBefore('BR|BHK|PN'),
  ]);
  const chinese = text.match(/([一二兩两三四五])房/u)?.[1];
  return (
    numeric ??
    wordNumber(text, [
      /([\p{L}]{1,16}(?:-[\p{L}]{1,16})?)[ \t]+(?:bedrooms?|спальн\p{L}*|phòng[ \t]*ngủ)/iu,
      /(?:bedrooms?|спальн\p{L}*|phòng[ \t]*ngủ)[ \t]+(?:с|with)[ \t]+([\p{L}]{1,16}(?:-[\p{L}]{1,16})?)/iu,
      /(?:bedrooms?|спальн\p{L}*|phòng[ \t]*ngủ)[ \t]+([\p{L}]{1,16}(?:-[\p{L}]{1,16})?)/iu,
    ]) ??
    roomAdjectiveCount(text) ??
    (chinese ? CHINESE_DIGITS[chinese] : undefined) ??
    (STUDIO.test(text) ? 0 : undefined)
  );
}

function moneyAfterLabel(text, label) {
  const value = text.match(
    new RegExp(`(?:${label})\\s{0,12}[:#-]?\\s{0,12}([^\\n]{1,100})`, 'iu')
  )?.[1];
  return value ? parsePrice(value) : undefined;
}

function utilityCharges(text) {
  const candidates = [
    ['management', /management|управлен|phí\s*quản\s*lý/iu],
    ['internet', /internet|интернет|wi-?fi/iu],
    ['electricity', /electricity|электрич|điện/iu],
    ['water', /\bwater\b|вод[ауы]|nước/iu],
  ];
  return candidates
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

function fees(fields) {
  return Object.entries(fields)
    .filter(([label]) => /fee|phí|комисси|управлен/iu.test(label))
    .flatMap(([label, values]) =>
      values
        .map((value) => ({ label, price: parsePrice(value) }))
        .filter(({ price }) => price)
    );
}

function extractAttributes(text, fields, referenceDate, bedrooms) {
  // "ID: A2293", "mã căn A12", "Код квартиры: ALAB": the label may name what
  // it codes, and the id is a token with a digit or in capitals, so a plain
  // word after the label ("Idea", "mã căn đẹp") is no id.
  const propertyId = text.match(
    /(?:\b[Ii][Dd]|(?<!\p{L})(?:[Кк]од|КОД|[Mm]ã|MÃ))(?!\p{L})(?:\s+(?:\p{Ll}{2,12}|\p{Lu}{2,12}(?=\s*[:#№])))?\s{0,8}[#:№-]?\s{0,8}((?=[\p{L}_-]{0,31}\d)[\p{L}\d][\p{L}\d_-]{0,31}|\p{Lu}[\p{Lu}\d_-]{1,31})(?![\p{L}\d_-]|\s*[:#№])/u
  )?.[1];
  const bathrooms = matchedNumber(text, [
    countBefore('bathrooms?|сануз\\p{L}*|phòng\\s*tắm'),
    /(?:bathrooms?|сануз\p{L}*|phòng\s*tắm)\s{0,8}[:#-]?\s{0,8}(\d{1,2})/iu,
    countBefore('WC'),
  ]);
  const beds = matchedNumber(text, [
    /(?:\bbeds?(?!\p{L})|кроват\p{L}*|giường)\s{0,8}[:#-]?\s{0,8}(\d{1,2})/iu,
    countBefore('beds?|кроват\\p{L}*|giường'),
  ]);
  const guests = matchedNumber(text, [
    /(?:guests?|гост\p{L}*|khách)\s{0,8}[:#-]?\s{0,8}(\d{1,3})/iu,
    countBefore('guests?|гост\\p{L}*|khách', 3),
  ]);
  const areaM2 = matchedNumber(text, [
    /(\d{1,4}(?:[.,]\d{1,2})?)[ \t]*(?:m²|m2|м²|кв\.?\s*м)/iu,
  ]);
  const floor = matchedNumber(text, [
    /(?:floor|этаж|tầng)\s{0,8}[:#-]?\s{0,8}(\d{1,3})/iu,
    countBefore('floor|этаж\\p{L}*', 3),
  ]);
  const rooms = matchedNumber(text, [
    countBefore('rooms?|комнат\\p{L}*|phòng(?!\\s*(?:ngủ|tắm))'),
  ]);
  const minimumStayMonths = matchedNumber(text, [
    /(?:minimum|аренд\p{L}*\s+от|tối\s*thiểu)\D{0,24}(\d{1,3})\s*(?:months?|месяц\p{L}*|tháng)/iu,
    /(?:hợp\s*đồng)\D{0,24}(\d{1,3})\s*tháng/iu,
    /(?:contract|контракт)\s{0,8}[:#-]?\s{0,8}(\d{1,3})\s*(?:months?|месяц\p{L}*)/iu,
  ]);
  const depositMonths =
    matchedNumber(text, [
      /(?:deposit|депозит|đặt\s*cọc)\D{0,16}(\d{1,3})\s*(?:months?|месяц\p{L}*|tháng)/iu,
    ]) ??
    (/deposit[^\n]{0,40}(?:one|monthly\s+payment)|депозит[^\n]{0,50}месячн\p{L}*\s+платеж|đặt\s*cọc[^\n]{0,40}một\s+tháng/iu.test(
      text
    )
      ? 1
      : undefined);
  const maximumStayMonths = matchedNumber(text, [
    /(?:maximum|max\.?|не\s+более|tối\s+đa)\D{0,24}(\d{1,3})\s*(?:months?|месяц\p{L}*|tháng)/iu,
  ]);
  const prepaymentMonths = matchedNumber(text, [
    /(?:prepay(?:ment)?|предоплат\p{L}*|trả\s+trước)\D{0,24}(\d{1,3})\s*(?:months?|месяц\p{L}*|tháng)/iu,
  ]);
  const rating = matchedNumber(text, [
    /(?:rating|рейтинг|đánh\s*giá)\s{0,8}[:#-]?\s{0,8}(\d(?:[.,]\d{1,2})?)/iu,
  ]);
  const reviewCount = matchedNumber(text, [
    /(?:\(|\b)(\d{1,7})\s*(?:reviews?|отзыв\p{L}*|đánh\s*giá)/iu,
  ]);
  const agencyFeePercent = matchedNumber(text, [
    /(?:agency\s*fee|commission|комисси\p{L}*|phí\s*môi\s*giới)\s{0,12}[:#-]?\s{0,12}(\d{1,3}(?:[.,]\d{1,2})?)\s*%/iu,
  ]);
  const furnished = matchedBoolean(
    text,
    /furnished|меблирован|đầy\s*đủ\s*nội\s*thất/iu,
    /unfurnished|без\s*мебел|không\s*nội\s*thất/iu
  );
  const petsAllowed = matchedBoolean(
    text,
    /pets?\s*(?:allowed|welcome)|можно\s+с[^\n]{0,30}животн|cho\s*phép\s*thú\s*cưng/iu,
    /no\s*pets|без\s*животн|không\s*(?:cho\s*phép\s*)?thú\s*cưng/iu
  );
  const utilitiesIncluded = matchedBoolean(
    text,
    /utilities\s+included|коммунальн\p{L}*\s+включен|đã\s*bao\s*gồm\s*(?:điện|nước|tiện\s*ích)/iu,
    /utilities\s+not\s+included|коммунальн\p{L}*[^\n]{0,30}(?:не\s+включен|оплачива\p{L}*\s+отдельно)|(?:электрич\p{L}*|вод\p{L}*)\s+(?:по\s+сч[её]тчик|оплачива\p{L}*\s+отдельно)|chưa\s*bao\s*gồm\s*(?:điện|nước|tiện\s*ích)/iu
  );

  return definedProperties({
    propertyId,
    intent: 'rental-offer',
    rooms,
    bedrooms,
    bathrooms,
    beds,
    guests,
    areaM2,
    floor,
    district: firstLabeledValue(fields, [
      'district',
      'район',
      'khu vực',
      'quận',
    ]),
    availableFrom: isoDate(text, referenceDate),
    ...availability(text),
    minimumStayMonths,
    maximumStayMonths,
    depositMonths,
    deposit:
      depositMonths === undefined
        ? moneyAfterLabel(text, 'deposit|депозит|залог|đặt\\s*cọc')
        : undefined,
    prepaymentMonths,
    prepayment: moneyAfterLabel(
      text,
      'prepay(?:ment)?|предоплат\\p{L}*|trả\\s+trước'
    ),
    furnished,
    petsAllowed,
    utilitiesIncluded,
    agencyFeePercent,
    rating,
    reviewCount,
    utilityCharges: utilityCharges(text),
    fees: fees(fields),
    checkIn: timeValue(text, 'check[- ]?in|заезд|nhận\\s*phòng'),
    checkOut: timeValue(text, 'check[- ]?out|выезд|trả\\s*phòng'),
    ...coordinates(text),
    amenities: extractAmenities(text),
    labeledFields: fields,
  });
}

// Channels edit a post after renting it ("❌Sold out‼️") and leave the
// original "free now" text below, so a marker outranks every open signal.
const UNAVAILABLE =
  /sold\s*out|rented\s*out|already\s+(?:rented|taken|booked)|(?<!\p{L}|not\s|un)occupied(?!\p{L})|no\s+vacancy|no\s+longer\s+available|not\s+available\s+anymore|нет\s+свободных\s+квартир|(?<!\p{L})(?:уже\s+)?сдан[аыо]?(?!\p{L})(?!\s+в\s+эксплуатац)|(?<!\p{L}|не\s)занят[аыо]?(?!\p{L})|(?<!\p{L})(?:не\s*актуальн\p{L}*|больше\s+не\s+сда[её]тся)|đã\s*(?:cho\s*)?thuê|đã\s*có\s*(?:người|khách)\s*thuê|hết\s*phòng|không\s+còn\s+(?:phòng\s+)?trống/iu;
const AVAILABLE_NOW =
  /available\s+now|свобод\p{L}*\s+сейчас|доступ\p{L}*\s+сейчас|có\s+sẵn\s+ngay/iu;

function availability(text) {
  if (UNAVAILABLE.test(text)) {
    return { availability: 'unavailable', availableNow: false };
  }
  return AVAILABLE_NOW.test(text)
    ? { availability: 'available', availableNow: true }
    : {};
}

function detectKind(text) {
  const kinds = [
    ['apartment', /apartment|квартир|căn\s*hộ/iu],
    ['villa', /villa|вилл|biệt\s*thự/iu],
    ['hotel', /hotel|отел|khách\s*sạn/iu],
    ['hostel', /hostel|хостел|nhà\s*nghỉ/iu],
    ['room', /room|комнат|phòng/iu],
    ['house', /house|дом|nhà/iu],
  ];
  return (
    kinds.find(([, pattern]) => pattern.test(text))?.[0] || 'accommodation'
  );
}

function hasLayout(text) {
  return (
    bedroomCount(text) !== undefined || detectKind(text) !== 'accommodation'
  );
}

// Scope layout facts to the selected rent when the priced clauses describe
// distinct properties. Contract/occupancy prices for one property retain
// their shared layout. A descriptor immediately before a price belongs to it.
function selectedRentalLayout(text, price) {
  const options = rentalPriceOptions(text, { includeUnlabeled: true });
  const distinctContexts = new Set(options.map(({ context }) => context));
  const distinctPrices = new Set(options.map(({ amount }) => amount));
  const distinctBedrooms = new Set(
    options
      .map(({ context }) => bedroomCount(context))
      .filter((count) => count !== undefined)
  );
  const mixed =
    distinctContexts.size > 1 &&
    (distinctPrices.size > 1 || distinctBedrooms.size > 1) &&
    options.some(
      (option, index) =>
        hasLayout(option.context) || (index > 0 && hasLayout(option.preceding))
    );
  if (!mixed) {
    return { bedrooms: bedroomCount(text), kind: detectKind(text) };
  }
  const minimum = price?.amount ?? parsePrice(text)?.amount;
  const selected = options.filter(
    ({ amount, currency, period }) =>
      amount === minimum &&
      (!price ||
        (price.currency === currency && price.period === (period || 'month')))
  );
  if (!selected.length) {
    return { bedrooms: undefined, kind: 'accommodation' };
  }
  const layouts = selected.map(({ context, preceding }) => {
    const local = hasLayout(context) ? context : `${preceding}\n${context}`;
    return {
      bedrooms: bedroomCount(local),
      kind: STUDIO.test(local) ? 'studio' : detectKind(local),
    };
  });
  const common = (field) =>
    layouts.every((layout) => layout[field] === layouts[0][field])
      ? layouts[0][field]
      : undefined;
  const header = text.slice(0, text.indexOf(options[0].context));
  const kind = common('kind');
  return {
    bedrooms: common('bedrooms'),
    kind: kind && kind !== 'accommodation' ? kind : detectKind(header),
  };
}

function trimTrailingCharacters(value, characters) {
  let end = value.length;
  while (end > 0 && characters.includes(value[end - 1])) {
    end -= 1;
  }
  return value.slice(0, end);
}

const LOCATION_LABELS = [
  'address',
  'location',
  'district',
  'địa chỉ',
  'vị trí',
  'khu vực',
  'quận',
  'адрес',
  'район',
  'локация',
  'местоположение',
  'расположение',
];
const LOCATION_LABEL =
  /(?:address|location|district|địa\s*chỉ|vị\s*trí|khu\s*vực|quận|адрес|район|локация|местоположение|расположение)\s*:[ \t]*([^\n\r]*)/iu;
// A card whose location slot holds another fact ("Area m²: 60", "Deposit:
// $393") names no place there.
const NUMERIC_FACT = /^[^:\d\n]{1,24}:\s*[$€£₫\d]/u;
const BULLET = /^\s*[•·▪◦‣\-–]\s*(\S.*)$/u;
// Bullets such as "≈ 5 минут пешком до моря" give a distance, not a place.
const DISTANCE = /^≈|\d\s*(?:минут|мин|min|phút)/iu;

const PINNED_LINES = /^\s*📍.*$/gmu;
// A pinned line ends at "|" or at the next emoji: "📍 Центр – Лок Тхо 🌊 500 м".
// The split part is trimmed, so the pattern holds no whitespace run, which
// would rescan every unterminated run.
const PIN_END = /\||\p{Extended_Pictographic}/u;
// A label with nothing after it ("📍 Локация:") lists the place in the
// bullets below it.
function bulletsAfter(lines, index) {
  const items = [];
  for (const line of lines.slice(index + 1)) {
    const item = line.match(BULLET)?.[1].trim();
    if (!item) {
      break;
    }
    if (!DISTANCE.test(item)) {
      items.push(item);
    }
  }
  return items.slice(0, 2).join(', ') || undefined;
}

function labeledLocation(text) {
  const lines = text.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    const label = line.match(LOCATION_LABEL);
    const value = label && (label[1].trim() || bulletsAfter(lines, index));
    if (value && !NUMERIC_FACT.test(value)) {
      return value;
    }
  }
  return text
    .match(PINNED_LINES)
    ?.map((line) =>
      line
        .replace(/^\s*📍\s*/u, '')
        .split(PIN_END)[0]
        .trim()
    )
    .find((line) => namesPlace(line));
}

// The place a card's location slot names: "Location: North" gives "North",
// and a slot holding another fact gives none.
export function cardLocation(value) {
  const slot = String(value || '').trim();
  const place = (slot.match(LOCATION_LABEL)?.[1] ?? slot).trim();
  return place && !NUMERIC_FACT.test(place) ? place : undefined;
}

function detectLocation(text, fields, hint) {
  const field = firstLabeledValue(fields, LOCATION_LABELS);
  const labeled =
    (!NUMERIC_FACT.test(field || '') && field) || labeledLocation(text);
  if (labeled) {
    return {
      location: trimTrailingCharacters(labeled.trim(), '.,;!').trim(),
      method: 'labeled-text',
    };
  }
  const place = nhaTrangPlace(text, { hint });
  return place
    ? { location: place, method: 'gazetteer' }
    : { location: undefined, method: 'not-mentioned' };
}

function trimTrailingUrlPunctuation(value) {
  return trimTrailingCharacters(value, '.,;!?');
}

function officialUrl(text) {
  const officialLabel =
    /(?:official(?:\s+(?:website|site))?|property\s+(?:website|site)|website|trang\s*(?:web\s*)?chính\s*thức|официальн\p{L}*\s+сайт)\s*[:：-]/iu;
  for (const line of text.split(/\r?\n/u)) {
    const label = line.match(officialLabel);
    if (!label) {
      continue;
    }
    const value = line.slice((label.index || 0) + label[0].length);
    for (const match of value.matchAll(/https?:\/\/[^\s<>()]+/giu)) {
      const candidate = trimTrailingUrlPunctuation(match[0]);
      const canonical = canonicalizeUrl(candidate);
      if (
        canonical &&
        !/^https?:\/\/(?:t|telegram)\.me(?:\/|$)/iu.test(canonical)
      ) {
        return canonical;
      }
    }
  }
  return undefined;
}

export function parseListingText(
  value = '',
  { locationHint, referenceDate, price } = {}
) {
  const text = String(value);
  const fields = parseLabeledFields(text);
  const { location, method } = detectLocation(text, fields, locationHint);
  const layout = selectedRentalLayout(text, price);
  return {
    attributes: extractAttributes(text, fields, referenceDate, layout.bedrooms),
    contacts: extractContacts(text),
    kind: layout.kind,
    language: detectListingLanguage(text),
    location,
    locationProvenance: { method, source: 'message-text' },
    officialUrl: officialUrl(text),
  };
}
