// Loaded only by the conversation QA subprocess, before the application.
// Mark every API send (including scheduled notifications and album captions)
// and remove the incoming QA suffix before command parsing. Production code
// and ordinary invocations do not load this module.
import { Api } from 'grammy';
import { QaOwnedMessages } from './qa-owned-messages.mjs';

export function installQaApiBoundary({ marker, owner, journal }) {
  const ledger = new QaOwnedMessages({ marker, journal });
  const descriptor = Object.getOwnPropertyDescriptor(Api.prototype, 'config');
  Object.defineProperty(Api.prototype, 'config', {
    configurable: true,
    set(config) {
      Object.defineProperty(this, 'config', {
        configurable: true,
        writable: true,
        value: config,
      });
      ledger.install(this, owner);
      config.use(async (previous, method, payload, signal) => {
        const response = await previous(method, payload, signal);
        if (method === 'getUpdates' && response.ok) {
          for (const update of response.result) {
            if (
              String(update.message?.chat?.id) === String(owner) &&
              update.message?.text?.endsWith(`\n${marker}`)
            ) {
              update.message.text = update.message.text.slice(
                0,
                -marker.length - 1
              );
            }
          }
        }
        return response;
      });
    },
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(Api.prototype, 'config', descriptor);
    } else {
      delete Api.prototype.config;
    }
  };
}

if (process.env.VAC_QA_MARKER) {
  if (process.env.TELEGRAM_CONVERSATION_E2E !== '1') {
    throw new Error('QA preload requires the manual conversation boundary.');
  }
  installQaApiBoundary({
    marker: process.env.VAC_QA_MARKER,
    owner: process.env.VAC_QA_OWNER,
    journal: process.env.VAC_QA_JOURNAL,
  });
}
