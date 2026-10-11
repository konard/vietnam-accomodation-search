import { stableHash } from './utils.js';

// OCR and cache downloads share this durable native retry boundary. A restart
// cannot shorten a server-imposed wait, and cancellation never starts an RPC.
export async function retryNativePhoto(retries, mediaId, options, operation) {
  options.signal?.throwIfAborted();
  if (!retries) {
    return operation();
  }
  const source =
    options.material?.members?.find(
      (message) => String(message.media?.id) === String(mediaId)
    )?.sourceId ||
    options.material?.sourceId ||
    'unknown';
  const key = `native:${stableHash(`${source}:${mediaId}`)}`;
  const previous = (await retries.records()).find((row) => row.id === key);
  if (previous && Date.parse(previous.retryAt) > retries.now()) {
    throw Object.assign(new Error('Native media retry is deferred.'), {
      code: 'TELEGRAM_MEDIA_DEFERRED',
      retryAt: previous.retryAt,
    });
  }
  try {
    const bytes = await operation();
    await retries.update(key);
    return bytes;
  } catch (error) {
    await retries.update(key, error);
    throw error;
  }
}
