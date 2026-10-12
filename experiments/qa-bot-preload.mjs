import { installCombinedProbes } from './qa-combined-probes.mjs';
// Loaded only by the conversation QA subprocess, before the application.
// Mark every API send (including scheduled notifications and album captions)
// and remove the incoming QA suffix before command parsing. Production code
// and ordinary invocations do not load this module.
import { Api } from 'grammy';
import { QaOwnedMessages } from './qa-owned-messages.mjs';

export function installQaApiBoundary({ marker, owner, journal }) {
  const ledger = new QaOwnedMessages({ marker, journal });
  const installed = new WeakSet();
  const attach = (api) => {
    if (installed.has(api)) {
      return;
    }
    ledger.install(api, owner);
    installed.add(api);
  };
  const key = Symbol.for('vac.qa.botBoundary');
  const previousBoundary = globalThis[key];
  globalThis[key] = (bot) => {
    attach(bot.api);
    bot.use((context, next) => {
      attach(context.api);
      if (
        String(context.chat?.id) === String(owner) &&
        context.message?.text?.endsWith(`\n${marker}`)
      ) {
        context.message.text = context.message.text.slice(
          0,
          -marker.length - 1
        );
      }
      return next();
    });
    bot.qaBoundaryInstalled = true;
  };
  const descriptor = Object.getOwnPropertyDescriptor(Api.prototype, 'config');
  Object.defineProperty(Api.prototype, 'config', {
    configurable: true,
    set(config) {
      Object.defineProperty(this, 'config', {
        configurable: true,
        writable: true,
        value: config,
      });
      attach(this);
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
    if (previousBoundary) {
      globalThis[key] = previousBoundary;
    } else {
      delete globalThis[key];
    }
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
  if (process.env.VAC_QA_COMBINED_PROBES === '1') {
    installCombinedProbes({
      marker: process.env.VAC_QA_MARKER,
      owner: process.env.VAC_QA_OWNER,
      path: process.env.VAC_QA_TRANSPORT_LEDGER,
    });
  }
  installQaApiBoundary({
    marker: process.env.VAC_QA_MARKER,
    owner: process.env.VAC_QA_OWNER,
    journal: process.env.VAC_QA_JOURNAL,
  });
}
