import { parsePrice, rentalPriceOptions } from './pricing.js';
import { mediaIdentity } from './offer-bounds.js';

export { mediaIdentity };

const REQUEST =
  /\b(?:looking\s+for|wanted|need(?:ed)?|seeking)\b|(?<!\p{L})(?:ищу|сниму)(?!\p{L})|хочу\s+(?:взять|снять)|cần\s+(?:tìm|thuê)/iu;
const SALE =
  /\b(?:for\s+sale|selling|sell)\b|прода(?:ю|м|[её]тся)|продаж[аи]|будущ\p{L}*\s+владел\p{L}*|bán\s+(?:căn|nhà|đất|phòng)|sang\s+nhượng|買賣|买卖|預售|预售|價格[^\n]*美金\/平米|單價|单价|出售|[轉转]售|售[價价]|[萬万]美[金元]/iu;
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

// Explicit location fields identify the property. View, transport, travel and
// agency navigation lines describe amenities and services.
function propertyLocationText(text) {
  const lines = text
    .split(/\r?\n/u)
    .filter(
      (line) =>
        !/вид\s+на|view\s+(?:of|to)|trips?\s+to|transfer|трансфер|поездк|экскурси|agency|агентств|👉/iu.test(
          line
        )
    );
  const labeled = lines.find((line) =>
    /(?:location|address|локация|адрес|địa\s*chỉ|vị\s*trí)[ \t]*:/iu.test(line)
  );
  return labeled || lines.join('\n');
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
  const text = String(value || '').normalize('NFKC');
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
  if (
    targetLocation === 'nha-trang' &&
    OTHER_VIETNAM_CITY.test(propertyLocationText(text))
  ) {
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
    !PROPERTY.test(text) &&
    /motorbike|motorcycle|scooter|laptop|bicycle|мотоцикл|байк|скутер|велосипед|xe\s+máy/iu.test(
      text
    )
  ) {
    return {
      eligible: false,
      label: 'unrelated',
      reason: 'non-housing-rental',
    };
  }
  if (
    (PROPERTY.test(text) || /公寓|房/u.test(text)) &&
    (RENTAL.test(text) || PRICE.test(text) || BOOKING.test(text))
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
  return [...groups.values()].flatMap((members) => {
    members.sort(
      (left, right) => Number(messageId(left)) - Number(messageId(right))
    );
    const first = members[0];
    const groupedId = first.groupedId ?? first.grouped_id;
    const captionMap = new Map();
    for (const member of members) {
      const text = String(member.text || member.caption || '').trim();
      if (!text) {
        continue;
      }
      const entry = captionMap.get(text) || { text, messageIds: [] };
      entry.messageIds.push(messageId(member));
      captionMap.set(text, entry);
    }
    const captions = [...captionMap.values()];
    const independent = captions.filter(
      ({ text }) =>
        classifyTelegramPost(text, { targetLocation: null }).eligible &&
        parsePrice(text)
    );
    const material = {
      ...first,
      id:
        groupedId === undefined
          ? `telegram-message:${chatId(first)}:${String(messageId(first))}`
          : `telegram-album:${chatId(first)}:${String(groupedId)}`,
      text: captions.map(({ text }) => text).join('\n'),
      captions,
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
    if (independent.length > 1) {
      return captions.map((caption) => ({
        ...material,
        id: `${material.id}:caption:${caption.messageIds[0]}`,
        text: caption.text,
        date: members.find(
          (member) => messageId(member) === caption.messageIds[0]
        ).date,
        url: members.find(
          (member) => messageId(member) === caption.messageIds[0]
        ).url,
        messageId: caption.messageIds[0],
        captionMessageIds: caption.messageIds,
      }));
    }
    material.captionConflict =
      captions.length > 1 &&
      captions.some(({ text }) =>
        /^(?:request|sale|service|commercial)$/u.test(
          classifyTelegramPost(text, { targetLocation: null }).label
        )
      );
    return [material];
  });
}

// eslint-disable-next-line complexity -- Reconciliation accounts explicitly for every media, classification, OCR, and extraction terminal state.
export async function reconcileTelegramMaterials(
  messages,
  { extract, maxOcrPhotos = 3, ocr, targetLocation = 'nha-trang' } = {}
) {
  const accepted = [];
  let eligibleAttempts = 0;
  const reviewQueue = [];
  for (const material of assembleTelegramAlbums(messages)) {
    if (material.captionConflict) {
      reviewQueue.push({
        id: material.id,
        reason: 'conflicting-album-captions',
        state: 'review',
        captions: material.captions,
      });
      continue;
    }
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
      const extraction = [];
      try {
        for (const mediaId of material.mediaIds.slice(0, maxOcrPhotos)) {
          const result = await ocr(mediaId, { material });
          const fragment = typeof result === 'string' ? result : result?.text;
          fragments.push(fragment);
          extraction.push({
            mediaId,
            status: result?.status || (fragment ? 'extracted' : 'unreadable'),
            confidence: result?.confidence,
            engine: result?.engine,
          });
        }
        text = fragments.filter(Boolean).join('\n');
        ocrState = 'completed';
        material.mediaExtraction = extraction;
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
    if (
      ocrState === 'completed' &&
      (!/for\s+rent|rent|lease|аренд|сда[её]т|cho\s+thuê/iu.test(text) ||
        !rentalPriceOptions(text).some(
          (option) => option.rent || option.period
        ))
    ) {
      reviewQueue.push({
        id: material.id,
        reason: 'ocr-rental-evidence-insufficient',
        state: 'review',
        mediaExtraction: material.mediaExtraction,
      });
      continue;
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
    eligibleAttempts += 1;
    const reconciled = { ...material, ocrState, relevance, text };
    try {
      const extracted = extract ? await extract(reconciled) : reconciled;
      if (extracted) {
        if (ocrState === 'completed') {
          extracted.attributes = {
            ...extracted.attributes,
            reviewRequired: true,
          };
          reviewQueue.push({
            id: material.id,
            reason: 'ocr-fields-unverified',
            state: 'review',
            accepted: true,
            mediaExtraction: material.mediaExtraction,
          });
        }
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
    eligibleAttempts,
    complete: reviewQueue.every(({ state }) => state === 'excluded'),
    reviewQueue,
  };
}
