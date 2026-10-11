import { createHash } from 'node:crypto';

// Telegram routes updates to the last active connection. All in-process
// users of one authorization must lease one transport, including RPC-only
// discovery/availability users. Factories isolate injected implementations.
const pools = new WeakMap();

export async function openTelegramClient(factory, options, connect) {
  const client = await factory(options);
  try {
    return { client, me: await connect(client) };
  } catch (error) {
    try {
      await client.destroy();
    } catch (cleanupError) {
      throw Object.assign(
        new AggregateError(
          [error, cleanupError],
          'Telegram connection and cleanup both failed.',
          { cause: cleanupError }
        ),
        { code: 'TELEGRAM_CLIENT_CLEANUP_FAILED' }
      );
    }
    throw error;
  }
}

export async function acquireTelegramClient(factory, credentials, open) {
  let pool = pools.get(factory);
  if (!pool) {
    pool = new Map();
    pools.set(factory, pool);
  }
  const key = createHash('sha256')
    .update(JSON.stringify(credentials))
    .digest('hex');
  let entry = pool.get(key);
  if (entry?.closing) {
    // A failed close remains fail-closed. Starting another transport while
    // the old one survives would silently reproduce stream stealing.
    await entry.closing;
    return acquireTelegramClient(factory, credentials, open);
  }
  if (!entry) {
    entry = { owners: 0, opening: Promise.resolve().then(open) };
    pool.set(key, entry);
    entry.opening.catch((error) => {
      if (
        error?.code !== 'TELEGRAM_CLIENT_CLEANUP_FAILED' &&
        pool.get(key) === entry
      ) {
        pool.delete(key);
      }
    });
  }
  entry.owners += 1;
  const connection = await entry.opening;
  let released;
  return {
    ...connection,
    release() {
      return (released ||= Promise.resolve().then(async () => {
        entry.owners -= 1;
        if (entry.owners === 0) {
          entry.closing = Promise.resolve().then(() =>
            connection.client.destroy()
          );
          await entry.closing;
          if (pool.get(key) === entry) {
            pool.delete(key);
          }
        }
      }));
    },
  };
}
