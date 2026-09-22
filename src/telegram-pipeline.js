const REQUEST =
  /\b(?:looking\s+for|wanted|need(?:ed)?|seeking)\b|ищу|cần\s+(?:tìm|thuê)/iu;
const SALE =
  /\b(?:for\s+sale|selling|sell)\b|продам|продаж[аи]|bán\s+(?:căn|nhà|đất|phòng)/iu;
const SERVICE =
  /\b(?:visa|immigration|cleaning|moving|brokerage)\s+service\b|dịch\s+vụ|визов\p{L}*\s+услуг/iu;
const RENTAL =
  /\b(?:for\s+rent|rent(?:al|ing)?|lease)\b|аренд\p{L}*|сда[её]т|cho\s+thuê|thuê\s+(?:nhà|phòng|căn)/iu;
const PROPERTY =
  /apartment|studio|room|house|villa|hotel|căn\s+hộ|phòng|nhà|квартир|комнат|вилл/iu;
const PRICE = /(?:VND|VNĐ|₫|USD|EUR|GBP|triệu|million|tỷ|\$|€|£)/iu;
const OTHER_VIETNAM_CITY =
  /da\s*nang|đà\s*nẵng|hanoi|hà\s*nội|ho\s*chi\s*minh|hồ\s*chí\s*minh|saigon|sài\s*gòn|phu\s*quoc|phú\s*quốc|далат|дананг|ханой/iu;
const NON_HOUSING_SERVICE =
  /sim[-\s]*card|sim-карт|currency\s+exchange|обмен\s+валют/iu;

export const TELEGRAM_LABELS = new Set([
  'offer',
  'request',
  'sale',
  'unrelated',
  'wrong-location',
  'duplicate',
  'service',
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
  if (SERVICE.test(text) || NON_HOUSING_SERVICE.test(text)) {
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
  if (RENTAL.test(text) || (PROPERTY.test(text) && PRICE.test(text))) {
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

function mediaIdentity(message) {
  return (
    message.mediaId ??
    message.media?.id ??
    message.media ??
    message.photo?.id ??
    message.document?.id ??
    message.photos?.[0]
  );
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
      mediaIds: [...new Set(members.map(mediaIdentity).filter(Boolean))].slice(
        0,
        10
      ),
      members,
    };
  });
}

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
    accepted.push(extract ? await extract(reconciled) : reconciled);
  }
  return {
    accepted: accepted.filter(Boolean),
    complete: reviewQueue.every(({ state }) => state === 'excluded'),
    reviewQueue,
  };
}
