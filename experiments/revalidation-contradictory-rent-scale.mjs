// Sanitized actual source quote grammar; no credentials or network.
import assert from 'node:assert/strict';
import { parseTelegramOffer } from '../src/telegram-parser.js';
const text =
  '🔥 2BR в Oceanus | 2 мин до моря | 15 млн\nСдаётся квартира в Нячанге\n💰 15 VND / мес\n💵 Депозит - 1 месяц';
const offer = parseTelegramOffer({
  text,
  date: new Date().toISOString(),
  messageId: 1,
  chat: { username: 'qa_public_example' },
});
assert(offer);
const contradictoryScaleExcluded = offer.attributes?.reviewRequired === true;
console.log(
  JSON.stringify({
    sanitizedActualQuoteGrammar: true,
    selectedLiteralRentIsBelowOneHundredVnd: offer.priceVnd < 100,
    contradictoryScaleExcluded,
  })
);
assert(
  contradictoryScaleExcluded,
  'Contradictory million/literal-VND rent must be excluded pending review, not silently ranked as a tiny monthly rent.'
);
