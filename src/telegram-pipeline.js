import { mediaIdentity } from './offer-bounds.js';

export { mediaIdentity };

const REQUEST =
  /\b(?:looking\s+for|wanted|need(?:ed)?|seeking)\b|ищу|cần\s+(?:tìm|thuê)/iu;
const SALE =
  /\b(?:for\s+sale|selling|sell)\b|прода(?:м|[её]тся)|продаж[аи]|будущ\p{L}*\s+владел\p{L}*|bán\s+(?:căn|nhà|đất|phòng)|sang\s+nhượng|出售|[轉转]售|售[價价]|[萬万]美[金元]/iu;
// "Căn hộ dịch vụ" is a serviced apartment, not a service advertisement.
const SERVICE =
  /\b(?:visa|immigration|cleaning|moving|brokerage)\s+service\b|(?<!(?:căn\s+hộ|phòng|nhà)\s+)dịch\s+vụ|визов\p{L}*\s+услуг/iu;
const RENTAL =
  /\b(?:for\s+rent|rent(?:al|ing)?|lease)\b|аренд\p{L}*|сда[её]т|cho\s+thuê|thuê\s+(?:nhà|phòng|căn)|出租|租金/iu;
const PROPERTY =
  /apartment|studio|room|house|villa|hotel|bedroom|\d\s*(?:BR|BHK|PN)\b|căn\s+hộ|phòng|nhà|квартир|комнат|вилл|студи|спальн|(?<!\p{L})дом(?!\p{L})/iu;
const PRICE =
  /(?:VND|VNĐ|₫|USD|EUR|GBP|triệu|million|tỷ|\$|€|£|млн|млрд|美元|美金|越盾)/iu;
const BOOKING = /бронирован\p{L}*|\bbooking\b|đặt\s+phòng/iu;
const OTHER_VIETNAM_CITY =
  /da\s*nang|đà\s*nẵng|hanoi|hà\s*nội|ho\s*chi\s*minh|hồ\s*chí\s*minh|saigon|sài\s*gòn|phu\s*quoc|phú\s*quốc|далат|дананг|ханой/iu;
const NON_HOUSING_SERVICE =
  /sim[-\s]*card|sim-карт|currency\s+exchange|обмен\s+валют/iu;
const COMMERCIAL =
  /cho\s+thuê\s+mặt\s*bằng|mặt\s*bằng\s+kinh\s+doanh|\bMBKD\b|коммерческ\p{L}*\s+помещени\p{L}*|только\s+для\s+(?:легального\s+|чистого\s+)?бизнеса|(?:отел\p{L}*|hotel|khách\s*sạn)\s+(?:на\s+)?\d+\s*(?:номер\p{L}*|rooms|phòng)|комплекс\p{L}*\s+бунгало|店面|辦公室|办公室/iu;

// The headline of a rental post decides its intent; agencies append service
// adverts such as currency exchange below the listing.
function headline(text) {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .slice(0, 3)
    .join('\n');
}

function advertisesService(text) {
  return (
    (SERVICE.test(text) || NON_HOUSING_SERVICE.test(text)) &&
    !RENTAL.test(headline(text))
  );
}

export const TELEGRAM_LABELS = new Set([
  'offer',
  'request',
  'sale',
  'unrelated',
  'wrong-location',
  'duplicate',
  'service',
  'commercial',
  'uncertain',
]);

// eslint-disable-next-line complexity -- The classifier deliberately enumerates mutually exclusive corpus labels.
export function classifyTelegramPost(
  value,
  { duplicate = false, targetLocation = 'nha-trang' } = {}
) {
  const text = String(value || '').normalize('NFC');
  if (duplicate) {
    return {
      eligible: false,
      label: 'duplicate',
      reason: 'stable-identity-already-seen',
    };
  }
  if (REQUEST.test(text)) {
    return {
      eligible: false,
      label: 'request',
      reason: 'seeking-accommodation',
    };
  }
  if (SALE.test(text)) {
    return { eligible: false, label: 'sale', reason: 'sale-intent' };
  }
  if (advertisesService(text)) {
    return {
      eligible: false,
      label: 'service',
      reason: 'service-advertisement',
    };
  }
  if (targetLocation === 'nha-trang' && OTHER_VIETNAM_CITY.test(text)) {
    return {
      eligible: false,
      label: 'wrong-location',
      reason: 'explicit-other-city',
    };
  }
  if (COMMERCIAL.test(text)) {
    return {
      eligible: false,
      label: 'commercial',
      reason: 'commercial-premises',
    };
  }
  if (
    RENTAL.test(text) ||
    (PROPERTY.test(text) && (PRICE.test(text) || BOOKING.test(text)))
  ) {
    return { eligible: true, label: 'offer', reason: 'rental-evidence' };
  }
  if (PROPERTY.test(text) || PRICE.test(text)) {
    return {
      eligible: false,
      label: 'uncertain',
      reason: 'insufficient-rental-evidence',
    };
  }
  return {
    eligible: false,
    label: 'unrelated',
    reason: 'no-accommodation-evidence',
  };
}

function editTimestamp(message) {
  const value = message.editDate ?? message.edit_date ?? 0;
  const parsed =
    typeof value === 'string' ? new Date(value).getTime() : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function messageId(message) {
  return message.id ?? message.messageId;
}

function chatId(message) {
  return message.chatId ?? message.chat?.id ?? message.sourceId ?? 'unknown';
}

export function assembleTelegramAlbums(messages) {
  const latest = new Map();
  for (const message of messages) {
    const key = `${chatId(message)}:${String(messageId(message))}`;
    const previous = latest.get(key);
    if (!previous || editTimestamp(message) >= editTimestamp(previous)) {
      latest.set(key, message);
    }
  }
  const groups = new Map();
  for (const message of latest.values()) {
    if (message.deleted) {
      continue;
    }
    const groupedId = message.groupedId ?? message.grouped_id;
    const key =
      groupedId === undefined
        ? `${chatId(message)}:message:${String(messageId(message))}`
        : `${chatId(message)}:album:${String(groupedId)}`;
    groups.set(key, [...(groups.get(key) || []), message]);
  }
  return [...groups.values()].map((members) => {
    members.sort(
      (left, right) => Number(messageId(left)) - Number(messageId(right))
    );
    const first = members[0];
    const groupedId = first.groupedId ?? first.grouped_id;
    const texts = members
      .map((message) => message.text || message.caption)
      .filter((text) => String(text || '').trim());
    return {
      ...first,
      id:
        groupedId === undefined
          ? `telegram-message:${chatId(first)}:${String(messageId(first))}`
          : `telegram-album:${chatId(first)}:${String(groupedId)}`,
      text: texts[0] || '',
      messageIds: members.map(messageId),
      // Scalar IDs only: provider media objects carry bytes (#82).
      mediaIds: [
        ...new Set(
          members
            .map(mediaIdentity)
            .filter((identity) => identity !== undefined)
        ),
      ].slice(0, 10),
      members,
    };
  });
}

// eslint-disable-next-line complexity -- Reconciliation accounts explicitly for every media, classification, OCR, and extraction terminal state.
export async function reconcileTelegramMaterials(
  messages,
  { extract, maxOcrPhotos = 3, ocr, targetLocation = 'nha-trang' } = {}
) {
  const accepted = [];
  const reviewQueue = [];
  for (const material of assembleTelegramAlbums(messages)) {
    let text = material.text;
    let ocrState = 'not-needed';
    if (!text.trim() && material.mediaIds.length) {
      if (!ocr) {
        reviewQueue.push({
          id: material.id,
          reason: 'photo-only-ocr-unavailable',
          state: 'degraded',
        });
        continue;
      }
      const fragments = [];
      try {
        for (const mediaId of material.mediaIds.slice(0, maxOcrPhotos)) {
          fragments.push(await ocr(mediaId));
        }
        text = fragments.filter(Boolean).join('\n');
        ocrState = 'completed';
      } catch (error) {
        reviewQueue.push({
          id: material.id,
          reason: 'photo-only-ocr-failed',
          state: 'degraded',
          error: error?.code || 'ocr-failure',
        });
        continue;
      }
    }
    const relevance = classifyTelegramPost(text, { targetLocation });
    if (!relevance.eligible) {
      reviewQueue.push({
        id: material.id,
        reason: relevance.reason,
        state: relevance.label === 'uncertain' ? 'review' : 'excluded',
      });
      continue;
    }
    const reconciled = { ...material, ocrState, relevance, text };
    try {
      const extracted = extract ? await extract(reconciled) : reconciled;
      if (extracted) {
        accepted.push(extracted);
      } else {
        reviewQueue.push({
          id: material.id,
          reason: 'offer-extraction-empty',
          state: 'error',
        });
      }
    } catch (error) {
      reviewQueue.push({
        id: material.id,
        reason: 'offer-extraction-failed',
        state: 'error',
        error: error?.code || 'parser-failure',
      });
    }
  }
  return {
    accepted: accepted.filter(Boolean),
    complete: reviewQueue.every(({ state }) => state === 'excluded'),
    reviewQueue,
  };
}
