// Sanitized observed market-guide grammar; no account or network operations.
import assert from 'node:assert/strict';
import { classifyTelegramPost } from '../src/telegram-pipeline.js';
const text =
  'Сколько стоит аренда в Нячанге? Октябрь 2026.\nХватит сказок про студии за 4 млн.\nСевер / Центр — 6,5 - 9.5 млн';
const result = classifyTelegramPost(text);
console.log(JSON.stringify({ marketGuideAdmittedAsOffer: result.eligible }));
assert.equal(
  result.eligible,
  false,
  'A price guide, including a negated cheap-price example, is not a specific rental offer.'
);
