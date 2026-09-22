import { parseListingText } from './listing-parser.js';
import { normalizeOffer } from './offers.js';
import { firstPresent } from './utils.js';

function twoMonthsBefore(date) {
  const cutoff = new Date(date);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 2);
  return cutoff;
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
  const details = parseListingText(text);
  return normalizeOffer(
    {
      sourceId: firstPresent(
        message.sourceId,
        `telegram:${firstPresent(username, 'unknown')}`
      ),
      sourceType: 'telegram',
      title,
      text,
      kind: details.kind,
      location: details.location,
      attributes: details.attributes,
      contacts: details.contacts,
      officialUrl: details.officialUrl,
      url: messageUrl(message, username),
      photos: firstPresent(message.photos, []),
      postedAt,
      raw: message,
    },
    { now, rates: options.rates }
  );
}
