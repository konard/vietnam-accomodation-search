import { diagnosticLogger } from './diagnostic-log.js';

// SDK log formats and arguments may contain account prefixes, TL objects,
// auth keys and raw message bodies. Export only a fixed taxonomy, never them.
export function installTelegramSdkLogging(client, logger = diagnosticLogger) {
  let closing = false;
  // eslint-disable-next-line complexity -- Fixed categories separate runtime faults from expected shutdown without exporting raw SDK data.
  const report = (level, tag, format, args = []) => {
    const text = [
      format,
      ...args.map((arg) => arg?.message || arg?.text || ''),
    ].join(' ');
    const authentication =
      /AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED/iu.test(text);
    const session = authentication || /session is reset/iu.test(text);
    const cancelled = /abort|cancel|disconnected|destroyed/iu.test(text);
    const expected =
      closing &&
      !authentication &&
      (cancelled || /session is reset/iu.test(text));
    const category = expected
      ? 'shutdown-cancellation'
      : session
        ? 'session-loss'
        : /FLOOD_WAIT|rate.limit/iu.test(text)
          ? 'rate-limit'
          : /network|connect|timeout/iu.test(text)
            ? 'transport'
            : 'runtime';
    const stage = /updates|difference/iu.test(tag)
      ? 'updates'
      : /transport|network|mtproto/iu.test(tag)
        ? 'transport'
        : 'client';
    const method = expected
      ? 'debug'
      : level === 1
        ? 'error'
        : level === 2
          ? 'warn'
          : 'debug';
    logger[method]?.('Telegram SDK event', { category, stage });
  };
  client.log.handler = (_color, level, tag, format, args) =>
    report(level, tag, format, args);
  const onError = (error) => report(1, 'client', '', [error]);
  client.onError?.add(onError);
  const destroy = client.destroy.bind(client);
  client.destroy = async () => {
    closing = true;
    try {
      await destroy();
    } finally {
      client.onError?.remove(onError);
    }
  };
  return client;
}
