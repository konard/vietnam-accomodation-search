import { normalizeOffer } from './offers.js';
import { firstPresent } from './utils.js';

function twoMonthsBefore(date) {
  const cutoff = new Date(date);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 2);
  return cutoff;
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

function detectLocation(text) {
  const match = text.match(
    /(?:address|location|địa\s*chỉ|адрес)\s*:\s*([^\n\r]+)/iu
  );
  return match?.[1]?.trim();
}

function labeledFields(text) {
  const fields = {};
  for (const line of text.split(/\r?\n/u)) {
    const separator = line.indexOf(':');
    if (separator < 1 || separator > 60) {
      continue;
    }
    const label = line
      .slice(0, separator)
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .trim()
      .toLocaleLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!label || !value) {
      continue;
    }
    fields[label] = [...(fields[label] || []), value];
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
  const telegram = new Set();
  const phone = new Set();
  for (const line of text.split(/\r?\n/u)) {
    for (const match of line.matchAll(/@([A-Za-z][A-Za-z\d_]{4,31})/gu)) {
      telegram.add(match[1]);
    }
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
  return { phone: [...phone], telegram: [...telegram] };
}

function extractAmenities(text) {
  const candidates = [
    ['balcony', /balcony|балкон|ban\s*công/iu],
    ['pool', /pool|бассейн|hồ\s*bơi/iu],
    ['sea-view', /sea\s*view|вид\s*на\s*море|view\s*biển/iu],
    ['parking', /parking|парковк|bãi\s*đỗ/iu],
  ];
  return candidates
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
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

function extractAttributes(text, fields) {
  const propertyId = text.match(
    /(?:\bID|код|mã)\s*[#:№-]?\s*([A-ZА-Я]?\d{1,12})/iu
  )?.[1];
  const bedrooms = matchedNumber(text, [
    /(\d{1,2})\s*(?:bedrooms?|спальн\p{L}*|phòng\s*ngủ)/iu,
  ]);
  const bathrooms = matchedNumber(text, [
    /(\d{1,2})\s*(?:bathrooms?|сануз\p{L}*|phòng\s*tắm)/iu,
  ]);
  const areaM2 = matchedNumber(text, [
    /(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:m²|m2|м²|кв\.?\s*м)/iu,
  ]);
  const floor = matchedNumber(text, [
    /(?:floor|этаж|tầng)\s*[:#-]?\s*(\d{1,3})/iu,
    /(\d{1,3})\s*(?:floor|этаж)/iu,
  ]);
  const minimumStayMonths = matchedNumber(text, [
    /(?:minimum|аренд\p{L}*\s+от|tối\s*thiểu)\D{0,24}(\d{1,3})\s*(?:months?|месяц\p{L}*|tháng)/iu,
    /(?:hợp\s*đồng)\D{0,24}(\d{1,3})\s*tháng/iu,
  ]);
  const depositMonths = matchedNumber(text, [
    /(?:deposit|депозит|đặt\s*cọc)\D{0,16}(\d{1,3})\s*(?:months?|месяц\p{L}*|tháng)/iu,
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
  const district = firstLabeledValue(fields, [
    'district',
    'район',
    'khu vực',
    'quận',
  ]);

  return definedProperties({
    propertyId,
    bedrooms,
    bathrooms,
    areaM2,
    floor,
    district,
    availableFrom: isoDate(text),
    minimumStayMonths,
    depositMonths,
    furnished,
    petsAllowed,
    amenities: extractAmenities(text),
    labeledFields: fields,
  });
}

function postedDate(message) {
  const value =
    typeof message.date === 'number' ? message.date * 1000 : message.date;
  return new Date(value);
}

function messageUrl(message, username) {
  if (message.url) {
    return message.url;
  }
  return username && message.messageId
    ? `https://t.me/${username}/${message.messageId}`
    : undefined;
}

export function parseTelegramOffer(message, options = {}) {
  const now = firstPresent(options.now, new Date());
  const postedAt = postedDate(message);
  if (!Number.isFinite(postedAt.getTime()) || postedAt < twoMonthsBefore(now)) {
    return null;
  }

  const text = firstPresent(message.text, message.caption, '');
  const title = text
    .split(/\r?\n/u)
    .find((line) => line.trim())
    ?.trim();
  if (!title) {
    return null;
  }

  const username = message.chat?.username;
  const url = messageUrl(message, username);
  const fields = labeledFields(text);
  const location = firstLabeledValue(fields, [
    'address',
    'location',
    'địa chỉ',
    'адрес',
  ]);

  return normalizeOffer(
    {
      sourceId: firstPresent(
        message.sourceId,
        `telegram:${firstPresent(username, 'unknown')}`
      ),
      sourceType: 'telegram',
      title,
      text,
      kind: detectKind(text),
      location: firstPresent(location, detectLocation(text)),
      attributes: extractAttributes(text, fields),
      contacts: extractContacts(text),
      url,
      photos: firstPresent(message.photos, []),
      postedAt,
      raw: message,
    },
    { now, rates: options.rates }
  );
}
