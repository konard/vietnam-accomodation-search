// Native owner driver for the explicitly scoped two-account conversation mode.
import { createMtcuteClient } from '../src/telegram-user.js';
import { nativeSessionPayload } from '../src/session-envelope.js';
import { resolveVerifiedNativeQaBotPeer } from './qa-telegram-peer.mjs';

export function nativeDriverAdapter(client) {
  const message = (value) => ({
    id: value.id,
    className: 'Message',
    message: value.text || '',
    date: Math.floor(new Date(value.date).getTime() / 1000),
    out: value.isOutgoing,
    media: value.media,
    fromId: { userId: value.sender?.id },
  });
  return {
    native: true,
    resolveBot: (identity, id) =>
      resolveVerifiedNativeQaBotPeer(client, identity, id),
    getMessages: async (peer, { limit = 100, minId = 0, offsetId = 0 } = {}) =>
      (
        await client.getHistory(peer, {
          limit,
          minId,
          offset: { id: offsetId, date: 0 },
        })
      ).map(message),
    sendMessage: async (peer, { message: text }) =>
      message(await client.sendText(peer, text)),
    deleteMessages: (peer, ids, options) =>
      client.deleteMessagesById(peer, ids, options),
    disconnect: () => client.destroy(),
    destroy: () => {},
  };
}

export async function connectNativeDriver(
  credentials,
  { signal, timeoutMs = 30000, factory = createMtcuteClient } = {}
) {
  signal?.throwIfAborted();
  const client = await factory({
    ...credentials,
    logger: { error() {}, warn() {}, debug() {} },
  });
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) {
    abort();
  }
  const timer = setTimeout(
    () => controller.abort(new Error('Native owner driver connect timed out.')),
    timeoutMs
  );
  let destruction;
  const destroy = () =>
    (destruction ||= Promise.resolve().then(() => client.destroy()));
  let aborted;
  const cancelled = new Promise((_resolve, reject) => {
    aborted = () => {
      destroy().catch(() => {});
      reject(controller.signal.reason);
    };
    controller.signal.addEventListener('abort', aborted, { once: true });
    if (controller.signal.aborted) {
      aborted();
    }
  });
  try {
    const identity = await Promise.race([
      (async () => {
        await client.start({
          session: nativeSessionPayload(
            credentials.session,
            credentials.format
          ),
        });
        controller.signal.throwIfAborted();
        return client.getMe();
      })(),
      cancelled,
    ]);
    if (String(identity.id) !== String(credentials.expectedId)) {
      throw new Error('Native owner driver identity pin mismatch.');
    }
    return { id: String(identity.id), client: nativeDriverAdapter(client) };
  } catch (error) {
    await destroy();
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', aborted);
  }
}
