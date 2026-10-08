// Self-authored hidden contact link. No account is messaged or resolved.
import assert from 'node:assert/strict';
import { normalizeMtcuteMessage, parseTelegramOffer } from '../src/index.js';

const text =
  'Studio for rent in Nha Trang 13 million VND / month\nContact agent';
const source = { id: 'telegram:qa_fixture' };
const message = normalizeMtcuteMessage(
  {
    id: 1,
    date: new Date(),
    chat: { username: 'qa_fixture' },
    text,
    raw: {
      entities: [
        {
          _: 'messageEntityTextUrl',
          offset: text.indexOf('Contact agent'),
          length: 13,
          url: 'https://t.me/qa_agent_fixture',
        },
      ],
    },
  },
  source
);
const visible = parseTelegramOffer({
  ...message,
  text: `${text} https://t.me/qa_agent_fixture`,
});
assert(
  visible.contacts.telegram.includes('qa_agent_fixture'),
  'Visible-link parser control must work.'
);
const hidden = parseTelegramOffer(message);
const pass = hidden.contacts.telegram.includes('qa_agent_fixture');
console.log(
  JSON.stringify({
    visibleContact: true,
    hiddenContact: pass,
    entitiesRetained: Boolean(message.entities),
    pass,
  })
);
assert(
  pass,
  'A hidden Telegram contact URL must survive normalization and extraction.'
);
