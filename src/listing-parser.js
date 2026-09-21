import { canonicalizeUrl } from './utils.js';

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

function isoDate(text) {
  const match = text.match(
    /(?:свобод\p{L}*|available|доступ\p{L}*|có\s*sẵn)[^\d]{0,24}(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/iu
  );
  if (!match) {
    return undefined;
  }
  const year = Number(match[3]) + (match[3].length === 2 ? 2000 : 0);
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

function extractAttributes(text, fields) {
  const propertyId = text.match(
    /(?:\bID|код|mã)\s{0,8}[#:№-]?\s{0,8}([\p{L}\d][\p{L}\d_-]{0,31})/iu
  )?.[1];
  const studio = /\bstudio\b|студи\p{L}*|căn\s*hộ\s*studio/iu.test(text);
  const bedrooms = studio
    ? 0
    : matchedNumber(text, [
        /(\d{1,2})\s*(?:bedrooms?|спальн\p{L}*|phòng\s*ngủ)/iu,
        /(?:bedrooms?|спальн\p{L}*|phòng\s*ngủ)\s{0,8}[:#-]?\s{0,8}(\d{1,2})/iu,
      ]);
  const bathrooms = matchedNumber(text, [
    /(\d{1,2})\s*(?:bathrooms?|сануз\p{L}*|phòng\s*tắm)/iu,
    /(?:bathrooms?|сануз\p{L}*|phòng\s*tắm)\s{0,8}[:#-]?\s{0,8}(\d{1,2})/iu,
  ]);
  const beds = matchedNumber(text, [
    /(?:\bbeds?|кроват\p{L}*|giường)\s{0,8}[:#-]?\s{0,8}(\d{1,2})/iu,
    /(\d{1,2})\s*(?:beds?|кроват\p{L}*|giường)/iu,
  ]);
  const guests = matchedNumber(text, [
    /(?:guests?|гост\p{L}*|khách)\s{0,8}[:#-]?\s{0,8}(\d{1,3})/iu,
    /(\d{1,3})\s*(?:guests?|гост\p{L}*|khách)/iu,
  ]);
  const areaM2 = matchedNumber(text, [
    /(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:m²|m2|м²|кв\.?\s*м)/iu,
  ]);
  const floor = matchedNumber(text, [
    /(?:floor|этаж|tầng)\s{0,8}[:#-]?\s{0,8}(\d{1,3})/iu,
    /(\d{1,3})\s*(?:floor|этаж)/iu,
  ]);
  const minimumStayMonths = matchedNumber(text, [
    /(?:minimum|аренд\p{L}*\s+от|tối\s*thiểu)\D{0,24}(\d{1,3})\s*(?:months?|месяц\p{L}*|tháng)/iu,
    /(?:hợp\s*đồng)\D{0,24}(\d{1,3})\s*tháng/iu,
  ]);
  const depositMonths = matchedNumber(text, [
    /(?:deposit|депозит|đặt\s*cọc)\D{0,16}(\d{1,3})\s*(?:months?|месяц\p{L}*|tháng)/iu,
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
    /pets?\s*(?:allowed|welcome)|можно\s*с\s*животн|cho\s*phép\s*thú\s*cưng/iu,
    /no\s*pets|без\s*животн|không\s*(?:cho\s*phép\s*)?thú\s*cưng/iu
  );
  const utilitiesIncluded = matchedBoolean(
    text,
    /utilities\s+included|коммунальн\p{L}*\s+включен|đã\s*bao\s*gồm\s*(?:điện|nước|tiện\s*ích)/iu,
    /utilities\s+not\s+included|коммунальн\p{L}*\s+не\s+включен|chưa\s*bao\s*gồm\s*(?:điện|nước|tiện\s*ích)/iu
  );

  return definedProperties({
    propertyId,
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
    availableFrom: isoDate(text),
    minimumStayMonths,
    depositMonths,
    furnished,
    petsAllowed,
    utilitiesIncluded,
    agencyFeePercent,
    rating,
    reviewCount,
    checkIn: timeValue(text, 'check[- ]?in|заезд|nhận\\s*phòng'),
    checkOut: timeValue(text, 'check[- ]?out|выезд|trả\\s*phòng'),
    ...coordinates(text),
    amenities: extractAmenities(text),
    labeledFields: fields,
  });
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

function detectLocation(text, fields) {
  return (
    firstLabeledValue(fields, ['address', 'location', 'địa chỉ', 'адрес']) ||
    text
      .match(/(?:address|location|địa\s*chỉ|адрес)\s*:\s*([^\n\r]+)/iu)?.[1]
      ?.trim()
  );
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
      const candidate = match[0].replace(/[.,;!?]+$/u, '');
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

export function parseListingText(value = '') {
  const text = String(value);
  const fields = parseLabeledFields(text);
  return {
    attributes: extractAttributes(text, fields),
    contacts: extractContacts(text),
    kind: detectKind(text),
    location: detectLocation(text, fields),
    officialUrl: officialUrl(text),
  };
}
