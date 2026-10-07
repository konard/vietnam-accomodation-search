import { classifyTelegramPost } from './telegram-pipeline.js';
import { telegramHistoryWindow } from './telegram-window.js';
import { parseListingText } from './listing-parser.js';
import { normalizeOffer } from './offers.js';
import { firstPresent } from './utils.js';

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
  const { now, since } = telegramHistoryWindow(options);
  const postedAt = postedDate(message);
  if (!Number.isFinite(postedAt.getTime()) || postedAt < since) {
    return null;
  }

  const text = firstPresent(message.text, message.caption, '');
  if (
    classifyTelegramPost(text, { targetLocation: null }).reason ===
    'non-housing-rental'
  ) {
    return null;
  }
  const title = text
    .split(/\r?\n/u)
    .find((line) => line.trim())
    ?.trim();
  if (!title) {
    return null;
  }

  const username = message.chat?.username;
  const details = parseListingText(text, {
    locationHint: message.inheritedLocation,
    referenceDate: postedAt,
  });
  const location = details.location || message.inheritedLocation;
  const locationProvenance = details.location
    ? details.locationProvenance
    : message.inheritedLocation
      ? {
          method: 'source-inherited',
          source: message.inheritedLocationSource || message.sourceId,
        }
      : details.locationProvenance;
  return normalizeOffer(
    {
      sourceId: firstPresent(
        message.sourceId,
        `telegram:${firstPresent(username, 'unknown')}`
      ),
      sourceType: 'telegram',
      title,
      text,
      intent: 'rental-offer',
      kind: details.kind,
      location,
      locationProvenance,
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
