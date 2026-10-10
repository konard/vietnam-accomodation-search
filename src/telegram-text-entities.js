// Keep parsing metadata without sender objects or custom emoji documents.
const KINDS = {
  messageEntityTextUrl: 'text_link',
  messageEntityUrl: 'url',
  messageEntityMention: 'mention',
  messageEntityEmail: 'email',
  messageEntityPhone: 'phone_number',
};
const SUPPORTED = new Set(Object.values(KINDS));

function splitsSurrogate(text, offset) {
  return (
    offset > 0 &&
    /[\uD800-\uDBFF]/u.test(text[offset - 1]) &&
    /[\uDC00-\uDFFF]/u.test(text[offset] || '')
  );
}

export function normalizeTextEntities(text, entities = []) {
  if (typeof text !== 'string' || !Array.isArray(entities)) {
    return [];
  }
  const spans = [];
  // eslint-disable-next-line complexity -- Each untrusted scalar and UTF-16 boundary is validated independently.
  return entities.slice(0, 100).flatMap((entity) => {
    const raw = entity?.raw || entity || {};
    const type = KINDS[raw._] || raw.type || entity?.kind;
    const { offset, length } = raw;
    if (
      !SUPPORTED.has(type) ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 1 ||
      offset + length > text.length ||
      splitsSurrogate(text, offset) ||
      splitsSurrogate(text, offset + length)
    ) {
      return [];
    }
    if (
      type === 'text_link' &&
      (typeof raw.url !== 'string' ||
        raw.url.length > 2048 ||
        !/^(?:https?:\/\/|mailto:|tel:)/iu.test(raw.url))
    ) {
      return [];
    }
    if (spans.some(([start, end]) => offset < end && offset + length > start)) {
      return [];
    }
    spans.push([offset, offset + length]);
    return [
      {
        type,
        offset,
        length,
        ...(type === 'text_link' ? { url: raw.url } : {}),
      },
    ];
  });
}

export function telegramEntityEvidence(message) {
  const captions = new Set((message.captionMessageIds || []).map(String));
  const members = (message.members || [message]).filter(
    (member) => !captions.size || captions.has(String(member.id))
  );
  return members
    .flatMap((member) => {
      const text = member.text || member.caption || '';
      return normalizeTextEntities(
        text,
        member.entities || member.caption_entities || member.raw?.entities
      ).map((entity) => ({
        target:
          entity.url ||
          text.slice(entity.offset, entity.offset + entity.length),
        // An explicit label on this same line can identify an official target.
        context: text.slice(
          text.lastIndexOf('\n', entity.offset - 1) + 1,
          entity.offset + entity.length
        ),
      }));
    })
    .slice(0, 100);
}
