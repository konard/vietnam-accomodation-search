// Sanitized actual reply grammar; no account, network or Docker acquisition.
import assert from 'node:assert/strict';
import { isKnownQaMessage, QaOwnedMessages } from './qa-owned-messages.mjs';

const marker = 'qa-drill-00000000';
const text =
  'Preset drill-00000000-165 does not exist.\nUsage: /preset list|show NAME|save NAME [SEARCH OPTIONS]|use NAME|delete NAME';
const ledger = new QaOwnedMessages({ marker, baseline: 100 });
const reply = { id: 102, className: 'Message', message: text };
assert(isKnownQaMessage(`${marker}\n${text}`));
assert(ledger.owns({ ...reply, message: `${marker}\n${text}` }));
const auditRecognizesReply = isKnownQaMessage(text);
const ledgerRecognizesReply = ledger.owns(reply);
console.log(
  JSON.stringify({
    sanitizedActualReplyGrammar: true,
    auditRecognizesReply,
    ledgerRecognizesReply,
    noExternalResources: true,
  })
);
assert(
  auditRecognizesReply,
  'The read-only audit must recognize the unprefixed cutover reply grammar.'
);
