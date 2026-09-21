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
      location: detectLocation(text),
      url,
      photos: firstPresent(message.photos, []),
      postedAt,
      raw: message,
    },
    { now, rates: options.rates }
  );
}
