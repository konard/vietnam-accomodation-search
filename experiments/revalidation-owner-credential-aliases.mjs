// Existing QA recognizes legacy credential names; the owner operator must
// not discard them before it authenticates. Self-authored, no network.
import assert from 'node:assert/strict';
import { userCredentials } from './telegram-bot-conversation-e2e.mjs';
import { resolveTelegramSecrets } from '../src/telegram-auth.js';

const environment = {
  TELEGRAM_USER_BOT_API_ID: '123',
  TELEGRAM_USER_BOT_API_HASH: 'self-authored-hash',
  TELEGRAM_USER_SESSION: 'self-authored-session',
};
const qa = await userCredentials(environment);
const operator = await resolveTelegramSecrets(environment);
const qaRecognizesCredentials = Boolean(qa.apiId && qa.apiHash && qa.session);
const operatorRecognizesCredentials = Boolean(
  operator.apiId && operator.apiHash && operator.session
);
console.log(
  JSON.stringify({
    qaRecognizesCredentials,
    operatorRecognizesCredentials,
    pass: qaRecognizesCredentials && operatorRecognizesCredentials,
  })
);
assert(qaRecognizesCredentials, 'Existing credential-name control must work.');
assert(
  operatorRecognizesCredentials,
  'The owner operator drops already-supported credential names.'
);
