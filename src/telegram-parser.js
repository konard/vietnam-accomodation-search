import { classifyTelegramPost } from './telegram-pipeline.js';
import { telegramHistoryWindow } from './telegram-window.js';
import { parseListingText } from './listing-parser.js';
import { normalizeOffer } from './offers.js';
import { firstPresent } from './utils.js';
import { chronologyTimestamp } from './offer-chronology.js';
import { telegramEntityEvidence } from './telegram-text-entities.js';

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

// eslint-disable-next-line complexity -- Original text, linked contacts and inherited location retain distinct evidence.
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
  const targets = telegramEntityEvidence(message);
  const linked = parseListingText(
    targets
      .map(
        ({ target }) => `Contact: ${target.replace(/^(?:mailto:|tel:)/iu, '')}`
      )
      .join('\n')
  );
  for (const [method, values] of Object.entries(linked.contacts)) {
    details.contacts[method] = [
      ...new Set([...details.contacts[method], ...values]),
    ];
  }
  details.officialUrl ||= targets
    .filter(
      ({ context }) =>
        /(?:official(?:\s+(?:website|site))?|property\s+(?:website|site)|trang\s*(?:web\s*)?chính\s*thức|официальн\p{L}*\s+сайт)/iu.test(
          context
        ) && !/agency|агентств/iu.test(context)
    )
    .map(
      ({ context, target }) =>
        parseListingText(`${context}: ${target}`).officialUrl
    )
    .find(Boolean);
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
      updatedAt: chronologyTimestamp(message.editDate ?? message.edit_date)
        ? new Date(chronologyTimestamp(message.editDate ?? message.edit_date))
        : undefined,
      raw: message,
    },
    { now, rates: options.rates }
  );
}
